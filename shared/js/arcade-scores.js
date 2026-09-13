/* ============================================================================
   arcade-scores.js — submission, leaderboards and ranking.

   Firestore shape (see ARCADE.md for the reasoning):

     users/{uid}
         displayName, displayNameLower, createdAt, updatedAt

     leaderboards/{gameId}/entries/{uid}          <- one row per player/game
         uid, gameId, displayName, score (best), plays, meta, firstAt, updatedAt

     runs/{runId}                                 <- append-only history
         uid, gameId, score, meta, createdAt

   A leaderboard is therefore a subcollection keyed by game id. Adding a game
   creates its subcollection on the first write — no schema migration, no new
   rules, no new index.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  function db() { return Arcade.fb && Arcade.fb.db; }
  function stamp() { return global.firebase.firestore.FieldValue.serverTimestamp(); }
  function inc(n) { return global.firebase.firestore.FieldValue.increment(n); }

  function entriesRef(gameId) {
    return db().collection('leaderboards').doc(gameId).collection('entries');
  }

  /** Strip a meta blob down to what the rules will accept: shallow, small,
      primitives only. Keeps a game from accidentally posting its whole run. */
  function cleanMeta(meta) {
    var out = {};
    if (!meta) return out;
    var keys = Object.keys(meta).slice(0, 8);
    keys.forEach(function (k) {
      var v = meta[k];
      if (typeof v === 'number' && isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v.slice(0, 40);
    });
    return out;
  }

  /* --------------------------------------------------------------- submit */

  /**
   * Record the result of a finished run.
   *
   * Always appends to `runs` (so "games played" and score history are real),
   * and lifts the player's leaderboard row only when the run beat their best.
   *
   * Resolves to { ok, skipped, best, isRecord, rank } and never rejects —
   * a dead network must not interrupt a game-over screen.
   */
  function submit(gameId, score, meta) {
    var game = Arcade.gameById(gameId);
    var user = Arcade.auth.user;

    if (!Arcade.isConfigured() || !db()) {
      return Promise.resolve({ ok: false, skipped: 'offline' });
    }
    if (!user) return Promise.resolve({ ok: false, skipped: 'signed-out' });

    score = Number(score);
    if (!isFinite(score) || score < 0) return Promise.resolve({ ok: false, skipped: 'invalid' });
    score = Math.floor(score);
    if (score > game.scoreMax) score = game.scoreMax;

    var clean = cleanMeta(meta);
    var name = Arcade.auth.displayName();
    var ref = entriesRef(gameId).doc(user.uid);

    var runWrite = db().collection('runs').add({
      uid: user.uid,
      gameId: gameId,
      score: score,
      meta: clean,
      createdAt: stamp()
    }).catch(function () { /* history is best-effort */ });

    var entryWrite = db().runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) {
          tx.set(ref, {
            uid: user.uid,
            gameId: gameId,
            displayName: name,
            score: score,
            plays: 1,
            meta: clean,
            firstAt: stamp(),
            updatedAt: stamp()
          });
          return { best: score, isRecord: true };
        }
        var prev = snap.data();
        var beat = score > (prev.score || 0);
        var patch = {
          displayName: name,
          plays: inc(1),
          updatedAt: stamp()
        };
        if (beat) { patch.score = score; patch.meta = clean; }
        tx.update(ref, patch);
        return { best: beat ? score : (prev.score || 0), isRecord: beat };
      });
    });

    return Promise.all([runWrite, entryWrite]).then(function (r) {
      var res = r[1];
      return rankOf(gameId, res.best).then(function (rank) {
        return { ok: true, best: res.best, isRecord: res.isRecord, rank: rank, score: score };
      });
    }).catch(function (err) {
      return { ok: false, error: Arcade.auth.describe(err) };
    });
  }

  /* ----------------------------------------------------------------- rank */

  /**
   * How many players beat `score`, plus one. Uses a server-side count when the
   * SDK offers it and falls back to scanning the top of the board, which is
   * exact for anyone inside `rankScanLimit` and honest about it beyond that.
   */
  function rankOf(gameId, score) {
    if (!db() || !isFinite(score)) return Promise.resolve(null);
    var q = entriesRef(gameId).where('score', '>', score);

    if (typeof q.count === 'function') {
      return q.count().get()
        .then(function (agg) { return agg.data().count + 1; })
        .catch(function () { return scanRank(gameId, score); });
    }
    return scanRank(gameId, score);
  }

  function scanRank(gameId, score) {
    var limit = Arcade.options.rankScanLimit;
    return entriesRef(gameId).orderBy('score', 'desc').limit(limit).get()
      .then(function (snap) {
        var above = 0;
        snap.forEach(function (d) { if ((d.data().score || 0) > score) above++; });
        if (above >= limit) return { atLeast: limit + 1 };
        return above + 1;
      })
      .catch(function () { return null; });
  }

  /* ---------------------------------------------------------- leaderboard */

  /**
   * Top N plus the signed-in player's own standing.
   * Resolves to { rows, you, offline, error } — `you` is null when the player
   * is signed out or has never posted a score.
   */
  function board(gameId, topN) {
    topN = topN || Arcade.options.topN;

    if (!Arcade.isConfigured() || !db()) {
      return Promise.resolve({ rows: [], you: null, offline: true });
    }

    return entriesRef(gameId).orderBy('score', 'desc').limit(topN).get()
      .then(function (snap) {
        var rows = [];
        snap.forEach(function (d, i) {
          var v = d.data();
          rows.push({
            uid: v.uid || d.id,
            rank: rows.length + 1,
            name: v.displayName || 'Player',
            score: v.score || 0,
            plays: v.plays || 0,
            meta: v.meta || {}
          });
        });

        var user = Arcade.auth.user;
        if (!user) return { rows: rows, you: null };

        var inTop = null;
        rows.forEach(function (r) { if (r.uid === user.uid) { r.you = true; inTop = r; } });
        if (inTop) return { rows: rows, you: inTop, youInTop: true };

        // Outside the top N: fetch the player's own row and rank it.
        return entriesRef(gameId).doc(user.uid).get().then(function (mine) {
          if (!mine.exists) return { rows: rows, you: null };
          var v = mine.data();
          return rankOf(gameId, v.score || 0).then(function (rank) {
            return {
              rows: rows,
              you: {
                uid: user.uid,
                rank: rank,
                name: v.displayName || Arcade.auth.displayName(),
                score: v.score || 0,
                plays: v.plays || 0,
                meta: v.meta || {},
                you: true
              },
              youInTop: false
            };
          });
        });
      })
      .catch(function (err) {
        return { rows: [], you: null, error: Arcade.auth.describe(err) };
      });
  }

  /** Every game's top row plus the player's standing — used by the hub. */
  function summary() {
    return Promise.all(Arcade.games.map(function (g) {
      return board(g.id, Arcade.options.topN).then(function (b) {
        return { game: g, board: b };
      });
    }));
  }

  /** The player's own row in each game, for the account panel. */
  function myStandings() {
    var user = Arcade.auth.user;
    if (!user || !db()) return Promise.resolve([]);
    return Promise.all(Arcade.games.map(function (g) {
      return entriesRef(g.id).doc(user.uid).get().then(function (snap) {
        if (!snap.exists) return { game: g, entry: null };
        var v = snap.data();
        return rankOf(g.id, v.score || 0).then(function (rank) {
          return { game: g, entry: { score: v.score || 0, plays: v.plays || 0, rank: rank } };
        });
      }).catch(function () { return { game: g, entry: null }; });
    }));
  }

  /** After a rename, carry the new name onto the rows the player owns. */
  function renameEntries(name) {
    var user = Arcade.auth.user;
    if (!user || !db()) return Promise.resolve();
    return Promise.all(Arcade.games.map(function (g) {
      return entriesRef(g.id).doc(user.uid)
        .update({ displayName: name, updatedAt: stamp() })
        .catch(function () { /* no row for that game yet */ });
    }));
  }

  Arcade.scores = {
    submit: submit,
    board: board,
    rankOf: rankOf,
    summary: summary,
    myStandings: myStandings,
    renameEntries: renameEntries
  };
})(typeof window !== 'undefined' ? window : this);
