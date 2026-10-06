/**
 * Seed script: Generates 24 hours of realistic battery charging/discharging data.
 * Run with: node seed.js
 */
const { insertBatteryLog, getLatestLog } = require('./db');

console.log('[SEED] Generating realistic 24-hour battery curve...');

const now = Date.now();
const oneHour = 60 * 60 * 1000;

// Generate 48 data points across the last 24 hours (every ~30 mins)
let currentLevel = 88;
let isCharging = false;

for (let i = 48; i >= 0; i--) {
  const timestamp = new Date(now - i * 30 * 60 * 1000);
  let event = 'level_change';

  // Simulate usage cycle:
  // 18h to 14h ago: plugged in overnight
  if (i >= 30 && i <= 38) {
    if (!isCharging) {
      event = 'charger_connected';
      isCharging = true;
    }
    currentLevel = Math.min(100, currentLevel + 7);
    if (currentLevel === 100) event = 'battery_full';
  } else if (i === 29) {
    event = 'charger_disconnected';
    isCharging = false;
    currentLevel = 98;
  } else if (i >= 12 && i <= 16) {
    // Top-up fast charge in afternoon
    if (!isCharging) {
      event = 'charger_connected';
      isCharging = true;
    }
    currentLevel = Math.min(85, currentLevel + 9);
  } else if (i === 11) {
    event = 'charger_disconnected';
    isCharging = false;
    currentLevel = 84;
  } else {
    // Normal discharge
    isCharging = false;
    const drop = Math.floor(Math.random() * 3) + 1;
    currentLevel = Math.max(15, currentLevel - drop);
    if (currentLevel < 20) event = 'battery_low';
  }

  insertBatteryLog({
    battery_level: currentLevel,
    event: event,
    recorded_at: timestamp.toISOString(),
  });
}

console.log('[SEED] Successfully seeded 49 battery data points!');
const latest = getLatestLog();
console.log(`[SEED] Latest reading: ${latest.battery_level}% (${latest.event})`);
