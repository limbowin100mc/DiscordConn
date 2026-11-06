'use strict';

// Your SoundCloud account: what you're playing on any device (the phone app too).
// SoundCloud adds a track to your listening history a second after it starts
// playing, so the newest entry there is what's on, until its length has passed.
// SoundCloud doesn't share pausing, so a paused track shows until it would have ended.

const { artwork } = require('../soundcloud-web');

const POLL_MS = 10000;
const HISTORY_DELAY = 1000; // SoundCloud records a play after one second of playing

class SoundCloudAccount {
  constructor({ web, save, onChange, signIn, signOut }) {
    this.id = 'soundcloud';
    this.web = web;
    this.save = save; // ({ secret, user }) => void
    this.onChange = onChange;
    this.openSignIn = signIn; // () => Promise<token | null>
    this.signOut = signOut; // () => Promise, clears the sign-in window's cookies
    this.token = null;
    this.user = null;
    this.entry = null;
    this.anchor = null; // { playedAt, start }
    this.error = null;
    this.connecting = false;
    this.timer = null;
  }

  get connected() {
    return !!this.token;
  }

  status() {
    return { id: this.id, connected: this.connected, connecting: this.connecting, user: this.user, error: this.error };
  }

  tab() {
    return this.entry;
  }

  // The sign-in saved last time.
  restore({ secret, user }) {
    if (this.connected || !secret) return;
    this.token = secret;
    this.user = user;
  }

  start() {
    if (this.connected) this._schedule(0);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // Opens SoundCloud's sign-in page in a window of its own.
  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    this.error = null;
    this.onChange();
    try {
      const token = await this.openSignIn();
      if (token) await this.useToken(token);
    } finally {
      this.connecting = false;
      this.onChange();
    }
  }

  // Signs in with a token (from the sign-in window, or pasted by hand).
  async useToken(raw) {
    const token = String(raw || '').trim().replace(/^OAuth\s+/i, '');
    if (!/^[\w.-]{10,}$/.test(token)) {
      this.error = 'That doesn’t look like a SoundCloud token';
      this.onChange();
      return false;
    }
    try {
      const me = await this.web.get('/me', {}, token);
      this.token = token;
      this.user = { name: me.username || me.permalink || 'SoundCloud', id: me.id, image: artwork({ artwork_url: me.avatar_url }), url: me.permalink_url || null };
      this.error = null;
      this._persist();
      this._schedule(0);
      return true;
    } catch (err) {
      this.error = err.status === 401 || err.status === 403 ? 'SoundCloud didn’t accept that sign-in' : err.message;
      return false;
    } finally {
      this.onChange();
    }
  }

  disconnect() {
    this._forget();
    this.error = null;
    this.onChange();
    Promise.resolve(this.signOut && this.signOut()).catch(() => {});
  }

  _forget() {
    this.stop();
    this.token = null;
    this.user = null;
    this.entry = null;
    this._persist();
  }

  _persist() {
    this.save({ secret: this.token, user: this.user });
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    if (!this.connected) return;
    let next = POLL_MS;
    try {
      const { collection = [] } = await this.web.get('/me/play-history/tracks', { limit: '1' }, this.token);
      this._setEntry(collection[0]);
      this.error = null;
      // Check again right when the track would end, so it doesn't linger.
      const end = this.entry && this.entry.data.timeline && this.entry.data.timeline.end;
      if (end) next = Math.max(1000, Math.min(next, end - Date.now() + 1500));
    } catch (err) {
      if (err.status === 401) {
        this._forget();
        this.error = 'SoundCloud signed you out. Connect again.';
      } else {
        if (err.status === 429) next = 60000;
        this.error = err.message;
      }
    }
    this.onChange();
    if (this.connected) this._schedule(next);
  }

  _setEntry(play) {
    const track = play && play.track;
    const playedAt = play && Number(play.played_at);
    const duration = track && Number(track.duration);
    // Same play as last time: keep its start, so Discord isn't updated for nothing.
    const start = this.anchor && this.anchor.playedAt === playedAt ? this.anchor.start : playedAt - this.web.skew - HISTORY_DELAY;
    this.anchor = { playedAt, start };
    if (!track || !playedAt || !duration || Date.now() > start + duration) {
      this.entry = null;
      return;
    }
    const pm = track.publisher_metadata || {};
    this.entry = {
      key: 'account:soundcloud',
      browser: 'Your account',
      service: 'soundcloud',
      source: 'account',
      data: {
        title: track.title || '',
        artists: [pm.artist || (track.user && track.user.username)].filter(Boolean),
        album: pm.album_title || '',
        cover: artwork(track),
        url: track.permalink_url || null,
        playing: true,
        timeline: { start, end: start + duration },
      },
    };
  }
}

module.exports = { SoundCloudAccount };
