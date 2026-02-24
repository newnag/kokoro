# 🖥️ Website Uptime Monitor

ระบบตรวจสอบการออนไลน์ของเว็บไซต์แบบ Real-time พร้อมระบบแจ้งเตือนอัตโนมัติ

![Dashboard Preview](https://img.shields.io/badge/Status-Active-success)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

- 🔄 **Real-time Monitoring** - ตรวจสอบสถานะเว็บไซต์แบบเรียลไทม์ผ่าน WebSocket
- 📊 **Dashboard** - แสดงผลสถานะทุกเว็บไซต์ในหน้าเดียว
- ⏱️ **Customizable Intervals** - กำหนดช่วงเวลาตรวจสอบได้ตามต้องการ
- 🔔 **Multi-channel Alerts** - แจ้งเตือนผ่าน Email, Discord, Slack, Webhook
- 📈 **Statistics & Reports** - ดูสถิติ Uptime และ Response Time
- 🚨 **Incident Tracking** - ติดตามประวัติ Downtime ทั้งหมด
- 💾 **SQLite Database** - เก็บข้อมูลในไฟล์เดียว ไม่ต้องติดตั้ง Database แยก

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit .env with your settings
```

### 3. Run Test Setup (Optional)

```bash
npm test
```

### 4. Start Server

```bash
npm start

# Or with auto-reload during development
npm run dev
```

### 5. Open Dashboard

เปิดเบราว์เซอร์ไปที่ http://localhost:3000

## 📁 Project Structure

```
kokoro/
├── data/                   # SQLite database
├── public/                 # Frontend files
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── config/
│   │   └── database.js     # Database configuration
│   ├── models/
│   │   ├── Website.js      # Website model
│   │   ├── CheckHistory.js # Check history model
│   │   ├── Incident.js     # Incident model
│   │   └── AlertSetting.js # Alert settings model
│   ├── services/
│   │   ├── MonitorService.js      # Core monitoring logic
│   │   └── NotificationService.js # Alert notifications
│   ├── routes/
│   │   └── api.js          # REST API routes
│   └── server.js           # Main server file
├── .env.example
├── package.json
└── README.md
```

## 📡 API Endpoints

### Websites

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/websites` | Get all websites with status |
| GET | `/api/websites/:id` | Get single website |
| POST | `/api/websites` | Add new website |
| PUT | `/api/websites/:id` | Update website |
| DELETE | `/api/websites/:id` | Delete website |
| POST | `/api/websites/:id/check` | Manual check |

### Statistics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/websites/:id/history` | Get check history |
| GET | `/api/websites/:id/stats` | Get uptime statistics |
| GET | `/api/websites/:id/incidents` | Get incidents |

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | Get all alert settings |
| POST | `/api/alerts` | Create alert setting |
| PUT | `/api/alerts/:id` | Update alert setting |
| DELETE | `/api/alerts/:id` | Delete alert setting |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Get dashboard stats |
| GET | `/api/incidents` | Get all incidents |

## 🔔 Alert Configuration

### Email Alert

```json
{
  "alert_type": "email",
  "config": {
    "recipients": ["admin@example.com", "dev@example.com"]
  }
}
```

### Discord Webhook

```json
{
  "alert_type": "discord",
  "config": {
    "webhook_url": "https://discord.com/api/webhooks/xxx/xxx"
  }
}
```

### Slack Webhook

```json
{
  "alert_type": "slack",
  "config": {
    "webhook_url": "https://hooks.slack.com/services/xxx/xxx/xxx"
  }
}
```

### Custom Webhook

```json
{
  "alert_type": "webhook",
  "config": {
    "webhook_url": "https://your-api.com/webhook",
    "headers": {
      "Authorization": "Bearer token"
    }
  }
}
```

## 🌐 WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `check-website` | `websiteId` | Request immediate check |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `initial-status` | `Website[]` | Initial status on connect |
| `status-update` | `StatusUpdate` | Real-time status update |

## 📊 Status Update Payload

```typescript
interface StatusUpdate {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline';
  status_code: number | null;
  response_time: number | null;
  error_message: string | null;
  checked_at: string;
}
```

## ⚙️ Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HOST` | Server host | `localhost` |
| `SMTP_HOST` | SMTP server | - |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASS` | SMTP password | - |
| `SMTP_FROM` | Email sender | - |
| `DISCORD_WEBHOOK_URL` | Discord webhook | - |
| `SLACK_WEBHOOK_URL` | Slack webhook | - |
| `DEFAULT_CHECK_INTERVAL` | Default interval (ms) | `30000` |
| `REQUEST_TIMEOUT` | HTTP timeout (ms) | `10000` |

## 🔧 Advanced Configuration

### Custom Expected Status Code

```json
{
  "name": "API Endpoint",
  "url": "https://api.example.com/health",
  "expected_status": 200,
  "check_interval": 15000,
  "timeout": 5000
}
```

### Maintenance Cleanup

```bash
# Clean up history older than 30 days
curl -X POST http://localhost:3000/api/maintenance/cleanup \
  -H "Content-Type: application/json" \
  -d '{"days": 30}'
```

## 📝 License

MIT License - Feel free to use and modify!

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.
