'use strict';

// Listening / watching stats, kept only on this PC (userData/stats.json).
// Every few seconds, whatever is playing gets that time added to today's totals.

const fs = require('fs');
const path = require('path');

const MUSIC = new Set(['spotify', 'ytmusic']);
const KEEP_DAYS = 400;
const MAX_GAP = 20000; // don't count time across sleeps or long stalls

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// What a playing source counts as: a song, a show, a video, a stream.
function itemOf(src) {
  const d = src.data || {};
  switch (src.service) {
    case 'spotify':
    case 'ytmusic':
      return d.title ? { key: `${d.title}|${(d.artists || []).join(', ')}`, title: d.title, sub: (d.artists || []).join(', ') } : null;
    case 'youtube':
      return d.title ? { key: `${d.title}|${d.channel || ''}`, title: d.title, sub: d.channel || '' } : null;
    case 'netflix':
    case 'primevideo':
      return { key: d.title || '(unknown)', title: d.title || '', sub: '' };
    case 'kick':
      return d.channel ? { key: d.channel, title: d.channel, sub: d.category || '' } : null;
    default:
      return null;
  }
}

class Stats {
  constructor(dir) {
    this.file = path.join(dir, 'stats.json');
    this.data = { version: 1, days: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved && saved.days) this.data = saved;
    } catch { /* first run */ }
    this.lastTick = 0;
    this.active = new Set();
  }

  tick(sources, now, enabled) {
    const dt = this.lastTick ? Math.min(now - this.lastTick, MAX_GAP) / 1000 : 0;
    this.lastTick = now;
    if (!enabled) { this.active = new Set(); return; }
    const playingNow = new Set();
    const day = (this.data.days[dayKey(now)] = this.data.days[dayKey(now)] || {});
    for (const src of sources) {
      if (!src.playing) continue;
      const item = itemOf(src);
      if (!item) continue;
      const id = `${src.service}|${item.key}`;
      playingNow.add(id);
      const svc = (day[src.service] = day[src.service] || { secs: 0, items: {} });
      const it = (svc.items[item.key] = svc.items[item.key] || { title: item.title, sub: item.sub, secs: 0, plays: 0 });
      svc.secs += dt;
      it.secs += dt;
      if (!this.active.has(id)) it.plays += 1;
    }
    this.active = playingNow;
    if (playingNow.size) this._saveSoon();
  }

  // Totals for the last `days` days (0 = today only, Infinity = all time).
  summary(days, serviceKinds) {
    const keys = Object.keys(this.data.days).sort();
    const today = dayKey(Date.now());
    const first = days === Infinity ? keys[0] || today : dayKey(Date.now() - Math.max(0, days - 1) * 86400e3);
    const inRange = keys.filter((k) => k >= first && k <= today);
    const kindOf = (svc) => (MUSIC.has(svc) ? 'listen' : serviceKinds[svc] || 'watch');

    const byService = {};
    const songs = {};
    const artists = {};
    const watched = {};
    const streamers = {};
    let listen = 0;
    let watch = 0;
    for (const k of inRange) {
      for (const [svc, v] of Object.entries(this.data.days[k])) {
        byService[svc] = (byService[svc] || 0) + v.secs;
        if (kindOf(svc) === 'listen') listen += v.secs; else watch += v.secs;
        for (const [key, it] of Object.entries(v.items)) {
          const add = (map, id, extra) => {
            const e = (map[id] = map[id] || { ...extra, secs: 0, plays: 0 });
            e.secs += it.secs;
            e.plays += it.plays;
          };
          if (MUSIC.has(svc)) {
            add(songs, key, { title: it.title, sub: it.sub, service: svc });
            if (it.sub) add(artists, it.sub, { title: it.sub, service: svc });
          } else if (svc === 'kick') {
            add(streamers, key, { title: it.title, sub: it.sub, service: svc });
          } else {
            add(watched, `${svc}|${key}`, { title: it.title, sub: it.sub, service: svc });
          }
        }
      }
    }

    // One bar per day (up to 30 days shown), split into listening and watching.
    const chartDays = days === Infinity ? 30 : Math.max(1, days);
    const perDay = [];
    for (let i = chartDays - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400e3);
      const v = this.data.days[k] || {};
      let l = 0;
      let w = 0;
      for (const [svc, x] of Object.entries(v)) if (kindOf(svc) === 'listen') l += x.secs; else w += x.secs;
      perDay.push({ date: k, listen: Math.round(l), watch: Math.round(w) });
    }

    const top = (map, n = 8) => Object.values(map).sort((a, b) => b.secs - a.secs).slice(0, n).map((e) => ({ ...e, secs: Math.round(e.secs) }));
    return {
      listen: Math.round(listen),
      watch: Math.round(watch),
      daysActive: inRange.filter((k) => Object.values(this.data.days[k]).some((v) => v.secs > 60)).length,
      byService: Object.entries(byService).map(([service, secs]) => ({ service, secs: Math.round(secs) })).filter((x) => x.secs > 0).sort((a, b) => b.secs - a.secs),
      perDay,
      topSongs: top(songs),
      topArtists: top(artists, 5),
      topWatched: top(watched),
      topStreamers: top(streamers, 5),
      since: keys[0] || null,
    };
  }

  reset() {
    this.data = { version: 1, days: {} };
    this.active = new Set();
    this.flush();
  }

  _saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 60000);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const cutoff = dayKey(Date.now() - KEEP_DAYS * 86400e3);
    for (const k of Object.keys(this.data.days)) if (k < cutoff) delete this.data.days[k];
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save stats:', err.message);
    }
  }
}

module.exports = { Stats };
