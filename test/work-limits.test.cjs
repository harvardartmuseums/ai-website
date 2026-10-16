const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');

// Exercise the real app with one job slot, without opening sockets or using the API.
process.env.MAX_CONCURRENT_REQUESTS = '1';
const { createWorkLimiter, runWork } = require('../lib/request-protection');
const originalInterval = global.setInterval;
const originalFetch = global.fetch;
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer; };
global.fetch = async () => ({ ok: true, json: async () => ({ info: { totalrecords: 1 }, aggregations: { image_count: { value: 1 }, by_source: { buckets: [] } } }) });
const app = require('../app');
global.setInterval = originalInterval;
test.before(async () => {
  await new Promise(resolve => setImmediate(resolve));
  global.fetch = originalFetch;
  // registerPartials loads asynchronously. Wait for real template readiness,
  // rather than depending on earlier tests to give file reads time to finish.
  const partials = require('hbs').handlebars.partials;
  const required = ['outputs_index', 'compare_workspace', 'image_context', 'image_palette', 'startexploring'];
  for (let attempt = 0; attempt < 100 && !required.every(name => partials[name]); attempt++) await delay(1);
  assert.ok(required.every(name => partials[name]), 'all application partials are registered');
});
const { sharedCache } = require('../lib/shared-cache');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function request(path) {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    const req = new http.IncomingMessage(socket);
    req.method = 'GET';
    req.url = path;
    req.headers = { host: 'test.local', 'user-agent': 'test browser', 'x-forwarded-proto': 'https' };
    const res = new http.ServerResponse(req);
    res.end = body => {
      res.finished = true;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: String(body || '') });
      return res;
    };
    res.on('error', reject);
    app.handle(req, res);
  });
}

test('job capacity is released on success, rejection and synchronous exceptions', async () => {
  const run = createWorkLimiter({ maxConcurrent: 1 });
  const gate = deferred();
  const first = run(() => gate.promise);
  await assert.rejects(run(() => 'extra'), { status: 503, retryAfter: 5 });
  gate.resolve('done');
  assert.equal(await first, 'done');
  await assert.rejects(run(() => { throw new Error('failed'); }), /failed/);
  await assert.rejects(run(() => Promise.reject(new Error('failed async'))), /failed async/);
  assert.equal(await run(() => 'recovered'), 'recovered');
});

test('cancelled or expired jobs cannot permanently exhaust capacity, even if a loader ignores abort', async () => {
  const run = createWorkLimiter({ maxConcurrent: 1, timeoutMs: 10 });
  const controller = new AbortController();
  const cancelled = run(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { status: 504 });
  await assert.rejects(run(() => 'already cancelled', controller.signal), { name: 'AbortError' });
  const timedOut = assert.rejects(run(() => new Promise(() => {})), { status: 504 });
  await delay(30);
  await timedOut;
  assert.equal(await run(() => 'recovered'), 'recovered');
});

test('shared waiters occupy one job; waiting limits leave warm cache hits available', async () => {
  const run = createWorkLimiter({ maxConcurrent: 1 });
  const load = sharedCache({ maxWaiters: 2 });
  await load('warm', () => 'ready');
  const gate = deferred();
  let jobs = 0;
  const loader = signal => run(async () => { jobs++; return gate.promise; }, signal);
  const first = load('cold', loader), second = load('cold', loader);
  await assert.rejects(load('cold', loader), { status: 503 });
  await assert.rejects(load('other', loader), { status: 503 });
  assert.equal(await load('warm', () => { throw new Error('cache miss'); }), 'ready');
  gate.resolve('shared');
  assert.deepEqual(await Promise.all([first, second]), ['shared', 'shared']);
  assert.equal(jobs, 1);
  assert.equal(await load('other', () => 'next'), 'next');
});

test('late completion after cancellation cannot release another job’s slot', async () => {
  const run = createWorkLimiter({ maxConcurrent: 1 });
  for (let iteration = 0; iteration < 100; iteration++) {
    const controller = new AbortController();
    const late = deferred();
    const cancelled = run(() => late.promise, controller.signal);
    await Promise.resolve();
    controller.abort();
    await assert.rejects(cancelled, { status: 504 });
    const current = deferred();
    const running = run(() => current.promise);
    late.resolve('old result');
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(run(() => 'extra'), { status: 503 });
    current.resolve('current result');
    assert.equal(await running, 'current result');
  }
});

test('cancelling cache waiters restores waiting capacity and cancels unused jobs', async () => {
  const run = createWorkLimiter({ maxConcurrent: 1 });
  const load = sharedCache({ maxWaiters: 1 });
  const controller = new AbortController();
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const first = load('a', signal => run(() => { started(); return new Promise(() => {}); }, signal), controller.signal);
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  await running;
  controller.abort();
  await cancelled;
  assert.equal(await load('b', signal => run(() => 'recovered', signal)), 'recovered');
});

test('home, redirects and warm workspaces remain available while new expensive work is rejected', async t => {
  await new Promise(resolve => setImmediate(resolve)); // Startup statistics finish first.
  let apiCalls = 0;
  t.mock.method(global, 'fetch', async url => {
    apiCalls++;
    return { ok: true, json: async () => url.includes('/object/')
      ? { id: 700001, title: 'Cached artwork', images: [{ imageid: 800001 }] }
      : url.includes('/image/') ? { imageid: 800001 } : { records: [] } };
  });
  assert.equal((await request('/object/700001/image/800001')).status, 200);
  assert.equal((await request('/object/700001/image/800001/perspectives')).status, 200);
  const warmCalls = apiCalls;
  const gate = deferred();
  const occupied = runWork(() => gate.promise);
  try {
    for (const path of ['/', '/about', '/explore', '/object/700001/image/800001', '/object/700001/image/800001/perspectives']) {
      assert.equal((await request(path)).status, 200, path);
    }
    assert.equal((await request('/object/700001/image/800001/compare')).status, 302);
    assert.equal(apiCalls, warmCalls, 'warm pages do not need new API calls');
    for (const path of ['/search/bird', '/object/700002/image/800002']) {
      const busy = await request(path);
      assert.equal(busy.status, 503, path);
      assert.equal(busy.headers['retry-after'], '5');
      assert.equal(busy.body, 'The site is busy. Please try again shortly.');
    }
    assert.equal(apiCalls, warmCalls, 'rejected jobs never start API work');
  } finally {
    gate.resolve();
    await occupied;
  }
});

test('many cold-page visitors share the one slot instead of rejecting each other', async t => {
  const gate = deferred();
  const entered = deferred();
  let apiCalls = 0;
  t.mock.method(global, 'fetch', async url => {
    apiCalls++;
    if (url.includes('/object/')) { entered.resolve(); await gate.promise; }
    return { ok: true, json: async () => url.includes('/object/')
      ? { id: 700003, title: 'Shared artwork', images: [{ imageid: 800003 }] }
      : url.includes('/image/') ? { imageid: 800003 } : { records: [] } };
  });
  const visitors = Array.from({ length: 24 }, () => request('/object/700003/image/800003'));
  await entered.promise;
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/search/bird')).status, 503);
  gate.resolve();
  const results = await Promise.all(visitors);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(apiCalls, 3);
});

test('cached Perspectives bypass processing capacity even when object metadata was not retained', async t => {
  let apiCalls = 0;
  t.mock.method(global, 'fetch', async url => {
    apiCalls++;
    return { ok: true, json: async () => url.includes('/object/')
      ? { id: 700004, images: [{ imageid: 800004 }], extra: 'x'.repeat(4 * 1024 * 1024) }
      : { records: [] } };
  });
  const path = '/object/700004/image/800004/perspectives';
  assert.equal((await request(path)).status, 200);
  assert.equal(apiCalls, 2);
  const gate = deferred();
  const occupied = runWork(() => gate.promise);
  try {
    assert.equal((await request(path)).status, 200);
    assert.equal(apiCalls, 2, 'the cached analysis does not try to reload oversized metadata');
  } finally {
    gate.resolve();
    await occupied;
  }
});
