'use strict';

// Turns what the browser reports into one Discord activity.
// Priority: your preferred service > something actually playing > the tab you looked at last.

const { EventEmitter } = require('events');
const registry = require('./services');
const BUILT_IN_IDS = require('./discord-apps');

const STATUS_DISPLAY = { name: 0, state: 1, details: 2 };

class Engine extends EventEmitter {
  constructor({ store, bridge, detector, presence, appIcons, updater, info }) {
    super();
    this.store = store;
    this.bridge = bridge;
    this.detector = detector;
    this.presence = presence;
    this.appIcons = appIcons;
    this.updater = updater;
    this.info = info;
    this.sources = [];
    this.current = null;
    this.lastBroadcast = '';

    store.on('change', () => this.schedule());
    bridge.on('change', () => this.schedule());
    bridge.on('hello', () => { this.lastBroadcast = ''; this.schedule(); });
    bridge.on('status', () => this.emitState());
    detector.on('change', () => this.schedule());
    presence.on('status', () => this.emitState());
    if (updater) updater.on('change', () => this.emitState());
    presence.on('applied', () => this.emitState());
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

    for (const src of sources) {
      if (!s.enabled) src.status = 'off';
      else if (!src.enabled) src.status = 'disabled';
      else if (!src.activity) src.status = 'hidden';
      else if (!src.clientId) src.status = 'setup';
      else src.status = src === chosen ? 'live' : 'standby';
    }
    sources.sort((a, b) => (b.status === 'live') - (a.status === 'live') || b.focusedAt - a.focusedAt);

    this.sources = sources;
    this.current = chosen;

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
    this.presence.update(chosen ? { clientId: chosen.clientId, activity: chosen.activity } : null, idleClientId);

    const summary = JSON.stringify({
      type: 'state',
      sharing: s.enabled,
      current: chosen ? { service: chosen.service, details: chosen.activity.details || null, state: chosen.activity.state || null } : null,
    });
    if (summary !== this.lastBroadcast) {
      this.lastBroadcast = summary;
      this.bridge.broadcast(JSON.parse(summary));
    }

    this.emitState();
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
      update: this.updater ? this.updater.state : { status: 'dev' },
      sources: this.sources.map(({ key, service, browser, source, activity, playing, status, focusedAt }) =>
        ({ key, service, browser, source, activity, playing, status, focusedAt })),
      current: this.current ? { key: this.current.key, service: this.current.service, activity: this.current.activity } : null,
      paths: this.info.paths,
      packaged: this.info.packaged,
    };
  }
}

module.exports = { Engine };
