'use strict';

(() => {
  const PH = window.PresenceHub;

  // "Prime Video: The Boys - Season 1" / "Amazon.com: Watch The Boys - Season 1 | Prime Video"
  function fromTitle() {
    const m = document.title.match(/^Prime Video:\s*(.+)$/) || document.title.match(/^Amazon\.[a-z.]+:\s*(?:Watch\s+)?(.+?) \| Prime Video/i);
    if (!m) return {};
    const s = m[1].trim().match(/^(.+?) - ((?:Season|Staffel|Saison|Temporada|Stagione|Sezona|Seizoen) .+)$/i);
    return s ? { title: s[1], season: s[2] } : { title: m[1].trim(), season: '' };
  }

  // The player is an overlay with its own <video>; pick the one that's actually loaded.
  function playerVideo() {
    return [...document.querySelectorAll('.webPlayerSDKContainer video, .atvwebplayersdk-player-container video, video')]
      .find((v) => v.readyState > 0 && Number.isFinite(v.duration) && v.duration > 0) || null;
  }

  PH.register('primevideo', () => {
    const page = fromTitle();
    const video = playerVideo();
    const sdkTitle = PH.text('.atvwebplayersdk-title-text');
    const sdkSub = PH.text('.atvwebplayersdk-subtitle-text'); // e.g. "Season 1, Ep. 3 Get Some"

    if (video && (sdkTitle || !video.paused)) {
      const playing = !video.paused && !video.ended;
      // The on-screen "12:34 / 1:02:03" is the real position; the video element's clock can include ads.
      let position = video.currentTime;
      let duration = video.duration;
      const shown = PH.text('.atvwebplayersdk-timeindicator-text').match(/([\d:]+)\s*\/\s*([\d:]+)/);
      if (shown) {
        position = PH.parseTime(shown[1]);
        duration = PH.parseTime(shown[2]);
      }
      const title = sdkTitle || page.title || '';
      return {
        page: 'watch',
        title,
        episode: sdkSub || page.season || '',
        image: null,
        url: location.href.split('?')[0],
        playing,
        timeline: PH.timeline(`pv:${title}|${sdkSub}`, position, duration, playing),
        watchStart: PH.sessionStart,
      };
    }
    return page.title ? { page: 'title', title: page.title } : { page: 'browse' };
  });
})();
