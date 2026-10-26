'use strict';

// "Share now playing": renders a card image of what's playing in a hidden window
// and puts it on the clipboard, ready to paste into a Discord chat.

const { BrowserWindow, clipboard, ClipboardItem } = require('electron');

const WIDTH = 640;
const HEIGHT = 240;

async function shareNowPlaying({ page, card }) {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(page, { hash: encodeURIComponent(JSON.stringify(card)) });
    // Wait until the card says its images are in (or gave up on them).
    await win.webContents.executeJavaScript('window.cardReady', true);
    await new Promise((r) => setTimeout(r, 150));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    if (image.isEmpty()) return { ok: false, error: 'Could not draw the card' };
    // Electron 45+: the clipboard takes ClipboardItems (PNG; Windows also gets a bitmap copy).
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    win.destroy();
  }
}

module.exports = { shareNowPlaying };
