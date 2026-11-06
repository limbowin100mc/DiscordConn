'use strict';

// SoundCloud's web API (api-v2), the one soundcloud.com itself uses. SoundCloud's
// public API has no "now playing" or listening history, so this is what we use for
// both track lookups and your connected account. Requests need the public client id
// of SoundCloud's web app, which we read from its scripts. It changes now and then,
// so it's fetched again when SoundCloud stops accepting it.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const API = 'https://api-v2.soundcloud.com';
const ID_TTL = 24 * 3600e3;

// "…-large.jpg" is 100×100; the same image comes in 500×500.
function artwork(track) {
  const url = (track && (track.artwork_url || (track.user && track.user.avatar_url))) || '';
  return /^https:\/\//.test(url) ? url.replace(/-large\.(jpg|png)$/, '-t500x500.$1') : null;
}

class SoundCloudWeb {
  constructor(fetcher) {
    this.fetch = fetcher;
    this.id = null;
    this.idAt = 0;
    this.idPending = null;
    this.skew = 0; // SoundCloud's clock minus ours (ms), from the Date header
  }

  clientId(fresh = false) {
    if (this.id && !fresh && Date.now() - this.idAt < ID_TTL) return Promise.resolve(this.id);
    if (!this.idPending) this.idPending = this._findClientId().finally(() => { this.idPending = null; });
    return this.idPending;
  }

  async _findClientId() {
    const res = await this.fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`SoundCloud answered ${res.status}`);
    const html = await res.text();
    // It sits in one of the last scripts on the page.
    const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
    for (const src of scripts) {
      const r = await this.fetch(src, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const m = (await r.text()).match(/[{,]client_id:"([A-Za-z0-9]{32})"/);
      if (m) {
        this.id = m[1];
        this.idAt = Date.now();
        return this.id;
      }
    }
    throw new Error('Couldn’t reach SoundCloud');
  }

  // GET an api-v2 path, as the signed-in user when a token is given. A refused request
  // is tried once more with a fresh client id; if that fails too, the error has .status.
  async get(path, params = {}, token = null) {
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = await this.clientId(attempt > 0);
      const headers = { 'User-Agent': UA, Accept: 'application/json' };
      if (token) headers.Authorization = `OAuth ${token}`;
      res = await this.fetch(`${API}${path}?${new URLSearchParams({ ...params, client_id: id })}`, { headers });
      const date = Date.parse(res.headers.get('date') || '');
      if (date) this.skew = Math.abs(date - Date.now()) > 3000 ? date - Date.now() : 0;
      if (res.ok) return res.json();
      if (res.status !== 401 && res.status !== 403) break;
    }
    const err = new Error(res.status === 429 ? 'SoundCloud is busy, trying again soon' : `SoundCloud answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

module.exports = { SoundCloudWeb, artwork };
