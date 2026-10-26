'use strict';

// Turns what the browser reports into one Discord activity.
// Priority: your preferred service > something actually playing > the tab you looked at last.
// Then adds the extras: live lyrics, "ends at", the game you're playing.

const { EventEmitter } = require('events');
const registry = require('./services');
const BUILT_IN_IDS = require('./discord-apps');
const { clip } = require('./services/util');
const { lineAt } = require('./lyrics');

const STATUS_DISPLAY = { name: 0, state: 1, details: 2 };
const HOLD_MS = 6000; // keep showing the last activity through short gaps (no flicker)
const LYRICS_LEAD_MS = 400; // show each line a moment early; Discord takes a beat to update
const LONG_VIDEO_MS = 10 * 60e3; // "ends at" only for movies/episodes, not short clips

class Engine extends EventEmitter {
  constructor({ store, bridge, detector, presence, appIcons, updater, lyrics, stats, info }) {
    super();
    this.store = store;
    this.bridge = bridge;
    this.detector = detector;
    this.presence = presence;
    this.appIcons = appIcons;
    this.updater = updater;
    this.lyrics = lyrics;
    this.stats = stats;
    this.info = info;
    this.sources = [];
    this.current = null;
    this.lastShown = null;
    this.lastBroadcast = '';

    store.on('change', () => this.schedule());
    bridge.on('change', () => this.schedule());
    bridge.on('hello', () => { this.lastBroadcast = ''; this.schedule(); });
    bridge.on('status', () => this.emitState());
    detector.on('change', () => this.schedule());
    presence.on('status', () => this.emitState());
    if (updater) updater.on('change', () => this.emitState());
    presence.on('applied', () => this.emitState());

    if (stats) {
      const kinds = Object.fromEntries(registry.services.map((svc) => [svc.id, svc.activityType === 2 ? 'listen' : 'watch']));
      this.serviceKinds = kinds;
      this.statsTimer = setInterval(() => stats.tick(this.sources, Date.now(), this.store.get().statsEnabled), 5000);
    }
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compute(), 120);
  }

  // Client ID for a service: your own app if you set one, else the built-in app, else the fallback.
  clientIdFor(id) {
    const s = this.store.get();
    return s.services[id].clientId || BUILT_IN_IDS[id] || s.fallbackClientId || '';
  }

  // Tabs from the browser extension, plus built-in detection. When the extension
  // already reports a site in a browser, it knows more, so the built-in result for
  // that site and browser is skipped.
  allTabs() {
    const ext = this.bridge.tabs().map((t) => ({ ...t, source: 'extension' }));
    const covered = new Set(ext.map((t) => `${t.browser}|${t.service}`));
    return [...ext, ...this.detector.tabs().filter((t) => !covered.has(`${t.browser}|${t.service}`))];
  }

  compute() {
    const s = this.store.get();
    const now = Date.now();
    const sources = [];

    for (const found of this.allTabs()) {
      // Built-in detection may offer other likely sites; use the first one that's turned on.
      const tab = [found, ...(found.alternatives || [])]
        .find((t) => s.services[t.service] && s.services[t.service].enabled) || found;
      const svc = registry.get(tab.service);
      if (!svc || !tab.data || typeof tab.data !== 'object') continue;
      const conf = s.services[svc.id];
      // Logo: your custom image, else the Discord app's icon (if it has one), else the official logo.
      const logo = conf.logo || (this.appIcons && this.appIcons.get(this.clientIdFor(svc.id))) || svc.logoUrl || tab.data.siteIcon;
      let built = null;
      try {
        built = svc.build(tab.data, conf.options, { logo });
      } catch (err) {
        console.error(`[${svc.id}] could not build activity:`, err);
      }
      let activity = built ? built.activity : null;
      if (activity) {
        activity = { type: conf.activityType ?? svc.activityType, ...activity };
        if (s.statusDisplay !== 'name') activity.status_display_type = STATUS_DISPLAY[s.statusDisplay];
      }
      sources.push({
        key: tab.key,
        service: svc.id,
        browser: tab.browser,
        source: tab.source,
        data: tab.data,
        activity,
        playing: !!(built && built.playing),
        focusedAt: tab.focusedAt || 0,
        enabled: conf.enabled,
        clientId: this.clientIdFor(svc.id),
      });
    }

    const eligible = sources.filter((x) => x.enabled && x.activity && x.clientId);
    eligible.sort((a, b) =>
      (b.service === s.preferred) - (a.service === s.preferred)
      || b.playing - a.playing
      || b.focusedAt - a.focusedAt
      || a.key.localeCompare(b.key));
    const chosen = s.enabled ? eligible[0] || null : null;

    // Smoother switching: if what we showed vanished a moment ago (a tab reloading,
    // an ad, the media session blinking), keep it a few seconds instead of flickering.
    let shown = chosen;
    let held = false;
    clearTimeout(this.holdTimer);
    if (chosen) {
      this.lastShown = { src: chosen, at: now };
    } else if (s.enabled && this.lastShown && now - this.lastShown.at < HOLD_MS && s.services[this.lastShown.src.service].enabled) {
      shown = this.lastShown.src;
      held = true;
      this.holdTimer = setTimeout(() => this.compute(), HOLD_MS - (now - this.lastShown.at) + 50);
    } else {
      this.lastShown = null;
    }

    for (const src of sources) {
      if (!s.enabled) src.status = 'off';
      else if (!src.enabled) src.status = 'disabled';
      else if (!src.activity) src.status = 'hidden';
      else if (!src.clientId) src.status = 'setup';
      else src.status = src === chosen ? 'live' : 'standby';
    }
    sources.sort((a, b) => (b.status === 'live') - (a.status === 'live') || b.focusedAt - a.focusedAt);

    const activity = shown ? this.decorate(shown, s, now) : null;
    this.sources = sources;
    this.current = shown ? { ...shown, activity, held } : null;

    // While nothing is shown, stay connected with an app we already use so the
    // dashboard can show your Discord account (and switching back is instant).
    let idleClientId = null;
    if (s.enabled) {
      const configured = registry.services
        .filter((svc) => s.services[svc.id].enabled)
        .map((svc) => this.clientIdFor(svc.id))
        .filter(Boolean);
      idleClientId = configured.includes(this.presence.clientId) ? this.presence.clientId : configured[0] || null;
    }
    this.presence.update(shown ? { clientId: shown.clientId, activity } : null, idleClientId);

    const summary = JSON.stringify({
      type: 'state',
      sharing: s.enabled,
      current: shown ? { service: shown.service, details: activity.details || null, state: activity.state || null } : null,
    });
    if (summary !== this.lastBroadcast) {
      this.lastBroadcast = summary;
      this.bridge.broadcast(JSON.parse(summary));
    }

    this.emitState();
  }

  // The extras, added to a copy of the activity that's about to be shown.
  decorate(src, s, now) {
    const a = { ...src.activity, assets: src.activity.assets ? { ...src.activity.assets } : undefined };
    if (!a.assets) delete a.assets;
    const d = src.data || {};
    const tl = a.timestamps;
    let lyricsOn = false;

    // Live lyrics: the line being sung right now replaces the artist line.
    if (s.lyrics && this.lyrics && a.type === 2 && src.playing && tl && tl.start && tl.end && d.title) {
      const lines = this.lyrics.get({ title: d.title, artist: (d.artists || []).join(', '), album: d.album, duration: (tl.end - tl.start) / 1000 });
      const line = lines && lines.length ? lineAt(lines, now - tl.start + LYRICS_LEAD_MS) : null;
      if (line !== null) {
        const byline = [(d.artists || []).join(', '), d.album].filter(Boolean).join(' · ');
        a.state = clip(`🎤 ${line || '♪'}`);
        if (a.assets && a.assets.large_image && byline) a.assets.large_text = clip(byline);
        lyricsOn = true;
      }
    }
    this.lyricsActive = lyricsOn;
    this._lyricsTicker(lyricsOn);

    // "Ends at 22:41" for movies and episodes.
    if (s.endsAt && a.type === 3 && src.playing && tl && tl.end && tl.start && tl.end - tl.start >= LONG_VIDEO_MS) {
      const end = new Date(tl.end);
      const at = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      a.state = clip(a.state ? `${a.state} · ends ${at}` : `Ends at ${at}`);
    }

    // "🎮 VALORANT" while a game is running.
    const game = this.detector.game;
    if (s.gameCombo && game) {
      const tag = `🎮 ${game.name}`;
      if (lyricsOn && a.assets && a.assets.large_image) a.assets.large_text = clip(`${a.assets.large_text ? `${a.assets.large_text} · ` : ''}${tag}`);
      else a.state = clip(a.state ? `${a.state} · ${tag}` : tag);
    }
    return a;
  }

  // While lyrics are showing, recompute every second so the line follows the song.
  _lyricsTicker(on) {
    if (on && !this.lyricsTimer) this.lyricsTimer = setInterval(() => this.compute(), 1000);
    if (!on && this.lyricsTimer) {
      clearInterval(this.lyricsTimer);
      this.lyricsTimer = null;
    }
  }

  // Play/pause/next/previous for what's shown (mini player buttons).
  control(cmd) {
    const cur = this.current;
    const m = cur && /^local:([^:]+):/.exec(cur.key);
    return this.detector.control(m && m[1] !== 'win' ? m[1] : null, cmd);
  }

  statsSummary(days) {
    return this.stats ? this.stats.summary(days, this.serviceKinds || {}) : null;
  }

  emitState() {
    if (this.emitPending) return;
    this.emitPending = true;
    setImmediate(() => {
      this.emitPending = false;
      this.emit('state', this.getState());
    });
  }

  getState() {
    const s = this.store.get();
    return {
      version: this.info.version,
      settings: s,
      services: registry.services.map((svc) => ({
        id: svc.id,
        name: svc.name,
        site: svc.site,
        url: svc.url,
        description: svc.description,
        color: svc.color,
        logo: svc.logo,
        logoUrl: svc.logoUrl,
        activityType: svc.activityType,
        options: svc.options,
        builtIn: !!BUILT_IN_IDS[svc.id],
        appId: this.clientIdFor(svc.id),
        ownApp: !!s.services[svc.id].clientId && s.services[svc.id].clientId !== BUILT_IN_IDS[svc.id],
      })),
      discord: this.presence.status,
      bridge: { ...this.bridge.status, browsers: this.bridge.browsers() },
      detector: this.detector.status,
      game: this.detector.game || null,
      update: this.updater ? this.updater.state : { status: 'dev' },
      sources: this.sources.map(({ key, service, browser, source, activity, playing, status, focusedAt }) =>
        ({ key, service, browser, source, activity, playing, status, focusedAt })),
      current: this.current
        ? { key: this.current.key, service: this.current.service, activity: this.current.activity, playing: this.current.playing, held: this.current.held, lyrics: !!this.lyricsActive }
        : null,
      paths: this.info.paths,
      packaged: this.info.packaged,
    };
  }
}

module.exports = { Engine };
