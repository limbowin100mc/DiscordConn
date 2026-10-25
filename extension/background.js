'use strict';

// Collects what each supported tab reports and forwards it to the Presence Hub
// desktop app over a local WebSocket. Works for background tabs too: only the
// tab has to be open.

const APP = '127.0.0.1:47823';

const tabs = new Map(); // tabId -> { service, data, focusedAt }
const focusTimes = new Map(); // tabId -> last time you switched to it
let ws = null;
let connecting = false;
let appState = null;
let retryTimer = null;
let retryDelay = 2000;
let pingTimer = null;

function browserName() {
  const brands = ((navigator.userAgentData && navigator.userAgentData.brands) || []).map((b) => b.brand);
  const has = (re) => brands.some((b) => re.test(b));
  const ua = navigator.userAgent;
  if (has(/Edge/) || /Edg\//.test(ua)) return 'Edge';
  if (has(/Opera GX/)) return 'Opera GX';
  if (has(/Opera/) || /OPR\//.test(ua)) return 'Opera';
  if (has(/Brave/)) return 'Brave';
  if (has(/Vivaldi/) || /Vivaldi/.test(ua)) return 'Vivaldi';
  if (has(/Google Chrome/)) return 'Chrome';
  if (has(/Chromium/)) return 'Chromium';
  if (/Chrome\//.test(ua)) return 'Chrome';
  return 'Browser';
}

function isOpen() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function send(msg) {
  if (isOpen()) ws.send(JSON.stringify(msg));
}

async function connect() {
  if (connecting || (ws && ws.readyState <= WebSocket.OPEN)) return;
  connecting = true;
  clearTimeout(retryTimer);
  try {
    // Check the app is running first, so a closed app doesn't spam WebSocket errors.
    const res = await fetch(`http://${APP}/health`, { cache: 'no-store' });
    if (!res.ok) throw new Error('not presence hub');
  } catch {
    connecting = false;
    scheduleRetry();
    return;
  }

  const sock = new WebSocket(`ws://${APP}`);
  ws = sock;
  connecting = false;
  sock.onopen = () => {
    retryDelay = 2000;
    send({ type: 'hello', browser: browserName(), version: chrome.runtime.getManifest().version });
    send({ type: 'sync', tabs: [...tabs].map(([tabId, t]) => ({ tabId, ...t })) });
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), 20000); // also keeps this worker alive
  };
  sock.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') appState = msg;
    } catch { /* ignore */ }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    appState = null;
    clearInterval(pingTimer);
    scheduleRetry();
  };
  sock.onerror = () => { /* onclose follows */ };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(Math.round(retryDelay * 1.5), 10000);
}

function removeTab(tabId) {
  focusTimes.delete(tabId);
  if (tabs.delete(tabId)) send({ type: 'remove', tabId });
}

function markFocused(tabId) {
  const now = Date.now();
  focusTimes.set(tabId, now);
  const t = tabs.get(tabId);
  if (t) {
    t.focusedAt = now;
    send({ type: 'focus', tabId, focusedAt: now });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return undefined;

  if (msg.type === 'presence') {
    const tab = sender.tab;
    if (!tab || tab.incognito || sender.frameId !== 0) return undefined;
    if (msg.data) {
      const prev = tabs.get(tab.id);
      let focusedAt = focusTimes.get(tab.id) || (prev && prev.focusedAt) || 0;
      if (!focusedAt && tab.active) {
        focusedAt = Date.now();
        focusTimes.set(tab.id, focusedAt);
      }
      const entry = { service: String(msg.service), data: msg.data, focusedAt };
      tabs.set(tab.id, entry);
      send({ type: 'update', tabId: tab.id, ...entry });
    } else {
      removeTab(tab.id);
    }
    connect();
    return undefined;
  }

  if (msg.type === 'status') {
    sendResponse({
      connected: isOpen(),
      app: appState,
      tabs: [...tabs.values()].map((t) => ({ service: t.service, data: t.data })),
    });
  }
  return undefined;
});

chrome.tabs.onActivated.addListener(({ tabId }) => markFocused(tabId));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) markFocused(tab.id);
});
chrome.tabs.onRemoved.addListener((tabId) => removeTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tabs.has(tabId)) return;
  // tab.url is only visible for the sites we support, so a missing url means it left them.
  if (info.discarded || (info.status === 'loading' && !tab.url)) removeTab(tabId);
});

// Content scripts are only injected into pages loaded after install; add them to tabs that are already open.
chrome.runtime.onInstalled.addListener(async () => {
  for (const cs of chrome.runtime.getManifest().content_scripts || []) {
    const open = await chrome.tabs.query({ url: cs.matches });
    for (const tab of open) {
      if (tab.discarded || tab.incognito) continue;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js, world: cs.world || 'ISOLATED' }).catch(() => {});
    }
  }
});

// When this worker restarts it forgets everything; ask open tabs to report again.
async function resync() {
  const patterns = (chrome.runtime.getManifest().content_scripts || []).flatMap((cs) => cs.matches);
  const open = await chrome.tabs.query({ url: patterns });
  for (const tab of open) chrome.tabs.sendMessage(tab.id, { type: 'resend' }).catch(() => {});
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && !focusTimes.has(active.id)) focusTimes.set(active.id, Date.now());
}

chrome.alarms.create('presence-hub-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());

resync();
connect();
