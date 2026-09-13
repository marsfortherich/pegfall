/* Board geometry + generation. */
(function (PK) {
  'use strict';

  var W = 620, H = 706;
  var PEG_TOP = 136, PEG_BOTTOM = 560;
  var PEG_MARGIN = 13, COL_GAP = 54;   // the lattice reaches the walls: there is no safe gutter
  var SLOT_TOP = 620, SLOT_H = 62;
  var BASE_ROWS = 11;
  var BASE_MULTS = [10, 5, 2.5, 1.2, 1, 0.8, 1, 1.2, 2.5, 5, 10];

  function buildPegs(rows, rng) {
    var pegs = [];
    var wide = Math.floor((W - 2 * PEG_MARGIN) / COL_GAP) + 1;
    var span = (wide - 1) * COL_GAP;
    var startX = (W - span) / 2;
    var rowGap = rows > 1 ? (PEG_BOTTOM - PEG_TOP) / (rows - 1) : 0;
    var id = 0;
    for (var r = 0; r < rows; r++) {
      var odd = r % 2 === 1;
      var n = odd ? wide - 1 : wide;
      var x0 = odd ? startX + COL_GAP / 2 : startX;
      for (var i = 0; i < n; i++) {
        pegs.push({
          id: id++, type: 'normal',
          x: x0 + i * COL_GAP, y: PEG_TOP + r * rowGap,
          row: r, hp: 0, dead: false, flash: 0, respawn: 0
        });
      }
    }
    return pegs;
  }

  /** Build the board for a floor. `hooks` are the relics/modifier that can reshape it. */
  function makeBoard(G, rng, opts) {
    opts = opts || {};
    var rows = BASE_ROWS + (opts.extraRows || 0);
    var board = {
      width: W, height: H,
      slotTop: SLOT_TOP, slotH: SLOT_H,
      pegs: buildPegs(rows, rng),
      rows: rows,
      slots: [],
      restitutionBonus: 0,
      pegValueMul: 1,
      gravityMul: 1,
      fog: false,
      narrow: 0
    };

    var mults = BASE_MULTS.slice();
    board.slots = mults.map(function (m, i) {
      return { index: i, mult: m, baseMult: m, revealed: true, voided: false, flash: 0, hits: 0 };
    });
    return board;
  }

  function layoutSlots(board) {
    var n = board.slots.length;
    var x0 = board.narrow ? board.narrow * (W / n) : 0;
    var x1 = W - x0;
    var usable = n - 2 * (board.narrow || 0);
    var sw = (x1 - x0) / usable;
    board.wallLeft = x0;
    board.wallRight = x1;
    board.slots.forEach(function (s, i) {
      var k = i - (board.narrow || 0);
      s.hidden = k < 0 || k >= usable;
      s.x = x0 + k * sw;
      s.w = sw;
    });
    // Pegs outside the walls are removed so nothing gets stuck behind them.
    board.pegs.forEach(function (p) {
      if (p.x < x0 - 2 || p.x > x1 + 2) p.dead = true;
    });
  }

  function slotAt(board, x) {
    for (var i = 0; i < board.slots.length; i++) {
      var s = board.slots[i];
      if (s.hidden) continue;
      if (x >= s.x && x < s.x + s.w) return s;
    }
    // Clamp to the nearest live slot.
    var live = board.slots.filter(function (s) { return !s.hidden; });
    return x < live[0].x ? live[0] : live[live.length - 1];
  }

  PK.Board = {
    W: W, H: H,
    PEG_TOP: PEG_TOP, PEG_BOTTOM: PEG_BOTTOM,
    SLOT_TOP: SLOT_TOP, SLOT_H: SLOT_H,
    BASE_MULTS: BASE_MULTS,
    make: makeBoard,
    layoutSlots: layoutSlots,
    slotAt: slotAt
  };
})(window.PK = window.PK || {});
