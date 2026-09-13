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
    return base;
  }

  function nextUnlock(meta) {
    for (var i = 0; i < UNLOCKS.length; i++) {
      if (meta.bestFloor < UNLOCKS[i].floor) return UNLOCKS[i];
    }
    return null;
  }

  PK.Save = { load: load, save: save, unlockedBalls: unlockedBalls, nextUnlock: nextUnlock, UNLOCKS: UNLOCKS };
})(window.PK = window.PK || {});
