/* Bootstrap: canvas sizing, input, game loop. */
(function (PK) {
  'use strict';

  var canvas, ctx, G;

  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = PK.Board.W * dpr;
    canvas.height = PK.Board.H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function boardX(clientX) {
    var r = canvas.getBoundingClientRect();
    return (clientX - r.left) * (PK.Board.W / r.width);
  }

  function boardY(clientY) {
    var r = canvas.getBoundingClientRect();
    return (clientY - r.top) * (PK.Board.H / r.height);
  }

  function bindInput() {
    canvas.addEventListener('mousemove', function (e) {
      G.aimX = boardX(e.clientX);
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      G.aimX = boardX(e.clientX);
      PK.Game.dropBall(G.aimX);
    });
    canvas.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      G.aimX = boardX(t.clientX);
      PK.Game.dropBall(G.aimX);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      G.aimX = boardX(e.changedTouches[0].clientX);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.key === ' ') {
        e.preventDefault();
        PK.Game.dropBall(G.aimX);
      } else if (e.key === 'Enter') {
        PK.Game.cashOut();
      } else if (e.key === 'ArrowLeft') {
        G.aimX = Math.max(0, G.aimX - (e.shiftKey ? 2 : 14));
      } else if (e.key === 'ArrowRight') {
        G.aimX = Math.min(PK.Board.W, G.aimX + (e.shiftKey ? 2 : 14));
      }
    });

    window.addEventListener('resize', fitCanvas);
  }

  function start() {
    // Shared account + leaderboard layer. Checks the auth state up front so
    // the HUD knows who is playing before the first ball drops.
    if (window.Arcade) window.Arcade.init({ gameId: 'pegfall' });

    // Browsers refuse to start an AudioContext before a gesture, and they
    // suspend it again whenever the tab loses focus, so this is not `once`.
    window.addEventListener('pointerdown', PK.Sfx.resume);
    window.addEventListener('keydown', PK.Sfx.resume);

    canvas = document.getElementById('board');
    ctx = canvas.getContext('2d');
    G = PK.Game.G;
    fitCanvas();
    PK.UI.init(PK.Game);
    bindInput();

    var last = performance.now(), acc = 0, t = 0;
    var STEP = 1 / 120;

    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      t += dt;
      var guard = 0;
      while (acc >= STEP && guard++ < 60) {
        PK.Game.update(STEP);
        acc -= STEP;
      }
      PK.Render.draw(ctx, G, t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window.PK = window.PK || {});
