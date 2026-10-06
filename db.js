const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'battery.db');

// Ensure database directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// High-performance concurrency settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

function generateWebhookKey() {
  return 'vw_sec_' + crypto.randomBytes(16).toString('hex');
}

// Initialize & migrate schema
function initSchema() {
  // 1. Create base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      firebase_uid TEXT UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      webhook_key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS battery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
      battery_level INTEGER NOT NULL CHECK (battery_level >= 0 AND battery_level <= 100),
      event TEXT NOT NULL,
      recorded_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Migration: add columns to existing users table if missing
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT;');
  }
  if (!userCols.includes('google_id')) {
    db.exec('ALTER TABLE users ADD COLUMN google_id TEXT;');
  }
  if (!userCols.includes('firebase_uid')) {
    db.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT;');
  }
  if (!userCols.includes('display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT;');
  }
  if (!userCols.includes('avatar_url')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
  }
  if (!userCols.includes('webhook_key')) {
    db.exec('ALTER TABLE users ADD COLUMN webhook_key TEXT;');
  }

  // 3. Migration: add user_id to battery_logs if missing
  const logCols = db.prepare('PRAGMA table_info(battery_logs)').all().map((c) => c.name);
  if (!logCols.includes('user_id')) {
    db.exec('ALTER TABLE battery_logs ADD COLUMN user_id INTEGER DEFAULT 1;');
  }

  // 4. Indexes for fast per-user lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_battery_user_recorded ON battery_logs(user_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_battery_user_event ON battery_logs(user_id, event);
    CREATE INDEX IF NOT EXISTS idx_users_webhook_key ON users(webhook_key);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // 5. Backfill webhook keys and ensure primary admin sync
  const defaultSecret = process.env.WEBHOOK_SECRET || 'vw_sec_633b4856c45db954db91ef365de93019';
  const adminEmail = process.env.ADMIN_EMAIL || 'anuraag7rao@gmail.com';

  const user1 = db.prepare('SELECT id, email, webhook_key FROM users WHERE id = 1').get();
  if (user1) {
    if (user1.webhook_key === 'macrodroid_battery_secret_2026' || !user1.webhook_key) {
      db.prepare('UPDATE users SET webhook_key = ? WHERE id = 1').run(defaultSecret);
    }
    if (!user1.email) {
      db.prepare('UPDATE users SET email = ?, display_name = COALESCE(display_name, ?) WHERE id = 1').run(adminEmail, 'Anuraag Rao');
    }
  }

  const usersWithoutKey = db.prepare('SELECT id, username FROM users WHERE webhook_key IS NULL').all();
  for (const u of usersWithoutKey) {
    const key = u.id === 1 ? defaultSecret : generateWebhookKey();
    db.prepare('UPDATE users SET webhook_key = ? WHERE id = ?').run(key, u.id);
  }
}

initSchema();

// ── DB Helpers ─────────────────────────────────────────────────────────────

const insertLogStmt = db.prepare(`
  INSERT INTO battery_logs (user_id, battery_level, event, recorded_at)
  VALUES (@user_id, @battery_level, @event, @recorded_at)
`);

function insertBatteryLog({ user_id = 1, battery_level, event, recorded_at }) {
  const result = insertLogStmt.run({ user_id, battery_level, event, recorded_at });
  return { id: result.lastInsertRowid, user_id, battery_level, event, recorded_at };
}

function getLatestLog(userId = 1) {
  return (
    db
      .prepare(`
        SELECT id, user_id, battery_level, event, recorded_at, created_at
        FROM battery_logs
        WHERE user_id = ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `)
      .get(userId) || null
  );
}

function getTimeline(userId = 1, hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db
    .prepare(`
      SELECT id, user_id, battery_level, event, recorded_at
      FROM battery_logs
      WHERE user_id = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `)
    .all(userId, cutoff);
}

function getActivityFeed(userId = 1, limit = 30) {
  return db
    .prepare(`
      SELECT id, user_id, battery_level, event, recorded_at, created_at
      FROM battery_logs
      WHERE user_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `)
    .all(userId, limit);
}

function getDailyStats(userId = 1) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const logsToday = db
    .prepare(`
      SELECT battery_level, event, recorded_at
      FROM battery_logs
      WHERE user_id = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `)
    .all(userId, startIso);

  if (logsToday.length === 0) {
    return {
      cycles_today: 0,
      min_level: 0,
      max_level: 0,
      charging_sessions: 0,
      total_logs_today: 0,
    };
  }

  let chargeDeltaSum = 0;
  let minLevel = 100;
  let maxLevel = 0;
  let chargingSessions = 0;

  for (let i = 0; i < logsToday.length; i++) {
    const level = logsToday[i].battery_level;
    if (level < minLevel) minLevel = level;
    if (level > maxLevel) maxLevel = level;

    if (logsToday[i].event === 'charger_connected' || logsToday[i].event === 'charging') {
      chargingSessions++;
    }

    if (i > 0) {
      const delta = level - logsToday[i - 1].battery_level;
      if (delta > 0) {
        chargeDeltaSum += delta;
      }
    }
  }

  const cycles = parseFloat((chargeDeltaSum / 100).toFixed(2));

  return {
    cycles_today: cycles,
    min_level: minLevel === 100 && logsToday.length === 0 ? 0 : minLevel,
    max_level: maxLevel,
    charging_sessions: chargingSessions,
    total_logs_today: logsToday.length,
  };
}

// ── User Management ────────────────────────────────────────────────────────

function getUserById(id) {
  return db
    .prepare(`
      SELECT id, username, email, password_hash, google_id, firebase_uid, display_name, avatar_url, webhook_key, created_at
      FROM users
      WHERE id = ?
    `)
    .get(id);
}

function getUserByUsername(username) {
  return db
    .prepare(`
      SELECT id, username, email, password_hash, google_id, firebase_uid, display_name, avatar_url, webhook_key, created_at
      FROM users
      WHERE username = ?
    `)
    .get(username);
}

function getUserByEmail(email) {
  return db
    .prepare(`
      SELECT id, username, email, password_hash, google_id, firebase_uid, display_name, avatar_url, webhook_key, created_at
      FROM users
      WHERE email = ?
    `)
    .get(email);
}

function getUserByGoogleId(googleId) {
  return db
    .prepare(`
      SELECT id, username, email, password_hash, google_id, firebase_uid, display_name, avatar_url, webhook_key, created_at
      FROM users
      WHERE google_id = ?
    `)
    .get(googleId);
}

function getUserByFirebaseUid(uid) {
  return db
    .prepare(`
      SELECT id, username, email, password_hash, google_id, firebase_uid, display_name, avatar_url, webhook_key, created_at
      FROM users
      WHERE firebase_uid = ?
    `)
    .get(uid);
}

function getUserByWebhookKey(key) {
  return db
    .prepare(`
      SELECT id, username, email, display_name, avatar_url, webhook_key
      FROM users
      WHERE webhook_key = ?
    `)
    .get(key);
}

function createUser(username, passwordHash, options = {}) {
  const webhookKey = options.webhook_key || generateWebhookKey();
  const email = options.email || null;
  const displayName = options.display_name || username;

  const res = db
    .prepare(`
      INSERT INTO users (username, email, password_hash, display_name, webhook_key)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(username, email, passwordHash, displayName, webhookKey);

  return getUserById(res.lastInsertRowid);
}

function createOrUpdateGoogleUser({ google_id, email, display_name, avatar_url }) {
  // 1. Check if user already exists by google_id
  let user = getUserByGoogleId(google_id);
  if (user) {
    db.prepare(`
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          avatar_url = COALESCE(?, avatar_url),
          email = COALESCE(?, email)
      WHERE id = ?
    `).run(display_name, avatar_url, email, user.id);
    return getUserById(user.id);
  }

  // 2. Link primary admin user (anuraag7rao@gmail.com or User 1)
  const adminEmail = (process.env.ADMIN_EMAIL || 'anuraag7rao@gmail.com').toLowerCase();
  if (email && email.toLowerCase() === adminEmail) {
    const adminUser = getUserById(1);
    if (adminUser) {
      db.prepare(`
        UPDATE users
        SET google_id = ?,
            email = ?,
            display_name = COALESCE(?, display_name),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = 1
      `).run(google_id, email, display_name, avatar_url);
      return getUserById(1);
    }
  }

  // 3. Check if user exists by email (link Google ID to existing account)
  if (email) {
    user = getUserByEmail(email);
    if (user) {
      db.prepare(`
        UPDATE users
        SET google_id = ?,
            display_name = COALESCE(?, display_name),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `).run(google_id, display_name, avatar_url, user.id);
      return getUserById(user.id);
    }
  }

  // 4. New user registration from Google
  const usernameBase = (email ? email.split('@')[0] : 'google_user').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  let username = usernameBase;
  let counter = 1;
  while (getUserByUsername(username)) {
    username = `${usernameBase}_${counter++}`;
  }

  const webhookKey = generateWebhookKey();
  const unusablePassword = `oauth_disabled_${crypto.randomBytes(16).toString('hex')}`;
  const res = db
    .prepare(`
      INSERT INTO users (username, email, password_hash, google_id, display_name, avatar_url, webhook_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(username, email, unusablePassword, google_id, display_name || username, avatar_url, webhookKey);

  return getUserById(res.lastInsertRowid);
}

function createOrUpdateFirebaseUser({ firebase_uid, email, display_name, avatar_url }) {
  // 1. Check if user already exists by firebase_uid
  let user = getUserByFirebaseUid(firebase_uid);
  if (user) {
    db.prepare(`
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          avatar_url = COALESCE(?, avatar_url),
          email = COALESCE(?, email)
      WHERE id = ?
    `).run(display_name, avatar_url, email, user.id);
    return getUserById(user.id);
  }

  // 2. Link primary admin user (anuraag7rao@gmail.com or User 1)
  const adminEmail = (process.env.ADMIN_EMAIL || 'anuraag7rao@gmail.com').toLowerCase();
  if (email && email.toLowerCase() === adminEmail) {
    const adminUser = getUserById(1);
    if (adminUser) {
      db.prepare(`
        UPDATE users
        SET firebase_uid = ?,
            email = ?,
            display_name = COALESCE(?, display_name),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = 1
      `).run(firebase_uid, email, display_name, avatar_url);
      return getUserById(1);
    }
  }

  // 3. Check if user exists by email (link Firebase UID to existing account)
  if (email) {
    user = getUserByEmail(email);
    if (user) {
      db.prepare(`
        UPDATE users
        SET firebase_uid = ?,
            display_name = COALESCE(?, display_name),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `).run(firebase_uid, display_name, avatar_url, user.id);
      return getUserById(user.id);
    }
  }

  // 4. New user registration from Firebase
  const usernameBase = (email ? email.split('@')[0] : 'firebase_user').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  let username = usernameBase;
  let counter = 1;
  while (getUserByUsername(username)) {
    username = `${usernameBase}_${counter++}`;
  }

  const webhookKey = generateWebhookKey();
  const unusablePassword = `oauth_disabled_${crypto.randomBytes(16).toString('hex')}`;
  const res = db
    .prepare(`
      INSERT INTO users (username, email, password_hash, firebase_uid, display_name, avatar_url, webhook_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(username, email, unusablePassword, firebase_uid, display_name || username, avatar_url, webhookKey);

  return getUserById(res.lastInsertRowid);
}

function setWebhookKey(userId, key) {
  db.prepare(`UPDATE users SET webhook_key = ? WHERE id = ?`).run(key, userId);
  return key;
}

function regenerateWebhookKey(userId) {
  const newKey = generateWebhookKey();
  db.prepare(`UPDATE users SET webhook_key = ? WHERE id = ?`).run(newKey, userId);
  return newKey;
}

function getUserCount() {
  const row = db.prepare(`SELECT COUNT(*) as count FROM users`).get();
  return row ? row.count : 0;
}

module.exports = {
  db,
  generateWebhookKey,
  insertBatteryLog,
  getLatestLog,
  getTimeline,
  getActivityFeed,
  getDailyStats,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getUserByGoogleId,
  getUserByFirebaseUid,
  getUserByWebhookKey,
  createUser,
  createOrUpdateGoogleUser,
  createOrUpdateFirebaseUser,
  setWebhookKey,
  regenerateWebhookKey,
  getUserCount,
};
