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
      id: 'ghost', name: 'Ghost', color: '#d2a8ff', cost: 8, rarity: 'uncommon',
      value: 26, restitution: 0.6, mass: 1, radius: 8, ghostPegs: 6,
      desc: 'Value 26, but it phases through the first 6 pegs it meets.'
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
      id: 'momentum', name: 'Momentum', icon: 'MO', rarity: 'uncommon', cost: 8,
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

  PK.BALLS = BALLS;
  PK.PEGS = PEGS;
  PK.RELICS = RELICS;
  PK.RELIC_BY_ID = RELIC_BY_ID;
  PK.MODIFIERS = MODIFIERS;
  PK.BOSS_MODIFIERS = BOSS_MODIFIERS;
  PK.RARITY_COLOR = { common: '#9fb3c8', uncommon: '#79c0ff', rare: '#d2a8ff' };
})(window.PK = window.PK || {});
