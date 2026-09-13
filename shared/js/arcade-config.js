/* ============================================================================
   arcade-config.js — the only file you edit to point the arcade at Firebase,
   and the registry that makes a new game a data change rather than a code one.

   Everything downstream reads from here. If `firebase.apiKey` is still the
   placeholder, the whole platform layer runs in OFFLINE mode: the games play
   exactly as before, the arcade bar says so, and nothing throws.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  /* --------------------------------------------------------------------
     1. Firebase project

     Firebase console -> Project settings -> Your apps -> Web app -> Config.
     These values are public by design; what protects the data is the
     security rules in firebase/firestore.rules, not secrecy of this object.
     -------------------------------------------------------------------- */
  Arcade.firebaseConfig = {
    apiKey: 'AIzaSyD2DAMUuCZtXLF9X3Tg-UKHln1E6WtaJDg',
    authDomain: 'marsindustries-dev.firebaseapp.com',
    projectId: 'marsindustries-dev',
    storageBucket: 'marsindustries-dev.firebasestorage.app',
    messagingSenderId: '349479626850',
    appId: '1:349479626850:web:53c7a918d1c80ec764c93b'
  };

  /* Point the arcade at local Firebase emulators instead of the live project.
     Only honoured when the page itself is served from localhost, so shipping
     this set by accident cannot redirect real players anywhere.

       Arcade.emulator = { auth: 9099, firestore: 8080 };

     Leave null for normal use. */
  Arcade.emulator = null;

  /* Version of the Firebase compat SDK pulled from Google's CDN. Compat is
     used deliberately: it is a classic script, so all three games can load it
     the same way regardless of whether they use ES modules internally. */
  Arcade.sdkVersion = '10.14.1';

  /* --------------------------------------------------------------------
     2. The game registry

     Adding a fourth game means adding one entry here and calling
     Arcade.init({ gameId: 'yourid' }) from it. No backend change, no rule
     change beyond the optional scoreMax sanity bound.

       id         Firestore document id. Never rename one once it is live.
       name       display name
       tagline    one line, used on the hub and in the game switcher
       glyph      a single character used as the game's mark
       path       location relative to the arcade root (one-origin deploys)
       url        absolute origin for this game, used once deployed; the
                  relative `path` is used when browsing locally
       scoreLabel what the leaderboard number means in this game
       scoreMax   sanity ceiling; mirrored in firestore.rules
       metaFields extra per-entry fields the leaderboard row may show
     -------------------------------------------------------------------- */
  Arcade.games = [
    {
      id: 'pegfall',
      name: 'PEGFALL',
      tagline: 'a plinko roguelite',
      glyph: '●',
      path: 'Plinko/index.html',
      url: 'https://pegfall.marsindustries.dev/',
      theme: 'pegfall',
      scoreLabel: 'Run score',
      scoreMax: 1e12,
      metaFields: ['floor']
    },
    {
      id: 'onemoreroll',
      name: 'One More Roll',
      tagline: 'a dice roguelite',
      glyph: '▣',
      path: 'Yahtzee Roguelike/index.html',
      url: 'https://onemoreroll.marsindustries.dev/',
      theme: 'onemoreroll',
      scoreLabel: 'Best turn',
      scoreMax: 1e15,
      metaFields: ['ante']
    },
    {
      id: 'nolimit',
      name: 'No Limit',
      tagline: 'a roulette roguelike',
      glyph: '◎',
      path: 'Roulette Roguelike/index.html',
      url: 'https://nolimit.marsindustries.dev/',
      theme: 'nolimit',
      scoreLabel: 'Best spin',
      scoreMax: 1e15,
      metaFields: ['ante']
    }
  ];

  /* Absolute home of the arcade hub, for subdomain deploys. */
  Arcade.hubUrl = 'https://arcade.marsindustries.dev/';

  /**
   * True when this page is being browsed locally rather than served from the
   * real domains — a dev server, or a double-clicked file://.
   */
  Arcade.isLocal = function () {
    var loc = global.location;
    if (!loc || loc.protocol === 'file:') return true;
    var h = loc.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '';
  };

  /**
   * Where the switcher and the hub link for a game.
   *
   * Deployed, the absolute `url` wins — that is what makes the subdomain split
   * work, where '../Plinko/index.html' would point at nothing. Browsed locally
   * the relative path wins instead, so filling in the live URLs does not send
   * you off to production every time you click the switcher on a dev server.
   */
  Arcade.gameUrl = function (game) {
    if (game && game.url && !Arcade.isLocal()) return game.url;
    return Arcade.options.rootPath + (game ? game.path : '');
  };

  Arcade.hubHref = function () {
    if (Arcade.hubUrl && !Arcade.isLocal()) return Arcade.hubUrl;
    return Arcade.options.rootPath + Arcade.options.hubPath;
  };

  Arcade.gameById = function (id) {
    for (var i = 0; i < Arcade.games.length; i++) {
      if (Arcade.games[i].id === id) return Arcade.games[i];
    }
    return { id: id, name: id, glyph: '◆', scoreLabel: 'Score', metaFields: [] };
  };

  /* --------------------------------------------------------------------
     3. Platform options
     -------------------------------------------------------------------- */
  Arcade.options = {
    topN: 5,               // how many rows the leaderboard shows
    rankScanLimit: 200,    // fallback rank scan depth when count() is absent
    minNameLength: 3,
    maxNameLength: 20,
    /* How far above the arcade root each game sits, so the game switcher can
       build links. Overridden per game in Arcade.init if a game is deployed
       standalone. */
    rootPath: '../',
    /* Where the hub sits relative to the arcade root when browsing locally.
       Deployed it is its own site, so Arcade.hubUrl wins and this is unused. */
    hubPath: 'hub/index.html'
  };

  Arcade.isConfigured = function () {
    var c = Arcade.firebaseConfig;
    return !!(c && c.apiKey && c.apiKey !== 'REPLACE_ME' && c.projectId &&
      c.projectId !== 'your-project');
  };
  /* The placeholders above are the offline sentinel: while they are in place
     the whole platform layer stays dormant and the games run purely locally.
     They are gone now — this arcade points at a real project. */
})(typeof window !== 'undefined' ? window : this);
