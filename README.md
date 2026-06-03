# 🚨 Panic Button SIP Platform

> Multi-tenant emergency communication system built on Asterisk 20 + Node.js + WebRTC

**Author:** Haziq Zabridin  
**Version:** 1.0  
**Status:** Active Development  
**License:** MIT

---

## Overview

The Panic Button SIP Platform is a production-ready emergency communication system that allows onsite panic button devices to instantly reach operators via a browser-based dashboard. When a panic button is pressed, the system initiates a SIP voice call and optionally a live video stream to one or more operators monitoring the dashboard in real time.

## Key Features

- One-press panic alert with audible alarm and visual alert on operator dashboard
- Live video feed — automatic video stream when caller supports it
- Multi-tenant — isolated sites, each with their own devices, operators and API key
- Browser-based operator — no app install, works on any modern browser
- API-driven management — add/remove devices and operators via REST API
- Real-time device online/offline status monitoring
- Call history per site with duration and status
- Multi-operator simultaneous ring
- Direct device-to-device calling
- IP Speaker HTTP API trigger for siren

---

## Stack

| Layer | Technology |
|---|---|
| PBX / SIP | Asterisk 20.19.0 (PJSIP, WebRTC) |
| Backend API | Node.js 18 + Express |
| Database | MySQL 8.x (Asterisk realtime) |
| Reverse Proxy | Nginx (TLS + WebSocket proxy) |
| Browser SIP | JsSIP 3.10.0 |
| OS | Ubuntu 22.04 LTS |

---

## Architecture
Panic Button Device
| SIP UDP 5060
v
Asterisk PBX
| Reads endpoints from MySQL realtime
| Routes call to site operator context
| Bridges audio + video
v
Nginx (TLS termination)
| WSS /ws -> Asterisk port 8088
| HTTPS /api -> Node.js port 3000
| HTTPS / -> Dashboard HTML
v
Operator Browser Dashboard
WebRTC audio + video
Panic alert + audible alarm

---

## Quick Start

### Requirements

- Ubuntu 22.04 LTS
- Asterisk 20.x compiled with res_config_mysql, res_srtp, codec_opus
- MySQL 8.x
- Node.js 18.x
- Nginx
- Domain with TLS certificate (Let's Encrypt recommended)

### 1. Clone the repo

```bash
git clone https://github.com/hzqzbrdn/panicbutton-platform.git
cd panicbutton-platform
```

### 2. Set up environment

```bash
cp .env.example .env
nano .env
```

### 3. Install API dependencies

```bash
npm install
```

### 4. Set up MySQL database

```bash
bash scripts/setup-database.sh
```

### 5. Configure Asterisk

```bash
sudo cp asterisk-config/* /etc/asterisk/
# Edit each file — replace YOUR_* placeholders with real values
```

### 6. Configure Nginx

```bash
sudo cp nginx-config/panicbutton /etc/nginx/sites-available/panicbutton
sudo ln -s /etc/nginx/sites-available/panicbutton /etc/nginx/sites-enabled/
# Edit — replace YOUR_* placeholders with your domain and cert paths
sudo nginx -t && sudo systemctl restart nginx
```

### 7. Install systemd services

```bash
sudo cp systemd-config/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable asterisk panicbutton-api
sudo systemctl start asterisk panicbutton-api
```

### 8. Build and deploy dashboard

```bash
# Build JsSIP
npm install jssip@3.10.0
cd node_modules/jssip && npm run build && cd ../..

sudo mkdir -p /var/www/panicbutton
sudo cp index.html /var/www/panicbutton/
sudo cp node_modules/jssip/dist/jssip.min.js /var/www/panicbutton/sip.min.js
```

### 9. Set up firewall

```bash
bash scripts/setup-ufw.sh
```

---

## API Reference

All requests require `x-api-key` header.

| Key Type | Access |
|---|---|
| Master key | Full access — all sites |
| Site API key | Scoped to own site only |

### Sites
GET    /api/sites
POST   /api/sites
DELETE /api/sites/:siteId

### Operators
GET    /api/sites/:siteId/operators
POST   /api/sites/:siteId/operators
DELETE /api/sites/:siteId/operators/:sipId

### Devices
GET    /api/sites/:siteId/devices
POST   /api/sites/:siteId/devices
DELETE /api/sites/:siteId/devices/:id

### Monitoring
GET    /api/sites/:siteId/status
GET    /api/sites/:siteId/calls
GET    /api/status

### IP Speaker Alert
POST   /api/sites/:siteId/alert
POST   /api/sites/:siteId/alert/stop

---

## Multi-Tenant Onboarding

```bash
# 1. Create site
POST /api/sites
{ "name": "Client A", "server_type": "shared" }

# 2. Add operator
POST /api/sites/site_client_a/operators
{ "sip_id": "op_clienta", "password": "Pass!", "display_name": "Operator" }

# 3. Add devices
POST /api/sites/site_client_a/devices
{ "id": "1001", "password": "Pass!", "location": "Reception" }

# 4. Give operator dashboard URL + SIP credentials
# 5. Configure device with server IP + SIP credentials
# 6. Test: press button, verify operator receives call
```

---

## Dialplan Structure

Each site gets its own isolated Asterisk context:
[panic_site_clienta]
exten => 9999   -> rings all site operators simultaneously
exten => 1001   -> panic from device 1001 to operators
exten => 8001   -> direct dial to device 1001
exten => 8002   -> direct dial to device 1002

**Dial rules:**
- `9999` — panic to all operators
- Device number (e.g. `1001`) — panic to operators
- `8XXX` — direct device-to-device call

---

## Supported Devices

| Device | Video | Transport | Notes |
|---|---|---|---|
| J&R JR_337__OneKey | No | UDP | Numeric extensions only |
| PortSIP UC Client iOS | Yes (H264/VP8) | UDP | Tested on 4G |
| IP Speaker (TSIP) | No | UDP | HTTP siren trigger supported |
| Any SIP phone | Depends | UDP/TLS | Must support PCMA/PCMU |

---

## File Structure
.
├── server.js                     # Node.js REST API
├── index.html                    # Operator dashboard (WebRTC)
├── package.json
├── .env.example                  # Environment variable template
├── asterisk-config/
│   ├── pjsip.conf                # SIP transports
│   ├── extensions.conf           # Dialplan
│   ├── extconfig.conf            # MySQL realtime mapping
│   ├── sorcery.conf              # Sorcery config
│   ├── res_config_mysql.conf     # MySQL connection
│   ├── manager.conf              # AMI config
│   ├── http.conf                 # Asterisk HTTP
│   └── modules.conf              # Module config
├── nginx-config/
│   └── panicbutton               # Nginx virtual host
├── systemd-config/
│   ├── asterisk.service
│   └── panicbutton-api.service
├── database-schema/
│   └── schema.sql                # MySQL table definitions
├── scripts/
│   ├── install.sh                # Full installation script
│   ├── setup-database.sh         # Database setup
│   └── setup-ufw.sh              # Firewall setup
├── security-config/
│   └── jail.local                # Fail2ban config
└── docs/
├── DEVICE-SETUP.md           # Device configuration guide
└── API-INTEGRATION.md        # API integration examples

---

## Environment Variables

| Variable | Description |
|---|---|
| DB_HOST | MySQL host |
| DB_USER | MySQL username |
| DB_PASS | MySQL password |
| DB_NAME | Database name |
| PORT | API port (default 3000) |
| API_KEY | Master API key |
| AMI_USER | Asterisk AMI username |
| AMI_PASS | Asterisk AMI password |

---

## Roadmap

- [x] SIP registration and call routing
- [x] WebRTC audio and video in browser
- [x] Multi-tenant site isolation
- [x] REST API for device/operator management
- [x] Real-time device status monitoring
- [x] Call history per site
- [x] Multi-operator simultaneous ring
- [x] Audible alarm on incoming call
- [x] IP Speaker HTTP API trigger
- [x] Direct device-to-device calling
- [ ] Dashboard login authentication (JWT)
- [ ] Call recording (MixMonitor)
- [ ] AMI call logging
- [ ] Push notifications for operators
- [ ] RTSP camera integration
- [ ] Mobile operator app
- [ ] High availability / failover

---

## Author

**Haziq Zabridin**  
May 2026
