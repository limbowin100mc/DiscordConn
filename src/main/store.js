'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const GENERAL_DEFAULTS = {
  enabled: true,
  closeToTray: false,
  startMinimized: false,
  launchAtLogin: false,
  autoUpdate: true, // check GitHub for new versions in the background
  statusDisplay: 'name', // what the member list shows: name | details | state
  fallbackClientId: '',
  preferred: null, // service id that wins when several are active
};

class Store extends EventEmitter {
  constructor(dir, services) {
    super();
    this.file = path.join(dir, 'settings.json');
    this.services = services;
    this.data = this._normalize(this._read());
  }

  get() {
    return this.data;
  }

  set(patch) {
    const next = { ...this.data };
    for (const key of Object.keys(GENERAL_DEFAULTS)) {
      if (key in patch) next[key] = patch[key];
    }
    this.data = this._normalize(next);
    this._save();
  }

  setService(id, patch) {
    const cur = this.data.services[id];
    if (!cur) return;
    const next = { ...cur };
    if ('enabled' in patch) next.enabled = !!patch.enabled;
    if ('clientId' in patch) next.clientId = String(patch.clientId || '').replace(/\D/g, '');
    if ('activityType' in patch) next.activityType = patch.activityType;
    if ('logo' in patch) next.logo = String(patch.logo || '').trim();
    if (patch.options) next.options = { ...cur.options, ...patch.options };
    this.data = this._normalize({ ...this.data, services: { ...this.data.services, [id]: next } });
    this._save();
  }

  _normalize(raw) {
    const out = { ...GENERAL_DEFAULTS };
    for (const key of Object.keys(GENERAL_DEFAULTS)) {
      if (raw && raw[key] !== undefined && typeof raw[key] === typeof GENERAL_DEFAULTS[key]) out[key] = raw[key];
    }
    if (raw && (typeof raw.preferred === 'string' || raw.preferred === null)) out.preferred = raw.preferred;
    if (!['name', 'details', 'state'].includes(out.statusDisplay)) out.statusDisplay = 'name';
    out.fallbackClientId = String(out.fallbackClientId || '').replace(/\D/g, '');

    out.services = {};
    for (const svc of this.services) {
      const saved = (raw && raw.services && raw.services[svc.id]) || {};
      const options = {};
      for (const opt of svc.options) {
        const v = saved.options ? saved.options[opt.key] : undefined;
        options[opt.key] = v !== undefined && typeof v === typeof opt.default ? v : opt.default;
      }
      out.services[svc.id] = {
        enabled: saved.enabled !== undefined ? !!saved.enabled : true,
        clientId: String(saved.clientId || '').replace(/\D/g, ''),
        activityType: [0, 2, 3, 5].includes(saved.activityType) ? saved.activityType : null,
        logo: typeof saved.logo === 'string' ? saved.logo : '',
        options,
      };
    }
    return out;
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  _save() {
    this.emit('change', this.data);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save settings:', err.message);
    }
  }
}

module.exports = { Store };
