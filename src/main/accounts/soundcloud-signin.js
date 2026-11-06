'use strict';

// SoundCloud's own sign-in page, in a window with a session of its own. Once you're
// signed in, soundcloud.com keeps your sign-in token in its "oauth_token" cookie;
// that's all we take, and the window closes.

const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:soundcloud-signin';
const SIGN_IN_URL = 'https://soundcloud.com/signin';
const isSoundCloud = (domain) => /(^|\.)soundcloud\.com$/i.test(String(domain || '').replace(/^\./, ''));

function signInSession() {
  const ses = session.fromPartition(PARTITION);
  // Some sign-in providers (Google) turn away browsers that say they're an app.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(?:Electron|presence-hub)\/\S+/gi, ''));
  return ses;
}

// Resolves with the token, or null if the window was closed first.
async function signIn({ parent = null, icon } = {}) {
  const ses = signInSession();
  const saved = (await ses.cookies.get({ name: 'oauth_token' })).find((c) => isSoundCloud(c.domain) && c.value);
  if (saved) return saved.value;

  return new Promise((resolve) => {
    let done = false;
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title: 'Sign in to SoundCloud',
      icon,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const onCookie = (_e, cookie, _cause, removed) => {
      if (!removed && cookie.name === 'oauth_token' && cookie.value && isSoundCloud(cookie.domain)) finish(cookie.value);
    };
    function finish(token) {
      if (done) return;
      done = true;
      ses.cookies.removeListener('changed', onCookie);
      if (!win.isDestroyed()) win.close();
      resolve(token);
    }
    ses.cookies.on('changed', onCookie);
    // "Continue with Google / Apple / Facebook" open in pop-ups. SoundCloud opens an
    // empty one first (about:blank) and then sends it to the provider.
    win.webContents.setWindowOpenHandler(({ url }) => (/^(https:\/\/|about:blank$)/.test(url || 'about:blank')
      ? { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 520, height: 700, autoHideMenuBar: true, backgroundColor: '#ffffff' } }
      : { action: 'deny' }));
    win.on('closed', () => finish(null));
    win.loadURL(SIGN_IN_URL);
  });
}

// Forget the SoundCloud sign-in (used when you disconnect).
function signOut() {
  return signInSession().clearStorageData();
}

module.exports = { signIn, signOut };
