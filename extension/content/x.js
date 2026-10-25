'use strict';

(() => {
  const PH = window.PresenceHub;

  // Top-level paths on x.com that are not usernames.
  const RESERVED = new Set([
    'home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose', 'jobs', 'premium',
    'premium_sign_up', 'verified-orgs-signup', 'login', 'logout', 'signup', 'tos', 'privacy', 'account',
    'intent', 'hashtag', 'share', 'download', 'grok',
  ]);

  const cleanTitle = (t) => String(t || '').replace(/^\(\d+\+?\)\s*/, '').trim();

  PH.register('x', () => {
    const url = new URL(location.href);
    const seg = url.pathname.split('/').filter(Boolean);
    const [a, b] = seg;
    const title = cleanTitle(document.title);

    if (!a || a === 'home') return { page: 'home' };
    if (a === 'explore' || a === 'hashtag') return { page: 'explore' };
    if (a === 'search') return { page: 'search', query: url.searchParams.get('q') || '' };
    if (a === 'notifications') return { page: 'notifications' };
    if (a === 'messages' || (a === 'i' && b === 'chat')) return { page: 'messages', url: 'https://x.com/messages' };
    if (a === 'compose' || (a === 'i' && b === 'compose')) return { page: 'compose' };
    if (a === 'settings') return { page: 'settings' };
    if (a === 'grok' || (a === 'i' && b === 'grok')) return { page: 'grok' };
    if (a === 'i') {
      if (b === 'bookmarks') return { page: 'bookmarks' };
      if (b === 'spaces') return { page: 'space' };
      if (b === 'lists') return { page: 'lists' };
      if (b === 'communities') return { page: 'communities' };
      return { page: 'browse' };
    }
    if (RESERVED.has(a)) return { page: 'browse' };

    if (b === 'status' && seg[2]) {
      const m = title.match(/^(.+?) on X:/);
      return { page: 'post', username: a, displayName: m ? m[1] : null, url: `https://x.com/${a}/status/${seg[2]}` };
    }
    if (b === 'lists') return { page: 'lists' };
    if (b === 'communities') return { page: 'communities' };

    const m = title.match(/^(.+?) \(@([A-Za-z0-9_]+)\)/);
    return {
      page: 'profile',
      username: a,
      displayName: m && m[2].toLowerCase() === a.toLowerCase() ? m[1] : null,
      url: `https://x.com/${a}`,
    };
  });
})();
