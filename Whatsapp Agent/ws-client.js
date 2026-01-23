/**
 * Phase 1: Minimal WebSocket bridge client for test communication.
 * Connect to ws-server, register (device_id, phone_number), on job -> reply pong.
 * Add-only: does not modify any existing app logic.
 */

const crypto = require('crypto');
const WebSocket = require('ws');

const WS_URL = process.env.WS_BRIDGE_URL || 'ws://localhost:3001';
const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_INITIAL_MS;

function getOrCreateDeviceId(store) {
  let id = store.get('wsBridge.deviceId');
  if (!id) {
    id = crypto.randomUUID();
    store.set('wsBridge.deviceId', id);
  }
  return id;
}

function getPhoneNumber(store) {
  return store.get('globalSettings.recipientPhoneNumber') || '+1234567890';
}

function connect(store) {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn('[WS Bridge] Connect error:', e.message);
    scheduleReconnect(store);
    return;
  }

  ws.on('open', () => {
    reconnectDelay = RECONNECT_INITIAL_MS;
    const deviceId = getOrCreateDeviceId(store);
    const phoneNumber = getPhoneNumber(store);
    ws.send(JSON.stringify({ type: 'register', device_id: deviceId, phone_number: phoneNumber }));
    console.log('[WS Bridge] Connected, registered as', deviceId, phoneNumber);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'job') {
        const { jobId } = msg;
        ws.send(JSON.stringify({ type: 'response', jobId, result: 'pong' }));
        console.log('[WS Bridge] Job', jobId, '-> pong');
      } else if (msg.type === 'registered') {
        console.log('[WS Bridge] Server confirmed registration');
      } else if (msg.type === 'error') {
        console.warn('[WS Bridge] Server error:', msg.error);
      }
    } catch (e) {
      console.warn('[WS Bridge] Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    ws = null;
    console.log('[WS Bridge] Disconnected, reconnecting in', reconnectDelay, 'ms');
    scheduleReconnect(store);
  });

  ws.on('error', (err) => {
    console.warn('[WS Bridge] Error:', err.message);
  });
}

function scheduleReconnect(store) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    connect(store);
  }, reconnectDelay);
}

function startWsBridge(store) {
  if (!store) return;
  connect(store);
}

module.exports = { startWsBridge };
