/* ============================================================
   tools/harness.js — load PEGFALL's logic into Node

   The browser build is plain <script> tags hanging off `window.PK`, with all
   DOM work confined to render.js / ui.js / main.js. So the logic layer
   (settings, audio, rng, content, board, physics, save, game) loads into a vm
   context with stubbed localStorage and PK.UI, and can be driven headlessly.

   There is no requestAnimationFrame here on purpose: the loop in main.js is
   the only thing that owns one, and a test that waited on real frames would
   be timing-dependent. Tests step the game themselves with PK.Game.update().

   audio.js is loaded for real rather than stubbed. Node has no AudioContext,
   so init() sets `broken` and every voice early-returns — which means these
   tests also cover the path a browser with audio disabled takes.

   Usage:
     const { createGame } = require('./harness');
     const g = createGame({ quiet: true });
     g.PK.Game.newRun('SEED');
     g.helpers.drop(310);
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const SHARED_DIR = path.join(ROOT, 'shared', 'js');

/* Load order is index.html's, minus the three DOM files. render.js and ui.js
   draw; main.js binds input and owns the frame loop. None of them are logic. */
const LOGIC_FILES = [
  'settings.js', 'audio.js', 'rng.js', 'content.js',
  'board.js', 'physics.js', 'save.js', 'game.js'
];

/* The part of the shared layer PEGFALL's logic actually reaches for: the
   starting-gold bonus in newRun() and the unlocked-ball list in save.js. Its
   own synced copy is used, not the canonical /shared, because that copy is
   what ships — so a stale sync shows up here as well as in sync-shared.py. */
const SHARED_FILES = ['arcade-config.js', 'arcade-catalogue.js', 'arcade-progress.js'];

function makeStorageStub(seed) {
  const store = Object.create(null);
  if (seed) for (const k in seed) store[k] = String(seed[k]);
  return {
    _store: store,
    getItem: function (k) { return k in store ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { for (const k in store) delete store[k]; }
  };
}

/** Records every screen change and toast, so tests can assert on them. */
function makeUIStub(bus) {
  const noop = function () {};
  return {
    init: noop,
    refresh: function () { bus.refreshes++; },
    onFloorStart: function () { bus.screen = 'play'; bus.floorStarts++; },
    showShop: function () { bus.screen = 'shop'; },
    showGameOver: function () { bus.screen = 'gameover'; },
    showToast: function (text) { bus.toasts.push(text); }
  };
}

/**
 * @param options.quiet    silence console.log from game code
 * @param options.arcade   load the shared progression layer as well
 * @param options.storage  pre-seed localStorage (the progress layer reads it
 *                         at load time, so it cannot be set afterwards)
 */
function createGame(options) {
  options = options || {};

  const bus = {
    screen: null, toasts: [], refreshes: 0, floorStarts: 0,
    submitted: [], recorded: []
  };

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.console = options.quiet
    ? { log: function () {}, warn: function () {}, error: console.error }
    : console;
  sandbox.localStorage = makeStorageStub(options.storage);
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;

  /* Seeded before the game files run, so each one's `window.PK = window.PK || {}`
     keeps this object and picks the stub up. */
  sandbox.PK = { UI: makeUIStub(bus) };

  const ctx = vm.createContext(sandbox);

  function run(dir, file) {
    const code = fs.readFileSync(path.join(dir, file), 'utf8');
    vm.runInContext(code, ctx, { filename: file });
  }

  if (options.arcade) {
    SHARED_FILES.forEach(function (f) { run(SHARED_DIR, f); });
    /* The network boundary, and the only part of the arcade a run actually
       calls out to. Recorded rather than stubbed silently, so tests can check
       that a run posts exactly once and with the right number. */
    sandbox.Arcade.submitScore = function (gameId, payload) {
      bus.submitted.push({ gameId: gameId, payload: payload });
    };
    const realRecordRun = sandbox.Arcade.progress.recordRun;
    sandbox.Arcade.progress.recordRun = function (gameId, summary) {
      bus.recorded.push({ gameId: gameId, summary: summary });
      return realRecordRun(gameId, summary);
    };
  }

  LOGIC_FILES.forEach(function (f) { run(JS_DIR, f); });

  sandbox.bus = bus;

  const PK = sandbox.PK;
  const G = PK.Game.G;

  sandbox.helpers = {
    /** Step until every ball has landed. Returns the steps taken. */
    settle: function (maxSteps) {
      let n = 0;
      const cap = maxSteps || 6000;
      while (G.balls.length && n < cap) { PK.Game.update(1 / 120); n++; }
      return n;
    },
    /** Drop one ball and let it land. Returns the score it added. */
    drop: function (x) {
      const before = G.score;
      PK.Game.dropBall(x === undefined ? 310 : x);
      sandbox.helpers.settle();
      return G.score - before;
    },
    /** Drop the whole hand down the middle, which resolves the floor. */
    playFloor: function (x) {
      let guard = 0;
      while (PK.Game.canDrop() && guard++ < 40) sandbox.helpers.drop(x);
      return G.score;
    },
    /** The meta blob as it sits on disk. */
    meta: function () { return PK.Save.load(); },
    /** The raw run snapshot as it sits on disk. */
    savedRun: function () { return PK.Save.loadRun(); },
    /** Put an offer of a known kind into the shop, so buy() can be aimed. */
    stockShop: function (offers) { G.shop.offers = offers; },
    /** Index of the first shop offer matching a predicate, or -1. */
    offerIndex: function (pred) {
      for (let i = 0; i < G.shop.offers.length; i++) if (pred(G.shop.offers[i])) return i;
      return -1;
    }
  };

  return sandbox;
}

module.exports = { createGame: createGame, LOGIC_FILES: LOGIC_FILES, SHARED_FILES: SHARED_FILES };
