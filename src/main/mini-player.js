'use strict';

// The mini player: a small always-on-top "now playing" card with ⏮ ⏯ ⏭.
// Shown when it's turned on in Settings and something is being shown on Discord.

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const WIDTH = 360;
const HEIGHT = 108;

class MiniPlayer {
  constructor({ store, preload, page, icon }) {
    this.store = store;
    this.preload = preload;
    this.page = page;
    this.icon = icon;
    this.win = null;
    this.lastState = null;
  }

  update(state) {
    this.lastState = state;
    const want = !!(state.settings.miniPlayer && state.current);
    if (want && !this.win) this._create();
    if (!this.win) return;
    if (want) {
      this.win.webContents.send('state', state);
      if (!this.win.isVisible() && this.ready) this.win.showInactive();
    } else if (this.win.isVisible()) {
      this.win.hide();
    }
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  _create() {
    const saved = this.store.get().miniBounds;
    const area = screen.getPrimaryDisplay().workArea;
    let x = area.x + area.width - WIDTH - 24;
    let y = area.y + area.height - HEIGHT - 24;
    // Use the saved position if it's still on a screen.
    if (saved && screen.getAllDisplays().some((d) => saved.x >= d.workArea.x && saved.y >= d.workArea.y
      && saved.x + 40 <= d.workArea.x + d.workArea.width && saved.y + 40 <= d.workArea.y + d.workArea.height)) {
      ({ x, y } = saved);
    }
    this.ready = false;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      title: 'Presence Hub mini player',
      icon: this.icon,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver'); // stays above borderless/fullscreen-windowed games
    win.loadFile(this.page);
    win.once('ready-to-show', () => {
      this.ready = true;
      if (this.lastState) this.update(this.lastState);
    });
    let moveTimer;
    win.on('moved', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const [mx, my] = win.getPosition();
        this.store.set({ miniBounds: { x: mx, y: my } });
      }, 400);
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win = win;
  }
}

module.exports = { MiniPlayer, pagePath: (dir) => path.join(dir, 'mini.html') };
