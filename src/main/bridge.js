'use strict';

// Local WebSocket server the browser extension connects to.
// Only accepts connections from browser extensions (or local tools without an Origin),
// never from regular websites.

const http = require('http');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');

const STALE_AFTER = 3 * 60 * 1000; // background tabs report at least once a minute

const isExtensionOrigin = (origin) => !origin || /^(chrome|moz|safari-web)-extension:\/\//.test(origin);

class Bridge extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.clients = new Map();
    this.nextId = 1;
    this.status = { listening: false, error: null, port };
  }

  start() {
    this.server = http.createServer((req, res) => {
      const origin = req.headers.origin;
      if (origin && isExtensionOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ app: 'presence-hub', ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: ({ origin }) => isExtensionOrigin(origin),
      maxPayload: 256 * 1024,
    });
    this.wss.on('connection', (ws) => this._onConnection(ws));

    this.server.on('error', (err) => {
      const msg = err.code === 'EADDRINUSE'
        ? `Port ${this.port} is already in use by another program`
        : err.message;
      this.status = { ...this.status, listening: false, error: msg };
      this.emit('status', this.status);
    });
    this.server.listen(this.port, '127.0.0.1', () => {
      this.status = { ...this.status, listening: true, error: null };
      this.emit('status', this.status);
    });

    this.pruneTimer = setInterval(() => this._prune(), 30000);
  }

  stop() {
    clearInterval(this.pruneTimer);
    for (const c of this.clients.values()) c.ws.terminate();
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }

  // All tabs from all connected browsers.
  tabs() {
    const out = [];
    for (const c of this.clients.values()) {
      for (const [tabId, t] of c.tabs) {
        out.push({ key: `${c.id}:${tabId}`, browser: c.browser, ...t });
      }
    }
    return out;
  }

  browsers() {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      browser: c.browser,
      version: c.version,
      connectedAt: c.connectedAt,
      tabs: c.tabs.size,
    }));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  _onConnection(ws) {
    const client = { id: this.nextId++, ws, browser: 'Browser', version: null, tabs: new Map(), connectedAt: Date.now() };
    this.clients.set(client.id, client);
    this.emit('change');

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this._handle(client, msg);
    });
    ws.on('close', () => {
      this.clients.delete(client.id);
      this.emit('change');
    });
    ws.on('error', () => { /* close follows */ });
  }

  _handle(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();
    switch (msg.type) {
      case 'hello':
        client.browser = String(msg.browser || 'Browser').slice(0, 40);
        client.version = msg.version ? String(msg.version).slice(0, 20) : null;
        this.emit('hello', client);
        break;
      case 'sync':
        client.tabs.clear();
        for (const t of Array.isArray(msg.tabs) ? msg.tabs : []) {
          if (t && t.data) client.tabs.set(t.tabId, entry(t, now));
        }
        break;
      case 'update':
        if (msg.data) client.tabs.set(msg.tabId, entry(msg, now));
        else client.tabs.delete(msg.tabId);
        break;
      case 'remove':
        client.tabs.delete(msg.tabId);
        break;
      case 'focus': {
        const t = client.tabs.get(msg.tabId);
        if (t) t.focusedAt = Number(msg.focusedAt) || now;
        break;
      }
      case 'ping':
        if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify({ type: 'pong' }));
        return;
      default:
        return;
    }
    this.emit('change');
  }

  _prune() {
    const cutoff = Date.now() - STALE_AFTER;
    let changed = false;
    for (const c of this.clients.values()) {
      for (const [tabId, t] of c.tabs) {
        if (t.updatedAt < cutoff) { c.tabs.delete(tabId); changed = true; }
      }
    }
    if (changed) this.emit('change');
  }
}

function entry(msg, now) {
  return {
    tabId: msg.tabId,
    service: String(msg.service || ''),
    data: msg.data,
    focusedAt: Number(msg.focusedAt) || 0,
    updatedAt: now,
  };
}

module.exports = { Bridge };
