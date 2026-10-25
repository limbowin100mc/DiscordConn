'use strict';

(() => {
  const PH = window.PresenceHub;

  // Title info from Netflix's own metadata API (same origin, your login). The id in
  // /watch/<id> is the episode for shows; the answer describes the whole show.
  const meta = new Map();
  function metadata(id) {
    if (meta.has(id)) return meta.get(id);
    const entry = { pending: true };
    meta.set(id, entry);
    if (meta.size > 30) meta.delete(meta.keys().next().value);
    fetch(`${location.origin}/nq/website/memberapi/release/metadata?movieid=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const v = json && json.video;
        if (!v) return;
        entry.title = v.title || '';
        entry.kind = v.type || '';
        entry.showId = v.id || null;
        const art = (v.boxart && v.boxart[0]) || (v.artwork && v.artwork[0]) || (v.storyart && v.storyart[0]);
        entry.image = art && /^https:/.test(art.url) ? art.url : null;
        if (v.type === 'show') {
          for (const season of v.seasons || []) {
            for (const ep of season.episodes || []) {
              if (String(ep.id || ep.episodeId) === String(v.currentEpisode || id)) {
                entry.episode = `S${season.seq}:E${ep.seq}${ep.title ? ` · ${ep.title}` : ''}`;
              }
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        entry.pending = false;
        PH.poke();
      });
    return entry;
  }

  // The player shows "<h4>Show</h4><span>S1:E3</span><span>Episode</span>" while its
  // controls are visible; remember it per video because the controls hide again.
  const fromPlayer = new Map();
  function playerTitle(id) {
    const box = document.querySelector('[data-uia="video-title"]');
    if (box) {
      const h = box.querySelector('h4');
      const title = (h ? h.textContent : box.firstChild && box.firstChild.textContent || '').trim();
      const parts = [...box.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean);
      if (title) fromPlayer.set(id, { title, episode: parts.join(' · ') });
    }
    return fromPlayer.get(id) || {};
  }

  PH.register('netflix', () => {
    // Paths can start with a country code: /rs/title/80057281, /rs-en/title/...
    const path = location.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, '');
    let m;
    if ((m = path.match(/^\/watch\/(\d+)/))) {
      const id = m[1];
      const video = document.querySelector('video');
      const playing = !!(video && !video.paused && !video.ended);
      const p = playerTitle(id);
      const md = metadata(id);
      const title = md.title || p.title || '';
      return {
        page: 'watch',
        videoId: id,
        title,
        episode: md.episode || p.episode || '',
        kind: md.kind || (p.episode ? 'show' : ''),
        image: md.image || null,
        url: `https://www.netflix.com/title/${md.showId || id}`,
        playing,
        timeline: video ? PH.timeline(`nf:${id}`, video.currentTime, video.duration, playing, video.playbackRate) : null,
        watchStart: PH.sessionStart,
      };
    }
    const titleId = (path.match(/^\/title\/(\d+)/) || [])[1] || new URLSearchParams(location.search).get('jbv');
    if (titleId) {
      const md = metadata(titleId);
      const t = md.title || (document.title.match(/^Watch (.+?) \| Netflix/) || [])[1] || '';
      return { page: 'title', title: t };
    }
    return { page: 'browse' };
  });
})();
