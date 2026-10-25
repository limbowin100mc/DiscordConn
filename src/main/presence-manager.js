'use strict';

// Keeps Discord in sync with the activity we want to show.
// - Holds one RPC connection at a time (each Discord application = one service).
// - Reconnects when Discord restarts, retries with backoff when it is closed.
// - Respects Discord's limit of 5 activity updates per 20 seconds.

const { EventEmitter } = require('events');
const { DiscordIpcClient, isDiscordRunning } = require('./discord-ipc');

const RATE_WINDOW = 20000;
const RATE_MAX = 5;

class PresenceManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.clientId = null;
    this.desired = null; // { clientId, activity } | null
    this.idleClientId = null; // used to stay connected (and show the user) when nothing is playing
    this.appliedKey = null;
    this.sendTimes = [];
    this.timer = null;
    this.busy = false;
    this.dirty = false;
    this.retry = { clientId: null, at: 0, delay: 3000 };
    this.compat = false; // set after Discord rejects newer activity fields
    this.status = { state: 'idle', user: null, error: null, clientId: null, errorClientId: null };
    this.destroyed = false;
  }

  update(desired, idleClientId = null) {
    this.desired = desired;
    this.idleClientId = idleClientId;
    this._schedule(0);
  }

  async destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    if (this.client) {
      try { if (this.client.ready) await this.client.setActivity(null); } catch { /* ignore */ }
      this.client.destroy();
    }
  }

  _setStatus(patch) {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.emit('status', this.status);
  }

  _schedule(ms) {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._run(), ms);
  }

  async _run() {
    if (this.busy) { this.dirty = true; return; }
    this.busy = true;
    try {
      await this._step();
    } catch (err) {
      this._setStatus({ error: err.message });
    } finally {
      this.busy = false;
      if (this.dirty) { this.dirty = false; this._schedule(0); }
    }
  }

  async _step() {
    const want = this.desired;
    const targetId = want ? want.clientId : this.idleClientId;

    if (!targetId) {
      // Nothing configured: drop any connection, just report whether Discord is open.
      this._disconnect();
      this._setStatus({ state: isDiscordRunning() ? 'waiting' : 'no-discord', user: null, clientId: null });
      this._schedule(10000);
      return;
    }

    if (!this.client || !this.client.ready || this.clientId !== targetId) {
      const ok = await this._connect(targetId);
      if (!ok) return;
    }

    if (!want) {
      if (this.appliedKey !== null) {
        await this._send(null);
      }
      return;
    }

    const activity = this.compat ? stripNewFields(want.activity) : want.activity;
    const key = JSON.stringify(activity);
    if (key === this.appliedKey) return;
    await this._send(activity, key);
  }

  async _send(activity, key = null) {
    const now = Date.now();
    this.sendTimes = this.sendTimes.filter((t) => now - t < RATE_WINDOW);
    if (this.sendTimes.length >= RATE_MAX) {
      this._schedule(RATE_WINDOW - (now - this.sendTimes[0]) + 50);
      return;
    }
    this.sendTimes.push(now);
    try {
      await this.client.setActivity(activity);
      this.appliedKey = key;
      this._setStatus({ error: null, errorClientId: null });
      this.emit('applied', activity);
    } catch (err) {
      if (activity && !this.compat && /status_display_type|\btype\b/i.test(err.message)) {
        // Older Discord builds reject newer fields (activity type, status display). Retry without them.
        this.compat = true;
        this._schedule(250);
        return;
      }
      this.appliedKey = key; // don't hammer Discord with an activity it rejects
      this._setStatus({ error: `Discord rejected the activity: ${err.message}`, errorClientId: this.clientId });
    }
  }

  async _connect(clientId) {
    const now = Date.now();
    if (this.retry.clientId === clientId && now < this.retry.at) {
      this._schedule(this.retry.at - now);
      return false;
    }

    this._disconnect();
    this.clientId = clientId;
    this._setStatus({ state: 'connecting', clientId, error: null, errorClientId: null });

    const client = new DiscordIpcClient(clientId);
    this.client = client;
    try {
      const user = await client.connect();
      if (this.client !== client) { client.destroy(); return false; }
      client.on('close', () => {
        if (this.client !== client) return;
        this.client = null;
        this.appliedKey = null;
        this._setStatus({ state: isDiscordRunning() ? 'disconnected' : 'no-discord', user: null });
        this.retry = { clientId, at: Date.now() + 3000, delay: 3000 };
        this._schedule(3000);
      });
      this.retry = { clientId: null, at: 0, delay: 3000 };
      this.appliedKey = null;
      this.sendTimes = [];
      this._setStatus({ state: 'connected', user, error: null, errorClientId: null });
      return true;
    } catch (err) {
      if (this.client === client) this.client = null;
      const invalid = err.code === 4000 || /client id/i.test(err.message);
      const delay = invalid ? 60000 : Math.min(this.retry.clientId === clientId ? this.retry.delay * 2 : 3000, 15000);
      this.retry = { clientId, at: Date.now() + delay, delay };
      if (err.code === 'NO_DISCORD') {
        this._setStatus({ state: 'no-discord', user: null, error: null });
      } else {
        this._setStatus({
          state: 'error',
          user: null,
          error: invalid ? 'Discord says this Client ID is invalid' : err.message,
          errorClientId: clientId,
        });
      }
      this._schedule(delay);
      return false;
    }
  }

  _disconnect() {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    this.clientId = null;
    this.appliedKey = null;
    c.destroy(); // closing the socket clears that application's activity
  }
}

function stripNewFields(activity) {
  if (!activity) return activity;
  const { type, status_display_type, ...rest } = activity; // eslint-disable-line no-unused-vars
  return rest;
}

// One-off check that a Client ID works (used by the "Test" button).
async function testClientId(clientId) {
  const c = new DiscordIpcClient(clientId);
  try {
    const user = await c.connect(6000);
    return { ok: true, user };
  } catch (err) {
    if (err.code === 'NO_DISCORD') return { ok: false, error: 'Discord is not running' };
    if (err.code === 4000 || /client id/i.test(err.message)) return { ok: false, error: 'Invalid Client ID' };
    return { ok: false, error: err.message };
  } finally {
    c.destroy();
  }
}

module.exports = { PresenceManager, testClientId };
