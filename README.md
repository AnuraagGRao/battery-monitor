# ⚡ VoltWatch — Android Battery Telemetry & Charging Health Dashboard

A self-hosted, private web console designed to monitor Android device battery health, discharge curves, and charging habits using MacroDroid webhooks.

Built with **Node.js, Express, SQLite (WAL mode), Tailwind CSS, and Chart.js**.

---

## 🌟 Key Features

- **MacroDroid Webhook Relay (`POST /api/webhook/battery`)**: Secure, pre-shared key guarded endpoint to ingest real-time battery status changes.
- **Hero Battery Metric**: Prominent battery level with Apple-style fluid fill and color coding:
  - 🟢 **Green (> 50%)**: Healthy operating band
  - 🟡 **Yellow (20% – 50%)**: Medium discharge
  - 🔴 **Red (< 20%)**: Critical low charge warning
  - ⚡ **Charging Mode**: Pulsing live indicator when power is connected
- **24-Hour Battery Curve**: Smooth spline line graph (Chart.js) plotting voltage drops and recharge slopes over time. Includes range toggles (6H, 12H, 24H, 3D, 7D).
- **Daily Charge Cycle Calculator**: Computes cumulative lithium charge cycles today ($`\Sigma \Delta^+ / 100`$).
- **Live Activity Feed**: Scrollable timeline of distinct battery events with timestamps and contextual icons.
- **Private Session Auth**: HttpOnly JWT cookie authentication with bcrypt password hashing. Unauthenticated visitors are redirected to `/login`.
- **In-Browser Webhook Simulator**: Built-in testing modal to fire simulated phone events without waiting on real battery drops.

---

## 🚀 Quickstart & Setup

### 1. Install Dependencies
```bash
cd battery-monitor
npm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default parameters in `.env`:
```env
PORT=3000
JWT_SECRET=super_secret_voltwatch_jwt_key_2026_change_in_production
WEBHOOK_SECRET=macrodroid_battery_secret_2026
ADMIN_USER=radi
ADMIN_PASS=Admin@12345
```

### 3. (Optional) Seed 24h Test Data
To instantly populate the dashboard with realistic 24-hour battery curves and events:
```bash
node seed.js
```

### 4. Start Server
```bash
npm start
# or: node server.js
```
Open **`http://localhost:3000`** in your browser and sign in with `radi` / `Admin@12345`.

---

## 📲 MacroDroid Android Configuration

In the MacroDroid app on your Android phone, create a new Macro:

### 1. Triggers
Add the following triggers:
- **Battery / Power** ➔ **Battery Level Changed** ➔ Select *Any change* (or *Increases/Decreases by 5%*)
- **Battery / Power** ➔ **Power Connected**
- **Battery / Power** ➔ **Power Disconnected**

### 2. Action (HTTP Request)
- **Request Type**: `POST`
- **URL**: `https://your-domain.com/api/webhook/battery`
- **Content Type**: `application/json`
- **Headers**:
  - `X-Webhook-Secret`: `macrodroid_battery_secret_2026`
- **Body**:
```json
{
  "battery_level": [battery],
  "event": "[trigger_name]",
  "time": "[system_date_iso]"
}
```

> **Note:** MacroDroid will automatically substitute `[battery]` with the integer percentage (e.g. `85`), `[trigger_name]` with the event (e.g. `Power Connected`), and `[system_date_iso]` with the current ISO-8601 timestamp.

---

## 🔒 Security Architecture

1. **Webhook Protection**:
   - The webhook checks `X-Webhook-Secret` against the server secret before parsing database writes.
   - Rejects payloads with invalid levels outside `0..100`.
2. **Dashboard Privacy**:
   - Protected by `HttpOnly`, `SameSite=Lax` signed JWT session cookies.
   - Passwords stored using 10-round bcrypt salted hashes.
   - All frontend API routes (`/api/battery/*`) require a valid JWT cookie.
3. **Database Concurrency**:
   - SQLite configured with `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL`.
   - Thread-safe and non-blocking under simultaneous MacroDroid webhooks and dashboard reads.

---

## 🛠️ Production Deployment

### Option A: Using PM2
```bash
npm install -g pm2
pm2 start server.js --name "voltwatch"
pm2 save
pm2 startup
```

### Option B: Caddy Reverse Proxy (Recommended for HTTPS)
```caddy
volt.yourdomain.com {
    reverse_proxy localhost:3000
}
```
*(Caddy automatically provisions free Let's Encrypt SSL certificates for MacroDroid HTTPS delivery).*
