'use strict';

// Fills the "now playing" card from the data in the URL hash; the app captures it as an image.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

let card = {};
try { card = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch { /* empty card */ }
const art = card.image || card.logo;
let progress = '';
if (card.start && card.end) {
  const total = (card.end - card.start) / 1000;
  const pos = Math.min(total, Math.max(0, (Date.now() - card.start) / 1000));
  progress = `<div class="progress"><span>${fmt(pos)}</span><div class="bar"><i style="width:${((pos / total) * 100).toFixed(1)}%"></i></div><span>${fmt(total)}</span></div>`;
}
document.getElementById('card').innerHTML = `
  <div class="bg" style="background-image:url('${esc(art)}')"></div>
  <div class="shade"></div>
  <img class="cover" src="${esc(art)}" alt="">
  <div class="info">
    <div class="head"><img src="${esc(card.logo)}" alt="">${esc(card.verb)} ${esc(card.service)}</div>
    <div class="title">${esc(card.title)}</div>
    ${card.subtitle ? `<div class="sub">${esc(card.subtitle)}</div>` : ''}
    ${progress || '<div style="margin-top:auto"></div>'}
    <div class="foot"><img src="app-icon.png" alt="">${card.user ? `${esc(card.user)} · ` : ''}via Presence Hub</div>
  </div>`;

// Ready when every image has loaded (or failed), at most 4 seconds.
window.cardReady = Promise.race([
  Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null)))),
  new Promise((r) => setTimeout(r, 4000)),
]).then(() => true);
