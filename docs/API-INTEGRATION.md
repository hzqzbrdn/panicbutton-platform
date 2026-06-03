# API Integration Guide

## Authentication

All requests require `x-api-key` header.

```javascript
const headers = {
  'x-api-key': 'your_api_key',
  'Content-Type': 'application/json'
};
```

## Onboard New Client

```javascript
// 1. Create site
const site = await fetch('/api/sites', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'Client A', server_type: 'shared' })
}).then(r => r.json());

// Save site.api_key for the client

// 2. Add operator
await fetch(`/api/sites/${site.id}/operators`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sip_id: 'op_clienta',
    password: 'SecurePass!',
    display_name: 'Client A Operator'
  })
});

// 3. Add device
await fetch(`/api/sites/${site.id}/devices`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    id: '1001',
    password: 'DevicePass!',
    location: 'Reception'
  })
});
```

## Check Device Status

```javascript
const status = await fetch(`/api/sites/${siteId}/status`, {
  headers: { 'x-api-key': siteApiKey }
}).then(r => r.json());

status.devices.forEach(d => {
  console.log(`${d.sip_id} (${d.location}): ${d.online ? 'Online' : 'Offline'}`);
});
```

## Get Call History

```javascript
const calls = await fetch(`/api/sites/${siteId}/calls`, {
  headers: { 'x-api-key': siteApiKey }
}).then(r => r.json());
```
