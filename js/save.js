/* Meta progression persisted in localStorage. */
(function (PK) {
  'use strict';

  var KEY = 'pegfall.meta.v1';

  var UNLOCKS = [
    { ball: 'bomb', floor: 3, name: 'Bomb ball' },
    { ball: 'ghost', floor: 5, name: 'Ghost ball' },
    { ball: 'magnet', floor: 7, name: 'Magnet ball' },
    { ball: 'voidball', floor: 9, name: 'Void ball' }
  ];

  var DEFAULT = { bestFloor: 0, runs: 0, bestScore: 0, totalScore: 0, deepestSeed: '' };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULT);
      return Object.assign({}, DEFAULT, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULT);
    }
  }

  function save(meta) {
    try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { /* file:// or private mode */ }
  }

  function unlockedBalls(meta) {
    var base = ['standard', 'heavy', 'bouncy', 'lucky', 'splitter'];
    UNLOCKS.forEach(function (u) { if (meta.bestFloor >= u.floor) base.push(u.ball); });
    // Arcade progression is a second, parallel route to the same balls: buy
    // one with Shards instead of waiting to reach its floor. Either unlocks
    // it, and owning both changes nothing.
    if (window.Arcade && window.Arcade.progress) {
      window.Arcade.progress.granted('pegfall', 'ball').forEach(function (id) {
        if (base.indexOf(id) === -1) base.push(id);
      });
    }
    return base;
  }

  function nextUnlock(meta) {
    for (var i = 0; i < UNLOCKS.length; i++) {
      if (meta.bestFloor < UNLOCKS[i].floor) return UNLOCKS[i];
    }
    return null;
  }

  /* ---------------------------------------------------------------- run

     The in-progress run, so closing the tab does not cost a floor. Kept in its
     own key: a corrupt or outdated run must never take the meta progression
     down with it.

     Balls in flight are deliberately not saved. Every save point is a moment
     when the board is still — after a ball lands, entering the shop, starting
     a floor — so there is never a half-fallen ball to reconstruct. */

  var RUN_KEY = 'pegfall.run.v1';
  var RUN_VERSION = 1;

  function saveRun(snapshot) {
    try {
      snapshot.v = RUN_VERSION;
      localStorage.setItem(RUN_KEY, JSON.stringify(snapshot));
    } catch (e) { /* file:// or private mode: the run just will not resume */ }
  }

  function loadRun() {
    try {
      var raw = localStorage.getItem(RUN_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      // A save from an older build describes a board this build may no longer
      // understand, so it is dropped rather than half-restored.
      if (!data || data.v !== RUN_VERSION) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearRun() {
    try { localStorage.removeItem(RUN_KEY); } catch (e) { /* nothing to do */ }
  }

  function hasRun() { return !!loadRun(); }

  PK.Save = {
    load: load, save: save, unlockedBalls: unlockedBalls, nextUnlock: nextUnlock, UNLOCKS: UNLOCKS,
    saveRun: saveRun, loadRun: loadRun, clearRun: clearRun, hasRun: hasRun
  };
})(window.PK = window.PK || {});
