'use strict';

// Fills in what Windows doesn't tell us: the YouTube video (for its thumbnail and
// link), album art for songs, and Kick channel details. Results are cached and
// lookups for the same thing are only made once.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

class Lookups {
  constructor(fetcher, onUpdate) {
    this.fetch = fetcher;
    this.onUpdate = onUpdate;
    this.cache = new Map(); // key -> { value, at, ttl, pending }
  }

  // Returns the cached value right away (undefined while the first lookup runs).
  _get(key, ttl, load) {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && (hit.pending || now - hit.at < hit.ttl)) return hit.value;
    const entry = { value: hit ? hit.value : undefined, at: now, ttl, pending: true };
    this.cache.set(key, entry);
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    load()
      .then((value) => { entry.value = value; })
      .catch(() => { if (entry.value === undefined) entry.value = null; entry.ttl = Math.min(ttl, 60000); })
      .finally(() => {
        entry.pending = false;
        entry.at = Date.now();
        this.onUpdate();
      });
    return entry.value;
  }

  // { videoId, title, channel, live } for a video with exactly this title and channel, or null.
  youtube(title, channel) {
    return this._get(`yt:${title}|${channel}`, 24 * 3600e3, async () => {
      const res = await this.fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20251020.00.00', hl: 'en' } }, // region: from your connection
          query: channel ? `${title} ${channel}` : title,
        }),
      });
      if (!res.ok) throw new Error(`youtube ${res.status}`);
      const json = await res.json();
      const videos = [];
      (function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 40 || videos.length >= 20) return;
        if (o.videoRenderer) {
          const v = o.videoRenderer;
          videos.push({
            videoId: v.videoId,
            title: v.title && v.title.runs && v.title.runs.map((r) => r.text).join(''),
            channel: v.ownerText && v.ownerText.runs && v.ownerText.runs.map((r) => r.text).join(''),
            live: !!(v.badges || []).some((b) => b.metadataBadgeRenderer && /LIVE/.test(b.metadataBadgeRenderer.style || '')),
          });
          return;
        }
        for (const k of Object.keys(o)) walk(o[k], depth + 1);
      })(json, 0);
      const t = norm(title);
      const c = norm(channel);
      // Channel names can differ a little ("Queen" vs "Queen Official", "X - Topic").
      const sameChannel = (v) => {
        const vc = norm(v.channel);
        return !c || (!!vc && (vc === c || vc.includes(c) || c.includes(vc)));
      };
      return videos.find((v) => norm(v.title) === t && sameChannel(v)) || null;
    });
  }

  // Album art URL for a song, or null.
  albumArt(title, artist, album) {
    return this._get(`art:${title}|${artist}|${album}`, 7 * 24 * 3600e3, async () => {
      const term = `${title} ${String(artist || '').split(/,|&| feat\.? | x /i)[0]}`;
      const res = await this.fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '15' })}`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`itunes ${res.status}`);
      const { results = [] } = await res.json();
      const t = norm(title);
      const a = norm(artist);
      const al = norm(album);
      const score = (r) => (norm(r.trackName) === t ? 4 : norm(r.trackName).startsWith(t) ? 1 : 0)
        + (a && norm(r.artistName).includes(a.split(',')[0]) ? 2 : 0)
        + (al && norm(r.collectionName).replace(/ - (single|ep)$/, '') === al ? 3 : 0);
      const best = results.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 5).sort((x, y) => y.s - x.s)[0];
      return best && best.r.artworkUrl100 ? best.r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/512x512bb.') : null;
    });
  }

  // What a Netflix /watch/<id> is: { title, episode, kind, image, showId } or null.
  // Uses Netflix's public title page (no login), which redirects episode ids to their
  // show and embeds every season's episodes in `netflix.reactContext`.
  netflix(id) {
    return this._get(`nf:${id}`, 6 * 3600e3, async () => {
      const res = await this.fetch(`https://www.netflix.com/title/${id}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' },
      });
      if (!res.ok) throw new Error(`netflix ${res.status}`);
      const html = await res.text();
      const decode = (s) => String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .trim();

      let ctx = null;
      const start = html.indexOf('netflix.reactContext = ');
      if (start >= 0) {
        const from = start + 'netflix.reactContext = '.length;
        const end = html.indexOf(';</script>', from);
        try {
          // It's a JS object literal with \xNN escapes; turn those into JSON \u00NN.
          ctx = JSON.parse(html.slice(from, end).replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
        } catch { ctx = null; }
      }

      const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const title = h1 ? decode(h1[1]) : '';
      if (!title || /^netflix$/i.test(title)) return null;

      // Find the episode with this id, and its season.
      let episode = '';
      let seasons = 0;
      (function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 60 || episode) return;
        if (o.__typename === 'SeasonsConnection' && Array.isArray(o.edges)) {
          seasons = o.edges.length;
          o.edges.forEach((edge, i) => {
            const season = edge && edge.node;
            const eps = season && season.episodes && season.episodes.edges;
            const label = season && String(season.numberLabelV2 || '').match(/(\d+)/);
            const sNum = label ? Number(label[1]) : i + 1;
            for (const e of eps || []) {
              const ep = e && e.node;
              if (ep && String(ep.videoId) === String(id)) {
                episode = `S${sNum}:E${ep.number}${ep.title ? ` · ${ep.title}` : ''}`;
              }
            }
          });
          return;
        }
        for (const k of Object.keys(o)) walk(o[k], depth + 1);
      })(ctx, 0);

      const hero = html.match(/data-uia="hero"[\s\S]{0,4000}?<img[^>]+src="(https:\/\/[^"]+nflxso\.net[^"]+)"/);
      const image = hero ? decode(hero[1]) : null;
      const showId = (res.url && (res.url.match(/\/title\/(\d+)/) || [])[1]) || null;
      return { title, episode, kind: seasons ? 'show' : 'movie', image: image && image.length <= 256 ? image : null, showId };
    });
  }

  // A Prime Video title's name and cover art from its public page: { title, image } or null.
  primevideo(id) {
    return this._get(`pv:${id}`, 6 * 3600e3, async () => {
      const res = await this.fetch(`https://www.primevideo.com/detail/${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' },
      });
      if (!res.ok) throw new Error(`primevideo ${res.status}`);
      const html = await res.text();
      const t = html.match(/<title>Prime Video:\s*([^<]+)<\/title>/);
      if (!t) return null;
      const title = t[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
      // The page's first "images" block belongs to the title itself (later ones are recommendations).
      const images = html.match(/"images":\{[^{}]*"(?:packshot|covershot)"[^{}]*\}/);
      let image = null;
      if (images) {
        const pick = images[0].match(/"packshot":"(https:[^"]+)"/) || images[0].match(/"covershot":"(https:[^"]+)"/);
        if (pick && pick[1].length <= 256) image = pick[1].replace(/\\u002F/g, '/');
      }
      return { title, image };
    });
  }

  // Kick channel info by display name, or null.
  kick(name) {
    return this._get(`kick:${name}`, 60000, async () => {
      const slugs = [...new Set([name.toLowerCase(), name.toLowerCase().replace(/_/g, '-')])];
      for (const slug of slugs) {
        const res = await this.fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
          headers: { Accept: 'application/json', 'User-Agent': UA },
        });
        if (!res.ok) continue;
        const ch = await res.json();
        const ls = ch.livestream;
        const start = ls && ls.start_time ? String(ls.start_time).replace(' ', 'T') : null;
        return {
          slug: ch.slug || slug,
          channel: (ch.user && ch.user.username) || name,
          avatar: (ch.user && ch.user.profile_pic) || null,
          live: !!(ls && ls.is_live),
          title: (ls && ls.session_title) || '',
          category: (ls && ls.categories && ls.categories[0] && ls.categories[0].name) || '',
          liveSince: start ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(start) ? start : `${start}Z`) || null : null,
        };
      }
      return null;
    });
  }
}

module.exports = { Lookups };
