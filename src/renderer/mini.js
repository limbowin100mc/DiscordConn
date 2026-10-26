'use strict';

const api = window.hub;
const VERBS = { 0: 'Playing', 2: 'Listening to', 3: 'Watching', 5: 'Competing in' };
let state = null;
let shownKey = '';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isUrl = (v) => typeof v === 'string' && /^https:\/\//.test(v);
const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const svg = (d, fill = true) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const ICONS = {
  prev: svg('<path d="M6 5h2v14H6zM20 5v14L9 12z"/>'),
  next: svg('<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>'),
  play: svg('<path d="M7 4.5v15l13-7.5z"/>'),
  pause: svg('<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>', false),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>', false),
};

function render() {
  const card = document.getElementById('card');
  const cur = state && state.current;
  if (!cur) { card.innerHTML = ''; shownKey = ''; return; }
  const svc = state.services.find((s) => s.id === cur.service) || { name: cur.service, logo: '' };
  const a = cur.activity;
  const assets = a.assets || {};
  const art = isUrl(assets.large_image) ? assets.large_image : svc.logo;
  const t = a.timestamps || {};
  const sub = cur.lyrics ? a.state : a.state || assets.large_text || '';
  const key = JSON.stringify([cur.key, a.details, sub, art, t.start, t.end, cur.playing]);
  if (key === shownKey) return tick();
  shownKey = key;
  card.innerHTML = `
    <div class="glow" style="background-image:url('${esc(art)}')"></div>
    <div class="art"><img class="big" src="${esc(art)}" alt="">${art !== svc.logo ? `<img class="logo" src="${esc(svc.logo)}" alt="">` : ''}</div>
    <div class="info">
      <div class="head">${esc(VERBS[a.type] || 'Playing')} ${esc(svc.name)}<span class="x"><button data-act="close" title="Hide mini player">${ICONS.close}</button></span></div>
      <div class="title">${esc(a.details || svc.name)}</div>
      <div class="sub">${esc(sub)}</div>
      <div class="row">
        ${t.start && t.end ? `<span class="time" id="pos"></span><div class="bar"><i id="fill"></i></div><span class="time">${fmt((t.end - t.start) / 1000)}</span>` : '<div style="flex:1"></div>'}
        <div class="controls">
          <button data-act="prev" title="Previous">${ICONS.prev}</button>
          <button data-act="toggle" class="play" title="Play / pause">${cur.playing ? ICONS.pause : ICONS.play}</button>
          <button data-act="next" title="Next">${ICONS.next}</button>
          <button data-act="share" title="Copy a now-playing image to paste in Discord">${ICONS.share}</button>
        </div>
      </div>
    </div>`;
  tick();
}

function tick() {
  const cur = state && state.current;
  const t = cur && cur.activity.timestamps;
  const pos = document.getElementById('pos');
  const fill = document.getElementById('fill');
  if (!t || !t.start || !t.end || !pos || !fill) return;
  const total = (t.end - t.start) / 1000;
  const p = Math.min(total, Math.max(0, (Date.now() - t.start) / 1000));
  pos.textContent = fmt(p);
  fill.style.width = `${((p / total) * 100).toFixed(1)}%`;
}

function flash(text) {
  const el = document.getElementById('flash');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') api.hideMini();
  else if (act === 'share') {
    const res = await api.shareNow();
    flash(res && res.ok ? 'Copied! Paste it in Discord' : 'Couldn’t copy');
  } else api.mediaControl(act);
});

api.onState((s) => { state = s; render(); });
api.getState().then((s) => { state = s; render(); });
setInterval(tick, 1000);
