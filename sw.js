// Adds the Google sign-in to what <video> and <img> cannot send it for:
//   stream/<file id>?size=<bytes>  a Drive video, answered the way Safari's player expects
//                                  (206, exact Content-Range and Content-Length; Chrome and
//                                  Brave take the same);
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

function stream(id, size, range) {
  var start = 0, end = size - 1;
  var r = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (r) {
    if (r[1]) start = +r[1];
    if (r[2]) end = Math.min(+r[2], size - 1);
    if (!r[1] && r[2]) { start = size - +r[2]; end = size - 1; } // "bytes=-N": the last N bytes
  }
  return getToken().then(function (t) {
    return fetch(FILES + id + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + t, Range: 'bytes=' + start + '-' + end }
    });
  }).then(function (res) {
    if (!res.ok) return new Response('Drive replied ' + res.status, { status: res.status });
    return new Response(res.body, {
      status: range ? 206 : 200,
      headers: {
        // Drive's own type for the file: Chrome and Brave also play MKV and WebM this way.
        'Content-Type': /^video\//.test(res.headers.get('Content-Type') || '') ? res.headers.get('Content-Type') : 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size
      }
    });
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
