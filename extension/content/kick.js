'use strict';

(() => {
  const PH = window.PresenceHub;

  // Top-level paths on kick.com that are not channel names.
  const RESERVED = new Set([
    'browse', 'categories', 'category', 'following', 'search', 'video', 'videos', 'clips', 'clip', 'dashboard',
    'settings', 'subscriptions', 'messages', 'notifications', 'terms-of-service', 'privacy-policy',
    'community-guidelines', 'dmca-policy', 'about', 'faq', 'contact', 'careers', 'apps', 'auth', 'login',
    'signup', 'wallet', 'transactions', 'popout', 'drops', 'help', 'creator', 'download', 'kick-tv', 'stream',
  ]);

  // Kick's own API, called from the page itself (same origin, same cookies).
  const cache = new Map();
  function api(path, maxAge) {
    const now = Date.now();
    const hit = cache.get(path);
    if (hit && (hit.pending || now - hit.at < maxAge)) return hit.data;
    const entry = { data: hit ? hit.data : null, at: now, pending: true };
    cache.set(path, entry);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    fetch(location.origin + path, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (json) entry.data = json; })
      .catch(() => {})
      .finally(() => {
        entry.pending = false;
        entry.at = Date.now();
        PH.poke();
      });
    return entry.data;
  }

  // Kick sends "2026-01-31 18:00:00" (UTC without a zone) or full ISO strings.
  function parseUtc(s) {
    if (!s) return null;
    const iso = String(s).replace(' ', 'T');
    const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
    return Number.isFinite(t) ? t : null;
  }

  let watch = { key: null, start: Date.now() };
  function watchStart(key) {
    if (watch.key !== key) watch = { key, start: Date.now() };
    return watch.start;
  }

  PH.register('kick', () => {
    const url = new URL(location.href);
    const seg = url.pathname.split('/').filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    const video = document.querySelector('video');
    const playing = !!(video && !video.paused && !video.ended);

    if (!seg.length) return { page: 'home' };
    const first = seg[0].toLowerCase();

    // Past broadcast: /<channel>/videos/<id> or /video/<id>
    const vodId = (seg[1] === 'videos' && seg[2]) || (first === 'video' && seg[1]) || null;
    if (vodId) {
      const v = api(`/api/v1/video/${encodeURIComponent(vodId)}`, 10 * 60 * 1000);
      const ls = v && v.livestream;
      const ch = ls && ls.channel;
      const user = ch && ch.user;
      const key = `vod:${vodId}`;
      const channelSlug = (ch && ch.slug) || (first === 'video' ? '' : seg[0]);
      return {
        page: 'vod',
        slug: channelSlug,
        channel: (user && user.username) || channelSlug,
        avatar: (user && (user.profile_pic || user.profilepic)) || null,
        title: (ls && ls.session_title) || '',
        category: (ls && ls.categories && ls.categories[0] && ls.categories[0].name) || '',
        playing,
        url: channelSlug ? `https://kick.com/${channelSlug}/videos/${vodId}` : `https://kick.com/video/${vodId}`,
        timeline: video ? PH.timeline(key, video.currentTime, video.duration, playing, video.playbackRate) : null,
        watchStart: watchStart(key),
      };
    }

    if (first === 'category' || first === 'categories') {
      const slug = seg[seg.length - 1];
      const pretty = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return { page: 'category', category: seg.length > 1 ? PH.text('main h1') || pretty : null };
    }
    if (first === 'following') return { page: 'following' };
    if (RESERVED.has(first)) return { page: 'browse' };

    // Channel page (live or offline)
    const slug = first;
    const ch = api(`/api/v2/channels/${encodeURIComponent(slug)}`, 60 * 1000);
    const ls = ch && ch.livestream;
    const user = ch && ch.user;
    return {
      page: 'stream',
      slug,
      channel: (user && user.username) || slug,
      avatar: (user && user.profile_pic) || null,
      // Until the API answers, assume a playing player means a live stream.
      live: ch ? !!(ls && ls.is_live) : playing,
      title: (ls && ls.session_title) || '',
      category: (ls && ls.categories && ls.categories[0] && ls.categories[0].name) || '',
      liveSince: parseUtc(ls && ls.start_time),
      playing,
      url: `https://kick.com/${slug}`,
      watchStart: watchStart(`live:${slug}`),
    };
  });
})();
