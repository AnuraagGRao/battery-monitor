require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  insertBatteryLog,
  getLatestLog,
  getTimeline,
  getActivityFeed,
  getDailyStats,
  getUserByUsername,
  createUser,
  getUserCount,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Secrets
const JWT_SECRET = process.env.JWT_SECRET || 'voltwatch_default_jwt_secret_dev_2026_xyz987';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'macrodroid_battery_secret_2026';
const ADMIN_USER = process.env.ADMIN_USER || 'radi';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@12345';

// Initialize default admin user if none exists
if (getUserCount() === 0) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  createUser(ADMIN_USER, hash);
  console.log(`[BOOT] Seeded default administrator user: "${ADMIN_USER}"`);
}

// Security & Parsing Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows CDN resources (Tailwind, Chart.js, Google Fonts)
  })
);
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Static assets
app.use('/static', express.static(path.join(__dirname, 'public')));

// ── Auth Middleware ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies.voltwatch_auth;
  if (!token) {
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.clearCookie('voltwatch_auth');
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}

// ── Webhook Guard Middleware ───────────────────────────────────────────────
function requireWebhookSecret(req, res, next) {
  const secretHeader = req.headers['x-webhook-secret'];
  const secretQuery = req.query.secret;
  const authBearer = req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  const providedSecret = secretHeader || secretQuery || authBearer;

  if (!providedSecret || providedSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing webhook secret header (X-Webhook-Secret)',
    });
  }
  next();
}

// ── UI Routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  // If already authenticated, redirect straight to dashboard
  const token = req.cookies.voltwatch_auth;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect('/');
    } catch {
      res.clearCookie('voltwatch_auth');
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Auth API ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = getUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '14d' }
  );

  res.cookie('voltwatch_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
  });

  return res.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('voltwatch_auth');
  return res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ authenticated: true, user: req.user });
});

// ── MacroDroid Webhook Endpoint ────────────────────────────────────────────
// Payload: { "battery_level": 85, "event": "charger_disconnected", "time": "2026-10-06T08:45:00Z" }
app.post('/api/webhook/battery', requireWebhookSecret, (req, res) => {
  const { battery_level, event, time } = req.body || {};

  // 1. Validate battery_level
  const level = Number(battery_level);
  if (Number.isNaN(level) || level < 0 || level > 100) {
    return res.status(400).json({
      error: 'Invalid payload',
      message: 'battery_level must be an integer between 0 and 100',
    });
  }

  // 2. Normalize event name
  const rawEvent = typeof event === 'string' ? event.trim().toLowerCase() : '';
  const validEvents = [
    'level_change',
    'charger_connected',
    'charger_disconnected',
    'battery_full',
    'battery_low',
    'screen_on',
    'screen_off',
  ];

  const eventName = rawEvent && validEvents.includes(rawEvent)
    ? rawEvent
    : rawEvent || 'level_change';

  // 3. Normalize timestamp
  let recordedAt;
  if (time && !Number.isNaN(Date.parse(time))) {
    recordedAt = new Date(time).toISOString();
  } else {
    recordedAt = new Date().toISOString();
  }

  try {
    const record = insertBatteryLog({
      battery_level: Math.round(level),
      event: eventName,
      recorded_at: recordedAt,
    });

    return res.status(201).json({
      success: true,
      data: record,
    });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    return res.status(500).json({ error: 'Failed to record battery telemetry' });
  }
});

// ── Dashboard Analytics API (Protected) ────────────────────────────────────
app.get('/api/battery/stats', requireAuth, (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168); // 1h to 7d

  const latest = getLatestLog() || {
    battery_level: 100,
    event: 'initial_standby',
    recorded_at: new Date().toISOString(),
  };

  const timeline = getTimeline(hours);
  const activity = getActivityFeed(25);
  const stats = getDailyStats();

  const isCharging =
    latest.event === 'charger_connected' ||
    latest.event === 'charging' ||
    latest.event === 'battery_full';

  res.json({
    current: {
      battery_level: latest.battery_level,
      event: latest.event,
      recorded_at: latest.recorded_at,
      is_charging: isCharging,
    },
    timeline,
    activity,
    stats,
    query_hours: hours,
  });
});

// ── Webhook Simulator API (Protected, for testing dashboard in-browser) ────
app.post('/api/battery/simulate', requireAuth, (req, res) => {
  const { battery_level, event } = req.body || {};
  const level = Number(battery_level);
  if (Number.isNaN(level) || level < 0 || level > 100) {
    return res.status(400).json({ error: 'battery_level must be between 0 and 100' });
  }

  const record = insertBatteryLog({
    battery_level: Math.round(level),
    event: event || 'level_change',
    recorded_at: new Date().toISOString(),
  });

  res.status(201).json({ success: true, data: record });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[VOLTWATCH] Server listening at http://localhost:${PORT}`);
  console.log(`[VOLTWATCH] Webhook endpoint: http://localhost:${PORT}/api/webhook/battery`);
});
