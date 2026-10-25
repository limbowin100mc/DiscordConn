'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'ytmusic',
  name: 'YouTube Music',
  site: 'music.youtube.com',
  url: 'https://music.youtube.com',
  description: 'The song playing on YouTube Music, with cover art and time left.',
  color: '#ff0033',
  logo: 'logos/ytmusic.png',
  logoUrl: 'https://www.gstatic.com/youtube/media/ytm/images/applauncher/music_icon_512x512.png',
  activityType: 2, // Listening to
  options: [
    { key: 'showCover', label: 'Show cover art', hint: 'Use the song’s cover as the big image.', default: true },
    { key: 'showButtons', label: 'Show "Play on YouTube Music" button', hint: 'Lets friends open the song.', default: true },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: false },
    { key: 'showBrowsing', label: 'Show when nothing is playing', hint: 'Shows "Browsing YouTube Music" while the tab is open.', default: false },
  ],

  // data: { title, artists, album, cover, url, playing, timeline } or { idle: true }
  build(d, o, ctx) {
    if (d.idle || !d.title) {
      if (!o.showBrowsing) return null;
      return {
        playing: false,
        activity: activity({ details: 'Browsing YouTube Music', large: ctx.logo, largeText: 'YouTube Music', start: d.sessionStart }),
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
        smallText: d.playing ? 'YouTube Music' : 'Paused',
        start: tl && tl.start,
        end: tl && tl.end,
        buttons: o.showButtons ? [button('Play on YouTube Music', d.url)] : [],
      }),
    };
  },
};
