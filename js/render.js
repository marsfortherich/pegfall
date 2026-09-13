/* Canvas rendering. */
(function (PK) {
  'use strict';

  var W = PK.Board.W, H = PK.Board.H;

  function slotColor(mult) {
    if (mult <= 0) return '#3a2230';
    if (mult >= 8) return '#f2cc60';
    if (mult >= 4) return '#ffa657';
    if (mult >= 2) return '#ff7b72';
    if (mult >= 1) return '#79c0ff';
    return '#4a5a70';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx, G, t) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    if (G.shake > 0) {
      ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    }

    // Backdrop
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#141a24');
    bg.addColorStop(0.55, '#101620');
    bg.addColorStop(1, '#0b0f16');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    if (!G.board) { ctx.restore(); return; }
    var b = G.board;

    drawWalls(ctx, b);
    drawDropRail(ctx, G, t);
    drawSlots(ctx, G, b);
    drawPegs(ctx, b);
    drawBalls(ctx, G);
    drawParticles(ctx, G);
    drawPopups(ctx, G);

    ctx.restore();
  }

  function drawWalls(ctx, b) {
    var l = b.wallLeft || 0, r = b.wallRight || W;
    if (l > 0 || r < W) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, l, H);
      ctx.fillRect(r, 0, W - r, H);
      ctx.strokeStyle = '#ff7b7255';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l, 50); ctx.lineTo(l, PK.Board.SLOT_TOP);
      ctx.moveTo(r, 50); ctx.lineTo(r, PK.Board.SLOT_TOP);
      ctx.stroke();
    }
  }

  function drawDropRail(ctx, G, t) {
    var y = PK.Game.DROP_Y;
    ctx.strokeStyle = 'rgba(120,150,190,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, y); ctx.lineTo(W - 8, y);
    ctx.stroke();

    if (G.screen !== 'play' || !PK.Game.canDrop()) return;
    var def = PK.BALLS[G.hand[0]] || PK.BALLS.standard;
    var x = G.aimX;
    var b = G.board;
    x = Math.max((b.wallLeft || 0) + def.radius + 2, Math.min((b.wallRight || W) - def.radius - 2, x));

    ctx.save();
    ctx.setLineDash([4, 9]);
    ctx.strokeStyle = def.color + '55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 12);
    ctx.lineTo(x, PK.Board.SLOT_TOP + 40);
    ctx.stroke();
    ctx.restore();

    var pulse = 1 + Math.sin(t * 5) * 0.06;
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(x, y, def.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(232,238,247,0.55)';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.name.toUpperCase(), x, y - 18);
  }

  function drawPegs(ctx, b) {
    for (var i = 0; i < b.pegs.length; i++) {
      var p = b.pegs[i];
      if (p.dead) continue;
      var def = PK.PEGS[p.type] || PK.PEGS.normal;
      var r = def.radius;
      if (p.flash > 0) {
        ctx.save();
        ctx.globalAlpha = p.flash * 0.75;
        ctx.fillStyle = def.glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8 * p.flash, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      if (def.id === 'bumper') {
        ctx.strokeStyle = def.glow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r - 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawSlots(ctx, G, b) {
    var top = PK.Board.SLOT_TOP, h = PK.Board.SLOT_H;
    ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < b.slots.length; i++) {
      var s = b.slots[i];
      if (s.hidden) continue;
      var shown = s.revealed || !b.fog;
      var col = shown ? slotColor(s.mult) : '#4a5a70';
      var x = s.x + 2, w = s.w - 4;

      ctx.save();
      ctx.globalAlpha = 0.16 + s.flash * 0.5;
      ctx.fillStyle = col;
      roundRect(ctx, x, top, w, h, 6);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = col + (s.flash > 0 ? 'ff' : '66');
      ctx.lineWidth = s.flash > 0 ? 2.5 : 1.2;
      roundRect(ctx, x, top, w, h, 6);
      ctx.stroke();

      ctx.fillStyle = shown ? col : '#6e7c91';
      var label = !shown ? '?' : (s.mult === 0 ? 'VOID' : (Math.round(s.mult * 10) / 10) + '×');
      ctx.font = (label === 'VOID' ? 'bold 11px' : 'bold 15px') + ' ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(label, s.x + s.w / 2, top + h / 2);

    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawBalls(ctx, G) {
    for (var i = 0; i < G.balls.length; i++) {
      var ball = G.balls[i];
      var tr = ball.trail;
      ctx.save();
      ctx.strokeStyle = ball.def.color;
      ctx.lineCap = 'round';
      for (var j = 0; j + 3 < tr.length; j += 2) {
        var a = (j / tr.length) * 0.35;
        ctx.globalAlpha = a;
        ctx.lineWidth = ball.radius * (j / tr.length) * 1.3;
        ctx.beginPath();
        ctx.moveTo(tr[j], tr[j + 1]);
        ctx.lineTo(tr[j + 2], tr[j + 3]);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.shadowColor = ball.def.color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = ball.ghostLeft > 0 ? ball.def.color + '77' : ball.def.color;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(ball.x - ball.radius * 0.3, ball.y - ball.radius * 0.35, ball.radius * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // live value readout
      ctx.fillStyle = '#e8eef7';
      ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(ball.value), ball.x, ball.y - ball.radius - 7);
      if (ball.slotBonus > 0) {
        ctx.fillStyle = '#79c0ff';
        ctx.fillText('+' + (Math.round(ball.slotBonus * 100) / 100) + '×', ball.x, ball.y + ball.radius + 14);
      }
    }
  }

  function drawParticles(ctx, G) {
    for (var i = 0; i < G.particles.length; i++) {
      var p = G.particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups(ctx, G) {
    ctx.textAlign = 'center';
    for (var i = 0; i < G.popups.length; i++) {
      var p = G.popups[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.font = (p.big ? 'bold 19px' : 'bold 13px') + ' ui-monospace, Menlo, Consolas, monospace';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  PK.Render = { draw: draw, slotColor: slotColor };
})(window.PK = window.PK || {});
