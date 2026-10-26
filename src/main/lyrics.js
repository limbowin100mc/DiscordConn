'use strict';

// Synced lyrics from LRCLIB (lrclib.net: free, no account). Cached per song.

const UA = 'Presence Hub (https://github.com/limbowin100mc/DiscordConn)';
const norm = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

// "[00:27.16] I've been tryna call" -> [{ t: 27160, text: "I've been tryna call" }, ...]
function parseLrc(lrc) {
  if (!lrc) return null;
  const lines = [];
  for (const raw of String(lrc).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push({ t: Math.round((Number(s[1]) * 60 + Number(s[2])) * 1000), text });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length ? lines : null;
}

// "Song (Official Video)" -> "Song"; "Artist, Other feat. X" -> "Artist"
const cleanTitle = (t) => String(t || '').replace(/\s*[([](?:official[^)\]]*|lyrics?[^)\]]*|audio|video|visuali[sz]er|explicit|remaster(?:ed)?[^)\]]*|hd|4k)[)\]]/gi, '').trim();
const mainArtist = (a) => String(a || '').split(/,| & | x | feat\.? | ft\.? /i)[0].trim();

class Lyrics {
  constructor(fetcher, onUpdate) {
    this.fetch = fetcher;
    this.onUpdate = onUpdate;
    this.cache = new Map(); // song -> { lines, at, ttl, pending }
  }

  // The synced lines for a song: an array, null (none found), or undefined (still loading).
  get({ title, artist, album, duration }) {
    const key = `${norm(mainArtist(artist))}|${norm(cleanTitle(title))}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && (hit.pending || now - hit.at < hit.ttl)) return hit.lines;
    const entry = { lines: hit ? hit.lines : undefined, at: now, ttl: 24 * 3600e3, pending: true };
    this.cache.set(key, entry);
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    this._load(title, artist, album, duration)
      .then((lines) => {
        entry.lines = lines;
        if (!lines) entry.ttl = 6 * 3600e3;
      })
      .catch(() => {
        // LRCLIB busy or offline: try again in a couple of minutes.
        if (entry.lines === undefined) entry.lines = null;
        entry.ttl = 2 * 60e3;
      })
      .finally(() => {
        entry.pending = false;
        entry.at = Date.now();
        this.onUpdate();
      });
    return entry.lines;
  }

  async _load(title, artist, album, duration) {
    const headers = { 'User-Agent': UA };
    const track = cleanTitle(title);
    const who = mainArtist(artist);
    // Exact match first (needs the album and length), then a search by name.
    if (album && duration) {
      const res = await this.fetch(`https://lrclib.net/api/get?${new URLSearchParams({ track_name: track, artist_name: who, album_name: album, duration: String(Math.round(duration)) })}`, { headers });
      if (res.ok) {
        const song = await res.json();
        const lines = parseLrc(song.syncedLyrics);
        if (lines) return lines;
        if (song.instrumental) return null;
      } else if (res.status >= 500) {
        throw new Error('lrclib busy');
      }
    }
    const res = await this.fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: track, artist_name: who })}`, { headers });
    if (!res.ok) {
      if (res.status >= 500) throw new Error('lrclib busy');
      return null;
    }
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const best = list
      .filter((s) => s.syncedLyrics && (!duration || Math.abs(s.duration - duration) <= 4))
      .sort((a, b) => Math.abs(a.duration - (duration || 0)) - Math.abs(b.duration - (duration || 0)))[0];
    return best ? parseLrc(best.syncedLyrics) : null;
  }
}

// The line being sung at `ms` into the song: its text ('' for an instrumental gap), or
// null before the first line.
function lineAt(lines, ms) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : lines[found].text;
}

module.exports = { Lyrics, lineAt, parseLrc };
