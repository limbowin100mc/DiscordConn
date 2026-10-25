'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'spotify',
  name: 'Spotify',
  site: 'open.spotify.com',
  url: 'https://open.spotify.com',
  description: 'The song playing in the Spotify web player, with album art and time left.',
  color: '#1ed760',
  logo: 'logos/spotify.png',
  logoUrl: 'https://open.spotifycdn.com/cdn/images/icons/Spotify_512.png',
  activityType: 2, // Listening to
  options: [
    { key: 'showCover', label: 'Show album cover', hint: 'Use the album art as the big image.', default: true },
    { key: 'showButtons', label: 'Show "Play on Spotify" button', hint: 'Lets friends open the song.', default: true },
    { key: 'showWhenPaused', label: 'Keep showing when paused', hint: 'Otherwise the activity disappears while paused.', default: false },
    { key: 'showBrowsing', label: 'Show when nothing is playing', hint: 'Shows "Browsing Spotify" while the tab is open.', default: false },
  ],

  build(d, o, ctx) {
    if (d.idle || !d.title) {
      if (!o.showBrowsing) return null;
      return {
        playing: false,
        activity: activity({ details: 'Browsing Spotify', large: ctx.logo, largeText: 'Spotify', start: d.sessionStart }),
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
        smallText: d.playing ? 'Spotify' : 'Paused',
        start: tl && tl.start,
        end: tl && tl.end,
        buttons: o.showButtons ? [button('Play on Spotify', d.url)] : [],
      }),
    };
  },
};
