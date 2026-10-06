require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  insertBatteryLog,
  updateBatteryLog,
  clearBatteryLogs,
  getLatestLog,
  getTimeline,
  getActivityFeed,
  getDailyStats,
  getUserById,
  getUserByUsername,
  getUserByWebhookKey,
  createUser,
  createOrUpdateGoogleUser,
  createOrUpdateFirebaseUser,
  setWebhookKey,
  regenerateWebhookKey,
  getUserCount,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Secrets
const JWT_SECRET = process.env.JWT_SECRET || 'voltwatch_default_jwt_secret_dev_2026_xyz987';
const GLOBAL_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'vw_sec_633b4856c45db954db91ef365de93019';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'anuraag7rao@gmail.com';
const ADMIN_USER = process.env.ADMIN_USER || 'radi';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@12345';

// Firebase & Google Configuration
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_APP_ID = process.env.FIREBASE_APP_ID || '';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/api/auth/google/callback`;

// Initialize default admin user if no users exist, or sync primary admin
if (getUserCount() === 0) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  createUser(ADMIN_USER, hash, {
    email: ADMIN_EMAIL,
    display_name: 'Anuraag Rao',
    webhook_key: GLOBAL_WEBHOOK_SECRET,
  });
  console.log(`[BOOT] Seeded default administrator user: "${ADMIN_USER}" (${ADMIN_EMAIL})`);
} else {
  const admin = getUserById(1);
  if (admin) {
    if (!admin.email) {
      require('./db').db.prepare('UPDATE users SET email = ?, display_name = ? WHERE id = 1').run(ADMIN_EMAIL, 'Anuraag Rao');
    }
    if (admin.webhook_key === 'macrodroid_battery_secret_2026') {
      setWebhookKey(1, GLOBAL_WEBHOOK_SECRET);
    }
  }
}

// Security & Parsing Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows CDN resources (Tailwind, Chart.js, Firebase, Google Fonts)
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Allows Firebase/Google Sign-In popups to maintain opener bridge
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static assets with cache-prevention headers for instant live updates
app.use(
  '/static',
  (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  },
  express.static(path.join(__dirname, 'public'))
);
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.svg')));
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.svg')));

// ── Auth Token Helper ──────────────────────────────────────────────────────
function issueSessionCookie(res, user) {
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
    },
    JWT_SECRET,
    { expiresIn: '14d' }
  );

  res.cookie('voltwatch_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
  });
}

// ── Auth Guard Middleware ──────────────────────────────────────────────────
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
    const user = getUserById(payload.id);
    if (!user) {
      res.clearCookie('voltwatch_auth');
      return res.redirect('/login');
    }
    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('voltwatch_auth');
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}

function safeStringCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Multi-User Webhook Guard Middleware ────────────────────────────────────
function requireWebhookSecret(req, res, next) {
  const secretHeader = req.headers['x-webhook-secret'];
  const secretQuery = req.query ? (req.query.secret || req.query.key) : null;
  const secretBody = req.body ? (req.body.secret || req.body.key) : null;
  const authBearer =
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

  const providedSecret = secretHeader || secretQuery || secretBody || authBearer;

  if (!providedSecret) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing webhook secret key (pass via ?secret= URL param or X-Webhook-Secret header)',
    });
  }

  // 1. Check if key belongs to a specific user
  const user = getUserByWebhookKey(providedSecret);
  if (user) {
    req.webhookUser = user;
    return next();
  }

  // 2. Fallback check for global server secret or target phone secret (timing-safe)
  const TARGET_PHONE_SECRET = 'vw_sec_633b4856c45db954db91ef365de93019';
  if (
    safeStringCompare(providedSecret, GLOBAL_WEBHOOK_SECRET) ||
    safeStringCompare(providedSecret, TARGET_PHONE_SECRET)
  ) {
    const targetUsername = req.query?.user || req.body?.user || req.query?.username;
    if (targetUsername) {
      const u = getUserByUsername(targetUsername);
      if (u) {
        req.webhookUser = u;
        return next();
      }
    }
    // Default to first user (Admin/Radi)
    const defaultUser = getUserById(1);
    if (defaultUser) {
      req.webhookUser = defaultUser;
      return next();
    }
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid webhook secret key. Check your personal webhook URL in the dashboard.',
  });
}

// ── UI Routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
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

// ── Public Auth Configuration (for Frontend SDKs) ─────────────────────────
app.get('/api/auth/config', (req, res) => {
  res.json({
    firebase: {
      apiKey: FIREBASE_API_KEY || null,
      authDomain: FIREBASE_AUTH_DOMAIN || null,
      projectId: FIREBASE_PROJECT_ID || null,
      appId: FIREBASE_APP_ID || null,
      isConfigured: Boolean(FIREBASE_API_KEY && FIREBASE_PROJECT_ID),
    },
    google: {
      clientId: GOOGLE_CLIENT_ID || null,
      isConfigured: Boolean(GOOGLE_CLIENT_ID),
    },
  });
});

// ── Firebase Authentication Endpoint ──────────────────────────────────────
app.post('/api/auth/firebase', async (req, res) => {
  const { idToken, email, displayName, photoURL, uid } = req.body || {};

  if (!idToken || !uid) {
    return res.status(400).json({ error: 'Missing Firebase credential payload' });
  }

  try {
    // If Firebase API key is configured, cryptographically verify with Google Identity Toolkit
    let verifiedUid = uid;
    let verifiedEmail = email;
    let verifiedName = displayName;
    let verifiedPhoto = photoURL;

    if (FIREBASE_API_KEY) {
      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );

      if (!verifyRes.ok) {
        return res.status(401).json({ error: 'Invalid or expired Firebase credential token' });
      }

      const verifyData = await verifyRes.json();
      const verifiedUser = verifyData.users?.[0];
      if (!verifiedUser || verifiedUser.localId !== uid) {
        return res.status(401).json({ error: 'Firebase account verification mismatch' });
      }

      // Enforce Google-verified identity claims
      verifiedUid = verifiedUser.localId;
      verifiedEmail = verifiedUser.email || verifiedEmail;
      verifiedName = verifiedUser.displayName || verifiedName;
      verifiedPhoto = verifiedUser.photoUrl || verifiedPhoto;
    }

    const user = createOrUpdateFirebaseUser({
      firebase_uid: verifiedUid,
      email: verifiedEmail || null,
      display_name: verifiedName || (verifiedEmail ? verifiedEmail.split('@')[0] : 'User'),
      avatar_url: verifiedPhoto || null,
    });

    issueSessionCookie(res, user);

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error('[FIREBASE AUTH ERROR]', err);
    return res.status(500).json({ error: 'Failed to authenticate with Firebase' });
  }
});

// ── Google Identity Services / One-Tap Endpoint ───────────────────────────
app.post('/api/auth/google/credential', async (req, res) => {
  const { credential } = req.body || {};

  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential token' });
  }

  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );

    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Invalid Google credential token' });
    }

    const tokenInfo = await verifyRes.json();

    if (GOOGLE_CLIENT_ID && tokenInfo.aud !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Google client ID mismatch' });
    }

    const user = createOrUpdateGoogleUser({
      google_id: tokenInfo.sub,
      email: tokenInfo.email,
      display_name: tokenInfo.name || tokenInfo.email.split('@')[0],
      avatar_url: tokenInfo.picture || null,
    });

    issueSessionCookie(res, user);

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error('[GOOGLE CREDENTIAL ERROR]', err);
    return res.status(500).json({ error: 'Failed to verify Google token' });
  }
});

// ── Standard Google OAuth 2.0 Redirect Flow ───────────────────────────────
app.get('/api/auth/google/login', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#0e1117;color:#fff;">
      <h2>⚡ Google OAuth Not Configured</h2>
      <p>GOOGLE_CLIENT_ID is not configured in .env yet.</p>
      <p>You can use standard credentials or configure Firebase/Google in your .env file.</p>
      <a href="/login" style="color:#10b981;">&larr; Back to Login</a>
      </body></html>
    `);
  }

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    }).toString();

  res.redirect(authUrl);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect('/login?error=google_denied');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[OAUTH TOKEN ERROR]', tokenData);
      return res.redirect('/login?error=token_exchange_failed');
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profile = await userRes.json();

    const user = createOrUpdateGoogleUser({
      google_id: profile.sub,
      email: profile.email,
      display_name: profile.name || profile.email.split('@')[0],
      avatar_url: profile.picture || null,
    });

    issueSessionCookie(res, user);
    res.redirect('/');
  } catch (err) {
    console.error('[OAUTH CALLBACK ERROR]', err);
    res.redirect('/login?error=oauth_internal');
  }
});



app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('voltwatch_auth');
  return res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      display_name: req.user.display_name,
      avatar_url: req.user.avatar_url,
      webhook_key: req.user.webhook_key,
    },
  });
});

// ── Webhook Secret Key Management ─────────────────────────────────────────
app.post('/api/user/regenerate-webhook-key', requireAuth, (req, res) => {
  const newKey = regenerateWebhookKey(req.user.id);
  res.json({ success: true, webhook_key: newKey });
});

app.post('/api/user/set-webhook-key', requireAuth, (req, res) => {
  const { webhook_key } = req.body || {};
  if (!webhook_key || typeof webhook_key !== 'string' || webhook_key.trim().length < 8) {
    return res.status(400).json({ error: 'Webhook secret must be at least 8 characters long.' });
  }
  const cleanKey = webhook_key.trim();
  setWebhookKey(req.user.id, cleanKey);
  res.json({ success: true, webhook_key: cleanKey });
});

// ── Automation (by Jens Schröder) Webhook Ingestion ─────────────────────────
// Isolated per user based on personal webhook key
function handleBatteryWebhook(req, res) {
  const payload = { ...req.query, ...req.body };
  const user = req.webhookUser;

  // 1. Resolve battery level from flexible aliases
  const rawLevel =
    payload.battery_level !== undefined ? payload.battery_level :
    payload.level !== undefined ? payload.level :
    payload.battery !== undefined ? payload.battery :
    payload.percent !== undefined ? payload.percent :
    payload.pct;

  let level = Number(rawLevel);
  if (rawLevel === undefined || Number.isNaN(level) || level < 0 || level > 100) {
    // Fallback to user's latest known battery reading if level is omitted or unparsed placeholder
    const latest = getLatestLog(user.id);
    level = latest && typeof latest.battery_level === 'number' ? latest.battery_level : 100;
  }

  // 2. Intelligently normalize event name
  const rawEvent =
    payload.event !== undefined ? payload.event :
    payload.status !== undefined ? payload.status :
    payload.state !== undefined ? payload.state :
    payload.type !== undefined ? payload.type :
    payload.action;

  let eventName = 'level_change';
  if (typeof rawEvent === 'string') {
    const e = rawEvent.trim().toLowerCase();
    if (e.includes('disconn') || e.includes('unplug') || e.includes('discharg')) {
      eventName = 'charger_disconnected';
    } else if (e.includes('conn') || e.includes('plug') || e.includes('charg')) {
      eventName = 'charger_connected';
    } else if (e.includes('full') || level >= 100) {
      eventName = 'battery_full';
    } else if (e.includes('low') || level <= 15) {
      eventName = 'battery_low';
    } else if (e.includes('screen_on')) {
      eventName = 'screen_on';
    } else if (e.includes('screen_off')) {
      eventName = 'screen_off';
    } else if (e.length > 0) {
      eventName = e.replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    }
  }

  // 3. Resolve timestamp
  const rawTime = payload.time || payload.timestamp || payload.recorded_at;
  let recordedAt;
  if (rawTime && !Number.isNaN(Date.parse(rawTime))) {
    recordedAt = new Date(rawTime).toISOString();
  } else {
    recordedAt = new Date().toISOString();
  }

  try {
    const roundedLevel = Math.round(level);
    const latest = getLatestLog(user.id);
    const nowMs = Date.now();
    const latestMs = latest && latest.recorded_at ? new Date(latest.recorded_at).getTime() : 0;
    // Detect burst cascades (concurrent webhook executions within a 20-second window)
    const isBurst = latest && Math.abs(nowMs - latestMs) < 20000;

    if (isBurst && eventName !== 'charger_connected') {
      // 1. If disconnect arrives in a burst with higher level, keep true lower level
      if (eventName === 'charger_disconnected' && roundedLevel > latest.battery_level) {
        const updated = updateBatteryLog(latest.id, latest.battery_level, 'charger_disconnected', recordedAt);
        return res.status(200).json({
          success: true,
          message: 'Preserved lower battery level for disconnect event',
          user_id: user.id,
          data: updated,
        });
      }

      // 2. Reject upward jumps during burst while discharging (e.g. 95% hitting after 80% when phone is at 77%)
      if (roundedLevel > latest.battery_level) {
        return res.status(200).json({
          success: true,
          message: 'Cascading threshold echo ignored (preserved lower reading)',
          user_id: user.id,
          data: latest,
        });
      }

      // 3. Deeper threshold reached in same burst (e.g. 85% arrived first, then 80% arrived)
      if (roundedLevel < latest.battery_level && latest.event === 'level_change') {
        const updated = updateBatteryLog(latest.id, roundedLevel, eventName, recordedAt);
        return res.status(200).json({
          success: true,
          message: 'Updated burst to deeper threshold',
          user_id: user.id,
          data: updated,
        });
      }
    }

    // 4. Resolve time to full (charging estimate in seconds)
    const rawTimeToFull =
      payload.time_to_full !== undefined ? payload.time_to_full :
      payload.time_to_charge !== undefined ? payload.time_to_charge :
      payload.time_until_charged !== undefined ? payload.time_until_charged :
      payload.charge_time !== undefined ? payload.charge_time :
      payload.eta;

    let timeToFull = null;
    if (rawTimeToFull !== undefined && rawTimeToFull !== null && rawTimeToFull !== '') {
      const parsedEta = Number(rawTimeToFull);
      if (!Number.isNaN(parsedEta) && parsedEta > 0) {
        // If provided in milliseconds (e.g. > 100,000), convert to seconds
        timeToFull = parsedEta > 100000 ? Math.round(parsedEta / 1000) : Math.round(parsedEta);
      }
    }

    const record = insertBatteryLog({
      user_id: user.id,
      battery_level: roundedLevel,
      event: eventName,
      recorded_at: recordedAt,
      time_to_full: timeToFull,
    });

    return res.status(201).json({
      success: true,
      user_id: user.id,
      data: record,
    });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    return res.status(500).json({ error: 'Failed to record battery telemetry' });
  }
}

app.post('/api/webhook/battery', requireWebhookSecret, handleBatteryWebhook);
app.get('/api/webhook/battery', requireWebhookSecret, handleBatteryWebhook);

// ── Dashboard Analytics API (Protected & Strictly Isolated to Logged-in User)
app.get('/api/battery/stats', requireAuth, (req, res) => {
  const userId = req.user.id;
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);

  const rawLatest = getLatestLog(userId);
  const hasData = rawLatest !== null;
  const latest = rawLatest || {
    battery_level: null,
    event: 'awaiting_telemetry',
    recorded_at: null,
  };

  const timeline = getTimeline(userId, hours);
  const activity = getActivityFeed(userId, 25);
  const stats = getDailyStats(userId);

  const isCharging =
    hasData &&
    (latest.event === 'charger_connected' ||
      latest.event === 'charging' ||
      latest.event === 'battery_full');

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      display_name: req.user.display_name,
      avatar_url: req.user.avatar_url,
      webhook_key: req.user.webhook_key,
    },
    has_data: hasData,
    current: {
      battery_level: latest.battery_level,
      event: latest.event,
      recorded_at: latest.recorded_at,
      is_charging: isCharging,
      time_to_full: latest.time_to_full || null,
    },
    timeline,
    activity,
    stats,
    query_hours: hours,
  });
});

// ── Clear Telemetry / Activity Log API (Protected, User-specific) ─────────
app.post('/api/battery/clear', requireAuth, (req, res) => {
  const deletedCount = clearBatteryLogs(req.user.id);
  res.json({ success: true, count: deletedCount });
});

// ── Webhook Simulator API (Protected, Isolated to Logged-in User) ───────────
app.post('/api/battery/simulate', requireAuth, (req, res) => {
  const { battery_level, event } = req.body || {};
  const level = Number(battery_level);
  if (Number.isNaN(level) || level < 0 || level > 100) {
    return res.status(400).json({ error: 'battery_level must be between 0 and 100' });
  }

  const record = insertBatteryLog({
    user_id: req.user.id,
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
