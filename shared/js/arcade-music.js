/* ============================================================================
   arcade-music.js — the arcade's soundtrack: One More Roll's.

   One More Roll was the only table with music: four procedural loops (menu,
   play, shop, boss) of pad, bass, hats and plucks, written in its own
   audio.js. This is that score, note for note, so PEGFALL and No Limit play
   the same music. The hub stays quiet — it never creates a player.

   It is a score, not an engine. A game hands it the AudioContext it already
   has and the node to play into, and keeps every decision that belongs to
   the game: when the context exists, what the volume is, whether music is on,
   which mode a screen means.

       var music = Arcade.music.player(ctx, master);
       music.level(0.27);        // the game's own volume, times its music share
       music.mode('play');       // 'menu' | 'play' | 'shop' | 'boss' | null

   One More Roll keeps its own copy rather than using this one, so its sound
   is untouched. tools/test-shared.js reads both and fails if the four modes
   ever disagree — change them in Yahtzee Roguelike/js/audio.js and here
   together, or not at all.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  // One More Roll's MODES, verbatim.
  var MODES = {
    menu: {
      bpm: 76, pad: 0.055, bass: 0.075, hat: 0, pluck: 0.045,
      chords: [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]]
    },
    play: {
      bpm: 92, pad: 0.05, bass: 0.085, hat: 0.03, pluck: 0.05,
      chords: [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]]
    },
    shop: {
      bpm: 80, pad: 0.055, bass: 0.07, hat: 0.022, pluck: 0.055,
      chords: [[50, 57, 60, 65], [55, 59, 62, 65], [48, 55, 59, 64], [57, 60, 64, 67]]
    },
    boss: {
      bpm: 104, pad: 0.06, bass: 0.1, hat: 0.035, pluck: 0.04,
      chords: [[45, 48, 52], [44, 48, 51], [43, 46, 50], [40, 47, 56]]
    }
  };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /**
   * A player on the game's own context.
   * @param ctx  the game's AudioContext (already created: a gesture made it)
   * @param out  the node to play into — the game's master, so its limiter
   *             catches the music too
   */
  function player(ctx, out) {
    var bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(out);

    var noiseBuf = null;
    var current = null, timer = null, step = 0, nextTime = 0;

    function noiseBuffer() {
      if (noiseBuf) return noiseBuf;
      var len = Math.floor(ctx.sampleRate * 0.1);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    /* One More Roll's tone() and noise(), with `when` absolute. */
    function tone(o) {
      var when = o.when;
      var dur = o.dur;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = o.type;
      osc.frequency.setValueAtTime(o.freq, when);
      if (o.detune) osc.detune.setValueAtTime(o.detune, when);
      var atk = o.attack === undefined ? 0.004 : o.attack;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(o.gain, when + atk);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      var node = osc;
      if (o.filter) {
        var f = ctx.createBiquadFilter();
        f.type = o.filter;
        f.frequency.setValueAtTime(o.cutoff || 1200, when);
        if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.cutoffTo), when + dur);
        if (o.q) f.Q.value = o.q;
        node.connect(f); node = f;
      }
      node.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + dur + 0.03);
      osc.onended = function () { try { gain.disconnect(); } catch (e) { /* gone */ } };
    }

    function hat(when, g) {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      var f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.setValueAtTime(6800, when);
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(g, when + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
      src.connect(f); f.connect(gain); gain.connect(bus);
      src.start(when);
      src.stop(when + 0.055);
      src.onended = function () { try { gain.disconnect(); } catch (e) { /* gone */ } };
    }

    function padVoice(notes, when, dur, g) {
      notes.forEach(function (n, i) {
        tone({
          when: when, type: 'sawtooth', freq: mtof(n + 12), dur: dur,
          gain: g * (i === 0 ? 1 : 0.75), attack: 0.35,
          filter: 'lowpass', cutoff: 620, cutoffTo: 900, q: 2, detune: i * 6 - 6
        });
      });
    }

    /* One More Roll's schedule(): eighth notes, a bar per chord, 0.35 s ahead. */
    function schedule() {
      if (!current) return;
      var cfg = MODES[current];
      var spb = 60 / cfg.bpm;
      var stepDur = spb / 2;
      while (nextTime < ctx.currentTime + 0.35) {
        var when = Math.max(ctx.currentTime, nextTime);
        var chord = cfg.chords[Math.floor(step / 8) % cfg.chords.length];
        var inBar = step % 8;
        if (inBar === 0) {
          padVoice(chord, when, spb * 3.6, cfg.pad);
          tone({ when: when, type: 'triangle', freq: mtof(chord[0] - 12), dur: spb * 1.1, gain: cfg.bass, filter: 'lowpass', cutoff: 420 });
        }
        if (inBar === 4) {
          tone({ when: when, type: 'triangle', freq: mtof(chord[0] - 12), dur: spb * 0.7, gain: cfg.bass * 0.75, filter: 'lowpass', cutoff: 420 });
        }
        if (cfg.hat && inBar % 2 === 1) hat(when, cfg.hat);
        if (cfg.pluck && (inBar === 2 || inBar === 5 || inBar === 7)) {
          var note = chord[(step + inBar) % chord.length] + 12;
          tone({ when: when, type: 'triangle', freq: mtof(note), dur: spb * 0.85, gain: cfg.pluck, filter: 'lowpass', cutoff: 2600 });
        }
        nextTime += stepDur;
        step++;
      }
    }

    /** Switch loops. Like One More Roll, a change of mode keeps the beat going. */
    function mode(name) {
      if (name && !MODES[name]) name = null;
      if (name === current) return;
      current = name;
      if (!name) {
        if (timer) { global.clearInterval(timer); timer = null; }
        return;
      }
      if (!timer) {
        step = 0;
        nextTime = ctx.currentTime + 0.1;
        timer = global.setInterval(schedule, 60);
      }
    }

    /** The bus volume, eased so a settings change does not click. */
    function level(v) {
      var t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(Math.max(0, v), t + 0.08);
    }

    return {
      mode: mode,
      level: level,
      get current() { return current; }
    };
  }

  Arcade.music = { player: player, MODES: MODES };
})(window);
