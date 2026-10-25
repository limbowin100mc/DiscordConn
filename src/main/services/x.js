'use strict';

const { activity, button } = require('./util');

const PAGES = {
  home: 'Scrolling the timeline',
  explore: 'Exploring',
  search: 'Searching X',
  notifications: 'Checking notifications',
  messages: 'Reading messages',
  bookmarks: 'Looking at bookmarks',
  post: 'Reading a post',
  profile: 'Viewing a profile',
  lists: 'Browsing lists',
  communities: 'Browsing communities',
  space: 'Listening to a Space',
  grok: 'Chatting with Grok',
  compose: 'Writing a post',
  settings: 'Changing settings',
  browse: 'Browsing X',
};

module.exports = {
  id: 'x',
  name: 'X',
  site: 'x.com',
  url: 'https://x.com',
  description: 'Shows you are on X and what you are doing there (timeline, posts, profiles).',
  color: '#e7e9ea',
  logo: 'logos/x.png',
  logoUrl: 'https://abs.twimg.com/responsive-web/client-web/icon-ios.77d25eba.png',
  activityType: 3, // Watching
  options: [
    { key: 'showPage', label: 'Show what you are doing', hint: 'E.g. "Reading a post". Off just shows "Browsing X".', default: true },
    { key: 'showUsernames', label: 'Show whose profile or post', hint: 'Shows the @username you are looking at.', default: false },
    { key: 'showSearch', label: 'Show what you search for', hint: 'Off keeps your search terms private.', default: false },
  ],

  build(d, o, ctx) {
    const details = o.showPage ? PAGES[d.page] || PAGES.browse : PAGES.browse;
    let state = null;
    const buttons = [];
    if (o.showPage) {
      if (o.showUsernames && d.username && d.page === 'profile') {
        state = d.displayName ? `${d.displayName} (@${d.username})` : `@${d.username}`;
        buttons.push(button('View Profile', `https://x.com/${d.username}`));
      } else if (o.showUsernames && d.username && d.page === 'post') {
        state = d.displayName ? `by ${d.displayName} (@${d.username})` : `by @${d.username}`;
        if (d.url) buttons.push(button('View Post', d.url));
      } else if (o.showSearch && d.page === 'search' && d.query) {
        state = `“${d.query}”`;
      }
    }
    return {
      playing: false,
      activity: activity({
        details,
        state,
        large: ctx.logo,
        largeText: 'x.com',
        start: d.sessionStart,
        buttons,
      }),
    };
  },
};
