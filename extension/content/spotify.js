'use strict';

(() => {
  const PH = window.PresenceHub;

  function trackUrl(widget) {
    const link = widget && widget.querySelector('[data-testid="context-item-link"], a[href*="/track/"], a[href*="/episode/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch { /* keep raw */ }
    const m = decoded.match(/spotify:(track|episode):([A-Za-z0-9]+)/) || decoded.match(/\/(track|episode)\/([A-Za-z0-9]+)/);
    if (m) return `https://open.spotify.com/${m[1]}/${m[2]}`;
    return PH.abs(href.split('?')[0]) || null;
  }

  function reportedPosition() {
    const raw = document.documentElement.getAttribute('data-presence-hub-position');
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      return p.duration > 0 && Number.isFinite(p.position) && Number.isFinite(p.at) ? p : null;
    } catch {
      return null;
    }
  }

  function isPlaying(md) {
    if (md.playbackState === 'playing') return true;
    if (md.playbackState === 'paused') return false;
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    const label = btn ? (btn.getAttribute('aria-label') || '').toLowerCase() : '';
    if (/pause|paus|pausa|пауза|暫停|暂停|一時停止|일시정지|duraklat|wstrzymaj/.test(label)) return true;
    if (label) return false;
    return / • /.test(document.title);
  }

  PH.register('spotify', () => {
    const widget = document.querySelector('[data-testid="now-playing-widget"]');
    const md = PH.media();

    let title = widget
      ? PH.text('[data-testid="context-item-link"]', widget) || PH.text('[data-testid="context-item-info-title"]', widget)
      : '';
    let artists = widget
      ? [...new Set([...widget.querySelectorAll('[data-testid="context-item-info-artist"]')].map((a) => a.textContent.trim()).filter(Boolean))]
      : [];
    if (!artists.length && widget) {
      const sub = PH.text('[data-testid="context-item-info-subtitles"]', widget);
      if (sub) artists = [sub];
    }
    if (!title) title = md.title;
    if (!artists.length && md.artist) artists = [md.artist];
    if (!title) return { idle: true };

    const img = widget && widget.querySelector('img[src^="https://"]');
    const cover = md.artwork || (img ? img.src : null);

    const playing = isPlaying(md);

    // Progress: what Spotify reported to the browser's media controls (see media-hook.js),
    // then the on-screen timer, then the progress slider.
    let position = null;
    let duration = null;
    const reported = reportedPosition();
    if (reported) {
      const since = playing ? ((Date.now() - reported.at) / 1000) * reported.rate : 0;
      duration = reported.duration;
      position = Math.min(duration, reported.position + since);
    } else {
      const posText = PH.text('[data-testid="playback-position"]');
      const durText = PH.text('[data-testid="playback-duration"]');
      position = PH.parseTime(posText);
      duration = PH.parseTime(durText);
      if (durText.startsWith('-') && position != null && duration != null) duration += position; // "time left" mode
      const range = document.querySelector('[data-testid="playback-progressbar"] input[type="range"]');
      if (range && (position == null || duration == null)) {
        const max = Number(range.max);
        const val = Number(range.value);
        if (max > 0) {
          if (duration == null) duration = max / 1000;
          if (position == null) position = val / 1000;
        }
      }
    }

    return {
      title,
      artists,
      album: md.album || '',
      cover,
      url: trackUrl(widget),
      playing,
      timeline: PH.timeline(`sp:${title}|${artists.join(',')}`, position, duration, playing),
    };
  });
})();
