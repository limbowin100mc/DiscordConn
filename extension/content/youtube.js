'use strict';

(() => {
  const PH = window.PresenceHub;
  let watched = { id: null, start: Date.now() };

  const cleanTitle = (t) => String(t || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s+-\s+YouTube$/, '').trim();

  function activeShortVideo() {
    const videos = [...document.querySelectorAll('ytd-reel-video-renderer[is-active] video, #shorts-player video, ytd-shorts video')];
    return videos.find((v) => !v.paused) || videos[0] || null;
  }

  function watchInfo(url, path) {
    if (path === '/watch') return { id: url.searchParams.get('v'), page: 'watch' };
    const m = path.match(/^\/(shorts|live)\/([\w-]+)/);
    if (m) return { id: m[2], page: m[1] === 'shorts' ? 'shorts' : 'watch' };

    // Miniplayer: a video keeps playing while you browse elsewhere on YouTube.
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    if (player && video && !video.paused && player.closest('ytd-miniplayer, #miniplayer, ytd-miniplayer-renderer')) {
      const link = player.querySelector('a.ytp-title-link[href*="v="]');
      const id = link && (link.href.match(/[?&]v=([\w-]+)/) || [])[1];
      return { id: id || null, page: 'watch', mini: true };
    }
    return null;
  }

  function collectWatch(info) {
    const isShort = info.page === 'shorts';
    const player = document.querySelector('#movie_player');
    const video = isShort ? activeShortVideo() : (player && player.querySelector('video.html5-main-video, video'));
    const md = PH.media();

    let title = '';
    let channel = '';
    if (isShort) {
      title = md.title || PH.text('ytd-reel-video-renderer[is-active] h2') || cleanTitle(document.title);
      channel = md.artist
        || PH.text('ytd-reel-video-renderer[is-active] ytd-channel-name a')
        || PH.text('ytd-reel-video-renderer[is-active] .ytReelChannelBarViewModelChannelName');
    } else if (info.mini) {
      title = md.title || PH.text('ytd-miniplayer .title') || '';
      channel = md.artist || PH.text('ytd-miniplayer #channel') || '';
    } else {
      title = PH.text('ytd-watch-metadata h1 yt-formatted-string') || PH.text('#title h1') || md.title || cleanTitle(document.title);
      channel = PH.text('ytd-watch-metadata ytd-channel-name a')
        || PH.text('#owner ytd-channel-name a')
        || PH.text('ytd-video-owner-renderer ytd-channel-name')
        || md.artist;
    }

    const id = info.id;
    if (watched.id !== id) watched = { id, start: Date.now() };

    const playing = !!(video && !video.paused && !video.ended);
    const ad = !!(player && !isShort && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
    const live = !isShort && !!(player && (player.querySelector('.ytp-time-display.ytp-live') || player.classList.contains('ytp-live')));

    let url = null;
    if (id) url = isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;

    return {
      page: info.page,
      videoId: id,
      title,
      channel,
      url,
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
      playing,
      live,
      ad,
      timeline: video && !live && !ad
        ? PH.timeline(`yt:${id || title}`, video.currentTime, video.duration, playing, video.playbackRate)
        : null,
      watchStart: watched.start,
    };
  }

  PH.register('youtube', () => {
    const url = new URL(location.href);
    const path = url.pathname;

    const info = watchInfo(url, path);
    if (info) return collectWatch(info);

    if (path === '/results') return { page: 'search', query: url.searchParams.get('search_query') || '' };
    if (path === '/') return { page: 'home' };
    if (path.startsWith('/feed/subscriptions')) return { page: 'subscriptions' };
    if (path.startsWith('/feed/history')) return { page: 'history' };
    if (path.startsWith('/feed/library') || path.startsWith('/feed/you') || path.startsWith('/feed/playlists')) return { page: 'library' };
    if (path === '/playlist') return { page: 'playlist' };

    const ch = path.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/);
    if (ch) {
      return {
        page: 'channel',
        channel: PH.text('yt-page-header-renderer h1') || PH.text('#page-header h1') || PH.text('ytd-c4-tabbed-header-renderer #channel-name #text') || cleanTitle(document.title),
        url: `https://www.youtube.com/${ch[1]}`,
      };
    }
    return { page: 'browse' };
  });
})();
