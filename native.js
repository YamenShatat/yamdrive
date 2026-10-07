/* yamDRIVE on the web: Safari on iPhone (added to the Home Screen), Chrome and Brave on Windows
   and Android.
   The page (app.js) is the Android app's own; this file does in the browser what MainActivity,
   Drive.java, Tmdb.java and Catalog.java do there, behind the same window.Native calls. Videos
   and Drive posters go through sw.js, which adds the Google sign-in a <video>/<img> cannot send. */
(function () {
  'use strict';

  var CLIENT = '493442948393-hmgi9trb17slmmmvcbabd4gbsf4tbg41.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive';
  // Read-only TMDB token for posters and plots. It is public here (the page is public): personal use.
  var TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzMjZhNzBlYWE0NzA0ZTljZTM4NTNlYTY3ZWIyNWVlMCIsIm5iZiI6MTc5MDY4NTk0Ny43OTYsInN1YiI6IjZhYmJiMmZiYzEwNjcxODI4OWJmN2IzOSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.YKpjLatwSSrxHK7kKSBVBxIVhRKTbw6E6XWk6v72lc0';
  var FILES = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  var FOLDER = 'application/vnd.google-apps.folder';
  var USERS = 'Luma users';
  var SYNCED = ['favs', 'later', 'cw', 'lastEp', 'progress'];
  var MAX_AGE_MS = 12 * 60 * 60 * 1000;

  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  function tell(fn) {
    var args = [].slice.call(arguments, 1);
    setTimeout(function () { window.App[fn].apply(null, args); }, 0);
  }
  function errText(e) { return (e && e.message) || String(e); }
  function enc(s) { return encodeURIComponent(s); }

  // ---------- Google sign-in (tokens last an hour) ----------

  var token = '', tokenExp = 0;
  try {
    var saved = JSON.parse(ls.get('gtoken') || 'null');
    if (saved && saved.exp > Date.now()) { token = saved.v; tokenExp = saved.exp; }
  } catch (e) { /* none saved */ }
  function tokenOk() { return !!token && Date.now() < tokenExp - 60000; }

  function setToken(v, expiresIn) {
    token = v;
    tokenExp = Date.now() + (expiresIn || 3600) * 1000;
    ls.set('gtoken', JSON.stringify({ v: token, exp: tokenExp }));
    toWorker();
  }
  function toWorker() {
    if (!token || !('serviceWorker' in navigator)) return;
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(token);
    navigator.serviceWorker.ready.then(function (r) { if (r.active) r.active.postMessage(token); });
  }

  // Google's script (index.html). A blocker (Brave Shields, an ad blocker) can stop it loading:
  // say so instead of waiting forever.
  function gisLoaded() {
    var until = Date.now() + 15000;
    return new Promise(function (res, rej) {
      (function poll() {
        if (window.google && google.accounts && google.accounts.oauth2) res();
        else if (Date.now() > until) rej(new Error('Google sign-in did not load. In Brave, turn Shields off for this site (the lion icon); with an ad blocker, allow this site. Then reload the page.'));
        else setTimeout(poll, 50);
      })();
    });
  }
  // Google's sign-in window; the first time it asks for the account and consent, later it is a blink.
  function requestToken() {
    return gisLoaded().then(function () {
      return new Promise(function (res, rej) {
        google.accounts.oauth2.initTokenClient({
          client_id: CLIENT, scope: SCOPE,
          callback: function (r) {
            if (r.error) { rej(new Error(r.error_description || r.error)); return; }
            setToken(r.access_token, +r.expires_in);
            res(token);
          },
          error_callback: function (e) {
            rej(new Error(e && e.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Sign-in failed: ' + ((e && (e.message || e.type)) || 'unknown')));
          }
        }).requestAccessToken({ prompt: '' });
      });
    });
  }

  // A current token. When it has expired, Safari only lets a tap open Google's window, so this
  // shows a "Continue" box and everything waiting goes on after the tap.
  var waiters = null;
  function getToken() {
    if (tokenOk()) return Promise.resolve(token);
    return new Promise(function (res, rej) {
      if (!waiters) { waiters = []; askToContinue(''); }
      waiters.push({ res: res, rej: rej });
    });
  }
  function askToContinue(msg) {
    var el = document.getElementById('gate');
    if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); }
    el.innerHTML = '<div class="gate-box"><div class="h">Continue with Google</div>' +
      '<p>' + (msg || 'Your Google sign-in has expired (it lasts an hour). Tap Continue to go on where you were.') + '</p>' +
      '<button class="btn primary" id="gate-go">Continue</button></div>';
    el.style.display = 'flex';
    document.getElementById('gate-go').onclick = function () {
      requestToken().then(function (t) {
        el.style.display = 'none';
        var w = waiters || [];
        waiters = null;
        w.forEach(function (x) { x.res(t); });
      }, function (e) { askToContinue(errText(e) + ' Tap Continue to try again.'); });
    };
  }

  // ---------- Drive REST ----------

  function drive(url, opts, retried) {
    opts = opts || {};
    return getToken().then(function (t) {
      var headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + t });
      return fetch(url, Object.assign({}, opts, { headers: headers }));
    }).then(function (r) {
      if (r.status === 401 && !retried) { tokenExp = 0; return drive(url, opts, true); }
      if (!r.ok) throw new Error('Google Drive replied ' + r.status);
      return r;
    });
  }
  function djson(url, opts) { return drive(url, opts).then(function (r) { return r.json(); }); }

  async function list(q) {
    var out = [], page = '';
    do {
      var d = await djson(FILES + '?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
        '&fields=' + enc('nextPageToken,files(id,name,mimeType,parents,createdTime,size)') + '&q=' + enc(q) +
        (page ? '&pageToken=' + enc(page) : ''));
      out = out.concat(d.files || []);
      page = d.nextPageToken || '';
    } while (page);
    return out;
  }

  /** Children of each parent folder, asking for many parents per request. */
  async function children(parents) {
    var out = {};
    parents.forEach(function (p) { out[p] = []; });
    for (var i = 0; i < parents.length; i += 40) {
      var part = parents.slice(i, i + 40).map(function (p) { return "'" + p + "' in parents"; }).join(' or ');
      (await list('trashed=false and (' + part + ')')).forEach(function (f) {
        (f.parents || []).forEach(function (p) { if (out[p]) out[p].push(f); });
      });
    }
    return out;
  }

  /** Folders that hold a "movies" or "series" folder: the choices for the library. */
  async function folders() {
    var parents = [];
    (await list("mimeType='" + FOLDER + "' and trashed=false and (name contains 'movies' or name contains 'series')")).forEach(function (f) {
      var n = f.name.trim().toLowerCase();
      if (n !== 'movies' && n !== 'series') return;
      (f.parents || []).forEach(function (p) { if (parents.indexOf(p) < 0) parents.push(p); });
    });
    var out = [];
    for (var i = 0; i < parents.length; i++) {
      var f = await djson(FILES + '/' + parents[i] + '?fields=name&supportsAllDrives=true');
      out.push({ id: parents[i], name: f.name });
    }
    return out;
  }

  // ---------- scanning (as Drive.java) ----------

  function isFolder(f) { return f.mimeType === FOLDER; }
  function isVideo(f) { return (f.mimeType || '').indexOf('video/') === 0; }
  function onlyFolders(l) { return (l || []).filter(isFolder); }
  function byName(a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  // Java's String.hashCode & 0x7fffffff, exactly: the Android app numbers every movie and episode
  // this way, and progress synced between devices is keyed by these numbers.
  function idOf(f) {
    var h = 0;
    for (var i = 0; i < f.id.length; i++) h = (Math.imul(31, h) + f.id.charCodeAt(i)) | 0;
    return h & 0x7fffffff;
  }
  function ext(name) { var d = name.lastIndexOf('.'); return d > 0 ? name.slice(d + 1).toLowerCase() : 'mp4'; }
  function seconds(f) { var t = Date.parse(f.createdTime || ''); return t ? Math.floor(t / 1000) : 0; }
  function biggestVideo(files) {
    var best = null;
    files.forEach(function (f) { if (isVideo(f) && (!best || +f.size > +best.size)) best = f; });
    return best;
  }
  function poster(files) {
    var first = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if ((f.mimeType || '').indexOf('image/') !== 0) continue;
      var n = f.name.toLowerCase();
      if (n.indexOf('poster') === 0 || n.indexOf('cover') === 0 || n.indexOf('folder') === 0) return f.id;
      if (!first) first = f.id;
    }
    return first;
  }
  function episodeNumber(name, fallback) {
    var m = /s(\d{1,2})[ ._-]*e(\d{1,3})/i.exec(name);
    if (m) return +m[2];
    m = /(?:^|[^a-z])e(?:p|pisode)?[ ._-]*(\d{1,3})/i.exec(name);
    if (m) return +m[1];
    m = /^(\d{1,3})/.exec(name);
    return m ? +m[1] : fallback;
  }
  function firstNumber(name, fallback) { var m = /(\d{1,3})/.exec(name); return m ? +m[1] : fallback; }

  function episodes(files) {
    var vids = (files || []).filter(isVideo).sort(byName);
    var order = vids.map(function (f, i) { return [episodeNumber(f.name, i + 1), i]; });
    order.sort(function (a, b) { return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]; });
    return order.map(function (o) {
      var f = vids[o[1]], d = f.name.lastIndexOf('.');
      return {
        id: idOf(f), episode_num: o[0], title: d > 0 ? f.name.slice(0, d) : f.name, file_name: f.name,
        file: f.id, size: +f.size || 0, container_extension: ext(f.name), added: seconds(f), info: {}
      };
    });
  }

  async function scan(root) {
    var moviesId = null, seriesId = null;
    (await children([root]))[root].forEach(function (f) {
      if (!isFolder(f)) return;
      var n = f.name.trim().toLowerCase();
      if (n === 'movies') moviesId = f.id;
      if (n === 'series') seriesId = f.id;
    });
    if (!moviesId && !seriesId) throw new Error('No "movies" or "series" folder in this folder.');
    var top = await children([moviesId, seriesId].filter(Boolean));
    var movieDirs = moviesId ? onlyFolders(top[moviesId]) : [];
    var showDirs = seriesId ? onlyFolders(top[seriesId]) : [];
    var inside = await children(movieDirs.concat(showDirs).map(function (d) { return d.id; }));
    var seasonIds = [];
    showDirs.forEach(function (d) { onlyFolders(inside[d.id]).forEach(function (s) { seasonIds.push(s.id); }); });
    var inSeason = await children(seasonIds);

    var movies = [];
    movieDirs.forEach(function (d) {
      var files = inside[d.id], v = biggestVideo(files);
      if (!v) return;
      var name = d.name.trim(), y = /\((\d{4})\)/.exec(name);
      movies.push({
        stream_id: idOf(v), name: name, file: v.id, size: +v.size || 0, container_extension: ext(v.name),
        added: seconds(v), releaseDate: y ? y[1] : '', category_id: 'all', poster: poster(files)
      });
    });

    var series = [];
    showDirs.forEach(function (d) {
      var files = inside[d.id], seasons = onlyFolders(files).sort(byName), eps = {}, newest = 0, count = 0;
      seasons.forEach(function (s, i) {
        var list = episodes(inSeason[s.id]);
        if (!list.length) return;
        list.forEach(function (e) { newest = Math.max(newest, e.added); });
        eps[String(firstNumber(s.name, i + 1))] = list;
        count++;
      });
      if (!count) return;
      series.push({
        series_id: idOf(d), name: d.name.trim(), last_modified: newest, category_id: 'all',
        poster: poster(files), episodes: eps
      });
    });
    return { root: root, movies: movies, series: series };
  }

  // ---------- TMDB (as Tmdb.java); replies kept in the browser's cache storage ----------

  var TMDB = 'https://api.themoviedb.org/3', IMG = 'https://image.tmdb.org/t/p/';
  var JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|web-?dl|web-?rip|blu-?ray|bdrip|hdtv|x264|x265|h264|h265|hevc|hdr|dvdrip|remux)\b.*$/i;
  function tmdbQuery(name) {
    return name.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[._]/g, ' ').replace(JUNK, '').replace(/\s+/g, ' ').trim();
  }
  async function tmdbGet(path) {
    var url = TMDB + path, cache = null;
    try {
      cache = await caches.open('luma-tmdb');
      var hit = await cache.match(url);
      if (hit) return hit.json();
    } catch (e) { cache = null; }
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + TMDB_TOKEN, Accept: 'application/json' } });
    if (!r.ok) throw new Error('TMDB replied ' + r.status);
    if (cache) { try { await cache.put(url, r.clone()); } catch (e) { /* cache full: ask again next time */ } }
    return r.json();
  }
  function str(o, k) { return o[k] == null ? '' : String(o[k]); }
  function fill(row, r, genres, dateKey) {
    row.plot = str(r, 'overview');
    if (+r.vote_average > 0) row.rating = (+r.vote_average).toFixed(1);
    row.genre = (r.genre_ids || []).map(function (id) { return genres[id]; }).filter(Boolean).join(', ');
    if (!row.releaseDate && str(r, dateKey).length >= 4) row.releaseDate = str(r, dateKey).slice(0, 4);
    if (r.poster_path) row.tmdb_poster = IMG + 'w342' + r.poster_path;
    if (r.backdrop_path) row.backdrop = IMG + 'w780' + r.backdrop_path;
  }
  async function genres(kind) {
    var out = {};
    ((await tmdbGet('/genre/' + kind + '/list')).genres || []).forEach(function (g) { out[g.id] = g.name; });
    return out;
  }
  async function pool(jobs, n) {
    var i = 0;
    async function worker() {
      while (i < jobs.length) {
        var job = jobs[i++];
        try { await job(); } catch (e) { /* this title keeps its folder name */ }
      }
    }
    var workers = [];
    for (var k = 0; k < n; k++) workers.push(worker());
    await Promise.all(workers);
  }
  async function enrich(movies, series) {
    var mg, tg;
    try { mg = await genres('movie'); tg = await genres('tv'); } catch (e) { return; }
    var jobs = [];
    movies.forEach(function (m) {
      jobs.push(async function () {
        var r = ((await tmdbGet('/search/movie?query=' + enc(tmdbQuery(m.name)) + (m.releaseDate ? '&year=' + m.releaseDate : ''))).results || [])[0];
        if (r) fill(m, r, mg, 'release_date');
      });
    });
    series.forEach(function (s) {
      jobs.push(async function () {
        var r = ((await tmdbGet('/search/tv?query=' + enc(tmdbQuery(s.name)))).results || [])[0];
        if (!r) return;
        fill(s, r, tg, 'first_air_date');
        for (var n in s.episodes) {
          var tm;
          try { tm = (await tmdbGet('/tv/' + r.id + '/season/' + n)).episodes || []; } catch (e) { continue; }
          var byNum = {};
          tm.forEach(function (t) { byNum[t.episode_number] = t; });
          s.episodes[n].forEach(function (e) {
            var t = byNum[e.episode_num];
            if (!t) return;
            if (t.name) e.title = t.name;
            e.info = { plot: str(t, 'overview') };
            if (t.still_path) e.info.movie_image = IMG + 'w300' + t.still_path;
            if (t.runtime > 0) e.info.duration = t.runtime + ' min';
          });
        }
      });
    });
    await pool(jobs, 6);
  }

  // ---------- the library, answered in the Xtream shapes app.js was written for ----------

  var movieRows = [], showRows = [], byId = {}, fileOf = {}, items = [];

  async function load(root, force) {
    var lib = null;
    if (!force) {
      try {
        var c = JSON.parse(ls.get('library') || 'null');
        if (c && c.root === root && Date.now() - c.at < MAX_AGE_MS) lib = c.lib;
      } catch (e) { lib = null; }
    }
    if (!lib) {
      lib = await scan(root);
      await enrich(lib.movies, lib.series);
      ls.set('library', JSON.stringify({ root: root, at: Date.now(), lib: lib }));
    }
    index(lib);
  }

  // A Drive poster is served by sw.js (it needs the sign-in); else TMDB's.
  function cover(row) { return row.poster ? 'poster/' + row.poster : (row.tmdb_poster || ''); }

  function index(lib) {
    var ids = {}, files = {}, all = [];
    lib.movies.forEach(function (m) {
      m.cover = cover(m);
      ids[m.stream_id] = m;
      files[m.stream_id] = { f: m.file, s: m.size };
      all.push({ kind: 'm', id: m.stream_id, added: m.added || 0, name: m.name, icon: m.cover, ext: m.container_extension, cat: 'all', rating: m.rating || '' });
    });
    lib.series.forEach(function (s) {
      s.cover = cover(s);
      ids[s.series_id] = s;
      for (var n in s.episodes) s.episodes[n].forEach(function (e) { files[e.id] = { f: e.file, s: e.size }; });
      all.push({ kind: 's', id: s.series_id, added: s.last_modified || 0, name: s.name, icon: s.cover, ext: '', cat: 'all', rating: s.rating || '' });
    });
    movieRows = lib.movies; showRows = lib.series; byId = ids; fileOf = files; items = all;
  }

  function details(row) {
    return { releasedate: row.releaseDate || '', plot: row.plot || '', genre: row.genre || '', backdrop_path: row.backdrop || '' };
  }
  function idIn(extra) { var m = /=(\d+)/.exec(extra || ''); return m ? +m[1] : -1; }

  function api(action, extra) {
    switch (action) {
      case 'get_vod_categories': return '[{"category_id":"all","category_name":"All movies"}]';
      case 'get_series_categories': return '[{"category_id":"all","category_name":"All series"}]';
      case 'get_vod_streams': return JSON.stringify(movieRows);
      case 'get_series': return JSON.stringify(showRows);
      case 'get_vod_info': {
        var m = byId[idIn(extra)];
        return m ? JSON.stringify({ info: details(m), movie_data: { container_extension: m.container_extension } }) : null;
      }
      case 'get_series_info': {
        var s = byId[idIn(extra)];
        return s ? JSON.stringify({ info: details(s), episodes: s.episodes }) : null;
      }
      default: return null;
    }
  }

  // ---------- search and "Recently added" (as Catalog.java) ----------

  function slimItem(it) { return { k: it.kind, id: it.id, n: it.name, i: it.icon, e: it.ext, c: it.cat, r: it.rating, t: it.added }; }
  function counts() {
    var m = 0, s = 0;
    items.forEach(function (it) { if (it.kind === 'm') m++; else s++; });
    return JSON.stringify({ l: 0, m: m, s: s });
  }
  function search(query, kinds, limit) {
    var q = query.trim().toLowerCase(), out = {};
    kinds.split('').forEach(function (k) {
      var first = [], rest = [], total = 0;
      items.forEach(function (it) {
        if (it.kind !== k) return;
        var at = it.name.toLowerCase().indexOf(q);
        if (at < 0) return;
        total++;
        if (at === 0) { if (first.length < limit) first.push(it); } else if (rest.length < limit) rest.push(it);
      });
      out[k] = { total: total, items: first.concat(rest).slice(0, limit).map(slimItem) };
    });
    return JSON.stringify(out);
  }
  function recent(kinds, limit) {
    return JSON.stringify(items.filter(function (it) { return kinds.indexOf(it.kind) >= 0; })
      .sort(function (a, b) { return b.added - a.added; }).slice(0, limit).map(slimItem));
  }

  // ---------- users: one JSON file per name in "Luma users" (as the Android app) ----------

  var usersDirs = {};
  function quote(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  async function usersFolder(root, create) {
    if (usersDirs[root]) return usersDirs[root];
    var l = await list("'" + root + "' in parents and trashed=false and mimeType='" + FOLDER + "' and name = '" + USERS + "'");
    var id = l.length ? l[0].id : null;
    if (!id && create) {
      id = (await djson(FILES + '?supportsAllDrives=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: USERS, mimeType: FOLDER, parents: [root] })
      })).id;
    }
    if (id) usersDirs[root] = id;
    return id;
  }
  async function userNames(root) {
    var dir = await usersFolder(root, false);
    if (!dir) return [];
    return (await list("'" + dir + "' in parents and trashed=false"))
      .map(function (f) { return f.name; }).filter(function (n) { return /\.json$/.test(n); })
      .map(function (n) { return n.slice(0, -5); })
      .sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  }
  async function userFile(root, name) {
    var dir = await usersFolder(root, false);
    if (!dir) return null;
    var l = await list("'" + dir + "' in parents and trashed=false and name = '" + quote(name + '.json') + "'");
    return l.length ? l[0].id : null;
  }
  async function loadUser(root, name) {
    var id = await userFile(root, name);
    return id ? (await drive(FILES + '/' + id + '?alt=media&supportsAllDrives=true')).text() : null;
  }
  async function saveUser(root, name, json) {
    var id = await userFile(root, name);
    if (!id) {
      id = (await djson(FILES + '?supportsAllDrives=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name + '.json', mimeType: 'application/json', parents: [await usersFolder(root, true)] })
      })).id;
    }
    await drive(UPLOAD + '/' + id + '?uploadType=media&supportsAllDrives=true', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json
    });
  }
  async function taken(root, name, self) {
    return (await userNames(root)).some(function (n) { return n.toLowerCase() === name.toLowerCase() && n !== self; });
  }
  function patchMeta(id, meta) {
    return drive(FILES + '/' + id + '?supportsAllDrives=true', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
    });
  }

  function savedString(k) {
    try { var v = JSON.parse(ls.get(k) || 'null'); return typeof v === 'string' ? v : ''; } catch (e) { return ''; }
  }
  function acctRoot() {
    try { return (JSON.parse(ls.get('acct') || 'null') || {}).root || ''; } catch (e) { return ''; }
  }
  function summary(o) {
    return SYNCED.map(function (k) { var v = o[k]; return k + ' ' + (v ? (Array.isArray(v) ? v.length : Object.keys(v).length) : 0); }).join(', ');
  }

  // One at a time, so an upload and a user switch never overlap.
  var chain = Promise.resolve();
  function serial(fn) { chain = chain.then(fn, fn); return chain; }

  // Each change is timed, so when two devices changed the data, the later change wins, whichever
  // device happens to send first (as MainActivity.changed).
  function changed() { ls.set('dirty', '1'); ls.set('changedAt', String(Date.now())); }

  /**
   * As MainActivity.syncUser: brings this device and the user's file together; the later change
   * wins. onlyIfChanged: skip when nothing changed here (the regular upload); otherwise also take
   * the file's newer changes. background: only with a live sign-in (no "Continue" box).
   */
  async function syncUser(onlyIfChanged, background) {
    var user = savedString('user'), root = acctRoot(), dirty = ls.get('dirty') === '1';
    if (!user || !root || (onlyIfChanged && !dirty)) return;
    if (background && !tokenOk()) return;
    try {
      var data = await loadUser(root, user);
      var remote = data == null ? null : JSON.parse(data);
      var mine = +(ls.get('changedAt') || 0), theirs = remote ? +(remote.changed || 0) : -1;
      if (dirty && mine >= theirs) {
        var o = {};
        SYNCED.forEach(function (k) { var v = ls.get(k); if (v != null) o[k] = JSON.parse(v); });
        o.changed = mine;
        o.saved = Date.now();
        await saveUser(root, user, JSON.stringify(o));
        // A change made while sending stays marked, for the next round.
        if (+(ls.get('changedAt') || 0) === mine) ls.set('dirty', '0');
        console.log('uploaded ' + user + ': ' + summary(o));
        syncStatus("sent this device's changes to Drive");
      } else if (remote && theirs !== mine) {
        SYNCED.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
        SYNCED.forEach(function (k) { if (k in remote) ls.set(k, JSON.stringify(remote[k])); });
        ls.set('changedAt', String(theirs));
        ls.set('dirty', '0');
        console.log('took the newer copy of ' + user + ' from Drive: ' + summary(remote));
        syncStatus('took the newer copy from Drive');
        if (window.App && App.onSynced) App.onSynced();
      } else {
        syncStatus('up to date');
      }
    } catch (e) {
      console.log('sync failed, will retry: ' + errText(e));
      syncStatus('failed (' + errText(e) + '), will retry');
    }
  }

  /** The last sync's time and result, shown in Settings. */
  function syncStatus(what) {
    var d = new Date(), pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    ls.set('syncStatus', pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' — ' + what);
  }

  function selectUser(root, name, create) {
    serial(async function () {
      try {
        // The same user again (the app started, or came back): just sync.
        if (!create && name === savedString('user')) {
          await syncUser(false, false);
          tell('onUser', true, '');
          return;
        }
        if (create && await taken(root, name, null)) {
          tell('onUser', false, '"' + name + '" is already taken. If it is you, tap Log in.');
          return;
        }
        var first = !savedString('user');
        await syncUser(true, false); // the previous user's unsent changes
        // Unsent changes must not be replaced by the older copy in Drive.
        if (!first && ls.get('dirty') === '1') {
          tell('onUser', false, 'Could not save to Drive, so this device keeps its own copy for now. Check the connection, and that you can edit the "' + USERS + '" folder.');
          return;
        }
        var data = await loadUser(root, name);
        if (!create && data == null) {
          tell('onUser', false, 'No user called "' + name + '". Check the spelling, or create it.');
          return;
        }
        if (data != null || !first) SYNCED.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
        if (data != null) {
          var o = JSON.parse(data);
          SYNCED.forEach(function (k) { if (k in o) ls.set(k, JSON.stringify(o[k])); });
          ls.set('changedAt', String(+(o.changed || 0)));
          ls.set('dirty', '0');
          console.log('loaded ' + name + ': ' + summary(o));
        } else {
          changed(); // a new name is uploaded at once, so other devices find it
        }
        ls.set('user', JSON.stringify(name));
        await syncUser(true, false);
        tell('onUser', true, '');
      } catch (e) {
        tell('onUser', false, errText(e));
      }
    });
  }

  function forgetUserData() {
    SYNCED.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    ls.set('user', 'null');
  }

  setInterval(function () { serial(function () { return syncUser(true, true); }); }, 30000);

  // ---------- player: Safari's own, fed through sw.js ----------

  var player = null, spec = null, idx = 0, currentId = null, saveTimer = 0;

  // A computer (mouse) gets yamDRIVE's own controls; touch screens keep the browser's, which
  // know their full screen and gestures best.
  var DESK = matchMedia('(hover: hover) and (pointer: fine)').matches;
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'; }
  var LINE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var I = {
    play: svg('<path d="M7 4.5v15l12.5-7.5z"/>'),
    pause: svg('<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>'),
    prev: svg('<path d="M6 5h2.2v14H6zM19.5 5v14L9.5 12z"/>'),
    next: svg('<path d="M15.8 5H18v14h-2.2zM4.5 5v14l10-7z"/>'),
    back: svg('<path d="M12 4.5V1.8L7.5 5.4 12 9V6.5a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16" font-size="6.6" font-weight="700" text-anchor="middle" font-family="sans-serif">10</text>'),
    fwd: svg('<path d="M12 4.5V1.8l4.5 3.6L12 9V6.5a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16" font-size="6.6" font-weight="700" text-anchor="middle" font-family="sans-serif">10</text>'),
    vol: svg('<path d="M3.5 9v6h4l5 4V5l-5 4z"/><path ' + LINE + ' d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.5 8.5 0 0 1 0 12"/>'),
    mute: svg('<path d="M3.5 9v6h4l5 4V5l-5 4z"/><path ' + LINE + ' d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'),
    pip: svg('<rect ' + LINE + ' x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1"/>'),
    full: svg('<path ' + LINE + ' d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    unfull: svg('<path ' + LINE + ' d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>')
  };
  var CONTROLS = '<div class="pctl"><div class="pseek"><input type="range" class="pslider" min="0" max="1000" step="1" value="0" aria-label="Seek"><div class="ptip"></div></div>' +
    '<div class="prow">' +
    '<button class="pb pprev2" title="Previous episode (Shift+P)">' + I.prev + '</button>' +
    '<button class="pb pplay" title="Play / pause (Space)">' + I.play + '</button>' +
    '<button class="pb pback" title="Back 10 seconds (←)">' + I.back + '</button>' +
    '<button class="pb pfwd" title="Forward 10 seconds (→)">' + I.fwd + '</button>' +
    '<button class="pb pnext2" title="Next episode (Shift+N)">' + I.next + '</button>' +
    '<button class="pb pmute" title="Mute (M)">' + I.vol + '</button>' +
    '<input type="range" class="pvol" min="0" max="1" step="0.05" aria-label="Volume" title="Volume (↑ ↓)">' +
    '<span class="ptime">0:00 / 0:00</span><span class="pfill"></span>' +
    '<span class="pq" title="Google Drive plays the original file; this is its quality"></span>' +
    '<button class="pb pspeed" title="Playback speed">1×</button>' +
    '<button class="pb ppip" title="Picture in picture">' + I.pip + '</button>' +
    '<button class="pb pfs" title="Full screen (F)">' + I.full + '</button></div></div>';

  function clock(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }

  // The computer controls: seek bar (with what is loaded, and the time under the mouse), play,
  // ±10 s, episodes, volume, time, the file's quality, speed, picture in picture, full screen,
  // and the keyboard (Space/K, ←/→ or J/L, ↑/↓, M, F, Shift+N/P, 0-9).
  function desk(p) {
    var w = p.wrap, v = p.v, q = function (s) { return w.querySelector(s); };
    var seek = q('.pslider'), tip = q('.ptip'), vol = q('.pvol'), time = q('.ptime'), qual = q('.pq');
    var playB = q('.pplay'), muteB = q('.pmute'), speedB = q('.pspeed'), fsB = q('.pfs'), pipB = q('.ppip');
    var SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75], dragging = false;
    var RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; // Shift+< / Shift+> step through these
    p.ctl = q('.pctl');
    p.next2 = q('.pnext2');
    p.prev2 = q('.pprev2');

    // As YouTube: what a click or key just did flashes in the middle for a moment.
    var flashEl = document.createElement('div'), jump = 0, jumpAt = 0;
    flashEl.className = 'pflash';
    w.appendChild(flashEl);
    function flash(html) {
      flashEl.innerHTML = html;
      flashEl.classList.remove('on');
      void flashEl.offsetWidth; // restart the animation
      flashEl.classList.add('on');
    }
    function step(s) {
      if (!v.duration) return;
      v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + s));
      // Presses in a row the same way add up on screen: 10 s, 20 s, 30 s.
      jump = Date.now() - jumpAt < 1000 && (jump > 0) === (s > 0) ? jump + s : s;
      jumpAt = Date.now();
      flash('<b>' + (jump > 0 ? Math.abs(jump) + ' s »' : '« ' + Math.abs(jump) + ' s') + '</b>');
      p.wake();
    }
    function toggle() {
      if (v.paused) v.play(); else v.pause();
      flash(v.paused ? I.pause : I.play);
    }
    function full() { if (document.fullscreenElement) document.exitFullscreen(); else w.requestFullscreen().catch(function () {}); }
    function setVol(x) {
      v.volume = Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
      v.muted = v.volume === 0;
      flash((v.muted ? I.mute : I.vol) + '<b>' + Math.round(v.volume * 100) + '%</b>');
    }
    function setSpeed(i) {
      v.playbackRate = RATES[Math.max(0, Math.min(RATES.length - 1, i))];
      flash('<b>' + v.playbackRate + '×</b>');
    }
    function paint() {
      var d = v.duration || 0, t = v.currentTime || 0, b = 0;
      for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= t + 1) b = Math.max(b, v.buffered.end(i));
      if (!dragging) seek.value = d ? Math.round(t / d * 1000) : 0;
      seek.style.setProperty('--p', seek.value / 10 + '%');
      seek.style.setProperty('--b', (d ? b / d * 100 : 0) + '%');
      time.textContent = clock(dragging ? seek.value / 1000 * d : t) + ' / ' + clock(d);
    }
    function paintVol() {
      vol.value = v.muted ? 0 : v.volume;
      vol.style.setProperty('--p', vol.value * 100 + '%');
      muteB.innerHTML = v.muted || !v.volume ? I.mute : I.vol;
      ls.set('volume', JSON.stringify({ v: v.volume, m: v.muted }));
    }

    // Buttons never keep the keyboard (Space would press them again).
    w.addEventListener('mousedown', function (e) { if (e.target.closest('.pctl button')) e.preventDefault(); });
    playB.onclick = toggle;
    q('.pback').onclick = function () { step(-10); };
    q('.pfwd').onclick = function () { step(10); };
    p.next2.onclick = function () { p.next.onclick(); };
    p.prev2.onclick = function () { p.prev.onclick(); };
    muteB.onclick = function () {
      v.muted = !v.muted;
      if (!v.muted && !v.volume) v.volume = 0.5;
      flash(v.muted ? I.mute : I.vol);
    };
    vol.oninput = function () { setVol(+vol.value); };
    speedB.onclick = function () {
      v.playbackRate = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length];
      speedB.textContent = v.playbackRate + '×';
    };
    fsB.onclick = full;
    if (document.pictureInPictureEnabled) {
      pipB.onclick = function () { (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(function () {}); };
    } else pipB.style.display = 'none';
    v.addEventListener('click', toggle);
    v.addEventListener('dblclick', full);

    // Seek bar: the picture moves when the mouse is let go (each jump is a new Drive request).
    seek.addEventListener('pointerdown', function () { dragging = true; });
    seek.addEventListener('input', paint);
    seek.addEventListener('change', function () {
      dragging = false;
      if (v.duration) v.currentTime = seek.value / 1000 * v.duration;
    });
    seek.addEventListener('mousemove', function (e) {
      var r = seek.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      tip.textContent = clock(f * (v.duration || 0));
      tip.style.left = f * 100 + '%';
    });

    ['timeupdate', 'progress', 'durationchange', 'seeked'].forEach(function (n) { v.addEventListener(n, paint); });
    v.addEventListener('play', function () { playB.innerHTML = I.pause; });
    v.addEventListener('pause', function () { playB.innerHTML = I.play; });
    v.addEventListener('volumechange', paintVol);
    v.addEventListener('ratechange', function () { speedB.textContent = v.playbackRate + '×'; });
    v.addEventListener('loadedmetadata', function () {
      var h = v.videoHeight;
      qual.textContent = !h ? '' : h >= 2000 ? '4K' : h >= 1400 ? '1440p' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h + 'p';
    });
    document.addEventListener('fullscreenchange', function () { fsB.innerHTML = document.fullscreenElement ? I.unfull : I.full; });

    try { var sv = JSON.parse(ls.get('volume') || 'null'); if (sv) { v.volume = sv.v; v.muted = sv.m; } } catch (e) { /* default */ }
    paintVol();

    window.addEventListener('keydown', function (e) {
      if (w.style.display !== 'flex' || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key, done = true;
      if (k === ' ' || k === 'k' || k === 'K') toggle();
      else if (k === 'ArrowLeft' || k === 'j' || k === 'J') step(-10);
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') step(10);
      else if (k === 'ArrowUp') setVol(v.volume + 0.1);
      else if (k === 'ArrowDown') setVol(v.volume - 0.1);
      else if (k === 'm' || k === 'M') muteB.onclick();
      else if (k === 'f' || k === 'F') full();
      else if (k === 'N' && e.shiftKey) p.next.onclick();
      else if (k === 'P' && e.shiftKey) p.prev.onclick();
      else if (k === '>') setSpeed(RATES.indexOf(v.playbackRate) + 1); // YouTube's Shift+. and Shift+,
      else if (k === '<') setSpeed(RATES.indexOf(v.playbackRate) - 1);
      else if (/^[0-9]$/.test(k) && v.duration) v.currentTime = v.duration * k / 10;
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); p.wake(); }
    }, true);
  }

  function playerEl() {
    if (player) return player;
    var wrap = document.createElement('div');
    wrap.id = 'player';
    if (DESK) wrap.className = 'desk';
    wrap.innerHTML = '<div class="pbar"><div class="ptitle"></div>' +
      '<button class="pnav pprev">‹ Previous</button><button class="pnav pnext">Next episode ›</button>' +
      '<button class="pclose" aria-label="Close">✕</button></div>' +
      '<video playsinline ' + (DESK ? '' : 'controls ') + 'autoplay preload="auto"></video>' + (DESK ? CONTROLS : '');
    document.body.appendChild(wrap);
    player = {
      wrap: wrap, v: wrap.querySelector('video'), title: wrap.querySelector('.ptitle'),
      prev: wrap.querySelector('.pprev'), next: wrap.querySelector('.pnext')
    };
    wrap.querySelector('.pclose').onclick = stop;
    // As the tablet's buttons: to the next/previous episode, keeping this one's place.
    function jump(to) {
      if (!spec || to < 0 || to >= spec.items.length) return;
      saveProgress(false);
      startItem(to, 0);
      tell('onItem', idx);
    }
    player.next.onclick = function () { jump(idx + 1); };
    player.prev.onclick = function () { jump(idx - 1); };
    // The top bar shows on any tap and while paused, and fades 3 s later while playing.
    var hideTimer = 0;
    player.wake = function () {
      wrap.classList.remove('idle');
      clearTimeout(hideTimer);
      // Paused, they stay; playing, they go 3 s after the last mouse move, key or tap (never
      // while the mouse is on them).
      hideTimer = setTimeout(function () {
        if (!player.v.paused && !(player.ctl && player.ctl.matches(':hover'))) wrap.classList.add('idle');
      }, 3000);
    };
    wrap.addEventListener('touchstart', player.wake, { passive: true });
    wrap.addEventListener('click', player.wake);
    // The mouse brings the controls back: heard on the whole page, first, so nothing on top
    // of the player (an extension's layer, say) can keep it from the player.
    // Only a real move counts: when the controls fade, the browser reports a "move" of the
    // still mouse at the same spot, which would bring them straight back.
    var lastX = -1, lastY = -1;
    ['pointermove', 'mousemove'].forEach(function (n) {
      window.addEventListener(n, function (e) {
        if (e.clientX === lastX && e.clientY === lastY) return;
        lastX = e.clientX;
        lastY = e.clientY;
        if (wrap.style.display === 'flex') player.wake();
      }, { capture: true, passive: true });
    });
    window.addEventListener('wheel', function () { if (wrap.style.display === 'flex') player.wake(); }, { capture: true, passive: true });
    player.v.addEventListener('play', player.wake);
    player.v.addEventListener('pause', player.wake);
    player.v.addEventListener('ended', onEnded);
    player.v.addEventListener('error', onError);
    if (DESK) desk(player);
    return player;
  }

  function startItem(i, startSec) {
    var it = spec.items[i], p = playerEl();
    idx = i;
    currentId = it.id;
    p.title.textContent = it.title.replace('\n', ' · ');
    p.next.style.display = i < spec.items.length - 1 ? '' : 'none';
    p.prev.style.display = i > 0 ? '' : 'none';
    if (p.next2) {
      p.next2.style.display = p.next.style.display;
      p.prev2.style.display = p.prev.style.display;
    }
    p.wake();
    p.v.src = it.url;
    if (startSec > 0) {
      var seek = function () { p.v.currentTime = startSec; p.v.removeEventListener('loadedmetadata', seek); };
      p.v.addEventListener('loadedmetadata', seek);
    }
    var pr = p.v.play();
    if (pr && pr.catch) pr.catch(function () { /* waits for a tap on play */ });
  }

  function play(json) {
    saveProgress(false);
    spec = JSON.parse(json);
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
      tell('onPlayerError', 'The player is still starting. Try again in a moment.');
      return;
    }
    function go() {
      toWorker();
      playerEl().wrap.style.display = 'flex';
      startItem(spec.index || 0, (spec.start || 0) / 1000);
      clearInterval(saveTimer);
      saveTimer = setInterval(function () { saveProgress(false); }, 5000);
    }
    if (tokenOk()) go(); else getToken().then(go);
  }

  function onEnded() {
    if (spec && idx < spec.items.length - 1) {
      forget(currentId); // played to the end and moved on: that episode is finished
      startItem(idx + 1, 0);
      tell('onItem', idx);
      return;
    }
    saveProgress(true);
    tell('onEnded');
    stop();
  }

  // An hour-old sign-in makes Drive refuse the next piece of the video: sign in again and go on.
  function onError() {
    var at = player.v.currentTime;
    if (!tokenOk()) {
      getToken().then(function () { toWorker(); startItem(idx, at); });
      return;
    }
    tell('onPlayerError', 'The video could not be played (error ' + (player.v.error && player.v.error.code) + ').');
  }

  function stop() {
    if (!player || player.wrap.style.display !== 'flex') return;
    // Closed in full screen (✕, Esc or the end): leave full screen too, not just the player.
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    saveProgress(false);
    clearInterval(saveTimer);
    player.v.pause();
    player.v.removeAttribute('src');
    player.v.load();
    player.wrap.style.display = 'none';
    currentId = null;
    tell('onStopped');
    // Send the new place now. The regular uploads skip quietly once the hour-long sign-in has
    // expired (they must not pop up a sign-in box by themselves); here the user just tapped, so
    // an expired sign-in may ask with "Continue".
    serial(function () { return syncUser(true, false); });
  }

  /** As MainActivity.saveProgress: the place in ms; near the end (or ended) it is removed. */
  function saveProgress(ended) {
    if (!player || !currentId) return;
    var pos = Math.floor(player.v.currentTime * 1000), dur = Math.floor((player.v.duration || 0) * 1000);
    if (!(dur > 0) && !ended) return;
    var all;
    try { all = JSON.parse(ls.get('progress') || '{}') || {}; } catch (e) { all = {}; }
    var old = all[currentId];
    if (!ended && pos > 10000 && pos < dur - 120000) {
      // Paused: the same place is not a new change (it would win over other devices).
      if (old && old.p === pos) return;
      all[currentId] = { p: pos, d: dur, t: Date.now() };
    } else if (ended || pos >= dur - 120000) {
      if (!old) return;
      delete all[currentId];
    } else {
      return;
    }
    ls.set('progress', JSON.stringify(all));
    changed();
  }
  function forget(id) {
    if (!id) return;
    try {
      var all = JSON.parse(ls.get('progress') || '{}') || {};
      if (!(id in all)) return;
      delete all[id];
      ls.set('progress', JSON.stringify(all));
      changed();
    } catch (e) { /* a bad entry is replaced by the next save */ }
  }

  // Leaving the app (Home, lock): keep the place, and send it while the sign-in is live.
  document.addEventListener('visibilitychange', function () {
    // Back in front: pick up what this user watched on another device meanwhile.
    if (!document.hidden) { if (window.App && App.onResume) App.onResume(); return; }
    if (player && player.wrap.style.display === 'flex') { saveProgress(false); player.v.pause(); }
    serial(function () { return syncUser(true, true); });
  });

  // A phone in Chrome or Brave: a video in full screen turns sideways (Android allows it only
  // in full screen; elsewhere the lock is refused, which is fine).
  document.addEventListener('fullscreenchange', function () {
    var o = screen.orientation;
    if (!o || !o.lock) return;
    if (document.fullscreenElement) o.lock('landscape').catch(function () { /* not a phone */ });
    else if (o.unlock) o.unlock();
  });

  // The phone's Back button, the browser's Back and Esc: the app's own Back (close the video,
  // then the dialog, then the page) instead of leaving the site. A spare history entry catches
  // Back. It is only ever added right after a tap or a key: Chrome treats an entry a page adds
  // by itself as a trap and makes Back skip the page's own entry, leaving the site. (A finger
  // counts as a tap when it lifts, so "click", not "pointerdown"; Esc does not count at all.)
  var spare = false;
  function addSpare() {
    if (spare) return;
    spare = true;
    history.pushState({ yamdrive: 1 }, '');
  }
  function back() {
    if (player && player.wrap.style.display === 'flex') stop();
    else if (window.App) App.back();
  }
  window.addEventListener('click', addSpare, true);
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') addSpare();
    else if (!document.fullscreenElement) back();
  }, true);
  window.addEventListener('popstate', function () {
    spare = false; // used up; the next tap adds it again
    back();
  });

  // A Home Screen app can also come back restored from memory, without a visibility change.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && window.App && App.onResume) App.onResume();
  });

  // ---------- the calls app.js makes ----------

  window.Native = {
    play: play,
    stop: stop,
    // "Exit yamDRIVE?" → Yes: leave the site, back to the page before it (a page cannot close
    // its own tab). Two steps: the spare entry, then the app's own.
    exit: function () { spare = true; history.go(-2); },
    toast: function () { /* app.js shows its own */ },
    get: function (k) { return ls.get(k); },
    set: function (k, v) {
      var same = ls.get(k) === v;
      ls.set(k, v);
      if (SYNCED.indexOf(k) >= 0 && !same) changed();
    },
    signIn: function () {
      if (tokenOk()) { toWorker(); tell('onSignIn', true, ''); return; }
      var tapped = navigator.userActivation ? navigator.userActivation.isActive : true;
      (tapped ? requestToken() : getToken()).then(
        function () { tell('onSignIn', true, ''); },
        function (e) { tell('onSignIn', false, errText(e)); });
    },
    folders: function () {
      folders().then(function (l) { tell('onFolders', JSON.stringify(l), ''); }, function (e) { tell('onFolders', null, errText(e)); });
    },
    loadCatalog: function (root, force) {
      load(root, force).then(function () { tell('onCatalog', true, ''); }, function (e) { tell('onCatalog', false, errText(e)); });
    },
    build: 18, // shown in Settings > About, to tell an old copy kept by Safari from the current one
    syncStatus: function () { return ls.get('syncStatus') || ''; },
    api: api,
    url: function (id) { var f = fileOf[id]; return f ? 'stream/' + f.f + '?size=' + f.s : ''; },
    search: search,
    recent: recent,
    counts: counts,
    users: function (root) {
      serial(function () {
        return userNames(root).then(function (n) { tell('onUsers', JSON.stringify(n), ''); }, function (e) { tell('onUsers', null, errText(e)); });
      });
    },
    selectUser: selectUser,
    renameUser: function (root, from, to) {
      serial(async function () {
        try {
          if (await taken(root, to, from)) throw new Error('"' + to + '" is already taken.');
          var id = await userFile(root, from);
          if (id) await patchMeta(id, { name: to + '.json' });
          ls.set('user', JSON.stringify(to));
          tell('onRename', true, '');
        } catch (e) { tell('onRename', false, errText(e)); }
      });
    },
    deleteUser: function (root, name) {
      serial(async function () {
        try {
          var id = await userFile(root, name);
          if (id) await patchMeta(id, { trashed: true });
          forgetUserData();
          ls.set('dirty', '0');
          tell('onDeleteUser', true, '');
        } catch (e) { tell('onDeleteUser', false, errText(e)); }
      });
    },
    logOut: function () {
      serial(async function () {
        await syncUser(true, false);
        if (ls.get('dirty') === '1') { tell('onLoggedOut', 'Could not save your progress to Drive. Check the connection and try again.'); return; }
        forgetUserData();
        tell('onLoggedOut', '');
      });
    }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', toWorker);
    toWorker();
  }
})();
