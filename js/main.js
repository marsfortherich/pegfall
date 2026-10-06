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
      // Keys typed into the arcade's forms, or pressed over its dialogs, are
      // not the board's: a space in a display name used to drop a ball.
      if (window.Arcade && window.Arcade.ui && window.Arcade.ui.claimsKeys &&
          window.Arcade.ui.claimsKeys(e)) return;
      // nor over this game's own overlay (Settings, How to Play) above the board
      var overlay = document.getElementById('overlay');
      if (overlay && !overlay.classList.contains('hidden')) return;
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

  /* Which of the arcade's loops a screen plays, the way One More Roll picks:
     the menu between runs, play on a floor (boss on a boss floor), the shop's
     own loop in the shop. */
  function musicFor(G) {
    if (G.screen === 'play') return G.modifier && G.modifier.boss ? 'boss' : 'play';
    if (G.screen === 'shop') return 'shop';
    return 'menu';
  }

  function start() {
    // Shared account + leaderboard layer. Checks the auth state up front so
    // the HUD knows who is playing before the first ball drops.
    if (window.Arcade) {
      window.Arcade.init({ gameId: 'pegfall' });
      // The shared chrome has no audio engine of its own and should not grow
      // one; it borrows whichever game it is sitting in.
      window.Arcade.ui.setSound({
        ui: PK.Sfx.ui, success: PK.Sfx.buy, deny: PK.Sfx.deny, achievement: PK.Sfx.cleared
      });
      // the bar's Settings opens this game's own, over whatever is on screen
      if (window.Arcade.ui.setSettings) window.Arcade.ui.setSettings(PK.UI.settingsFromBar);
    }

    // Browsers refuse to start an AudioContext before a gesture, and they
    // suspend it again whenever the tab loses focus, so this is not `once`.
    window.addEventListener('pointerdown', PK.Sfx.resume);
    window.addEventListener('keydown', PK.Sfx.resume);

    // Another tab saved the records: take them, or this tab's next save would
    // write back the copy it loaded and erase what that tab earned.
    window.addEventListener('storage', function (e) {
      if (e.key === PK.Save.META_KEY && PK.Game.G.meta) PK.Game.G.meta = PK.Save.load();
    });

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
      PK.Sfx.music(musicFor(G));
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
