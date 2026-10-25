'use strict';

// Looks up the icon of a Discord application (public info, no login needed), so the
// icon set in the Developer Portal can be used as the service's logo.

const TTL = 30 * 60 * 1000;

class AppIcons {
  constructor(fetcher, onUpdate) {
    this.fetch = fetcher;
    this.onUpdate = onUpdate;
    this.cache = new Map(); // clientId -> { url, at, pending }
  }

  // Icon URL if the app has one, null if not, undefined while the first lookup runs.
  get(clientId) {
    if (!clientId) return null;
    const now = Date.now();
    const hit = this.cache.get(clientId);
    if (hit && (hit.pending || now - hit.at < TTL)) return hit.url;
    const entry = { url: hit ? hit.url : undefined, at: now, pending: true };
    this.cache.set(clientId, entry);
    this.fetch(`https://discord.com/api/v10/applications/${clientId}/rpc`)
      .then((res) => (res.ok ? res.json() : null))
      .then((app) => {
        entry.url = app && app.icon ? `https://cdn.discordapp.com/app-icons/${clientId}/${app.icon}.png?size=512` : null;
      })
      .catch(() => { if (entry.url === undefined) entry.url = null; })
      .finally(() => {
        entry.pending = false;
        entry.at = Date.now();
        this.onUpdate();
      });
    return entry.url;
  }
}

module.exports = { AppIcons };
