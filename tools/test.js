/* ============================================================
   tools/test.js — PEGFALL: rng, board, physics, persistence, shop

   Run:  node tools/test.js

   What this is for. PEGFALL is the one game in the arcade whose deploy gates
   on nothing but "the files exist", so these cover the paths where a silent
   regression would reach a player: a run that cannot be resumed, a shop that
   sells something it cannot deliver, a ball that never lands, and the meta
   progression that outlives all of it.
   ============================================================ */
'use strict';

const { createGame } = require('./harness');

/* ---------- micro test framework ---------- */
let passed = 0;
const failures = [];
let group = '';

function describe(name, fn) { group = name; fn(); }
function it(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push({ group: group, name: name, err: e.message }); }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what ? what + ': ' : '') + 'expected ' + JSON.stringify(expected) +
      ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, what) { if (!cond) throw new Error(what || 'expected truthy'); }
function deepEq(a, b, what) { eq(JSON.stringify(a), JSON.stringify(b), what); }

/* ---------- fixtures ---------- */
function fresh(opts) {
  const g = createGame(Object.assign({ quiet: true }, opts || {}));
  return g;
}
/** A run parked on floor 1 with a known seed. */
function run(seed, opts) {
  const g = fresh(opts);
  g.PK.Game.newRun(seed || 'TESTSEED');
  return g;
}

/* ============================================================
   RNG — every run is reproducible from its seed, and a resumed
   run must pick the sequence up rather than start it again.
   ============================================================ */
describe('rng', function () {
  it('is deterministic for a given seed', function () {
    const g = fresh();
    const a = new g.PK.Rng('ABC'), b = new g.PK.Rng('ABC');
    for (let i = 0; i < 200; i++) eq(a.next(), b.next(), 'draw ' + i);
  });

  it('differs across seeds', function () {
    const g = fresh();
    const a = new g.PK.Rng('ABC'), b = new g.PK.Rng('ABD');
    let same = 0;
    for (let i = 0; i < 50; i++) if (a.next() === b.next()) same++;
    ok(same < 5, 'seeds should diverge');
  });

  it('restore() resumes the stream where it left off', function () {
    const g = fresh();
    const a = new g.PK.Rng('XYZ');
    for (let i = 0; i < 10; i++) a.next();
    const state = a.state;
    const expect = [a.next(), a.next(), a.next()];
    const b = g.PK.Rng.restore(g.PK.hashString('XYZ'), state);
    deepEq([b.next(), b.next(), b.next()], expect, 'resumed stream');
  });

  it('restore() ignores a missing or broken state', function () {
    const g = fresh();
    const seed = g.PK.hashString('XYZ');
    eq(g.PK.Rng.restore(seed, undefined).state, seed, 'undefined falls back to the seed');
    eq(g.PK.Rng.restore(seed, NaN).state, seed, 'NaN falls back to the seed');
  });

  it('next() stays in [0, 1)', function () {
    const g = fresh();
    const r = new g.PK.Rng('R');
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      ok(v >= 0 && v < 1, 'got ' + v);
    }
  });

  it('int() is inclusive at both ends and never fractional', function () {
    const g = fresh();
    const r = new g.PK.Rng('R');
    const seen = {};
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6);
      ok(v >= 1 && v <= 6, 'out of range: ' + v);
      ok(Number.isInteger(v), 'not an integer: ' + v);
      seen[v] = true;
    }
    eq(Object.keys(seen).length, 6, 'every face should appear');
  });

  it('shuffle() keeps the same multiset and does not mutate the source', function () {
    const g = fresh();
    const r = new g.PK.Rng('S');
    const src = ['a', 'b', 'c', 'd', 'e', 'a'];
    const out = r.shuffle(src);
    deepEq(src, ['a', 'b', 'c', 'd', 'e', 'a'], 'source untouched');
    deepEq(out.slice().sort(), src.slice().sort(), 'same contents');
  });

  it('pickWeighted() returns n distinct entries', function () {
    const g = fresh();
    const r = new g.PK.Rng('W');
    const pool = [{ w: 1 }, { w: 5 }, { w: 2 }, { w: 9 }];
    const out = r.pickWeighted(pool, 3, function (o) { return o.w; });
    eq(out.length, 3, 'count');
    eq(new Set(out).size, 3, 'no duplicates');
  });

  it('pickWeighted() cannot return more than the pool holds', function () {
    const g = fresh();
    const r = new g.PK.Rng('W');
    eq(r.pickWeighted([{ w: 1 }, { w: 1 }], 5, function (o) { return o.w; }).length, 2);
  });

  it('pickWeighted() stops rather than looping when every weight is zero', function () {
    const g = fresh();
    const r = new g.PK.Rng('W');
    eq(r.pickWeighted([{ w: 0 }, { w: 0 }], 2, function (o) { return o.w; }).length, 0);
  });
});

/* ============================================================
   Board geometry — slotAt() has to answer for every x on the
   board, including outside the walls, or a ball can land nowhere.
   ============================================================ */
describe('board', function () {
  it('builds a lattice and eleven slots', function () {
    const g = run('BOARD');
    const b = g.PK.Game.G.board;
    ok(b.pegs.length > 50, 'pegs: ' + b.pegs.length);
    eq(b.slots.length, 11, 'slots');
    eq(b.width, g.PK.Board.W, 'width');
  });

  it('layoutSlots() gives every visible slot a position and a width', function () {
    const g = run('BOARD');
    const b = g.PK.Game.G.board;
    b.slots.forEach(function (s) {
      if (s.hidden) return;
      ok(typeof s.x === 'number' && isFinite(s.x), 'slot ' + s.index + ' x');
      ok(s.w > 0, 'slot ' + s.index + ' width');
    });
  });

  it('slotAt() answers for every x across the board', function () {
    const g = run('BOARD');
    const b = g.PK.Game.G.board;
    for (let x = 0; x <= g.PK.Board.W; x += 5) {
      const s = g.PK.Board.slotAt(b, x);
      ok(s && !s.hidden, 'no live slot at x=' + x);
    }
  });

  it('slotAt() clamps outside the board rather than returning nothing', function () {
    const g = run('BOARD');
    const b = g.PK.Game.G.board;
    ok(g.PK.Board.slotAt(b, -500), 'far left');
    ok(g.PK.Board.slotAt(b, g.PK.Board.W + 500), 'far right');
  });

  it('a narrowed board hides the edge slots and kills the pegs behind them', function () {
    const g = run('BOARD');
    const b = g.PK.Game.G.board;
    b.narrow = 2;
    g.PK.Board.layoutSlots(b);
    eq(b.slots.filter(function (s) { return s.hidden; }).length, 4, 'two hidden each side');
    ok(b.wallLeft > 0 && b.wallRight < g.PK.Board.W, 'walls moved in');
    const stranded = b.pegs.filter(function (p) {
      return !p.dead && (p.x < b.wallLeft - 2 || p.x > b.wallRight + 2);
    });
    eq(stranded.length, 0, 'no live peg outside the walls');
    // Still answerable everywhere, which is the point of the clamp.
    for (let x = 0; x <= g.PK.Board.W; x += 5) ok(g.PK.Board.slotAt(b, x), 'x=' + x);
  });
});

/* ============================================================
   Physics — the only hard requirement is that a ball always
   resolves. A ball that never lands is a soft-locked run.
   ============================================================ */
describe('physics', function () {
  it('a ball dropped anywhere across the board lands', function () {
    for (let x = 10; x <= 610; x += 50) {
      const g = run('PHYS' + x);
      g.PK.Game.dropBall(x);
      const steps = g.helpers.settle();
      eq(g.PK.Game.G.balls.length, 0, 'x=' + x + ' still in flight after ' + steps + ' steps');
    }
  });

  it('a ball is clamped inside the walls even when aimed off the board', function () {
    const g = run('CLAMP');
    g.PK.Game.dropBall(-9999);
    eq(g.PK.Game.G.balls.length, 1, 'a ball was spawned');
    const b = g.PK.Game.G.balls[0];
    ok(b.x >= 0 && b.x <= g.PK.Board.W, 'spawned at ' + b.x);
    g.helpers.settle();
    eq(g.PK.Game.G.balls.length, 0, 'landed');
  });

  it('the stuck-ball safety valve releases a ball that has run too long', function () {
    /* Aged directly rather than contrived into a physical trap: the valve is
       the last defence against a soft-locked floor, so what matters is that it
       fires on age alone, whatever the ball is doing when it gets there. */
    const g = run('VALVE');
    g.PK.Game.dropBall(310);
    const ball = g.PK.Game.G.balls[0];
    ball.age = 24.9;
    eq(g.PK.Game.G.balls.length, 1, 'still in play just under the limit');
    for (let i = 0; i < 20 && g.PK.Game.G.balls.length; i++) g.PK.Game.update(1 / 60);
    eq(g.PK.Game.G.balls.length, 0, 'released at age ' + ball.age.toFixed(1));
    // Released, not landed — the floor moves on either way.
    eq(g.PK.Game.G.floorResolved || g.PK.Game.canDrop(), true, 'the floor was not left stuck');
  });

  it('landing scores, records a best ball and writes a log line', function () {
    const g = run('LAND');
    const gained = g.helpers.drop(310);
    ok(gained >= 0, 'score never goes backwards');
    eq(g.PK.Game.G.stats.bestBall, gained, 'best ball is this ball');
    eq(g.PK.Game.G.log.length, 1, 'one log line');
    eq(g.PK.Game.G.stats.dropped, 1, 'one drop counted');
  });

  it('the log keeps only the last six lines', function () {
    const g = run('LOG');
    g.PK.Game.G.handSizeBase = 10;
    for (let i = 0; i < 9 && g.PK.Game.canDrop(); i++) g.helpers.drop(200 + i * 20);
    ok(g.PK.Game.G.log.length <= 6, 'log length ' + g.PK.Game.G.log.length);
  });
});

/* ============================================================
   Peg regeneration.

   Shattering already paid — Bomb is the strongest ball in the
   game — but it read as self-harm, because the loss was visible
   and permanent. These cover the cooldown that replaces it, and
   the one peg that must never come back.
   ============================================================ */
describe('peg regeneration', function () {
  /**
   * Play Bomb balls until the game itself shatters a peg, and return it.
   * Goes through the real api.shatter rather than imitating it — that closure
   * is not exported, and a test that reimplements it proves nothing.
   */
  function shatterForReal(seed) {
    const g = run(seed);
    const G = g.PK.Game.G;
    G.handSizeBase = 30;
    G.hand = new Array(30).fill('bomb');
    G.target = 1e9;                     // never resolve; we want the board
    let guard = 0;
    while (guard++ < 30 && g.PK.Game.canDrop()) {
      g.helpers.drop(250 + (guard % 5) * 30);
      const hit = G.board.pegs.find(function (p) { return p.dead && p.respawn > 0; });
      if (hit) return { g: g, peg: hit };
    }
    return { g: g, peg: null };
  }

  it('the game marks a peg it really shattered', function () {
    const { g, peg } = shatterForReal('REGEN');
    ok(peg, 'no peg was shattered in 30 Bomb drops — the path is untested');
    eq(peg.dead, true, 'gone for now');
    ok(peg.respawn > 0 && peg.respawn <= g.PK.Game.PEG_RESPAWN_DROPS,
      'queued to return, at ' + peg.respawn);
  });

  it('it returns after the documented number of drops', function () {
    const g = run('REGEN2');
    const G = g.PK.Game.G;
    const peg = G.board.pegs.find(function (p) { return !p.dead; });
    const n = g.PK.Game.PEG_RESPAWN_DROPS;
    peg.dead = true;
    peg.respawn = n;

    for (let i = 0; i < n - 1; i++) {
      g.helpers.drop(310);
      eq(peg.dead, true, 'still gone after ' + (i + 1) + ' drop(s)');
    }
    g.helpers.drop(310);
    eq(peg.dead, false, 'back after ' + n + ' drops');
    eq(peg.respawn, 0, 'no longer counting');
    ok(peg.flash > 0, 'flashes so the return is visible');
  });

  it('end to end, a peg is missing for one drop and back for the next', function () {
    /* Pins the off-by-one rather than leaving it to be rediscovered: the ball
       that breaks a peg is still in the air, so its own landing spends the
       first tick of the countdown. */
    const { g, peg } = shatterForReal('REGENGAP');
    ok(peg, 'a peg was shattered');
    eq(peg.dead, true, 'gone when its breaker lands');
    eq(peg.respawn, g.PK.Game.PEG_RESPAWN_DROPS - 1, 'one tick already spent');

    g.helpers.drop(310);
    eq(peg.dead, false, 'back after one further drop');
  });

  it('a shattered peg is playable again once it is back', function () {
    const { g, peg } = shatterForReal('REGEN5');
    ok(peg, 'a peg was shattered');
    const G = g.PK.Game.G;
    let guard = 0;
    while (peg.dead && guard++ < 6 && g.PK.Game.canDrop()) g.helpers.drop(310);
    eq(peg.dead, false, 'came back');
    // Physics skips dead pegs; a revived one has to be collidable again.
    const live = G.board.pegs.filter(function (p) { return !p.dead; });
    ok(live.indexOf(peg) !== -1, 'counted among the live pegs');
  });

  it('a revived brittle peg is whole again, not one hit from breaking', function () {
    const g = run('REGEN3');
    const G = g.PK.Game.G;
    const peg = G.board.pegs.find(function (p) { return !p.dead; });
    peg.type = 'brittle';
    peg.hp = 2;
    peg.dead = true;
    peg.respawn = 1;
    g.helpers.drop(310);
    eq(peg.dead, false, 'back');
    eq(peg.hp, 0, 'hp reset');
  });

  it('a peg the walls cut off never grows back', function () {
    /* Iron Maiden kills the pegs outside the narrowed walls. They are dead for
       a different reason and must stay that way, or they would reappear in the
       gutter where no ball can reach them. */
    const g = run('REGEN4');
    const G = g.PK.Game.G;
    G.board.narrow = 2;
    g.PK.Board.layoutSlots(G.board);
    const culled = G.board.pegs.filter(function (p) { return p.dead; });
    ok(culled.length > 0, 'the walls cut some off');
    culled.forEach(function (p) { eq(p.respawn, 0, 'not queued to return'); });

    for (let i = 0; i < 6 && g.PK.Game.canDrop(); i++) g.helpers.drop(310);
    culled.forEach(function (p) {
      eq(p.dead, true, 'peg at x=' + Math.round(p.x) + ' came back outside the walls');
    });
  });

  it('regeneration consumes no randomness, so seeds still replay', function () {
    /* A percentage roll — "a third of shattered pegs come back" — would have
       drawn from G.rng on every drop and quietly changed what every existing
       seed plays like. A fixed countdown draws nothing. */
    const g1 = run('REGENSEED');
    const g2 = run('REGENSEED');
    // Queue a return in one of them and not the other.
    const peg = g1.PK.Game.G.board.pegs.find(function (p) { return !p.dead; });
    peg.dead = true;
    peg.respawn = g1.PK.Game.PEG_RESPAWN_DROPS;

    for (let i = 0; i < 4; i++) {
      if (g1.PK.Game.canDrop()) g1.PK.Game.dropBall(310);
      if (g2.PK.Game.canDrop()) g2.PK.Game.dropBall(310);
      g1.helpers.settle();
      g2.helpers.settle();
    }
    eq(peg.dead, false, 'the peg did come back, so the path ran');
    eq(g1.PK.Game.G.rng.state, g2.PK.Game.G.rng.state,
      'reviving a peg moved the RNG stream');
  });
});

/* ============================================================
   The run loop
   ============================================================ */
describe('run', function () {
  it('newRun() starts on floor 1 with a hand and a target', function () {
    const g = run('NEW');
    const G = g.PK.Game.G;
    eq(G.floor, 1, 'floor');
    eq(G.screen, 'play', 'screen');
    eq(G.hand.length, 6, 'base hand');
    eq(G.gold, 6, 'starting gold');
    eq(G.target, 240, 'floor 1 target');
    eq(G.score, 0, 'score');
    eq(G.relics.length, 0, 'no relics');
  });

  it('the seed is upper-cased so a run is quotable', function () {
    eq(run('lowercase').PK.Game.G.seed, 'LOWERCASE');
  });

  it('newRun() counts the run against the meta profile immediately', function () {
    const g = fresh();
    eq(g.helpers.meta().runs, 0, 'nothing yet');
    g.PK.Game.newRun('COUNT');
    eq(g.helpers.meta().runs, 1, 'one run');
    g.PK.Game.newRun('COUNT2');
    eq(g.helpers.meta().runs, 2, 'two runs');
  });

  it('dropBall() takes from the hand, and refuses once it is empty', function () {
    const g = run('HAND');
    const G = g.PK.Game.G;
    eq(G.hand.length, 6);
    g.helpers.drop(310);
    eq(G.hand.length, 5, 'one ball consumed');
    let guard = 0;
    while (g.PK.Game.canDrop() && guard++ < 20) g.helpers.drop(310);
    eq(G.hand.length, 0, 'hand emptied');
    eq(g.PK.Game.canDrop(), false, 'cannot drop with an empty hand');
  });

  it('a fresh run drops one ball at a time', function () {
    const g = run('SOLO');
    const G = g.PK.Game.G;
    eq(G.inFlightBase, g.PK.Game.BASE_IN_FLIGHT, 'starts at the base');
    eq(g.PK.Game.inFlight(), 1, 'one at a time');
    g.PK.Game.dropBall(310);
    eq(G.balls.length, 1);
    eq(g.PK.Game.canDrop(), false, 'the board is busy until it lands');
    g.PK.Game.dropBall(310);
    eq(G.balls.length, 1, 'the second drop was refused');
    eq(G.hand.length, 5, 'and cost nothing from the hand');
  });

  it('a bought volley lets that many fly at once', function () {
    const g = run('VOLLEY');
    const G = g.PK.Game.G;
    G.inFlightBase = 3;
    for (let i = 0; i < 3; i++) {
      eq(g.PK.Game.canDrop(), true, 'should still accept ball ' + (i + 1));
      g.PK.Game.dropBall(250 + i * 30);
    }
    eq(G.balls.length, 3, 'all three in the air');
    eq(G.hand.length, 3, 'and all three came out of the hand');
    eq(g.PK.Game.canDrop(), false, 'full at the bought size');
    g.PK.Game.dropBall(300);
    eq(G.balls.length, 3, 'the extra drop was refused');
    eq(G.hand.length, 3, 'and cost no ball from the hand');
  });

  it('every ball of a volley lands and scores', function () {
    const g = run('VOLLEYLAND');
    const G = g.PK.Game.G;
    G.inFlightBase = 3;
    for (let i = 0; i < 3; i++) g.PK.Game.dropBall(220 + i * 45);
    g.helpers.settle();
    eq(G.balls.length, 0, 'the board came to rest');
    eq(G.stats.dropped, 3, 'all counted');
    eq(G.log.length, 3, 'each one logged');
  });

  it('a big enough volley can throw the whole hand at once', function () {
    // The ceiling is MAX_HAND precisely so this is reachable.
    const g = run('WHOLEHAND');
    const G = g.PK.Game.G;
    G.inFlightBase = g.PK.Game.MAX_IN_FLIGHT;
    const hand = G.hand.length;
    for (let i = 0; i < hand; i++) g.PK.Game.dropBall(180 + i * 40);
    eq(G.balls.length, hand, 'the entire hand is in the air');
    eq(G.hand.length, 0, 'nothing left to throw');
    g.helpers.settle();
    eq(G.balls.length, 0, 'and all of them resolved');
    eq(G.stats.dropped, hand, 'all counted');
  });

  it('inFlight() never reports less than one or more than the ceiling', function () {
    const g = run('CLAMPFLIGHT');
    const G = g.PK.Game.G;
    G.inFlightBase = 0;
    eq(g.PK.Game.inFlight(), 1, 'a broken save cannot stop the game dead');
    G.inFlightBase = 9999;
    eq(g.PK.Game.inFlight(), g.PK.Game.MAX_IN_FLIGHT, 'clamped to the ceiling');
  });

  it('missing the target ends the run and posts nothing twice', function () {
    const g = run('FAIL');
    const G = g.PK.Game.G;
    G.target = 1e9;                 // unreachable
    g.helpers.playFloor(310);
    eq(G.screen, 'gameover', 'run over');
    eq(g.bus.screen, 'gameover', 'the game-over screen was shown');
    ok(!g.PK.Save.hasRun(), 'the resumable run was cleared');
  });

  it('clearing the target opens the shop and pays gold', function () {
    const g = run('CLEAR');
    const G = g.PK.Game.G;
    G.target = 1;                   // already met by the first ball
    const goldBefore = G.gold;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    eq(G.screen, 'shop', 'shop opened');
    ok(G.gold > goldBefore, 'gold paid: ' + goldBefore + ' -> ' + G.gold);
    eq(G.stats.goldEarned, G.gold - goldBefore, 'gold earned tracked');
  });

  it('cashOut() is refused while short of the target', function () {
    const g = run('SHORT');
    const G = g.PK.Game.G;
    G.target = 1e9;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    eq(G.screen, 'play', 'still playing');
    eq(G.floorResolved, false, 'floor not resolved');
  });

  it('cashOut() is refused with a ball still in flight', function () {
    const g = run('BUSY');
    const G = g.PK.Game.G;
    G.target = 1;
    G.score = 500;
    g.PK.Game.dropBall(310);
    g.PK.Game.cashOut();
    eq(G.screen, 'play', 'the board must be still first');
  });

  it('the next floor raises the target and carries no score by default', function () {
    const g = run('FLOOR2');
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    g.PK.Game.leaveShop();
    eq(G.floor, 2, 'floor 2');
    eq(G.score, 0, 'score reset');
    ok(G.target > 240, 'target grew to ' + G.target);
  });

  it('every fifth floor is a boss floor with a boss modifier', function () {
    const g = run('BOSS');
    const G = g.PK.Game.G;
    for (let i = 0; i < 4; i++) {
      G.target = 1;
      g.helpers.drop(310);
      g.PK.Game.cashOut();
      g.PK.Game.leaveShop();
    }
    eq(G.floor, 5, 'reached floor 5');
    ok(G.modifier && G.modifier.boss, 'boss modifier on floor 5');
  });

  it('a run is deterministic: same seed, same drops, same score', function () {
    const xs = [120, 310, 480, 200, 400, 300];
    function play() {
      const g = run('DETERMINISM');
      xs.forEach(function (x) { if (g.PK.Game.canDrop()) g.helpers.drop(x); });
      const G = g.PK.Game.G;
      return { score: G.score, pegs: G.stats.pegs, best: G.stats.bestBall, log: G.log };
    }
    deepEq(play(), play(), 'two identical runs diverged');
  });

  it('handSize() reports what startFloor() will actually deal', function () {
    const g = run('CAP');
    const G = g.PK.Game.G;
    G.handSizeBase = 999;
    eq(g.PK.Game.handSize(), g.PK.Game.MAX_HAND, 'clamped to the cap');
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    g.PK.Game.leaveShop();
    eq(G.hand.length, g.PK.Game.MAX_HAND, 'the deal matches the promise');
  });
});

/* ============================================================
   The shop.

   buy() takes an INDEX into G.shop.offers, not an offer — the
   signature that has been mis-called before.
   ============================================================ */
describe('shop', function () {
  /** Park a run in the shop with known gold. */
  function shopping(seed, gold) {
    const g = run(seed || 'SHOP');
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    G.gold = gold === undefined ? 100 : gold;
    return g;
  }

  it('opens with three offers and a reroll price', function () {
    const g = shopping();
    eq(g.PK.Game.G.shop.offers.length, 3, 'offers');
    eq(g.PK.Game.G.shop.rerollCost, 2, 'first reroll');
    g.PK.Game.G.shop.offers.forEach(function (o) {
      ok(o.data, 'offer ' + o.id + ' has display data');
      ok(typeof o.cost === 'number', 'offer ' + o.id + ' has a cost');
      eq(o.sold, false, 'nothing starts sold');
    });
  });

  it('buy() takes an index and spends the gold', function () {
    const g = shopping('BUYIDX', 100);
    const G = g.PK.Game.G;
    const cost = G.shop.offers[0].cost;
    eq(g.PK.Game.buy(0), true, 'bought');
    eq(G.gold, 100 - cost, 'gold spent');
    eq(G.shop.offers[0].sold, true, 'marked sold');
  });

  it('buy() refuses an index that is not there', function () {
    const g = shopping('BUYBAD', 100);
    eq(g.PK.Game.buy(99), false, 'out of range');
    eq(g.PK.Game.buy(-1), false, 'negative');
    eq(g.PK.Game.G.gold, 100, 'no gold moved');
  });

  it('buy() refuses the same offer twice', function () {
    const g = shopping('BUYTWICE', 100);
    g.PK.Game.buy(0);
    const gold = g.PK.Game.G.gold;
    eq(g.PK.Game.buy(0), false, 'already sold');
    eq(g.PK.Game.G.gold, gold, 'no second charge');
  });

  it('buy() refuses what the player cannot afford', function () {
    const g = shopping('BROKE', 0);
    eq(g.PK.Game.buy(0), false, 'denied');
    eq(g.PK.Game.G.gold, 0, 'no debt');
    eq(g.PK.Game.G.shop.offers[0].sold, false, 'not marked sold');
  });

  it('a bought relic is held, a bought ball goes into the bag', function () {
    const g = shopping('KINDS', 500);
    const G = g.PK.Game.G;
    g.helpers.stockShop([
      { kind: 'relic', id: 'high_roller', cost: 1, sold: false, data: g.PK.RELIC_BY_ID.high_roller },
      { kind: 'ball', id: 'bomb', cost: 1, sold: false, data: g.PK.BALLS.bomb }
    ]);
    g.PK.Game.buy(0);
    g.PK.Game.buy(1);
    ok(g.PK.Game.hasRelic('high_roller'), 'relic held');
    ok(G.bag.indexOf('bomb') !== -1, 'ball in the bag');
  });

  it('Bigger Hands raises the hand size by one', function () {
    const g = shopping('HANDS', 500);
    const G = g.PK.Game.G;
    const before = G.handSizeBase;
    g.helpers.stockShop([{ kind: 'service', id: 'hand', cost: 1, sold: false, data: { name: 'Bigger Hands' } }]);
    g.PK.Game.buy(0);
    eq(G.handSizeBase, before + 1, 'hand grew');
  });

  it('Bag Trim removes a Standard first, not the cheapest ball', function () {
    /* Ranking by value ate Void (worth 0) and Lucky (worth 6) before it would
       touch a Standard worth 10, which is the opposite of what a trim is for. */
    const g = shopping('TRIM', 500);
    const G = g.PK.Game.G;
    G.bag = ['standard', 'voidball', 'lucky', 'heavy'];
    g.helpers.stockShop([{ kind: 'service', id: 'trim', cost: 1, sold: false, data: { name: 'Bag Trim' } }]);
    g.PK.Game.buy(0);
    deepEq(G.bag, ['voidball', 'lucky', 'heavy'], 'the Standard went');
  });

  it('Bag Trim falls back to the lowest-value ball when no Standard is left', function () {
    const g = shopping('TRIM2', 500);
    const G = g.PK.Game.G;
    G.bag = ['heavy', 'voidball', 'lucky', 'bouncy'];
    g.helpers.stockShop([{ kind: 'service', id: 'trim', cost: 1, sold: false, data: { name: 'Bag Trim' } }]);
    g.PK.Game.buy(0);
    eq(G.bag.indexOf('voidball'), -1, 'the worthless ball went');
    eq(G.bag.length, 3, 'exactly one removed');
  });

  it('Bag Trim never cuts the bag below three', function () {
    const g = shopping('TRIM3', 500);
    const G = g.PK.Game.G;
    G.bag = ['standard', 'standard', 'standard'];
    g.helpers.stockShop([{ kind: 'service', id: 'trim', cost: 1, sold: false, data: { name: 'Bag Trim' } }]);
    g.PK.Game.buy(0);
    eq(G.bag.length, 3, 'floor held');
  });

  it('Gilding turns a Standard into something else', function () {
    const g = shopping('GILD', 500);
    const G = g.PK.Game.G;
    G.meta.bestFloor = 9;                 // everything unlocked, so the pool is full
    G.bag = ['standard', 'heavy'];
    g.helpers.stockShop([{ kind: 'service', id: 'gild', cost: 1, sold: false, data: { name: 'Gilding' } }]);
    g.PK.Game.buy(0);
    eq(G.bag.length, 2, 'bag size unchanged');
    eq(G.bag.indexOf('standard'), -1, 'the Standard was upgraded');
  });

  it('the shop withholds an offer that could not do anything', function () {
    const g = shopping('WITHHOLD', 500);
    const G = g.PK.Game.G;
    G.handSizeBase = g.PK.Game.MAX_HAND;   // Bigger Hands would be 11 gold for nothing
    G.bag = ['standard', 'standard', 'standard'];   // Bag Trim cannot cut below three
    for (let i = 0; i < 40; i++) {
      g.PK.Game.G.gold = 500;
      g.PK.Game.reroll();
      G.shop.offers.forEach(function (o) {
        ok(!(o.kind === 'service' && o.id === 'hand'), 'Bigger Hands offered at the cap');
        ok(!(o.kind === 'service' && o.id === 'trim'), 'Bag Trim offered at the bag floor');
      });
    }
  });

  it('Juggling raises the volley by one, and can be bought again', function () {
    const g = shopping('JUGGLE', 500);
    const G = g.PK.Game.G;
    eq(g.PK.Game.inFlight(), 1, 'a run starts on one');
    // A fresh offer each time: buy() marks the one it sold, so reusing the
    // object would just be refused as already sold.
    const offer = function () {
      return { kind: 'service', id: 'juggle', cost: 5, sold: false, data: { name: 'Juggling' } };
    };
    g.helpers.stockShop([offer()]);
    eq(g.PK.Game.buy(0), true, 'bought');
    eq(g.PK.Game.inFlight(), 2, 'two at a time');
    g.helpers.stockShop([offer()]);
    eq(g.PK.Game.buy(0), true, 'bought again');
    eq(g.PK.Game.inFlight(), 3, 'three at a time — it stacks');
  });

  it('Juggling is cheap, and offered often enough to build around', function () {
    /* Both halves matter. It has to be an easy first yes — a floor pays 4-8
       gold — and it has to actually turn up: at the flat service weight it
       appeared in 8% of shops, which left 79% of runs never seeing a second
       ball at all. The threshold here is deliberately far below the measured
       rate (~28% of shops) so it fails on a real regression, not on variance. */
    const g = shopping('JUGGLERATE', 500);
    const G = g.PK.Game.G;
    let shops = 0, seen = 0, cost = null;
    for (let i = 0; i < 200; i++) {
      G.gold = 500;
      g.PK.Game.reroll();
      shops++;
      const o = G.shop.offers.find(function (x) { return x.id === 'juggle'; });
      if (o) { seen++; cost = o.cost; }
    }
    ok(seen > 20, 'Juggling appeared in only ' + seen + ' of ' + shops + ' shops');
    ok(cost <= 6, 'Juggling costs ' + cost + ', which is not cheap');
  });

  it('a service can declare its own shop weight', function () {
    const g = fresh();
    eq(typeof g.PK.Game.SERVICES.juggle.weight, 'number', 'Juggling declares one');
    ok(g.PK.Game.SERVICES.juggle.weight > 1.5, 'and it beats the 1.5 default');
    eq(g.PK.Game.SERVICES.trim.weight, undefined, 'the others still take the default');
  });

  it('the shop stops offering Juggling at the ceiling', function () {
    const g = shopping('JUGGLECAP', 500);
    const G = g.PK.Game.G;
    G.inFlightBase = g.PK.Game.MAX_IN_FLIGHT;
    for (let i = 0; i < 60; i++) {
      G.gold = 500;
      g.PK.Game.reroll();
      G.shop.offers.forEach(function (o) {
        ok(!(o.kind === 'service' && o.id === 'juggle'),
          'Juggling offered at the ceiling — the gold would be wasted');
      });
    }
  });

  it('reroll costs gold and gets steadily more expensive', function () {
    const g = shopping('REROLL', 100);
    const G = g.PK.Game.G;
    g.PK.Game.reroll();
    eq(G.gold, 98, 'first reroll cost 2');
    eq(G.shop.rerollCost, 3, 'price rose');
    g.PK.Game.reroll();
    eq(G.gold, 95, 'second reroll cost 3');
    eq(G.shop.rerollCost, 4, 'price rose again');
  });

  it('reroll is refused when it cannot be paid for', function () {
    const g = shopping('NOREROLL', 1);
    const G = g.PK.Game.G;
    const offers = G.shop.offers.slice();
    g.PK.Game.reroll();
    eq(G.gold, 1, 'no gold moved');
    deepEq(G.shop.offers, offers, 'offers untouched');
  });

  it('a relic already held is never offered again', function () {
    const g = shopping('DUPE', 500);
    const G = g.PK.Game.G;
    G.relics = g.PK.RELICS.map(function (r) { return r.id; });   // hold everything
    for (let i = 0; i < 30; i++) {
      G.gold = 500;
      g.PK.Game.reroll();
      G.shop.offers.forEach(function (o) {
        ok(o.kind !== 'relic', 'offered a relic already held: ' + o.id);
      });
    }
  });
});

/* ============================================================
   Relics that reshape the board.

   Two capabilities the hook surface gained: a relic may add peg
   rows (only modifiers could), and a relic may require another
   relic before the shop will offer it.
   ============================================================ */
describe('board-shaping relics', function () {
  const g0 = fresh();
  /** Start a run holding `ids`, so the first floor is built with them. */
  function runWith(seed, ids) {
    const g = fresh();
    g.PK.Game.newRun(seed);
    const G = g.PK.Game.G;
    G.relics = ids.slice();
    // Rebuild floor 1 now that the relics are held.
    G.floor = 0;
    g.PK.Game.leaveShop();
    return g;
  }

  it('a relic with extraRows actually deepens the board', function () {
    const plain = runWith('ROWS', []);
    const deep = runWith('ROWS', ['the_deep']);
    const a = plain.PK.Game.G.board, b = deep.PK.Game.G.board;
    eq(b.rows, a.rows + 1, 'one more row');
    ok(b.pegs.length > a.pegs.length, 'and more pegs: ' + a.pegs.length + ' -> ' + b.pegs.length);
  });

  it('a relic and a modifier both adding rows stack', function () {
    /* Driven through real floors rather than by assigning G.modifier, because
       startFloor() calls pickModifier() itself and would overwrite it. Play
       on until Dense Forest (+2 rows) actually comes up while The Deep (+1) is
       held, then check the board got both. */
    const dense = g0.PK.MODIFIERS.find(function (m) { return m.id === 'dense'; });
    ok(dense && dense.extraRows === 2, 'Dense Forest is still the +2 modifier');

    let found = null;
    for (let s = 0; s < 40 && !found; s++) {
      const g = runWith('ROWSTACK' + s, ['the_deep']);
      const G = g.PK.Game.G;
      for (let f = 0; f < 10; f++) {
        if (G.modifier && G.modifier.id === 'dense') { found = G; break; }
        G.target = 1;
        g.helpers.drop(310);
        g.PK.Game.cashOut();
        g.PK.Game.leaveShop();
      }
    }
    ok(found, 'Dense Forest never came up in 40 seeds — stacking is untested');
    // 11 base + 1 from The Deep + 2 from Dense Forest.
    eq(found.board.rows, 14, 'the modifier and the relic both counted');
  });

  it('The Deep voids exactly one slot, and never an outer one', function () {
    for (let i = 0; i < 25; i++) {
      const g = runWith('VOID' + i, ['the_deep']);
      const slots = g.PK.Game.G.board.slots;
      const voided = slots.filter(function (s) { return s.voided; });
      eq(voided.length, 1, 'seed ' + i + ': one void');
      eq(voided[0].mult, 0, 'a void pays nothing');
      const idx = slots.indexOf(voided[0]);
      ok(idx > 0 && idx < slots.length - 1, 'seed ' + i + ': voided an outer slot (' + idx + ')');
    }
  });

  it('holding The Deep does not stop a floor being cleared', function () {
    const g = runWith('DEEPPLAY', ['the_deep']);
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    eq(G.screen, 'shop', 'the floor resolved normally');
  });
});

describe('relic prerequisites', function () {
  function shopping(seed, relics, gold) {
    const g = fresh();
    g.PK.Game.newRun(seed);
    const G = g.PK.Game.G;
    G.relics = (relics || []).slice();
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    G.gold = gold === undefined ? 500 : gold;
    return g;
  }

  /** Every relic id the shop will offer across many rerolls. */
  function offerable(g, tries) {
    const seen = {};
    const G = g.PK.Game.G;
    for (let i = 0; i < (tries || 60); i++) {
      G.gold = 500;
      g.PK.Game.reroll();
      G.shop.offers.forEach(function (o) { if (o.kind === 'relic') seen[o.id] = true; });
    }
    return seen;
  }

  it('an upgrade is never offered without the relic it upgrades', function () {
    const g = shopping('PREREQ', []);
    const seen = offerable(g);
    eq(seen.mother_lode, undefined, 'Mother Lode offered without Gold Rush');
    eq(seen.overload, undefined, 'Overload offered without Live Wire');
  });

  it('it becomes offerable once the base relic is held', function () {
    const g = shopping('PREREQ2', ['gold_rush']);
    const seen = offerable(g, 120);
    ok(seen.mother_lode, 'Mother Lode never appeared despite holding Gold Rush');
    eq(seen.overload, undefined, 'Overload still needs Live Wire');
  });

  it('a relic with no prerequisite is unaffected', function () {
    const g = shopping('PREREQ3', []);
    const seen = offerable(g, 120);
    ok(Object.keys(seen).length > 5, 'the pool is still full: ' + Object.keys(seen).length);
    ok(seen.the_deep, 'The Deep has no prerequisite and should appear');
  });

  it('every `requires` names a relic that exists', function () {
    const g = fresh();
    g.PK.RELICS.forEach(function (r) {
      if (!r.requires) return;
      ok(g.PK.RELIC_BY_ID[r.requires],
        r.id + ' requires a relic that does not exist: ' + r.requires);
      ok(r.requires !== r.id, r.id + ' requires itself');
    });
  });

  it('no prerequisite chain can deadlock a relic out of the pool', function () {
    // Every requirement must itself be reachable: no cycles, no orphans.
    const g = fresh();
    g.PK.RELICS.forEach(function (r) {
      const seen = {};
      let cur = r;
      while (cur && cur.requires) {
        ok(!seen[cur.id], 'cycle through ' + cur.id);
        seen[cur.id] = true;
        cur = g.PK.RELIC_BY_ID[cur.requires];
      }
    });
  });
});

/* ============================================================
   Holding an offer over.

   The answer to seeing something strong two gold short: keep
   it rather than gamble the reroll and lose it.
   ============================================================ */
describe('shop: holding an offer', function () {
  /** Park a run in the shop with gold. */
  function shop(seed, gold) {
    const g = run(seed || 'LOCK');
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    G.gold = gold === undefined ? 500 : gold;
    return g;
  }
  const ids = function (g) { return g.PK.Game.G.shop.offers.map(function (o) { return o.id; }); };

  it('toggles on and off, and reports which it did', function () {
    const g = shop('LOCK1');
    eq(g.PK.Game.toggleLock(0), true, 'held');
    eq(g.PK.Game.G.shop.offers[0].locked, true);
    eq(g.PK.Game.toggleLock(0), false, 'released');
    eq(g.PK.Game.G.shop.offers[0].locked, false);
  });

  it('refuses an index that is not there, and a sold card', function () {
    const g = shop('LOCK2');
    eq(g.PK.Game.toggleLock(99), false, 'out of range');
    eq(g.PK.Game.toggleLock(-1), false, 'negative');
    g.PK.Game.buy(0);
    eq(g.PK.Game.toggleLock(0), false, 'nothing to hold on a sold card');
  });

  it('a held offer survives a reroll while the rest change', function () {
    const g = shop('LOCK3');
    const G = g.PK.Game.G;
    const held = G.shop.offers[0].id;
    g.PK.Game.toggleLock(0);
    let moved = 0;
    for (let i = 0; i < 12; i++) {
      const before = ids(g).slice(1);
      G.gold = 500;
      g.PK.Game.reroll();
      eq(G.shop.offers.length, 3, 'still three offers');
      eq(G.shop.offers[0].id, held, 'the held one is still there');
      eq(G.shop.offers[0].locked, true, 'and still held');
      if (JSON.stringify(ids(g).slice(1)) !== JSON.stringify(before)) moved++;
    }
    ok(moved > 0, 'the other two never changed across 12 rerolls');
  });

  it('a reroll never deals a second copy of what is held', function () {
    const g = shop('LOCK4');
    const G = g.PK.Game.G;
    const held = G.shop.offers[0].id;
    g.PK.Game.toggleLock(0);
    for (let i = 0; i < 40; i++) {
      G.gold = 500;
      g.PK.Game.reroll();
      const copies = ids(g).filter(function (id) { return id === held; }).length;
      eq(copies, 1, 'dealt ' + copies + ' copies of ' + held);
    }
  });

  it('a held offer comes with you to the next shop', function () {
    const g = shop('LOCK5');
    const G = g.PK.Game.G;
    const held = G.shop.offers[0].id;
    const loose = G.shop.offers[1].id;
    g.PK.Game.toggleLock(0);
    g.PK.Game.leaveShop();
    deepEq(G.locked.map(function (o) { return o.id; }), [held], 'carried on the run');

    // Clear the next floor to reach the next shop.
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    eq(G.screen, 'shop', 'back in a shop');
    ok(ids(g).indexOf(held) !== -1, 'the held offer is on the counter again');
    eq(G.shop.offers.find(function (o) { return o.id === held; }).locked, true, 'still held');
    eq(G.shop.offers.length, 3, 'and the shop is still full');
  });

  it('an offer left unheld does not come back', function () {
    // Not a guarantee about any single id — a loose offer may be re-rolled by
    // chance — so this checks the bookkeeping rather than the dice.
    const g = shop('LOCK6');
    g.PK.Game.leaveShop();
    deepEq(g.PK.Game.G.locked, [], 'nothing was carried');
  });

  it('buying what you held means there is nothing left to carry', function () {
    const g = shop('LOCK7');
    const G = g.PK.Game.G;
    g.PK.Game.toggleLock(0);
    eq(g.PK.Game.buy(0), true, 'bought it');
    g.PK.Game.leaveShop();
    deepEq(G.locked, [], 'a sold card is not carried');
  });

  it('every offer can be held, which freezes the shop', function () {
    const g = shop('LOCK8');
    const G = g.PK.Game.G;
    const before = ids(g);
    for (let i = 0; i < 3; i++) g.PK.Game.toggleLock(i);
    G.gold = 500;
    g.PK.Game.reroll();
    deepEq(ids(g), before, 'a full hold leaves nothing to re-roll');
  });

  it('a held offer the shop would no longer stock is dropped', function () {
    /* Bag Trim refuses to cut below three balls. Holding one while the bag
       shrinks must not smuggle it back past that rule. */
    const g = shop('LOCK9');
    const G = g.PK.Game.G;
    g.helpers.stockShop([
      { kind: 'service', id: 'trim', cost: 4, sold: false, locked: true, data: { name: 'Bag Trim' } }
    ]);
    g.PK.Game.leaveShop();
    deepEq(G.locked.map(function (o) { return o.id; }), ['trim'], 'carried');
    G.bag = ['standard', 'standard', 'standard'];      // now at the floor
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    eq(ids(g).indexOf('trim'), -1, 'Bag Trim came back despite being unstockable');
    eq(G.shop.offers.length, 3, 'and the slot was refilled');
  });

  it('a hold survives closing the tab', function () {
    const g = shop('LOCKSAVE');
    const G = g.PK.Game.G;
    const held = G.shop.offers[1].id;
    g.PK.Game.toggleLock(1);

    const g2 = fresh({ storage: g.localStorage._store });
    eq(g2.PK.Game.resumeRun(), true, 'resumed');
    const R = g2.PK.Game.G;
    eq(R.screen, 'shop', 'back in the shop');
    eq(R.shop.offers[1].id, held, 'same offer');
    eq(R.shop.offers[1].locked, true, 'still held');
  });

  it('a run saved before holding existed resumes with nothing held', function () {
    const g = shop('LOCKOLD');
    g.PK.Game.toggleLock(0);
    g.PK.Game.persist();
    const store = g.localStorage._store;
    const saved = JSON.parse(store['pegfall.run.v1']);
    delete saved.locked;
    saved.shop.offers.forEach(function (o) { delete o.locked; });
    store['pegfall.run.v1'] = JSON.stringify(saved);

    const g2 = fresh({ storage: store });
    eq(g2.PK.Game.resumeRun(), true, 'still resumable');
    deepEq(g2.PK.Game.G.locked, [], 'nothing held');
    eq(g2.PK.Game.G.shop.offers[0].locked, false, 'and no card claims to be');
  });

  it('a new run starts with nothing held over from the last', function () {
    const g = shop('LOCKRESET');
    g.PK.Game.toggleLock(0);
    g.PK.Game.leaveShop();
    ok(g.PK.Game.G.locked.length, 'something was held');
    g.PK.Game.newRun('LOCKRESET2');
    deepEq(g.PK.Game.G.locked, [], 'a fresh run starts clean');
  });
});

/* ============================================================
   Persistence.

   Two keys, deliberately: a corrupt run must never take the meta
   progression down with it.
   ============================================================ */
describe('save: meta', function () {
  it('returns defaults when there is nothing stored', function () {
    const m = fresh().helpers.meta();
    eq(m.bestFloor, 0); eq(m.runs, 0); eq(m.bestScore, 0); eq(m.totalScore, 0);
  });

  it('round-trips', function () {
    const g = fresh();
    g.PK.Save.save({ bestFloor: 7, runs: 3, bestScore: 900, totalScore: 4000, deepestSeed: 'ABC' });
    const m = g.helpers.meta();
    eq(m.bestFloor, 7); eq(m.runs, 3); eq(m.bestScore, 900); eq(m.deepestSeed, 'ABC');
  });

  it('survives a corrupted blob', function () {
    const g = fresh({ storage: { 'pegfall.meta.v1': 'not json' } });
    const m = g.helpers.meta();
    eq(m.bestFloor, 0, 'fell back to a blank profile');
    eq(m.runs, 0);
  });

  it('fills in fields a older save did not have', function () {
    const g = fresh({ storage: { 'pegfall.meta.v1': JSON.stringify({ bestFloor: 4 }) } });
    const m = g.helpers.meta();
    eq(m.bestFloor, 4, 'kept what was there');
    eq(m.totalScore, 0, 'defaulted what was not');
    eq(m.runs, 0);
  });

  it('records the best floor and best score when a floor is banked', function () {
    const g = run('BEST');
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    const m = g.helpers.meta();
    eq(m.bestFloor, 1, 'floor 1 banked');
    eq(m.bestScore, G.score === 0 ? 0 : m.bestScore, 'best score recorded');
    ok(m.bestScore > 0, 'best score is real');
  });
});

describe('save: unlocks', function () {
  function balls(bestFloor) {
    const g = fresh();
    return g.PK.Save.unlockedBalls({ bestFloor: bestFloor });
  }

  it('starts with the five base balls', function () {
    deepEq(balls(0).sort(), ['bouncy', 'heavy', 'lucky', 'splitter', 'standard']);
  });

  it('unlocks on the documented floors', function () {
    ok(balls(2).indexOf('bomb') === -1, 'bomb is not free');
    ok(balls(3).indexOf('bomb') !== -1, 'bomb at floor 3');
    ok(balls(5).indexOf('ghost') !== -1, 'ghost at floor 5');
    ok(balls(7).indexOf('magnet') !== -1, 'magnet at floor 7');
    ok(balls(9).indexOf('voidball') !== -1, 'voidball at floor 9');
  });

  it('every unlockable ball id exists in the content table', function () {
    const g = fresh();
    g.PK.Save.UNLOCKS.forEach(function (u) {
      ok(g.PK.BALLS[u.ball], 'no such ball: ' + u.ball);
    });
    balls(9).forEach(function (id) { ok(g.PK.BALLS[id], 'no such ball: ' + id); });
  });

  it('nextUnlock() points at the next one, and nothing at the end', function () {
    const g = fresh();
    eq(g.PK.Save.nextUnlock({ bestFloor: 0 }).ball, 'bomb');
    eq(g.PK.Save.nextUnlock({ bestFloor: 3 }).ball, 'ghost');
    eq(g.PK.Save.nextUnlock({ bestFloor: 99 }), null, 'all unlocked');
  });
});

describe('save: the resumable run', function () {
  it('a fresh install has no run to resume', function () {
    const g = fresh();
    eq(g.PK.Game.hasSave(), false);
    eq(g.PK.Game.resumeRun(), false, 'nothing to resume');
  });

  it('a started run is on disk, and gameOver clears it', function () {
    const g = run('RESUME');
    ok(g.PK.Game.hasSave(), 'saved at the first still moment');
    g.PK.Game.G.target = 1e9;
    g.helpers.playFloor(310);
    eq(g.PK.Game.G.screen, 'gameover');
    eq(g.PK.Game.hasSave(), false, 'cleared on game over');
  });

  it('resumes a mid-floor run with its score, hand and board intact', function () {
    const g = run('MIDRUN');
    const G = g.PK.Game.G;
    g.helpers.drop(310);
    g.helpers.drop(250);
    const snap = {
      score: G.score, hand: G.hand.slice(), gold: G.gold, floor: G.floor,
      target: G.target, dropIndex: G.dropIndex, pegs: G.board.pegs.length
    };

    // A second browser session: same storage, fresh game objects.
    const g2 = fresh({ storage: g.localStorage._store });
    eq(g2.PK.Game.hasSave(), true, 'the run is there');
    eq(g2.PK.Game.resumeRun(), true, 'resumed');
    const R = g2.PK.Game.G;
    eq(R.score, snap.score, 'score');
    deepEq(R.hand, snap.hand, 'hand');
    eq(R.gold, snap.gold, 'gold');
    eq(R.floor, snap.floor, 'floor');
    eq(R.target, snap.target, 'target');
    eq(R.dropIndex, snap.dropIndex, 'drop index');
    eq(R.board.pegs.length, snap.pegs, 'the board came back whole');
    eq(R.balls.length, 0, 'nothing in flight');
  });

  it('a resumed run continues the RNG rather than replaying it', function () {
    const g = run('RNGRESUME');
    g.helpers.drop(310);
    const stateOnDisk = g.helpers.savedRun().rngState;
    const g2 = fresh({ storage: g.localStorage._store });
    g2.PK.Game.resumeRun();
    eq(g2.PK.Game.G.rng.state, stateOnDisk, 'stream position restored');
    // And it keeps going from there rather than from the seed.
    eq(g2.PK.Game.G.rng.next(), g.PK.Game.G.rng.next(), 'next draw matches');
  });

  it('resuming into the shop restores the offers from their ids', function () {
    const g = run('SHOPRESUME');
    const G = g.PK.Game.G;
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    const ids = G.shop.offers.map(function (o) { return o.id; });

    const g2 = fresh({ storage: g.localStorage._store });
    g2.PK.Game.resumeRun();
    const R = g2.PK.Game.G;
    eq(R.screen, 'shop', 'back in the shop');
    deepEq(R.shop.offers.map(function (o) { return o.id; }), ids, 'same offers');
    R.shop.offers.forEach(function (o) {
      ok(o.data, 'offer ' + o.id + ' got its display data back');
    });
    eq(g2.bus.screen, 'shop', 'the shop screen was shown');
  });

  it('a bought volley survives a resume', function () {
    const g = run('JUGGLESAVE');
    const G = g.PK.Game.G;
    G.inFlightBase = 4;
    g.PK.Game.persist();
    eq(g.helpers.savedRun().inFlightBase, 4, 'written to disk');

    const g2 = fresh({ storage: g.localStorage._store });
    eq(g2.PK.Game.resumeRun(), true, 'resumed');
    eq(g2.PK.Game.G.inFlightBase, 4, 'and the run can still throw four');
  });

  it('a run saved before Juggling existed resumes on one ball', function () {
    /* The field was added without bumping RUN_VERSION, so older saves stay
       playable — they simply come back the way they were being played. */
    const g = run('OLDSAVE');
    g.PK.Game.G.inFlightBase = 5;
    g.PK.Game.persist();
    const store = g.localStorage._store;
    const saved = JSON.parse(store['pegfall.run.v1']);
    delete saved.inFlightBase;                      // as an older build wrote it
    store['pegfall.run.v1'] = JSON.stringify(saved);

    const g2 = fresh({ storage: store });
    eq(g2.PK.Game.resumeRun(), true, 'still resumable');
    eq(g2.PK.Game.G.inFlightBase, g2.PK.Game.BASE_IN_FLIGHT, 'back to one');
    eq(g2.PK.Game.inFlight(), 1);
  });

  it('a run saved by an older build is dropped, not half-restored', function () {
    const g = fresh({ storage: { 'pegfall.run.v1': JSON.stringify({ v: 0, seed: 'OLD', floor: 4 }) } });
    eq(g.PK.Save.loadRun(), null, 'version mismatch rejected');
    eq(g.PK.Game.hasSave(), false);
    eq(g.PK.Game.resumeRun(), false, 'refused to resume');
  });

  it('a corrupt run does not take the meta progression with it', function () {
    const g = fresh({
      storage: {
        'pegfall.run.v1': '{{{ not json',
        'pegfall.meta.v1': JSON.stringify({ bestFloor: 12, runs: 40 })
      }
    });
    eq(g.PK.Game.hasSave(), false, 'the run is gone');
    eq(g.helpers.meta().bestFloor, 12, 'the profile survived');
    eq(g.helpers.meta().runs, 40);
  });

  it('a run is never snapshotted with a ball in flight', function () {
    const g = run('INFLIGHTSAVE');
    g.PK.Game.dropBall(310);
    g.PK.Game.persist();
    const saved = g.helpers.savedRun();
    ok(saved, 'something was saved');
    ok(saved.balls === undefined, 'balls are not part of a snapshot');
  });

  it('a volley interrupted mid-flight costs the player nothing', function () {
    /* The hand is decremented the moment a ball is dropped, so saving while
       others are still falling would store a hand short of balls that never
       landed — closing the tab there would simply eat them. The save waits for
       the board to be still, so an interrupted volley rewinds to before it. */
    const g = run('VOLLEYSAVE');
    const G = g.PK.Game.G;
    G.inFlightBase = 3;
    const cap = 3;

    g.helpers.drop(310);                       // one clean drop, so a save exists
    const onDisk = g.helpers.savedRun();
    eq(onDisk.hand.length, G.hand.length, 'saved state matches the table');

    for (let i = 0; i < cap; i++) g.PK.Game.dropBall(240 + i * 40);
    eq(G.hand.length, onDisk.hand.length - cap, 'the hand paid for the volley');

    // One lands, the rest are still falling: nothing may be written yet.
    let guard = 0;
    while (G.balls.length === cap && guard++ < 4000) g.PK.Game.update(1 / 120);
    ok(G.balls.length < cap, 'at least one landed');
    if (G.balls.length > 0) {
      deepEq(g.helpers.savedRun().hand, onDisk.hand,
        'saved mid-volley — those balls would be lost');
    }

    g.helpers.settle();
    eq(G.balls.length, 0, 'board still');
    deepEq(g.helpers.savedRun().hand, G.hand, 'saved once everything came to rest');
  });

  it('no run is written once the run is over', function () {
    const g = run('OVERSAVE');
    g.PK.Save.clearRun();
    g.PK.Game.G.screen = 'gameover';
    g.PK.Game.persist();
    eq(g.PK.Game.hasSave(), false, 'a finished run must not be resumable');
  });
});

/* ============================================================
   Settings — kept apart from run state so they survive a dead run.
   ============================================================ */
describe('settings', function () {
  it('defaults when nothing is stored', function () {
    const g = fresh();
    eq(g.PK.Settings.sfx, true);
    eq(g.PK.Settings.volume, 0.6);
  });

  it('round-trips through storage', function () {
    const g = fresh();
    g.PK.setSetting('volume', 0.2);
    const g2 = fresh({ storage: g.localStorage._store });
    eq(g2.PK.Settings.volume, 0.2, 'kept');
  });

  it('ignores keys it does not know', function () {
    const g = fresh({ storage: { 'pegfall.settings.v1': JSON.stringify({ sfx: false, nonsense: 1 }) } });
    eq(g.PK.Settings.sfx, false, 'known key applied');
    eq(g.PK.Settings.nonsense, undefined, 'unknown key ignored');
  });

  it('survives a corrupted blob', function () {
    const g = fresh({ storage: { 'pegfall.settings.v1': 'not json' } });
    eq(g.PK.Settings.sfx, true, 'defaults');
  });

  it('a ball can be played before the audio context has ever been opened', function () {
    /* Sound is gated on a user gesture, so every voice has to be a no-op until
       one arrives. Node never opens a context at all, which is the same path. */
    const g = run('AUDIO');
    g.helpers.drop(310);      // drop(), peg(), land() all fire under here
    ok(g.PK.Game.G.stats.dropped === 1, 'the drop went through');
  });

  it('audio stands itself down when there is no AudioContext to open', function () {
    const g = run('AUDIO2');
    eq(g.PK.Sfx.available, true, 'nothing has been tried yet');
    g.PK.Sfx.resume();        // what the first pointerdown does in main.js
    eq(g.PK.Sfx.available, false, 'gave up after failing to open a context');
    g.helpers.drop(310);      // and keeps playing regardless
    eq(g.PK.Game.G.stats.dropped, 1, 'the game is unaffected');
  });
});

/* ============================================================
   The arcade seam.

   PEGFALL reads exactly two things from the shared layer, and both
   must be dormant when it is absent.
   ============================================================ */
describe('arcade integration', function () {
  it('plays a whole floor with no arcade layer present', function () {
    const g = run('NOARCADE');
    eq(g.Arcade, undefined, 'no arcade in this sandbox');
    g.PK.Game.G.target = 1e9;
    g.helpers.playFloor(310);
    eq(g.PK.Game.G.screen, 'gameover', 'the run still finished');
  });

  it('an inactive unlock grants nothing', function () {
    const g = fresh({ arcade: true });
    g.Arcade.progress.grant('pegfall', 500);
    g.Arcade.progress.buy('pegfall', 'deep_pockets');
    g.Arcade.progress.setActive('pegfall', 'deep_pockets', false);
    g.PK.Game.newRun('OFF');
    eq(g.PK.Game.G.gold, 6, 'owned but switched off changes nothing');
  });

  it('an active unlock reaches the game', function () {
    const g = fresh({ arcade: true });
    g.Arcade.progress.grant('pegfall', 500);
    g.Arcade.progress.buy('pegfall', 'deep_pockets');
    g.PK.Game.newRun('ON');
    eq(g.PK.Game.G.gold, 10, '6 + the 4 from Deep Pockets');
  });

  it('a purchased ball joins the shop pool without waiting for its floor', function () {
    const g = fresh({ arcade: true });
    eq(g.PK.Save.unlockedBalls({ bestFloor: 0 }).indexOf('bomb'), -1, 'locked to start');
    g.Arcade.progress.grant('pegfall', 500);
    g.Arcade.progress.buy('pegfall', 'ball_bomb');
    ok(g.PK.Save.unlockedBalls({ bestFloor: 0 }).indexOf('bomb') !== -1, 'unlocked by purchase');
  });

  it('every ball the catalogue sells actually exists in the game', function () {
    /* The catalogue names ball ids as effect tags ('ball:voidball'); a typo
       there sells a player something the shop can never stock. */
    const g = fresh({ arcade: true });
    const prog = g.Arcade.progression.pegfall;
    prog.unlocks.forEach(function (u) {
      const bits = String(u.effect).split(':');
      if (bits[0] !== 'ball') return;
      ok(g.PK.BALLS[bits[1]], u.id + ' sells a ball that does not exist: ' + bits[1]);
    });
  });

  it('a finished run posts its score exactly once', function () {
    const g = fresh({ arcade: true });
    g.PK.Game.newRun('POST');
    const G = g.PK.Game.G;
    G.target = 1e9;
    g.helpers.playFloor(310);
    eq(G.screen, 'gameover');
    eq(g.bus.submitted.length, 1, 'one submission');
    eq(g.bus.recorded.length, 1, 'one progression record');
    const sub = g.bus.submitted[0];
    eq(sub.gameId, 'pegfall', 'game id');
    eq(sub.payload.score, G.stats.runTotal, 'the run total, not the floor score');
    eq(sub.payload.meta.floor, G.floor, 'floor rides along in meta');
    eq(sub.payload.meta.seed, G.seed, 'seed rides along');
  });

  it('the posted run total spans every floor, not just the last', function () {
    const g = fresh({ arcade: true });
    g.PK.Game.newRun('TOTAL');
    const G = g.PK.Game.G;
    // Bank one floor, then die on the next.
    G.target = 1;
    g.helpers.drop(310);
    g.PK.Game.cashOut();
    const banked = G.stats.runTotal;
    ok(banked > 0, 'floor 1 banked ' + banked);
    g.PK.Game.leaveShop();
    G.target = 1e9;
    g.helpers.playFloor(310);
    eq(G.screen, 'gameover');
    ok(g.bus.submitted[0].payload.score >= banked, 'the total kept floor 1');
  });
});

/* ---------- report ---------- */
const totalTests = passed + failures.length;
if (failures.length) {
  console.log('\n' + failures.length + ' of ' + totalTests + ' tests FAILED\n');
  failures.forEach(function (f) {
    console.log('  x [' + f.group + '] ' + f.name);
    console.log('      ' + f.err);
  });
  console.log('');
  process.exit(1);
} else {
  console.log('\nall ' + totalTests + ' tests passed\n');
}
