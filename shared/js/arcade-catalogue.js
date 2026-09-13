/* ============================================================================
   arcade-catalogue.js — what there is to earn, unlock and achieve.

   Pure data. arcade-progress.js is the machinery that reads it, so adding a
   currency, an unlock, a difficulty or an achievement is an edit here and
   nothing else.

   Every achievement carries a `steam` id. Nothing reads it yet — it is the
   seam that lets a Steam build map these onto real achievements later without
   renaming anything players have already earned.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  /* --------------------------------------------------------------------
     Per-game progression.

       currency   { id, label, icon } — one per game, earned by playing
       earn(s)    -> how much a finished run is worth, from its summary
       unlocks[]  { id, label, desc, cost, effect } — bought with currency
       difficulties[] { id, label } — the ladder a clear is recorded against

     `effect` is a free-form tag the game itself reads. The catalogue says
     what exists; the game decides what it means.
     -------------------------------------------------------------------- */
  Arcade.progression = {

    pegfall: {
      currency: { id: 'shards', label: 'Shards', icon: '◈' },
      // Depth is worth more than raw score, so a deep careful run pays better
      // than one lucky floor.
      earn: function (s) {
        return Math.max(1, Math.floor((s.score || 0) / 500) + (s.floor || 0) * 2);
      },
      unlocks: [
        { id: 'ball_bomb', label: 'Bomb ball', cost: 20, effect: 'ball:bomb',
          desc: 'Adds the Bomb ball to the shop pool, without waiting for floor 3.' },
        { id: 'ball_ghost', label: 'Ghost ball', cost: 35, effect: 'ball:ghost',
          desc: 'Adds the Ghost ball to the shop pool, without waiting for floor 5.' },
        { id: 'ball_magnet', label: 'Magnet ball', cost: 55, effect: 'ball:magnet',
          desc: 'Adds the Magnet ball to the shop pool, without waiting for floor 7.' },
        { id: 'ball_void', label: 'Void ball', cost: 80, effect: 'ball:voidball',
          desc: 'Adds the Void ball to the shop pool, without waiting for floor 9.' },
        { id: 'deep_pockets', label: 'Deep Pockets', cost: 45, effect: 'gold:4',
          desc: 'Start every run with 4 extra gold.' }
      ],
      /* PEGFALL has no difficulty ladder and no win condition — it is endless
         and ends when you fall short. One tier keeps the shape of the system
         without inventing a completion bar the game does not have. */
      difficulties: [{ id: 'standard', label: 'Standard' }]
    },

    onemoreroll: {
      currency: { id: 'pips', label: 'Pips', icon: '⁙' },
      earn: function (s) {
        return Math.max(1, (s.ante || 0) * 3 + Math.floor((s.score || 0) / 2000) + (s.won ? 25 : 0));
      },
      unlocks: [
        { id: 'lucky_start', label: 'Lucky Start', cost: 25, effect: 'money:4',
          desc: 'Start every run with $4 extra.' },
        { id: 'sixth_die', label: 'Sixth Die', cost: 70, effect: 'dice:1',
          desc: 'Start every run with one extra die.' },
        { id: 'deep_pockets', label: 'Deep Pockets', cost: 45, effect: 'consumable:1',
          desc: 'One more consumable slot, every run.' }
      ],
      difficulties: [
        { id: '1', label: 'White Peril' }, { id: '2', label: 'Red Peril' },
        { id: '3', label: 'Green Peril' }, { id: '4', label: 'Black Peril' },
        { id: '5', label: 'Blue Peril' }, { id: '6', label: 'Purple Peril' },
        { id: '7', label: 'Orange Peril' }, { id: '8', label: 'Gold Peril' }
      ]
    },

    nolimit: {
      currency: { id: 'markers', label: 'Markers', icon: '◉' },
      earn: function (s) {
        return Math.max(1, (s.ante || 0) * 3 + (s.tables || 0) * 2 + (s.won ? 25 : 0));
      },
      unlocks: [
        { id: 'deep_purse', label: 'Deep Purse', cost: 25, effect: 'money:4',
          desc: 'Start every run with $4 extra.' },
        { id: 'spare_nudge', label: 'Spare Nudge', cost: 60, effect: 'nudge:1',
          desc: 'One more Nudge every round.' },
        { id: 'house_edge', label: 'House Edge', cost: 45, effect: 'chips:1',
          desc: 'One more chip to place every round.' }
      ],
      difficulties: [
        { id: 'white', label: 'White Stake' }, { id: 'red', label: 'Red Stake' },
        { id: 'green', label: 'Green Stake' }, { id: 'black', label: 'Black Stake' },
        { id: 'blue', label: 'Blue Stake' }, { id: 'purple', label: 'Purple Stake' },
        { id: 'orange', label: 'Orange Stake' }, { id: 'gold', label: 'Gold Stake' }
      ]
    }
  };

  /* --------------------------------------------------------------------
     Achievements.

       id     stable for ever — it is the save key
       game   null for arcade-wide ones
       label  what the player sees
       desc   how to get it
       secret true hides the description until earned
       steam  the id a Steam build would map this onto
       test(s, store) evaluated when a run ends; omit for ones the game
              awards directly with Arcade.progress.award()
     -------------------------------------------------------------------- */
  Arcade.achievements = [
    /* ---- arcade-wide ---- */
    { id: 'first_run', game: null, label: 'Taking a Seat', steam: 'ACH_FIRST_RUN',
      desc: 'Finish a run in any game.',
      test: function (s, st) { return st.totals.runs >= 1; } },
    { id: 'house_regular', game: null, label: 'House Regular', steam: 'ACH_HOUSE_REGULAR',
      desc: 'Finish 25 runs across the arcade.',
      test: function (s, st) { return st.totals.runs >= 25; } },
    { id: 'full_floor', game: null, label: 'Working the Floor', steam: 'ACH_FULL_FLOOR',
      desc: 'Finish a run in all three games.',
      test: function (s, st) {
        return Arcade.games.every(function (g) { return (st.games[g.id] || {}).runs > 0; });
      } },

    /* ---- PEGFALL ---- */
    { id: 'pegfall_floor5', game: 'pegfall', label: 'Down the Board', steam: 'ACH_PEGFALL_FLOOR_5',
      desc: 'Reach floor 5.', test: function (s) { return (s.floor || 0) >= 5; } },
    { id: 'pegfall_floor10', game: 'pegfall', label: 'Basement Dweller', steam: 'ACH_PEGFALL_FLOOR_10',
      desc: 'Reach floor 10.', test: function (s) { return (s.floor || 0) >= 10; } },
    { id: 'pegfall_bigball', game: 'pegfall', label: 'One Good Drop', steam: 'ACH_PEGFALL_BIG_BALL',
      desc: 'Score 1,000 with a single ball.', test: function (s) { return (s.bestBall || 0) >= 1000; } },
    { id: 'pegfall_collector', game: 'pegfall', label: 'Magpie', steam: 'ACH_PEGFALL_COLLECTOR',
      desc: 'Hold 6 relics at once.', test: function (s) { return (s.relics || 0) >= 6; } },

    /* ---- One More Roll ---- */
    { id: 'omr_win', game: 'onemoreroll', label: 'One More Win', steam: 'ACH_OMR_WIN',
      desc: 'Beat The Grand.', test: function (s) { return !!s.won; } },
    { id: 'omr_bigturn', game: 'onemoreroll', label: 'Hot Dice', steam: 'ACH_OMR_BIG_TURN',
      desc: 'Score 10,000 in a single turn.', test: function (s) { return (s.score || 0) >= 10000; } },
    { id: 'omr_ante5', game: 'onemoreroll', label: 'Deep in the Night', steam: 'ACH_OMR_ANTE_5',
      desc: 'Reach ante 5.', test: function (s) { return (s.ante || 0) >= 5; } },
    // Awarded in the moment rather than at run end: it is about a thing you
    // did, not a number you finished on.
    { id: 'omr_encore', game: 'onemoreroll', label: 'Encore!', steam: 'ACH_OMR_ENCORE',
      desc: 'Score the same category twice in one blind.' },

    /* ---- No Limit ---- */
    { id: 'nolimit_win', game: 'nolimit', label: 'The House Folds', steam: 'ACH_NOLIMIT_WIN',
      desc: 'Take eight antes off the house.', test: function (s) { return !!s.won; } },
    { id: 'nolimit_bigspin', game: 'nolimit', label: 'Let It Ride', steam: 'ACH_NOLIMIT_BIG_SPIN',
      desc: 'Score 100,000 on a single spin.', test: function (s) { return (s.score || 0) >= 100000; } },
    { id: 'nolimit_ante5', game: 'nolimit', label: 'Still Standing', steam: 'ACH_NOLIMIT_ANTE_5',
      desc: 'Reach ante 5.', test: function (s) { return (s.ante || 0) >= 5; } },
    { id: 'nolimit_carve', game: 'nolimit', label: 'Rewriting the Odds', steam: 'ACH_NOLIMIT_CARVE',
      desc: 'Remove 10 pockets from the wheel in one run.',
      test: function (s) { return (s.pocketsRemoved || 0) >= 10; } }
  ];

  Arcade.achievementById = function (id) {
    for (var i = 0; i < Arcade.achievements.length; i++) {
      if (Arcade.achievements[i].id === id) return Arcade.achievements[i];
    }
    return null;
  };

  Arcade.progressionOf = function (gameId) {
    return Arcade.progression[gameId] || null;
  };
})(typeof window !== 'undefined' ? window : this);
