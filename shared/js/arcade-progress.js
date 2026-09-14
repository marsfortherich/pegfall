/* ============================================================================
   arcade-progress.js — the meta layer that outlives a run.

   Currencies, purchased unlocks, achievements, difficulty clears and lifetime
   totals, for every game in the arcade. Each game already keeps its own
   profile (records, discovered content, its own threshold unlocks); this sits
   alongside those rather than replacing them, so nothing that already works
   has to be rewritten.

   Stored in localStorage under one key. It is deliberately local: the games
   are local-first, and a progression that vanishes when the network does is
   worse than one that never left the browser. The store is a narrow API over
   a plain object, so a cloud-backed implementation can be dropped in behind it
   later without callers changing.

   Steam: nothing here talks to Steam, but everything a Steam build needs is
   recorded in the shape it would want — stable achievement ids, per-difficulty
   clears, and lifetime stats. `snapshotForSteam()` is the seam.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  var KEY = 'arcade.progress.v1';
  var VERSION = 1;

  function blank() {
    return {
      version: VERSION,
      totals: { runs: 0, wins: 0 },
      achievements: {},           // id -> epoch ms earned
      games: {}                   // gameId -> { runs, wins, best, currency:{}, unlocked:{}, clears:{} }
    };
  }

  function blankGame() {
    return { runs: 0, wins: 0, best: 0, currency: {}, unlocked: {}, off: {}, clears: {} };
  }

  var data = null;
  var listeners = [];

  function load() {
    var stored = null;
    try { stored = JSON.parse(global.localStorage.getItem(KEY) || 'null'); } catch (e) { stored = null; }
    data = blank();
    if (stored && stored.version === VERSION) {
      data.totals = Object.assign(data.totals, stored.totals || {});
      data.achievements = stored.achievements || {};
      data.games = stored.games || {};
    }
    return data;
  }

  function save() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state())); }
    catch (e) { /* private mode: progression is in-memory for this session */ }
    emit();
  }

  function state() { if (!data) load(); return data; }

  function game(gameId) {
    var s = state();
    if (!s.games[gameId]) s.games[gameId] = blankGame();
    // A game saved by an older build may be missing newer sub-objects.
    var g = s.games[gameId];
    if (!g.currency) g.currency = {};
    if (!g.unlocked) g.unlocked = {};
    if (!g.off) g.off = {};
    if (!g.clears) g.clears = {};
    return g;
  }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(state()); } catch (e) { /* a bad listener must not stop the rest */ }
    });
  }

  /* ------------------------------------------------------------ currency */

  function currencyId(gameId) {
    var p = Arcade.progressionOf(gameId);
    return p ? p.currency.id : 'points';
  }

  function balance(gameId) {
    return game(gameId).currency[currencyId(gameId)] || 0;
  }

  function grant(gameId, amount) {
    if (!(amount > 0)) return 0;
    var g = game(gameId);
    var id = currencyId(gameId);
    g.currency[id] = (g.currency[id] || 0) + Math.floor(amount);
    save();
    return g.currency[id];
  }

  /* ------------------------------------------------------------- unlocks */

  function unlockDef(gameId, unlockId) {
    var p = Arcade.progressionOf(gameId);
    if (!p) return null;
    for (var i = 0; i < p.unlocks.length; i++) {
      if (p.unlocks[i].id === unlockId) return p.unlocks[i];
    }
    return null;
  }

  /** Owned — bought and paid for, whether or not it is currently applied. */
  function isUnlocked(gameId, unlockId) {
    return !!game(gameId).unlocked[unlockId];
  }

  /**
   * Owned *and* switched on.
   *
   * Progression is a one-way ratchet on difficulty otherwise: once you own the
   * sixth die there is no way back to the game without it. Owning and applying
   * are therefore separate, so a player can put an advantage down without
   * losing what they paid for it.
   */
  function isActive(gameId, unlockId) {
    var g = game(gameId);
    return !!g.unlocked[unlockId] && !g.off[unlockId];
  }

  /** Switch an owned unlock on or off. Returns the new state. */
  function setActive(gameId, unlockId, on) {
    var g = game(gameId);
    if (!g.unlocked[unlockId]) return false;
    if (on) delete g.off[unlockId];
    else g.off[unlockId] = true;
    save();
    return isActive(gameId, unlockId);
  }

  function toggle(gameId, unlockId) {
    return setActive(gameId, unlockId, !isActive(gameId, unlockId));
  }

  /** Buy an unlock. Returns { ok, reason } — never throws at a caller. */
  function buy(gameId, unlockId) {
    var def = unlockDef(gameId, unlockId);
    if (!def) return { ok: false, reason: 'No such unlock.' };
    if (isUnlocked(gameId, unlockId)) return { ok: false, reason: 'Already unlocked.' };
    var g = game(gameId);
    var id = currencyId(gameId);
    if ((g.currency[id] || 0) < def.cost) return { ok: false, reason: 'Not enough yet.' };
    g.currency[id] -= def.cost;
    g.unlocked[unlockId] = Date.now();
    save();
    return { ok: true, unlock: def };
  }

  /**
   * Every `effect` tag a game has unlocked, as a map.
   * 'gold:4' becomes { gold: 4 }; a bare tag like 'ball:bomb' collects into a
   * list, so a game can ask "which balls have I unlocked?" in one call.
   */
  function effects(gameId) {
    var out = { flags: {}, lists: {} };
    var p = Arcade.progressionOf(gameId);
    if (!p) return out;
    var g = game(gameId);
    p.unlocks.forEach(function (u) {
      // Switched-off unlocks contribute nothing, which is the whole point.
      if (!isActive(gameId, u.id) || !u.effect) return;
      var bits = String(u.effect).split(':');
      var key = bits[0];
      var val = bits.length > 1 ? bits[1] : '1';
      var num = Number(val);
      if (isFinite(num) && String(num) === val) {
        out.flags[key] = (out.flags[key] || 0) + num;
      } else {
        if (!out.lists[key]) out.lists[key] = [];
        out.lists[key].push(val);
      }
    });
    return out;
  }

  /** Numeric effect total, e.g. bonus('pegfall', 'gold') -> 4. */
  function bonus(gameId, key) { return effects(gameId).flags[key] || 0; }
  /** Named effect list, e.g. granted('pegfall', 'ball') -> ['bomb']. */
  function granted(gameId, key) { return effects(gameId).lists[key] || []; }

  /* -------------------------------------------------------- achievements */

  function hasAchievement(id) { return !!state().achievements[id]; }

  /**
   * Earn an achievement. Returns true only the first time, which is what the
   * caller uses to decide whether to celebrate.
   */
  function award(id) {
    var def = Arcade.achievementById(id);
    if (!def || hasAchievement(id)) return false;
    state().achievements[id] = Date.now();
    save();
    if (Arcade.ui && Arcade.ui.achievementToast) Arcade.ui.achievementToast(def);
    return true;
  }

  function achievementsFor(gameId) {
    return Arcade.achievements.filter(function (a) {
      return gameId === undefined ? true : a.game === gameId;
    });
  }

  function achievementProgress() {
    var total = Arcade.achievements.length;
    var got = 0;
    Arcade.achievements.forEach(function (a) { if (hasAchievement(a.id)) got++; });
    return { earned: got, total: total, pct: total ? Math.round((got / total) * 100) : 0 };
  }

  /* ----------------------------------------------------- difficulty clears */

  function recordClear(gameId, difficultyId) {
    if (difficultyId === undefined || difficultyId === null) return false;
    var g = game(gameId);
    var key = String(difficultyId);
    if (g.clears[key]) return false;
    g.clears[key] = Date.now();
    save();
    return true;
  }

  function hasClear(gameId, difficultyId) {
    return !!game(gameId).clears[String(difficultyId)];
  }

  function clearsFor(gameId) {
    var p = Arcade.progressionOf(gameId);
    if (!p) return [];
    return p.difficulties.map(function (d) {
      return { id: d.id, label: d.label, cleared: hasClear(gameId, d.id) };
    });
  }

  /* ----------------------------------------------------------- run intake */

  /**
   * The single hook a game calls when a run ends. Awards currency, records the
   * clear, updates totals and evaluates every achievement that has a test.
   *
   * @param summary { score, floor, ante, won, difficulty, ... } — whatever the
   *        game has; the catalogue's earn() and test()s read from it.
   */
  function recordRun(gameId, summary) {
    summary = summary || {};
    var s = state();
    var g = game(gameId);

    s.totals.runs++;
    g.runs++;
    if (summary.won) { s.totals.wins++; g.wins++; }
    if ((summary.score || 0) > (g.best || 0)) g.best = Math.floor(summary.score || 0);

    var p = Arcade.progressionOf(gameId);
    var earned = 0;
    if (p && typeof p.earn === 'function') {
      try { earned = Math.max(0, Math.floor(p.earn(summary) || 0)); } catch (e) { earned = 0; }
      if (earned) {
        var id = currencyId(gameId);
        g.currency[id] = (g.currency[id] || 0) + earned;
      }
    }

    if (summary.won) recordClear(gameId, summary.difficulty);

    save();     // totals must be stored before the tests read them

    var unlockedNow = [];
    Arcade.achievements.forEach(function (a) {
      if (typeof a.test !== 'function') return;
      if (a.game && a.game !== gameId) return;
      if (hasAchievement(a.id)) return;
      var pass = false;
      try { pass = !!a.test(summary, state()); } catch (e) { pass = false; }
      if (pass && award(a.id)) unlockedNow.push(a);
    });

    return {
      currency: earned,
      currencyLabel: p ? p.currency.label : 'points',
      achievements: unlockedNow
    };
  }

  /* ---------------------------------------------------------------- steam */

  /**
   * Everything a Steam build would push on launch: which achievements are
   * earned, and the stats its rules might key on. Nothing calls this yet — it
   * exists so the mapping is obvious when something does.
   */
  function snapshotForSteam() {
    var out = { achievements: [], stats: {} };
    Arcade.achievements.forEach(function (a) {
      if (hasAchievement(a.id)) out.achievements.push(a.steam || a.id);
    });
    var s = state();
    out.stats.TOTAL_RUNS = s.totals.runs;
    out.stats.TOTAL_WINS = s.totals.wins;
    Arcade.games.forEach(function (g) {
      var gs = s.games[g.id] || blankGame();
      var up = g.id.toUpperCase();
      out.stats[up + '_RUNS'] = gs.runs;
      out.stats[up + '_WINS'] = gs.wins;
      out.stats[up + '_BEST'] = gs.best;
      out.stats[up + '_CLEARS'] = Object.keys(gs.clears || {}).length;
    });
    return out;
  }

  function reset() {
    data = blank();
    save();
  }

  load();

  Arcade.progress = {
    state: state, save: save, reset: reset,
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    forGame: game,
    balance: balance, grant: grant, currencyId: currencyId,
    buy: buy, isUnlocked: isUnlocked, isActive: isActive,
    setActive: setActive, toggle: toggle, unlockDef: unlockDef,
    effects: effects, bonus: bonus, granted: granted,
    award: award, hasAchievement: hasAchievement,
    achievementsFor: achievementsFor, achievementProgress: achievementProgress,
    recordClear: recordClear, hasClear: hasClear, clearsFor: clearsFor,
    recordRun: recordRun,
    snapshotForSteam: snapshotForSteam
  };
})(typeof window !== 'undefined' ? window : this);
