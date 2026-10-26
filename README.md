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
| Prime Video | Watching Prime Video | Show and season (or movie), cover art, time left |
| Spotify (web player) | Listening to Spotify | Song, artist, album cover, time left |
| YouTube Music | Listening to YouTube Music | Song, artist, cover, time left |
| Kick | Watching Kick | Streamer, stream title, category, profile picture, "Watch Stream" button |
| X | Watching X | "Scrolling the timeline", "Viewing a profile"… |

Logos: if a service's Discord application has an **App Icon**, that icon is used as the logo. Otherwise the official one is used.

## Extras
All of these can be switched on or off in **Settings → Extras**.

- **Live lyrics.** While a song plays, your status shows the line being sung (`🎤 I've been tryna call`), and the album moves to the cover's hover text. Synced lyrics come from [LRCLIB](https://lrclib.net), a free public lyrics database; only the song's title, artist, album and length are sent. Songs without synced lyrics show as usual.
- **Ends at.** Movies and episodes of 10 minutes or more get `· ends 22:41` added, so friends know when you're free.
- **Game combo.** When a fullscreen game is running, `🎮 VALORANT` is added next to your music or show. Games are recognised as fullscreen windows that aren't a browser, Discord, a media player or a launcher; well-known games get their proper name.
- **Mini player.** A small always-on-top card with the cover, progress, ⏮ ⏯ ⏭ and a share button. Drag it anywhere; it remembers where you put it and hides when nothing plays. Turn it on in Settings or from the tray menu. The buttons control the browser tab that's playing (through Windows' media controls), so they work for every site and browser.
- **Share now playing.** The share button (Dashboard or mini player) copies an image of what you're playing to the clipboard. Paste it in any Discord chat with Ctrl+V.
- **Stats.** The **Stats** page shows how long you listened and watched (today, 7 days, 30 days, all time), a chart per day, time per service, and your top songs, artists, shows and streamers. Stats are only stored on this PC (`%APPDATA%\Presence Hub\stats.json`), and **Reset stats** clears them.
- **Smoother switching.** If what you're playing stops or goes away for a moment (skipping a song, the next episode loading, a tab reloading), your activity stays for a few seconds instead of flickering off and on.

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
- While a YouTube, YouTube Music, Netflix or Prime Video tab is showing, the app reads that window's address bar (only for those sites) to remember exactly what's playing. It keeps showing after you switch to another tab, minimize the browser, or play a game.
- Prime Video titles its pages "Prime Video: The Boys - Season 1", so the show and season are known even in a background tab. The exact episode needs the extension. The cover comes from the show's public page, found through the address bar while the tab is showing.
- YouTube Music titles its tab just "YouTube Music" except on a song's own page. A track playing while that tab is showing, or in a browser where YouTube Music was the last music site you used, counts as YouTube Music.
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
1. Bump `version` in `package.json` (e.g. `1.7.0`) and commit.
2. Tag and push: `git tag v1.7.0 && git push origin main v1.7.0`.
3. GitHub Actions builds the installer and publishes the release. Installed apps then offer the update.

Every push to `main` also builds the installer; it's attached to the workflow run under **Artifacts**.

## Settings worth knowing
- **Services → Settings** per site: thumbnail/cover on/off, buttons, keep showing when paused, show while just browsing, privacy toggles, and the status verb (Watching / Listening to / Playing / Competing in). "Use my own Discord app" lets someone use their own application name and icon.
- **Settings → Member list shows**: the app name ("Watching YouTube") or the details ("Watching Never Gonna Give You Up").
- **Keep running in the tray when closed**: off by default, so closing the window quits and clears your activity.

## Troubleshooting
- **Nothing on Discord:** check that the Discord *desktop* app is running and Activity Privacy sharing is on.
- **Buttons not visible:** Discord hides activity buttons on *your own* profile. Friends can see them.
- **Playing a game:** Discord's member list shows only one activity, usually the game. Your browser activity is still on your profile: click your name to see all activities.
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
  engine.js              picks the activity to show (+ lyrics, ends at, game)
  lyrics.js              synced lyrics from LRCLIB
  stats.js               listening/watching stats (stats.json)
  mini-player.js         the always-on-top mini player window
  share-card.js          renders the "now playing" image for the clipboard
  bridge.js              local WebSocket server for the optional extension
  store.js               settings (%APPDATA%\Presence Hub\settings.json)
  services/              one file per site
  watcher/               built-in detection
    media-watcher.ps1      reads Windows media sessions + browser window titles, finds
                           fullscreen games, and sends play/pause/skip to a media session
    local-detector.js      turns them into detected sites
    lookups.js             YouTube video / album art / Kick channel lookups
src/renderer/          the app UI (index.html), mini player (mini.html), share card (share.html)
extension/             optional browser extension (Manifest V3)
assets/                app icons and Discord app icons
```

`npm run dist` builds the Windows installer into `dist/`.
