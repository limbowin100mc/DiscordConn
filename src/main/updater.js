'use strict';

// Checks GitHub Releases for a newer version (electron-updater), downloads it when
// you ask, and installs it on restart. Only works in the installed app.

const { EventEmitter } = require('events');
const { app } = require('electron');

const CHECK_EVERY = 6 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: app.isPackaged ? 'idle' : 'dev', version: null, progress: 0, error: null, checkedAt: null };
    this.timer = null;
    if (!app.isPackaged) return;

    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true; // a downloaded update also installs on a normal quit
    autoUpdater.on('checking-for-update', () => this._set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => this._set({ status: 'available', version: info.version, checkedAt: Date.now() }));
    autoUpdater.on('update-not-available', () => this._set({ status: 'latest', version: null, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this._set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => this._set({ status: 'downloaded', version: info.version, progress: 100 }));
    autoUpdater.on('error', (err) => {
      // Keep a found update visible; only report the error.
      const status = this.state.status === 'downloading' ? 'available' : this.state.status === 'checking' ? 'error' : this.state.status;
      this._set({ status, error: friendly(err) });
    });
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  // Background checks: soon after start, then every few hours.
  setAutomatic(on) {
    clearInterval(this.timer);
    clearTimeout(this.firstCheck);
    if (!this.au || !on) return;
    this.firstCheck = setTimeout(() => this.check(true), 15000);
    this.timer = setInterval(() => this.check(true), CHECK_EVERY);
  }

  async check(background = false) {
    if (!this.au) return this.state;
    if (['checking', 'downloading', 'downloaded'].includes(this.state.status)) return this.state;
    if (background && this.state.status === 'available') return this.state;
    try {
      await this.au.checkForUpdates();
    } catch (err) {
      this._set({ status: 'error', error: friendly(err) });
    }
    return this.state;
  }

  async download() {
    if (!this.au || this.state.status !== 'available') return this.state;
    this._set({ status: 'downloading', progress: 0, error: null });
    try {
      await this.au.downloadUpdate();
    } catch (err) {
      this._set({ status: 'available', error: friendly(err) });
    }
    return this.state;
  }

  install() {
    if (this.au && this.state.status === 'downloaded') this.au.quitAndInstall(true, true);
  }
}

function friendly(err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::ERR/i.test(msg)) return 'No internet connection';
  if (/404|Unable to find latest version|No published versions/i.test(msg)) return 'No releases found on GitHub yet';
  return msg.split('\n')[0].slice(0, 160);
}

module.exports = { Updater };
