# Panic Button SIP Platform

Multi-tenant emergency communication system built on Asterisk 20 + Node.js.

## Features
- SIP panic button device management
- Browser-based operator dashboard with WebRTC audio/video
- Multi-tenant site isolation with per-site API keys
- REST API for integration with external platforms
- Real-time device online/offline status
- Call history per site
- Multi-operator simultaneous ring
- Audible alarm on incoming panic call

## Stack
- Asterisk 20.19.0 (SIP/WebRTC/PJSIP)
- Node.js + Express (REST API)
- MySQL (realtime endpoint storage)
- Nginx (TLS termination + WebSocket proxy)
- JsSIP 3.10.0 (browser SIP/WebRTC client)

## Requirements
- Ubuntu 22.04
- Asterisk 20.x compiled with res_config_mysql
- MySQL 8.x
- Node.js 18.x
- Nginx

## Setup
1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your values
3. Run `npm install`
4. Configure Asterisk realtime (see documentation)
5. Start API: `node server.js`

## API Endpoints
- `GET /api/sites` - List all sites
- `POST /api/sites` - Create site
- `GET /api/sites/:id/devices` - List devices
- `POST /api/sites/:id/devices` - Add device
- `GET /api/sites/:id/operators` - List operators
- `POST /api/sites/:id/operators` - Add operator
- `GET /api/sites/:id/status` - Device online/offline status
- `GET /api/sites/:id/calls` - Call history

## Author
Haziq Zabridin — Loranet Technologies
