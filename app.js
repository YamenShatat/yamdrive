/* Luma Drive: the Luma UI over a Google Drive library (a folder holding "movies" and "series").
   Video plays natively and the library is read natively (window.Native, see MainActivity.java
   and Drive.java); this page is the UI, driven by touch. */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var CHUNK = 40; // grid items rendered per step; more are added while scrolling

  // In a desktop browser (no Android side) everything still renders, with an empty library.
  if (!window.Native) document.documentElement.style.background = '#0b0f14';
  var N = window.Native || {
    play: function () {}, stop: function () {}, exit: function () {}, toast: function () {},
    signIn: function () {}, folders: function () {}, loadCatalog: function () {},
    api: function () { return null; }, url: function () { return ''; },
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage full */ } },
    search: function () { return '{}'; }, recent: function () { return '[]'; },
    counts: function () { return '{"l":0,"m":0,"s":0}'; }
  };

  // ---------- small helpers ----------

  function $(s, root) { return (root || document).querySelector(s); }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(d) {
    var h = d.getHours(), ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }
  function hms(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
  }
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }

  // Saved state lives on the Android side, written to disk at once.
  var store = {
    get: function (k, d) {
      try { var v = N.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set: function (k, v) { N.set(k, JSON.stringify(v)); }
  };

  // Tabler icons (MIT), outline set.
  var P = {
    home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
    movie: '<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12"/><path d="M8 4l0 16"/><path d="M16 4l0 16"/><path d="M4 8l4 0"/><path d="M4 16l4 0"/><path d="M4 12l16 0"/><path d="M16 8l4 0"/><path d="M16 16l4 0"/>',
    stack: '<path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
    star: '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"/>',
    bookmark: '<path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4"/>',
    sparkles: '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"/>',
    settings: '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',
    search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    chev: '<path d="M6 9l6 6l6 -6"/>',
    play: '<path d="M7 4v16l13 -8l-13 -8"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    folder: '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"/>',
    plus: '<path d="M12 5l0 14"/><path d="M5 12l14 0"/>',
    user: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
    logout: '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
    trash: '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>'
  };
  function ic(n, cls) {
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + P[n] + '</svg>';
  }
  // The yamDRIVE mark (yamtv_logo.svg): a play button with a y cut through it and a comet orbit.
  // Its colours read --lg* (button) and --lp* (orbit), which applyAccent sets from the accent
  // colour; app.css holds the logo's own cyan as the default. The dark strokes are the page
  // background, the gap where the comet passes in front of the button.
  var LOGO = '<svg viewBox="36 114 440 296"><defs>' +
    '<linearGradient id="ymPlay" gradientUnits="userSpaceOnUse" x1="80" y1="60" x2="440" y2="470"><stop style="stop-color:var(--lg1)"/><stop offset=".55" style="stop-color:var(--lg2)"/><stop offset="1" style="stop-color:var(--lg3)"/></linearGradient>' +
    '<linearGradient id="ymRing" gradientUnits="userSpaceOnUse" x1="40" y1="120" x2="470" y2="400"><stop style="stop-color:var(--lp1)"/><stop offset=".55" style="stop-color:var(--lp2)"/><stop offset="1" style="stop-color:var(--lp3)"/></linearGradient>' +
    '<linearGradient id="ymTail" gradientUnits="userSpaceOnUse" x1="-222" y1="0" x2="222" y2="0"><stop style="stop-color:var(--lp1)" stop-opacity="0"/><stop offset=".6" style="stop-color:var(--lp2)" stop-opacity=".7"/><stop offset="1" style="stop-color:var(--lp2)"/></linearGradient>' +
    '<mask id="ymCut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/><path d="M146 136L246 278L342 136M246 278Q214 330 150 372" fill="none" stroke="#000" stroke-width="18"/></mask></defs>' +
    '<g transform="translate(256 262) rotate(-24)"><path d="M-222 0A222 74 0 0 1 222 0" fill="none" stroke="url(#ymTail)" stroke-width="22" stroke-linecap="round"/></g>' +
    '<path d="M186 142L186 382L372 262Z" fill="url(#ymPlay)" stroke="url(#ymPlay)" stroke-width="48" stroke-linejoin="round" mask="url(#ymCut)"/>' +
    '<g transform="translate(256 262) rotate(-24)" fill="none"><path d="M222 0A222 74 0 0 1 60 71" style="stroke:var(--bg)" stroke-width="44" stroke-linecap="round"/>' +
    '<path d="M222 0A222 74 0 0 1 60 71" stroke="url(#ymRing)" stroke-width="22" stroke-linecap="round"/>' +
    '<circle cx="60" cy="71" r="30" style="fill:var(--bg)"/><circle cx="60" cy="71" r="20" style="fill:var(--lp1)"/></g></svg>';

  // ---------- state ----------

  var acct = store.get('acct', null);          // { name, root }: the chosen Drive folder
  var user = store.get('user', null);          // this device's username; its data lives in Drive
  var picking = false;                         // signing in to choose a folder (not the start-up check)
  var bootAt = Date.now();
  var prefs = store.get('prefs', {});

  // Accent colour (Settings > Appearance). All light enough for the dark text used on accent fills.
  // The native parts (player bar, dialogs) read prefs.accent from the same saved prefs.
  var ACCENTS = [
    ['#66d9e8', 'Cyan (default)'], ['#ec92e5', 'Purple'], ['#b197fc', 'Violet'], ['#74c0fc', 'Blue'],
    ['#63e6be', 'Teal'], ['#8ce99a', 'Green'], ['#ffd43b', 'Yellow'], ['#ffa94d', 'Orange'], ['#ff8787', 'Red']
  ];
  function applyAccent(hex) {
    var n = parseInt(hex.slice(1), 16), rgb = (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255);
    var s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-rgb', rgb);
    s.setProperty('--accent-soft', 'rgba(' + rgb + ', 0.18)');
    // Logo: light-to-deep shades of the accent, which read as that colour in every case.
    var h = hueOf(n), sat = Math.max(satOf(n), 70), L = { lg1: 73, lg2: 61, lg3: 51, lp1: 80, lp2: 69, lp3: 63 };
    for (var k in L) {
      s.setProperty('--' + k, 'hsl(' + h + ', ' + sat + '%, ' + L[k] + '%)');
    }
  }
  function rgbOf(n) { return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function hueOf(n) {
    var c = rgbOf(n), M = Math.max(c[0], c[1], c[2]), d = M - Math.min(c[0], c[1], c[2]);
    if (!d) return 0;
    var h = M === c[0] ? ((c[1] - c[2]) / d) % 6 : M === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }
  function satOf(n) {
    var c = rgbOf(n), M = Math.max(c[0], c[1], c[2]), m = Math.min(c[0], c[1], c[2]), l = (M + m) / 2;
    return M === m ? 0 : Math.round(100 * (M - m) / (1 - Math.abs(2 * l - 1)));
  }
  if (/^#[0-9a-f]{6}$/i.test(prefs.accent || '')) applyAccent(prefs.accent);
  var favs = store.get('favs', []);            // [{ k, id, n, i, e, c }]
  var later = store.get('later', []);
  // 'm<id>' | 'e<id>' -> { p, d } in ms. Written by MainActivity every few seconds while playing.
  var progress = {};
  var lastEp = store.get('lastEp', {});        // series id -> { s, id, num }
  var cw = store.get('cw', []);                // continue watching: slim items + t, newest first
  function reloadWatch() { progress = store.get('progress', {}); }
  reloadWatch();
  // After a user switch, MainActivity has replaced these with the user's file from Drive.
  function reloadUserData() {
    favs = store.get('favs', []);
    later = store.get('later', []);
    lastEp = store.get('lastEp', {});
    cw = store.get('cw', []);
    reloadWatch();
  }
  var catalogReady = false;
  var counts = { m: 0, s: 0 };
  var cats = {};    // 'vod' | 'series' -> category list
  var lists = {};   // same keys -> { key, items } for the most recent category only
  var nowPlaying = null; // { item, eps? } of the movie/series in the player

  var main, side, modal;
  var cur = { v: null, a: null };
  var hist = [];
  var gen = 0; // bumped on every render; late replies for an old view are dropped

  // ---------- library ----------

  // Answered by Drive.java in the Xtream shapes this UI was written for.
  function api(action, extra, cb) {
    setTimeout(function () {
      var d = null;
      try { d = JSON.parse(N.api(action, extra || '')); } catch (e) { /* no reply */ }
      if (d == null) cb(catalogReady ? 'Not in the library.' : 'The library is still loading…');
      else cb(null, d);
    }, 0);
  }

  function categories(kind, cb) {
    if (cats[kind]) return cb(null, cats[kind]);
    api('get_' + kind + '_categories', '', function (err, d) {
      if (err) return cb(err);
      cats[kind] = isArr(d) ? d : [];
      cb(null, cats[kind]);
    });
  }
  var LIST = { vod: ['get_vod_streams', 'm'], series: ['get_series', 's'] };
  var CW = '__cw'; // the "Continue watching" category, built locally
  function items(kind, cat, cb) {
    if (cat === CW) return cb(null, cwItems(LIST[kind][1]));
    var key = kind + ':' + cat;
    if (lists[kind] && lists[kind].key === key) return cb(null, lists[kind].items);
    api(LIST[kind][0], '&category_id=' + encodeURIComponent(cat), function (err, d) {
      if (err) return cb(err);
      var out = [];
      each(isArr(d) ? d : [], function (o) { out.push(norm(LIST[kind][1], o)); });
      lists[kind] = { key: key, items: out };
      cb(null, out);
    });
  }
  // One item shape everywhere: library rows, search results, favorites.
  function norm(k, o) {
    return {
      k: k,
      id: +(o.stream_id || o.series_id || 0),
      n: String(o.name || ''),
      i: o.cover || '',
      e: o.container_extension || '',
      c: String(o.category_id || ''),
      r: o.rating || '',
      y: String(o.releaseDate || ''),
      t: +(o.added || o.last_modified || 0)
    };
  }
  function catName(kind, id) {
    if (id === CW) return 'Continue watching';
    var l = cats[kind] || [];
    for (var i = 0; i < l.length; i++) if (String(l[i].category_id) === String(id)) return l[i].category_name;
    return '';
  }

  function loadCatalog(force) {
    catalogReady = false;
    N.loadCatalog(acct.root, !!force);
  }

  // ---------- favorites / watch later ----------

  function keyOf(it) { return it.k + it.id; }
  function slim(it) { return { k: it.k, id: it.id, n: it.n, i: it.i, e: it.e, c: it.c, r: it.r }; }
  function has(list, it) {
    for (var i = 0; i < list.length; i++) if (keyOf(list[i]) === keyOf(it)) return i;
    return -1;
  }
  function toggle(name, it) {
    var list = name === 'favs' ? favs : later, i = has(list, it);
    if (i >= 0) list.splice(i, 1); else list.unshift(slim(it));
    store.set(name, list);
    return i < 0;
  }

  // ---------- continue watching ----------

  function touchCw(it) {
    var i = has(cw, it);
    if (i >= 0) cw.splice(i, 1);
    var s = slim(it);
    s.t = Date.now();
    cw.unshift(s);
    if (cw.length > 60) cw.length = 60;
    store.set('cw', cw);
  }
  function dropCw(it) {
    var i = has(cw, it);
    if (i >= 0) { cw.splice(i, 1); store.set('cw', cw); }
  }
  // Movies stay while they have a resume point; series until their last episode is finished.
  function cwItems(k) {
    var out = [];
    each(cw, function (it) { if (it.k === k && (k !== 'm' || progress['m' + it.id])) out.push(it); });
    return out;
  }

  // ---------- toast / modal ----------

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2600);
  }

  var modalCb = null;
  function pick(title, opts, current, cb) {
    var h = '<div class="sheet"><div class="h">' + esc(title) + '</div><div class="opts scroller">';
    each(opts, function (o, i) {
      h += '<button class="f opt' + (String(o.v) === String(current) ? ' on' : '') + '" data-o="' + i + '">' + esc(o.t) + '</button>';
    });
    modal.innerHTML = h + '</div></div>';
    showModal();
    modalCb = function (i) { closeModal(); cb(opts[i].v); };
  }
  function showModal() { modal.style.display = 'block'; }
  function closeModal() {
    modal.style.display = 'none';
    modal.innerHTML = '';
    modalCb = null;
  }

  // ---------- routing ----------

  var NAV = [
    ['home', 'Home', 'home'], ['movies', 'Movies', 'movie'], ['series', 'Series', 'stack'],
    ['favorites', 'Favorites', 'star'], ['later', 'Watch later', 'bookmark'], ['recent', 'Recently added', 'sparkles']
  ];
  var NAV_OF = { movie: 'movies', show: 'series', login: 'home' };

  function go(v, a) {
    if (cur.v) hist.push({ v: cur.v, a: cur.a, r: snapshot() });
    if (hist.length > 30) hist.shift();
    show(v, a, null);
  }
  function show(v, a, restore) {
    cur = { v: v, a: a };
    gen++;
    var nav = NAV_OF[v] || v;
    each(side.querySelectorAll('.nav'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-go') === nav);
    });
    main.className = 'v-' + v;
    main.scrollTop = 0;
    grid = null;
    reloadWatch();
    VIEWS[v](a, restore);
  }
  // Where the page was scrolled to, and how much of its grid was drawn, to come back to it.
  function snapshot() { return { top: main.scrollTop, shown: grid ? grid.shown : 0 }; }
  // Views call this once their content is on screen.
  function settle(r) { if (r) main.scrollTop = r.top; }

  // ---------- shared markup ----------

  function head(title, sub) {
    return '<h1 class="ttl"><span>' + esc(title.charAt(0)) + '</span>' + esc(title.slice(1)) + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '');
  }
  function selBtn(id, label, value, cls) {
    return '<button class="f sel ' + (cls || '') + '" id="' + id + '"><span class="lbl">' + esc(label) +
      '</span><span class="val">' + esc(value) + '</span>' + ic('chev') + '</button>';
  }
  function searchBox(id, ph, cls) {
    return '<div class="box ' + (cls || '') + '">' + ic('search') + '<input class="f" id="' + id + '" type="text" placeholder="' +
      esc(ph) + '" autocomplete="off" spellcheck="false"></div>';
  }
  function setVal(id, text) { var b = document.getElementById(id); if (b) $('.val', b).textContent = text; }

  function card(it, i, act, opts) {
    opts = opts || {};
    var le = it.k === 's' && opts.cw ? lastEp[it.id] : null;
    var pr = it.k === 'm' ? progress['m' + it.id] : le ? progress['e' + le.id] : null;
    var sub = le && le.num ? 'Season ' + le.s + ' · Episode ' + le.num
      : opts.cw && pr && pr.d ? Math.max(1, Math.round((pr.d - pr.p) / 60000)) + ' min left'
      : opts.sub != null ? opts.sub : it.y ? it.y.slice(0, 4) : '';
    return '<div class="f card" data-act="' + act + '" data-i="' + i + '">' +
      '<div class="poster"><span class="ph">' + esc(it.n.replace(/^[^\wÀ-ɏ؀-ۿ]+/, '').charAt(0)) + '</span>' +
      (it.i ? '<img src="' + esc(it.i) + '" onerror="this.style.display=\'none\'">' : '') +
      (opts.badge ? '<span class="badge">' + (it.k === 'm' ? 'MOVIE' : 'SERIES') + '</span>' : '') +
      (it.r ? '<span class="rate">' + ic('star', 'fill') + esc(it.r) + '</span>' : '') +
      (pr && pr.d ? '<span class="prog"><i style="width:' + Math.round(100 * pr.p / pr.d) + '%"></i></span>' : '') +
      '</div><div class="meta"><div class="t" dir="auto">' + esc(it.n) + '</div><div class="s">' + esc(sub || ' ') + '</div></div></div>';
  }

  // A grid that renders CHUNK cards at a time and adds more as you scroll near its end.
  var grid = null;
  function mountGrid(el, list, act, opts, shown) {
    grid = { el: el, list: list, act: act, opts: opts, shown: 0 };
    el.innerHTML = '';
    growGrid(Math.max(CHUNK, shown || 0));
  }
  function growGrid(upTo) {
    if (!grid || !document.body.contains(grid.el)) return;
    var end = Math.min(grid.list.length, upTo), h = '';
    for (var i = grid.shown; i < end; i++) h += card(grid.list[i], i, grid.act, grid.opts);
    if (h) grid.el.insertAdjacentHTML('beforeend', h);
    grid.shown = end;
  }
  function onScroll() {
    if (grid && main.scrollTop + main.clientHeight > main.scrollHeight - 800) growGrid(grid.shown + CHUNK);
  }

  // Taps are routed by data-act (actions), data-go (pages) and data-o (picker options).
  var ACTS = {};
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-go],[data-o]') : null;
    if (!el) {
      if (modalCb && e.target === modal) closeModal(); // a tap outside the sheet closes it
      return;
    }
    if (el.hasAttribute('data-o') && modalCb) { modalCb(+el.getAttribute('data-o')); return; }
    if (el.hasAttribute('data-go')) {
      hist = [];
      show(el.getAttribute('data-go'), null, null);
      return;
    }
    var fn = ACTS[el.getAttribute('data-act')];
    if (fn) fn(el, +el.getAttribute('data-i'));
  });

  function open(it) { go(it.k === 'm' ? 'movie' : 'show', it); }

  // ---------- views ----------

  var VIEWS = {};

  // Home: the hero tiles and "Recently added".
  VIEWS.home = function (a, r) {
    if (!acct) return VIEWS.login(a, r);
    if (!user) return VIEWS.who(a, r);
    var d = new Date(), h = d.getHours();
    var greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
    main.innerHTML =
      '<div class="hero">' +
      '<button class="f tile big" data-go="movies"><div class="eyebrow">' + greet + ' · ' + clock(d) +
      (counts.m ? ' · ' + num(counts.m) + (counts.m === 1 ? ' movie' : ' movies') : '') + '</div>' + ic('movie', 'big-ic') +
      '<div class="h">Movies</div><div class="p">Browse the library.</div></button>' +
      '<div class="side">' +
      '<button class="f tile" data-go="series">' + ic('stack') + '<div class="h">Series</div><div class="p">Shows and full seasons.</div></button>' +
      '<button class="f tile" data-go="later">' + ic('bookmark') + '<div class="h">Watch later</div><div class="p">Saved for later.</div></button>' +
      '</div></div>' +
      '<div id="cwhome"></div>' +
      '<div class="sec-h"><h2>Recently added</h2><button class="f link" data-go="recent">View all ›</button></div>' +
      '<div id="homerail"></div>';
    cwRail();
    homeRail();
    settle(r);
  };
  // Continue watching, above Recently added, only when there is something in it: movies with
  // a resume point and series not yet finished, newest first (as the Movies/Series category).
  var cwHome = [];
  function cwRail() {
    var el = $('#cwhome');
    if (!el) return;
    cwHome = [];
    each(cw, function (it) { if (it.k === 's' || progress['m' + it.id]) cwHome.push(it); });
    var h = '';
    each(cwHome, function (it, i) { h += card(it, i, 'homecw', { badge: true, cw: true }); });
    el.innerHTML = h ? '<div class="sec-h"><h2>Continue watching</h2></div><div class="rail">' + h + '</div>' : '';
  }
  ACTS.homecw = function (el, i) { open(cwHome[i]); };
  var homeItems = [];
  function homeRail() {
    var el = $('#homerail');
    if (!el) return;
    if (!catalogReady) { el.innerHTML = '<div class="spin">Loading your library… (the first start takes a minute)</div>'; return; }
    homeItems = JSON.parse(N.recent('ms', 20));
    var h = '';
    each(homeItems, function (it, i) { h += card(it, i, 'home', { badge: true, sub: '' }); });
    el.className = 'rail';
    el.innerHTML = h || '<div class="spin">Nothing yet.</div>';
  }
  ACTS.home = function (el, i) { open(homeItems[i]); };

  // Welcome: connect Google Drive, then pick the library folder.
  VIEWS.login = function (a, r) {
    main.innerHTML = '<div class="panel welcome"><div class="eyebrow">WELCOME</div>' +
      '<div class="big">Pick something to<br>watch.</div>' +
      '<p>Connect Google Drive, then choose the folder that holds your <b>movies</b> and <b>series</b> folders.</p>' +
      '<button class="f btn primary" data-act="gsign">' + ic('folder') + 'Connect Google Drive</button>' +
      '<div class="fine" id="lmsg">&nbsp;</div></div>';
    settle(r);
  };
  function status(msg) {
    var el = $('#lmsg');
    if (el) el.textContent = msg; else toast(msg);
  }
  ACTS.gsign = function () { picking = true; status('Waiting for Google…'); N.signIn(); };

  // Who's watching: pick a username or create one. No password: it is for friends who share a
  // library. Each name's data is a file in the library's "Luma users" folder in Drive.
  var pendingUser = null;

  // The names this device has logged in to, per library, newest first. Switch user offers only
  // these: the other names in Drive are never listed.
  var seen = store.get('seenUsers', {}) || {};
  function seenHere() { return (acct && seen[acct.root]) || []; }
  function remember(name, drop) {
    if (!acct) return;
    var l = seenHere().filter(function (n) { return n !== name && n !== drop; });
    if (name) l.unshift(name);
    seen[acct.root] = l;
    store.set('seenUsers', seen);
  }
  if (user) remember(user);
  ACTS.uswitch = function () {
    var names = seenHere(), opts = [];
    each(names, function (n, i) { opts.push({ v: i, t: n === user ? n + ' (now)' : n }); });
    opts.push({ v: -1, t: 'Another user…' });
    pick('Switch user', opts, names.indexOf(user), function (i) {
      if (i < 0) { show('who', null, null); return; }
      if (names[i] === user) return;
      toast('Switching to ' + names[i] + '…');
      chooseUser(names[i], false); // sends this user's last changes first
    });
  };
  ACTS.uquick = function (el) { chooseUser(el.getAttribute('data-n'), false); };

  VIEWS.who = function (a, r) {
    var mine = seenHere().filter(function (n) { return n !== user; });
    main.innerHTML = head('Log in', 'Enter your username. What you watch follows it to any device.') +
      (mine.length ? '<h2>On this device</h2><div class="chips">' + mine.map(function (n) {
        return '<button class="f chip" data-act="uquick" data-n="' + esc(n) + '">' + ic('user') + esc(n) + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="panel who">' +
      '<div class="box">' + ic('user') + '<input class="f" id="uname" type="text" maxlength="24" placeholder="Username" autocomplete="off" spellcheck="false"></div>' +
      '<div class="err" id="uerr">&nbsp;</div>' +
      '<div class="who-btns"><button class="f btn primary" data-act="ulogin">Log in</button>' +
      '<button class="f btn" data-act="ucreate">' + ic('plus') + 'Create account</button></div></div>';
    N.users(acct.root); // for quick "no such user" / "already taken" answers
    settle(r);
  };
  ACTS.ulogin = function () {
    var name = cleanName('#uname'), e = $('#uerr');
    if (!name) { e.textContent = 'Type your username first.'; return; }
    // Capitals do not matter: log in as the name as it was created.
    for (var i = 0; i < knownUsers.length; i++) if (knownUsers[i].toLowerCase() === name.toLowerCase()) name = knownUsers[i];
    chooseUser(name, false);
  };
  var knownUsers = [];
  function chooseUser(name, create) {
    pendingUser = name;
    var e = $('#uerr');
    if (e) e.textContent = (create ? 'Creating ' : 'Logging in as ') + name + '…';
    N.selectUser(acct.root, name, !!create);
  }
  // Names are unique whatever their capitals: "Yamen" and "yamen" are the same name. The list
  // on screen gives a quick answer; MainActivity checks Drive again before creating.
  function nameError(name, self) {
    if (!name) return 'Type a username first.';
    if (/['"\\\/]/.test(name)) return 'A username cannot contain quotes or slashes.';
    for (var i = 0; i < knownUsers.length; i++) {
      if (knownUsers[i].toLowerCase() === name.toLowerCase() && knownUsers[i] !== self) return '“' + knownUsers[i] + '” is already taken.';
    }
    return '';
  }
  function cleanName(id) { return $(id).value.replace(/\s+/g, ' ').trim(); }
  ACTS.ucreate = function () {
    var name = cleanName('#uname'), msg = nameError(name, null);
    if (msg) { $('#uerr').textContent = msg + (msg.indexOf('taken') > 0 ? ' If it is yours, tap Log in.' : ''); return; }
    chooseUser(name, true);
  };
  // A full sync now, its result shown in the "Last sync" line (and the error, when there is one).
  ACTS.syncnow = function () {
    var el = $('#syncline');
    if (el) el.textContent = 'Last sync: syncing…';
    pendingUser = user;
    N.selectUser(acct.root, user, false);
  };
  ACTS.ulogout = function () { toast('Saving and logging out…'); N.logOut(); };
  ACTS.udelete = function () {
    modal.innerHTML = '<div class="sheet dlg"><div class="h">Delete ' + esc(user) + '?</div>' +
      '<p>Their continue watching, favorites and watch later are removed. The file goes to the Drive bin, where it can be restored for 30 days.</p>' +
      '<div class="dlg-btns"><button class="f btn danger" data-act="udeleteok">Delete</button>' +
      '<button class="f btn" data-act="exitno">Cancel</button></div></div>';
    showModal();
    modalCb = function () {};
  };
  ACTS.udeleteok = function () {
    closeModal();
    toast('Deleting ' + user + '…');
    N.deleteUser(acct.root, user);
  };
  ACTS.urename = function () {
    var name = cleanName('#rname'), msg = nameError(name, user);
    if (name === user) return;
    if (msg) { $('#rerr').textContent = msg; return; }
    $('#rerr').textContent = 'Saving…';
    pendingUser = name;
    N.renameUser(acct.root, user, name);
  };

  // Movies and Series: category, search and sort over a poster grid.
  var gridState = { vod: { cat: store.get('vodCat', null), q: '', sort: 'az', all: [] }, series: { cat: store.get('seriesCat', null), q: '', sort: 'az', all: [] } };
  var GSORT = [{ v: 'az', t: 'A → Z' }, { v: 'za', t: 'Z → A' }, { v: 'new', t: 'Recently added' }, { v: 'rate', t: 'Rating' }];
  function sortName(list, v) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].t; return ''; }

  var keepCat = false; // set when the user picked a category, so it is not replaced below
  function catalogView(kind, r) {
    var st = gridState[kind], my = gen, title = kind === 'vod' ? 'Movies' : 'Series', noun = kind === 'vod' ? 'movies' : 'series';
    var total = kind === 'vod' ? counts.m : counts.s;
    // "Continue watching" comes first and opens by default whenever it has something in it.
    var hasCw = cwItems(LIST[kind][1]).length > 0;
    if (!r && !keepCat && hasCw) st.cat = CW;
    keepCat = false;
    if (st.cat === CW && !hasCw) st.cat = store.get(kind + 'Cat', null);
    main.innerHTML = head(title, (total ? '<b>' + num(total) + '</b> in your library<i class="sep"></i>' : '') + '<span id="gcatname">…</span>') +
      '<div class="filters">' + selBtn('gcat', 'Show', '…', 'w1') + searchBox('gq', 'Search ' + noun + '…') +
      selBtn('gsort', 'Sort', sortName(GSORT, st.sort)) + '</div><div class="count" id="gcount">&nbsp;</div><div class="grid" id="grid"><div class="spin">Loading…</div></div>';
    var q = $('#gq');
    q.value = st.q;
    q.oninput = debounce(function () { st.q = q.value; applyGrid(kind, null); }, 350);
    $('#gcat').onclick = function () {
      var opts = hasCw ? [{ v: CW, t: catName(kind, CW) }] : [];
      each(cats[kind] || [], function (c) { opts.push({ v: c.category_id, t: c.category_name }); });
      pick('Show', opts, st.cat, function (v) {
        st.cat = v;
        if (v !== CW) store.set(kind + 'Cat', v);
        st.q = '';
        keepCat = true;
        show(cur.v, null, null);
      });
    };
    $('#gsort').onclick = function () {
      pick('Sort', GSORT, st.sort, function (v) { st.sort = v; setVal('gsort', sortName(GSORT, v)); applyGrid(kind, null); });
    };
    categories(kind, function (err, list) {
      if (my !== gen) return;
      if (err) return fail('#grid', err);
      if (!catName(kind, st.cat)) st.cat = list.length ? list[0].category_id : null;
      setVal('gcat', catName(kind, st.cat));
      $('#gcatname').textContent = catName(kind, st.cat);
      items(kind, st.cat, function (err2, arr) {
        if (my !== gen) return;
        if (err2) return fail('#grid', err2);
        st.all = arr;
        applyGrid(kind, r);
      });
    });
  }
  function applyGrid(kind, r) {
    var st = gridState[kind], q = st.q.toLowerCase(), out = [];
    each(st.all, function (it) { if (!q || it.n.toLowerCase().indexOf(q) >= 0) out.push(it); });
    if (st.cat !== CW) {
      if (st.sort === 'new') out.sort(function (a, b) { return b.t - a.t; });
      else if (st.sort === 'rate') out.sort(function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); });
      else out.sort(function (a, b) { return a.n.localeCompare(b.n); });
      if (st.sort === 'za') out.reverse();
    }
    st.list = out;
    $('#gcount').textContent = num(out.length) + ' of ' + num(st.all.length) + (kind === 'vod' ? ' movies' : ' series');
    var g = $('#grid');
    mountGrid(g, out, 'g' + kind, { cw: st.cat === CW }, r ? r.shown : 0);
    if (!out.length) g.innerHTML = '<div class="spin">' + (catalogReady ? 'Nothing here.' : 'Loading your library…') + '</div>';
    settle(r);
  }
  VIEWS.movies = function (a, r) { catalogView('vod', r); };
  VIEWS.series = function (a, r) { catalogView('series', r); };
  ACTS.gvod = function (el, i) { go('movie', gridState.vod.list[i]); };
  ACTS.gseries = function (el, i) { go('show', gridState.series.list[i]); };

  // Movie detail.
  VIEWS.movie = function (it, r) {
    var my = gen;
    detailFrame(it, '');
    movieButtons(it);
    settle(r);
    api('get_vod_info', '&vod_id=' + it.id, function (err, d) {
      if (my !== gen || err || !d || !d.info) return;
      fillDetail(d.info, [d.info.releasedate, d.info.genre]);
    });
  };
  function movieButtons(it) {
    var pr = progress['m' + it.id], el = $('#dacts');
    if (!el) return;
    el.innerHTML = (pr ? '<button class="f btn primary" data-act="mplay" data-i="1">' + ic('play') + 'Resume ' + hms(pr.p) + '</button>' +
      '<button class="f btn" data-act="mplay" data-i="0">' + ic('refresh') + 'From start</button>'
      : '<button class="f btn primary" data-act="mplay" data-i="0">' + ic('play') + 'Play</button>') + listButtons(it);
  }
  ACTS.mplay = function (el, resume) {
    var it = cur.a, pr = progress['m' + it.id];
    nowPlaying = { item: it };
    touchCw(it);
    N.play(JSON.stringify({
      index: 0, start: resume && pr ? pr.p : 0,
      items: [{ url: N.url(it.id), id: 'm' + it.id, title: it.n }]
    }));
  };
  function listButtons(it) {
    var f = has(favs, it) >= 0, w = has(later, it) >= 0;
    return '<button class="f btn' + (f ? ' on' : '') + '" data-act="dfav">' + ic('star', f ? 'fill' : '') + 'Favorite</button>' +
      '<button class="f btn' + (w ? ' on' : '') + '" data-act="dlater">' + ic('bookmark', w ? 'fill' : '') + 'Watch later</button>';
  }
  ACTS.dfav = function (el) {
    var on = toggle('favs', cur.a);
    el.className = 'f btn' + (on ? ' on' : '');
    el.innerHTML = ic('star', on ? 'fill' : '') + 'Favorite';
  };
  ACTS.dlater = function (el) {
    var on = toggle('later', cur.a);
    el.className = 'f btn' + (on ? ' on' : '');
    el.innerHTML = ic('bookmark', on ? 'fill' : '') + 'Watch later';
  };
  function detailFrame(it, extra) {
    main.innerHTML = '<div class="detail"><div class="backdrop" id="dback">' +
      (it.i ? '<img src="' + esc(it.i) + '" onerror="this.style.display=\'none\'">' : '') + '</div><div class="dwrap">' +
      '<div class="dposter"><div class="poster">' + (it.i ? '<img src="' + esc(it.i) + '" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
      '<div class="dinfo"><h1 dir="auto">' + esc(it.n) + '</h1><div class="dmeta" id="dmeta"></div>' +
      '<div class="dacts" id="dacts"></div><div class="plot" id="dplot" dir="auto"></div></div></div></div>' + extra;
  }
  // Rating, the given facts, the plot, and TMDB's backdrop when there is one.
  function fillDetail(inf, meta) {
    var m = $('#dmeta'), h = cur.a.r ? '<span>' + ic('star', 'fill') + ' ' + esc(cur.a.r) + '</span>' : '';
    each(meta, function (x) { if (x) h += '<span>' + esc(x) + '</span>'; });
    if (m) m.innerHTML = h;
    if ($('#dplot')) $('#dplot').textContent = inf.plot || '';
    if (inf.backdrop_path && $('#dback')) $('#dback').innerHTML = '<img src="' + esc(inf.backdrop_path) + '" onerror="this.style.display=\'none\'">';
  }

  // Series detail: seasons and episodes.
  var showState = { seasons: [], eps: {}, season: null };
  VIEWS.show = function (it, r) {
    var my = gen;
    detailFrame(it, '<div class="seasons" id="seasons"></div><div id="eps"><div class="spin">Loading episodes…</div></div>');
    $('#dacts').innerHTML = '<button class="f btn primary" data-act="splay">' + ic('play') + 'Play</button>' + listButtons(it);
    api('get_series_info', '&series_id=' + it.id, function (err, d) {
      if (my !== gen) return;
      if (err || !d) return fail('#eps', err || 'No episodes.');
      var map = d.episodes || {}, seasons = [];
      for (var s in map) if (map.hasOwnProperty(s) && isArr(map[s]) && map[s].length) seasons.push(s);
      seasons.sort(function (a, b) { return a - b; });
      showState = { seasons: seasons, eps: map, season: null };
      var le = lastEp[it.id];
      showState.season = le && map[le.s] ? le.s : seasons[0];
      var n = 0;
      each(seasons, function (x) { n += map[x].length; });
      var inf = d.info || {};
      fillDetail(inf, [inf.releasedate, seasons.length + (seasons.length === 1 ? ' season' : ' seasons'), n + (n === 1 ? ' episode' : ' episodes'), inf.genre]);
      var b = $('[data-act="splay"]');
      if (b && le) b.innerHTML = ic('play') + 'Continue S' + le.s + ' E' + (epById(le.id) || {}).episode_num;
      renderSeasons();
      settle(r);
    });
  };
  function epById(id) {
    var found = null;
    each(showState.seasons, function (s) { each(showState.eps[s], function (e) { if (+e.id === +id) found = e; }); });
    return found;
  }
  function renderSeasons() {
    var h = '';
    each(showState.seasons, function (s) {
      h += '<button class="f chip' + (s === showState.season ? ' on' : '') + '" data-act="season" data-s="' + esc(s) + '">Season ' + esc(s) + '</button>';
    });
    $('#seasons').innerHTML = h;
    var le = lastEp[cur.a.id], out = '';
    each(showState.eps[showState.season] || [], function (e, i) {
      var inf = e.info || {}, pr = progress['e' + e.id], still = inf.movie_image || cur.a.i;
      out += '<div class="f ep' + (le && +le.id === +e.id ? ' last' : '') + '" data-act="ep" data-i="' + i + '">' +
        '<div class="th">' + (still ? '<img src="' + esc(still) + '" onerror="this.style.display=\'none\'">' : '') +
        (pr && pr.d ? '<span class="prog"><i style="width:' + Math.round(100 * pr.p / pr.d) + '%"></i></span>' : '') + '</div>' +
        '<div><div class="no">EPISODE ' + esc(e.episode_num) + (inf.duration ? ' · ' + esc(inf.duration) : '') +
        (pr && pr.d ? ' · ' + Math.max(1, Math.round((pr.d - pr.p) / 60000)) + ' min left' : '') + '</div>' +
        '<div class="nm" dir="auto">' + esc(e.title || 'Episode ' + e.episode_num) + '</div><div class="pl" dir="auto">' + esc(inf.plot || '') + '</div>' +
        (e.file_name ? '<div class="fn" dir="auto">' + esc(e.file_name) + '</div>' : '') + '</div></div>';
    });
    $('#eps').innerHTML = out || '<div class="spin">No episodes in this season.</div>';
  }
  ACTS.season = function (el) {
    showState.season = el.getAttribute('data-s');
    renderSeasons();
  };
  ACTS.ep = function (el, i) { playEpisode(showState.season, showState.eps[showState.season][i]); };
  ACTS.splay = function () {
    var le = lastEp[cur.a.id], e = le && epById(le.id);
    if (e) return playEpisode(le.s, e);
    var s = showState.seasons[0];
    if (s) playEpisode(s, showState.eps[s][0]);
  };
  // The whole series goes to the player as one playlist, season after season, so previous/next
  // and the automatic next episode cross season boundaries.
  function playEpisode(season, e) {
    var it = cur.a, pr = progress['e' + e.id], list = [], eps = [], index = 0;
    each(showState.seasons, function (s) {
      each(showState.eps[s], function (x) {
        if (+x.id === +e.id) index = list.length;
        eps.push({ s: s, id: x.id, num: x.episode_num });
        list.push({ url: N.url(x.id), id: 'e' + x.id, title: it.n + '\nSeason ' + s + ' · Episode ' + x.episode_num });
      });
    });
    nowPlaying = { item: it, eps: eps };
    touchCw(it);
    setLastEp(it.id, eps[index]);
    N.play(JSON.stringify({ index: index, start: pr ? pr.p : 0, items: list }));
  }
  // The open show page after its progress changed (a video stopped, or another device's newer
  // copy arrived): the Continue button, the season it points at, and the episode list.
  function refreshShow() {
    if (cur.v !== 'show' || !$('#eps')) return;
    var le = lastEp[cur.a.id], b = $('[data-act="splay"]');
    if (le && showState.eps[le.s]) showState.season = le.s;
    if (b) b.innerHTML = ic('play') + (le ? 'Continue S' + le.s + ' E' + le.num : 'Play');
    renderSeasons();
  }
  function setLastEp(seriesId, ep) {
    lastEp[seriesId] = ep;
    store.set('lastEp', lastEp);
  }

  // Search across the library.
  var srch = { q: '', f: 'ms', res: {} };
  VIEWS.search = function (a, r) {
    main.innerHTML = head('Find anything', 'Movies and series in your library.') +
      searchBox('sq', 'Search movies, series…', 'bigsearch') +
      '<div class="chips" id="schips"></div><div id="sres"></div>';
    var q = $('#sq');
    q.value = srch.q;
    q.oninput = debounce(function () { srch.q = q.value; runSearch(); }, 350);
    runSearch();
    settle(r);
  };
  function runSearch() {
    var chips = [['ms', 'All'], ['m', 'Movies'], ['s', 'Series']], h = '';
    each(chips, function (c) { h += '<button class="f chip' + (srch.f === c[0] ? ' on' : '') + '" data-act="sfilter" data-f="' + c[0] + '">' + c[1] + '</button>'; });
    $('#schips').innerHTML = h;
    var box = $('#sres'), q = srch.q.trim();
    if (!q) { box.innerHTML = '<div class="hint">Search your library.<small>Type a title above.</small></div>'; return; }
    if (!catalogReady) { box.innerHTML = '<div class="hint">Your library is still loading…<small>Search works as soon as it is ready.</small></div>'; return; }
    srch.res = JSON.parse(N.search(q, srch.f, srch.f.length > 1 ? 10 : 60));
    var out = '', names = { m: 'Movies', s: 'Series' };
    each(['m', 's'], function (k) {
      var r = srch.res[k];
      if (!r || !r.items.length) return;
      out += '<div class="sres-h"><h2>' + names[k] + '</h2><span>' + num(r.total) + (r.total > r.items.length ? ' matches, showing ' + r.items.length : ' matches') + '</span></div><div class="grid">';
      each(r.items, function (it, i) { out += card(it, i, 's' + k, { sub: '' }); });
      out += '</div>';
    });
    box.innerHTML = out || '<div class="hint">No matches for “' + esc(q) + '”.</div>';
  }
  ACTS.sfilter = function (el) { srch.f = el.getAttribute('data-f'); runSearch(); };
  ACTS.sm = function (el, i) { open(srch.res.m.items[i]); };
  ACTS.ss = function (el, i) { open(srch.res.s.items[i]); };

  // Favorites, Watch later and Recently added share one layout: chips over a grid.
  var pageFilter = { favorites: '', later: '', recent: '' };
  var pageItems = [];
  function listPage(v, title, sub, all, emptyText, r) {
    var f = pageFilter[v], h = '<div class="chips">';
    var names = { '': 'All', m: 'Movies', s: 'Series' };
    each(['', 'm', 's'], function (k) {
      var n = 0;
      each(all, function (it) { if (!k || it.k === k) n++; });
      h += '<button class="f chip' + (f === k ? ' on' : '') + '" data-act="pfilter" data-f="' + k + '">' + names[k] + '<span class="n">' + n + '</span></button>';
    });
    pageItems = [];
    each(all, function (it) { if (!f || it.k === f) pageItems.push(it); });
    main.innerHTML = head(title, sub) + h + '</div>' +
      (pageItems.length ? '<div class="grid" id="grid"></div>' : '<div class="panel empty">' + emptyText + '</div>');
    if (pageItems.length) mountGrid($('#grid'), pageItems, 'page', { badge: v === 'recent', sub: '' }, r ? r.shown : 0);
    settle(r);
  }
  ACTS.pfilter = function (el) { pageFilter[cur.v] = el.getAttribute('data-f'); show(cur.v, null, null); };
  ACTS.page = function (el, i) { open(pageItems[i]); };
  VIEWS.favorites = function (a, r) {
    listPage('favorites', 'Favorites', 'Every starred movie and series.', favs,
      'No favorites yet. Star a movie or series to see it here.', r);
  };
  VIEWS.later = function (a, r) {
    listPage('later', 'Watch later', 'Movies and series you saved for later.', later,
      'Nothing saved yet. Use “Watch later” on a movie or series.', r);
  };
  VIEWS.recent = function (a, r) {
    if (!catalogReady) {
      main.innerHTML = head('Recently added', 'The newest movies and series in your library.') + '<div class="panel empty">Your library is still loading…</div>';
      return settle(r);
    }
    listPage('recent', 'Recently added', 'The newest movies and series in your library.', JSON.parse(N.recent('ms', 100)), 'Nothing yet.', r);
  };

  // Settings.
  VIEWS.settings = function (a, r) {
    if (acct) N.users(acct.root); // for the "already taken" check when renaming
    main.innerHTML = head('Settings', 'Library, appearance, and the app itself.') + '<div class="set">' +
      '<h2>Library</h2><div class="panel">' +
      (acct ? '<div class="acct"><span class="xt">GD</span><div style="flex:1"><div class="n">' + esc(acct.name) + '</div>' +
        '<div class="u">Google Drive folder</div></div></div>' : '') +
      '<button class="f btn" data-act="refresh">' + ic('refresh') + 'Refresh library</button>' +
      '<button class="f btn" data-act="gsign">' + ic('folder') + 'Change folder</button></div>' +
      '<h2>User</h2><div class="panel">' +
      (user ? '<div class="acct"><span class="xt">' + esc(user.charAt(0).toUpperCase()) + '</span><div style="flex:1"><div class="n">' + esc(user) + '</div>' +
        '<div class="u">Continue watching, favorites and watch later follow this name to any device.</div>' +
        '<div class="u" id="syncline">Last sync: ' + esc(N.syncStatus ? N.syncStatus() || 'not yet' : 'not yet') + '</div></div></div>' +
        '<button class="f btn" data-act="syncnow">' + ic('refresh') + 'Sync now</button>' +
        '<button class="f btn" data-act="uswitch">' + ic('user') + 'Switch user</button>' +
        '<div class="rename"><div class="box">' + ic('user') + '<input class="f" id="rname" type="text" maxlength="24" value="' + esc(user) + '" autocomplete="off" spellcheck="false"></div>' +
        '<button class="f btn" data-act="urename">Change username</button></div><div class="err" id="rerr">&nbsp;</div>' : '') +
      '<button class="f btn" data-act="ulogout">' + ic('logout') + 'Log out</button>' +
      (user ? '<button class="f btn danger" data-act="udelete">' + ic('trash') + 'Delete user</button>' : '') + '</div>' +
      '<h2>Appearance</h2><div class="panel"><div class="setrow"><div class="l"><b>Accent color</b><small>Used everywhere: highlights, the player and dialogs.</small></div>' +
      '<div class="swatches">' + ACCENTS.map(function (c) {
        var on = (prefs.accent || ACCENTS[0][0]).toLowerCase() === c[0];
        return '<button class="f sw' + (on ? ' on' : '') + '" data-act="accent" data-c="' + c[0] + '" title="' + c[1] + '" style="background:' + c[0] + '"></button>';
      }).join('') + '</div></div></div>' +
      '<h2>Data</h2><div class="panel">' +
      '<button class="f btn danger" data-act="clear" data-f="favs">' + ic('trash') + 'Clear favorites</button>' +
      '<button class="f btn danger" data-act="clear" data-f="later">' + ic('trash') + 'Clear watch later</button>' +
      '<button class="f btn danger" data-act="clear" data-f="cw">' + ic('trash') + 'Clear watching now</button></div>' +
      '<h2>About</h2><div class="panel">' +
      '<div class="kv"><b>yamDRIVE</b> ' + VERSION + (N.build ? ' · web build ' + N.build : '') + '</div>' +
      '<div class="kv"><b>Details</b> This product uses the TMDB API but is not endorsed or certified by TMDB.</div>' +
      '<div class="kv"><b>Library</b> ' + (catalogReady ? num(counts.m) + ' movies · ' + num(counts.s) + ' series' : 'loading…') + '</div></div></div>';
    settle(r);
  };
  ACTS.refresh = function () {
    if (!acct) return;
    cats = {}; lists = {};
    loadCatalog(true);
    toast('Refreshing the library…');
  };
  ACTS.accent = function (el) {
    var c = el.getAttribute('data-c');
    prefs.accent = c;
    store.set('prefs', prefs);
    applyAccent(c);
    each(main.querySelectorAll('.sw'), function (b) { b.classList.toggle('on', b === el); });
    for (var i = 0; i < ACCENTS.length; i++) if (ACCENTS[i][0] === c) toast('Accent: ' + ACCENTS[i][1]);
  };
  // Settings > Data: a box listing Favorites, Watch later or Watching now, searchable by name and
  // filterable by type; tapping ticks items and "Clear selected" removes only the ticked ones.
  var MGR = {
    favs: { title: 'Favorites', list: function () { return favs; } },
    later: { title: 'Watch later', list: function () { return later; } },
    cw: { title: 'Watching now', list: function () { reloadWatch(); return cwItems('m').concat(cwItems('s')); } }
  };
  var KIND_NAME = { m: 'Movie', s: 'Series' };
  var mgr = null;
  ACTS.clear = function (el) {
    var f = el.getAttribute('data-f'), def = MGR[f];
    mgr = { f: f, all: def.list().slice(), q: '', kind: '', sel: {}, shown: [] };
    modal.innerHTML = '<div class="sheet mgr"><div class="h">' + esc(def.title) + '</div>' +
      searchBox('mq', 'Search by name…') + '<div class="chips" id="mchips"></div>' +
      '<div class="opts scroller" id="mlist"></div><div class="dlg-btns">' +
      '<button class="f btn" data-act="mall" id="mall">Select all</button>' +
      '<button class="f btn danger" data-act="mclear" id="mclear">Clear selected (0)</button>' +
      '<button class="f btn" data-act="mclose">Cancel</button></div></div>';
    showModal();
    modalCb = function () {};
    var q = $('#mq');
    q.oninput = debounce(function () { mgr.q = q.value; mgrList(); }, 250);
    mgrList();
  };
  function mgrList() {
    var q = mgr.q.trim().toLowerCase(), chips = '', rows = '';
    each(['', 'm', 's'], function (k) {
      var n = 0;
      each(mgr.all, function (it) { if (!k || it.k === k) n++; });
      chips += '<button class="f chip' + (mgr.kind === k ? ' on' : '') + '" data-act="mkind" data-f="' + k + '">' +
        (k ? KIND_NAME[k] : 'All') + '<span class="n">' + n + '</span></button>';
    });
    mgr.shown = [];
    each(mgr.all, function (it) {
      if ((mgr.kind && it.k !== mgr.kind) || (q && it.n.toLowerCase().indexOf(q) < 0)) return;
      mgr.shown.push(it);
      var key = keyOf(it);
      rows += '<div class="f mrow ' + it.k + (mgr.sel[key] ? ' on' : '') + '" data-act="mrow" data-k="' + esc(key) + '">' +
        '<span class="ck">✓</span><span class="mth">' + (it.i ? '<img src="' + esc(it.i) + '" onerror="this.style.display=\'none\'">' : '') +
        '</span><span class="mnm" dir="auto">' + esc(it.n) + '</span><span class="mkd">' + KIND_NAME[it.k] + '</span></div>';
    });
    $('#mchips').innerHTML = chips;
    $('#mlist').innerHTML = rows || '<div class="spin">' + (mgr.all.length ? 'Nothing matches.' : 'Nothing here yet.') + '</div>';
    mgrCount();
  }
  function mgrCount() {
    var n = 0, all = mgr.shown.length > 0;
    for (var k in mgr.sel) if (mgr.sel.hasOwnProperty(k)) n++;
    each(mgr.shown, function (it) { if (!mgr.sel[keyOf(it)]) all = false; });
    $('#mclear').textContent = 'Clear selected (' + n + ')';
    $('#mall').textContent = all ? 'Unselect all' : 'Select all';
  }
  ACTS.mrow = function (el) {
    var key = el.getAttribute('data-k');
    if (mgr.sel[key]) delete mgr.sel[key]; else mgr.sel[key] = true;
    el.classList.toggle('on', !!mgr.sel[key]);
    mgrCount();
  };
  ACTS.mkind = function (el) {
    mgr.kind = el.getAttribute('data-f');
    mgrList();
  };
  ACTS.mall = function () {
    var all = true;
    each(mgr.shown, function (it) { if (!mgr.sel[keyOf(it)]) all = false; });
    each(mgr.shown, function (it) { if (all) delete mgr.sel[keyOf(it)]; else mgr.sel[keyOf(it)] = true; });
    each(modal.querySelectorAll('.mrow'), function (r) { r.classList.toggle('on', !!mgr.sel[r.getAttribute('data-k')]); });
    mgrCount();
  };
  ACTS.mclose = function () { closeModal(); };
  ACTS.mclear = function () {
    var sel = mgr.sel, n = 0;
    function keep(it) { return !sel[keyOf(it)]; }
    for (var k in sel) if (sel.hasOwnProperty(k)) n++;
    if (!n) { toast('Tick something to clear first.'); return; }
    if (mgr.f === 'favs') { favs = favs.filter(keep); store.set('favs', favs); }
    if (mgr.f === 'later') { later = later.filter(keep); store.set('later', later); }
    if (mgr.f === 'cw') {
      // Leaving "Watching now" also forgets the saved minute and, for a series, the last episode.
      reloadWatch();
      each(cw, function (it) {
        if (keep(it)) return;
        if (it.k === 'm') delete progress['m' + it.id];
        if (it.k === 's' && lastEp[it.id]) { delete progress['e' + lastEp[it.id].id]; delete lastEp[it.id]; }
      });
      cw = cw.filter(keep);
      store.set('cw', cw);
      store.set('lastEp', lastEp);
      store.set('progress', progress);
    }
    closeModal();
    toast('Removed ' + n + (n === 1 ? ' item.' : ' items.'));
  };

  function fail(sel, msg) {
    var el = $(sel);
    if (el) el.innerHTML = '<div class="spin">' + esc(msg) + '</div>';
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ---------- sidebar ----------

  function renderSide() {
    var h = '<div class="brand">' + LOGO + '<b><span>y</span>amDRIVE</b></div>' +
      '<button class="f nav search-btn" data-go="search">' + ic('search') + 'Search</button>';
    each(NAV, function (n) { h += '<button class="f nav" data-go="' + n[0] + '">' + ic(n[2]) + n[1] + '</button>'; });
    h += '<div class="side-fill"></div>';
    if (acct && user) h += '<button class="f nav provider" data-act="uswitch" title="Switch user"><span class="xt">' + esc(user.charAt(0).toUpperCase()) + '</span><span class="name">' + esc(user) + '</span>' + ic('chev') + '</button>';
    h += '<div class="side-sep"></div><button class="f nav" data-go="settings">' + ic('settings') + 'Settings</button>';
    side.innerHTML = h;
    each(side.querySelectorAll('.nav'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-go') === (NAV_OF[cur.v] || cur.v));
    });
  }

  // ---------- called by MainActivity ----------

  // Back on Home asks first; Back while it is open just closes it.
  function confirmExit() {
    modal.innerHTML = '<div class="sheet dlg"><div class="h">Exit yamDRIVE?</div>' +
      '<p>Are you sure you want to exit?</p><div class="dlg-btns">' +
      '<button class="f btn primary" data-act="exitok">OK</button>' +
      '<button class="f btn" data-act="exitno">Cancel</button></div></div>';
    showModal();
    modalCb = function () {};
  }
  ACTS.exitok = function () { N.exit(); };
  ACTS.exitno = function () { closeModal(); };

  // Closing the on-screen keyboard (Back) also lets go of the search box, so the next Back
  // goes back a page instead of landing on a box that still looks active. The page shrinks
  // while the keyboard is up and grows back when it closes.
  var fullHeight = window.innerHeight;
  window.addEventListener('resize', function () {
    var a = document.activeElement;
    if (window.innerHeight >= fullHeight - 40 && a && a.tagName === 'INPUT') a.blur();
    fullHeight = Math.max(fullHeight, window.innerHeight);
  });

  var App = window.App = {
    back: function () {
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT') { a.blur(); return; }
      if (modalCb) { closeModal(); return; }
      if (hist.length) {
        var h = hist.pop();
        show(h.v, h.a, h.r);
        return;
      }
      if (cur.v !== 'home') { show('home', null, null); return; }
      confirmExit();
    },
    onSignIn: function (ok, msg) {
      if (!ok) { status(msg || 'Sign-in failed.'); return; }
      if (picking) {
        status('Finding your folders…');
        N.folders();
        return;
      }
      // Start-up check passed (it asks again only when the app needs a new permission):
      // bring this device's user up to date from their file in Drive.
      if (user) { pendingUser = user; N.selectUser(acct.root, user, false); }
    },
    // The names are only for quick checks on the page; they are never listed.
    onUsers: function (json, err) {
      if (!err) knownUsers = JSON.parse(json);
    },
    // The app came back to the front: pick up what this user watched on another device
    // meanwhile (also with a video left open; nothing is redrawn under it). Not right after
    // start, which already did it.
    onResume: function () {
      if (!acct || !user || Date.now() - bootAt < 10000) return;
      pendingUser = user;
      N.selectUser(acct.root, user, false);
    },
    // A later change from another device replaced this device's copy: redraw with it (not over
    // a playing video; the next page drawn uses it anyway).
    onSynced: function () {
      reloadUserData();
      if (nowPlaying) return;
      if (cur.v === 'movie') movieButtons(cur.a);
      else if (cur.v === 'show') refreshShow();
      else if (cur.v !== 'who') show(cur.v, cur.a, snapshot());
    },
    onLoggedOut: function (err) {
      if (err) { toast(err); return; }
      user = null;
      reloadUserData();
      renderSide();
      hist = [];
      show('who', null, null);
    },
    onDeleteUser: function (ok, msg) {
      if (!ok) { toast('Could not delete: ' + msg); return; }
      toast(user + ' was deleted');
      remember(null, user);
      user = null;
      reloadUserData();
      renderSide();
      hist = [];
      show('who', null, null);
    },
    onRename: function (ok, msg) {
      if (!ok) { var e = $('#rerr'); if (e) e.textContent = msg; else toast(msg); return; }
      remember(pendingUser, user);
      user = pendingUser;
      renderSide();
      if (cur.v === 'settings') show('settings', null, null);
      toast('Username changed to ' + user);
    },
    // MainActivity has put the user's data from Drive in place (or reports why it could not).
    onUser: function (ok, msg) {
      if (!ok) {
        var e = $('#uerr');
        if (e) e.textContent = msg; else toast(msg);
        return;
      }
      var switched = user !== pendingUser;
      user = pendingUser;
      remember(user);
      reloadUserData();
      renderSide();
      if (switched || cur.v === 'who') { hist = []; show('home', null, null); }
      else if (cur.v !== 'movie' && cur.v !== 'show') show(cur.v, cur.a, snapshot());
    },
    // The folders that hold a "movies" or "series" folder; the chosen one becomes the library.
    onFolders: function (json, err) {
      if (err) { status('Could not list your folders: ' + err); return; }
      var list = JSON.parse(json), opts = [];
      if (!list.length) { status('No folder with a "movies" or "series" folder inside was found in your Drive.'); return; }
      status('');
      each(list, function (f, i) { opts.push({ v: i, t: f.name }); });
      pick('Choose your library folder', opts, -1, function (i) {
        picking = false;
        // Another library has its own users: the device picks a name again.
        if (!acct || acct.root !== list[i].id) { user = null; store.set('user', null); }
        acct = { name: list[i].name, root: list[i].id };
        store.set('acct', acct);
        cats = {}; lists = {};
        counts = { m: 0, s: 0 };
        renderSide();
        loadCatalog(true);
        hist = [];
        show('home', null, null);
      });
    },
    onPlayerError: function (msg) { toast('Playback failed. ' + msg); },
    // The player moved to another item of the playlist (next/previous episode, or on its own).
    onItem: function (index) {
      var np = nowPlaying;
      if (np && np.eps && np.eps[index]) setLastEp(np.item.id, np.eps[index]);
    },
    // Played to the very end: a finished series leaves Continue watching (a finished movie
    // leaves by itself, since its resume point is removed).
    onEnded: function () {
      if (nowPlaying && nowPlaying.eps) dropCw(nowPlaying.item);
    },
    onStopped: function () {
      if (!nowPlaying) return;
      nowPlaying = null;
      reloadWatch();
      if (cur.v === 'movie') movieButtons(cur.a);
      refreshShow();
    },
    onCatalog: function (ok, msg) {
      catalogReady = ok;
      if (!ok) { toast('Could not load the library: ' + msg); return; }
      counts = JSON.parse(N.counts());
      cats = {}; lists = {};
      // Pages that were drawn before the library arrived draw again with it (not "Who's
      // watching", which would lose a name being typed).
      if (user && /^(home|movies|series|search|recent|settings)$/.test(cur.v)) show(cur.v, cur.a, snapshot());
    }
  };

  // ---------- start ----------

  function boot() {
    main = $('#main');
    side = $('#side');
    modal = $('#modal');
    main.addEventListener('scroll', onScroll);
    renderSide();
    show('home', null, null);
    if (acct) {
      loadCatalog(false);
      N.signIn(); // silent unless a new permission is needed; then onSignIn syncs the user
    }
  }
  boot();
})();
