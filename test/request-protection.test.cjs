const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { requestProtection, apiJSON } = require('../lib/request-protection');

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.set = (key, value) => { res.headers[key] = value; return res; };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.body = body; res.writableEnded = true; res.emit('finish'); return res; };
  return res;
}

test('overload fails fast, and finish/close release each slot only once', () => {
  const protect = requestProtection({ maxConcurrent: 1 });
  const first = {}, firstRes = response();
  let accepted = 0;
  protect(first, firstRes, () => accepted++);
  const busy = response();
  protect({}, busy, () => accepted++);
  assert.equal(accepted, 1);
  assert.equal(busy.statusCode, 503);
  assert.equal(busy.headers['Retry-After'], '5');
  firstRes.emit('close');
  firstRes.emit('finish');
  assert.equal(first.upstreamSignal.aborted, true);
  const secondRes = response();
  protect({}, secondRes, () => accepted++);
  protect({}, response(), () => accepted++);
  assert.equal(accepted, 2);
  secondRes.emit('finish');
});

test('the request deadline aborts upstream work and responds before the router timeout', async () => {
  const req = {}, res = response();
  requestProtection({ timeoutMs: 10 })(req, res, () => {});
  await delay(30);
  assert.equal(req.upstreamSignal.aborted, true);
  assert.equal(res.statusCode, 504);
});

test('API timeout covers downloading the body after headers arrive', async t => {
  let aborted = false;
  t.mock.method(global, 'fetch', async (url, { signal }) => ({
    ok: true,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }),
  }));
  const keepAlive = delay(40);
  await assert.rejects(apiJSON('https://example.invalid/?apikey=secret', undefined, 10), { status: 504 });
  assert.equal(aborted, true);
  await keepAlive;
});

test('disconnect cancels a running fetch and already cancelled work never starts', async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(global, 'fetch', (url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const pending = apiJSON('https://example.invalid/', controller.signal);
  controller.abort();
  await assert.rejects(pending, { status: 504 });
  await assert.rejects(apiJSON('https://example.invalid/', controller.signal), { status: 504 });
  assert.equal(calls, 1);
});

test('upstream HTTP, network and invalid JSON errors are handled without revealing credentials', async t => {
  let cancelled = false;
  t.mock.method(global, 'fetch', async () => ({ ok: false, body: { cancel: async () => { cancelled = true; } } }));
  await assert.rejects(apiJSON('https://example.invalid/?apikey=secret'), { status: 502 });
  assert.equal(cancelled, true);
  global.fetch = async () => { throw new Error('https://example.invalid/?apikey=secret'); };
  await assert.rejects(apiJSON('https://example.invalid/?apikey=secret'), error => error.status === 502 && !error.message.includes('secret'));
  global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } });
  await assert.rejects(apiJSON('https://example.invalid/'), { status: 502 });
});
