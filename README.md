# Presence Hub

Show what you're doing in your browser as your **Discord activity**: the YouTube video you're watching, the Kick stream you're on, the song playing in the Spotify web player (with time left), or just that you're on X.

**Nothing to set up:** install, keep it open, done. It works with every browser (Chrome, Edge, Brave, Opera, Vivaldi, Firefox…) without an extension, and without creating Discord applications.

- Real logos, video thumbnails, album covers and streamer pictures
- Live progress bar / timer on your profile
- Works when the tab is in the background
- Shows only while this app is running; quit it and the activity disappears
- One switch to turn sharing on or off, plus a switch and options per site

| Site | Shows as | What friends see |
|---|---|---|
| YouTube | Watching YouTube | Video title, channel, thumbnail, time left, "Watch on YouTube" button |
| Netflix | Watching Netflix | Show and episode (or movie), artwork, time left |
| Spotify (web player) | Listening to Spotify | Song, artist, album cover, time left |
| YouTube Music | Listening to YouTube Music | Song, artist, cover, time left |
| Kick | Watching Kick | Streamer, stream title, category, profile picture, "Watch Stream" button |
| X | Watching X | "Scrolling the timeline", "Viewing a profile"… |

Logos: if a service's Discord application has an **App Icon**, that icon is used as the logo. Otherwise the official one is used.

## How it works

```
Browsers ──► Windows media info + browser window titles ──► Presence Hub ──(Discord RPC)──► Discord
```

- **Built-in detection (default).** Every browser reports what's playing to Windows (the same info as the media pop-up on the volume keys): title, artist, album, playing or paused, position and length. Presence Hub reads that, plus the title of each browser window (that is, the tab it's showing). Then it fills in the rest online: the YouTube video (for its thumbnail and link), album art (iTunes), and Kick channel info.
- **Built-in Discord apps.** The Discord applications ("YouTube", "Spotify", "Kick", "X") ship with the app in `src/main/discord-apps.js`, so users don't create their own. Application IDs are public, not secrets.
- **Optional browser extension** (Chrome, Edge, Brave, Opera). It reads the pages directly, so it's more precise: X and paused videos in background tabs, exact links and Spotify track buttons. When it's installed, its results win for the sites it reports.

If several things are open, it shows, in this order:
1. the service you starred (★ on the Dashboard)
2. something that's actually **playing**
3. what you looked at most recently.

### Built-in detection: good to know
- Windows only knows about tabs that play media, one per browser at a time (the latest one). Sites without media, like X, are seen when they're the tab showing in a browser window. Minimized windows count.
- Spotify is recognised by its album info, so a song from another music site may show up as Spotify too.
- Netflix titles every page just "Netflix" and doesn't tell Windows what's on. So while a Netflix tab is showing, the app reads that window's address bar (only for Netflix) to get the video number, and looks the show and episode up on Netflix's public title page. It keeps the show after you switch tabs. If another episode starts while the tab is hidden, the episode is updated once the tab is shown again.
- Media in private/incognito windows is visible to Windows as well. Pause sharing (tray icon or the switch) if you don't want that shown.

## Install
Download `Presence-Hub-Setup-<version>.exe` from the [latest release](https://github.com/limbowin100mc/DiscordConn/releases/latest) and run it. From source: `npm install`, then `npm start`.

Then keep the **Discord desktop app** open, with **User Settings → Activity Privacy → Share your detected activities with others** turned on.

### Optional: the extension
Open `chrome://extensions` (or `edge://extensions`, …), turn on **Developer mode**, click **Load unpacked** and pick the extension folder. The app shows the exact path in Settings.

## Updates
**Settings → Updates** shows the installed version and checks this repo's [GitHub Releases](https://github.com/limbowin100mc/DiscordConn/releases) for a newer one. It checks by itself when the app starts and every few hours (you can turn that off). When there's an update, a card appears in the sidebar; **Download & install** fetches it, and **Restart & update** installs it. Nothing installs without you clicking.

## Releasing a new version
1. Bump `version` in `package.json` (e.g. `1.6.0`) and commit.
2. Tag and push: `git tag v1.6.0 && git push origin main v1.6.0`.
3. GitHub Actions builds the installer and publishes the release. Installed apps then offer the update.

Every push to `main` also builds the installer; it's attached to the workflow run under **Artifacts**.

## Settings worth knowing
- **Services → Settings** per site: thumbnail/cover on/off, buttons, keep showing when paused, show while just browsing, privacy toggles, and the status verb (Watching / Listening to / Playing / Competing in). "Use my own Discord app" lets someone use their own application name and icon.
- **Settings → Member list shows**: the app name ("Watching YouTube") or the details ("Watching Never Gonna Give You Up").
- **Keep running in the tray when closed**: off by default, so closing the window quits and clears your activity.

## Troubleshooting
- **Nothing on Discord:** check that the Discord *desktop* app is running and Activity Privacy sharing is on.
- **Buttons not visible:** Discord hides activity buttons on *your own* profile. Friends can see them.
- **Spotify shows twice:** if Spotify is linked under Discord *Connections*, Discord may already show it. Turn one of them off.

## Adding a new site later
1. `src/main/services/<site>.js`: name, colour, logo, options, and `build(data, options, ctx)`, which turns detected data into a Discord activity (see `youtube.js`). Register it in `src/main/services/index.js`.
2. Detection:
   - Built-in: teach `src/main/watcher/local-detector.js` to recognise the site from its media info or window title.
   - Extension (optional): add `extension/content/<site>.js` (`PresenceHub.register(...)`) plus a `manifest.json` entry.
3. Create a Discord application for it and add its ID to `src/main/discord-apps.js`.
4. Put a logo PNG in `src/renderer/logos/` and `assets/discord-icons/`.

## Project layout
```
src/main/              Electron main process
  main.js                window, tray, IPC
  discord-apps.js        built-in Discord application IDs
  discord-ipc.js         Discord RPC client (named pipe protocol)
  presence-manager.js    connection, reconnects, rate limit (5 updates / 20 s)
  engine.js              picks the activity to show
  bridge.js              local WebSocket server for the optional extension
  store.js               settings (%APPDATA%\Presence Hub\settings.json)
  services/              one file per site
  watcher/               built-in detection
    media-watcher.ps1      reads Windows media sessions + browser window titles
    local-detector.js      turns them into detected sites
    lookups.js             YouTube video / album art / Kick channel lookups
src/renderer/          the app UI
extension/             optional browser extension (Manifest V3)
assets/                app icons and Discord app icons
```

`npm run dist` builds the Windows installer into `dist/`.
