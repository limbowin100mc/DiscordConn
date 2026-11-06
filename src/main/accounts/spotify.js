'use strict';

// Your Spotify account: what's playing on any of your devices (phone, the desktop
// app, a speaker…), from Spotify's Web API. Signing in uses the Authorization Code
// flow with PKCE, so there's no client secret, only the Client ID of a Spotify app
// that has REDIRECT_PATH (on the local bridge port) as its redirect URI.

const crypto = require('crypto');

// Client ID of a Spotify app that ships with Presence Hub (public, not a secret).
// Left empty, everyone enters the Client ID of their own Spotify app in Connections.
const BUILT_IN_CLIENT_ID = '';
const REDIRECT_PATH = '/callback/spotify';
const SCOPES = 'user-read-playback-state user-read-currently-playing';
const API = 'https://api.spotify.com/v1';
const POLL_PLAYING = 5000;
const POLL_IDLE = 10000;
const SIGN_IN_TTL = 10 * 60e3;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The largest image up to 640px (Discord shows it small anyway).
function pickImage(images) {
  const list = (images || []).filter((i) => i && /^https:\/\//.test(i.url));
  list.sort((a, b) => (b.width || 0) - (a.width || 0));
  return (list.find((i) => !i.width || i.width <= 640) || list[0] || {}).url || null;
}

class SpotifyAccount {
  constructor({ fetch, port, clientId, save, onChange }) {
    this.id = 'spotify';
    this.fetch = fetch;
    this.redirectUri = `http://127.0.0.1:${port}${REDIRECT_PATH}`;
    this.configuredClientId = clientId; // () => the Client ID set in the app
    this.save = save; // ({ secret, user, clientId }) => void
    this.onChange = onChange;
    this.refreshToken = null;
    this.user = null;
    this.tokenClientId = null; // refresh tokens only work with the app that issued them
    this.access = null; // { token, expires }
    this.signIn = null; // { verifier, state, clientId, at }
    this.entry = null;
    this.anchor = null; // { id, start }: keeps the start time steady between polls
    this.error = null;
    this.timer = null;
  }

  get clientId() {
    return this.configuredClientId() || BUILT_IN_CLIENT_ID;
  }

  get connected() {
    return !!this.refreshToken;
  }

  status() {
    return {
      id: this.id,
      connected: this.connected,
      connecting: !!this.signIn,
      user: this.user,
      error: this.error,
      device: this.entry ? this.entry.data.device || null : null,
      hasClientId: !!this.clientId,
      builtInClientId: !!BUILT_IN_CLIENT_ID,
      redirectUri: this.redirectUri,
    };
  }

  tab() {
    return this.entry;
  }

  // The sign-in saved last time.
  restore({ secret, user, clientId }) {
    if (this.connected || !secret) return;
    this.refreshToken = secret;
    this.user = user;
    this.tokenClientId = clientId;
  }

  start() {
    if (this.connected) this._schedule(0);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // The address that opens Spotify's sign-in page in your browser.
  connect() {
    const clientId = this.clientId;
    if (!clientId) throw new Error('Add the Client ID of your Spotify app first');
    const verifier = b64url(crypto.randomBytes(64));
    const state = b64url(crypto.randomBytes(16));
    this.signIn = { verifier, state, clientId, at: Date.now() };
    this.error = null;
    this.onChange();
    return `https://accounts.spotify.com/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
      scope: SCOPES,
      state,
    })}`;
  }

  cancel() {
    this.signIn = null;
    this.onChange();
  }

  // Spotify sends the browser back here after you allow (or deny) access.
  // Returns the message for the page shown in the browser.
  async callback(params) {
    const pending = this.signIn;
    if (!pending || params.get('state') !== pending.state || Date.now() - pending.at > SIGN_IN_TTL) {
      return { ok: false, text: 'This sign-in link has expired. Click Connect in Presence Hub to try again.' };
    }
    this.signIn = null;
    if (params.get('error')) {
      this.error = params.get('error') === 'access_denied' ? 'You didn’t allow access on Spotify' : `Spotify said: ${params.get('error')}`;
      this.onChange();
      return { ok: false, text: 'Spotify wasn’t connected. You can close this tab.' };
    }
    try {
      const tok = await this._tokenRequest({
        grant_type: 'authorization_code',
        code: params.get('code') || '',
        redirect_uri: this.redirectUri,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
      });
      this.tokenClientId = pending.clientId;
      this._setTokens(tok);
      const me = await this._api('/me');
      this.user = { name: me.display_name || me.id, id: me.id, image: pickImage(me.images), url: (me.external_urls && me.external_urls.spotify) || null };
      this.error = null;
      this._persist();
      this._schedule(0);
      return { ok: true, text: `Spotify is connected${this.user.name ? ` as ${this.user.name}` : ''}. You can close this tab.` };
    } catch (err) {
      this._forget();
      this.error = err.message;
      this.onChange();
      return { ok: false, text: `Spotify wasn’t connected: ${err.message}` };
    }
  }

  disconnect() {
    this._forget();
    this.error = null;
    this.onChange();
  }

  _forget() {
    this.stop();
    this.refreshToken = null;
    this.access = null;
    this.user = null;
    this.entry = null;
    this.anchor = null;
    this.tokenClientId = null;
    this._persist();
  }

  _persist() {
    this.save({ secret: this.refreshToken, user: this.user, clientId: this.tokenClientId });
  }

  _setTokens(tok) {
    this.access = { token: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 };
    if (tok.refresh_token) this.refreshToken = tok.refresh_token; // Spotify may hand out a new one
  }

  async _tokenRequest(body) {
    const res = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error_description || json.error || `Spotify answered ${res.status}`);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  async _token() {
    if (this.access && Date.now() < this.access.expires - 60000) return this.access.token;
    const before = this.refreshToken;
    const tok = await this._tokenRequest({ grant_type: 'refresh_token', refresh_token: before, client_id: this.tokenClientId || this.clientId });
    this._setTokens(tok);
    if (this.refreshToken !== before) this._persist();
    return this.access.token;
  }

  async _api(path) {
    const res = await this.fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await this._token()}` } });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json && json.error && (json.error.message || json.error);
      const err = new Error(res.status === 403
        ? 'Spotify refused. In your Spotify app’s dashboard, add your account under User Management.'
        : `Spotify answered ${res.status}${msg ? `: ${msg}` : ''}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return json;
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    if (!this.connected) return;
    let next = this.entry && this.entry.data.playing ? POLL_PLAYING : POLL_IDLE;
    try {
      const sentAt = Date.now();
      const p = await this._api('/me/player?additional_types=episode');
      this._setEntry(p, sentAt + (Date.now() - sentAt) / 2);
      this.error = null;
    } catch (err) {
      if (err.code === 'invalid_grant') {
        // Access was removed (or the Spotify app changed): sign in again.
        this._forget();
        this.error = 'Spotify signed you out. Connect again.';
      } else {
        if (err.status === 401) this.access = null;
        if (err.status === 429) next = Math.max(next, err.retryAfter * 1000 || 30000);
        this.error = err.message;
      }
    }
    this.onChange();
    if (this.connected) this._schedule(next);
  }

  _setEntry(p, at) {
    const item = p && p.item;
    if (!item) {
      // Nothing playing anywhere, or an ad.
      this.entry = null;
      this.anchor = null;
      return;
    }
    const episode = item.type === 'episode';
    const playing = !!p.is_playing;
    const duration = Number(item.duration_ms) || 0;
    let timeline = null;
    if (playing && duration && Number.isFinite(p.progress_ms)) {
      let start = Math.round(at - p.progress_ms);
      if (this.anchor && this.anchor.id === item.id && Math.abs(this.anchor.start - start) < 2500) start = this.anchor.start;
      this.anchor = { id: item.id, start };
      timeline = { start, end: start + duration };
    } else {
      this.anchor = null;
    }
    const device = p.device || {};
    this.entry = {
      key: 'account:spotify',
      browser: device.name || 'Your account',
      service: 'spotify',
      source: 'account',
      data: {
        title: item.name || '',
        artists: episode ? [item.show && item.show.name].filter(Boolean) : (item.artists || []).map((a) => a.name).filter(Boolean),
        album: episode ? (item.show && item.show.publisher) || '' : (item.album && item.album.name) || '',
        cover: pickImage(episode ? (item.images && item.images.length ? item.images : item.show && item.show.images) : item.album && item.album.images),
        url: (item.external_urls && item.external_urls.spotify) || null,
        playing,
        timeline,
        device: device.name || '',
        deviceType: device.type || '',
      },
    };
  }
}

module.exports = { SpotifyAccount, REDIRECT_PATH };
