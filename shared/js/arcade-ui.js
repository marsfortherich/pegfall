/* ============================================================================
   arcade-ui.js — the shared chrome: arcade bar, auth dialog, leaderboard,
   account panel and toasts.

   Every widget here is built from the `.ac-*` components in arcade.css, so all
   three games get pixel-identical account and leaderboard surfaces while their
   own screens stay exactly as they were.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};
  var doc = global.document;

  var mounted = false;
  var bar = null;
  var switcher = null;
  var currentGameId = null;
  var loadToken = 0;

  /* ------------------------------------------------------------- elements */

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function btn(label, cls, onClick) {
    var b = el('button', 'ac-btn ' + (cls || ''), label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var s = (parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '');
    return s.toUpperCase();
  }

  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (!isFinite(n)) return '∞';
    if (Math.abs(n) >= 1e15) return Number(n).toExponential(2).replace('e+', 'e');
    return Math.round(n).toLocaleString('en-US');
  }

  function rankText(rank) {
    if (rank === null || rank === undefined) return '—';
    if (typeof rank === 'object' && rank.atLeast) return rank.atLeast + '+';
    return '#' + rank;
  }

  /* ----------------------------------------------------------------- juice

     Decoration, all of it — which is exactly why every piece degrades to the
     plain result. Chrome animation honours the OS reduced-motion preference
     (unlike a game's own animation, which can be load-bearing), and every
     count-up has a timer backstop so a throttled tab still lands on the real
     number instead of freezing mid-roll. */

  function motionOK() {
    try { return !global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  /**
   * Sound for the shared chrome.
   *
   * The arcade layer has no audio engine of its own and should not grow a
   * fourth one, so each game lends its own: Arcade.ui.setSound({ ui, success,
   * deny, achievement }). Unset hooks are simply silent.
   */
  var sound = {};
  function setSound(impl) {
    Object.keys(impl || {}).forEach(function (k) { sound[k] = impl[k]; });
  }
  function play(name) {
    var fn = sound[name];
    if (typeof fn !== 'function') return;
    try { fn(); } catch (e) { /* a bad hook must never break the UI */ }
  }

  /** Roll a number up to its new value. Always ends on `to`. */
  function countUp(node, from, to, ms) {
    ms = ms || 600;
    if (!node) return;
    if (!motionOK() || from === to || !global.requestAnimationFrame) {
      node.textContent = fmt(to);
      return;
    }
    var t0 = 0;
    var done = false;
    function land() { if (done) return; done = true; node.textContent = fmt(to); }
    function step(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / ms);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(Math.round(from + (to - from) * eased));
      if (p < 1 && !done) global.requestAnimationFrame(step);
      else land();
    }
    global.requestAnimationFrame(step);
    // A backgrounded tab stops firing frames; the number still has to arrive.
    global.setTimeout(land, ms + 200);
  }

  /** Deal a list in, one row at a time. */
  function stagger(host, rows) {
    rows.forEach(function (r, i) {
      host.appendChild(r);
      if (!motionOK()) return;
      r.classList.add('ac-in');
      r.style.animationDelay = Math.min(i * 40, 240) + 'ms';
    });
  }

  /**
   * Placeholder rows while a board loads.
   *
   * Shaped like the real thing rather than a spinner in the middle of nowhere,
   * so the panel does not jump when the data lands.
   */
  function skeleton(host, count) {
    var wrap = el('div', 'ac-lb');
    for (var i = 0; i < (count || 5); i++) {
      var row = el('div', 'ac-skel');
      row.style.animationDelay = (i * 90) + 'ms';
      wrap.appendChild(row);
    }
    host.appendChild(wrap);
  }

  /** A short highlight on an element that just changed. */
  function flash(node, kind) {
    if (!node || !motionOK()) return;
    var cls = 'ac-flash' + (kind ? ' ac-flash--' + kind : '');
    node.classList.remove('ac-flash', 'ac-flash--good', 'ac-flash--gold');
    // Reading offsetWidth restarts the animation when it fires twice quickly.
    void node.offsetWidth;
    node.className = node.className + ' ' + cls;
    global.setTimeout(function () {
      node.classList.remove('ac-flash', 'ac-flash--good', 'ac-flash--gold');
    }, 700);
  }

  /* --------------------------------------------------------------- toasts */

  function toastHost() {
    var host = doc.querySelector('.ac-toasts');
    if (!host) {
      host = el('div', 'ac-toasts ac-root');
      doc.body.appendChild(host);
    }
    return host;
  }

  function toast(message, kind, ms) {
    var t = el('div', 'ac-toast' + (kind ? ' ac-toast--' + kind : ''), message);
    toastHost().appendChild(t);
    global.setTimeout(function () {
      t.classList.add('is-out');
      global.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, ms || 3200);
    return t;
  }

  /* ---------------------------------------------------------------- modal */

  var openModalEl = null;

  function removeModalNow() {
    if (openModalEl && openModalEl.parentNode) openModalEl.parentNode.removeChild(openModalEl);
    openModalEl = null;
  }

  /** Dismiss with a fade. Replacing one modal with another skips it. */
  function closeModal() {
    if (!openModalEl) return;
    if (!motionOK()) { removeModalNow(); return; }
    var going = openModalEl;
    openModalEl = null;
    going.classList.add('is-closing');
    global.setTimeout(function () {
      if (going.parentNode) going.parentNode.removeChild(going);
    }, 180);
  }

  /**
   * @param opts { title, sub, wide, body(bodyEl, api), foot(footEl, api) }
   * The api handed to the builders is { close, setBody, box }.
   */
  function modal(opts) {
    removeModalNow();
    play('ui');
    var wrap = el('div', 'ac-modal ac-root');
    var box = el('div', 'ac-modal__box' + (opts.wide ? ' ac-modal__box--wide' : ''));

    var head = el('div', 'ac-modal__head');
    var titleWrap = el('div');
    titleWrap.style.flex = '1';
    var h = el('h2', 'ac-modal__title', opts.title || '');
    titleWrap.appendChild(h);
    if (opts.sub) titleWrap.appendChild(el('p', 'ac-modal__sub', opts.sub));
    head.appendChild(titleWrap);
    var x = el('button', 'ac-modal__x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closeModal);
    head.appendChild(x);
    box.appendChild(head);

    var body = el('div', 'ac-modal__body');
    box.appendChild(body);
    var foot = el('div', 'ac-modal__foot');
    box.appendChild(foot);

    var api = {
      close: closeModal,
      box: box,
      body: body,
      foot: foot,
      setTitle: function (t, s) {
        h.textContent = t;
        if (s !== undefined) {
          var p = titleWrap.querySelector('.ac-modal__sub');
          if (!p) { p = el('p', 'ac-modal__sub'); titleWrap.appendChild(p); }
          p.textContent = s;
        }
      }
    };

    if (opts.body) opts.body(body, api);
    if (opts.foot) opts.foot(foot, api);

    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) closeModal(); });
    wrap.appendChild(box);
    doc.body.appendChild(wrap);
    openModalEl = wrap;
    return api;
  }

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openModalEl) {
      e.stopPropagation();
      closeModal();
    }
  }, true);

  /* ----------------------------------------------------------- auth panel */

  function showAuth(initialTab) {
    if (!Arcade.isConfigured()) {
      showOffline();
      return;
    }

    var tab = initialTab === 'register' ? 'register' : 'signin';

    modal({
      title: 'Arcade account',
      sub: 'One account across every game in the arcade.',
      body: function (body, api) {
        var tabs = el('div', 'ac-tabs');
        var tSignIn = el('button', 'ac-tab', 'Sign in');
        var tRegister = el('button', 'ac-tab', 'Create account');
        tSignIn.type = tRegister.type = 'button';
        tabs.appendChild(tSignIn);
        tabs.appendChild(tRegister);
        body.appendChild(tabs);

        var form = el('form');
        form.setAttribute('novalidate', 'novalidate');
        body.appendChild(form);

        function render() {
          tSignIn.setAttribute('aria-selected', tab === 'signin' ? 'true' : 'false');
          tRegister.setAttribute('aria-selected', tab === 'register' ? 'true' : 'false');
          form.innerHTML = '';

          var errBox = el('div', 'ac-error ac-hidden');
          form.appendChild(errBox);

          var nameInput = null;
          if (tab === 'register') {
            nameInput = field(form, 'Display name', 'text', 'Shown on the leaderboards');
            nameInput.maxLength = Arcade.options.maxNameLength;
            nameInput.autocomplete = 'nickname';
          }
          var emailInput = field(form, 'Email', 'email', 'you@example.com');
          emailInput.autocomplete = 'email';
          var passInput = field(form, 'Password', 'password',
            tab === 'register' ? 'at least 6 characters' : '');
          passInput.autocomplete = tab === 'register' ? 'new-password' : 'current-password';

          var submit = btn(tab === 'register' ? 'Create account' : 'Sign in',
            'ac-btn--primary ac-btn--block ac-btn--lg');
          submit.type = 'submit';
          form.appendChild(submit);

          if (tab === 'signin') {
            var forgot = btn('Forgot password', 'ac-btn--ghost ac-btn--sm ac-btn--block', function () {
              if (!emailInput.value.trim()) { fail('Enter your email first, then press this again.'); return; }
              Arcade.auth.sendReset(emailInput.value).then(function () {
                ok('Reset email sent to ' + emailInput.value.trim() + '.');
              }).catch(function (e) { fail(Arcade.auth.describe(e)); });
            });
            forgot.style.marginTop = '8px';
            form.appendChild(forgot);
          }

          var note = el('div', 'ac-note');
          note.style.marginTop = '14px';
          note.textContent = tab === 'register'
            ? 'Your email is only used to sign in. Other players see your display name.'
            : 'Signed in on this device until you sign out.';
          form.appendChild(note);

          function fail(msg) {
            errBox.className = 'ac-error';
            errBox.textContent = msg;
          }
          function ok(msg) {
            errBox.className = 'ac-ok';
            errBox.textContent = msg;
          }

          form.addEventListener('submit', function (e) {
            e.preventDefault();
            errBox.className = 'ac-error ac-hidden';
            submit.disabled = true;
            var done = function () { submit.disabled = false; };

            var p = tab === 'register'
              ? Arcade.auth.register(emailInput.value, passInput.value, nameInput.value)
              : Arcade.auth.signIn(emailInput.value, passInput.value);

            p.then(function () {
              api.close();
              toast('Signed in as ' + Arcade.auth.displayName(), 'good');
            }).catch(function (err) {
              fail(Arcade.auth.describe(err));
              done();
            });
          });
        }

        tSignIn.addEventListener('click', function () { tab = 'signin'; render(); });
        tRegister.addEventListener('click', function () { tab = 'register'; render(); });
        render();
      }
    });
  }

  function field(form, label, type, placeholder) {
    var wrap = el('div', 'ac-field');
    var l = el('label', null, label);
    var input = el('input', 'ac-input');
    input.type = type;
    if (placeholder) input.placeholder = placeholder;
    var id = 'ac-f-' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    l.setAttribute('for', id);
    wrap.appendChild(l);
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
  }

  function showOffline() {
    modal({
      title: 'Arcade offline',
      sub: 'Accounts and leaderboards are not configured.',
      body: function (body) {
        var p = el('div', 'ac-note');
        p.innerHTML = 'Every game still plays exactly as it does online — ' +
          'runs, unlocks and records are kept in this browser.<br><br>' +
          'To switch the arcade on, drop a Firebase web config into ' +
          '<b>shared/js/arcade-config.js</b> and run <b>python tools/sync-shared.py</b>. ' +
          'Setup steps are in <b>ARCADE.md</b>.';
        body.appendChild(p);
      },
      foot: function (foot, api) { foot.appendChild(btn('Close', '', api.close)); }
    });
  }

  /* ---------------------------------------------------------- leaderboard */

  function leaderboardRows(host, data, game, metric) {
    host.innerHTML = '';

    if (data.offline) {
      host.appendChild(emptyNote('Leaderboards are offline. See ARCADE.md to connect a Firebase project.'));
      return;
    }
    if (data.error) {
      host.appendChild(emptyNote(data.error));
      return;
    }

    var head = el('div', 'ac-lb__head');
    head.appendChild(el('span', null, '#'));
    head.appendChild(el('span', null, 'Player'));
    head.appendChild(el('span', null, metric.label));
    host.appendChild(head);

    var list = el('div', 'ac-lb');
    if (!data.rows.length) {
      list.appendChild(emptyNote('Nothing on this board yet. Finish a run and it is yours.'));
    }
    stagger(list, data.rows.map(function (r) { return row(r, game); }));
    host.appendChild(list);

    // The player's own standing, when they are not already in the top rows.
    if (data.you && !data.youInTop) {
      var strip = el('div', 'ac-standing');
      var cap = el('div', 'ac-lb__head');
      cap.appendChild(el('span', null, ''));
      cap.appendChild(el('span', null, 'Your standing'));
      cap.appendChild(el('span', null, metric.label));
      strip.appendChild(el('div', 'ac-lb__gap', '···'));
      strip.appendChild(cap);
      strip.appendChild(row(data.you, game));
      host.appendChild(strip);
    } else if (!data.you && Arcade.auth.isSignedIn()) {
      host.appendChild(emptyNote('No ' + metric.label.toLowerCase() + ' recorded in ' +
        game.name + ' yet.'));
    } else if (!Arcade.auth.isSignedIn()) {
      var signin = el('div', 'ac-standing');
      var note = el('div', 'ac-note');
      note.style.textAlign = 'center';
      note.style.marginBottom = '10px';
      note.textContent = 'Sign in to post your scores and see your rank.';
      signin.appendChild(note);
      var b = btn('Sign in', 'ac-btn--primary ac-btn--block', function () { showAuth('signin'); });
      signin.appendChild(b);
      host.appendChild(signin);
    }
  }

  function row(r, game) {
    var n = el('div', 'ac-lb__row' + (r.you ? ' ac-lb__row--you' : '') +
      (r.rank <= 3 ? ' ac-lb__row--' + r.rank : ''));
    n.appendChild(el('span', 'ac-lb__rank', typeof r.rank === 'object' ? rankText(r.rank) : String(r.rank)));

    var nameCell = el('span', 'ac-lb__name', r.name + (r.you ? ' (you)' : ''));
    var bits = [];
    (game.metaFields || []).forEach(function (f) {
      if (r.meta && r.meta[f] !== undefined) bits.push(f + ' ' + r.meta[f]);
    });
    if (r.plays) bits.push(r.plays + (r.plays === 1 ? ' run' : ' runs'));
    if (bits.length) nameCell.appendChild(el('span', 'ac-lb__meta', bits.join(' · ')));
    n.appendChild(nameCell);

    var score = el('span', 'ac-lb__score', fmt(r.score));
    n.appendChild(score);
    // Your own row is the one worth drawing the eye to.
    if (r.you) countUp(score, 0, r.score, 700);
    return n;
  }

  function emptyNote(text) {
    return el('div', 'ac-lb__empty', text);
  }

  function showLeaderboard(gameId, metricId) {
    var id = gameId || currentGameId || (Arcade.games[0] && Arcade.games[0].id);
    var game = Arcade.gameById(id);
    var metric = Arcade.metricById(game, metricId);

    modal({
      wide: true,
      title: 'Leaderboard',
      sub: subtitle(),
      body: function (body, api) {
        function subtitleNow() { api.setTitle('Leaderboard', subtitle()); }

        // Game tabs, so the leaderboard reads as a platform surface rather
        // than a per-game one.
        var gameTabs = null;
        if (Arcade.games.length > 1) {
          gameTabs = el('div', 'ac-tabs');
          Arcade.games.forEach(function (g) {
            var t = el('button', 'ac-tab', g.name);
            t.type = 'button';
            t.dataset.game = g.id;
            t.setAttribute('aria-selected', g.id === id ? 'true' : 'false');
            t.addEventListener('click', function () {
              if (g.id === id) return;
              id = g.id;
              game = g;
              metric = Arcade.primaryMetric(game);   // each game has its own set
              Array.prototype.forEach.call(gameTabs.children, function (c) {
                c.setAttribute('aria-selected', c === t ? 'true' : 'false');
              });
              drawMetricTabs();
              subtitleNow();
              load();
            });
            gameTabs.appendChild(t);
          });
          body.appendChild(gameTabs);
        }

        /* One game can rank players several ways — a deep run and a huge
           single turn are different achievements — so the category is a
           first-class switch rather than a fixed column. */
        var metricTabs = el('div', 'ac-metrics');
        body.appendChild(metricTabs);

        function drawMetricTabs() {
          metricTabs.innerHTML = '';
          var all = Arcade.metricsOf(game);
          metricTabs.hidden = all.length < 2;
          all.forEach(function (m) {
            var t = el('button', 'ac-metric', m.label);
            t.type = 'button';
            t.setAttribute('aria-selected', m.id === metric.id ? 'true' : 'false');
            t.addEventListener('click', function () {
              if (m.id === metric.id) return;
              metric = m;
              Array.prototype.forEach.call(metricTabs.children, function (c) {
                c.setAttribute('aria-selected', c === t ? 'true' : 'false');
              });
              subtitleNow();
              load();
            });
            metricTabs.appendChild(t);
          });
        }

        var host = el('div');
        body.appendChild(host);

        function load() {
          var token = ++loadToken;
          host.innerHTML = '';
          skeleton(host, Arcade.options.topN);
          var forGame = game, forMetric = metric;
          Arcade.scores.board(id, null, metric.id).then(function (data) {
            if (token !== loadToken) return;   // a later switch already won
            leaderboardRows(host, data, forGame, forMetric);
          });
        }

        drawMetricTabs();
        load();
      },
      foot: function (foot, api) { foot.appendChild(btn('Close', '', api.close)); }
    });

    function subtitle() {
      return game.name + ' — top ' + Arcade.options.topN + ' by ' + metric.label.toLowerCase();
    }
  }

  /* -------------------------------------------------------- account panel */

  function showAccount() {
    if (!Arcade.auth.isSignedIn()) { showAuth('signin'); return; }

    modal({
      title: 'Your account',
      body: function (body, api) {
        var who = el('div');
        who.style.display = 'flex';
        who.style.alignItems = 'center';
        who.style.gap = '12px';
        who.style.marginBottom = '18px';
        var av = el('div', 'ac-avatar ac-avatar--lg', initials(Arcade.auth.displayName()));
        who.appendChild(av);
        var text = el('div');
        var nm = el('div', null, Arcade.auth.displayName());
        nm.style.fontWeight = '800';
        nm.style.fontSize = '16px';
        text.appendChild(nm);
        text.appendChild(el('div', 'ac-note', (Arcade.auth.user && Arcade.auth.user.email) || ''));
        who.appendChild(text);
        body.appendChild(who);

        /* rename */
        var form = el('form');
        var input = field(form, 'Display name', 'text', '');
        input.value = Arcade.auth.displayName();
        input.maxLength = Arcade.options.maxNameLength;
        var msg = el('div', 'ac-note');
        msg.style.marginBottom = '10px';
        form.appendChild(msg);
        var save = btn('Save name', 'ac-btn--sm', null);
        save.type = 'submit';
        form.appendChild(save);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          save.disabled = true;
          Arcade.auth.setDisplayName(input.value).then(function (n) {
            msg.textContent = 'Saved. Leaderboards now show ' + n + '.';
            save.disabled = false;
            refreshBar();
          }).catch(function (err) {
            msg.textContent = Arcade.auth.describe(err);
            save.disabled = false;
          });
        });
        body.appendChild(form);

        /* standings across every game */
        var standings = el('div');
        standings.style.marginTop = '20px';
        standings.appendChild(el('div', 'ac-cap', 'Your standing'));
        var list = el('div', 'ac-lb');
        list.style.marginTop = '8px';
        skeleton(list, Arcade.games.length);
        standings.appendChild(list);
        body.appendChild(standings);

        Arcade.scores.myStandings().then(function (all) {
          list.innerHTML = '';
          all.forEach(function (s) {
            var r = el('div', 'ac-lb__row');
            r.appendChild(el('span', 'ac-lb__rank', s.entry ? rankText(s.entry.rank) : '—'));
            var nameCell = el('span', 'ac-lb__name', s.game.name);
            nameCell.appendChild(el('span', 'ac-lb__meta', s.entry
              ? Arcade.primaryMetric(s.game).label + ' · ' + s.entry.plays +
                (s.entry.plays === 1 ? ' run' : ' runs')
              : 'no score yet'));
            r.appendChild(nameCell);
            r.appendChild(el('span', 'ac-lb__score', s.entry ? fmt(s.entry.score) : '—'));
            list.appendChild(r);
          });
        });
      },
      foot: function (foot, api) {
        foot.appendChild(btn('Leaderboards', '', function () { showLeaderboard(currentGameId); }));
        foot.appendChild(btn('Sign out', 'ac-btn--danger', function () {
          Arcade.auth.signOut().then(function () {
            api.close();
            toast('Signed out.', 'gold');
          });
        }));
      }
    });
  }

  /* --------------------------------------------------------- progression */

  /** An earned achievement deserves more than an ordinary toast. */
  function achievementToast(def) {
    var t = el('div', 'ac-toast ac-toast--achv');
    t.appendChild(el('div', 'ac-achv__mark', '★'));
    var body = el('div');
    body.appendChild(el('div', 'ac-achv__kicker', 'Achievement unlocked'));
    body.appendChild(el('div', 'ac-achv__name', def.label));
    t.appendChild(body);
    toastHost().appendChild(t);
    play('achievement');
    global.setTimeout(function () {
      t.classList.add('is-out');
      global.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 5200);
  }

  /**
   * The progression menu: what you have earned, what it buys, and what is left
   * to achieve. Deliberately apart from any run — nothing in here is reachable
   * mid-game, and nothing mid-game needs it.
   */
  function showProgress(gameId) {
    var id = gameId || currentGameId || (Arcade.games[0] && Arcade.games[0].id);
    var tab = 'unlocks';

    modal({
      wide: true,
      title: 'Progression',
      sub: 'Everything you keep between runs.',
      body: function (body) {
        var gameTabs = el('div', 'ac-tabs');
        Arcade.games.forEach(function (g) {
          var t = el('button', 'ac-tab', g.name);
          t.type = 'button';
          t.setAttribute('aria-selected', g.id === id ? 'true' : 'false');
          t.addEventListener('click', function () {
            if (g.id === id) return;
            id = g.id;
            Array.prototype.forEach.call(gameTabs.children, function (c) {
              c.setAttribute('aria-selected', c === t ? 'true' : 'false');
            });
            draw();
          });
          gameTabs.appendChild(t);
        });
        body.appendChild(gameTabs);

        var sectionTabs = el('div', 'ac-metrics');
        var SECTIONS = [['unlocks', 'Unlocks'], ['achievements', 'Achievements'], ['clears', 'Difficulty']];
        SECTIONS.forEach(function (pair) {
          var t = el('button', 'ac-metric', pair[1]);
          t.type = 'button';
          t.setAttribute('aria-selected', pair[0] === tab ? 'true' : 'false');
          t.addEventListener('click', function () {
            if (pair[0] === tab) return;
            tab = pair[0];
            Array.prototype.forEach.call(sectionTabs.children, function (c) {
              c.setAttribute('aria-selected', c === t ? 'true' : 'false');
            });
            draw();
          });
          sectionTabs.appendChild(t);
        });
        body.appendChild(sectionTabs);

        var host = el('div');
        body.appendChild(host);

        function draw() {
          host.innerHTML = '';
          if (tab === 'unlocks') drawUnlocks(host, id, draw);
          else if (tab === 'achievements') drawAchievements(host, id);
          else drawClears(host, id);
        }
        draw();
      },
      foot: function (foot, api) { foot.appendChild(btn('Close', '', api.close)); }
    });
  }

  function drawUnlocks(host, gameId, redraw) {
    var prog = Arcade.progressionOf(gameId);
    if (!prog) { host.appendChild(emptyNote('This game has no progression yet.')); return; }

    var bal = Arcade.progress.balance(gameId);
    var purse = el('div', 'ac-purse');
    purse.appendChild(el('span', 'ac-purse__icon', prog.currency.icon));
    var purseAmount = el('b', 'ac-purse__amount', fmt(bal));
    purse.appendChild(purseAmount);
    purse.appendChild(el('span', 'ac-purse__label', prog.currency.label + ' — earned by playing'));
    host.appendChild(purse);

    var list = el('div', 'ac-unlocks');
    var rows = [];
    prog.unlocks.forEach(function (u) {
      var owned = Arcade.progress.isUnlocked(gameId, u.id);
      var afford = bal >= u.cost;
      var row = el('div', 'ac-unlock' + (owned ? ' is-owned' : ''));

      var text = el('div', 'ac-unlock__text');
      text.appendChild(el('div', 'ac-unlock__name', u.label));
      text.appendChild(el('div', 'ac-unlock__desc', u.desc));
      row.appendChild(text);

      if (owned) {
        row.appendChild(el('span', 'ac-unlock__owned', 'Unlocked'));
      } else {
        var b = btn(prog.currency.icon + ' ' + u.cost,
          'ac-btn--sm' + (afford ? ' ac-btn--gold' : ''), function () {
            var had = Arcade.progress.balance(gameId);
            var res = Arcade.progress.buy(gameId, u.id);
            if (!res.ok) { play('deny'); toast(res.reason, 'bad'); return; }

            // Buying is the payoff of the whole progression system, so it gets
            // a moment: the purse counts down, the row turns over, it sounds.
            play('success');
            row.classList.add('is-owned', 'ac-bought');
            row.replaceChild(el('span', 'ac-unlock__owned', 'Unlocked'), b);
            countUp(purseAmount, had, Arcade.progress.balance(gameId), 500);
            flash(purseAmount, 'gold');
            toast('Unlocked ' + u.label, 'gold');
            // Redraw once the flourish has played, so the other rows catch up
            // on affordability without snatching this one away mid-animation.
            global.setTimeout(redraw, 820);
          });
        b.disabled = !afford;
        row.appendChild(b);
      }
      rows.push(row);
    });
    stagger(list, rows);
    host.appendChild(list);

    var note = el('div', 'ac-note');
    note.style.marginTop = 'var(--ac-s4)';
    note.textContent = 'Unlocks apply to every new run and are never lost.';
    host.appendChild(note);
  }

  function drawAchievements(host, gameId) {
    var p = Arcade.progress.achievementProgress();

    var head = el('div', 'ac-purse');
    head.appendChild(el('b', 'ac-purse__amount', p.earned + ' / ' + p.total));
    head.appendChild(el('span', 'ac-purse__label', 'earned across the arcade'));
    host.appendChild(head);

    var bar = el('div', 'ac-achvbar');
    var fill = el('div', 'ac-achvbar__fill');
    fill.style.width = motionOK() ? '0%' : p.pct + '%';
    bar.appendChild(fill);
    host.appendChild(bar);
    if (motionOK()) {
      global.setTimeout(function () { fill.style.width = p.pct + '%'; }, 60);
    }

    [{ id: gameId, label: Arcade.gameById(gameId).name },
     { id: null, label: 'Arcade-wide' }].forEach(function (grp) {
      var items = Arcade.progress.achievementsFor(grp.id);
      if (!items.length) return;
      host.appendChild(el('div', 'ac-cap ac-achv__group', grp.label));
      var list = el('div', 'ac-unlocks');
      items.forEach(function (a) {
        var got = Arcade.progress.hasAchievement(a.id);
        var row = el('div', 'ac-unlock ac-achv' + (got ? ' is-owned' : ''));
        row.appendChild(el('span', 'ac-achv__mark' + (got ? '' : ' is-locked'), got ? '★' : '☆'));
        var text = el('div', 'ac-unlock__text');
        text.appendChild(el('div', 'ac-unlock__name', a.label));
        text.appendChild(el('div', 'ac-unlock__desc',
          (a.secret && !got) ? 'Hidden — keep playing.' : a.desc));
        row.appendChild(text);
        list.appendChild(row);
      });
      host.appendChild(list);
    });
  }

  function drawClears(host, gameId) {
    var rows = Arcade.progress.clearsFor(gameId);
    var game = Arcade.gameById(gameId);
    if (rows.length < 2) {
      host.appendChild(emptyNote(game.name + ' runs at a single difficulty for now, ' +
        'so there is nothing to clear separately yet.'));
      return;
    }
    host.appendChild(el('div', 'ac-cap', 'Cleared at'));
    var list = el('div', 'ac-unlocks');
    rows.forEach(function (r) {
      var row = el('div', 'ac-unlock' + (r.cleared ? ' is-owned' : ''));
      var text = el('div', 'ac-unlock__text');
      text.appendChild(el('div', 'ac-unlock__name', r.label));
      row.appendChild(text);
      row.appendChild(el('span', r.cleared ? 'ac-unlock__owned' : 'ac-note',
        r.cleared ? 'Cleared' : 'Not yet'));
      list.appendChild(row);
    });
    host.appendChild(list);
  }

  /* ------------------------------------------------------------ arcade bar */

  function gameHref(g) {
    if (g.id === currentGameId) return null;
    return Arcade.gameUrl(g);
  }

  function toggleSwitcher() {
    if (switcher) { closeSwitcher(); return; }
    switcher = el('div', 'ac-switch ac-root');
    switcher.appendChild(el('div', 'ac-switch__title ac-cap', 'Roguelike Arcade'));
    Arcade.games.forEach(function (g) {
      var href = gameHref(g);
      var a = doc.createElement('a');
      if (href) a.href = href;
      else a.setAttribute('aria-current', 'true');
      a.appendChild(el('span', 'ac-switch__glyph', g.glyph));
      var label = el('span', null, g.name);
      label.appendChild(el('span', 'ac-switch__sub', g.id === currentGameId ? 'you are here' : g.tagline));
      a.appendChild(label);
      switcher.appendChild(a);
    });
    var hub = doc.createElement('a');
    hub.href = Arcade.hubHref();
    hub.appendChild(el('span', 'ac-switch__glyph', '◆'));
    var hubLabel = el('span', null, 'Arcade hub');
    hubLabel.appendChild(el('span', 'ac-switch__sub', 'all games, all boards'));
    hub.appendChild(hubLabel);
    switcher.appendChild(hub);

    doc.body.appendChild(switcher);
    global.setTimeout(function () { doc.addEventListener('mousedown', outside); }, 0);
  }

  function outside(e) {
    if (switcher && !switcher.contains(e.target) && bar && !bar.contains(e.target)) closeSwitcher();
  }

  function closeSwitcher() {
    if (switcher && switcher.parentNode) switcher.parentNode.removeChild(switcher);
    switcher = null;
    doc.removeEventListener('mousedown', outside);
  }

  function mountBar() {
    if (mounted) return bar;
    mounted = true;

    bar = el('div', 'ac-bar ac-root');

    /* The wordmark goes home, the caret opens the switcher — the ordinary web
       convention. Before this the mark did both jobs and the hub was two
       clicks deep inside something labelled "switch game", which is not where
       anyone looks for "back". */
    var brand = el('div', 'ac-bar__brand');
    var onHub = !currentGameId;

    var mark = el(onHub ? 'div' : 'a', 'ac-bar__mark' + (onHub ? ' is-here' : ''));
    mark.appendChild(el('span', 'ac-bar__diamond'));
    mark.appendChild(el('span', null, 'Arcade'));
    if (onHub) {
      mark.title = 'You are at the arcade hub';
    } else {
      mark.href = Arcade.hubHref();
      mark.title = 'Back to the arcade hub';
      mark.setAttribute('aria-label', 'Back to the arcade hub');
    }
    brand.appendChild(mark);

    var caret = el('button', 'ac-bar__caret', '▾');
    caret.type = 'button';
    caret.title = 'Switch game';
    caret.setAttribute('aria-label', 'Switch game');
    caret.setAttribute('aria-haspopup', 'true');
    caret.addEventListener('click', function (e) { e.stopPropagation(); toggleSwitcher(); });
    brand.appendChild(caret);

    bar.appendChild(brand);

    var prog = el('button', 'ac-bar__btn', 'Progress');
    prog.type = 'button';
    prog.title = 'Unlocks, achievements and difficulty clears';
    prog.addEventListener('click', function () { showProgress(currentGameId); });
    bar.appendChild(prog);

    var lb = el('button', 'ac-bar__btn', 'Leaderboard');
    lb.type = 'button';
    lb.addEventListener('click', function () { showLeaderboard(currentGameId); });
    bar.appendChild(lb);

    var account = el('button', 'ac-bar__btn');
    account.type = 'button';
    account.addEventListener('click', function () {
      if (!Arcade.isConfigured()) showOffline();
      else if (Arcade.auth.isSignedIn()) showAccount();
      else showAuth('signin');
    });
    bar.appendChild(account);
    bar._account = account;

    doc.body.appendChild(bar);
    refreshBar();
    Arcade.auth.onChange(refreshBar);
    measureBar();
    return bar;
  }

  /**
   * Publish the bar's real size as --ac-bar-w / --ac-bar-h.
   *
   * The bar is fixed to the top-right of a game that knows nothing about it,
   * and its width changes with the signed-in player's name. Games reserve room
   * with `calc(var(--ac-bar-w) + …)` rather than guessing a number that goes
   * stale the moment someone signs in with a longer name.
   */
  function measureBar() {
    if (!bar) return;
    var apply = function () {
      var r = bar.getBoundingClientRect();
      var root = doc.documentElement.style;
      root.setProperty('--ac-bar-w', Math.ceil(r.width) + 'px');
      root.setProperty('--ac-bar-h', Math.ceil(r.height) + 'px');
    };
    apply();
    if (global.ResizeObserver) new global.ResizeObserver(apply).observe(bar);
    else global.addEventListener('resize', apply);
  }

  /** Redraw the account button for the current auth state. */
  function refreshBar() {
    if (!bar) return;
    var b = bar._account;
    b.innerHTML = '';
    var st = Arcade.auth.status;

    if (!Arcade.isConfigured()) {
      b.className = 'ac-bar__btn';
      b.appendChild(el('span', null, 'Offline'));
      b.title = 'Accounts are not configured — see ARCADE.md';
      return;
    }
    if (st === 'connecting' || st === 'idle') {
      b.className = 'ac-bar__btn';
      b.appendChild(el('span', null, 'Connecting…'));
      return;
    }
    if (Arcade.auth.isSignedIn()) {
      var name = Arcade.auth.displayName();
      b.className = 'ac-bar__btn ac-bar__btn--signed';
      b.appendChild(el('span', 'ac-avatar', initials(name)));
      b.appendChild(el('span', null, name));
      b.title = 'Your account';
    } else {
      b.className = 'ac-bar__btn';
      b.appendChild(el('span', null, 'Sign in'));
      b.title = 'Sign in to post scores';
    }
  }

  /* ------------------------------------------------- in-game entry points */

  /**
   * A row of arcade buttons a game can append to its own menu or end screen.
   * Uses `.ac-btn`, so it looks the same in all three games.
   */
  function inlineActions(opts) {
    opts = opts || {};
    var row = el('div', 'ac-inline ac-root');

    /* A real link, not a button: middle-click and "open in new tab" should
       work the way they do anywhere else. Leftmost, so the brand sits in the
       same place here as it does in the bar. */
    if (opts.hub !== false) {
      var home = el('a', 'ac-btn ac-btn--sm ac-btn--home');
      home.href = Arcade.hubHref();
      home.appendChild(el('span', 'ac-bar__diamond'));
      home.appendChild(el('span', null, opts.hubLabel || 'Arcade'));
      row.appendChild(home);
    }

    row.appendChild(btn(opts.leaderboardLabel || 'Leaderboard', 'ac-btn--sm', function () {
      showLeaderboard(opts.gameId || currentGameId);
    }));
    row.appendChild(btn('Progress', 'ac-btn--sm', function () {
      showProgress(opts.gameId || currentGameId);
    }));
    var accountBtn = btn('', 'ac-btn--sm', function () {
      if (!Arcade.isConfigured()) showOffline();
      else if (Arcade.auth.isSignedIn()) showAccount();
      else showAuth('signin');
    });
    row.appendChild(accountBtn);

    function sync() {
      accountBtn.textContent = !Arcade.isConfigured() ? 'Arcade offline'
        : Arcade.auth.isSignedIn() ? Arcade.auth.displayName()
        : 'Sign in';
    }
    sync();
    var off = Arcade.auth.onChange(sync);
    // Games rebuild their overlays freely; drop the listener when the node goes.
    if (global.MutationObserver) {
      var mo = new global.MutationObserver(function () {
        if (!doc.body.contains(row)) { off(); mo.disconnect(); }
      });
      mo.observe(doc.body, { childList: true, subtree: true });
    }
    return row;
  }

  Arcade.ui = {
    mountBar: mountBar,
    setSound: setSound,
    countUp: countUp,
    flash: flash,
    motionOK: motionOK,
    showProgress: showProgress,
    achievementToast: achievementToast,
    refreshBar: refreshBar,
    showAuth: showAuth,
    showAccount: showAccount,
    showLeaderboard: showLeaderboard,
    showOffline: showOffline,
    inlineActions: inlineActions,
    toast: toast,
    modal: modal,
    closeModal: closeModal,
    button: btn,
    fmt: fmt,
    rankText: rankText,
    setGame: function (id) { currentGameId = id; }
  };
})(typeof window !== 'undefined' ? window : this);
