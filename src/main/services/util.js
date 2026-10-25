'use strict';

// Discord activity limits: text fields 2-128 chars, button labels <= 32, button urls <= 512.

function clip(value, max = 128) {
  if (value == null) return undefined;
  let s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (s.length > max) {
    let out = '';
    for (const ch of s) {
      if (out.length + ch.length > max - 1) break;
      out += ch;
    }
    s = `${out.trimEnd()}…`;
  }
  if (s.length < 2) s += '⠀';
  return s;
}

// An https image URL, or the key of an art asset uploaded to the Discord application.
function image(url) {
  if (typeof url !== 'string' || !url || url.startsWith('http://')) return undefined;
  return url.length <= 256 ? url : undefined;
}

function button(label, url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || url.length > 512) return null;
  return { label: clip(label, 32), url };
}

function ts(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

// Builds a Discord activity object, leaving out anything empty.
function activity({ details, state, large, largeText, small, smallText, start, end, buttons }) {
  const a = {};
  const d = clip(details);
  const s = clip(state);
  if (d) a.details = d;
  if (s) a.state = s;

  const assets = {};
  const li = image(large);
  const si = image(small);
  if (li) {
    assets.large_image = li;
    const lt = clip(largeText);
    if (lt) assets.large_text = lt;
  }
  if (si) {
    assets.small_image = si;
    const st = clip(smallText);
    if (st) assets.small_text = st;
  }
  if (Object.keys(assets).length) a.assets = assets;

  const startTs = ts(start);
  const endTs = ts(end);
  if (startTs || endTs) {
    a.timestamps = {};
    if (startTs) a.timestamps.start = startTs;
    if (endTs && (!startTs || endTs > startTs)) a.timestamps.end = endTs;
  }

  const btns = (buttons || []).filter(Boolean).slice(0, 2);
  if (btns.length) a.buttons = btns;
  a.instance = false;
  return a;
}

module.exports = { clip, image, button, activity };
