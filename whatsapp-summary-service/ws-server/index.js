/**
 * Phase 1: WebSocket server for test communication.
 * - Accepts WS connections, register(device_id, phone_number) → socketsMap / phoneToDevice.
 * - POST /dispatch: lookup by from (phone), send job; on response → log only (no Twilio).
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;

const socketsMap = new Map();   // device_id -> { ws, phone_number }
const phoneToDevice = new Map(); // phone_number -> device_id
const pendingJobs = new Map();   // jobId -> { from }

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/dispatch') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { from, body: msgBody, intent, group_id } = payload;
        if (!from) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "from"' }));
          return;
        }
        const deviceId = phoneToDevice.get(from);
        if (!deviceId) {
          console.log('[dispatch] No Electron for phone:', from);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No Electron for this number' }));
          return;
        }
        const entry = socketsMap.get(deviceId);
        if (!entry || !entry.ws || entry.ws.readyState !== 1) {
          console.log('[dispatch] Socket not connected for device:', deviceId);
          phoneToDevice.delete(from);
          if (entry) socketsMap.delete(deviceId);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Electron disconnected' }));
          return;
        }
        const jobId = require('crypto').randomUUID();
        pendingJobs.set(jobId, { from });
        const job = { type: 'job', jobId, intent: intent || 'question', group_id: group_id || null, body: msgBody || '' };
        entry.ws.send(JSON.stringify(job));
        console.log('[dispatch] Job sent:', jobId, 'to', from);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId, queued: true }));
      } catch (e) {
        console.error('[dispatch] Error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message) }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  let deviceId = null;
  let phoneNumber = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register') {
        deviceId = msg.device_id;
        phoneNumber = msg.phone_number;
        if (!deviceId || !phoneNumber) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing device_id or phone_number' }));
          return;
        }
        if (phoneToDevice.has(phoneNumber) && phoneToDevice.get(phoneNumber) !== deviceId) {
          const oldId = phoneToDevice.get(phoneNumber);
          const old = socketsMap.get(oldId);
          if (old && old.ws) old.ws.close();
          socketsMap.delete(oldId);
        }
        phoneToDevice.set(phoneNumber, deviceId);
        socketsMap.set(deviceId, { ws, phone_number: phoneNumber });
        console.log('[ws] Registered:', deviceId, phoneNumber);
        ws.send(JSON.stringify({ type: 'registered', device_id: deviceId, phone_number: phoneNumber }));
        return;
      }
      if (msg.type === 'response') {
        const { jobId, result, error } = msg;
        const pending = pendingJobs.get(jobId);
        if (!pending) {
          console.log('[ws] Unknown jobId:', jobId);
          return;
        }
        pendingJobs.delete(jobId);
        console.log('[ws] Response for job', jobId, 'from', pending.from, '->', error ? `error: ${error}` : `result: ${result}`);
        return;
      }
    } catch (e) {
      console.error('[ws] Invalid message:', e);
    }
  });

  ws.on('close', () => {
    if (deviceId) {
      socketsMap.delete(deviceId);
      if (phoneNumber) phoneToDevice.delete(phoneNumber);
      console.log('[ws] Disconnected:', deviceId, phoneNumber);
    }
  });

  ws.on('error', () => {
    if (deviceId) {
      socketsMap.delete(deviceId);
      if (phoneNumber) phoneToDevice.delete(phoneNumber);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[ws-server] Listening on ws://localhost:${PORT} (HTTP /dispatch on :${PORT})`);
});
