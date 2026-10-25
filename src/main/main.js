'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, nativeImage, net } = require('electron');
const { Store } = require('./store');
const { Bridge } = require('./bridge');
const { LocalDetector } = require('./watcher/local-detector');
const { PresenceManager, testClientId } = require('./presence-manager');
const { Engine } = require('./engine');
const { AppIcons } = require('./app-icons');
const { Updater } = require('./updater');
const registry = require('./services');

const PORT = 47823;
const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const EXTENSION_DIR = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(ROOT, 'extension');
const ICONS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'discord-icons') : path.join(ASSETS, 'discord-icons');
const VERBS = { 0: 'Playing', 2: 'Listening to', 3: 'Watching', 5: 'Competing in' };

let win = null;
let tray = null;
let store;
let bridge;
let detector;
let presence;
let updater;
let engine;
let quitting = false;
let cleanedUp = false;

app.setAppUserModelId('com.presencehub.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

function start() {
  Menu.setApplicationMenu(null);

  store = new Store(app.getPath('userData'), registry.services);
  bridge = new Bridge(PORT);
  detector = new LocalDetector({
    // PowerShell can't read files inside app.asar, so the script ships unpacked.
    scriptPath: path.join(__dirname, 'watcher', 'media-watcher.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
    fetcher: (url, opts) => net.fetch(url, opts),
  });
  presence = new PresenceManager();
  updater = new Updater();
  const appIcons = new AppIcons((url, opts) => net.fetch(url, opts), () => engine && engine.schedule());
  engine = new Engine({
    store,
    bridge,
    detector,
    presence,
    appIcons,
    updater,
    info: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      paths: { extension: EXTENSION_DIR, icons: ICONS_DIR, port: PORT },
    },
  });

  engine.on('state', (state) => {
    if (win && !win.isDestroyed()) win.webContents.send('state', state);
    updateTray();
  });

  registerIpc();
  bridge.start();
  detector.start();
  engine.compute();
  applyLoginItem();
  updater.setAutomatic(store.get().autoUpdate);

  createTray();
  const hidden = process.argv.includes('--hidden') || store.get().startMinimized;
  createWindow(!hidden);

  app.on('window-all-closed', () => {
    if (!store.get().closeToTray || quitting) app.quit();
  });
  app.on('before-quit', (e) => {
    quitting = true;
    if (cleanedUp) return;
    e.preventDefault();
    cleanup().finally(() => {
      cleanedUp = true;
      app.quit();
    });
  });
}

async function cleanup() {
  store.flush();
  bridge.stop();
  detector.stop();
  await Promise.race([presence.destroy(), new Promise((r) => setTimeout(r, 1500))]);
}

function createWindow(show) {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Presence Hub',
    backgroundColor: '#0b0d12',
    icon: path.join(ASSETS, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#9aa3b5', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!quitting && store.get().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) createWindow(true);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function trayImage(on) {
  const name = on ? 'tray' : 'tray-off';
  const img = nativeImage.createFromPath(path.join(ASSETS, `${name}-16.png`));
  img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(ASSETS, `${name}-32.png`)) });
  return img;
}

let trayKey = '';
function createTray() {
  tray = new Tray(trayImage(true));
  tray.on('click', showWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const s = store.get();
  const cur = engine.current;
  const svc = cur && registry.get(cur.service);
  const verb = svc && VERBS[cur.activity.type];
  const showing = svc ? `${verb ? `${verb} ` : ''}${svc.name}${cur.activity.details ? ` — ${cur.activity.details}` : ''}` : null;
  const key = JSON.stringify([s.enabled, showing]);
  if (key === trayKey) return;
  trayKey = key;

  tray.setImage(trayImage(s.enabled));
  const tip = !s.enabled ? 'Presence Hub — sharing paused' : showing ? `Presence Hub — ${showing}` : 'Presence Hub — nothing to show';
  tray.setToolTip(tip.length > 127 ? `${tip.slice(0, 124)}...` : tip);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Presence Hub', click: showWindow },
    { type: 'separator' },
    { label: showing ? (showing.length > 60 ? `${showing.slice(0, 57)}...` : showing) : 'Nothing shown right now', enabled: false },
    { label: 'Show my activity on Discord', type: 'checkbox', checked: s.enabled, click: (item) => store.set({ enabled: item.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: store.get().launchAtLogin, args: ['--hidden'] });
}

function openExternal(url) {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
}

function registerIpc() {
  ipcMain.handle('state:get', () => engine.getState());

  ipcMain.handle('settings:set', (_e, patch) => {
    store.set(patch && typeof patch === 'object' ? patch : {});
    if (patch && 'launchAtLogin' in patch) applyLoginItem();
    if (patch && 'autoUpdate' in patch) updater.setAutomatic(store.get().autoUpdate);
    return engine.getState();
  });

  ipcMain.handle('service:set', (_e, id, patch) => {
    store.setService(String(id), patch && typeof patch === 'object' ? patch : {});
    return engine.getState();
  });

  ipcMain.handle('service:test', async (_e, id) => {
    const s = store.get();
    const clientId = id === '__fallback' ? s.fallbackClientId : s.services[id] && engine.clientIdFor(id);
    if (!clientId) return { ok: false, error: 'Paste a Client ID first' };
    // Already connected with this app? Then it works.
    if (presence.client && presence.client.ready && presence.clientId === clientId) {
      return { ok: true, user: presence.status.user };
    }
    return testClientId(clientId);
  });

  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('app:open-external', (_e, url) => openExternal(url));
  ipcMain.handle('app:open-folder', (_e, which) => shell.openPath(which === 'icons' ? ICONS_DIR : EXTENSION_DIR));
  ipcMain.handle('app:copy', (_e, text) => clipboard.writeText(String(text)));
}
