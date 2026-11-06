'use strict';

// Connected accounts. Spotify and SoundCloud tell us what you play on any device
// (your phone too, on any network), not only in this PC's browsers. Each one shows
// up to the engine like a browser tab, with source "account".
// Sign-ins are kept in accounts.json, encrypted with Windows' data protection.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { safeStorage } = require('electron');
const { SpotifyAccount, REDIRECT_PATH } = require('./spotify');
const { SoundCloudAccount } = require('./soundcloud');
const soundcloudSignIn = require('./soundcloud-signin');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The page your browser shows after signing in to Spotify.
function resultPage({ ok, text }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Presence Hub</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e8ebf2;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px;color:${ok ? '#1ed760' : '#ff6b6b'}}p{margin:0;color:#9aa3b5}</style></head>
<body><main><h1>${ok ? 'Connected' : 'Not connected'}</h1><p>${esc(text)}</p></main></body></html>`;
}

class Accounts extends EventEmitter {
  constructor({ dir, fetcher, soundcloud, bridge, port, store, openExternal, window: getWindow, icon }) {
    super();
    this.file = path.join(dir, 'accounts.json');
    this.openExternal = openExternal;
    this.data = this._read();
    this.saving = Promise.resolve();
    this.lastSnapshot = '';
    const changed = () => this._changed();

    this.spotify = new SpotifyAccount({
      fetch: fetcher,
      port,
      clientId: () => store.get().spotifyClientId,
      save: (v) => this._save('spotify', v),
      onChange: changed,
    });
    this.soundcloud = new SoundCloudAccount({
      web: soundcloud,
      save: (v) => this._save('soundcloud', v),
      onChange: changed,
      signIn: () => soundcloudSignIn.signIn({ parent: getWindow(), icon }),
      signOut: () => soundcloudSignIn.signOut(),
    });
    this.list = [this.spotify, this.soundcloud];

    bridge.route(REDIRECT_PATH, async (params) => resultPage(await this.spotify.callback(params)));
    store.on('change', changed); // the Spotify Client ID is a setting
  }

  // Restores the saved sign-ins, then starts asking what's playing.
  async start() {
    for (const a of this.list) {
      a.restore(await this._load(a.id));
      a.start();
    }
    this._changed();
  }

  stop() {
    for (const a of this.list) a.stop();
  }

  // What's playing on your accounts, as tab entries.
  tabs() {
    return this.list.map((a) => a.tab()).filter(Boolean);
  }

  get status() {
    return Object.fromEntries(this.list.map((a) => [a.id, a.status()]));
  }

  async connect(id) {
    try {
      if (id === 'spotify') this.openExternal(this.spotify.connect());
      else if (id === 'soundcloud') this.soundcloud.connect().catch((err) => console.error('SoundCloud sign-in:', err));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  cancel(id) {
    if (id === 'spotify') this.spotify.cancel();
  }

  disconnect(id) {
    const a = this.list.find((x) => x.id === id);
    if (a) a.disconnect();
  }

  // A SoundCloud token pasted by hand (for sign-ins the window can't do).
  async useToken(id, token) {
    if (id !== 'soundcloud') return { ok: false };
    const ok = await this.soundcloud.useToken(token);
    return { ok, error: ok ? null : this.soundcloud.error };
  }

  _changed() {
    const snapshot = JSON.stringify([this.status, this.tabs()]);
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    this.emit('change');
  }

  async _load(id) {
    const raw = this.data[id] || {};
    let secret = null;
    let reEncrypt = false;
    try {
      if (raw.secret && raw.secret.enc) {
        const out = await safeStorage.decryptStringAsync(Buffer.from(raw.secret.enc, 'base64'));
        secret = out.result;
        reEncrypt = out.shouldReEncrypt;
      } else if (raw.secret && raw.secret.plain) {
        secret = raw.secret.plain;
      }
    } catch { /* made on another PC or Windows account: sign in again */ }
    const saved = { secret, user: secret ? raw.user || null : null, clientId: raw.clientId || null };
    if (secret && reEncrypt) this._save(id, saved);
    return saved;
  }

  // Saves run one after another, so the newest always ends up on disk.
  _save(id, { secret, user, clientId = null }) {
    this.saving = this.saving.then(async () => {
      let stored = null;
      if (secret) {
        stored = (await safeStorage.isAsyncEncryptionAvailable())
          ? { enc: (await safeStorage.encryptStringAsync(secret)).toString('base64') }
          : { plain: secret };
      }
      this.data[id] = { secret: stored, user: user || null, clientId };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    }).catch((err) => console.error('Could not save accounts:', err.message));
    return this.saving;
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch {
      return {};
    }
  }
}

module.exports = { Accounts };
