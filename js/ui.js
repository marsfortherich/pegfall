/* DOM HUD, overlays, shop, tooltips. */
(function (PK) {
  'use strict';

  var G, el = {};

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function init(game) {
    G = game.G;
    ['run-floor', 'run-seed', 'run-gold', 'run-target', 'run-score', 'score-fill', 'score-pct',
     'relic-list', 'bag-list', 'hand-list', 'modifier', 'overlay', 'log-list', 'records',
     'cashout', 'tooltip', 'hand-count', 'toast', 'hand-hint'].forEach(function (id) {
      el[id] = $(id);
    });

    el.overlay.addEventListener('click', function (e) {
      if (e.target === el.overlay && el.overlay.dataset.dismissable === '1') hideOverlay();
    });

    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t) showTip(t);
    });
    document.addEventListener('mouseout', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t) el.tooltip.classList.add('hidden');
    });
    document.addEventListener('mousemove', function (e) {
      if (el.tooltip.classList.contains('hidden')) return;
      var pad = 14;
      var x = Math.min(e.clientX + pad, window.innerWidth - el.tooltip.offsetWidth - 8);
      var y = Math.min(e.clientY + pad, window.innerHeight - el.tooltip.offsetHeight - 8);
      el.tooltip.style.left = x + 'px';
      el.tooltip.style.top = y + 'px';
    });

    el.cashout.addEventListener('click', function () { PK.Sfx.ui(); PK.Game.cashOut(); });

    showMenu();
  }

  function showTip(target) {
    el.tooltip.innerHTML = target.getAttribute('data-tip');
    el.tooltip.classList.remove('hidden');
  }

  /* ------------------------------------------------------------------- hud */

  var lastScore = 0, lastGold = -1, rollRaf = 0;

  /** Count a number up, and always land on it even in a throttled tab. */
  function rollTo(node, from, to) {
    if (!node) return;
    if (rollRaf) { cancelAnimationFrame(rollRaf); rollRaf = 0; }
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce || Math.abs(to - from) < 2) { node.textContent = to.toLocaleString(); return; }

    var t0 = 0, DUR = 420, done = false;
    function land() { if (done) return; done = true; rollRaf = 0; node.textContent = to.toLocaleString(); }
    function step(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (p < 1) rollRaf = requestAnimationFrame(step); else land();
    }
    rollRaf = requestAnimationFrame(step);
    setTimeout(land, DUR + 200);
  }

  /** Put a number on screen immediately, cancelling any roll in flight. */
  function setScoreNow(v) {
    lastScore = v;
    if (rollRaf) { cancelAnimationFrame(rollRaf); rollRaf = 0; }
    if (el['run-score']) el['run-score'].textContent = v.toLocaleString();
  }

  function pulse(node) {
    if (!node) return;
    node.classList.remove('bump');
    void node.offsetWidth;          // restart the animation on a repeat
    node.classList.add('bump');
  }

  function refresh() {
    if (!G || !G.stats) return;
    el['run-floor'].textContent = G.floor + (G.floor % 5 === 0 ? ' · BOSS' : '');
    el['run-seed'].textContent = G.seed;
    /* The score is the number the whole game is about, so it rolls rather
       than teleporting — and the gold flashes when it moves, because a payout
       you did not notice may as well not have happened. */
    var gold = G.gold;
    if (gold !== lastGold) {
      el['run-gold'].textContent = gold;
      if (gold > lastGold) pulse(el['run-gold']);
      lastGold = gold;
    }
    el['run-target'].textContent = G.target.toLocaleString();

    /* Two separate questions: has the score moved (roll it), and does the
       display actually agree with the score (paint it). Only asking the first
       left a cleared floor showing the previous floor's total until the next
       ball landed, because a reset sets the tracker and the score to the same
       number and the roll was skipped. */
    var score = Math.round(G.score);
    var want = score.toLocaleString();
    if (score !== lastScore) {
      rollTo(el['run-score'], lastScore, score);
      lastScore = score;
    } else if (!rollRaf && el['run-score'].textContent !== want) {
      el['run-score'].textContent = want;
    }

    var pct = G.target ? Math.min(1, G.score / G.target) : 0;
    el['score-fill'].style.width = (pct * 100).toFixed(1) + '%';
    el['score-fill'].classList.toggle('done', G.score >= G.target);
    el['score-pct'].textContent = Math.round(pct * 100) + '%';

    var mod = G.modifier;
    el.modifier.className = mod ? (mod.boss ? 'modifier boss' : 'modifier') : 'modifier empty';
    el.modifier.innerHTML = mod
      ? '<b>' + esc(mod.name) + '</b><span>' + esc(mod.desc) + '</span>'
      : '<b>Clear board</b><span>No modifiers on this floor.</span>';

    el['relic-list'].innerHTML = G.relics.length
      ? G.relics.map(function (id) {
          var r = PK.RELIC_BY_ID[id];
          return '<div class="relic" style="--c:' + PK.RARITY_COLOR[r.rarity] + '" data-tip="<b>' +
            esc(r.name) + '</b><br>' + esc(r.desc) + '"><span class="ico">' + esc(r.icon) +
            '</span><span class="nm">' + esc(r.name) + '</span></div>';
        }).join('')
      : '<p class="muted">No relics yet. Buy some in the shop.</p>';

    var counts = {};
    G.bag.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    el['bag-list'].innerHTML = Object.keys(counts).map(function (id) {
      var b = PK.BALLS[id];
      return '<div class="bagitem" data-tip="<b>' + esc(b.name) + '</b><br>' + esc(b.desc) + '">' +
        '<i style="background:' + b.color + '"></i>' + esc(b.name) +
        '<b>×' + counts[id] + '</b></div>';
    }).join('');

    el['hand-list'].innerHTML = G.hand.map(function (id, i) {
      var b = PK.BALLS[id];
      return '<div class="handball' + (i === 0 ? ' next' : '') + '" data-tip="<b>' + esc(b.name) +
        '</b><br>' + esc(b.desc) + '" style="--c:' + b.color + '"></div>';
    }).join('');
    el['hand-count'].textContent = G.hand.length;

    // The floor is beaten and you still hold balls: banking is now a real
    // choice, so say so in the hand bar rather than only surfacing a button.
    var cleared = G.screen === 'play' && !G.floorResolved &&
      G.score >= G.target && G.hand.length > 0;
    var canBank = cleared && G.balls.length === 0;

    el.cashout.classList.toggle('hidden', !canBank);
    el.cashout.parentNode.classList.toggle('cleared', cleared);
    el['hand-hint'].textContent = cleared
      // Terse on purpose: the toast carries the full sentence once, this is
      // the standing reminder and has to survive a 620px bar.
      ? 'Unused balls pay gold'
      : '';

    el['log-list'].innerHTML = G.log.length ? G.log.slice().reverse().map(function (l) {
      return '<li><span>' + esc(l.ball) + '</span><b>' + l.value + ' × ' +
        (Math.round(l.mult * 10) / 10) + '</b><em>' + l.score.toLocaleString() + '</em></li>';
    }).join('') : '<li class="muted">Drop a ball to begin.</li>';
  }

  function onFloorStart() {
    // A new floor starts at zero, or at whatever Overflow carried over. Snap
    // to it rather than rolling down from the last floor's total, which would
    // read as the score draining away.
    setScoreNow(Math.round(G.score));
    refresh();
    var mod = G.modifier;
    showToast('FLOOR ' + G.floor + (mod ? ' — ' + mod.name : ''), mod && mod.boss);
  }

  var toastTimer = null;
  function showToast(text, danger) {
    el.toast.textContent = text;
    el.toast.className = 'toast show' + (danger ? ' danger' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, 2600);
  }

  /* -------------------------------------------------------------- overlays */

  function showOverlay(html, dismissable) {
    el.overlay.dataset.dismissable = dismissable ? '1' : '0';
    el.overlay.innerHTML = html;
    el.overlay.classList.remove('hidden');
  }
  function hideOverlay() { el.overlay.classList.add('hidden'); el.overlay.innerHTML = ''; }

  /** Drop the shared arcade buttons into one of this game's own overlays. */
  function arcadeRow(host) {
    if (host && window.Arcade && window.Arcade.ui) {
      host.appendChild(window.Arcade.ui.inlineActions({ gameId: 'pegfall' }));
    }
  }

  function showMenu() {
    var meta = PK.Save.load();
    var next = PK.Save.nextUnlock(meta);
    var unlocked = PK.Save.unlockedBalls(meta);
    var saved = PK.Save.loadRun();
    showOverlay(
      '<div class="card menu">' +
      '<h1>PEGFALL</h1>' +
      '<p class="tag">a plinko roguelite</p>' +
      '<p class="blurb">Drop balls. Pegs feed them value, slots multiply it. Clear the floor’s target ' +
      'or the run ends. Between floors you buy relics and stranger balls, and the board starts ' +
      'fighting back.</p>' +
      '<div class="seedrow"><label>Seed</label><input id="seed-input" maxlength="16" placeholder="' +
      esc(PK.randomSeedWord()) + '"></div>' +
      (saved
        ? '<button class="big" id="btn-continue">CONTINUE · FLOOR ' + saved.floor + '</button>' +
          '<button id="btn-start" class="newrun">NEW RUN</button>'
        : '<button class="big" id="btn-start">START RUN</button>') +
      '<div class="records">' +
      '<div><b>' + meta.bestFloor + '</b><span>best floor</span></div>' +
      '<div><b>' + meta.runs + '</b><span>runs</span></div>' +
      '<div><b>' + meta.bestScore.toLocaleString() + '</b><span>best floor score</span></div>' +
      '</div>' +
      '<p class="muted small">Unlocked balls: ' + unlocked.map(function (b) { return PK.BALLS[b].name; }).join(', ') +
      (next ? '<br>Next unlock: <b>' + esc(next.name) + '</b> at floor ' + next.floor : '<br>Everything is unlocked.') +
      '</p>' +
      '<p class="muted small">Click the board to aim and drop · <b>Space</b> drops at the last spot</p>' +
      '<div class="optrow">' +
      '<button id="btn-settings">SETTINGS</button>' +
      '<button id="btn-help">HOW TO PLAY</button>' +
      '</div>' +
      '</div>', false);

    $('btn-settings').addEventListener('click', function () { PK.Sfx.ui(); showSettings(true); });
    $('btn-help').addEventListener('click', function () { PK.Sfx.ui(); showHelp(true); });

    if (saved) {
      $('btn-continue').addEventListener('click', function () {
        PK.Sfx.ui();
        hideOverlay();
        if (!PK.Game.resumeRun()) showMenu();   // a save that will not load
      });
    }
    $('btn-start').addEventListener('click', function () {
      var v = $('seed-input').value.trim();
      if (saved && !window.confirm('Start a new run? The saved run on floor ' +
          saved.floor + ' will be discarded.')) return;
      PK.Sfx.ui();
      hideOverlay();
      PK.Game.newRun(v || null);
    });
    $('seed-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('btn-start').click();
    });
    arcadeRow(el.overlay.querySelector('.menu'));
    if (window.Arcade && window.Arcade.dealer) window.Arcade.dealer.greet('pegfall');
  }

  /* ---------------------------------------------------- settings and help

     Both reachable straight from the title, matching One More Roll. The sound
     controls used to sit loose on the menu card; they live in Settings now, so
     the title screen is a title screen and not a control panel. */

  function showSettings(fromMenu) {
    var STEPS = [0.3, 0.6, 1];

    function body() {
      var on = PK.Settings.sfx;
      var idx = STEPS.indexOf(PK.Settings.volume);
      if (idx < 0) idx = 1;
      return '<div class="card menu">' +
        '<h2 class="ovh">SETTINGS</h2>' +
        '<div class="setrows">' +
        '<div class="setrow"><span>Sound</span>' +
        '<button id="set-sfx" class="' + (on ? 'on' : 'off') + '">' + (on ? 'ON' : 'OFF') + '</button></div>' +
        '<div class="setrow"><span>Volume</span>' +
        '<button id="set-vol"' + (on ? '' : ' disabled') + '>' + (idx + 1) + ' / 3</button></div>' +
        '</div>' +
        '<p class="muted small">Sound is synthesised as you play — there are no audio files.</p>' +
        '<div class="shopfoot"><button id="set-back" class="big">BACK</button></div>' +
        '</div>';
    }

    function draw() {
      showOverlay(body(), false);
      $('set-sfx').addEventListener('click', function () {
        PK.Sfx.resume();
        PK.setSetting('sfx', !PK.Settings.sfx);
        if (PK.Settings.sfx) PK.Sfx.coin();
        draw();
      });
      $('set-vol').addEventListener('click', function () {
        PK.Sfx.resume();
        var i = STEPS.indexOf(PK.Settings.volume);
        PK.setSetting('volume', STEPS[(i + 1) % STEPS.length] || STEPS[1]);
        PK.Sfx.coin();
        draw();
      });
      $('set-back').addEventListener('click', function () {
        PK.Sfx.ui();
        if (fromMenu) showMenu(); else hideOverlay();
      });
    }
    draw();
  }

  function showHelp(fromMenu) {
    showOverlay(
      '<div class="card menu help">' +
      '<h2 class="ovh">HOW TO PLAY</h2>' +
      '<div class="helpbody">' +
      '<p><b>Drop a ball.</b> Click the board to aim; it falls where you point. You can have ' +
      'up to three in the air at once — keep clicking.</p>' +
      '<p><b>Pegs feed it.</b> A ball starts at its type’s value and grows with every peg it ' +
      'clips. Gold pegs add a lot, charged pegs add to the slot multiplier, bumpers kick it ' +
      'sideways, brittle pegs break for a bonus. A shattered peg grows back a drop later, so ' +
      'breaking the board is never a permanent loss.</p>' +
      '<p><b>The slot multiplies it.</b> <span class="fx">ball value × slot multiplier = score</span> ' +
      'The outer slots pay 10×, the centre pays 0.8× — so a fat ball in a poor slot is a waste.</p>' +
      '<p><b>Clear the target</b> before the hand runs out or the run ends. Beat it and the rest ' +
      'of your hand becomes gold instead — you never have to drop them. Dropping on anyway buys ' +
      'score, not gold: every ball you spend is a gold you do not bank.</p>' +
      '<p><b>Between floors</b> you buy relics and stranger balls. From floor 3 the board starts ' +
      'fighting back, and every fifth floor is a boss.</p>' +
      '</div>' +
      '<div class="helpkeys">' +
      '<div><b>Click</b> aim and drop</div>' +
      '<div><b>Space</b> drop at the last spot</div>' +
      '<div><b>← →</b> nudge the aim</div>' +
      '<div><b>Enter</b> bank a cleared floor</div>' +
      '</div>' +
      '<div class="shopfoot"><button id="help-back" class="big">BACK</button></div>' +
      '</div>', false);
    $('help-back').addEventListener('click', function () {
      PK.Sfx.ui();
      if (fromMenu) showMenu(); else hideOverlay();
    });
  }

  function offerCard(o, i) {
    var d = o.data;
    var color = PK.RARITY_COLOR[d.rarity || 'common'];
    var afford = G.gold >= o.cost;
    var kindLabel = o.kind === 'relic' ? 'RELIC' : o.kind === 'ball' ? 'BALL' : 'SERVICE';
    var art = o.kind === 'ball'
      ? '<span class="ball-art" style="background:' + d.color + '"></span>'
      : '<span class="relic-art" style="--c:' + color + '">' + esc(d.icon || '◆') + '</span>';
    return '<div class="offer' + (o.sold ? ' sold' : '') + '" style="--c:' + color + '">' +
      '<div class="kind">' + kindLabel + '</div>' + art +
      '<h3>' + esc(d.name) + '</h3>' +
      '<p>' + esc(d.desc) + '</p>' +
      (o.sold
        ? '<button class="buy" disabled>SOLD</button>'
        : '<button class="buy' + (afford ? '' : ' poor') + '" data-buy="' + i + '"' +
          (afford ? '' : ' disabled') + '>' + o.cost + 'g</button>') +
      '</div>';
  }

  function showShop() {
    refresh();
    var s = G.shop;
    showOverlay(
      '<div class="card shop">' +
      '<div class="shophead"><h2>SHOP</h2>' +
      '<div class="purse"><b>' + G.gold + '</b> gold <span class="muted">(+' + s.gained + ' this floor)</span></div>' +
      '</div>' +
      '<div class="offers">' + s.offers.map(offerCard).join('') + '</div>' +
      '<div class="shopfoot">' +
      '<button id="btn-reroll"' + (G.gold < s.rerollCost ? ' disabled' : '') + '>Reroll · ' + s.rerollCost + 'g</button>' +
      '<button class="big" id="btn-next">To floor ' + (G.floor + 1) + ' →</button>' +
      '</div>' +
      '<div class="shopbag"><b>Bag:</b> ' + bagSummary() + ' &nbsp;·&nbsp; <b>Hand:</b> ' +
      PK.Game.handSize() + ' balls</div>' +
      '</div>', false);

    Array.prototype.forEach.call(el.overlay.querySelectorAll('[data-buy]'), function (btn) {
      btn.addEventListener('click', function () { PK.Game.buy(parseInt(btn.dataset.buy, 10)); });
    });
    $('btn-reroll').addEventListener('click', function () { PK.Game.reroll(); });
    $('btn-next').addEventListener('click', function () { hideOverlay(); PK.Game.leaveShop(); });
  }

  function bagSummary() {
    var counts = {};
    G.bag.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    return Object.keys(counts).map(function (id) {
      return esc(PK.BALLS[id].name) + '×' + counts[id];
    }).join(', ');
  }

  function showGameOver() {
    refresh();
    var meta = G.meta;
    showOverlay(
      '<div class="card over">' +
      '<h2>RUN OVER</h2>' +
      '<p class="tag">You fell short on floor ' + G.floor + ' — ' +
      Math.round(G.score).toLocaleString() + ' / ' + G.target.toLocaleString() + '</p>' +
      '<div class="records">' +
      '<div><b>' + Math.round(G.stats.runTotal).toLocaleString() + '</b><span>run score</span></div>' +
      '<div><b>' + G.floor + '</b><span>floor reached</span></div>' +
      '<div><b>' + G.stats.pegs.toLocaleString() + '</b><span>pegs hit</span></div>' +
      '<div><b>' + G.stats.bestBall.toLocaleString() + '</b><span>best single ball</span></div>' +
      '<div><b>' + G.relics.length + '</b><span>relics</span></div>' +
      '</div>' +
      '<p class="muted small">Seed <b>' + esc(G.seed) + '</b> · best floor ever: ' + meta.bestFloor + '</p>' +
      '<div class="shopfoot">' +
      '<button id="btn-again" class="big">NEW RUN</button>' +
      '<button id="btn-same">REPLAY SEED</button>' +
      '<button id="btn-menu">MENU</button>' +
      '</div></div>', false);

    $('btn-again').addEventListener('click', function () { hideOverlay(); PK.Game.newRun(null); });
    $('btn-same').addEventListener('click', function () { hideOverlay(); PK.Game.newRun(G.seed); });
    $('btn-menu').addEventListener('click', function () { showMenu(); });
    arcadeRow(el.overlay.querySelector('.over'));
    if (window.Arcade && window.Arcade.dealer) {
      window.Arcade.dealer.reactToRun({ floor: G.floor, score: G.stats.runTotal });
    }
  }

  PK.UI = {
    init: init,
    refresh: refresh,
    onFloorStart: onFloorStart,
    showShop: showShop,
    showGameOver: showGameOver,
    showMenu: showMenu,
    showSettings: showSettings,
    showHelp: showHelp,
    showToast: showToast,
    hideOverlay: hideOverlay
  };
})(window.PK = window.PK || {});
