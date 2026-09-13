/* Player preferences, kept apart from run state so they survive a dead run.
   Read synchronously by the audio layer, so it loads before anything plays. */
(function (PK) {
  'use strict';

  var KEY = 'pegfall.settings.v1';

  var DEFAULTS = {
    sfx: true,
    volume: 0.6
  };

  var Settings = {};

  function load() {
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { /* no storage */ }
    var k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) Settings[k] = DEFAULTS[k];
    for (k in stored) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) Settings[k] = stored[k];
    return Settings;
  }

  function set(key, value) {
    Settings[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(Settings)); } catch (e) { /* file:// or private mode */ }
    return value;
  }

  load();

  PK.Settings = Settings;
  PK.loadSettings = load;
  PK.setSetting = set;
})(window.PK = window.PK || {});
