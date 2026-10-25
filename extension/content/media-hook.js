'use strict';

// Runs in the page itself (not the extension's isolated world). Sites report the
// playback position to the browser's media controls via setPositionState(), but
// there is no way to read it back, so we record each report on <html> where the
// site script (spotify.js) can see it. Works in background tabs and doesn't depend
// on the page layout.
(() => {
  const proto = window.MediaSession && window.MediaSession.prototype;
  if (!proto || typeof proto.setPositionState !== 'function' || proto.__presenceHubHooked) return;
  const original = proto.setPositionState;
  Object.defineProperty(proto, '__presenceHubHooked', { value: true });
  proto.setPositionState = function setPositionState(state) {
    try {
      const s = state || {};
      document.documentElement.setAttribute('data-presence-hub-position', JSON.stringify({
        position: Number(s.position) || 0,
        duration: Number(s.duration) || 0,
        rate: s.playbackRate == null ? 1 : Number(s.playbackRate) || 1,
        at: Date.now(),
      }));
    } catch { /* never break the page */ }
    return original.apply(this, arguments);
  };
})();
