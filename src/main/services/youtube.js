'use strict';

const { activity, button } = require('./util');

const BROWSE = {
  home: ['Browsing YouTube', 'Home'],
  subscriptions: ['Browsing YouTube', 'Subscriptions'],
  library: ['Browsing YouTube', 'Library'],
  history: ['Browsing YouTube', 'History'],
  playlist: ['Browsing a playlist', null],
  browse: ['Browsing YouTube', null],
};

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  site: 'youtube.com',
  url: 'https://www.youtube.com',
  description: 'Videos, Shorts and live streams you watch, with thumbnail and time left.',
  color: '#ff0033',
  logo: 'logos/youtube.png',
  logoUrl: 'https://www.gstatic.com/images/branding/product/1x/youtube_512dp.png',
  activityType: 3, // Watching
  options: [
    { key: 'showThumbnail', label: 'Show video thumbnail', hint: 'Use the video thumbnail as the big image.', default: true },
    { key: 'showButtons', label: 'Show "Watch" button', hint: 'Lets friends open the video from your profile.', default: true },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: true },
    { key: 'showBrowsing', label: 'Show when just browsing', hint: 'Home page, subscriptions, channels and search.', default: true },
    { key: 'showSearch', label: 'Show what you search for', hint: 'Off keeps your search terms private.', default: false },
  ],

  build(d, o, ctx) {
    if (d.page === 'watch' || d.page === 'shorts') {
      if (!d.playing && !o.showWhenPaused) return null;
      const paused = !d.playing;
      const thumb = o.showThumbnail && d.thumbnail;
      let start;
      let end;
      if (d.playing && !d.ad) {
        if (d.live) start = d.watchStart;
        else if (d.timeline) ({ start, end } = d.timeline);
      }
      let state = d.channel;
      if (d.ad) state = 'Watching an ad';
      else if (paused) state = d.channel ? `Paused · ${d.channel}` : 'Paused';
      else if (d.live) state = d.channel ? `🔴 Live · ${d.channel}` : '🔴 Live';
      const label = d.page === 'shorts' ? 'Watch Short' : d.live ? 'Watch Live' : 'Watch on YouTube';
      return {
        playing: !!d.playing,
        activity: activity({
          details: d.title || (d.page === 'shorts' ? 'Watching Shorts' : 'Watching a video'),
          state,
          large: thumb || ctx.logo,
          largeText: thumb ? d.title : 'YouTube',
          small: thumb ? ctx.logo : undefined,
          smallText: paused ? 'Paused' : d.live ? 'Live on YouTube' : 'YouTube',
          start,
          end,
          buttons: o.showButtons ? [button(label, d.url)] : [],
        }),
      };
    }

    if (!o.showBrowsing) return null;
    let details;
    let state;
    if (d.page === 'search') {
      details = 'Searching YouTube';
      state = o.showSearch && d.query ? `“${d.query}”` : null;
    } else if (d.page === 'channel') {
      details = 'Viewing a channel';
      state = d.channel;
    } else {
      [details, state] = BROWSE[d.page] || BROWSE.browse;
    }
    return {
      playing: false,
      activity: activity({
        details,
        state,
        large: ctx.logo,
        largeText: 'YouTube',
        start: d.sessionStart,
        buttons: d.page === 'channel' && o.showButtons ? [button('View Channel', d.url)] : [],
      }),
    };
  },
};
