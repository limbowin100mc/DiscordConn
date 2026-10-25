'use strict';

// To add a new site: create a file here (see youtube.js for the shape), add it to
// this list, and add a matching content script in extension/content + manifest.json.
const services = [
  require('./youtube'),
  require('./netflix'),
  require('./primevideo'),
  require('./spotify'),
  require('./ytmusic'),
  require('./kick'),
  require('./x'),
];

const byId = new Map(services.map((s) => [s.id, s]));

module.exports = { services, get: (id) => byId.get(id) };
