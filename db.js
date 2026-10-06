const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

// Initialize schema
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS battery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battery_level INTEGER NOT NULL CHECK (battery_level >= 0 AND battery_level <= 100),
      event TEXT NOT NULL,
      recorded_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_battery_recorded_at ON battery_logs(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_battery_event ON battery_logs(event);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

initSchema();

// DB Helpers
const insertLogStmt = db.prepare(`
  INSERT INTO battery_logs (battery_level, event, recorded_at)
  VALUES (@battery_level, @event, @recorded_at)
`);

function insertBatteryLog({ battery_level, event, recorded_at }) {
  const result = insertLogStmt.run({ battery_level, event, recorded_at });
  return { id: result.lastInsertRowid, battery_level, event, recorded_at };
}

function getLatestLog() {
  return db.prepare(`
    SELECT id, battery_level, event, recorded_at, created_at
    FROM battery_logs
    ORDER BY recorded_at DESC
    LIMIT 1
  `).get() || null;
}

function getTimeline(hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT id, battery_level, event, recorded_at
    FROM battery_logs
    WHERE recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(cutoff);
}

function getActivityFeed(limit = 30) {
  return db.prepare(`
    SELECT id, battery_level, event, recorded_at, created_at
    FROM battery_logs
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(limit);
}

function getDailyStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const logsToday = db.prepare(`
    SELECT battery_level, event, recorded_at
    FROM battery_logs
    WHERE recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(startIso);

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

function getUserByUsername(username) {
  return db.prepare(`
    SELECT id, username, password_hash, created_at
    FROM users
    WHERE username = ?
  `).get(username);
}

function createUser(username, passwordHash) {
  return db.prepare(`
    INSERT INTO users (username, password_hash)
    VALUES (?, ?)
  `).run(username, passwordHash);
}

function getUserCount() {
  const row = db.prepare(`SELECT COUNT(*) as count FROM users`).get();
  return row ? row.count : 0;
}

module.exports = {
  db,
  insertBatteryLog,
  getLatestLog,
  getTimeline,
  getActivityFeed,
  getDailyStats,
  getUserByUsername,
  createUser,
  getUserCount,
};
