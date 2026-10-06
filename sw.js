// Adds the Google sign-in to what <video> and <img> cannot send it for:
//   stream/<file id>?size=<bytes>  a Drive video, answered the way Safari's player expects
//                                  (206, exact Content-Range and Content-Length; Chrome and
//                                  Brave take the same), read in blocks that are kept;
//   poster/<file id>               a poster image from the library folder, kept in a cache.
// The page sends the token (native.js toWorker); it is also kept in this worker's cache, since
// the phone stops idle workers and that would lose it mid-video.
var FILES = 'https://www.googleapis.com/drive/v3/files/';
var token = '';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('message', function (e) {
  token = e.data;
  caches.open('luma').then(function (c) { return c.put('/token', new Response(token)); });
});
function getToken() {
  if (token) return Promise.resolve(token);
  return caches.open('luma').then(function (c) { return c.match('/token'); })
    .then(function (r) { return r ? r.text() : ''; })
    .then(function (t) { token = t; return t; });
}

self.addEventListener('fetch', function (e) {
  // The page itself always comes fresh (its scripts carry version numbers), so a new version
  // reaches the Home Screen app at its next start instead of an old copy kept by Safari.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(function () { return fetch(e.request); }));
    return;
  }
  var url = new URL(e.request.url);
  var m = url.pathname.match(/\/stream\/([\w-]+)$/);
  if (m) { e.respondWith(stream(m[1], +url.searchParams.get('size'), e.request.headers.get('Range'))); return; }
  var p = url.pathname.match(/\/poster\/([\w-]+)$/);
  if (p) e.respondWith(poster(p[1]));
});

// Videos are read from Drive in 1 MB blocks, each kept in Cache Storage (the last 400, so
// about 400 MB): a seek into a part already loaded, or watching it again, needs no new Drive
// request; and while one block plays, the next ones come in side by side.
var BLOCK = 1024 * 1024, AHEAD = 4, KEEP = 400, SMALL = 65536;
var pending = {};   // block key -> its download (until it is in the cache)
var types = {};     // file id -> Drive's type for it ("video/x-matroska"…), seen on a first small read

function stream(id, size, range) {
  var start = 0, end = size - 1;
  var r = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (r) {
    if (r[1]) start = +r[1];
    if (r[2]) end = Math.min(+r[2], size - 1);
    if (!r[1] && r[2]) { start = size - +r[2]; end = size - 1; } // "bytes=-N": the last N bytes
  }
  var head = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Content-Range': 'bytes ' + start + '-' + end + '/' + size
  };
  // The player's first small reads (Safari asks for 2 bytes) go straight to Drive: a whole
  // block would only make the start slower.
  if (end - start < SMALL) {
    return getToken().then(function (t) {
      return fetch(FILES + id + '?alt=media&supportsAllDrives=true', {
        headers: { Authorization: 'Bearer ' + t, Range: 'bytes=' + start + '-' + end }
      });
    }).then(function (res) {
      if (!res.ok) return new Response('Drive replied ' + res.status, { status: res.status });
      var type = res.headers.get('Content-Type') || '';
      if (/^video\//.test(type)) types[id] = type;
      head['Content-Type'] = videoType(id);
      return new Response(res.body, { status: range ? 206 : 200, headers: head });
    });
  }
  var first = Math.floor(start / BLOCK), last = Math.floor(end / BLOCK), i = first;
  var body = new ReadableStream({
    pull: function (ctl) {
      if (i > last) { ctl.close(); return; }
      for (var k = i + 1; k <= Math.min(last, i + AHEAD); k++) block(id, size, k).catch(function () {});
      var b = i++;
      return block(id, size, b).then(function (buf) {
        var from = b === first ? start - b * BLOCK : 0;
        var to = b === last ? end - b * BLOCK + 1 : buf.byteLength;
        ctl.enqueue(new Uint8Array(buf, from, to - from));
      }, function (e) { ctl.error(e); });
    },
    cancel: function () { i = last + 1; } // the player moved on (a seek); blocks on their way are still kept
  });
  head['Content-Type'] = videoType(id);
  return Promise.resolve(new Response(body, { status: range ? 206 : 200, headers: head }));
}

// Drive's own type for the file, so Chrome and Brave also play MKV and WebM; else MP4.
function videoType(id) { return types[id] || 'video/mp4'; }

// One block of a video: from the cache, or from Drive (then kept). Asked twice while on its way,
// it is still downloaded once.
function block(id, size, i) {
  var key = '/vblock/' + id + '/' + i;
  if (pending[key]) return pending[key];
  var p = caches.open('luma-video').then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit) return hit.arrayBuffer().then(function (b) { delete pending[key]; return b; });
      var from = i * BLOCK, to = Math.min(size, from + BLOCK) - 1;
      return getToken().then(function (t) {
        return fetch(FILES + id + '?alt=media&supportsAllDrives=true', {
          headers: { Authorization: 'Bearer ' + t, Range: 'bytes=' + from + '-' + to }
        });
      }).then(function (res) {
        if (!res.ok) throw new Error('Drive replied ' + res.status);
        return res.arrayBuffer();
      }).then(function (buf) {
        if (buf.byteLength !== to - from + 1) throw new Error('Drive sent part of a block');
        // Kept for next time; the download stays in "pending" until the cache has it.
        c.put(key, new Response(buf)).then(function () { return trim(c); }).catch(function () { /* full: not kept */ })
          .then(function () { delete pending[key]; });
        return buf;
      });
    });
  });
  pending[key] = p;
  p.catch(function () { delete pending[key]; });
  return p;
}

// ponytail: drops the oldest blocks kept, not the least watched; an index would make it LRU.
function trim(c) {
  return c.keys().then(function (keys) {
    return Promise.all(keys.slice(0, Math.max(0, keys.length - KEEP)).map(function (k) { return c.delete(k); }));
  });
}

function poster(id) {
  var key = '/poster/' + id;
  return caches.open('luma-posters').then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      return getToken().then(function (t) {
        return fetch(FILES + id + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + t } });
      }).then(function (res) {
        if (!res.ok) return new Response('', { status: res.status });
        var copy = new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg' } });
        return cache.put(key, copy.clone()).then(function () { return copy; }, function () { return copy; });
      });
    });
  });
}
