require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// ── Auth middleware ──────────────────────────────────────────────
// Master key = full access
// Site key   = scoped to that site only
async function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing API key' });

  // Master key
  if (key === process.env.API_KEY) {
    req.role = 'supervisor';
    req.siteId = null;
    return next();
  }

  // Site key
  try {
    const [rows] = await pool.query('SELECT * FROM sites WHERE api_key = ?', [key]);
    if (rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
    req.role = 'site';
    req.siteId = rows[0].id;
    req.site = rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── AMI helper ───────────────────────────────────────────────────
function amiCommand(host, port, user, pass, command) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responded = false;
    client.connect(port, host, () => {
      client.write(`Action: Login\r\nUsername: ${user}\r\nSecret: ${pass}\r\n\r\n`);
      client.write(`Action: Command\r\nCommand: ${command}\r\n\r\n`);
      setTimeout(() => {
        if (!responded) { responded = true; client.destroy(); resolve(true); }
      }, 1500);
    });
    client.on('error', () => resolve(false));
  });
}

// ── Dialplan helper ──────────────────────────────────────────────
async function addDialplanEntry(siteContext, deviceId, siteId, location) {
  const label = location ? `PANIC: ${location}` : `PANIC: Device ${deviceId}`;
  
  // Get ALL operators for this site
  const [operators] = await pool.query('SELECT sip_id FROM site_operators WHERE site_id = ?', [siteId]);
  
  let dialString;
  if (operators.length === 0) {
    dialString = 'PJSIP/operator'; // fallback
  } else if (operators.length === 1) {
    dialString = `PJSIP/${operators[0].sip_id}`;
  } else {
    // Ring all operators simultaneously
    dialString = operators.map(o => `PJSIP/${o.sip_id}`).join('&');
  }

  const entry = `\n; Device ${deviceId} - ${label} [${siteContext}]\nexten => ${deviceId},1,NoOp(Panic from ${deviceId})\n same => n,Set(CALLERID(name)=${label})\n same => n,Dial(${dialString},30,rT)\n same => n,Hangup()\n`;
  fs.appendFileSync('/etc/asterisk/extensions.conf', entry);
}

// ══════════════════════════════════════════════════════════════════
// SITES
// ══════════════════════════════════════════════════════════════════

// GET /api/sites
app.get('/api/sites', authMiddleware, async (req, res) => {
  try {
    if (req.role !== 'supervisor') {
      const [rows] = await pool.query('SELECT id, name, server_type, context_name, created_at FROM sites WHERE id = ?', [req.siteId]);
      return res.json({ sites: rows });
    }
    const [rows] = await pool.query('SELECT id, name, server_type, context_name, created_at FROM sites');
    res.json({ sites: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites
app.post('/api/sites', authMiddleware, async (req, res) => {
  if (req.role !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });

  const { name, server_type = 'shared', asterisk_host = '127.0.0.1', asterisk_ami_port = 5038, asterisk_ami_user = process.env.AMI_USER || 'admin', asterisk_ami_pass = process.env.AMI_PASS || 'admin123' } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = 'site_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const api_key = crypto.randomBytes(24).toString('hex');
  const context_name = 'panic_' + id;

  try {
    await pool.query(
      'INSERT INTO sites (id, name, api_key, server_type, asterisk_host, asterisk_ami_port, asterisk_ami_user, asterisk_ami_pass, context_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, api_key, server_type, asterisk_host, asterisk_ami_port, asterisk_ami_user, asterisk_ami_pass, context_name]
    );

    // Add dialplan context for this site
    fs.appendFileSync('/etc/asterisk/extensions.conf', `\n[${context_name}]\n; Auto-generated context for ${name}\n`);
    await amiCommand(asterisk_host, asterisk_ami_port, asterisk_ami_user, asterisk_ami_pass, 'dialplan reload');

    res.json({ success: true, site: { id, name, api_key, context_name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Site already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:siteId
app.delete('/api/sites/:siteId', authMiddleware, async (req, res) => {
  if (req.role !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });
  try {
    await pool.query('DELETE FROM sites WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// OPERATORS
// ══════════════════════════════════════════════════════════════════

// GET /api/sites/:siteId/operators
app.get('/api/sites/:siteId/operators', authMiddleware, async (req, res) => {
  const { siteId } = req.params;
  if (req.role === 'site' && req.siteId !== siteId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const [rows] = await pool.query('SELECT o.*, a.username, a.password FROM site_operators o JOIN ps_auths a ON o.sip_id = a.username WHERE o.site_id = ?', [siteId]);
    res.json({ operators: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:siteId/operators
app.post('/api/sites/:siteId/operators', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });

  const { siteId } = req.params;
  const { sip_id, password, display_name } = req.body;
  if (!sip_id || !password) return res.status(400).json({ error: 'sip_id and password required' });

  const [sites] = await pool.query('SELECT * FROM sites WHERE id = ?', [siteId]);
  if (sites.length === 0) return res.status(404).json({ error: 'Site not found' });
  const site = sites[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('INSERT INTO ps_auths (id, auth_type, username, password) VALUES (?, "userpass", ?, ?)',
      [`${sip_id}-auth`, sip_id, password]);

    await conn.query('INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency) VALUES (?, 5, "no", 30)', [sip_id]);

    await conn.query('INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media, ice_support, webrtc) VALUES (?, "transport-wss", ?, ?, ?, "all", "opus,ulaw,alaw,h264,vp8", "no", "yes", "yes")',
      [sip_id, sip_id, `${sip_id}-auth`, site.context_name]);

    await conn.query('INSERT INTO site_operators (id, site_id, sip_id, display_name) VALUES (?, ?, ?, ?)',
      [`op_${sip_id}`, siteId, sip_id, display_name || sip_id]);

    await conn.commit();

    const [allOps] = await pool.query('SELECT sip_id FROM site_operators WHERE site_id = ?', [siteId]);
    const dialString = allOps.map(o => `PJSIP/${o.sip_id}`).join('&');

    // Update 9999 extension for this site
    update9999Extension(site.context_name, site.name, dialString);
    await amiCommand(site.asterisk_host, site.asterisk_ami_port, site.asterisk_ami_user, site.asterisk_ami_pass, 'dialplan reload');
    res.json({ success: true, operator: { sip_id, display_name, site_id: siteId } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `Operator ${sip_id} already exists` });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/sites/:siteId/operators/:sipId
app.delete('/api/sites/:siteId/operators/:sipId', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });
  const { sipId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ps_endpoints WHERE id = ?', [sipId]);
    await conn.query('DELETE FROM ps_auths WHERE id = ?', [`${sipId}-auth`]);
    await conn.query('DELETE FROM ps_aors WHERE id = ?', [sipId]);
    await conn.query('DELETE FROM site_operators WHERE sip_id = ?', [sipId]);
    await conn.commit();

    // Rebuild dial string with remaining operators
  const [remainingOps] = await pool.query('SELECT sip_id FROM site_operators WHERE site_id = ?', [req.params.siteId]);
  if (remainingOps.length > 0) {
    const [siteRow] = await pool.query('SELECT * FROM sites WHERE id = ?', [req.params.siteId]);
    if (siteRow.length > 0) {
      const dialString = remainingOps.map(o => `PJSIP/${o.sip_id}`).join('&');
      update9999Extension(siteRow[0].context_name, siteRow[0].name, dialString);
      await amiCommand(siteRow[0].asterisk_host, siteRow[0].asterisk_ami_port, siteRow[0].asterisk_ami_user, siteRow[0].asterisk_ami_pass, 'dialplan reload');
    }
  }
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ══════════════════════════════════════════════════════════════════
// DEVICES
// ══════════════════════════════════════════════════════════════════

// GET /api/sites/:siteId/devices
app.get('/api/sites/:siteId/devices', authMiddleware, async (req, res) => {
  const { siteId } = req.params;
  if (req.role === 'site' && req.siteId !== siteId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const [rows] = await pool.query('SELECT d.*, e.allow FROM site_devices d JOIN ps_endpoints e ON d.sip_id = e.id WHERE d.site_id = ?', [siteId]);
    res.json({ devices: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devices (backward compat - supervisor sees all)
app.get('/api/devices', authMiddleware, async (req, res) => {
  try {
    if (req.role === 'site') {
      const [rows] = await pool.query('SELECT d.*, e.allow FROM site_devices d JOIN ps_endpoints e ON d.sip_id = e.id WHERE d.site_id = ?', [req.siteId]);
      return res.json({ devices: rows });
    }
    const [rows] = await pool.query('SELECT d.*, e.allow, e.context FROM site_devices d JOIN ps_endpoints e ON d.sip_id = e.id');
    res.json({ devices: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:siteId/devices
app.post('/api/sites/:siteId/devices', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });

  const { siteId } = req.params;
  const { id, password, location } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'id and password required' });
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Device ID must be numeric' });

  const [sites] = await pool.query('SELECT * FROM sites WHERE id = ?', [siteId]);
  if (sites.length === 0) return res.status(404).json({ error: 'Site not found' });
  const site = sites[0];

  // Get first operator for this site to route calls to
  const [operators] = await pool.query('SELECT sip_id FROM site_operators WHERE site_id = ? LIMIT 1', [siteId]);
  const operatorSipId = operators.length > 0 ? operators[0].sip_id : 'operator';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('INSERT INTO ps_auths (id, auth_type, username, password) VALUES (?, "userpass", ?, ?)',
      [`${id}-auth`, id, password]);

    await conn.query('INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency) VALUES (?, 1, "yes", 30)', [id]);

    await conn.query('INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media, force_rport, rewrite_contact, rtp_symmetric, identify_by) VALUES (?, "transport-udp", ?, ?, ?, "all", "ulaw,alaw,opus,h264,vp8", "no", "yes", "yes", "yes", "username")',
      [id, id, `${id}-auth`, site.context_name]);

    await conn.query('INSERT INTO site_devices (id, site_id, sip_id, location) VALUES (?, ?, ?, ?)',
      [`dev_${id}`, siteId, id, location || null]);

    await conn.commit();

    // Add dialplan and reload
    addDialplanEntry(site.context_name, id, siteId, location);
    await amiCommand(site.asterisk_host, site.asterisk_ami_port, site.asterisk_ami_user, site.asterisk_ami_pass, 'dialplan reload');

    res.json({ success: true, device: { id, location, site_id: siteId } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `Device ${id} already exists` });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/devices (backward compat)
app.post('/api/devices', authMiddleware, async (req, res) => {
  const siteId = req.siteId || 'site_default';
  req.params = { siteId };
  // Forward to site devices handler
  const { id, password, location } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'id and password required' });
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Device ID must be numeric (e.g. 1001, 1002)' });

  const [sites] = await pool.query('SELECT * FROM sites WHERE id = ?', [siteId]);
  if (sites.length === 0) return res.status(404).json({ error: 'Site not found' });
  const site = sites[0];

  const [operators] = await pool.query('SELECT sip_id FROM site_operators WHERE site_id = ? LIMIT 1', [siteId]);
  const operatorSipId = operators.length > 0 ? operators[0].sip_id : 'operator';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO ps_auths (id, auth_type, username, password) VALUES (?, "userpass", ?, ?)', [`${id}-auth`, id, password]);
    await conn.query('INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency) VALUES (?, 1, "yes", 30)', [id]);
    await conn.query('INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media, force_rport, rewrite_contact, rtp_symmetric, identify_by) VALUES (?, "transport-udp", ?, ?, ?, "all", "ulaw,alaw,opus,h264,vp8", "no", "yes", "yes", "yes", "username")',
      [id, id, `${id}-auth`, site.context_name]);
    await conn.query('INSERT INTO site_devices (id, site_id, sip_id, location) VALUES (?, ?, ?, ?)', [`dev_${id}`, siteId, id, location || null]);
    await conn.commit();
    addDialplanEntry(site.context_name, id, siteId, location);
    await amiCommand(site.asterisk_host, site.asterisk_ami_port, site.asterisk_ami_user, site.asterisk_ami_pass, 'dialplan reload');
    res.json({ success: true, message: `Device ${id} added successfully`, device: { id, password, location } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `Device ${id} already exists` });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/sites/:siteId/devices/:deviceId
app.delete('/api/sites/:siteId/devices/:deviceId', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });
  const { deviceId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ps_endpoints WHERE id = ?', [deviceId]);
    await conn.query('DELETE FROM ps_auths WHERE id = ?', [`${deviceId}-auth`]);
    await conn.query('DELETE FROM ps_aors WHERE id = ?', [deviceId]);
    await conn.query('DELETE FROM site_devices WHERE sip_id = ?', [deviceId]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/devices/:id (backward compat)
app.delete('/api/devices/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ps_endpoints WHERE id = ?', [id]);
    await conn.query('DELETE FROM ps_auths WHERE id = ?', [`${id}-auth`]);
    await conn.query('DELETE FROM ps_aors WHERE id = ?', [id]);
    await conn.query('DELETE FROM site_devices WHERE sip_id = ?', [id]);
    await conn.commit();
    res.json({ success: true, message: `Device ${id} removed` });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ══════════════════════════════════════════════════════════════════
// CALL LOGS
// ══════════════════════════════════════════════════════════════════

app.get('/api/calls', authMiddleware, async (req, res) => {
  try {
    if (req.role === 'site') {
      const [rows] = await pool.query('SELECT * FROM call_logs WHERE site_id = ? ORDER BY started_at DESC LIMIT 100', [req.siteId]);
      return res.json({ calls: rows });
    }
    const [rows] = await pool.query('SELECT * FROM call_logs ORDER BY started_at DESC LIMIT 100');
    res.json({ calls: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// SITES LIST (for main dashboard)
// ══════════════════════════════════════════════════════════════════

app.get('/api/status', authMiddleware, async (req, res) => {
  try {
    const [sites] = await pool.query('SELECT COUNT(*) as total FROM sites');
    const [devices] = await pool.query('SELECT COUNT(*) as total FROM site_devices');
    const [operators] = await pool.query('SELECT COUNT(*) as total FROM site_operators');
    const [calls] = await pool.query('SELECT COUNT(*) as total FROM call_logs WHERE DATE(started_at) = CURDATE()');
    res.json({
      sites: sites[0].total,
      devices: devices[0].total,
      operators: operators[0].total,
      calls_today: calls[0].total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AMI Event Listener for call logging ─────────────────────────
const ami = new net.Socket();
let amiBuffer = '';
let amiConnected = false;

function connectAMI() {
  ami.connect(5038, '127.0.0.1', () => {
    ami.write(`Action: Login\r\nUsername: ${process.env.AMI_USER || 'admin'}\r\nSecret: ${process.env.AMI_PASS || 'admin123'}\r\n\r\n');
    ami.write('Action: Events\r\nEventMask: call\r\n\r\n');
    amiConnected = true;
    console.log('AMI connected for call logging');
  });
}

ami.on('data', (data) => {
  amiBuffer += data.toString();
  const events = amiBuffer.split('\r\n\r\n');
  amiBuffer = events.pop();

  events.forEach(async (raw) => {
    const lines = raw.trim().split('\r\n');
    const evt = {};
    lines.forEach(l => {
      const idx = l.indexOf(':');
      if (idx > 0) evt[l.slice(0,idx).trim()] = l.slice(idx+1).trim();
    });

    // Call started
    if (evt.Event === 'Hangup' && evt.Context && evt.Context.startsWith('panic')) {
      try {
        const deviceId = evt.CallerIDNum || 'unknown';
        const duration = parseInt(evt.Duration || 0);
        const hasVideo = 0;
        const status = duration > 0 ? 'answered' : 'missed';

        // Find site by context
        const [sites] = await pool.query('SELECT id FROM sites WHERE context_name = ?', [evt.Context]);
        const siteId = sites.length > 0 ? sites[0].id : 'site_default';

        await pool.query(
          'INSERT INTO call_logs (site_id, device_id, started_at, duration, status) VALUES (?, ?, NOW() - INTERVAL ? SECOND, ?, ?)',
          [siteId, deviceId, duration, duration, status]
        );
        console.log('Call logged:', deviceId, status, duration+'s');
      } catch(err) {
        console.error('Call log error:', err.message);
      }
    }
  });
});

ami.on('error', () => { amiConnected = false; setTimeout(connectAMI, 5000); });
ami.on('close', () => { amiConnected = false; setTimeout(connectAMI, 5000); });
connectAMI();

// ── Device status ────────────────────────────────────────────────
app.get('/api/sites/:siteId/status', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const [devices] = await pool.query(
        `SELECT d.sip_id, d.location,
          (SELECT COUNT(*) FROM ps_contacts c
           WHERE c.id LIKE CONCAT(d.sip_id, '%')
           AND c.expiration_time > UNIX_TIMESTAMP()) as is_online,
          (SELECT c.expiration_time FROM ps_contacts c
           WHERE c.id LIKE CONCAT(d.sip_id, '%')
           AND c.expiration_time > UNIX_TIMESTAMP() LIMIT 1) as expiration_time
        FROM site_devices d WHERE d.site_id = ?`,
       [req.params.siteId]
    );
    const result = devices.map(d => ({
      sip_id: d.sip_id,
      location: d.location,
      online: d.is_online > 0,
      expires: d.expiration_time
    }));   
    res.json({ devices: result });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Call history ─────────────────────────────────────────────────
app.get('/api/sites/:siteId/calls', authMiddleware, async (req, res) => {
  if (req.role === 'site' && req.siteId !== req.params.siteId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const [rows] = await pool.query(
      'SELECT * FROM call_logs WHERE site_id = ? ORDER BY started_at DESC LIMIT 50',
      [req.params.siteId]
    );
    res.json({ calls: rows });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Panic Button API running on port ${process.env.PORT}`);
});

function update9999Extension(contextName, siteName, dialString) {
  const extFile = '/etc/asterisk/extensions.conf';
  let content = fs.readFileSync(extFile, 'utf8');

  const newExtension = `exten => 9999,1,NoOp(Panic call in ${siteName})\n same => n,Set(CALLERID(name)=PANIC: \${CALLERID(num)})\n same => n,Dial(${dialString},30,rT)\n same => n,Hangup()`;

  // Check if 9999 already exists in this context
  const contextPattern = new RegExp(`(\\[${contextName}\\][^\\[]*?)exten => 9999,[^\\n]*\\n( same => [^\\n]*\\n)* same => n,Hangup\\(\\)`, 's');

  if (contextPattern.test(content)) {
    // Update existing 9999
    content = content.replace(contextPattern, `$1${newExtension}`);
  } else {
    // Add 9999 to context
    const contextHeader = `[${contextName}]`;
    content = content.replace(contextHeader, `${contextHeader}\n${newExtension}`);
  }

  fs.writeFileSync(extFile, content);
}


