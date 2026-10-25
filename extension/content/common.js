'use strict';

// Shared helpers for the site scripts. A site script calls
//   PresenceHub.register('<service id>', () => ({ ...what is on the page }))
// and this file takes care of polling, change detection and talking to the extension.
(() => {
  // After the extension is reloaded/updated, the newest copy takes over from older ones.
  document.dispatchEvent(new CustomEvent('presencehub:takeover'));

  const HEARTBEAT = 15000;
  const MEDIA_EVENTS = ['play', 'playing', 'pause', 'seeked', 'ended', 'loadedmetadata', 'durationchange', 'ratechange', 'emptied'];
  const timelines = new Map();

  const PH = {
    sessionStart: Date.now(),
    poke() {},

    register(service, collect, { interval = 1000 } = {}) {
      let last = '';
      let lastSent = 0;
      let queued = false;
      let stopped = false;
      let timer = null;
      let titleObserver = null;

      const send = (data) => {
        if (stopped) return;
        if (!chrome.runtime || !chrome.runtime.id) { stop(); return; }
        try {
          chrome.runtime.sendMessage({ type: 'presence', service, data }).catch(() => {});
        } catch {
          stop(); // extension was reloaded; this copy is orphaned
        }
      };

      const tick = () => {
        queued = false;
        if (stopped) return;
        let data = null;
        try {
          data = collect() || null;
        } catch (err) {
          console.debug('[Presence Hub]', err);
        }
        if (data) {
          if (data.sessionStart == null) data.sessionStart = PH.sessionStart;
          if (!('url' in data)) data.url = location.href;
          if (data.siteIcon == null) data.siteIcon = siteIcon();
        }
        const json = JSON.stringify(data);
        const now = Date.now();
        if (json !== last || now - lastSent > HEARTBEAT) {
          last = json;
          lastSent = now;
          send(data);
        }
      };

      const poke = () => {
        if (queued || stopped) return;
        queued = true;
        setTimeout(tick, 150);
      };

      const onMessage = (msg) => {
        if (msg && msg.type === 'resend') { last = ''; poke(); }
      };
      const onHide = () => send(null);

      function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        if (titleObserver) titleObserver.disconnect();
        for (const ev of MEDIA_EVENTS) document.removeEventListener(ev, poke, true);
        document.removeEventListener('visibilitychange', poke);
        window.removeEventListener('pagehide', onHide);
        try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* orphaned */ }
      }

      PH.poke = poke;
      timer = setInterval(tick, interval);
      for (const ev of MEDIA_EVENTS) document.addEventListener(ev, poke, true);
      document.addEventListener('visibilitychange', poke);
      window.addEventListener('pagehide', onHide);
      document.addEventListener('presencehub:takeover', stop, { once: true });
      chrome.runtime.onMessage.addListener(onMessage);
      const titleEl = document.querySelector('head > title');
      if (titleEl) {
        titleObserver = new MutationObserver(poke);
        titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
      tick();
    },

    // Trimmed text of the first element matching the selector.
    text(selector, root = document) {
      const el = root.querySelector(selector);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    },

    // "1:02:03" / "4:05" / "-2:10" -> seconds
    parseTime(str) {
      if (!str) return null;
      const parts = String(str).replace(/[^\d:]/g, '').split(':').filter((p) => p !== '');
      if (!parts.length) return null;
      let sec = 0;
      for (const p of parts) sec = sec * 60 + Number(p);
      return Number.isFinite(sec) ? sec : null;
    },

    // What the site told the browser's media controls (title, artist, artwork, play state).
    media() {
      const ms = navigator.mediaSession;
      const md = ms && ms.metadata;
      const out = { title: '', artist: '', album: '', artwork: '', playbackState: ms ? ms.playbackState : 'none' };
      if (!md) return out;
      out.title = md.title || '';
      out.artist = md.artist || '';
      out.album = md.album || '';
      let best = -1;
      for (const a of md.artwork || []) {
        const size = parseInt(String(a.sizes || '').split(/[x\s]/i)[0], 10) || 0;
        if (/^https:/.test(a.src) && size > best && size <= 640) {
          best = size;
          out.artwork = a.src;
        }
      }
      return out;
    },

    // Stable start/end timestamps for something that is playing.
    // Keeps the same start time unless you seek (or the position jumps), so Discord
    // is not updated every second. Also keeps counting correctly in background tabs
    // where the page may stop updating its on-screen timer.
    timeline(key, position, duration, playing, rate = 1) {
      const now = Date.now();
      let st = timelines.get(key);
      if (!st) {
        timelines.clear();
        st = { raw: null, rawAt: now, playing: null, start: null };
        timelines.set(key, st);
      }
      if (position == null || !Number.isFinite(position)) return null;
      if (position !== st.raw || playing !== st.playing) {
        st.raw = position;
        st.rawAt = now;
        st.playing = playing;
      }
      if (!playing) {
        st.start = null;
        return null;
      }
      const r = rate > 0 ? rate : 1;
      const estimate = st.raw + ((now - st.rawAt) / 1000) * r;
      const candidate = now - (estimate * 1000) / r;
      if (st.start == null || Math.abs(candidate - st.start) > 2500) st.start = candidate;
      const start = Math.round(st.start);
      const end = Number.isFinite(duration) && duration > 0 ? Math.round(start + (duration * 1000) / r) : null;
      return { start, end };
    },

    abs(url) {
      try { return new URL(url, location.href).href; } catch { return ''; }
    },
  };

  // The site's own high-res icon (used if the app has no logo for this site).
  function siteIcon() {
    let best = null;
    let bestSize = 0;
    for (const link of document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"]')) {
      const href = link.href;
      if (!/^https:/.test(href) || !/\.(png|jpe?g|webp)(\?|$)/i.test(href)) continue;
      const size = link.rel.includes('apple-touch-icon')
        ? 180
        : parseInt(String((link.sizes && link.sizes.value) || '').split('x')[0], 10) || 0;
      if (size > bestSize) {
        best = href;
        bestSize = size;
      }
    }
    return bestSize >= 96 ? best : null;
  }

  window.PresenceHub = PH;
})();
