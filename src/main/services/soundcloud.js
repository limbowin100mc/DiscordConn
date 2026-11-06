'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'soundcloud',
  name: 'SoundCloud',
  site: 'soundcloud.com',
  url: 'https://soundcloud.com',
  description: 'The track playing on SoundCloud, with its artwork and time left.',
  color: '#ff5500',
  logo: 'logos/soundcloud.png',
  logoUrl: 'https://a-v2.sndcdn.com/assets/images/sc-icons/ios-a62dfc8fe7.png',
  activityType: 2, // Listening to
  options: [
    { key: 'showCover', label: 'Show artwork', hint: 'Use the track’s artwork as the big image.', default: true },
    { key: 'showButtons', label: 'Show "Listen on SoundCloud" button', hint: 'Lets friends open the track.', default: true },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: false },
    { key: 'showBrowsing', label: 'Show when nothing is playing', hint: 'Shows "Browsing SoundCloud" while the tab is open.', default: false },
  ],

  // data: { title, artists, album, cover, url, playing, timeline } or { idle: true }
  build(d, o, ctx) {
    if (d.idle || !d.title) {
      if (!o.showBrowsing) return null;
      return {
        playing: false,
        activity: activity({ details: 'Browsing SoundCloud', large: ctx.logo, largeText: 'SoundCloud', start: d.sessionStart }),
      };
    }
    if (!d.playing && !o.showWhenPaused) return null;

    const artists = (d.artists || []).join(', ');
    const cover = o.showCover && d.cover;
    const tl = d.playing ? d.timeline : null;
    return {
      playing: !!d.playing,
      activity: activity({
        details: d.title,
        state: d.playing ? artists : `Paused${artists ? ` · ${artists}` : ''}`,
        large: cover || ctx.logo,
        largeText: d.album || d.title,
        small: cover ? ctx.logo : undefined,
        smallText: d.playing ? 'SoundCloud' : 'Paused',
        start: tl && tl.start,
        end: tl && tl.end,
        buttons: o.showButtons ? [button('Listen on SoundCloud', d.url)] : [],
      }),
    };
  },
};
