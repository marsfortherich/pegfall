/* Seeded RNG — every run is reproducible from its seed. */
(function (PK) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function Rng(seed) {
    this.seed = (typeof seed === 'string') ? hashString(seed) : (seed >>> 0);
    this.next = mulberry32(this.seed);
  }
  Rng.prototype.float = function (min, max) {
    if (min === undefined) return this.next();
    if (max === undefined) { max = min; min = 0; }
    return min + this.next() * (max - min);
  };
  Rng.prototype.int = function (min, max) {           // inclusive
    return Math.floor(this.float(min, max + 1));
  };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  Rng.prototype.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  /** Pick `n` distinct entries, weighted by `weightFn`. */
  Rng.prototype.pickWeighted = function (arr, n, weightFn) {
    var pool = arr.slice(), out = [];
    while (out.length < n && pool.length) {
      var total = 0, i;
      for (i = 0; i < pool.length; i++) total += Math.max(0, weightFn ? weightFn(pool[i]) : 1);
      if (total <= 0) break;
      var roll = this.next() * total, acc = 0, chosen = pool.length - 1;
      for (i = 0; i < pool.length; i++) {
        acc += Math.max(0, weightFn ? weightFn(pool[i]) : 1);
        if (roll < acc) { chosen = i; break; }
      }
      out.push(pool[chosen]);
      pool.splice(chosen, 1);
    }
    return out;
  };

  function randomSeedWord() {
    var syll = ['pe', 'go', 'ka', 'lum', 'dro', 'vex', 'ni', 'tar', 'mo', 'zel', 'qui', 'ra'];
    var s = '';
    for (var i = 0; i < 4; i++) s += syll[Math.floor(Math.random() * syll.length)];
    return s.toUpperCase();
  }

  PK.Rng = Rng;
  PK.hashString = hashString;
  PK.randomSeedWord = randomSeedWord;
})(window.PK = window.PK || {});
