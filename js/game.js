/* Run state machine: floors, drops, scoring, shop. */
(function (PK) {
  'use strict';

  var BASE_TARGET = 240;
  var TARGET_GROWTH = 1.28;
  var BASE_HAND = 6;
  var DROP_Y = 76;

  var G = {
    screen: 'menu',          // menu | play | shop | gameover
    meta: null,
    rng: null, seed: '',
    floor: 0, target: 0, score: 0, gold: 0,
    bag: [], hand: [], handSizeBase: BASE_HAND,
    relics: [],
    board: null, modifier: null,
    balls: [], popups: [], particles: [],
    shake: 0,
    aimX: 310, aiming: true,
    carryValue: 0, carryScore: 0, dropIndex: 0,
    floorResolved: false,
    stats: null,
    shop: null,
    log: []
  };

  /* --------------------------------------------------------------- helpers */

  function hookSources() {
    var list = G.relics.map(function (id) { return PK.RELIC_BY_ID[id]; }).filter(Boolean);
    if (G.modifier) list.push(G.modifier);
    return list;
  }

  function callHook(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    hookSources().forEach(function (src) {
      if (typeof src[name] === 'function') src[name].apply(src, [G].concat(args));
    });
  }

  function reduceHook(name, value) {
    var extra = Array.prototype.slice.call(arguments, 2);
    hookSources().forEach(function (src) {
      if (typeof src[name] === 'function') {
        value = src[name].apply(src, [G, value].concat(extra));
      }
    });
    return value;
  }

  function hasRelic(id) { return G.relics.indexOf(id) !== -1; }

  function popup(x, y, text, color, big) {
    G.popups.push({ x: x, y: y, text: text, color: color || '#e8eef7', life: 1, big: !!big });
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < (n || 8); i++) {
      var a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 190;
      G.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 1, color: color, r: 1.5 + Math.random() * 2.5
      });
    }
  }

  var api = {
    get rng() { return G.rng; },
    popup: popup,
    burst: burst,
    spawn: function (ball) { G.balls.push(ball); },
    cloneBall: function (ball) {
      var c = Object.assign({}, ball);
      c.trail = [];
      c.lastPeg = -1;
      return c;
    },
    shatter: function (peg) {
      peg.dead = true;
      burst(peg.x, peg.y, (PK.PEGS[peg.type] || PK.PEGS.normal).glow, 12);
      G.shake = Math.max(G.shake, 6);
    },
    magnetTarget: function () {
      var best = null, bestM = -Infinity;
      G.board.slots.forEach(function (s) {
        if (s.hidden) return;
        if (s.mult > bestM) { bestM = s.mult; best = s; }
      });
      return best ? best.x + best.w / 2 : null;
    },
    convertPegs: function (board, type, frac) {
      var live = board.pegs.filter(function (p) { return !p.dead && p.type === 'normal'; });
      var n = Math.round(live.length * frac);
      G.rng.shuffle(live).slice(0, n).forEach(function (p) { p.type = type; });
    },
    convertPegsCount: function (board, type, count) {
      var live = board.pegs.filter(function (p) { return !p.dead && p.type === 'normal'; });
      G.rng.shuffle(live).slice(0, count).forEach(function (p) { p.type = type; });
    }
  };

  /* -------------------------------------------------------- run persistence */

  function modifierById(id) {
    var all = PK.MODIFIERS.concat(PK.BOSS_MODIFIERS);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /**
   * Freeze the run. Only called when the board is still, so no ball is ever
   * mid-flight in a snapshot.
   *
   * The board goes in whole rather than being regenerated from the seed: by
   * the time you are halfway through a floor the generator has moved on, and
   * replaying it would either rewind your score or desync the pegs.
   */
  function snapshot() {
    if (!G.rng || G.screen === 'gameover' || !G.board) return null;
    return {
      seed: G.seed,
      rngState: G.rng.state,
      floor: G.floor,
      score: G.score,
      target: G.target,
      gold: G.gold,
      bag: G.bag.slice(),
      relics: G.relics.slice(),
      hand: G.hand.slice(),
      handSizeBase: G.handSizeBase,
      carryScore: G.carryScore,
      carryValue: G.carryValue,
      dropIndex: G.dropIndex,
      screen: G.screen,
      floorResolved: G.floorResolved,
      modifier: G.modifier ? G.modifier.id : null,
      board: G.board,
      stats: G.stats,
      log: G.log,
      shop: G.shop ? {
        rerollCost: G.shop.rerollCost,
        gained: G.shop.gained,
        offers: G.shop.offers.map(function (o) {
          return { kind: o.kind, id: o.id, cost: o.cost, sold: !!o.sold };
        })
      } : null
    };
  }

  /** Persist the run. Cheap enough to call at every still moment. */
  function persist() {
    var snap = snapshot();
    if (snap) PK.Save.saveRun(snap);
  }

  function hasSave() { return PK.Save.hasRun(); }

  /** Rebuild a run from disk. Returns false if there is nothing usable. */
  function resumeRun() {
    var d = PK.Save.loadRun();
    if (!d) return false;

    G.meta = G.meta || PK.Save.load();
    G.seed = d.seed;
    G.rng = PK.Rng.restore(PK.hashString(d.seed), d.rngState);
    G.floor = d.floor;
    G.score = d.score;
    G.target = d.target;
    G.gold = d.gold;
    G.bag = d.bag;
    G.relics = d.relics;
    G.hand = d.hand;
    G.handSizeBase = d.handSizeBase;
    G.carryScore = d.carryScore || 0;
    G.carryValue = d.carryValue || 0;
    G.dropIndex = d.dropIndex || 0;
    G.screen = d.screen;
    G.floorResolved = !!d.floorResolved;
    G.modifier = d.modifier ? modifierById(d.modifier) : null;
    G.board = d.board;
    G.stats = d.stats;
    G.log = d.log || [];
    G.balls = []; G.popups = []; G.particles = [];
    G.aiming = true;
    G.shake = 0;

    // Offers persist as ids; their display data is looked up again here so a
    // content change never ships a stale description inside a save file.
    if (d.shop) {
      G.shop = {
        rerollCost: d.shop.rerollCost,
        gained: d.shop.gained,
        offers: d.shop.offers.map(function (o) {
          return { kind: o.kind, id: o.id, cost: o.cost, sold: o.sold, data: offerData(o.kind, o.id) };
        }).filter(function (o) { return !!o.data; })
      };
    } else {
      G.shop = null;
    }

    PK.Board.layoutSlots(G.board);
    PK.UI.refresh();
    if (G.screen === 'shop') PK.UI.showShop();
    else PK.UI.onFloorStart();
    return true;
  }

  /* ------------------------------------------------------------------ run */

  function newRun(seed) {
    G.meta = G.meta || PK.Save.load();
    G.seed = (seed || PK.randomSeedWord()).toUpperCase();
    G.rng = new PK.Rng(G.seed);
    G.floor = 0;
    G.score = 0;
    G.gold = 6 + (window.Arcade && window.Arcade.progress
      ? window.Arcade.progress.bonus('pegfall', 'gold') : 0);
    G.bag = ['standard', 'standard', 'standard', 'standard', 'standard', 'standard', 'bouncy', 'heavy'];
    G.relics = [];
    G.handSizeBase = BASE_HAND;
    G.carryScore = 0;
    G.balls = []; G.popups = []; G.particles = [];
    G.stats = { pegs: 0, bestBall: 0, dropped: 0, goldEarned: 0, runTotal: 0 };
    G.log = [];
    G.meta.runs++;
    PK.Save.save(G.meta);
    PK.Save.clearRun();
    startFloor();
  }

  function pickModifier() {
    var boss = G.floor % 5 === 0;
    if (boss) return G.rng.pick(PK.BOSS_MODIFIERS);
    if (G.floor < 3) return null;
    return G.rng.pick(PK.MODIFIERS);
  }

  function startFloor() {
    G.floor++;
    G.screen = 'play';
    G.floorResolved = false;
    G.carryValue = 0;
    G.balls = [];
    G.modifier = pickModifier();

    var mod = G.modifier;
    if (mod && mod.boss) PK.Sfx.boss();
    var board = PK.Board.make(G, G.rng, { extraRows: (mod && mod.extraRows) || 0 });

    // Relic + modifier slot rewrites
    var mults = board.slots.map(function (s) { return s.mult; });
    mults = reduceHook('slotMults', mults);
    if (hasRelic('chaos_theory')) mults = G.rng.shuffle(mults);
    board.slots.forEach(function (s, i) {
      s.mult = mults[i];
      s.baseMult = mults[i];
    });

    hookSources().forEach(function (src) {
      if (src.gravityMul) board.gravityMul = (board.gravityMul || 1) * src.gravityMul;
    });

    G.board = board;
    if (mod && typeof mod.apply === 'function') mod.apply(G, board, G.rng);
    callHook('onFloorStart', board, api);
    PK.Board.layoutSlots(board);

    if (board.fog) board.slots.forEach(function (s) { s.revealed = false; });
    // persist() runs at the end of startFloor, once the hand has been drawn.

    // Target
    var t = BASE_TARGET * Math.pow(TARGET_GROWTH, G.floor - 1);
    if (G.floor % 5 === 0) t *= 1.3;
    if (mod && mod.targetMul) t *= mod.targetMul;
    G.target = Math.round(t / 5) * 5;

    G.score = G.carryScore;
    G.carryScore = 0;

    // Hand
    var size = reduceHook('handSize', G.handSizeBase);
    size = Math.max(1, Math.min(size, 14));
    var shuffled = G.rng.shuffle(G.bag);
    G.hand = shuffled.slice(0, Math.min(size, shuffled.length));
    while (G.hand.length < size) G.hand.push(G.rng.pick(G.bag));   // small bags still fill the hand
    G.dropIndex = 0;
    G.aiming = true;

    persist();
    PK.UI.onFloorStart();
  }

  /* ---------------------------------------------------------------- drops */

  function canDrop() {
    return G.screen === 'play' && !G.floorResolved && G.hand.length > 0 && G.balls.length === 0;
  }

  function dropBall(x) {
    if (!canDrop()) return;
    var id = G.hand.shift();
    var def = PK.BALLS[id] || PK.BALLS.standard;
    var b = G.board;
    var min = (b.wallLeft || 0) + def.radius + 2;
    var max = (b.wallRight || b.width) - def.radius - 2;
    x = Math.max(min, Math.min(max, x));

    var ball = PK.Physics.makeBall(def, x, DROP_Y, G.rng);
    ball.dropIndex = G.dropIndex++;
    PK.Sfx.drop();
    G.stats.dropped++;
    callHook('onBallSpawn', ball, api);
    G.balls.push(ball);
    G.aiming = false;
    PK.UI.refresh();
  }

  function onPegHit(ball, peg, def) {
    ball.pegHits++;
    G.stats.pegs++;
    peg.flash = 1;
    PK.Sfx.peg(def.id, ball.pegHits);

    var base = def.value * (G.board.pegValueMul === undefined ? 1 : G.board.pegValueMul);
    ball.value += base;

    if (def.slotBonus) ball.slotBonus += def.slotBonus;

    if (def.hp) {
      peg.hp++;
      if (peg.hp >= def.hp) {
        ball.value += def.breakValue;
        PK.Sfx.shatter();
        api.shatter(peg);
        popup(peg.x, peg.y, '+' + def.breakValue, def.glow);
      }
    }

    if (def.id === 'gold') { popup(peg.x, peg.y, '+' + def.value, def.glow); burst(peg.x, peg.y, def.glow, 6); }
    if (def.id === 'bumper') { G.shake = Math.max(G.shake, 5); burst(peg.x, peg.y, def.glow, 10); }

    if (typeof ball.def.onPegHit === 'function') ball.def.onPegHit(G, ball, peg, api);
    callHook('onPegHit', ball, peg, api);
  }

  function onLand(ball) {
    var slot = PK.Board.slotAt(G.board, ball.x);
    slot.revealed = true;
    slot.flash = 1;
    slot.hits++;

    var ctx = { mult: slot.voided ? 0 : slot.mult + ball.slotBonus };
    hookSources().forEach(function (src) {
      if (typeof src.onSlot === 'function') src.onSlot(G, ball, slot, ctx);
    });
    if (typeof ball.def.onSlot === 'function') ball.def.onSlot(G, ball, slot, ctx);
    if (slot.voided) ctx.mult = 0;

    var score = Math.round(Math.max(0, ball.value) * Math.max(0, ctx.mult));
    var sctx = { score: score };
    hookSources().forEach(function (src) {
      if (typeof src.onBallScored === 'function') src.onBallScored(G, ball, sctx);
    });
    score = Math.max(0, Math.round(sctx.score));

    var wasShort = G.score < G.target;
    G.score += score;
    if (score > G.stats.bestBall) G.stats.bestBall = score;
    PK.Sfx.land(ctx.mult, score);

    // Crossing the target is the moment the remaining balls become optional,
    // so it gets its own cue rather than being left to the player to notice.
    if (wasShort && G.score >= G.target && G.hand.length > 0) {
        PK.Sfx.cleared();
        PK.UI.showToast('FLOOR CLEARED — bank it, or keep dropping for gold');
    }

    var cx = slot.x + slot.w / 2;
    var color = ctx.mult >= 4 ? '#f2cc60' : (ctx.mult === 0 ? '#ff7b72' : '#e8eef7');
    popup(cx, PK.Board.SLOT_TOP - 16,
      Math.round(ball.value) + ' × ' + round1(ctx.mult) + ' = ' + score, color, true);
    burst(cx, PK.Board.SLOT_TOP + 10, color, score > 200 ? 22 : 10);
    if (score > 250) G.shake = Math.max(G.shake, 8);

    G.log.push({ ball: ball.def.name, value: Math.round(ball.value), mult: ctx.mult, score: score });
    if (G.log.length > 6) G.log.shift();

    persist();
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* --------------------------------------------------------- floor result */

  function maybeResolveFloor() {
    if (G.floorResolved || G.balls.length) return;
    if (G.hand.length > 0) { G.aiming = true; return; }
    resolveFloor();
  }

  function resolveFloor() {
    G.floorResolved = true;
    if (G.score >= G.target) {
      var ctx = { gold: 4 + Math.min(4, Math.floor(((G.score - G.target) / G.target) * 4)) };
      ctx.gold += G.hand.length;
      callHook('onFloorEnd', ctx);
      var gained = Math.max(0, Math.round(ctx.gold));
      G.gold += gained;
      G.stats.goldEarned += gained;

      if (hasRelic('overflow')) G.carryScore = Math.max(0, G.score - G.target);

      G.meta.bestFloor = Math.max(G.meta.bestFloor, G.floor);
      G.meta.bestScore = Math.max(G.meta.bestScore, G.score);
      G.meta.totalScore += G.score;
      G.stats.runTotal += G.score;
      PK.Save.save(G.meta);

      PK.Sfx.bank();
      openShop(gained);
    } else if (hasRelic('second_chance')) {
      G.relics.splice(G.relics.indexOf('second_chance'), 1);
      PK.UI.showToast('SECOND CHANCE consumed — the floor is rebuilt.');
      G.floor--;               // startFloor() will increment it back
      G.carryScore = 0;
      startFloor();
    } else {
      gameOver();
    }
  }

  /** Bank the floor early, keeping unused balls (they pay gold). */
  function cashOut() {
    if (G.screen !== 'play' || G.floorResolved) return;
    if (G.score < G.target || G.balls.length) return;
    resolveFloor();
  }

  function gameOver() {
    G.screen = 'gameover';
    G.meta.totalScore += G.score;
    G.stats.runTotal += G.score;
    PK.Save.save(G.meta);
    PK.Save.clearRun();
    PK.Sfx.gameOver();

    // Post the run to the arcade. Fire-and-forget: the game over screen never
    // waits on the network, and an offline arcade is a no-op.
    if (window.Arcade) {
      window.Arcade.progress.recordRun('pegfall', {
        score: G.stats.runTotal,
        floor: G.floor,
        bestBall: G.stats.bestBall,
        relics: G.relics.length,
        difficulty: 'standard'
      });
      window.Arcade.submitScore('pegfall', {
        score: G.stats.runTotal,
        metrics: { floor: G.floor, bestBall: G.stats.bestBall },
        meta: {
          floor: G.floor,
          seed: G.seed,
          relics: G.relics.length,
          pegs: G.stats.pegs
        }
      });
    }

    PK.UI.showGameOver();
  }

  /* ----------------------------------------------------------------- shop */

  /* Named so a saved shop can be rebuilt from ids alone: an offer persists as
     kind + id + cost, and its display data is looked up again on load. */
  var SERVICES = {
    hand: { cost: 11, data: { name: 'Bigger Hands', rarity: 'rare', desc: 'Permanently draw +1 ball every floor.' } },
    trim: { cost: 4, data: { name: 'Bag Trim', rarity: 'common', desc: 'Remove your lowest-value ball from the bag.' } },
    gild: { cost: 7, data: { name: 'Gilding', rarity: 'uncommon', desc: 'Upgrade one Standard ball into a random unlocked type.' } }
  };

  function offerData(kind, id) {
    if (kind === 'relic') return PK.RELIC_BY_ID[id];
    if (kind === 'ball') return PK.BALLS[id];
    return (SERVICES[id] || {}).data;
  }

  function shopPool() {
    var offers = [];
    PK.RELICS.forEach(function (r) {
      if (G.relics.indexOf(r.id) === -1) offers.push({ kind: 'relic', id: r.id, data: r, cost: r.cost });
    });
    PK.Save.unlockedBalls(G.meta).forEach(function (id) {
      var b = PK.BALLS[id];
      if (b && id !== 'standard') offers.push({ kind: 'ball', id: id, data: b, cost: b.cost });
    });
    Object.keys(SERVICES).forEach(function (id) {
      var sv = SERVICES[id];
      offers.push({ kind: 'service', id: id, cost: sv.cost, data: sv.data });
    });
    return offers;
  }

  function rollShop() {
    var weight = function (o) {
      var r = (o.data.rarity || 'common');
      var w = r === 'common' ? 3 : r === 'uncommon' ? 2 : 1;
      if (o.kind === 'service') w = 1.5;
      return w;
    };
    G.shop.offers = G.rng.pickWeighted(shopPool(), 3, weight).map(function (o) {
      return Object.assign({}, o, { sold: false });
    });
  }

  function openShop(gained) {
    G.screen = 'shop';
    G.shop = { rerollCost: 2, gained: gained, offers: [] };
    rollShop();
    persist();
    PK.UI.showShop();
  }

  function buy(index) {
    var o = G.shop.offers[index];
    if (!o || o.sold || G.gold < o.cost) { PK.Sfx.deny(); return false; }
    G.gold -= o.cost;
    PK.Sfx.buy();
    o.sold = true;

    if (o.kind === 'relic') {
      G.relics.push(o.id);
    } else if (o.kind === 'ball') {
      G.bag.push(o.id);
    } else if (o.id === 'hand') {
      G.handSizeBase++;
    } else if (o.id === 'trim') {
      var worstIdx = -1, worstVal = Infinity;
      G.bag.forEach(function (id, i) {
        var v = (PK.BALLS[id] || PK.BALLS.standard).value;
        if (v < worstVal) { worstVal = v; worstIdx = i; }
      });
      if (worstIdx >= 0 && G.bag.length > 3) G.bag.splice(worstIdx, 1);
    } else if (o.id === 'gild') {
      var i = G.bag.indexOf('standard');
      var pool = PK.Save.unlockedBalls(G.meta).filter(function (b) { return b !== 'standard'; });
      if (i >= 0 && pool.length) G.bag[i] = G.rng.pick(pool);
    }
    persist();
    PK.UI.showShop();
    return true;
  }

  function reroll() {
    if (G.gold < G.shop.rerollCost) { PK.Sfx.deny(); return; }
    G.gold -= G.shop.rerollCost;
    G.shop.rerollCost++;
    rollShop();
    PK.Sfx.ui();
    persist();
    PK.UI.showShop();
  }

  function leaveShop() {
    startFloor();
  }

  /* ---------------------------------------------------------------- frame */

  function update(dt) {
    var i;
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);

    if (G.screen === 'play' && G.board) {
      var settled = false;
      for (i = G.balls.length - 1; i >= 0; i--) {
        var ball = G.balls[i];
        PK.Physics.step(ball, G.board, dt, {
          rng: G.rng,
          onPegHit: onPegHit,
          onLand: onLand,
          magnetTarget: api.magnetTarget
        });
        if (ball.landed) { G.balls.splice(i, 1); settled = true; }
        else if (ball.age > 25) { G.balls.splice(i, 1); settled = true; }   // safety valve
      }
      G.board.pegs.forEach(function (p) { if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3.2); });
      G.board.slots.forEach(function (s) { if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2); });
      maybeResolveFloor();

      /* The HUD is redrawn here rather than from onLand, which runs inside
         Physics.step while the ball is still in G.balls — anything keyed on
         "the board is still", the BANK IT button above all, read as false
         there and never got another chance to update. */
      if (settled) PK.UI.refresh();
    }

    for (i = G.popups.length - 1; i >= 0; i--) {
      var p = G.popups[i];
      p.life -= dt * 0.8;
      p.y -= dt * 26;
      if (p.life <= 0) G.popups.splice(i, 1);
    }
    for (i = G.particles.length - 1; i >= 0; i--) {
      var q = G.particles[i];
      q.life -= dt * 1.6;
      q.vy += 700 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.life <= 0) G.particles.splice(i, 1);
    }
  }

  PK.G = G;
  PK.Game = {
    G: G,
    newRun: newRun,
    update: update,
    dropBall: dropBall,
    canDrop: canDrop,
    cashOut: cashOut,
    buy: buy,
    reroll: reroll,
    leaveShop: leaveShop,
    hasRelic: hasRelic,
    hasSave: hasSave,
    resumeRun: resumeRun,
    persist: persist,
    handSize: function () { return reduceHook('handSize', G.handSizeBase); },
    DROP_Y: DROP_Y
  };
})(window.PK = window.PK || {});
