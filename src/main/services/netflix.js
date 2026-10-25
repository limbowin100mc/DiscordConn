'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'netflix',
  name: 'Netflix',
  site: 'netflix.com',
  url: 'https://www.netflix.com',
  description: 'The movie or show you’re watching on Netflix, with episode and time left.',
  color: '#e50914',
  logo: 'logos/netflix.png',
  logoUrl: 'https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.png',
  activityType: 3, // Watching
  options: [
    { key: 'showTitle', label: 'Show what you’re watching', hint: 'Off just shows "Watching Netflix".', default: true },
    { key: 'showCover', label: 'Show the title’s artwork', hint: 'Use the show or movie artwork as the big image, when known.', default: true },
    { key: 'showButtons', label: 'Show "View on Netflix" button', hint: 'Links friends to the show’s Netflix page.', default: false },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: true },
    { key: 'showBrowsing', label: 'Show when just browsing', hint: 'Shows "Browsing Netflix" while you pick something.', default: true },
  ],

  // data: { page: 'watch' | 'title' | 'browse', title, episode, kind, image, url, playing, timeline, sessionStart }
  build(d, o, ctx) {
    if (d.page === 'watch') {
      if (!d.playing && !o.showWhenPaused) return null;
      const paused = !d.playing;
      const known = o.showTitle && d.title;
      const cover = known && o.showCover && d.image;
      let state = known ? d.episode || (d.kind === 'movie' ? 'Movie' : null) : null;
      if (paused) state = state ? `Paused · ${state}` : 'Paused';
      const tl = d.playing ? d.timeline : null;
      return {
        playing: !!d.playing,
        activity: activity({
          details: known ? d.title : null,
          state,
          large: cover || ctx.logo,
          largeText: known ? d.title : 'Netflix',
          small: cover ? ctx.logo : undefined,
          smallText: paused ? 'Paused' : 'Netflix',
          start: tl ? tl.start : !paused ? d.watchStart : undefined,
          end: tl ? tl.end : undefined,
          buttons: o.showButtons && known && d.url ? [button('View on Netflix', d.url)] : [],
        }),
      };
    }
    if (!o.showBrowsing) return null;
    return {
      playing: false,
      activity: activity({
        details: d.page === 'title' && o.showTitle && d.title ? `Looking at ${d.title}` : 'Browsing Netflix',
        large: ctx.logo,
        largeText: 'Netflix',
        start: d.sessionStart,
      }),
    };
  },
};
