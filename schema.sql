-- ============================================================================
-- VoltWatch Database Schema (SQLite)
-- High performance battery telemetry and session authentication
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Battery Telemetry Logs
CREATE TABLE IF NOT EXISTS battery_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battery_level INTEGER NOT NULL CHECK (battery_level >= 0 AND battery_level <= 100),
    event TEXT NOT NULL, -- 'level_change', 'charger_connected', 'charger_disconnected', 'battery_full', etc.
    recorded_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_battery_recorded_at ON battery_logs(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_battery_event ON battery_logs(event);

-- 2. Authenticated Dashboard Users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
