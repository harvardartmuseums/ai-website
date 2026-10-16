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
  res.destroy = () => { res.destroyed = true; res.emit('close'); };
  return res;
}

test('requests closed before admission never start work or consume capacity', async () => {
  const protect = requestProtection({ maxConcurrent: 1, timeoutMs: 10 });
  let accepted = 0;
  const closed = response();
  closed.destroy();
  protect({}, closed, () => accepted++);
  protect({ aborted: true }, response(), () => accepted++);
  protect({}, Object.assign(response(), { writableEnded: true }), () => accepted++);
  assert.equal(accepted, 0);
  await delay(30);
  const healthy = response();
  protect({}, healthy, () => accepted++);
  assert.equal(accepted, 1);
  assert.equal(healthy.statusCode, undefined);
  healthy.emit('finish');
});

test('deadline frees a slot even when a destroyed response never emits close', async () => {
  const protect = requestProtection({ maxConcurrent: 1, timeoutMs: 10 });
  const req = {}, departed = response();
  protect(req, departed, () => {});
  departed.destroyed = true; // Simulate an unavailable/already missed close event.
  await delay(30);
  assert.equal(req.upstreamSignal.aborted, true);
  let accepted = false;
  const healthy = response();
  protect({}, healthy, () => { accepted = true; });
  assert.equal(accepted, true);
  healthy.emit('finish');
});

test('deadline closes partially written responses and releases capacity', async () => {
  const protect = requestProtection({ maxConcurrent: 1, timeoutMs: 10 });
  const req = {}, partial = response();
  protect(req, partial, () => {});
  partial.headersSent = true;
  await delay(30);
  assert.equal(partial.destroyed, true);
  assert.equal(req.upstreamSignal.aborted, true);
  const healthy = response();
  let accepted = false;
  protect({}, healthy, () => { accepted = true; });
  assert.equal(accepted, true);
  healthy.emit('finish');
});

test('request abort releases capacity once even if response close arrives later', () => {
  const protect = requestProtection({ maxConcurrent: 1 });
  const req = new EventEmitter(), departed = response();
  protect(req, departed, () => {});
  req.emit('aborted');
  departed.emit('close');
  assert.equal(req.upstreamSignal.aborted, true);
  assert.equal(req.listenerCount('aborted'), 0);
  const healthy = response();
  let accepted = 0;
  protect({}, healthy, () => accepted++);
  const busy = response();
  protect({}, busy, () => accepted++);
  assert.equal(accepted, 1);
  assert.equal(busy.statusCode, 503);
  healthy.emit('finish');
});

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
