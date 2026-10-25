'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'primevideo',
  name: 'Prime Video',
  site: 'primevideo.com',
  url: 'https://www.primevideo.com',
  description: 'The movie or show you’re watching on Prime Video, with season, episode and time left.',
  color: '#1a98ff',
  logo: 'logos/primevideo.png',
  logoUrl: 'https://m.media-amazon.com/images/G/01/digital/video/DVUI/favicons/apple-touch-icon-152x152.png',
  activityType: 3, // Watching
  options: [
    { key: 'showTitle', label: 'Show what you’re watching', hint: 'Off just shows "Watching Prime Video".', default: true },
    { key: 'showCover', label: 'Show the title’s artwork', hint: 'Use the show or movie artwork as the big image, when known.', default: true },
    { key: 'showButtons', label: 'Show "View on Prime Video" button', hint: 'Links friends to the title’s page.', default: false },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: true },
    { key: 'showBrowsing', label: 'Show when just browsing', hint: 'Shows "Browsing Prime Video" while you pick something.', default: true },
  ],

  // data: { page: 'watch' | 'title' | 'browse', title, episode, image, url, playing, timeline, watchStart, sessionStart }
  build(d, o, ctx) {
    if (d.page === 'watch') {
      if (!d.playing && !o.showWhenPaused) return null;
      const paused = !d.playing;
      const known = o.showTitle && d.title;
      const cover = known && o.showCover && d.image;
      let state = known ? d.episode || null : null;
      if (paused) state = state ? `Paused · ${state}` : 'Paused';
      const tl = d.playing ? d.timeline : null;
      return {
        playing: !!d.playing,
        activity: activity({
          details: known ? d.title : null,
          state,
          large: cover || ctx.logo,
          largeText: known ? d.title : 'Prime Video',
          small: cover ? ctx.logo : undefined,
          smallText: paused ? 'Paused' : 'Prime Video',
          start: tl ? tl.start : !paused ? d.watchStart : undefined,
          end: tl ? tl.end : undefined,
          buttons: o.showButtons && known && d.url ? [button('View on Prime Video', d.url)] : [],
        }),
      };
    }
    if (!o.showBrowsing) return null;
    return {
      playing: false,
      activity: activity({
        details: d.page === 'title' && o.showTitle && d.title ? `Looking at ${d.title}` : 'Browsing Prime Video',
        large: ctx.logo,
        largeText: 'Prime Video',
        start: d.sessionStart,
      }),
    };
  },
};
