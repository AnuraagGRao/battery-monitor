# ⚡ VoltWatch — Android Battery Telemetry & Charging Health Dashboard

A self-hosted, private web console designed to monitor Android device battery health, discharge curves, and charging habits using MacroDroid webhooks.

Built with **Node.js, Express, SQLite (WAL mode), Tailwind CSS, and Chart.js**.

---

## 🌟 Key Features

- **Google Sign-In with Firebase**: One-click authentication using Google accounts via Firebase Auth alongside classic administrator credentials.
- **Strict Per-User Privacy & Data Isolation**:
  - Every registered or Google-authenticated user receives a **dedicated, rotatable webhook secret key** (`vw_sec_...`).
  - Battery metrics, 24-hour discharge curves, cycle wear, and activity logs are strictly isolated by `user_id`.
  - User A can never inspect or alter User B's battery telemetry.
- **Android Automation & MacroDroid Relay (`POST` & `GET` `/api/webhook/battery`)**:
  - Full support for **Automation by Jens Schröder** (open-source on F-Droid) and **MacroDroid**.
  - Simple GET URLs require zero custom header configuration on Android.
- **Hero Battery Metric**: Prominent battery level with Apple-style fluid fill and color coding:
  - 🟢 **Green (> 50%)**: Healthy operating band
  - 🟡 **Yellow (20% – 50%)**: Medium discharge
  - 🔴 **Red (< 20%)**: Critical low charge warning
  - ⚡ **Charging Mode**: Pulsing live indicator when power is connected
- **24-Hour Battery Curve**: Smooth spline line graph (Chart.js) plotting voltage drops and recharge slopes over time. Includes range toggles (6H, 12H, 24H, 3D, 7D).
- **Daily Charge Cycle Calculator**: Computes cumulative lithium charge cycles today ($`\Sigma \Delta^+ / 100`$).
- **Live Activity Feed**: Scrollable timeline of distinct battery events with timestamps and contextual icons.
- **Secret Key Rotation**: In-dashboard 1-click secret key rotation with instant URL regeneration.
- **In-Browser Webhook Simulator**: Built-in testing modal to fire simulated phone events directly into the user's private account.

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

## 📲 Android Automation Setup

VoltWatch supports both open-source automation apps and MacroDroid. You can transmit telemetry via JSON POST or a simple GET URL.

---

### Option A: Automation by Jens Schröder (Open Source / F-Droid)

[**Automation** (F-Droid package `com.jens.automation2`)](https://f-droid.org/packages/com.jens.automation2/) is an open-source, privacy-focused automation app for Android.

#### 1. Setup Rule & Triggers
Create a new Rule in Automation:
- **Triggers**:
  - **Battery Level**: Set trigger for percentage change or threshold transitions (e.g. `<= 20%`, `>= 80%`, `100%`).
  - **Charging State**: Trigger on **Charger Connected** and **Charger Disconnected** (AC / USB / Wireless).

#### 2. Action (HTTP Request)
Add an **HTTP Request** action. You can use either method:

##### Method 1: Simple GET Request (Easiest — Zero Custom Headers Needed)
- **Method**: `GET`
- **URL**:
  ```text
  https://your-domain.com/api/webhook/battery?secret=macrodroid_battery_secret_2026&level={battery_level}&event=charger_connected
  ```
  *(VoltWatch automatically extracts the secret query parameter, maps `level` to the battery reading, and parses the event).*

##### Method 2: POST Request (JSON)
- **Method**: `POST`
- **URL**: `https://your-domain.com/api/webhook/battery`
- **Headers**:
  - `Content-Type`: `application/json`
  - `X-Webhook-Secret`: `macrodroid_battery_secret_2026`
- **Payload**:
  ```json
  {
    "battery_level": {battery_level},
    "event": "{event}",
    "time": "{now_iso}"
  }
  ```

---

### Option B: MacroDroid

In the MacroDroid app on your Android phone, create a new Macro:

#### 1. Triggers
Add the following triggers:
- **Battery / Power** ➔ **Battery Level Changed** ➔ Select *Any change* (or *Increases/Decreases by 5%*)
- **Battery / Power** ➔ **Power Connected**
- **Battery / Power** ➔ **Power Disconnected**

#### 2. Action (HTTP Request)
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

> **Note:** MacroDroid automatically substitutes `[battery]` with the integer percentage (e.g. `85`), `[trigger_name]` with the event (e.g. `Power Connected`), and `[system_date_iso]` with the ISO-8601 timestamp.

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

### Option A: Render (Zero Configuration · Free Cloud Hosting)

VoltWatch includes a native `render.yaml` Blueprint file for automatic deployment to [Render](https://render.com):

1. Go to your **[Render Dashboard](https://dashboard.render.com)**.
2. Click **New +** ➔ **Blueprint**.
3. Connect your GitHub repository: `AnuraagGRao/battery-monitor`.
4. Render will automatically detect `render.yaml`, configure the Node service, inject your Firebase keys, and deploy.
5. Your public HTTPS webhook URL will be:
   ```text
   https://voltwatch-battery-monitor.onrender.com/api/webhook/battery
   ```

*(Optional: In your GitHub repo Settings ➔ Secrets, add `RENDER_DEPLOY_HOOK_URL` to trigger automatic redeploys on every commit).*

---

### Option B: Docker Container
```bash
docker build -t voltwatch .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data voltwatch
```

---

### Option C: Using PM2 (Self-Hosted VPS / Raspberry Pi)
```bash
npm install -g pm2
pm2 start server.js --name "voltwatch"
pm2 save
pm2 startup
```

### Option D: Caddy Reverse Proxy (Recommended for VPS HTTPS)
```caddy
volt.yourdomain.com {
    reverse_proxy localhost:3000
}
```
*(Caddy automatically provisions free Let's Encrypt SSL certificates for Android HTTPS delivery).*
