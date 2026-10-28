const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: flush } = require('node:timers/promises');

process.env.MAX_CONCURRENT_REQUESTS = '4';
const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;

test('statistics retries failures, retains good data, avoids overlap, and respects job capacity', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let behavior = 'fail', calls = 0, total = 100, releaseResponse;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const errors = [];
  const originalError = console.error;
  t.mock.method(console, 'error', (...args) => {
    if (String(args[0]).startsWith('Stats cache refresh failed')) errors.push(args.join(' '));
    else originalError(...args);
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(global, 'fetch', async url => {
    calls++;
    if (behavior === 'pending-failure') await responseGate;
    if (behavior !== 'success') throw new Error('Simulated upstream failure');
    const query = JSON.parse(new URL(url).searchParams.get('aggregation'));
    const aggregations = query.image_count ? {
      image_count: { value: 10 },
      date_stats: { min_as_string: '2024-01-01T00:00:00Z', max_as_string: '2026-01-01T00:00:00Z' },
    } : query.by_source ? {
      by_source: { buckets: [{ key: 'Amazon', image_coverage: { value: 5 } }] },
    } : { by_type: { buckets: [] } };
    return { ok: true, json: async () => ({ info: { totalrecords: total }, aggregations }) };
  });

  const router = require('../routes/routes');
  const { runWork } = require('../lib/request-protection');
  const handler = router.stack.find(layer => layer.route?.path === '/statistics').route.stack[0].handle;
  function statistics() {
    return new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        send(body) { resolve({ status: this.statusCode, body }); },
        render(view, context) { resolve({ status: this.statusCode, view, context }); },
      };
      handler({}, res, reject);
    });
  }

  await flush();
  assert.equal(calls, 3, 'one startup attempt issues the three aggregation queries');
  assert.equal((await statistics()).status, 503, 'no successful data is available yet');
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /retrying in 60 seconds/);

  t.mock.timers.tick(MINUTE - 1);
  await flush();
  assert.equal(calls, 3, 'failure does not cause a tight retry loop');
  behavior = 'success';
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 6, 'retry occurs after one minute');
  const first = await statistics();
  assert.equal(first.status, 200);
  assert.equal(first.view, 'statistics');
  assert.equal(first.context.stats.annotation_count, '100');
  assert.equal(first.context.stats.image_count, '10');
  assert.equal(first.context.stats.aggregations.by_source.buckets[0].image_coverage.percentage, 50);

  t.mock.timers.tick(DAY - 1);
  await flush();
  assert.equal(calls, 6, 'success restores the daily schedule');
  behavior = 'pending-failure';
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 9);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 9, 'an in-flight refresh is not started again');
  assert.deepEqual((await statistics()).context.stats, first.context.stats, 'old data remains available during refresh');
  releaseResponse();
  await flush();
  assert.equal(errors.length, 2);
  assert.deepEqual((await statistics()).context.stats, first.context.stats, 'a failed refresh does not replace good data');

  t.mock.timers.tick(MINUTE - 1);
  await flush();
  assert.equal(calls, 9, 'retry delay starts when the failed attempt finishes');
  behavior = 'fail';
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 12);
  assert.equal(errors.length, 3);
  assert.equal((await statistics()).status, 200, 'repeated failures retain the last good data');

  behavior = 'success';
  total = 200;
  t.mock.timers.tick(MINUTE);
  await flush();
  assert.equal(calls, 15);
  assert.equal((await statistics()).context.stats.annotation_count, '200', 'a later successful retry replaces stale data');

  t.mock.timers.tick(DAY - 1);
  await flush();
  assert.equal(calls, 15);
  let releaseJobs;
  const jobsGate = new Promise(resolve => { releaseJobs = resolve; });
  const jobs = Array.from({ length: 4 }, () => runWork(() => jobsGate));
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 15, 'a refresh denied by the job limit makes no API calls');
  assert.equal(errors.length, 4);
  releaseJobs();
  await Promise.all(jobs);
  t.mock.timers.tick(MINUTE);
  await flush();
  assert.equal(calls, 18, 'a busy refresh retries once capacity is available');
  assert.equal((await statistics()).status, 200);
});
