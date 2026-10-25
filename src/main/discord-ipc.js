'use strict';

// Minimal client for Discord's local RPC socket (the same thing games use for
// Rich Presence). Each connection is bound to one Discord application id.

const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
  const dir = (XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || '/tmp').replace(/\/$/, '');
  return path.join(dir, `discord-ipc-${i}`);
}

function openPipe(i) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(pipePath(i));
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.once('error', fail);
    sock.once('connect', () => { sock.off('error', fail); resolve(sock); });
  });
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// Is the Discord desktop client running? (Checks for its socket without connecting.)
function isDiscordRunning() {
  if (process.platform !== 'win32') return true;
  try {
    const fs = require('fs');
    return fs.readdirSync('\\\\.\\pipe\\').some((name) => /^discord-ipc-\d$/.test(name));
  } catch {
    return true;
  }
}

class DiscordIpcClient extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.user = null;
    this.ready = false;
    this.closeInfo = null;
  }

  async connect(timeoutMs = 8000) {
    let sock = null;
    for (let i = 0; i < 10 && !sock; i++) {
      try { sock = await openPipe(i); } catch { /* try the next pipe */ }
    }
    if (!sock) {
      const err = new Error('Discord is not running');
      err.code = 'NO_DISCORD';
      throw err;
    }

    this.socket = sock;
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('close', () => this._onClose());
    sock.on('error', () => { /* 'close' always follows */ });

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('close', onClose);
      };
      const onReady = (user) => { cleanup(); resolve(user); };
      const onClose = (info) => {
        cleanup();
        const err = new Error(info && info.message ? info.message : 'Discord closed the connection');
        err.code = info && info.code;
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        this.destroy();
        const err = new Error('Discord did not respond');
        err.code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);
      this.once('ready', onReady);
      this.once('close', onClose);
      this._write(OP.HANDSHAKE, { v: 1, client_id: this.clientId });
    });
  }

  setActivity(activity) {
    const args = { pid: process.pid };
    if (activity) args.activity = activity;
    return this.request('SET_ACTIVITY', args);
  }

  request(cmd, args, timeoutMs = 10000) {
    if (!this.ready) return Promise.reject(new Error('Not connected to Discord'));
    const nonce = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      this._write(OP.FRAME, { cmd, args, nonce });
    });
  }

  destroy() {
    if (!this.socket) return;
    try { this.socket.end(); } catch { /* ignore */ }
    this.socket.destroy();
  }

  _write(op, payload) {
    if (this.socket && !this.socket.destroyed) this.socket.write(encode(op, payload));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) break;
      const raw = this.buffer.subarray(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.subarray(8 + len);
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      this._handle(op, msg);
    }
  }

  _handle(op, msg) {
    if (op === OP.PING) return this._write(OP.PONG, msg);
    if (op === OP.CLOSE) {
      this.closeInfo = msg;
      this.destroy();
      return;
    }
    if (op !== OP.FRAME) return;

    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.ready = true;
      this.user = (msg.data && msg.data.user) || null;
      this.emit('ready', this.user);
      return;
    }
    const waiter = msg.nonce && this.pending.get(msg.nonce);
    if (!waiter) return;
    this.pending.delete(msg.nonce);
    clearTimeout(waiter.timer);
    if (msg.evt === 'ERROR') {
      const err = new Error((msg.data && msg.data.message) || 'Discord returned an error');
      err.code = msg.data && msg.data.code;
      waiter.reject(err);
    } else {
      waiter.resolve(msg.data);
    }
  }

  _onClose() {
    const wasReady = this.ready;
    this.ready = false;
    this.socket = null;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Disconnected from Discord'));
    }
    this.pending.clear();
    this.emit('close', this.closeInfo || { code: -1, message: wasReady ? 'Discord closed' : 'Connection closed' });
  }
}

module.exports = { DiscordIpcClient, isDiscordRunning };
