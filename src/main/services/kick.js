'use strict';

const { activity, button } = require('./util');

module.exports = {
  id: 'kick',
  name: 'Kick',
  site: 'kick.com',
  url: 'https://kick.com',
  description: 'Which streamer you are watching on Kick, with stream title and category.',
  color: '#53fc18',
  logo: 'logos/kick.png',
  logoUrl: 'https://kick.com/apple-icon.png',
  activityType: 3, // Watching
  options: [
    { key: 'showAvatar', label: 'Show streamer picture', hint: "Use the streamer's profile picture as the big image.", default: true },
    { key: 'showTitle', label: 'Show stream title', hint: 'Otherwise only the streamer and category are shown.', default: true },
    { key: 'showButtons', label: 'Show "Watch Stream" button', hint: 'Lets friends open the stream.', default: true },
    {
      key: 'timer',
      label: 'Timer shows',
      hint: 'What the elapsed time counts.',
      default: 'watching',
      choices: [
        { value: 'watching', label: 'How long I watched' },
        { value: 'uptime', label: 'Stream uptime' },
      ],
    },
    { key: 'showBrowsing', label: 'Show when just browsing', hint: 'Home page, categories and offline channels.', default: true },
  ],

  build(d, o, ctx) {
    if ((d.page === 'stream' && d.live) || d.page === 'vod') {
      const vod = d.page === 'vod';
      const avatar = o.showAvatar && d.avatar;
      const titleLine = o.showTitle && d.title ? d.title : d.category;
      let start;
      let end;
      if (vod) {
        if (d.playing && d.timeline) ({ start, end } = d.timeline);
      } else {
        start = o.timer === 'uptime' && d.liveSince ? d.liveSince : d.watchStart;
      }
      return {
        playing: !!d.playing,
        activity: activity({
          details: vod ? `${d.channel || 'A streamer'} (VOD)` : d.channel,
          state: titleLine || (vod ? 'Watching a past stream' : 'Live on Kick'),
          large: avatar || ctx.logo,
          largeText: d.category || d.channel || 'Kick',
          small: avatar ? ctx.logo : undefined,
          smallText: vod ? 'Kick VOD' : 'Live on Kick',
          start,
          end,
          buttons: o.showButtons ? [button(vod ? 'Watch VOD' : 'Watch Stream', d.url)] : [],
        }),
      };
    }

    if (!o.showBrowsing) return null;
    let details = 'Browsing Kick';
    let state = null;
    let large = ctx.logo;
    if (d.page === 'stream') {
      details = 'Viewing a channel';
      state = d.channel ? `${d.channel} (offline)` : null;
      if (o.showAvatar && d.avatar) large = d.avatar;
    } else if (d.page === 'category') {
      state = d.category;
    } else if (d.page === 'following') {
      state = 'Following';
    }
    return {
      playing: false,
      activity: activity({
        details,
        state,
        large,
        largeText: 'Kick',
        small: large !== ctx.logo ? ctx.logo : undefined,
        smallText: 'Kick',
        start: d.sessionStart,
      }),
    };
  },
};
