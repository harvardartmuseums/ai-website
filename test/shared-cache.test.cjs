const test = require('node:test');
const assert = require('node:assert/strict');
const { sharedCache, cacheTTLms } = require('../lib/shared-cache');

test('cache lifetime accepts hours and defaults safely to 12 hours', t => {
  const twelveHours = 12 * 60 * 60 * 1000;
  for (const invalid of ['', ' ', 'invalid', '0', '-1', 'Infinity', '1e30']) {
    assert.equal(cacheTTLms(invalid), twelveHours);
  }
  assert.equal(cacheTTLms('12'), twelveHours);
  assert.equal(cacheTTLms('1'), 3600000);
  assert.equal(cacheTTLms('0.5'), 1800000);
  const original = process.env.CACHE_TTL_HOURS;
  t.after(() => {
    if (original === undefined) delete process.env.CACHE_TTL_HOURS;
    else process.env.CACHE_TTL_HOURS = original;
  });
  delete process.env.CACHE_TTL_HOURS;
  assert.equal(cacheTTLms(), twelveHours);
  process.env.CACHE_TTL_HOURS = '2';
  assert.equal(cacheTTLms(), 7200000);
});

test('configured lifetime is used by cache instances and hits do not extend expiry', async t => {
  const original = process.env.CACHE_TTL_HOURS;
  t.after(() => {
    if (original === undefined) delete process.env.CACHE_TTL_HOURS;
    else process.env.CACHE_TTL_HOURS = original;
  });
  process.env.CACHE_TTL_HOURS = '12';
  let time = 0, calls = 0;
  const load = sharedCache({ now: () => time });
  const loader = async () => ++calls;
  assert.equal(await load('a', loader), 1);
  time = 12 * 60 * 60 * 1000 - 1;
  assert.equal(await load('a', loader), 1);
  time++;
  assert.equal(await load('a', loader), 2);
  process.env.CACHE_TTL_HOURS = '0.5';
  const shorter = sharedCache({ now: () => time });
  assert.equal(await shorter('a', loader), 3);
  time += 1800000;
  assert.equal(await shorter('a', loader), 4);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('overlapping loads share work but every caller receives an independent copy', async () => {
  const load = sharedCache();
  const ready = deferred();
  let calls = 0;
  const loader = async () => { calls++; await ready.promise; return { records: [{ confidence: 0.8 }] }; };
  const first = load('image', loader), second = load('image', loader);
  ready.resolve();
  const [a, b] = await Promise.all([first, second]);
  a.records[0].confidence = 80;
  assert.equal(b.records[0].confidence, 0.8);
  assert.equal((await load('image', loader)).records[0].confidence, 0.8);
  assert.equal(calls, 1);
});

test('cache expires and evicts least recently used entries at byte and entry limits', async () => {
  let time = 0, calls = 0;
  const load = sharedCache({ ttlMs: 10, maxBytes: 8, maxEntries: 2, now: () => time });
  const loader = async () => { calls++; return 'ab'; }; // Four UTF-8 bytes including quotes.
  await load('a', loader);
  await load('b', loader);
  await load('a', loader);
  await load('c', loader);
  await load('a', loader);
  assert.equal(calls, 3);
  await load('b', loader);
  assert.equal(calls, 4, 'least recently used entry was evicted');
  time = 11;
  await load('b', loader);
  assert.equal(calls, 5, 'expired data is fetched again');
  const oneEntry = sharedCache({ maxBytes: 100, maxEntries: 1 });
  await oneEntry('a', loader);
  await oneEntry('b', loader);
  await oneEntry('a', loader);
  assert.equal(calls, 8, 'entry cap applies independently of byte cap');
});

test('oversize results and failures are never retained', async () => {
  const load = sharedCache({ maxBytes: 4 });
  let calls = 0;
  const big = async () => { calls++; return 'large'; };
  await load('a', big);
  await load('a', big);
  assert.equal(calls, 2);
  await assert.rejects(load('b', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await load('b', async () => 'ok'), 'ok');
});

test('one disconnected subscriber does not cancel another visitor’s shared work', async () => {
  const load = sharedCache();
  const ready = deferred();
  const first = new AbortController(), second = new AbortController();
  let sharedSignal;
  const loader = async signal => { sharedSignal = signal; await ready.promise; return { ok: true }; };
  const a = load('a', loader, first.signal), b = load('a', loader, second.signal);
  const cancelled = assert.rejects(a, { name: 'AbortError' });
  await Promise.resolve();
  first.abort();
  assert.equal(sharedSignal.aborted, false);
  ready.resolve();
  await cancelled;
  assert.deepEqual(await b, { ok: true });
});

test('the final disconnect cancels work, and a new visitor can immediately retry', async () => {
  const load = sharedCache();
  const first = new AbortController();
  let sharedSignal;
  const a = load('a', signal => {
    sharedSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, first.signal);
  const cancelled = assert.rejects(a, { name: 'AbortError' });
  await Promise.resolve();
  first.abort();
  assert.equal(sharedSignal.aborted, true);
  assert.equal(await load('a', async () => 'retry'), 'retry');
  await cancelled;
  await assert.rejects(load('a', () => { throw new Error('should not run'); }, first.signal), { name: 'AbortError' });
});
