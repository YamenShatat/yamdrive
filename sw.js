// Adds the Google sign-in to what <video> and <img> cannot send it for:
//   stream/<file id>?size=<bytes>  a Drive video, answered the way Safari's player expects
//                                  (206, exact Content-Range and Content-Length; Chrome and
//                                  Brave take the same); the parts it loads are kept;
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

// Videos: one stream from Drive per request, passed on as it arrives (as smooth as a plain
// download), and the 1 MB blocks it passes through are kept in Cache Storage (the newest 400,
// about 400 MB). A later request starts from the kept blocks while there are any, so a seek
// into a part already loaded, or watching it again, needs no new Drive request.
var BLOCK = 1024 * 1024, KEEP = 400, SMALL = 65536;
var types = {};  // file id -> Drive's type for it ("video/x-matroska"…)
var saves = 0;

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
  var pos = start, net = null, cur = null, curIdx = -1, curFill = 0;

  // From Drive, from pos to the end of the request; Drive's type is noted for the headers.
  function openNet() {
    return getToken().then(function (t) {
      return fetch(FILES + id + '?alt=media&supportsAllDrives=true', {
        headers: { Authorization: 'Bearer ' + t, Range: 'bytes=' + pos + '-' + end }
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive replied ' + res.status);
      var type = res.headers.get('Content-Type') || '';
      if (/^video\//.test(type)) types[id] = type;
      net = res.body.getReader();
    });
  }
  // What comes from Drive is also gathered into whole blocks, each kept once it is complete
  // (a block the stream joined halfway is not kept).
  function gather(chunk, at) {
    for (var off = 0; off < chunk.length;) {
      var abs = at + off, b = Math.floor(abs / BLOCK), inBlock = abs - b * BLOCK;
      var len = Math.min(size, (b + 1) * BLOCK) - b * BLOCK;
      if (b !== curIdx) { curIdx = b; cur = inBlock === 0 ? new Uint8Array(len) : null; curFill = 0; }
      var n = Math.min(chunk.length - off, len - inBlock);
      if (cur) {
        cur.set(chunk.subarray(off, off + n), inBlock);
        curFill += n;
        if (curFill === len) { keep(id, b, cur.buffer); cur = null; }
      }
      off += n;
    }
  }
  function respond() {
    // Drive's own type for the file, so Chrome and Brave also play MKV and WebM; else MP4.
    head['Content-Type'] = types[id] || 'video/mp4';
    // Every pull must hand over bytes (or end): a stream does not ask again after an empty one.
    function fromNet(ctl) {
      return net.read().then(function (x) {
        if (x.done) { ctl.error(new Error('Drive ended early')); return; }
        var chunk = x.value.subarray(0, end - pos + 1);
        ctl.enqueue(chunk);
        gather(chunk, pos);
        pos += chunk.length;
      });
    }
    return new Response(new ReadableStream({
      pull: function (ctl) {
        if (pos > end) { ctl.close(); return; }
        if (net) return fromNet(ctl).catch(function (e) { ctl.error(e); });
        // Kept blocks first; at the first missing one, one Drive stream for the rest.
        return kept(id, Math.floor(pos / BLOCK)).then(function (buf) {
          if (!buf) return openNet().then(function () { return fromNet(ctl); });
          var b = Math.floor(pos / BLOCK), from = pos - b * BLOCK;
          var to = Math.min(buf.byteLength, end - b * BLOCK + 1);
          ctl.enqueue(new Uint8Array(buf, from, to - from));
          pos += to - from;
        }).catch(function (e) { ctl.error(e); });
      },
      cancel: function () { if (net) net.cancel(); } // the player moved on (a seek)
    }), { status: range ? 206 : 200, headers: head });
  }
  function failed(e) { return new Response(e.message, { status: 502 }); }
  // The player's first small reads (Safari asks for 2 bytes) are not worth a cache look.
  if (end - start < SMALL) return openNet().then(respond, failed);
  // Starting at a kept block: answer at once. Else open Drive first, so its type is in the headers.
  return kept(id, Math.floor(start / BLOCK)).then(function (buf) {
    return buf ? respond() : openNet().then(respond);
  }).catch(failed);
}

function kept(id, b) {
  return caches.open('luma-video').then(function (c) { return c.match('/vblock/' + id + '/' + b); })
    .then(function (hit) { return hit ? hit.arrayBuffer() : null; });
}
function keep(id, b, buf) {
  caches.open('luma-video').then(function (c) {
    return c.put('/vblock/' + id + '/' + b, new Response(buf)).then(function () {
      if (++saves % 20 === 0) return trim(c); // now and then, not after every block
    });
  }).catch(function () { /* storage full: not kept */ });
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
