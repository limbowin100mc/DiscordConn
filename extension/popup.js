'use strict';

const NAMES = { youtube: 'YouTube', ytmusic: 'YouTube Music', spotify: 'Spotify', kick: 'Kick', x: 'X', netflix: 'Netflix' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function describe(service, d) {
  if (!d) return NAMES[service] || service;
  if (service === 'youtube') return d.title || (d.page === 'search' ? 'Searching' : 'Browsing');
  if (service === 'ytmusic') return d.title ? `${d.title}${d.artists && d.artists.length ? ` — ${d.artists.join(', ')}` : ''}` : 'Nothing playing';
  if (service === 'spotify') return d.title ? `${d.title}${d.artists && d.artists.length ? ` — ${d.artists.join(', ')}` : ''}` : 'Nothing playing';
  if (service === 'kick') return d.channel ? `${d.channel}${d.live ? ' (live)' : ''}` : 'Browsing';
  if (service === 'x') return d.page ? `On X · ${d.page}` : 'On X';
  if (service === 'netflix') return d.title ? `${d.title}${d.episode ? ` · ${d.episode}` : ''}` : d.page === 'watch' ? 'Watching' : 'Browsing';
  return service;
}

function render(res) {
  const status = document.getElementById('status');
  const now = document.getElementById('now');
  const tabs = document.getElementById('tabs');
  const hint = document.getElementById('hint');
  status.replaceChildren();
  now.replaceChildren();
  tabs.replaceChildren();
  hint.textContent = '';

  const connected = res && res.connected;
  const dot = el('span', `dot ${connected ? 'good' : 'bad'}`);
  status.append(dot, connected ? 'Connected to the desktop app' : 'Desktop app not running');
  if (!connected) hint.textContent = 'Open Presence Hub on your computer. This browser connects to it automatically.';

  const app = res && res.app;
  if (connected && app) {
    now.append(el('div', 'label', 'On Discord now'));
    const box = el('div', 'now');
    if (!app.sharing) {
      box.append(el('div', 't', 'Sharing is paused'), el('div', 's', 'Turn it on in the app'));
    } else if (app.current) {
      box.append(el('div', 't', `${NAMES[app.current.service] || app.current.service}${app.current.details ? ` · ${app.current.details}` : ''}`));
      if (app.current.state) box.append(el('div', 's', app.current.state));
    } else {
      box.append(el('div', 't', 'Nothing shown right now'));
    }
    now.append(box);
  }

  const list = (res && res.tabs) || [];
  if (!list.length) {
    tabs.append(el('div', 'empty', 'No supported sites open (YouTube, YouTube Music, Netflix, Spotify, Kick, X).'));
    return;
  }
  for (const t of list) {
    const row = el('div', 'tab');
    const img = el('img');
    img.src = `icons/services/${t.service}.png`;
    img.alt = '';
    row.append(img, el('div', 't', describe(t.service, t.data)));
    tabs.append(row);
  }
}

chrome.runtime.sendMessage({ type: 'status' }).then(render).catch(() => render(null));
