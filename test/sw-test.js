// Run: node test/sw-test.js sw.js
// Runs luma-web/sw.js against a fake Drive (a 5 MB file served by range) and fake Cache Storage.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(process.argv[2], 'utf8');
const SIZE = 5 * 1024 * 1024 + 12345;
const data = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) data[i] = (i * 31 + (i >> 9)) & 255;

let calls = [], failWith = 0;
const stores = {};
const caches = {
  open: async (n) => {
    const m = stores[n] || (stores[n] = new Map());
    return {
      match: async (k) => (m.has(k) ? m.get(k).clone() : undefined),
      put: async (k, r) => { m.set(k, r); },
      keys: async () => [...m.keys()],
      delete: async (k) => m.delete(k),
    };
  },
};
const fetch = async (url, opts) => {
  const r = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
  const s = +r[1], e = +r[2];
  calls.push([s, e]);
  if (failWith) return new Response('no', { status: failWith });
  return new Response(data.subarray(s, e + 1), { status: 206, headers: { 'Content-Type': 'video/x-matroska' } });
};
const listeners = {};
const ctx = {
  self: { addEventListener: (t, f) => (listeners[t] = f), skipWaiting() {}, clients: { claim() {} } },
  caches, fetch, Response, ReadableStream, URL, Promise, Uint8Array, Math, String, Error, setTimeout, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

function request(range) {
  let p;
  listeners.fetch({
    request: { mode: 'no-cors', url: 'https://x.io/yamdrive/stream/FILE1?size=' + SIZE, headers: { get: () => range } },
    respondWith: (x) => (p = x),
  });
  return p;
}
const settle = () => new Promise((r) => setTimeout(r, 50));

function expected(range) {
  let s = 0, e = SIZE - 1;
  const r = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (r) {
    if (r[1]) s = +r[1];
    if (r[2]) e = Math.min(+r[2], SIZE - 1);
    if (!r[1] && r[2]) { s = SIZE - +r[2]; e = SIZE - 1; }
  }
  return [s, e];
}

(async () => {
  const ranges = ['bytes=0-1', 'bytes=0-', 'bytes=1048570-', 'bytes=3000000-4000000', 'bytes=-500', 'bytes=-200000',
    null, 'bytes=1048576-2097151', 'bytes=5242879-5242890', 'bytes=4194304-'];
  for (const range of ranges) {
    const res = await request(range);
    const buf = Buffer.from(await res.arrayBuffer());
    const [s, e] = expected(range);
    assert.strictEqual(res.status, range ? 206 : 200, 'status ' + range);
    assert.strictEqual(+res.headers.get('Content-Length'), e - s + 1, 'length header ' + range);
    assert.strictEqual(res.headers.get('Content-Range'), 'bytes ' + s + '-' + e + '/' + SIZE, 'range header ' + range);
    assert.strictEqual(buf.length, e - s + 1, 'bytes sent ' + range);
    assert.ok(buf.equals(data.subarray(s, e + 1)), 'bytes match ' + range);
    console.log('ok', range, buf.length, 'bytes,', res.headers.get('Content-Type'));
  }
  await settle();

  // Read again: every block is in the cache, Drive is not asked.
  calls = [];
  const again = Buffer.from(await (await request('bytes=2500000-')).arrayBuffer());
  assert.ok(again.equals(data.subarray(2500000)), 'cached bytes match');
  assert.strictEqual(calls.length, 0, 'second read asked Drive ' + calls.length + ' times');
  console.log('ok second read from the cache: 0 Drive requests');

  // Two reads at once of the same part: each block downloaded once.
  stores['luma-video'] = new Map();
  calls = [];
  const [a, b] = await Promise.all([request('bytes=0-'), request('bytes=0-')]);
  await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const blocks = calls.map((c) => c[0]);
  assert.strictEqual(new Set(blocks).size, blocks.length, 'a block downloaded twice');
  console.log('ok two reads at once:', calls.length, 'Drive requests for', Math.ceil(SIZE / 1048576), 'blocks');

  // Only the newest KEEP blocks are kept.
  await settle();
  vm.runInContext('KEEP = 3', ctx);
  stores['luma-video'] = new Map();
  await (await request('bytes=0-')).arrayBuffer();
  await settle();
  assert.ok(stores['luma-video'].size <= 3, 'kept ' + stores['luma-video'].size);
  console.log('ok trimmed to', stores['luma-video'].size, 'blocks');

  // Drive refuses (an expired sign-in): the player gets an error, not wrong bytes.
  stores['luma-video'] = new Map();
  failWith = 401;
  let failed = false;
  try { await (await request('bytes=0-')).arrayBuffer(); } catch (e) { failed = true; }
  assert.ok(failed, 'error not passed on');
  failWith = 0;
  calls = [];
  const after = Buffer.from(await (await request('bytes=0-')).arrayBuffer());
  assert.ok(after.equals(data), 'after an error the blocks download again');
  console.log('ok a refusal reaches the player, and the next try works');
  console.log('ALL PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
