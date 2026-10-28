const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createPerspectivesWorker } = require('../lib/perspectives-worker');
const { compute } = require('../public/javascripts/perspectives');
const fixture = require('./fixtures/positions-201162.json');
const workerPath = path.join(__dirname, 'fixtures/perspectives-worker.cjs');

function pool(t, options = {}) {
  const worker = createPerspectivesWorker({ workerPath, ...options });
  t.after(() => worker.close());
  return worker;
}

async function started(state) {
  for (let i = 0; i < 400 && !Atomics.load(state, 0); i++) await delay(5);
  assert.equal(Atomics.load(state, 0), 1, 'worker started its blocking task');
}

test('real analysis matches the existing output while the web thread keeps running', { timeout: 15000 }, async t => {
  const worker = pool(t, { workerPath: path.join(__dirname, '../lib/perspectives-thread.js') });
  const records = [...fixture.records, ...fixture.descriptions.map(record => ({ ...record, type: 'description' }))];
  const object = { id: fixture.id, title: fixture.title, classification: fixture.classification };
  const expected = compute(records, object, fixture.image);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  let result;
  try { result = await worker.compute(records, object, fixture.image); }
  finally { clearInterval(timer); }
  assert.ok(ticks >= 5, 'main-thread timers continue during CPU-heavy analysis');
  assert.ok(!Number.isNaN(Date.parse(result.generated_at)));
  delete expected.generated_at;
  delete result.generated_at;
  assert.deepEqual(result, expected);
});

test('one thread is reused and queued work is bounded; cancelling a waiter frees capacity', async t => {
  const worker = pool(t, { maxPending: 2 });
  const state = new Int32Array(new SharedArrayBuffer(8));
  const first = worker.compute(['busy'], { state: state.buffer }, {});
  await started(state);
  const controller = new AbortController();
  const queued = worker.compute(['cancelled'], {}, {}, controller.signal);
  const rejected = assert.rejects(queued, { status: 504 });
  await assert.rejects(worker.compute(['excess'], {}, {}), { status: 503, retryAfter: 5 });
  controller.abort();
  await rejected;
  const next = worker.compute(['next'], {}, {});
  Atomics.store(state, 1, 1);
  const a = await first, b = await next;
  assert.equal(a.threadId, b.threadId);
  assert.equal(b.action, 'next');
});

test('cancelling running CPU work terminates it before queued work starts', async t => {
  const worker = pool(t, { maxPending: 2 });
  const state = new Int32Array(new SharedArrayBuffer(8));
  const controller = new AbortController();
  const running = worker.compute(['busy'], { state: state.buffer }, {}, controller.signal);
  const rejected = assert.rejects(running, { status: 504 });
  await started(state);
  const queued = worker.compute(['after-cancellation'], {}, {});
  controller.abort();
  await rejected;
  assert.equal((await queued).action, 'after-cancellation');
  assert.equal(Atomics.load(state, 1), 0, 'the blocked computation was terminated, not allowed to finish');
});

test('worker crashes and unexpected exits reject the current task and recover for queued work', async t => {
  for (const action of ['crash', 'exit']) {
    const worker = pool(t, { maxPending: 2 });
    const failing = worker.compute([action], {}, {});
    const rejected = assert.rejects(failing, { status: 503, retryAfter: 5 });
    const queued = worker.compute(['recovered'], {}, {});
    await rejected;
    assert.equal((await queued).action, 'recovered');
  }
});

test('analysis errors and uncloneable input do not permanently occupy capacity', async t => {
  const worker = pool(t);
  await assert.rejects(worker.compute(['fail'], {}, {}), { status: 503 });
  await assert.rejects(worker.compute(['clone-error'], { fn: () => {} }, {}), { status: 503 });
  assert.equal((await worker.compute(['healthy'], {}, {})).action, 'healthy');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(worker.compute(['never-started'], {}, {}, controller.signal), { status: 504 });
});

test('closing rejects running and waiting work and prevents new tasks', async t => {
  const worker = pool(t);
  const state = new Int32Array(new SharedArrayBuffer(8));
  const running = worker.compute(['busy'], { state: state.buffer }, {});
  const runningRejected = assert.rejects(running, { status: 503 });
  await started(state);
  const queuedRejected = assert.rejects(worker.compute(['queued'], {}, {}), { status: 503 });
  await worker.close();
  await Promise.all([runningRejected, queuedRejected]);
  await assert.rejects(worker.compute(['closed'], {}, {}), { status: 503 });
});
