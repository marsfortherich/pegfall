/* ============================================================================
   arcade-dealer.js — the croupier.

   One recurring character across all three tables: a face, a speech bubble,
   text that types itself out, and a blip per character.

   Two deliberate decisions.

   The blip is synthesised here rather than borrowed from the host game through
   Arcade.ui.setSound, which is how the rest of the shared chrome gets its
   sound. The reasoning is the opposite of the usual one: the dealer is not
   part of any game, he is the thing the games have in common, and a recurring
   character who changes voice depending on which room he is standing in is not
   really recurring. It is one oscillator, not an engine — no kit, no limiter,
   no voice pool.

   The face is drawn, not loaded. None of these games ship image files and the
   dealer is not going to be the first.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};
  var doc = global.document;

  var host = null, bubble = null, textEl = null, faceEl = null;
  var typing = null;          // the run in progress, so a new line can cut it off
  var hideTimer = 0;
  var ctx = null, broken = false;

  /* ------------------------------------------------------------------ voice */

  /** A short blip. Undertale's trick: pitch jitter is what stops it droning. */
  function blip(seed) {
    if (broken || !settingsAllowSound()) return;
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) { broken = true; return; }
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'square';
      // A narrow band around the same note, so it reads as one mouth.
      osc.frequency.setValueAtTime(320 + (seed % 7) * 11, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
      osc.onended = function () { try { g.disconnect(); } catch (e) {} };
    } catch (e) {
      broken = true;
    }
  }

  /** Honour whichever game's sound setting we are standing in. */
  function settingsAllowSound() {
    var PK = global.PK;
    if (PK && PK.Settings) return PK.Settings.sfx !== false && PK.Settings.volume > 0;
    var S = global.Settings;
    if (S && typeof S.sfx === 'boolean') return S.sfx && S.volume > 0;
    return true;
  }

  function motionOK() {
    return !Arcade.ui || !Arcade.ui.motionOK || Arcade.ui.motionOK();
  }

  /* ------------------------------------------------------------------- face */

  /* A dealer: visor, eyes, collar, tie. Drawn small enough to read at 46px and
     simple enough that a blinking eye and a moving mouth are the whole
     performance. */
  var FACE = [
    '<svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">',
    '<circle cx="24" cy="24" r="23" fill="var(--ac-surface-3)" stroke="var(--ac-gold)" stroke-width="2"/>',
    '<path d="M6 19 Q24 7 42 19 L42 22 Q24 12 6 22 Z" fill="var(--ac-gold)"/>',   // visor
    '<rect x="17" y="34" width="14" height="10" rx="2" fill="var(--ac-surface-0)"/>',
    '<path d="M20 34 L24 39 L28 34 Z" fill="var(--ac-gold)"/>',                   // tie
    '<g class="ac-dealer__eyes">',
    '<circle cx="18" cy="26" r="2.4" fill="var(--ac-ink)"/>',
    '<circle cx="30" cy="26" r="2.4" fill="var(--ac-ink)"/>',
    '</g>',
    '<rect class="ac-dealer__mouth" x="21" y="31" width="6" height="1.6" rx="0.8" fill="var(--ac-ink)"/>',
    '</svg>'
  ].join('');

  function build() {
    if (host) return;
    host = doc.createElement('div');
    host.className = 'ac-dealer ac-root';
    host.setAttribute('role', 'status');

    faceEl = doc.createElement('div');
    faceEl.className = 'ac-dealer__face';
    faceEl.innerHTML = FACE;

    bubble = doc.createElement('div');
    bubble.className = 'ac-dealer__bubble';
    var name = doc.createElement('div');
    name.className = 'ac-dealer__name';
    name.textContent = 'The Dealer';
    textEl = doc.createElement('div');
    textEl.className = 'ac-dealer__text';
    bubble.appendChild(name);
    bubble.appendChild(textEl);

    host.appendChild(faceEl);
    host.appendChild(bubble);

    // Click anywhere on him to finish the line, then to send him away.
    host.addEventListener('click', function () {
      if (typing) finishTyping();
      else hide();
    });

    doc.body.appendChild(host);
  }

  /* --------------------------------------------------------------- speaking */

  function finishTyping() {
    if (!typing) return;
    clearTimeout(typing.timer);
    textEl.textContent = typing.full;
    typing = null;
    host.classList.remove('is-talking');
    scheduleHide(4200);
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = global.setTimeout(hide, ms);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (typing) { clearTimeout(typing.timer); typing = null; }
    if (!host) return;
    host.classList.remove('is-talking');
    host.classList.remove('is-in');
  }

  /**
   * Say something.
   * @param text the line
   * @param opts.hold how long to linger after the last character
   */
  function say(text, opts) {
    if (!text) return;
    opts = opts || {};
    build();
    clearTimeout(hideTimer);
    if (typing) clearTimeout(typing.timer);

    host.classList.add('is-in');
    textEl.textContent = '';

    if (!motionOK()) {
      textEl.textContent = text;
      typing = null;
      scheduleHide(opts.hold || 5200);
      return;
    }

    host.classList.add('is-talking');
    typing = { full: text, i: 0, timer: 0 };

    function step() {
      if (!typing) return;
      var ch = text.charAt(typing.i);
      textEl.textContent = text.slice(0, ++typing.i);

      // Blip on letters only: punctuation and spaces are where a voice rests.
      if (/[^\s.,!?—…]/.test(ch) && typing.i % 2 === 0) blip(typing.i);

      if (typing.i >= text.length) {
        typing = null;
        host.classList.remove('is-talking');
        scheduleHide(opts.hold || 4600);
        return;
      }
      // A beat after punctuation is most of what makes typed text feel spoken.
      var delay = /[.!?—…]/.test(ch) ? 260 : /[,;:]/.test(ch) ? 150 : 30;
      typing.timer = global.setTimeout(step, delay);
    }
    typing.timer = global.setTimeout(step, 220);
  }

  /* ------------------------------------------------------------------ lines

     Dry and short. Typed text wants few words — every extra clause is another
     second the player is waiting to be allowed to do something.

     Each entry is a list; one is picked at random so he does not repeat
     himself the second time you see the same screen. */
  var LINES = {
    hub_first: ['New face. The tables are open.'],
    hub: [
      'Back again.',
      'The tables kept your seat.',
      'Pick a game. They all end the same way.',
      'Something for everyone. Mostly for the house.'
    ],
    hub_signed_out: ['Nobody plays anonymously here. Not for long.'],

    progress: [
      'Everything you have managed to keep.',
      'The house remembers what you earned. It remembers the rest too.',
      'Spend it. It does not gather interest.'
    ],
    bought: ['Yours. Permanently, which is rarer than it sounds.'],
    achievement: ['Noted. The house notes everything.'],

    title_pegfall: [
      'Drop the ball. Gravity does the rest.',
      'The pegs decide. You only choose where to start.'
    ],
    title_onemoreroll: [
      'Five dice. Fewer choices than you think.',
      'The dice do not remember the last roll. You will.'
    ],
    title_nolimit: [
      'Place your chips. The wheel is listening.',
      'No limit. That has never once been good news.'
    ],

    win: [
      'You took it off the house. That happens.',
      'The house folds. Enjoy it — the house has other rooms.'
    ],
    deep: [
      'Further than most. Not far enough.',
      'You lasted. The table is still here.'
    ],
    early: [
      'Short one.',
      'The house keeps the difference.',
      'Again, then.'
    ]
  };

  function pick(key) {
    var set = LINES[key];
    if (!set || !set.length) return null;
    return set[Math.floor(Math.random() * set.length)];
  }

  /** Say a line from a named set. Silently does nothing if the set is empty. */
  function says(key, opts) {
    var line = pick(key);
    if (line) say(line, opts);
  }

  /**
   * React to a finished run. `summary` is the same shape the progression store
   * takes, so a caller never has to build a second one.
   */
  function reactToRun(summary) {
    summary = summary || {};
    if (summary.won) return says('win');
    var deep = (summary.ante || 0) >= 4 || (summary.floor || 0) >= 5;
    says(deep ? 'deep' : 'early');
  }

  /** Greet on a game's title screen. */
  function greet(gameId) {
    says('title_' + gameId);
  }

  Arcade.dealer = {
    say: say, says: says, pick: pick,
    greet: greet, reactToRun: reactToRun,
    hide: hide, LINES: LINES
  };
})(typeof window !== 'undefined' ? window : this);
