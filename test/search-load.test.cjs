const test = require('node:test');
const assert = require('node:assert/strict');

// Keep startup statistics offline and its daily timer from keeping tests alive.
const originalFetch = global.fetch;
const originalInterval = global.setInterval;
global.fetch = async () => ({ ok: true, json: async () => ({ info: {}, aggregations: { image_count: { value: 1 }, by_source: { buckets: [] } } }) });
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer; };
const router = require('../routes/routes');
global.setInterval = originalInterval;
global.fetch = originalFetch;
const search = router.stack.find(layer => layer.route?.path === '/search/:tag/:page?').route.stack[0].handle;
function invoke(page, query = {}) {
  return new Promise(resolve => search({ params: { tag: 'bird', page }, query }, {
    render: (view, context) => resolve({ view, context }),
  }, error => resolve({ error })));
}

test('deep search fetches text only for its visible images and retains ranking, totals and filters', async t => {
  // Let the three startup statistics requests complete before replacing fetch.
  await new Promise(resolve => setImmediate(resolve));
  const requests = [];
  const buckets = Array.from({ length: 2400 }, (_, i) => ({ key: i + 1, doc_count: 4, max_confidence: { value: 0.9 }, min_confidence: { value: 0.5 } }));
  t.mock.method(global, 'fetch', async url => {
    const parsed = new URL(url);
    const agg = JSON.parse(parsed.searchParams.get('aggregation') || 'null');
    requests.push({ parsed, agg });
    let data;
    if (requests.length === 1) {
      data = { info: { totalrecords: 15000 }, aggregations: { top_images: { buckets }, image_count: { value: 4000 }, source_count: { value: 1 }, by_source: { buckets: [] } } };
    } else if (requests.length === 2) {
      // Return details in a different order: display must retain the ranking.
      data = { aggregations: { top_images: { buckets: buckets.slice(-24).reverse().map(bucket => ({ key: bucket.key, top_annotations: { hits: { hits: [{ _source: { body: 'bird bird', source: 'AWS Rekognition', confidence: 0.9 } }] } } })) } } };
    } else {
      data = { records: buckets.slice(-24).map(bucket => ({ objectid: bucket.key, images: [{ imageid: bucket.key }] })) };
    }
    return { ok: true, json: async () => data };
  });
  const result = await invoke('100', { sort: 'frequency', source: 'AWS Rekognition' });
  assert.equal(result.error, undefined);
  assert.equal(result.view, 'search');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].agg.top_images.terms.size, 2400);
  assert.equal(requests[0].agg.top_images.aggs.top_annotations, undefined);
  assert.deepEqual(requests[0].agg.top_images.terms.order, { _count: 'desc' });
  assert.equal(requests[1].agg.top_images.terms.size, 24);
  assert.equal(requests[1].agg.top_images.aggs.top_annotations.top_hits.size, 75);
  assert.equal(requests[1].parsed.searchParams.get('q'), '(' + requests[0].parsed.searchParams.get('q') + ') AND imageid:(' + buckets.slice(-24).map(b => b.key).join(' OR ') + ')');
  assert.ok(requests[1].parsed.searchParams.get('q').includes('source:"AWS Rekognition"'));
  assert.deepEqual(result.context.object_results.map(object => object.imagehit.imageid), buckets.slice(-24).map(b => b.key));
  assert.equal(result.context.object_results[0].frequency, 4);
  assert.equal(result.context.object_results[0].term_frequency, 2);
  assert.equal(result.context.tag_results_info.totalrecords, 15000);
  assert.equal(result.context.tag_results_info.pages, 100);
});

test('out of range and malformed search pages return 404 without API work', async t => {
  t.mock.method(global, 'fetch', () => { throw new Error('Unexpected API work'); });
  for (const page of ['0', '-1', '101', '650', '1.5', 'invalid']) {
    assert.equal((await invoke(page)).error.status, 404);
  }
});

test('search and browse API failures reach Express instead of unhandled rejections', async t => {
  t.mock.method(global, 'fetch', async () => { throw new Error('unavailable'); });
  assert.equal((await invoke('1')).error.status, 502);
  for (const path of ['/feature/:tag/:page?', '/face/:page?', '/category/:category/:page?']) {
    const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
    const error = await new Promise(resolve => handler({ params: { tag: 'bird', category: 'nature' } }, {}, resolve));
    assert.equal(error.status, 502);
  }
});
