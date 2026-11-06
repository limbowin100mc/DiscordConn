'use strict';

(() => {
  const PH = window.PresenceHub;
  const attr = (el, name) => (el ? (el.getAttribute(name) || '').trim() : '');

  // "3:20", or "-1:05" when the player shows the time left.
  function durationText(bar) {
    const el = bar.querySelector('.playbackTimeline__duration');
    const m = el && el.textContent.match(/-?\d+(?::\d{2})+/);
    return m ? m[0] : '';
  }

  PH.register('soundcloud', () => {
    const bar = document.querySelector('.playControls');
    const md = PH.media();
    const link = bar && bar.querySelector('a.playbackSoundBadge__titleLink');
    const title = attr(link, 'title') || md.title;
    if (!bar || !title) return { idle: true };

    const uploader = bar.querySelector('.playbackSoundBadge__lightLink');
    const artist = md.artist || attr(uploader, 'title') || (uploader ? uploader.textContent.trim() : '');
    const btn = bar.querySelector('.playControls__play');
    const playing = btn ? btn.classList.contains('playing') : md.playbackState === 'playing';

    // The progress bar says where we are in seconds; the duration is its maximum.
    const progress = bar.querySelector('.playbackTimeline__progressWrapper');
    let position = progress ? Number(progress.getAttribute('aria-valuenow')) : NaN;
    let duration = progress ? Number(progress.getAttribute('aria-valuemax')) : NaN;
    if (!Number.isFinite(position)) position = PH.parseTime(PH.text('.playbackTimeline__timePassed', bar));
    if (!(duration > 0)) {
      const text = durationText(bar);
      duration = PH.parseTime(text);
      if (text.startsWith('-') && position != null && duration != null) duration += position;
    }

    let cover = md.artwork || null;
    if (!cover) {
      const art = bar.querySelector('.playbackSoundBadge .sc-artwork span[style*="background-image"]');
      const m = art && art.style.backgroundImage.match(/url\("?(https:[^")]+)"?\)/);
      if (m) cover = m[1].replace(/-t\d+x\d+\./, '-t500x500.');
    }

    return {
      title,
      artists: artist ? [artist] : [],
      album: md.album || '',
      cover,
      url: link ? PH.abs((link.getAttribute('href') || '').split('?')[0]) || null : null,
      playing,
      timeline: PH.timeline(`sc:${title}|${artist}`, position, duration, playing),
    };
  });
})();
