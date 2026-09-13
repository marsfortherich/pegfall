/* ============================================================================
   audio.js — every sound synthesised at runtime.

   No audio files, for the same reason there are no image files: PEGFALL stays a
   folder you can double-click. Same approach the other two arcade games take.

   Browsers refuse to start an AudioContext before a user gesture, so the
   context is built lazily on the first interaction and anything before that is
   dropped silently.

       voices -> master -> limiter -> destination

   The limiter matters here more than in the other games: a single ball can
   clatter through thirty pegs in a second, and without it the stack clips.
   ========================================================================= */
(function (PK) {
  'use strict';

  var ctx = null, master = null, limiter = null, noiseBuf = null, broken = false;

  /* A busy board is the normal case, not the exception, so the voice ceiling is
     what keeps the audio thread from crackling. Peg ticks are the cheapest
     voice and the most numerous; past this many at once new ones are dropped
     rather than queued. */
  var MAX_VOICES = 32;
  var voices = 0;

  function init() {
    if (ctx || broken) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { broken = true; return null; }
      ctx = new AC();

      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      limiter.connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(limiter);

      // Two seconds of white noise, read from a random offset each time so a
      // run of percussive hits never repeats the same waveform — playing one
      // slice over and over turns a rattle into a pitched buzz.
      var len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      broken = true;
    }
    return ctx;
  }

  /** Safe from any interaction; browsers suspend contexts whenever they like. */
  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* nothing to do */ }
    }
  }

  function on() { return ctx && !broken && PK.Settings.sfx && PK.Settings.volume > 0; }
  function vol(g) { return g * PK.Settings.volume; }
  function now() { return ctx.currentTime; }

  /** Count a voice and give the slot back when it finishes. */
  function track(source, gainNode, seconds) {
    voices++;
    var released = false;
    function release() {
      if (released) return;
      released = true;
      voices--;
      try { gainNode.disconnect(); } catch (e) { /* already torn down */ }
    }
    source.onended = release;
    // onended does not always fire — a suspended context, a backgrounded tab —
    // so a timer guarantees the slot comes back either way.
    setTimeout(release, Math.max(80, seconds * 1000 + 400));
  }

  function tone(o) {
    if (!on() || voices >= MAX_VOICES) return;
    var freq = o.freq;
    if (!isFinite(freq) || freq <= 0) return;
    var dur = o.dur === undefined ? 0.12 : o.dur;
    var delay = o.delay || 0;
    var t0 = now() + delay;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to && o.to !== freq && isFinite(o.to)) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol(o.gain === undefined ? 0.2 : o.gain)),
      t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    track(osc, g, delay + dur);
  }

  function noise(o) {
    if (!on() || voices >= MAX_VOICES) return;
    var dur = o.dur === undefined ? 0.1 : o.dur;
    var delay = o.delay || 0;
    var t0 = now() + delay;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + dur);
    f.Q.value = o.q === undefined ? 1 : o.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol(o.gain === undefined ? 0.2 : o.gain)), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    // Never read from before the start of the buffer: a request longer than
    // the buffer makes this negative, and Web Audio throws a RangeError that
    // would escape into the game loop. The source loops, so a long burst wraps.
    var maxOffset = Math.max(0, noiseBuf.duration - dur - 0.05);
    src.start(t0, Math.random() * maxOffset);
    src.stop(t0 + dur + 0.02);
    track(src, g, delay + dur);
  }

  /* ------------------------------------------------------------------ kit */

  // A major scale, so a long clatter climbs something musical instead of
  // wandering. The ladder resets per ball and is capped, or a lucky ball that
  // clips forty pegs ends up inaudibly high.
  var SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  var step = 0;
  var lastPeg = 0;

  function semi(n) { return 220 * Math.pow(2, n / 12); }

  /** Each drop restarts the ladder, so every ball tells its own little story. */
  function resetLadder() { step = 0; }

  function drop() {
    resetLadder();
    noise({ freq: 900, to: 260, dur: 0.16, gain: 0.1, q: 0.7 });
    tone({ freq: 400, to: 190, dur: 0.12, gain: 0.06, type: 'sine' });
  }

  /**
   * A peg tick. `kind` is the peg type id, so gold sparkles, bumpers thump and
   * brittle pegs crack. Rate-limited: at full tilt a ball can hit several pegs
   * inside one frame, and every one of them sounding is just noise.
   */
  function peg(kind, strength) {
    if (!on()) return;
    var t = now();
    if (t - lastPeg < 0.022) return;
    lastPeg = t;

    var n = SCALE[Math.min(step, SCALE.length - 1)];
    step++;

    if (kind === 'gold') {
      tone({ freq: semi(n + 24), dur: 0.14, gain: 0.16, type: 'sine' });
      tone({ freq: semi(n + 31), dur: 0.1, gain: 0.08, type: 'sine', delay: 0.03 });
    } else if (kind === 'bumper') {
      tone({ freq: 150, to: 60, dur: 0.16, gain: 0.28, type: 'square' });
      noise({ freq: 500, to: 160, dur: 0.12, gain: 0.16, q: 0.8 });
    } else if (kind === 'brittle') {
      noise({ freq: 2600, to: 1500, dur: 0.07, gain: 0.12, q: 2.5 });
    } else if (kind === 'charged') {
      tone({ freq: semi(n + 19), to: semi(n + 26), dur: 0.1, gain: 0.11, type: 'sawtooth' });
    } else {
      // The ordinary peg: a short wooden tick, the sound the game lives on.
      tone({ freq: semi(n + 12), dur: 0.055, gain: 0.1 + (strength || 0) * 0.02, type: 'triangle' });
      noise({ freq: 2000, dur: 0.02, gain: 0.04, q: 1.6 });
    }
  }

  function shatter() {
    noise({ freq: 3200, to: 900, dur: 0.22, gain: 0.2, q: 1.2 });
    tone({ freq: 1800, to: 700, dur: 0.16, gain: 0.08, type: 'triangle' });
  }

  /** The payout. Bigger multipliers get a brighter, longer chord. */
  function land(mult, score) {
    resetLadder();
    if (mult <= 0) {
      // A void slot should feel like the floor dropping out.
      tone({ freq: 180, to: 70, dur: 0.3, gain: 0.2, type: 'sawtooth' });
      noise({ freq: 300, to: 120, dur: 0.25, gain: 0.1, q: 0.6 });
      return;
    }
    var big = mult >= 4 || score > 250;
    var root = big ? 330 : 262;
    tone({ freq: root, dur: 0.28, gain: 0.16, type: 'triangle' });
    tone({ freq: root * 1.26, dur: 0.26, gain: 0.12, type: 'triangle', delay: 0.04 });
    tone({ freq: root * 1.5, dur: 0.3, gain: 0.12, type: 'sine', delay: 0.08 });
    if (big) {
      tone({ freq: root * 2, dur: 0.36, gain: 0.1, type: 'sine', delay: 0.12 });
      noise({ freq: 4000, to: 2000, dur: 0.3, gain: 0.05, q: 0.8, delay: 0.05 });
    }
  }

  /** The moment the target falls — this is the cue that you may bank. */
  function cleared() {
    var base = 392;
    [0, 4, 7, 12].forEach(function (n, i) {
      tone({ freq: semi(n) * (base / 220), dur: 0.4, gain: 0.14, type: 'triangle', delay: i * 0.07 });
    });
    noise({ freq: 5000, to: 2500, dur: 0.4, gain: 0.05, q: 0.7, delay: 0.1 });
  }

  function bank() {
    tone({ freq: 880, dur: 0.09, gain: 0.16, type: 'square' });
    tone({ freq: 1320, dur: 0.14, gain: 0.12, type: 'square', delay: 0.07 });
    noise({ freq: 3000, to: 1200, dur: 0.18, gain: 0.07, q: 1 });
  }

  function coin() {
    tone({ freq: 1200, dur: 0.07, gain: 0.11, type: 'square' });
    tone({ freq: 1800, dur: 0.1, gain: 0.08, type: 'square', delay: 0.05 });
  }

  function buy() {
    tone({ freq: 523, dur: 0.1, gain: 0.14, type: 'triangle' });
    tone({ freq: 784, dur: 0.16, gain: 0.12, type: 'triangle', delay: 0.06 });
    coin();
  }

  function deny() {
    tone({ freq: 200, to: 130, dur: 0.16, gain: 0.16, type: 'square' });
  }

  function ui() {
    tone({ freq: 660, dur: 0.05, gain: 0.07, type: 'triangle' });
  }

  function boss() {
    tone({ freq: 110, to: 82, dur: 0.7, gain: 0.22, type: 'sawtooth' });
    tone({ freq: 220, to: 164, dur: 0.6, gain: 0.1, type: 'square', delay: 0.05 });
    noise({ freq: 400, to: 120, dur: 0.8, gain: 0.08, q: 0.5 });
  }

  function gameOver() {
    [0, -2, -5, -9].forEach(function (n, i) {
      tone({ freq: semi(n + 12), dur: 0.5, gain: 0.15, type: 'triangle', delay: i * 0.16 });
    });
    noise({ freq: 600, to: 100, dur: 0.9, gain: 0.07, q: 0.5, delay: 0.2 });
  }

  PK.Sfx = {
    init: init,
    resume: resume,
    resetLadder: resetLadder,
    drop: drop,
    peg: peg,
    shatter: shatter,
    land: land,
    cleared: cleared,
    bank: bank,
    coin: coin,
    buy: buy,
    deny: deny,
    ui: ui,
    boss: boss,
    gameOver: gameOver,
    get available() { return !broken; }
  };
})(window.PK = window.PK || {});
