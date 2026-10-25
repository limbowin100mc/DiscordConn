'use strict';

// Built-in detection, no browser extension needed. Works with every browser:
//  - Windows media sessions: what's playing in any tab (even in the background),
//    with title, artist, album, play state, position and length.
//  - Browser window titles: the tab each browser window is showing (used for X,
//    and to tell which site a media session belongs to).
// Produces the same "tab" entries as the extension bridge, so the engine treats
// both the same way.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { Lookups } = require('./lookups');

// Media session app ids (AUMIDs) of browsers.
const MEDIA_APPS = [
  [/^chrome([._!-]|$)/i, 'Chrome'],
  [/^msedge/i, 'Edge'],
  [/^brave/i, 'Brave'],
  [/^opera/i, 'Opera'],
  [/^vivaldi/i, 'Vivaldi'],
  [/^(firefox|308046B0AF4A39CB)/i, 'Firefox'],
  [/^chromium/i, 'Chromium'],
  [/^TheBrowserCompany\.Arc/i, 'Arc'],
  [/^(thorium|zen|waterfox|librewolf|floorp)/i, null],
];
const PROCESSES = {
  chrome: 'Chrome', msedge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', firefox: 'Firefox',
  chromium: 'Chromium', arc: 'Arc', thorium: 'Thorium', zen: 'Zen', waterfox: 'Waterfox', librewolf: 'LibreWolf',
  floorp: 'Floorp', browser: 'Yandex',
};

function browserOfApp(app) {
  for (const [re, name] of MEDIA_APPS) {
    const m = String(app || '').match(re);
    if (m) return name || m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return null;
}

const BROWSER_SUFFIX = /\s[-—–]\s(?:Google Chrome(?: for Testing)?|Chromium|Brave|Opera(?: GX)?|Vivaldi|(?:Mozilla )?Firefox|Microsoft​? ?Edge|Arc|Thorium|Zen Browser|Waterfox|LibreWolf|Floorp|Yandex(?: Browser)?)$/;

// "Video - YouTube and 3 more pages - Personal - Microsoft Edge" -> "Video - YouTube - Personal"
function cleanWindowTitle(title) {
  return String(title || '')
    .replace(BROWSER_SUFFIX, '')
    .replace(/ and \d+ more pages?(?= - |$)/, '')
    .replace(/^\(\d+\+?\)\s*/, '') // unread counts like "(3) Home / X"
    .trim();
}

const PROFILE = '(?: - [^-]+)?$'; // Edge adds " - <profile name>"

function classifyX(t) {
  const page = (p, extra = {}) => ({ service: 'x', data: { page: p, ...extra } });
  let m;
  if ((m = t.match(/^(.+?) \(@([A-Za-z0-9_]{1,15})\) \/ X/))) return page('profile', { displayName: m[1], username: m[2], url: `https://x.com/${m[2]}` });
  if ((m = t.match(/^(.+?) on X: /))) return page('post', { displayName: m[1] });
  if ((m = t.match(/^(.+?) - Search \/ X/))) return page('search', { query: m[1] });
  const simple = {
    Home: 'home', 'X. It’s what’s happening': 'home', Explore: 'explore', Notifications: 'notifications', Messages: 'messages',
    Chat: 'messages', Bookmarks: 'bookmarks', Grok: 'grok', Lists: 'lists', Communities: 'communities', Settings: 'settings',
    'Your account': 'settings', 'Compose new post': 'compose', 'Post': 'post', Search: 'search', Spaces: 'space',
  };
  m = t.match(/^(.+?) \/ X/);
  return page((m && simple[m[1]]) || 'browse');
}

// Prime Video: "Prime Video: The Boys - Season 1"; on Amazon: "Amazon.com: Watch The Boys - Season 1 | Prime Video"
const PRIME_PAGES = /^(home|movies|tv shows|tv|live tv|sports|store|channels|subscriptions|my stuff|watchlist|search|settings|your account|categories|free to me|deals)$/i;
function classifyPrime(t) {
  let m = t.match(/^Prime Video:\s*(.+)$/) || t.match(/^Amazon\.[a-z.]+:\s*(?:Watch\s+)?(.+?) \| Prime Video/i)
    || t.match(/^(?:Watch\s+)?(.+?) \| Prime Video$/i);
  if (!m) {
    return /^(Welcome to )?Prime Video$/i.test(t) ? { service: 'primevideo', page: 'browse' } : null;
  }
  const name = m[1].trim();
  if (PRIME_PAGES.test(name) || /^search results/i.test(name)) return { service: 'primevideo', page: 'browse' };
  m = name.match(/^(.+?) - ((?:Season|Staffel|Saison|Temporada|Stagione|Sezona|Seizoen) .+)$/i);
  return { service: 'primevideo', page: 'title', title: m ? m[1] : name, season: m ? m[2] : '' };
}

// What site is a (cleaned) tab title from?
function classifyTitle(t) {
  let m;
  const prime = classifyPrime(t);
  if (prime) return prime;
  if ((m = t.match(/^(.+?) Live Stream - Watch Live on KICK/i))) return { service: 'kick', channel: m[1].trim() };
  // Netflix titles every signed-in page (including the player) just "Netflix".
  if (new RegExp(`^Netflix${PROFILE}`).test(t)) return { service: 'netflix', page: 'browse' };
  if ((m = t.match(/^Watch (.+?) \| Netflix(?: Official Site)?/))) return { service: 'netflix', page: 'title', title: m[1] };
  if (/^Netflix [^-|]+ - Watch TV Shows Online/i.test(t)) return { service: 'netflix', page: 'browse' };
  if (new RegExp(`^YouTube Music${PROFILE}`).test(t)) return { service: 'ytmusic', idle: true };
  if ((m = t.match(new RegExp(`^(.+) [|-] YouTube Music${PROFILE}`)))) return { service: 'ytmusic', song: true, title: m[1] };
  if (new RegExp(`^YouTube${PROFILE}`).test(t)) return { service: 'youtube', page: 'home' };
  if ((m = t.match(new RegExp(`^(.*) - YouTube${PROFILE}`)))) return { service: 'youtube', page: 'other', title: m[1] };
  if (/^Spotify\s*[-–—]\s*Web Player/i.test(t)) return { service: 'spotify', idle: true };
  if ((m = t.match(/^(.+?) • (.+?)$/))) return { service: 'spotify', song: true, title: m[1], artist: m[2].replace(new RegExp(PROFILE), '') };
  if (/ \/ (X|Twitter)(?: - [^-]+)?$/.test(t)) return classifyX(t);
  return null;
}

// Is this media session what the window is showing?
function windowShows(cleanTitle, s) {
  if (!s.title) return false;
  return cleanTitle === s.title
    || cleanTitle.startsWith(`${s.title} - `)
    || cleanTitle.startsWith(`${s.title} | `)
    || (/^Prime Video: /.test(cleanTitle) && s.title.length > 2 && cleanTitle.includes(s.title))
    || (s.artist && cleanTitle.startsWith(`${s.title} • ${s.artist}`));
}

// "youtube.com/watch?v=ID", "music.youtube.com/watch?v=ID&list=..", "youtube.com/shorts/ID", "/live/ID"
function videoIdFrom(url) {
  const m = String(url || '').match(/youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function timelineOf(s, now) {
  if (s.status !== 'Playing' || !(s.duration > 0)) return null;
  const rate = s.rate > 0 ? s.rate : 1;
  const updated = s.updated > 946684800000 && s.updated <= now + 5000 ? s.updated : now;
  const start = updated - (s.position * 1000) / rate;
  return { start: Math.round(start), end: Math.round(start + (s.duration * 1000) / rate) };
}

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const norm = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

class LocalDetector extends EventEmitter {
  constructor({ scriptPath, fetcher, memoryFile = null }) {
    super();
    this.scriptPath = scriptPath;
    this.memoryFile = memoryFile; // remembers the music site last used per browser across restarts
    this.lookups = new Lookups(fetcher, () => this._rebuild());
    this.raw = { sessions: [], windows: [] };
    this.entries = [];
    this.focus = new Map(); // entry key -> last time it was in the foreground
    this.firstSeen = new Map(); // thing -> when we first saw it (for "elapsed" timers)
    this.netflixWatch = new Map(); // browser -> { id, duration } of the Netflix video last seen in its address bar
    this.primeTitle = new Map(); // browser -> Prime Video title id last seen in its address bar
    this.mediaSite = new Map(); // "<app>|<title>" -> site, learned while that tab was showing
    this.mediaVideo = new Map(); // "<app>|<title>" -> YouTube video id, read from the address bar while showing
    this.lastMusic = new Map(); // browser -> 'spotify' | 'ytmusic', the music site last seen in it
    this._loadMemory();
    this.status = { running: false, error: null, browsers: [] };
    this.restartDelay = 2000;
  }

  _loadMemory() {
    if (!this.memoryFile) return;
    try {
      const saved = JSON.parse(require('fs').readFileSync(this.memoryFile, 'utf8'));
      for (const [b, site] of Object.entries(saved.lastMusic || {})) if (site === 'spotify' || site === 'ytmusic') this.lastMusic.set(b, site);
    } catch { /* first run */ }
  }

  _saveMemory() {
    if (!this.memoryFile) return;
    try {
      require('fs').writeFileSync(this.memoryFile, JSON.stringify({ lastMusic: Object.fromEntries(this.lastMusic) }));
    } catch { /* not important */ }
  }

  start() {
    if (process.platform !== 'win32') {
      this.status = { ...this.status, error: 'Built-in detection needs Windows' };
      return;
    }
    this.stopped = false;
    let buf = '';
    let errText = '';
    const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
      windowsHide: true,
    });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this._onLine(line);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { errText = (errText + d).slice(-2000); });
    proc.on('error', (err) => { errText = err.message; });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.raw = { sessions: [], windows: [] };
      this._setStatus({ running: false, error: this.stopped ? null : (errText.split('\n').find((l) => l.trim()) || 'Detector stopped').trim() });
      this._rebuild();
      if (!this.stopped) {
        setTimeout(() => { if (!this.stopped) this.start(); }, this.restartDelay);
        this.restartDelay = Math.min(this.restartDelay * 2, 60000);
      }
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
  }

  tabs() {
    return this.entries;
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
  }

  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== 'state') return;
    this.restartDelay = 2000;
    this.raw = { sessions: arr(msg.sessions), windows: arr(msg.windows) };
    this._rebuild();
  }

  _seen(key, now) {
    if (!this.firstSeen.has(key)) this.firstSeen.set(key, now);
    this.seenNow.add(key);
    return this.firstSeen.get(key);
  }

  _rebuild() {
    const now = Date.now();
    this.seenNow = new Set();
    const windows = this.raw.windows.map((w) => {
      const clean = cleanWindowTitle(w.title);
      return { ...w, browser: PROCESSES[w.process] || w.process, clean, info: classifyTitle(clean) };
    });
    this._trackNetflix(windows);
    this._trackPrime(windows);
    const before = JSON.stringify([...this.lastMusic]);
    for (const w of [...windows].sort((a, b) => a.foreground - b.foreground)) {
      if (w.info && (w.info.service === 'spotify' || w.info.service === 'ytmusic')) this.lastMusic.set(w.browser, w.info.service);
    }
    if (JSON.stringify([...this.lastMusic]) !== before) this._saveMemory();
    const entries = [];
    const shown = new Set(); // window ids already covered by a media entry

    for (const s of this.raw.sessions) {
      const browser = browserOfApp(s.app);
      if (!browser || !s.title || !/^(Playing|Paused|Changing)$/.test(s.status)) continue;
      const win = windows.find((w) => w.browser === browser && windowShows(w.clean, s))
        || windows.find((w) => windowShows(w.clean, s));
      const entry = this._fromMedia(s, browser, win, windows, now);
      if (!entry) continue;
      if (win) {
        shown.add(win.id);
        entry.windowId = win.id;
      }
      entries.push(entry);
    }

    for (const w of windows) {
      if (!w.info || shown.has(w.id)) continue;
      // Every Netflix page is titled "Netflix": if Netflix is already playing in this browser, that's the same tab.
      if (w.info.service === 'netflix' && entries.some((e) => e.service === 'netflix' && e.browser === w.browser)) continue;
      const entry = this._fromWindow(w, now);
      if (entry) {
        entry.windowId = w.id;
        entries.push(entry);
      }
    }

    // Which one is in the foreground right now?
    for (const e of entries) {
      const w = windows.find((x) => x.id === e.windowId);
      if (w && w.foreground) this.focus.set(e.key, now);
      e.focusedAt = this.focus.get(e.key) || 0;
      e.updatedAt = now;
      for (const alt of e.alternatives || []) Object.assign(alt, { focusedAt: e.focusedAt, updatedAt: now, windowId: e.windowId });
    }
    for (const k of this.firstSeen.keys()) if (!this.seenNow.has(k)) this.firstSeen.delete(k);
    if (this.focus.size > 100) this.focus.clear();

    this.entries = entries;
    const browsers = [...new Set([...windows.map((w) => w.browser), ...this.raw.sessions.map((s) => browserOfApp(s.app)).filter(Boolean)])];
    this._setStatus({ running: !!this.proc, error: this.proc ? null : this.status.error, browsers });
    this.emit('change');
  }

  _fromMedia(s, browser, win, windows, now) {
    const playing = s.status === 'Playing';
    const info = win ? win.info : null;
    const key = (service) => `local:${s.app}:${service}`;

    // Kick either describes the stream (artist = streamer, album = "Kick") or, before
    // its player is ready, only gives the page title "<name> Live Stream - Watch Live on KICK".
    const titleInfo = classifyTitle(s.title);
    if (titleInfo && titleInfo.service === 'kick') return this._kick(titleInfo.channel, browser, key('kick'), playing, now);
    if ((/^kick$/i.test(s.album) && s.artist) || (info && info.service === 'kick')) {
      return this._kick(s.artist || info.channel, browser, key('kick'), playing, now, s.artist ? s.title : '');
    }

    // Prime Video: either Windows gets the page title ("Prime Video: The Boys - Season 1"),
    // or the player describes the show and we match it to the Prime tab (remembered when hidden).
    const primeMemo = `${s.app}|${s.title}`;
    if (titleInfo && titleInfo.service === 'primevideo' && titleInfo.page === 'title') {
      return this._prime(titleInfo.title, titleInfo.season, browser, key('primevideo'), s, playing, now);
    }
    if ((info && info.service === 'primevideo') || this.mediaSite.get(primeMemo) === 'primevideo') {
      if (info && info.service === 'primevideo') this.mediaSite.set(primeMemo, 'primevideo');
      return this._prime(s.title, s.artist || (info && info.season) || '', browser, key('primevideo'), s, playing, now);
    }

    // Netflix: if it doesn't describe what's on, Windows only gets the page title "Netflix".
    if ((titleInfo && titleInfo.service === 'netflix') || (info && info.service === 'netflix')) {
      return this._netflix('', '', browser, key('netflix'), s, playing, now);
    }

    // Which site is playing it? The window showing it says; if that tab is hidden, use
    // what we learned while it was showing; for songs (they have an album), fall back
    // to the music site last seen in this browser.
    const memo = `${s.app}|${s.title}`;
    let site = info && ['spotify', 'ytmusic', 'youtube'].includes(info.service) ? info.service : null;
    if (site) {
      this.mediaSite.set(memo, site);
      if (this.mediaSite.size > 200) this.mediaSite.delete(this.mediaSite.keys().next().value);
    } else {
      site = this.mediaSite.get(memo) || null;
    }
    // YouTube Music titles its tab just "YouTube Music" except on the song's own page, so
    // a track (with an artist) playing while such a tab is showing in this browser is from it.
    if (!site && s.artist && windows.some((w) => w.browser === browser && w.info && w.info.service === 'ytmusic')
      && !windows.some((w) => w.browser === browser && w.info && w.info.service === 'youtube')) {
      site = 'ytmusic';
      this.mediaSite.set(memo, site);
    }
    const shownId = win && videoIdFrom(win.url);
    if (shownId) {
      this.mediaVideo.set(memo, shownId);
      if (this.mediaVideo.size > 200) this.mediaVideo.delete(this.mediaVideo.keys().next().value);
    }
    const otherSite = /^(kick|twitch|youtube|soundcloud|deezer|tidal|apple music)$/i.test(s.album);
    if (site === 'spotify' || site === 'ytmusic') return this._music(site, s, browser, key(site), playing, now, this.mediaVideo.get(memo));
    if (!site && s.album && !otherSite) {
      // A song, but its tab isn't showing: most likely the music site last seen in this
      // browser. The other one is offered too; the app uses one you have turned on.
      const guess = this.lastMusic.get(browser) || 'spotify';
      const other = guess === 'spotify' ? 'ytmusic' : 'spotify';
      const entry = this._music(guess, s, browser, key(guess), playing, now);
      entry.alternatives = [this._music(other, s, browser, key(other), playing, now)];
      return entry;
    }

    // YouTube: known from its tab (now or earlier, with the video id from the address
    // bar), or confirmed by finding the exact video on YouTube.
    const knownId = this.mediaVideo.get(memo);
    const video = knownId ? { videoId: knownId, live: false } : s.artist ? this.lookups.youtube(s.title, s.artist) : null;
    if (!video && site !== 'youtube') {
      if (video === null && s.artist && s.duration > 0 && this.lastMusic.get(browser) === 'ytmusic') {
        return this._music('ytmusic', s, browser, key('ytmusic'), playing, now);
      }
      return null; // not YouTube (or still checking); other sites aren't shown
    }
    const live = !(s.duration > 0) || !!(video && video.live);
    // Every YouTube Music track is also a YouTube video. Unless we saw it on YouTube
    // itself, it may be YouTube Music (playing from its home or library page).
    const alternatives = site !== 'youtube' && this.lastMusic.get(browser) === 'ytmusic'
      ? [this._music('ytmusic', s, browser, key('ytmusic'), playing, now, video && video.videoId)]
      : undefined;
    return {
      alternatives,
      key: key('youtube'),
      browser,
      service: 'youtube',
      source: 'built-in',
      data: {
        page: 'watch',
        videoId: video ? video.videoId : null,
        title: s.title,
        channel: s.artist || '',
        url: video ? `https://www.youtube.com/watch?v=${video.videoId}` : null,
        thumbnail: video ? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` : null,
        playing,
        live,
        ad: false,
        timeline: live ? null : timelineOf(s, now),
        watchStart: this._seen(`yt:${s.title}`, now),
      },
    };
  }

  // Remember which Netflix video each browser is on (read from its address bar while
  // the Netflix tab is showing), so the show is still known after switching tabs.
  _trackNetflix(windows) {
    const isNetflixMedia = (s) => s.title === 'Netflix';
    const active = new Set(this.raw.sessions.filter(isNetflixMedia).map((s) => browserOfApp(s.app)));
    for (const w of windows) {
      if (!w.info || w.info.service !== 'netflix') continue;
      active.add(w.browser);
      const url = String(w.url || '');
      const watch = url.match(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/(\d+)/);
      const title = url.match(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(\d+)/) || url.match(/netflix\.com\/.*[?&]jbv=(\d+)/);
      if (watch) {
        const session = this.raw.sessions.find((s) => browserOfApp(s.app) === w.browser && isNetflixMedia(s));
        const prev = this.netflixWatch.get(w.browser);
        const duration = session && session.duration > 0 ? session.duration : prev && prev.id === watch[1] ? prev.duration : 0;
        this.netflixWatch.set(w.browser, { id: watch[1], duration });
      } else if (title) {
        w.info = { ...w.info, page: 'title', titleId: title[1] };
      }
    }
    for (const b of [...this.netflixWatch.keys()]) if (!active.has(b)) this.netflixWatch.delete(b);
  }

  _trackPrime(windows) {
    // Browsers where Prime Video is playing: its page title, or a show we matched to a Prime tab earlier.
    const active = new Set(this.raw.sessions
      .filter((s) => classifyPrime(s.title) || this.mediaSite.get(`${s.app}|${s.title}`) === 'primevideo')
      .map((s) => browserOfApp(s.app)));
    for (const w of windows) {
      if (!w.info || w.info.service !== 'primevideo') continue;
      active.add(w.browser);
      const m = String(w.url || '').match(/primevideo\.com\/.*?detail\/(?:[^/?#]+\/)?([0-9A-Z]{10,})/)
        || String(w.url || '').match(/amazon\.[a-z.]+\/gp\/video\/detail\/([0-9A-Z]{10})/);
      if (m) {
        this.primeTitle.set(w.browser, m[1]);
        w.info = { ...w.info, titleId: m[1] };
      }
    }
    for (const b of [...this.primeTitle.keys()]) if (!active.has(b)) this.primeTitle.delete(b);
  }

  _prime(title, episode, browser, key, s, playing, now) {
    const id = this.primeTitle.get(browser);
    const info = id ? this.lookups.primevideo(id) : null;
    // Only use the looked-up cover if it's the same title (the address may be from another page).
    const same = info && title && norm(info.title).startsWith(norm(title));
    return {
      key,
      browser,
      service: 'primevideo',
      source: 'built-in',
      data: {
        page: 'watch',
        title: title || (info && info.title) || '',
        episode: episode || '',
        image: same ? info.image : null,
        url: id ? `https://www.primevideo.com/detail/${id}` : null,
        playing,
        timeline: timelineOf(s, now),
        watchStart: this._seen(`pv:${title}`, now),
      },
    };
  }

  _netflix(title, episode, browser, key, s, playing, now) {
    // Netflix didn't say what's on: use the video from the address bar.
    const seen = title ? null : this.netflixWatch.get(browser);
    const info = seen ? this.lookups.netflix(seen.id) : null;
    // A different length means another episode started since we last saw the address.
    const sameVideo = seen && (!seen.duration || !(s.duration > 0) || Math.abs(seen.duration - s.duration) < 2);
    const name = title || (info && info.title) || '';
    return {
      key,
      browser,
      service: 'netflix',
      source: 'built-in',
      data: {
        page: 'watch',
        title: name,
        episode: title ? episode || '' : info && sameVideo ? info.episode : '',
        kind: info ? info.kind : '',
        image: info ? info.image : null,
        url: info ? `https://www.netflix.com/title/${info.showId || seen.id}` : null,
        playing,
        timeline: timelineOf(s, now),
        watchStart: this._seen(`nf:${name}`, now),
      },
    };
  }

  _music(site, s, browser, key, playing, now, knownId = null) {
    const query = encodeURIComponent(`${s.title} ${s.artist || ''}`.trim());
    this._seen(`${site}:${s.title}`, now);
    let cover = this.lookups.albumArt(s.title, s.artist, s.album) || null;
    let url = site === 'spotify' ? `https://open.spotify.com/search/${query}` : `https://music.youtube.com/search?q=${query}`;
    if (site === 'ytmusic') {
      // Every YouTube Music track is a YouTube video: its thumbnail is the fallback cover,
      // and it gives a direct link.
      const video = knownId ? { videoId: knownId } : this.lookups.youtube(s.title, '');
      if (video) {
        url = `https://music.youtube.com/watch?v=${video.videoId}`;
        if (!cover) cover = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
      }
    }
    return {
      key,
      browser,
      service: site,
      source: 'built-in',
      data: {
        title: s.title,
        artists: s.artist ? [s.artist] : [],
        album: s.album || '',
        cover,
        url,
        playing,
        timeline: timelineOf(s, now),
      },
    };
  }

  _kick(name, browser, key, playing, now, streamTitle = '') {
    const ch = this.lookups.kick(name);
    const slug = (ch && ch.slug) || name.toLowerCase();
    return {
      key,
      browser,
      service: 'kick',
      source: 'built-in',
      data: {
        page: 'stream',
        slug,
        channel: (ch && ch.channel) || name,
        avatar: (ch && ch.avatar) || null,
        live: ch ? ch.live : true,
        title: (ch && ch.title) || streamTitle,
        category: (ch && ch.category) || '',
        liveSince: (ch && ch.liveSince) || null,
        playing,
        url: `https://kick.com/${slug}`,
        watchStart: this._seen(`kick:${name}`, now),
      },
    };
  }

  _fromWindow(w, now) {
    const info = w.info;
    const key = `local:win:${w.id}:${info.service}`;
    const base = { key, browser: w.browser, service: info.service, source: 'built-in' };
    const sessionStart = this._seen(`${key}:session`, now);
    switch (info.service) {
      case 'x':
        return { ...base, data: { ...info.data, sessionStart } };
      case 'youtube':
        return { ...base, data: { page: info.page === 'home' ? 'home' : 'browse', sessionStart } };
      case 'primevideo':
        return { ...base, data: { page: info.page, title: info.title || '', sessionStart } };
      case 'netflix': {
        const t = info.titleId ? this.lookups.netflix(info.titleId) : null;
        return { ...base, data: { page: info.page, title: info.title || (t && t.title) || '', sessionStart } };
      }
      case 'spotify':
        // "Song • Artist" titles are only trusted together with a media session
        // (other sites use "•" too), so on its own only the idle player counts.
        return info.song ? null : { ...base, data: { idle: true, sessionStart } };
      case 'ytmusic':
        // Without a media session we can't tell playing from paused, so it only counts as "open".
        return { ...base, data: { idle: true, sessionStart } };
      case 'kick':
        return { ...this._kick(info.channel, w.browser, key, false, now) };
      default:
        return null;
    }
  }
}

module.exports = { LocalDetector, classifyTitle, cleanWindowTitle, browserOfApp };
