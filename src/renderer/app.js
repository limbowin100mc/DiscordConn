'use strict';

const api = window.hub;
const VERBS = { 0: 'Playing', 2: 'Listening to', 3: 'Watching', 5: 'Competing in' };
const PORTAL = 'https://discord.com/developers/applications';

let state = null;
let page = load('page') || 'dashboard';
const expanded = new Set();
const ownApp = new Set(); // services where you chose to enter your own Discord app
const tests = {}; // service id -> { pending } | { ok, text }

/* ---------- helpers ---------- */

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svcById = (id) => state.services.find((s) => s.id === id);
// "YouTube, Netflix, Spotify, Kick or X"
const siteList = () => { const n = state.services.map((s) => s.name); return n.length > 1 ? `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}` : n.join(''); };
const isUrl = (v) => typeof v === 'string' && /^https:\/\//.test(v);

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function avatarUrl(user) {
  if (!user) return 'app-icon.png';
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  try {
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const ICONS = {
  dashboard: svg('<rect width="7" height="9" x="3" y="3" rx="1.5"/><rect width="7" height="5" x="14" y="3" rx="1.5"/><rect width="7" height="9" x="14" y="12" rx="1.5"/><rect width="7" height="5" x="3" y="16" rx="1.5"/>'),
  stats: svg('<path d="M3 3v18h18"/><rect width="4" height="7" x="7" y="10" rx="1"/><rect width="4" height="12" x="13" y="5" rx="1"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'),
  services: svg('<rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="3" rx="2"/><rect width="8" height="8" x="3" y="13" rx="2"/><path d="M17 13v8M13 17h8"/>'),
  settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  setup: svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  star: svg('<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z"/>'),
  starFilled: svg('<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z" fill="currentColor"/>'),
  external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  browser: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M21.17 8H12M3.95 6.06 8.54 14M10.88 21.94 15.46 16"/>'),
  layers: svg('<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>'),
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
};

const sw = (on, action, attrs = '', cls = '') =>
  `<button class="switch ${cls}" role="switch" aria-checked="${on ? 'true' : 'false'}" data-action="${action}" ${attrs}></button>`;

/* ---------- derived state ---------- */

// Names of the services using the Client ID Discord complained about.
function erroredServices() {
  const cid = state.discord.errorClientId;
  if (!cid) return '';
  const names = state.services.filter((svc) => svc.appId === cid).map((svc) => svc.name);
  return names.length ? names.join(', ') : 'Fallback app';
}

function discordInfo() {
  const d = state.discord;
  if (!state.settings.enabled) {
    return d.state === 'no-discord'
      ? { dot: 'bad', title: 'Discord is not running', sub: 'Sharing is paused' }
      : { dot: '', title: 'Not connected', sub: 'Sharing is paused' };
  }
  switch (d.state) {
    case 'connected': {
      const u = d.user;
      if (d.error) return { dot: 'warn', title: 'Connected, with a problem', sub: d.error, ok: true };
      return { dot: 'good', title: 'Connected', sub: u ? `as ${u.global_name || u.username}` : '', ok: true };
    }
    case 'connecting': return { dot: 'warn', title: 'Connecting…', sub: '' };
    case 'no-discord': return { dot: 'bad', title: 'Discord is not running', sub: 'Open the Discord desktop app' };
    case 'waiting': return { dot: 'warn', title: 'Discord is running', sub: 'No Discord apps set up yet' };
    case 'error': {
      const who = erroredServices();
      const invalid = d.error && /invalid/i.test(d.error);
      return { dot: 'bad', title: invalid ? `${who}: invalid Client ID` : 'Connection problem', sub: invalid ? 'Check the Application ID in Services' : d.error || '' };
    }
    case 'disconnected': return { dot: 'warn', title: 'Reconnecting…', sub: '' };
    default: return { dot: '', title: 'Idle', sub: '' };
  }
}

// The Discord app a service uses: your own, the built-in one, or the fallback.
function hasApp(svc) {
  const s = state.settings;
  return !!(s.services[svc.id].clientId || svc.builtIn || s.fallbackClientId);
}

function serviceStatus(svc) {
  const s = state.settings;
  const conf = s.services[svc.id];
  const d = state.discord;
  if (!conf.enabled) return { cls: 'off', text: 'Turned off' };
  if (svc.appId && d.errorClientId === svc.appId) return { cls: 'bad', text: d.error && /invalid/i.test(d.error) ? 'Invalid Client ID' : 'Discord error' };
  if (svc.ownApp) return { cls: 'live', text: 'Ready · own app' };
  if (svc.builtIn || conf.clientId) return { cls: 'live', text: 'Ready' };
  if (s.fallbackClientId) return { cls: '', text: 'Using fallback app' };
  return { cls: 'warn', text: 'Needs Client ID' };
}

function detectionInfo() {
  const ext = state.bridge.browsers.map((b) => b.browser);
  const det = state.detector;
  const seen = (det.browsers || []).filter((b) => !ext.includes(b));
  if (!det.running && !ext.length) {
    return { ok: false, title: 'Not running', sub: det.error || 'Starting…' };
  }
  const parts = [];
  if (seen.length) parts.push(seen.join(', '));
  if (ext.length) parts.push(`${ext.join(', ')} (extension)`);
  return { ok: true, title: det.running ? 'Built in · all browsers' : 'Extension', sub: parts.join(' · ') || 'Watching your browsers' };
}

function setupProgress() {
  const missing = state.services.filter((svc) => !hasApp(svc));
  const discord = state.discord.state === 'connected';
  const discordRunning = !['no-discord'].includes(state.discord.state);
  const todo = (missing.length ? 1 : 0) + (discordRunning ? 0 : 1);
  return { missing, ids: state.services.length - missing.length, discord, discordRunning, todo };
}

/* ---------- DOM morphing (keeps focus & animations while re-rendering) ---------- */

function morph(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.replaceWith(to);
    return;
  }
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  if ((from.tagName === 'INPUT' || from.tagName === 'SELECT') && document.activeElement !== from && from.value !== to.value) {
    from.value = to.value;
  }
  morphChildren(from, to);
}

function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    if (i < a.length) morph(a[i], b[i]);
    else from.appendChild(b[i]);
  }
  for (let i = b.length; i < a.length; i++) a[i].remove();
}

function patch(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const next = document.createElement(el.tagName);
  next.append(tpl.content);
  morphChildren(el, next);
}

/* ---------- rendering ---------- */

function render() {
  if (!state) return;
  renderTitlebar();
  renderSidebar();
  const pages = { dashboard: pageDashboard, stats: pageStats, services: pageServices, settings: pageSettings, setup: pageSetup };
  if (page === 'stats') loadStats();
  const content = document.getElementById('content');
  const html = `<div class="page" data-page="${page}">${(pages[page] || pageDashboard)()}</div>`;
  if (content.firstElementChild && content.firstElementChild.dataset.page !== page) {
    content.innerHTML = html;
    content.scrollTop = 0;
  } else {
    patch(content, html);
  }
  tick();
}

function renderTitlebar() {
  const di = discordInfo();
  const det = detectionInfo();
  patch(document.getElementById('titlebar-status'),
    `<span class="pill"><span class="dot ${di.dot}"></span>Discord</span>
     <span class="pill"><span class="dot ${det.ok ? 'good' : 'bad'}"></span>Browser detection</span>`);
}

function renderSidebar() {
  const s = state.settings;
  const cur = state.current;
  const prog = setupProgress();
  const nav = [
    ['dashboard', 'Dashboard'],
    ['stats', 'Stats'],
    ['services', 'Services'],
    ['settings', 'Settings', ['available', 'downloaded'].includes(state.update.status) ? 1 : 0],
    ['setup', 'Setup guide', prog.todo],
  ];
  let sub;
  if (!s.enabled) sub = '<span class="dot"></span>Hidden from Discord';
  else if (cur) sub = `<span class="dot live"></span>Showing ${esc(svcById(cur.service).name)}`;
  else sub = '<span class="dot good"></span>On · nothing to show yet';

  patch(document.getElementById('sidebar'), `
    <nav class="nav">
      ${nav.map(([id, label, count]) => `
        <button class="nav-item ${page === id ? 'active' : ''}" data-action="nav" data-page="${id}">
          ${ICONS[id]}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ''}
        </button>`).join('')}
    </nav>
    ${updateCard()}
    <div class="share-card ${s.enabled ? 'on' : ''}">
      <div class="share-row">
        <div class="share-title">Show my activity</div>
        ${sw(s.enabled, 'toggle-sharing', 'aria-label="Show my activity on Discord"', 'big')}
      </div>
      <div class="share-sub">${sub}</div>
    </div>`);
}

function updateText() {
  const u = state.update;
  switch (u.status) {
    case 'dev': return 'Updates work in the installed app (not when running from source).';
    case 'checking': return 'Checking for updates…';
    case 'available': return `Version ${esc(u.version)} is available.`;
    case 'downloading': return `Downloading version ${esc(u.version)}… ${u.progress || 0}%`;
    case 'downloaded': return `Version ${esc(u.version)} is ready. Restart to install it.`;
    case 'latest': return 'You’re up to date.';
    case 'error': return `Couldn’t check for updates: ${esc(u.error)}`;
    default: return 'Not checked yet.';
  }
}

function updateButton(sm = false) {
  const u = state.update;
  const cls = `btn ${sm ? 'sm' : ''}`;
  if (u.status === 'available') return `<button class="${cls} primary" data-action="update-download">Download &amp; install</button>`;
  if (u.status === 'downloaded') return `<button class="${cls} primary" data-action="update-install">Restart &amp; update</button>`;
  if (u.status === 'downloading') return `<div class="bar" style="width:110px"><i style="width:${u.progress || 0}%"></i></div>`;
  if (u.status === 'dev' || sm) return '';
  return `<button class="${cls}" data-action="update-check" ${u.status === 'checking' ? 'disabled' : ''}>Check for updates</button>`;
}

function updateCard() {
  const u = state.update;
  if (!['available', 'downloading', 'downloaded'].includes(u.status)) return '';
  return `<div class="update-card">
    <div class="update-title">${u.status === 'downloaded' ? 'Update ready' : 'Update available'} · v${esc(u.version)}</div>
    <div class="update-row">${updateButton(true)}</div>
  </div>`;
}

function artFor(activity, svc) {
  const a = (activity && activity.assets) || {};
  const large = isUrl(a.large_image) ? a.large_image : svc.logo;
  const small = a.small_image ? (isUrl(a.small_image) ? a.small_image : svc.logo) : null;
  return { large, small };
}

function activityCard(cur) {
  const svc = svcById(cur.service);
  const a = cur.activity;
  const verb = VERBS[a.type] || 'Playing';
  const art = artFor(a, svc);
  const t = a.timestamps || {};
  const now = Date.now();
  let time = '';
  if (t.start && t.end) {
    const total = (t.end - t.start) / 1000;
    const pos = Math.min(total, Math.max(0, (now - t.start) / 1000));
    time = `<div class="a-progress" data-start="${t.start}" data-end="${t.end}">
      <span class="t-elapsed">${fmt(pos)}</span><div class="bar"><i style="width: ${((pos / total) * 100).toFixed(1)}%;"></i></div><span class="t-total">${fmt(total)}</span></div>`;
  } else if (t.start) {
    time = `<div class="a-elapsed" data-start="${t.start}"><span class="t-elapsed">${fmt((now - t.start) / 1000)}</span> elapsed</div>`;
  } else if (t.end) {
    time = `<div class="a-elapsed" data-end="${t.end}"><span class="t-left">${fmt((t.end - now) / 1000)}</span> left</div>`;
  }
  const largeText = a.assets && a.assets.large_text && a.type === 2 ? `<div class="a-large">${esc(a.assets.large_text)}</div>` : '';
  return `
    <div class="activity">
      <div class="activity-head"><span class="verb">${verb}</span> ${esc(svc.name)}</div>
      <div class="activity-body">
        <div class="art">
          <img class="art-large" src="${esc(art.large)}" alt="">
          ${art.small ? `<img class="art-small" src="${esc(art.small)}" alt="">` : ''}
        </div>
        <div class="activity-text">
          ${a.details ? `<div class="a-details">${esc(a.details)}</div>` : ''}
          ${a.state ? `<div class="a-state">${esc(a.state)}</div>` : ''}
          ${largeText}
          ${time}
        </div>
      </div>
      ${a.buttons && a.buttons.length ? `<div class="a-buttons">${a.buttons.map((b) => `<div class="a-btn">${esc(b.label)}</div>`).join('')}</div>` : ''}
    </div>`;
}

function previewCard() {
  const s = state.settings;
  const cur = state.current;
  const logos = state.services.map((svc) => `<img src="${esc(svc.logo)}" alt="${esc(svc.name)}">`).join('');

  if (!s.enabled) {
    return `<div class="preview-empty">
      <div class="logo-row dim">${logos}</div>
      <h3>Sharing is paused</h3>
      <p>Nothing from your browser is shown on Discord right now.</p>
      <button class="btn primary" data-action="toggle-sharing">Turn it back on</button>
    </div>`;
  }

  if (!cur) {
    const needsSetup = state.sources.find((x) => x.status === 'setup');
    if (needsSetup) {
      const svc = svcById(needsSetup.service);
      return `<div class="preview-empty">
        <div class="logo-row"><img src="${esc(svc.logo)}" alt=""></div>
        <h3>${esc(svc.name)} is open, but has no Discord app yet</h3>
        <p>Add a Discord Client ID for ${esc(svc.name)} so it can show up on your profile.</p>
        <button class="btn primary" data-action="goto-service" data-id="${svc.id}">Set up ${esc(svc.name)}</button>
      </div>`;
    }
    const det = detectionInfo();
    if (!det.ok) {
      return `<div class="preview-empty">
        <div class="logo-row dim">${logos}</div>
        <h3>Browser detection isn’t running</h3>
        <p>${esc(det.sub)}</p>
      </div>`;
    }
    return `<div class="preview-empty">
      <div class="logo-row">${logos}</div>
      <h3>Nothing to show yet</h3>
      <p>Open ${esc(siteList())} in any browser. It shows up here and on Discord.</p>
    </div>`;
  }

  const svc = svcById(cur.service);
  const user = state.discord.user;
  const name = user ? user.global_name || user.username : 'You';
  return `
    <div class="profile" style="--brand:${esc(svc.color)}">
      <div class="profile-banner"></div>
      <div class="profile-top">
        <div class="avatar-wrap"><img class="avatar" src="${esc(avatarUrl(user))}" alt=""><span class="avatar-status"></span></div>
        <div class="profile-names">
          <div class="profile-name">${esc(name)}</div>
          <div class="profile-user">${user ? esc(user.username) : 'Your Discord profile'}</div>
        </div>
      </div>
      ${activityCard(cur)}
    </div>`;
}

function pageDashboard() {
  const cur = state.current;
  const s = state.settings;
  const d = state.discord;
  const di = discordInfo();
  const det = detectionInfo();
  const prog = setupProgress();

  let label;
  if (!s.enabled) label = '<span class="dot"></span>Preview';
  else if (cur && d.state === 'connected' && !d.error) label = '<span class="dot live"></span>Live on your Discord profile';
  else if (cur) label = '<span class="dot warn"></span>Waiting for Discord';
  else label = '<span class="dot good"></span>Ready';

  let glow = '';
  if (cur) {
    const art = artFor(cur.activity, svcById(cur.service));
    glow = `<div class="preview-glow" style="background-image:url('${esc(art.large)}')"></div>`;
  }

  const tile = (iconCls, icon, title, value, sub, action = '') => `
    <div class="card status-tile">
      <div class="tile-icon ${iconCls}">${icon}</div>
      <div class="tile-text">
        <div class="tile-title">${title}</div>
        <div class="tile-value">${value}</div>
        ${sub ? `<div class="tile-sub">${sub}</div>` : ''}
      </div>
      ${action}
    </div>`;

  const sources = state.sources;
  const rows = sources.map((src) => sourceRow(src)).join('');

  return `
    <div class="page-head">
      <h1>Dashboard</h1>
      <p class="sub">This is what your friends see on Discord right now.</p>
    </div>
    <div class="dash-grid">
      <section class="card preview-card">
        ${glow}
        <div class="preview-inner">
          <div class="preview-label">${label}</div>
          ${previewCard()}
          ${cur && s.enabled ? `<div class="preview-extras">
            ${state.current.lyrics ? '<span class="chip">🎤 Live lyrics</span>' : ''}
            ${state.game && s.gameCombo ? `<span class="chip">🎮 ${esc(state.game.name)}</span>` : ''}
            <button class="btn sm" data-action="share-now" title="Copy an image of what's playing, then paste it in Discord">${ICONS.share}Share now playing</button>
          </div>` : ''}
        </div>
      </section>
      <div class="status-col">
        ${tile(di.ok ? 'discord' : di.dot === 'bad' ? 'bad' : 'warn', ICONS.discord, 'Discord', esc(di.title), esc(di.sub))}
        ${tile(det.ok ? 'good' : 'bad', ICONS.browser, 'Browser detection', esc(det.title), esc(det.sub))}
        ${tile(prog.ids === state.services.length ? 'good' : prog.ids ? 'warn' : 'bad', ICONS.layers, 'Services ready',
          `${prog.ids} of ${state.services.length}`,
          prog.ids === state.services.length ? 'All set' : `${prog.missing.map((x) => x.name).join(', ')} need a Discord app`,
          '<button class="btn sm ghost" data-action="nav" data-page="services">Manage</button>')}
      </div>
    </div>
    <section class="card">
      <div class="card-head">
        <h2>Found in your browsers</h2>
        <span class="muted small">${sources.length > 1 ? '★ marks a service as always first' : ''}</span>
      </div>
      <div class="source-list">
        ${rows || `<div class="empty-list">Nothing found yet. Open ${esc(siteList())}.</div>`}
      </div>
    </section>`;
}

function sourceRow(src) {
  const svc = svcById(src.service);
  const a = src.activity;
  const art = artFor(a, svc);
  const BADGES = {
    live: ['live', 'On Discord'],
    standby: ['', 'Standby'],
    hidden: ['off', 'Hidden by settings'],
    setup: ['warn', 'Needs Client ID'],
    disabled: ['off', 'Turned off'],
    off: ['off', 'Sharing paused'],
  };
  const [cls, text] = BADGES[src.status] || ['', src.status];
  const preferred = state.settings.preferred === svc.id;
  const title = a ? a.details || svc.name : `${svc.name} is open`;
  const sub = [svc.name, a && a.state, src.browser].filter(Boolean).map(esc).join(' · ');
  const badge = src.status === 'setup'
    ? `<button class="badge warn" style="border:0;cursor:pointer" data-action="goto-service" data-id="${svc.id}">${text}</button>`
    : `<span class="badge ${cls}">${text}</span>`;
  return `
    <div class="source-row ${src.status}">
      <div class="src-art">
        <img class="big" src="${esc(art.large)}" alt="">
        ${art.large !== svc.logo ? `<img class="mini" src="${esc(svc.logo)}" alt="">` : ''}
      </div>
      <div class="src-text">
        <div class="src-title">${esc(title)}</div>
        <div class="src-sub">${sub}</div>
      </div>
      ${badge}
      <button class="icon-btn ${preferred ? 'on' : ''}" data-action="prefer" data-id="${svc.id}"
        title="${preferred ? `Stop preferring ${esc(svc.name)}` : `Always show ${esc(svc.name)} first`}">${preferred ? ICONS.starFilled : ICONS.star}</button>
    </div>`;
}

function clientIdField(id, value, label, defaultHint) {
  const t = tests[id];
  let hint = defaultHint;
  let cls = '';
  if (t && t.pending) hint = 'Checking with Discord…';
  else if (t) { hint = esc(t.text); cls = t.ok ? 'good' : 'bad'; }
  return `
    <div class="field">
      <label class="field-label" for="cid-${id}">${label}</label>
      <div class="input-row">
        <input id="cid-${id}" class="input mono" data-bind="clientId" data-id="${id}" value="${esc(value)}"
          placeholder="Paste the Application ID" spellcheck="false" autocomplete="off" inputmode="numeric">
        <button class="btn" data-action="test" data-id="${id}">Test</button>
      </div>
      <div class="field-hint ${cls}">${hint}</div>
    </div>`;
}

function pageServices() {
  const s = state.settings;
  const cards = state.services.map((svc) => {
    const conf = s.services[svc.id];
    const st = serviceStatus(svc);
    const open = expanded.has(svc.id);
    const type = conf.activityType ?? svc.activityType;
    const options = svc.options.map((opt) => {
      const val = conf.options[opt.key];
      const control = opt.choices
        ? `<select class="input" data-bind="option" data-id="${svc.id}" data-key="${opt.key}">
             ${opt.choices.map((c) => `<option value="${esc(c.value)}" ${c.value === val ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
           </select>`
        : sw(val, 'toggle-option', `data-id="${svc.id}" data-key="${opt.key}" aria-label="${esc(opt.label)}"`);
      return `<div class="option">
        <div><div class="option-title">${esc(opt.label)}</div><div class="option-hint">${esc(opt.hint || '')}</div></div>
        ${control}
      </div>`;
    }).join('');

    return `
      <section class="card service-card ${conf.enabled ? '' : 'disabled'} ${open ? 'open' : ''}" style="--brand:${esc(svc.color)}">
        <div class="svc-head">
          <img class="svc-logo" src="${esc(svc.logo)}" alt="">
          <div class="svc-name"><h3>${esc(svc.name)}</h3><div class="svc-site">${esc(svc.site)}</div></div>
          ${sw(conf.enabled, 'toggle-service', `data-id="${svc.id}" aria-label="Show ${esc(svc.name)}"`)}
        </div>
        <p class="svc-desc">${esc(svc.description)}</p>
        <div class="svc-foot">
          <span class="badge ${st.cls}">${st.text}</span>
          <button class="btn sm ghost" data-action="expand" data-id="${svc.id}">
            ${open ? 'Hide settings' : 'Settings'}
            <span style="display:inline-flex;transform:rotate(${open ? 180 : 0}deg);transition:transform .2s">${ICONS.chevron}</span>
          </button>
        </div>
        ${open ? `
        <div class="svc-body">
          <div class="svc-col">
            ${!svc.builtIn || svc.ownApp || ownApp.has(svc.id)
              ? clientIdField(svc.id, conf.clientId, svc.builtIn ? 'Your own Discord app (optional)' : 'Discord Client ID',
                svc.builtIn
                  ? 'Leave empty to use the built-in app. Only needed if you want your own name or icon.'
                  : `Create an app called “${esc(svc.name)}” in the <a data-action="open-url" data-url="${PORTAL}">Developer Portal</a> and paste its Application ID.`)
              : `<div class="field"><div class="field-label">Discord app</div>
                  <div class="field-hint">Uses the built-in “${esc(svc.name)}” app. <a data-action="own-app" data-id="${svc.id}">Use my own Discord app instead</a></div></div>`}
            <div class="field">
              <label class="field-label" for="type-${svc.id}">Your status says</label>
              <select id="type-${svc.id}" class="input" data-bind="activityType" data-id="${svc.id}">
                ${[3, 2, 0, 5].map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${VERBS[t]} ${esc(svc.name)}${t === svc.activityType ? ' (default)' : ''}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="logo-${svc.id}">Logo image (optional)</label>
              <input id="logo-${svc.id}" class="input" data-bind="logo" data-id="${svc.id}" value="${esc(conf.logo)}"
                placeholder="${esc(svc.logoUrl)}" spellcheck="false" autocomplete="off">
              <div class="field-hint">Leave empty to use the official ${esc(svc.name)} logo. Accepts an https image link or a Discord art-asset name.</div>
            </div>
          </div>
          <div class="svc-col">
            <div class="field">
              <div class="field-label">What to show</div>
              <div class="option-list">${options}</div>
            </div>
          </div>
        </div>` : ''}
      </section>`;
  }).join('');

  return `
    <div class="page-head">
      <h1>Services</h1>
      <p class="sub">Pick what shows up on Discord and how. Your status reads “Watching YouTube”, “Listening to Spotify” and so on.</p>
    </div>
    <div class="service-grid">
      ${cards}
      <section class="card coming-soon">
        ${ICONS.plus}
        <div style="font-weight:600;color:var(--text-2)">More services coming</div>
        <div class="small">New sites can be added as small plug-ins.</div>
      </section>
    </div>`;
}

/* ---------- stats ---------- */

let statsRange = load('statsRange') || 'week';
let statsData = null;
let statsAt = 0;
let statsLoading = false;
let statsTable = false;
let resetArmed = false;

async function loadStats(force = false) {
  if (statsLoading) return;
  if (!force && statsData && statsData.range === statsRange && Date.now() - statsAt < 15000) return;
  statsLoading = true;
  try {
    const d = await api.getStats(statsRange);
    statsData = d ? { ...d, range: statsRange } : null;
    statsAt = Date.now();
  } finally {
    statsLoading = false;
  }
  if (page === 'stats') render();
}

function fmtDur(secs) {
  secs = Math.round(secs || 0);
  if (secs < 60) return secs ? '<1m' : '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const dayLabel = (iso, short) => {
  const d = new Date(`${iso}T12:00:00`);
  return short ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

// A path for a bar with a rounded top (the data end) and a square base.
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Daily listening/watching, stacked. One bar per day, hover for the numbers.
function dailyChart(perDay) {
  const W = 1000;
  const H = 230;
  const L = 52;
  const R = 8;
  const T = 10;
  const B = 28;
  const plotH = H - T - B;
  const max = Math.max(60, ...perDay.map((d) => d.listen + d.watch));
  const steps = [300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200];
  const step = steps.find((x) => max / x <= 4) || 86400;
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + plotH * (1 - v / top);
  const band = (W - L - R) / perDay.length;
  const bw = Math.min(24, band * 0.62);
  const GAP = 2;
  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/>`;
    grid += `<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" class="ylab">${v ? fmtDur(v) : '0'}</text>`;
  }
  const short = perDay.length <= 7;
  let bars = '';
  perDay.forEach((d, i) => {
    const x = L + i * band + (band - bw) / 2;
    const base = y(0);
    const hl = (d.listen / top) * plotH;
    const hw = (d.watch / top) * plotH;
    const tip = `${dayLabel(d.date, false)}|${fmtDur(d.listen)}|${fmtDur(d.watch)}`;
    if (hl > 0.5) {
      bars += hw > 0.5
        ? `<rect x="${x.toFixed(1)}" y="${(base - hl).toFixed(1)}" width="${bw.toFixed(1)}" height="${hl.toFixed(1)}" class="s-listen"/>`
        : `<path d="${topRounded(x, base - hl, bw, hl, 4)}" class="s-listen"/>`;
    }
    if (hw > 0.5) {
      const top2 = base - hl - (hl > 0.5 ? GAP : 0) - hw;
      bars += `<path d="${topRounded(x, top2, bw, hw, 4)}" class="s-watch"/>`;
    }
    const showLabel = short || i % 5 === 0 || i === perDay.length - 1;
    if (showLabel) bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" class="xlab">${dayLabel(d.date, short)}</text>`;
    bars += `<rect x="${(L + i * band).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${plotH}" class="hit" data-tip="${esc(tip)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Listening and watching time per day">${grid}${bars}</svg>`;
}

function rankList(title, items, empty) {
  if (!items || !items.length) return '';
  const max = items[0].secs || 1;
  return `<section class="card top-card">
    <div class="card-head"><h2>${title}</h2></div>
    <ol class="top-list">
      ${items.map((it, i) => {
        const svc = svcById(it.service);
        return `<li class="top-item">
          <span class="rank">${i + 1}</span>
          ${svc ? `<img src="${esc(svc.logo)}" alt="" class="top-logo">` : ''}
          <div class="top-text"><div class="top-title">${esc(it.title || empty)}</div>${it.sub ? `<div class="top-sub">${esc(it.sub)}</div>` : ''}</div>
          <div class="top-meter"><i style="width:${Math.max(4, (it.secs / max) * 100).toFixed(0)}%"></i></div>
          <span class="top-time">${fmtDur(it.secs)}</span>
        </li>`;
      }).join('')}
    </ol>
  </section>`;
}

function pageStats() {
  const ranges = [['today', 'Today'], ['week', '7 days'], ['month', '30 days'], ['all', 'All time']];
  const head = `
    <div class="page-head stats-head">
      <div><h1>Stats</h1><p class="sub">Your listening and watching time. Only stored on this PC.</p></div>
      <div class="segmented">${ranges.map(([v, l]) => `<button class="${statsRange === v ? 'active' : ''}" data-action="stats-range" data-value="${v}">${l}</button>`).join('')}</div>
    </div>`;
  const d = statsData && statsData.range === statsRange ? statsData : null;
  if (!d) return `${head}<div class="card empty-list">Loading…</div>`;
  if (!d.listen && !d.watch) {
    return `${head}<section class="card preview-empty" style="min-height:260px">
      <h3>Nothing yet</h3>
      <p>${state.settings.statsEnabled ? 'Play some music or a show; your time adds up here.' : 'Stats are turned off. Turn on “Keep stats” in Settings → Extras.'}</p>
    </section>`;
  }
  const topSvc = d.byService[0] && svcById(d.byService[0].service);
  const tile = (label, value, sub, swatch = '') => `<div class="card stat-tile">
    <div class="stat-label">${swatch}${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
  const maxSvc = d.byService[0] ? d.byService[0].secs : 1;
  return `${head}
    <div class="stat-tiles">
      ${tile('Listening', fmtDur(d.listen), d.topArtists[0] ? `Top artist: ${esc(d.topArtists[0].title)}` : 'Music', '<i class="sw s-listen"></i>')}
      ${tile('Watching', fmtDur(d.watch), d.topWatched[0] ? `Most watched: ${esc(d.topWatched[0].title)}` : 'Videos, shows and streams', '<i class="sw s-watch"></i>')}
      ${tile('Top service', topSvc ? esc(topSvc.name) : '—', topSvc ? fmtDur(d.byService[0].secs) : '')}
      ${tile(statsRange === 'today' ? 'Songs played' : 'Days active', statsRange === 'today' ? String(d.topSongs.reduce((n, x) => n + x.plays, 0)) : String(d.daysActive), statsRange === 'today' ? 'today' : `of the last ${d.perDay.length} days`)}
    </div>
    ${statsRange !== 'today' ? `<section class="card">
      <div class="card-head">
        <h2>Per day</h2>
        <div class="legend"><span><i class="sw s-listen"></i>Listening</span><span><i class="sw s-watch"></i>Watching</span>
          <button class="btn sm ghost" data-action="stats-table">${statsTable ? 'Show chart' : 'Show as table'}</button></div>
      </div>
      ${statsTable ? `<table class="stat-table"><thead><tr><th>Day</th><th>Listening</th><th>Watching</th></tr></thead><tbody>
        ${[...d.perDay].reverse().map((x) => `<tr><td>${dayLabel(x.date, false)}</td><td>${fmtDur(x.listen)}</td><td>${fmtDur(x.watch)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="chart-wrap">${dailyChart(d.perDay)}</div>`}
    </section>` : ''}
    <section class="card">
      <div class="card-head"><h2>By service</h2></div>
      <div class="svc-bars">
        ${d.byService.map((x) => {
          const svc = svcById(x.service) || { name: x.service, logo: '' };
          return `<div class="svc-bar"><img src="${esc(svc.logo)}" alt=""><span class="svc-bar-name">${esc(svc.name)}</span>
            <div class="svc-bar-track"><i style="width:${Math.max(2, (x.secs / maxSvc) * 100).toFixed(1)}%"></i></div><span class="svc-bar-time">${fmtDur(x.secs)}</span></div>`;
        }).join('')}
      </div>
    </section>
    <div class="top-grid">
      ${rankList('Top songs', d.topSongs, 'Unknown song')}
      ${rankList('Top artists', d.topArtists, 'Unknown artist')}
      ${rankList('Top shows & videos', d.topWatched, 'Something on Netflix')}
      ${rankList('Top streamers', d.topStreamers, 'Unknown streamer')}
    </div>
    <p class="muted small stats-foot">Counting since ${d.since ? dayLabel(d.since, false) : 'today'}.
      <button class="btn sm ghost" data-action="stats-reset">${resetArmed ? 'Click again to delete all stats' : 'Reset stats'}</button></p>`;
}

// Chart tooltip (lives outside the re-rendered page so it doesn't flicker).
const chartTip = document.createElement('div');
chartTip.className = 'chart-tip';
document.body.appendChild(chartTip);
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el) { chartTip.classList.remove('show'); return; }
  const [day, listen, watch] = el.dataset.tip.split('|');
  chartTip.innerHTML = `<b>${esc(day)}</b><div><i class="sw s-listen"></i>Listening ${esc(listen)}</div><div><i class="sw s-watch"></i>Watching ${esc(watch)}</div>`;
  chartTip.style.left = `${Math.min(window.innerWidth - 190, e.clientX + 14)}px`;
  chartTip.style.top = `${e.clientY + 14}px`;
  chartTip.classList.add('show');
});

function settingRow(title, hint, control, extra = '') {
  return `<div class="setting ${extra}">
    <div class="setting-text"><div class="setting-title">${title}</div>${hint ? `<div class="setting-hint">${hint}</div>` : ''}</div>
    <div class="setting-control">${control}</div>
  </div>`;
}

function pageSettings() {
  const s = state.settings;
  const p = state.paths;
  const modes = [
    ['name', 'App name', 'Watching YouTube'],
    ['details', 'Details', 'Watching Never Gonna Give You Up'],
    ['state', 'State', 'Watching Rick Astley'],
  ];
  const example = modes.find((m) => m[0] === s.statusDisplay)[2];
  return `
    <div class="page-head">
      <h1>Settings</h1>
      <p class="sub">How the app behaves on your computer and on Discord.</p>
    </div>

    <section class="card">
      <div class="card-head"><h2>App</h2></div>
      ${settingRow('Keep running in the tray when closed', 'The close button hides the window instead of quitting. Your activity keeps showing.',
        sw(s.closeToTray, 'toggle-setting', 'data-key="closeToTray"'))}
      ${settingRow('Start minimized', 'Open straight to the tray icon.', sw(s.startMinimized, 'toggle-setting', 'data-key="startMinimized"'))}
      ${settingRow('Start with Windows', state.packaged ? 'Launch Presence Hub when you sign in.' : 'Available in the installed app (not when running from source).',
        sw(s.launchAtLogin, 'toggle-setting', `data-key="launchAtLogin" ${state.packaged ? '' : 'disabled'}`))}
    </section>

    <section class="card">
      <div class="card-head"><h2>Extras</h2></div>
      ${settingRow('Live lyrics', 'While a song plays, your status shows the line being sung. Lyrics come from LRCLIB; not every song has synced lyrics.',
        sw(s.lyrics, 'toggle-setting', 'data-key="lyrics"'))}
      ${settingRow('Show when it ends', 'Adds “ends 22:41” to movies and episodes.', sw(s.endsAt, 'toggle-setting', 'data-key="endsAt"'))}
      ${settingRow('Show the game you’re playing', 'Adds “🎮 VALORANT” next to your music or show while a fullscreen game runs.',
        sw(s.gameCombo, 'toggle-setting', 'data-key="gameCombo"'))}
      ${settingRow('Mini player', 'A small always-on-top card with play, pause and skip. Drag it anywhere; it shows while something plays.',
        sw(s.miniPlayer, 'toggle-setting', 'data-key="miniPlayer"'))}
      ${settingRow('Keep stats', 'Counts your listening and watching time, only on this PC. See the Stats page.',
        sw(s.statsEnabled, 'toggle-setting', 'data-key="statsEnabled"'))}
    </section>

    <section class="card">
      <div class="card-head"><h2>Updates</h2><span class="muted small">Version ${esc(state.version)}</span></div>
      ${settingRow('Presence Hub updates', `${updateText()}${state.update.error && state.update.status !== 'error' ? ` <span style="color:var(--bad)">${esc(state.update.error)}</span>` : ''}`, updateButton())}
      ${settingRow('Check for updates automatically', 'Looks for a new version when the app starts and every few hours. Nothing is installed without asking.',
        sw(s.autoUpdate, 'toggle-setting', `data-key="autoUpdate" ${state.update.status === 'dev' ? 'disabled' : ''}`))}
    </section>

    <section class="card">
      <div class="card-head"><h2>Discord</h2></div>
      ${settingRow('Member list shows', `People scrolling the member list will see: <b style="color:var(--text)">${esc(example)}</b>`,
        `<div class="segmented">${modes.map(([v, l]) => `<button class="${s.statusDisplay === v ? 'active' : ''}" data-action="status-display" data-value="${v}">${l}</button>`).join('')}</div>`)}
      <div class="setting stack">
        ${clientIdField('__fallback', s.fallbackClientId, 'Fallback Client ID (optional)',
          'Used by any service that has no Client ID of its own. Handy for trying things out with a single app.')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Browser detection</h2></div>
      ${settingRow('Built-in detection', `Works with every browser without installing anything. It uses what Windows knows about playing media and the titles of your browser windows. ${state.detector.running ? '<span style="color:var(--good)">Running</span>' : `<span style="color:var(--bad)">${esc(state.detector.error || 'Not running')}</span>`}`, '')}
      <div class="setting stack">
        <div class="setting-text">
          <div class="setting-title">Browser extension (optional)</div>
          <div class="setting-hint">For extra precision in Chrome, Edge, Brave or Opera: sees X and paused videos in background tabs, and gives exact links. Load this folder with “Load unpacked” on the browser’s extensions page. ${state.bridge.browsers.length ? `<span style="color:var(--good)">Connected: ${esc(state.bridge.browsers.map((b) => b.browser).join(', '))}</span>` : ''}</div>
        </div>
        <div class="path-box">${esc(p.extension)}</div>
        <div class="step-actions" style="margin-top:0">
          <button class="btn sm" data-action="open-folder" data-which="extension">${ICONS.folder}Open folder</button>
          <button class="btn sm" data-action="copy" data-text="${esc(p.extension)}">${ICONS.copy}Copy path</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>About</h2><span class="muted small">Version ${esc(state.version)}</span></div>
      <p class="muted small" style="margin:0">Presence Hub sees what you watch and listen to in your browsers and shows it as your Discord activity. It looks up video thumbnails, album art and Kick channel info online. Apart from that, nothing leaves your computer except what Discord shows on your profile.</p>
    </section>`;
}

function pageSetup() {
  const prog = setupProgress();
  const p = state.paths;
  const done = (ok) => (ok ? 'done' : '');
  const num = (ok, n) => `<div class="step-num">${ok ? ICONS.check : n}</div>`;
  const total = state.services.length;

  // Only shown while some service has no Discord app (built-in IDs not filled in yet).
  const ids = prog.missing.map((svc) => {
    const conf = state.settings.services[svc.id];
    const st = serviceStatus(svc);
    return `<div class="setup-id">
      <div class="setup-id-head"><img src="${esc(svc.logo)}" alt="">${esc(svc.name)}<span class="badge ${st.cls}">${st.text}</span></div>
      ${clientIdField(svc.id, conf.clientId, 'Client ID', `Name the Discord app “${esc(svc.name)}”.`)}
    </div>`;
  }).join('');
  const sources = state.sources.length > 0;

  return `
    <div class="page-head">
      <h1>Setup guide</h1>
      <p class="sub">There's almost nothing to set up. Keep this app open and your activity shows up by itself, from any browser.</p>
    </div>
    <div class="steps">
      <section class="card step ${done(prog.discordRunning)}">
        ${num(prog.discordRunning, 1)}
        <div>
          <h2>Open Discord ${prog.discord ? '<span class="badge live">Connected</span>' : prog.discordRunning ? '<span class="badge live">Running</span>' : ''}</h2>
          <ol>
            <li>Keep the <b>Discord desktop app</b> open. The browser version of Discord can’t show activities.</li>
            <li>In Discord, open <b>User Settings → Activity Privacy</b> and turn on <b>Share your detected activities with others</b>.</li>
          </ol>
        </div>
      </section>

      <section class="card step ${done(sources)}">
        ${num(sources, 2)}
        <div>
          <h2>Play something ${sources ? '<span class="badge live">Found</span>' : ''}</h2>
          <ol>
            <li>Open ${esc(siteList())} in any browser. For Spotify, use the web player (open.spotify.com).</li>
            <li>It shows up on the Dashboard and on your Discord profile, even when the tab is in the background.</li>
          </ol>
        </div>
      </section>

      ${prog.missing.length ? `
      <section class="card step">
        ${num(false, 3)}
        <div>
          <h2>Add Discord apps <span class="badge warn">${prog.ids} of ${total}</span></h2>
          <ol>
            <li>Open the Discord Developer Portal and click <b>New Application</b>.</li>
            <li>Name it exactly what friends should see. For example, <b>YouTube</b> gives “Watching YouTube”.</li>
            <li>Optional: set the <b>App Icon</b> to the matching logo from the logos folder.</li>
            <li>Copy the <b>Application ID</b> and paste it below.</li>
          </ol>
          <div class="step-actions">
            <button class="btn primary" data-action="open-url" data-url="${PORTAL}">${ICONS.external}Open Developer Portal</button>
            <button class="btn" data-action="open-folder" data-which="icons">${ICONS.folder}Open logos folder</button>
          </div>
          <div class="setup-ids">${ids}</div>
        </div>
      </section>` : ''}

      <section class="card step">
        <div class="step-num" style="opacity:.6">${ICONS.plus}</div>
        <div>
          <h2>Optional: browser extension ${state.bridge.browsers.length ? '<span class="badge live">Connected</span>' : ''}</h2>
          <p class="muted" style="margin:8px 0 0">Not needed. In Chrome, Edge, Brave or Opera it adds extra precision: X and paused videos in background tabs, plus exact links. To add it, open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick this folder:</p>
          <div class="path-box" style="margin-top:12px">${esc(p.extension)}</div>
          <div class="step-actions">
            <button class="btn" data-action="open-folder" data-which="extension">${ICONS.folder}Open extension folder</button>
            <button class="btn" data-action="copy" data-text="${esc(p.extension)}">${ICONS.copy}Copy path</button>
          </div>
        </div>
      </section>
    </div>`;
}

/* ---------- live timers ---------- */

function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-start],[data-end]').forEach((el) => {
    const start = Number(el.dataset.start) || 0;
    const end = Number(el.dataset.end) || 0;
    const elapsed = el.querySelector('.t-elapsed');
    const left = el.querySelector('.t-left');
    if (start && end) {
      const total = (end - start) / 1000;
      const pos = Math.min(total, (now - start) / 1000);
      if (elapsed) elapsed.textContent = fmt(pos);
      const bar = el.querySelector('.bar i');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (pos / total) * 100)).toFixed(1)}%`;
    } else if (start && elapsed) {
      elapsed.textContent = fmt((now - start) / 1000);
    } else if (end && left) {
      left.textContent = fmt((end - now) / 1000);
    }
  });
}
setInterval(tick, 1000);

/* ---------- events ---------- */

async function apply(promise) {
  const next = await promise;
  if (next) { state = next; render(); }
}

async function runTest(id) {
  tests[id] = { pending: true };
  render();
  const res = await api.testService(id);
  if (res.ok) {
    const u = res.user;
    tests[id] = { ok: true, text: `Works! Connected to Discord${u ? ` as ${u.global_name || u.username}` : ''}.` };
  } else {
    tests[id] = { ok: false, text: res.error === 'Invalid Client ID' ? 'Discord doesn’t recognise this ID. Copy the Application ID from the General Information page.' : res.error };
  }
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id, key } = el.dataset;
  const s = state.settings;
  switch (action) {
    case 'nav':
      page = el.dataset.page;
      save('page', page);
      render();
      break;
    case 'goto-service':
      page = 'services';
      save('page', page);
      expanded.add(id);
      render();
      setTimeout(() => document.getElementById(`cid-${id}`)?.focus(), 50);
      break;
    case 'toggle-sharing':
      apply(api.setSettings({ enabled: !s.enabled }));
      break;
    case 'toggle-service':
      apply(api.setService(id, { enabled: !s.services[id].enabled }));
      break;
    case 'toggle-option':
      apply(api.setService(id, { options: { [key]: !s.services[id].options[key] } }));
      break;
    case 'toggle-setting':
      apply(api.setSettings({ [key]: !s[key] }));
      break;
    case 'status-display':
      apply(api.setSettings({ statusDisplay: el.dataset.value }));
      break;
    case 'prefer':
      apply(api.setSettings({ preferred: s.preferred === id ? null : id }));
      break;
    case 'expand':
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render();
      break;
    case 'share-now':
      api.shareNow().then((res) => toast(res && res.ok ? 'Copied! Paste it in Discord with Ctrl+V' : `Couldn’t make the image: ${(res && res.error) || 'unknown error'}`));
      break;
    case 'stats-range':
      statsRange = el.dataset.value;
      save('statsRange', statsRange);
      resetArmed = false;
      loadStats(true);
      render();
      break;
    case 'stats-table':
      statsTable = !statsTable;
      render();
      break;
    case 'stats-reset':
      if (!resetArmed) { resetArmed = true; render(); break; }
      resetArmed = false;
      api.resetStats().then(() => loadStats(true));
      break;
    case 'update-check':
      api.checkUpdate();
      break;
    case 'update-download':
      api.downloadUpdate();
      break;
    case 'update-install':
      api.installUpdate();
      break;
    case 'own-app':
      ownApp.add(id);
      render();
      setTimeout(() => document.getElementById(`cid-${id}`)?.focus(), 50);
      break;
    case 'test':
      runTest(id);
      break;
    case 'open-url':
      e.preventDefault();
      api.openExternal(el.dataset.url);
      break;
    case 'open-folder':
      api.openFolder(el.dataset.which);
      break;
    case 'copy':
      api.copy(el.dataset.text);
      toast('Copied to clipboard');
      break;
    default:
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const { bind, id, key } = el.dataset;
  if (!bind) return;
  if (bind === 'clientId') {
    delete tests[id];
    const value = el.value.replace(/\D/g, '');
    el.value = value;
    if (id === '__fallback') apply(api.setSettings({ fallbackClientId: value }));
    else apply(api.setService(id, { clientId: value }));
    if (value) runTest(id);
  } else if (bind === 'activityType') {
    apply(api.setService(id, { activityType: Number(el.value) }));
  } else if (bind === 'option') {
    apply(api.setService(id, { options: { [key]: el.value } }));
  } else if (bind === 'logo') {
    apply(api.setService(id, { logo: el.value }));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input.input')) e.target.blur();
});

/* ---------- start ---------- */

api.onState((next) => {
  state = next;
  render();
});
api.getState().then((s) => {
  state = s;
  if (!['dashboard', 'stats', 'services', 'settings', 'setup'].includes(page)) page = 'dashboard';
  if (setupProgress().todo > 0 && !load('seen-setup')) {
    page = 'setup';
    save('seen-setup', '1');
  }
  render();
});
