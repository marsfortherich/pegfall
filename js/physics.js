/* Ball simulation: gravity, walls, peg collisions. */
(function (PK) {
  'use strict';

  var GRAVITY = 1500;
  var MAX_SPEED = 1150;
  var SUBSTEPS = 4;

  function makeBall(def, x, y, rng) {
    return {
      def: def,
      x: x, y: y,
      vx: rng.float(-30, 30), vy: 30,
      radius: def.radius,
      restitution: def.restitution,
      mass: def.mass,
      value: def.value,
      pegHits: 0,
      ghostLeft: def.ghostPegs || 0,
      slotBonus: 0,
      dropIndex: 0,
      isCopy: false,
      hasSplit: false,
      landed: false,
      lastPeg: -1,
      lastPegT: 0,
      age: 0,
      trail: []
    };
  }

  /**
   * Advance one ball. `api` provides: onPegHit(ball, peg), onLand(ball), rng, board.
   */
  function step(ball, board, dt, api) {
    var sub = dt / SUBSTEPS;
    for (var s = 0; s < SUBSTEPS && !ball.landed; s++) {
      integrate(ball, board, sub, api);
    }
    ball.age += dt;
    ball.trail.push(ball.x, ball.y);
    if (ball.trail.length > 26) ball.trail.splice(0, 2);
  }

  function integrate(ball, board, dt, api) {
    var g = GRAVITY * (board.gravityMul || 1);
    ball.vy += g * dt;

    if (ball.def.magnet) {
      var target = api.magnetTarget();
      if (target !== null) {
        var dir = target - ball.x;
        var f = Math.max(-1, Math.min(1, dir / 120));
        ball.vx += f * ball.def.magnet * dt;
      }
    }

    ball.vx *= (1 - 0.25 * dt);       // light air drag keeps things readable
    var sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
      ball.vx *= MAX_SPEED / sp;
      ball.vy *= MAX_SPEED / sp;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Walls
    var l = (board.wallLeft || 0) + ball.radius;
    var r = (board.wallRight || board.width) - ball.radius;
    if (ball.x < l) { ball.x = l; ball.vx = Math.abs(ball.vx) * 0.55; }
    if (ball.x > r) { ball.x = r; ball.vx = -Math.abs(ball.vx) * 0.55; }

    // Pegs
    var pegs = board.pegs;
    for (var i = 0; i < pegs.length; i++) {
      var p = pegs[i];
      if (p.dead) continue;
      var def = PK.PEGS[p.type] || PK.PEGS.normal;
      var pr = def.radius;
      var dx = ball.x - p.x, dy = ball.y - p.y;
      var d2 = dx * dx + dy * dy;
      var minD = ball.radius + pr;
      if (d2 >= minD * minD) continue;

      if (ball.ghostLeft > 0) {
        if (ball.lastPeg !== p.id) { ball.ghostLeft--; ball.lastPeg = p.id; }
        continue;
      }

      var d = Math.sqrt(d2) || 0.0001;
      var nx = dx / d, ny = dy / d;
      ball.x = p.x + nx * minD;
      ball.y = p.y + ny * minD;

      var vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        var e = (ball.restitution + (board.restitutionBonus || 0)) * (def.bounce || 1);
        e = e / Math.pow(ball.mass, 0.4);
        e = Math.max(0.12, Math.min(1.25, e));
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        // A nudge along the tangent so balls never balance perfectly on a peg.
        var jitter = api.rng.float(-1, 1) * 55;
        ball.vx += -ny * jitter * 0.5;
        ball.vy += nx * jitter * 0.15;
        if (def.bounce) ball.vy -= 90;

        var fresh = (p.id !== ball.lastPeg) || (ball.age - ball.lastPegT > 0.12);
        ball.lastPeg = p.id;
        ball.lastPegT = ball.age;
        if (fresh) api.onPegHit(ball, p, def);
      }
    }

    if (ball.y > board.slotTop + 12) {
      ball.landed = true;
      api.onLand(ball);
    }
  }

  PK.Physics = { makeBall: makeBall, step: step, GRAVITY: GRAVITY };
})(window.PK = window.PK || {});
