'use strict';

(() => {
  const PH = window.PresenceHub;

  PH.register('ytmusic', () => {
    const bar = document.querySelector('ytmusic-player-bar');
    const video = document.querySelector('video');
    const player = document.querySelector('#movie_player');
    // During ads the page reports the ad as what's playing.
    if (!bar || (player && player.classList.contains('ad-showing'))) return { idle: true };

    const md = PH.media();
    const title = PH.text('.title', bar) || md.title;
    if (!title) return { idle: true };
    // Byline: "Artist • Album • 2019" for songs, "Artist • 2.1B views • 14M likes" for videos.
    const parts = PH.text('.byline', bar).split(' • ').map((p) => p.trim()).filter(Boolean);
    const artist = md.artist || parts[0] || '';
    const album = md.album || (parts[1] && !/\b(views|likes|subscribers|plays)\b/i.test(parts[1]) && !/^\d{4}$/.test(parts[1]) ? parts[1] : '');
    const id = new URLSearchParams(location.search).get('v');
    const playing = !!(video && !video.paused && !video.ended);

    return {
      title,
      artists: artist ? [artist] : [],
      album,
      cover: md.artwork || null,
      url: id ? `https://music.youtube.com/watch?v=${id}` : null,
      playing,
      timeline: video ? PH.timeline(`ytm:${id || title}`, video.currentTime, video.duration, playing, video.playbackRate) : null,
    };
  });
})();
