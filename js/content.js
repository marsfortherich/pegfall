/* All game content: ball types, peg types, relics, floor modifiers.
   Relics talk to the engine through optional hook functions. */
(function (PK) {
  'use strict';

  /* ------------------------------------------------------------------ balls */
  // value      : starting value of the ball
  // restitution: bounciness (1 = perfectly elastic)
  // mass       : how much a peg deflects it
  var BALLS = {
    standard: {
      id: 'standard', name: 'Standard', color: '#e8eef7', cost: 4, rarity: 'common',
      value: 10, restitution: 0.58, mass: 1, radius: 8,
      desc: 'A plain steel ball. Value 10.'
    },
    heavy: {
      id: 'heavy', name: 'Heavy', color: '#9fb3c8', cost: 6, rarity: 'common',
      value: 18, restitution: 0.36, mass: 1.9, radius: 9.5,
      desc: 'Value 18. Barely bounces, so it plows toward the centre.'
    },
    bouncy: {
      id: 'bouncy', name: 'Bouncy', color: '#7ee787', cost: 6, rarity: 'common',
      value: 8, restitution: 0.86, mass: 0.7, radius: 7.5,
      desc: 'Value 8, wildly elastic. Pegs are worth +1 extra.',
      onPegHit: function (G, ball) { ball.value += 1; }
    },
    splitter: {
      id: 'splitter', name: 'Splitter', color: '#79c0ff', cost: 8, rarity: 'uncommon',
      value: 12, restitution: 0.6, mass: 0.9, radius: 8,
      desc: 'Value 12. After 3 pegs it splits into two balls at 60% value.',
      onPegHit: function (G, ball, peg, api) {
        if (ball.pegHits === 3 && !ball.hasSplit) {
          ball.hasSplit = true;
          ball.value = Math.round(ball.value * 0.6);
          var clone = api.cloneBall(ball);
          clone.hasSplit = true;
          clone.vx = -clone.vx - 40;
          ball.vx += 40;
          api.spawn(clone);
          api.popup(ball.x, ball.y, 'SPLIT', '#79c0ff');
        }
      }
    },
    bomb: {
      id: 'bomb', name: 'Bomb', color: '#ff7b72', cost: 8, rarity: 'uncommon',
      value: 10, restitution: 0.5, mass: 1.2, radius: 9,
      desc: 'Value 10. 22% chance to shatter each peg it hits for +30 value.',
      onPegHit: function (G, ball, peg, api) {
        if (!peg.dead && api.rng.chance(0.22)) {
          api.shatter(peg);
          ball.value += 30;
          api.popup(peg.x, peg.y, '+30', '#ff7b72');
        }
      }
    },
    ghost: {
      /* Phasing six pegs does not cost six pegs — it costs about 126. The
         skipped ones are at the top, where the ball is slow and bouncing
         most, so a Ghost arrives at the slots fast and falls almost straight
         through: 22 peg hits against a Standard's 142. At value 26 that made
         it score 638 where the free Standard scores 818, so floor 5 unlocked
         a downgrade. The identity is the point of the ball, so it keeps
         phasing six and is paid properly for it. */
      id: 'ghost', name: 'Ghost', color: '#d2a8ff', cost: 8, rarity: 'uncommon',
      value: 90, restitution: 0.6, mass: 1, radius: 8, ghostPegs: 6,
      desc: 'Value 90, but it phases through the first 6 pegs it meets.'
    },
    magnet: {
      id: 'magnet', name: 'Magnet', color: '#ffa657', cost: 9, rarity: 'rare',
      value: 12, restitution: 0.55, mass: 1.1, radius: 8.5, magnet: 190,
      desc: 'Value 12. Drifts toward whichever slot pays the most.'
    },
    lucky: {
      id: 'lucky', name: 'Lucky', color: '#f2cc60', cost: 7, rarity: 'uncommon',
      value: 6, restitution: 0.62, mass: 0.95, radius: 8,
      desc: 'Value 6. Every peg has a 25% chance to pay +12 value.',
      onPegHit: function (G, ball, peg, api) {
        if (api.rng.chance(0.25)) {
          ball.value += 12;
          api.popup(peg.x, peg.y, '+12', '#f2cc60');
        }
      }
    },
    voidball: {
      id: 'voidball', name: 'Void', color: '#a371f7', cost: 10, rarity: 'rare',
      value: 0, restitution: 0.6, mass: 1, radius: 8,
      desc: 'Value 0, but every peg it touches is worth +6 instead of +1.',
      onPegHit: function (G, ball) { ball.value += 5; }
    }
  };

  /* ------------------------------------------------------------------- pegs */
  var PEGS = {
    normal:  { id: 'normal',  name: 'Peg',     color: '#6e7c91', glow: '#8aa0bb', value: 1,  radius: 6 },
    gold:    { id: 'gold',    name: 'Gold',    color: '#f2cc60', glow: '#ffe08a', value: 12, radius: 6.5 },
    charged: { id: 'charged', name: 'Charged', color: '#79c0ff', glow: '#a6dbff', value: 2,  radius: 6.5, slotBonus: 0.35 },
    bumper:  { id: 'bumper',  name: 'Bumper',  color: '#ff7b72', glow: '#ffb3ae', value: 15, radius: 11, bounce: 1.4 },
    brittle: { id: 'brittle', name: 'Brittle', color: '#7ee787', glow: '#b6f5bb', value: 3,  radius: 6, hp: 2, breakValue: 14 }
  };

  /* ----------------------------------------------------------------- relics */
  // Optional hooks:
  //   handSize(G, n) -> n              balls drawn per floor
  //   slotMults(G, mults) -> mults     rewrite printed slot multipliers
  //   onFloorStart(G, board, api)
  //   onBallSpawn(G, ball, api)
  //   onPegHit(G, ball, peg, api)
  //   onSlot(G, ball, slot, ctx)       ctx = { mult }
  //   onBallScored(G, ball, ctx)       ctx = { score }
  //   onFloorEnd(G, ctx)               ctx = { gold }
  var RELICS = [
    {
      id: 'extra_hand', name: 'Extra Hand', icon: '+1', rarity: 'common', cost: 7,
      desc: '+1 ball drawn each floor.',
      handSize: function (G, n) { return n + 1; }
    },
    {
      id: 'peg_collector', name: 'Peg Collector', icon: 'PC', rarity: 'common', cost: 5,
      desc: 'Every peg is worth +2 extra value.',
      onPegHit: function (G, ball) { ball.value += 2; }
    },
    {
      /* Measured at +399%, or 50 score per gold of cost, against a set median
         of 6 — eight times the next best relic. The effect compounds, so no
         cap brings it near the curve (even +2 still sits at 14), and cutting
         it that far would just make it a worse Peg Collector. Left intact and
         made rare instead: it appears half as often and costs half again as
         much, so it is the run you got lucky in rather than the one you
         expected. */
      id: 'momentum', name: 'Momentum', icon: 'MO', rarity: 'rare', cost: 12,
      desc: 'Each peg in a fall is worth +1 more than the last one (caps at +10).',
      onPegHit: function (G, ball) { ball.value += Math.min(ball.pegHits, 10); }
    },
    {
      id: 'gold_rush', name: 'Gold Rush', icon: 'AU', rarity: 'uncommon', cost: 8,
      desc: '12% of pegs turn golden each floor (+12 value each).',
      onFloorStart: function (G, board, api) { api.convertPegs(board, 'gold', 0.12); }
    },
    {
      id: 'live_wire', name: 'Live Wire', icon: 'LW', rarity: 'uncommon', cost: 8,
      desc: '12% of pegs become charged: each adds +0.35 to that ball’s slot multiplier.',
      onFloorStart: function (G, board, api) { api.convertPegs(board, 'charged', 0.12); }
    },
    {
      id: 'pinball_wizard', name: 'Pinball Wizard', icon: 'PW', rarity: 'uncommon', cost: 9,
      desc: 'Adds 5 bumpers: +15 value and a violent kick.',
      onFloorStart: function (G, board, api) { api.convertPegsCount(board, 'bumper', 5); }
    },
    {
      id: 'fragile_world', name: 'Fragile World', icon: 'FW', rarity: 'uncommon', cost: 7,
      desc: '18% of pegs become brittle: they shatter after 2 hits for +14.',
      onFloorStart: function (G, board, api) { api.convertPegs(board, 'brittle', 0.18); }
    },
    {
      id: 'edge_lord', name: 'Edge Lord', icon: 'EL', rarity: 'uncommon', cost: 8,
      desc: 'The two outermost slots on each side pay 1.6x more.',
      slotMults: function (G, m) {
        var out = m.slice();
        [0, 1, m.length - 2, m.length - 1].forEach(function (i) {
          out[i] = Math.round(out[i] * 1.6 * 10) / 10;
        });
        return out;
      }
    },
    {
      id: 'static_charge', name: 'Static Charge', icon: 'SC', rarity: 'common', cost: 6,
      desc: 'Every slot multiplier is +0.3.',
      slotMults: function (G, m) { return m.map(function (v) { return Math.round((v + 0.3) * 10) / 10; }); }
    },
    {
      id: 'dead_centre', name: 'Dead Centre', icon: 'DC', rarity: 'uncommon', cost: 7,
      desc: 'The centre slot pays 5x more. It is usually the worst one.',
      slotMults: function (G, m) {
        var out = m.slice(), c = Math.floor((m.length - 1) / 2);
        out[c] = Math.round(out[c] * 5 * 10) / 10;
        return out;
      }
    },
    {
      id: 'multiball', name: 'Multiball', icon: 'MB', rarity: 'rare', cost: 10,
      desc: '20% of drops spawn a free duplicate ball.',
      onBallSpawn: function (G, ball, api) {
        if (ball.isCopy) return;
        if (api.rng.chance(0.20)) {
          var c = api.cloneBall(ball);
          c.isCopy = true;
          c.x += api.rng.float(-14, 14);
          c.vx = -ball.vx;
          api.spawn(c);
          api.popup(ball.x, ball.y + 24, 'MULTIBALL', '#79c0ff');
        }
      }
    },
    {
      id: 'high_roller', name: 'High Roller', icon: 'HR', rarity: 'rare', cost: 10,
      desc: 'Every ball scores 1.35x.',
      onBallScored: function (G, ball, ctx) { ctx.score = Math.round(ctx.score * 1.35); }
    },
    {
      id: 'jackpot', name: 'Jackpot', icon: 'JP', rarity: 'rare', cost: 9,
      desc: 'Landing in either outermost slot doubles that ball again.',
      onSlot: function (G, ball, slot, ctx) {
        if (slot.index === 0 || slot.index === G.board.slots.length - 1) ctx.mult *= 2;
      }
    },
    {
      id: 'second_chance', name: 'Second Chance', icon: 'SS', rarity: 'rare', cost: 10,
      desc: 'Once per run, failing a floor does not end the run. Consumed on use.',
      revive: true
    },
    {
      id: 'deep_pockets', name: 'Deep Pockets', icon: 'DP', rarity: 'common', cost: 5,
      desc: '+3 gold every floor you clear.',
      onFloorEnd: function (G, ctx) { ctx.gold += 3; }
    },
    {
      id: 'refund', name: 'Refund Policy', icon: 'RP', rarity: 'common', cost: 5,
      desc: '+2 gold for each ball you did not need to drop.',
      onFloorEnd: function (G, ctx) { ctx.gold += G.hand.length * 2; }
    },
    {
      id: 'heavy_gravity', name: 'Heavy Gravity', icon: 'HG', rarity: 'uncommon', cost: 7,
      desc: 'Gravity +20%. Every ball starts with +6 value.',
      gravityMul: 1.2,
      onBallSpawn: function (G, ball) { ball.value += 6; }
    },
    {
      id: 'sharpshooter', name: 'Sharpshooter', icon: 'SH', rarity: 'uncommon', cost: 8,
      desc: 'The first ball of every floor scores 2.5x.',
      onBallScored: function (G, ball, ctx) {
        if (ball.dropIndex === 0) ctx.score = Math.round(ctx.score * 2.5);
      }
    },
    {
      id: 'compound', name: 'Compound Interest', icon: 'CI', rarity: 'uncommon', cost: 8,
      desc: 'Clearing a floor pays +1 gold per 5 gold you hold (max +6).',
      onFloorEnd: function (G, ctx) { ctx.gold += Math.min(6, Math.floor(G.gold / 5)); }
    },
    {
      id: 'overflow', name: 'Overflow', icon: 'OF', rarity: 'rare', cost: 9,
      desc: 'Score above the target carries over into the next floor.',
      carry: true
    },
    {
      id: 'chaos_theory', name: 'Chaos Theory', icon: 'CT', rarity: 'rare', cost: 8,
      desc: 'Slot multipliers are shuffled every floor. +2 balls drawn.',
      handSize: function (G, n) { return n + 2; },
      shuffleSlots: true
    },
    /* ---- upgrades -------------------------------------------------------
       Each needs the relic it improves; the shop will not offer it otherwise.
       They stack with their base rather than replacing it — convertPegs only
       ever converts pegs that are still 'normal', so holding both Gold Rush
       and Mother Lode gilds 12% and then 30% of what is left. */
    {
      id: 'mother_lode', name: 'Mother Lode', icon: 'ML', rarity: 'rare', cost: 12,
      requires: 'gold_rush',
      desc: 'Needs Gold Rush. A further 30% of pegs turn golden each floor.',
      onFloorStart: function (G, board, api) { api.convertPegs(board, 'gold', 0.30); }
    },
    {
      id: 'overload', name: 'Overload', icon: 'OL', rarity: 'rare', cost: 9,
      requires: 'live_wire',
      desc: 'Needs Live Wire. A further 30% of pegs become charged.',
      onFloorStart: function (G, board, api) { api.convertPegs(board, 'charged', 0.30); }
    },

    /* ---- high risk, high reward ---------------------------------------- */
    {
      id: 'the_deep', name: 'The Deep', icon: 'TD', rarity: 'rare', cost: 10,
      desc: 'A deeper board: one extra row, and every peg is worth +1 more. But one slot is a void every floor.',
      extraRows: 1,
      onPegHit: function (G, ball) { ball.value += 1; },
      onFloorStart: function (G, board, api) {
        /* Never the outermost pair, matching the Void Slot modifier: those are
           the 10x slots, and a narrowed board hides them anyway, which would
           spend the drawback on a slot nobody could reach. */
        var pick = [];
        for (var i = 1; i < board.slots.length - 1; i++) {
          if (!board.slots[i].voided) pick.push(board.slots[i]);
        }
        if (!pick.length) return;
        var s = G.rng.pick(pick);
        s.mult = 0;
        s.voided = true;
      }
    },
    {
      id: 'iron_lung', name: 'Iron Lung', icon: 'IL', rarity: 'uncommon', cost: 7,
      desc: 'Each ball passes 35% of its final value on to the next ball.',
      onBallScored: function (G, ball) { G.carryValue = Math.round(ball.value * 0.35); },
      onBallSpawn: function (G, ball) { if (G.carryValue) ball.value += G.carryValue; }
    }
  ];

  var RELIC_BY_ID = {};
  RELICS.forEach(function (r) { RELIC_BY_ID[r.id] = r; });

  /* -------------------------------------------------------------- modifiers */
  var MODIFIERS = [
    {
      id: 'void_slot', name: 'Void Slot', desc: 'One slot is a black hole. It scores nothing.',
      apply: function (G, board, rng) {
        var i = rng.int(1, board.slots.length - 2);
        board.slots[i].mult = 0;
        board.slots[i].voided = true;
      }
    },
    {
      id: 'slick', name: 'Slick Pegs', desc: 'Pegs are 30% bouncier. Good luck aiming.',
      apply: function (G, board) { board.restitutionBonus = 0.3; }
    },
    {
      id: 'tax', name: 'Peg Tax', desc: 'The target score is 25% higher.',
      targetMul: 1.25
    },
    {
      id: 'fog', name: 'Fog', desc: 'Slot multipliers are hidden until a ball lands in them.',
      apply: function (G, board) { board.fog = true; }
    },
    {
      id: 'narrow', name: 'Iron Maiden', desc: 'The walls close in. The outer slot on each side is gone.',
      apply: function (G, board) { board.narrow = 1; }
    },
    {
      id: 'rust', name: 'Rust', desc: 'Pegs are worth no base value. Relics still pay.',
      apply: function (G, board) { board.pegValueMul = 0; }
    },
    {
      id: 'short_hand', name: 'Short Hand', desc: 'You draw 2 fewer balls.',
      handSize: function (G, n) { return Math.max(2, n - 2); }
    },
    {
      id: 'dense', name: 'Dense Forest', desc: 'Two extra rows of pegs stand between you and the slots.',
      extraRows: 2
    }
  ];

  var BOSS_MODIFIERS = [
    {
      id: 'boss_inversion', name: 'THE INVERSION', boss: true,
      desc: 'Slot payouts are inverted: the centre pays, the edges do not.',
      apply: function (G, board) {
        var vals = board.slots.map(function (s) { return s.mult; });
        var sorted = vals.slice().sort(function (a, b) { return a - b; });
        var c = (board.slots.length - 1) / 2;
        board.slots.forEach(function (s, i) {
          var rank = Math.min(sorted.length - 1, Math.round(Math.abs(i - c) * 2));
          s.mult = sorted[sorted.length - 1 - rank];
        });
      }
    },
    {
      id: 'boss_gauntlet', name: 'THE GAUNTLET', boss: true,
      desc: 'Only 3 balls, but every peg is worth triple.',
      handSize: function () { return 3; },
      apply: function (G, board) { board.pegValueMul = 3; }
    },
    {
      id: 'boss_cage', name: 'THE CAGE', boss: true,
      desc: 'Bumpers everywhere, and every third slot is a void.',
      apply: function (G, board, rng) {
        board.slots.forEach(function (s, i) { if (i % 3 === 1) { s.mult = 0; s.voided = true; } });
        for (var i = 0; i < 10; i++) {
          var live = board.pegs.filter(function (p) { return !p.dead && p.type !== 'bumper'; });
          if (!live.length) break;
          rng.pick(live).type = 'bumper';
        }
      }
    },
    {
      id: 'boss_famine', name: 'THE FAMINE', boss: true, targetMul: 1.2,
      desc: 'Every ball starts at half value, and the target is 20% higher.',
      onBallSpawn: function (G, ball) { ball.value = Math.round(ball.value * 0.5); }
    }
  ];

  /* ------------------------------------------------------------- descents

     PEGFALL's difficulty ladder. Cumulative, exactly as One More Roll's
     Perils and No Limit's Stakes are: playing at level N applies every
     modifier from 1 to N, and the arcade's colour order is shared across all
     three games so a player reads the same ladder everywhere.

     Every lever here already existed — target, price, hand size, starting
     gold, the reroll price, and the floor modifiers begin on. Nothing new was
     invented to make the ladder hurt.
     -------------------------------------------------------------------- */
  var STAKES = [
    { level: 1, id: 'white',  name: 'White Descent',  color: '#e8e3d5',
      desc: 'The board as it was built.', mods: {} },
    { level: 2, id: 'red',    name: 'Red Descent',    color: '#d0434f',
      desc: 'Floor targets are 6% higher.', mods: { targetMul: 1.06 } },
    { level: 3, id: 'green',  name: 'Green Descent',  color: '#57d17a',
      desc: 'Everything in the shop costs 12% more.', mods: { priceMul: 1.12 } },
    { level: 4, id: 'black',  name: 'Black Descent',  color: '#6b7380',
      desc: 'Floor targets are a further 6% higher.', mods: { targetMul: 1.06 } },
    { level: 5, id: 'blue',   name: 'Blue Descent',   color: '#0090ff',
      desc: 'Every cleared floor pays 1 less gold.', mods: { goldFlat: -1 } },
    { level: 6, id: 'purple', name: 'Purple Descent', color: '#9b6bd8',
      desc: 'Floor targets are a further 7% higher.', mods: { targetMul: 1.07 } },
    { level: 7, id: 'orange', name: 'Orange Descent', color: '#f0a92c',
      desc: 'You start on 2 gold instead of 6, and rerolls cost double.',
      mods: { startGold: 2, rerollMul: 2 } },
    { level: 8, id: 'gold',   name: 'Gold Descent',   color: '#ffd479',
      /* Floor 2, not floor 1. Modifiers on the opening floor stack with this
         rung's own lost ball — Short Hand takes two more — which left a run
         facing a 240 target with three balls and a median death on floor 2.
         A rung you cannot get past is a wall, not a difficulty. */
      desc: 'You draw one ball fewer every floor, the board fights back from ' +
            'floor 2, and the reroll price climbs twice as fast.',
      mods: { hand: -1, modifierFloor: 2, rerollStep: 2 } }
  ];

  /* Ordering is deliberate. PEGFALL's economy is fragile — a floor pays 8-12
     gold and a relic costs 5-12, so roughly one purchase a floor — which makes
     price and payout rungs compound viciously: an early +25% prices dropped the
     measured win rate tenfold in one step, while a +7% target barely moved it.
     So targets carry most of the climb, the economy rungs sit in the middle,
     and the two harshest levers (a ball fewer, and modifiers from floor 1) are
     held back to the last rung where a cliff is the point. */

  /** Merge descents 1..level into one modifier block. */
  function stakeMods(level) {
    var out = {
      targetMul: 1, priceMul: 1, rerollMul: 1,
      goldFlat: 0, hand: 0, rerollStep: 1,
      startGold: null, modifierFloor: null
    };
    var n = Math.max(1, Math.min(level || 1, STAKES.length));
    for (var i = 0; i < n; i++) {
      var m = STAKES[i].mods;
      for (var k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
        if (k === 'targetMul' || k === 'priceMul' || k === 'rerollMul') out[k] *= m[k];
        else if (k === 'goldFlat' || k === 'hand') out[k] += m[k];
        else out[k] = m[k];                     // startGold, modifierFloor, rerollStep
      }
    }
    return out;
  }

  function stakeByLevel(n) {
    return STAKES[Math.max(0, Math.min((n || 1) - 1, STAKES.length - 1))];
  }

  PK.STAKES = STAKES;
  PK.stakeMods = stakeMods;
  PK.stakeByLevel = stakeByLevel;

  PK.BALLS = BALLS;
  PK.PEGS = PEGS;
  PK.RELICS = RELICS;
  PK.RELIC_BY_ID = RELIC_BY_ID;
  PK.MODIFIERS = MODIFIERS;
  PK.BOSS_MODIFIERS = BOSS_MODIFIERS;
  PK.RARITY_COLOR = { common: '#9fb3c8', uncommon: '#79c0ff', rare: '#d2a8ff' };
})(window.PK = window.PK || {});
