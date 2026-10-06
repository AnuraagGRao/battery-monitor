-- ============================================================================
-- VoltWatch Database Schema (SQLite)
-- High performance multi-user battery telemetry and isolated user statistics
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Authenticated Dashboard Users (Local, Google OAuth, and Firebase Auth)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    firebase_uid TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    webhook_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_webhook_key ON users(webhook_key);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);

-- 2. Battery Telemetry Logs (Strictly Isolated per User)
CREATE TABLE IF NOT EXISTS battery_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    battery_level INTEGER NOT NULL CHECK (battery_level >= 0 AND battery_level <= 100),
    event TEXT NOT NULL, -- 'level_change', 'charger_connected', 'charger_disconnected', 'battery_full', etc.
    recorded_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup indexes per user
CREATE INDEX IF NOT EXISTS idx_battery_user_recorded ON battery_logs(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_battery_user_event ON battery_logs(user_id, event);
