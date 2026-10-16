const test = require('node:test');
const assert = require('node:assert/strict');
const originalFetch = global.fetch;
const originalInterval = global.setInterval;
global.fetch = async () => ({ ok: true, json: async () => ({ info: {}, aggregations: { image_count: { value: 1 }, by_source: { buckets: [] } } }) });
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer; };
const router = require('../routes/routes');
global.setInterval = originalInterval;
test.before(async () => {
  await new Promise(resolve => setImmediate(resolve));
  global.fetch = originalFetch;
});
const organize = require('../public/javascripts/organize');
const perspectives = require('../public/javascripts/perspectives');
const objectPath = '/object/:object_id/:image?/:image_id?';
function invoke(path, objectID, imageID, annotation) {
  const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
  return new Promise((resolve, reject) => handler({
    params: { object_id: String(objectID), image: 'image', image_id: String(imageID) },
    query: annotation ? { annotation: String(annotation) } : {}
  }, { render: (view, context) => resolve(context), json: resolve }, reject));
}

test('annotation-link bursts reuse API data and processing without mixing evidence selections', async t => {
  await new Promise(resolve => setImmediate(resolve));
  const calls = [];
  const body = 'Original annotation body.';
  t.mock.method(global, 'fetch', async url => {
    calls.push(url);
    await new Promise(resolve => setImmediate(resolve));
    const data = url.includes('/object/')
      ? { id: 216430, title: 'Test', images: [{ imageid: 350643 }, { imageid: 350511 }] }
      : url.includes('/image/') ? { imageid: Number(new URL(url).pathname.split('/').pop()) }
      : { records: [
        { id: 1, body, type: 'description', source: 'Amazon', confidence: 0.8, createdate: '2026-01-01' },
        { id: 2, body: 'bird', type: 'tag', feature: 'full', source: 'AWS Rekognition', confidence: 0.9, createdate: '2026-01-01' }
      ] };
    return { ok: true, json: async () => structuredClone(data) };
  });
  const divide = t.mock.method(organize, 'divide', organize.divide);
  const pages = await Promise.all(Array.from({ length: 16 }, (_, i) => invoke(objectPath, 216430, 350643, i % 2 + 1)));
  assert.equal(calls.length, 3, '16 requests make one object, one image and one annotation call');
  assert.equal(divide.mock.callCount(), 1, 'organize and text processing run once');
  for (let i = 0; i < pages.length; i++) {
    if (i % 2 === 0) {
      assert.equal(pages[i].selected_output_id, 1);
      assert.equal(pages[i].selected_annotation, null);
    } else {
      assert.equal(pages[i].selected_annotation.id, 2);
      assert.equal(pages[i].selected_annotation.confidence, 0.9, 'evidence retains original confidence');
      assert.equal(pages[i].selected_output_id, null);
    }
    assert.equal(pages[i].output_rows[0].body, body);
    assert.equal(pages[i].raw_annotations, undefined, 'internal cache data is not passed to the view');
  }
  pages[0].object_info.title = 'changed';
  const plain = await invoke(objectPath, 216430, 350643);
  assert.equal(plain.object_info.title, 'Test');
  assert.equal(plain.selected_output_id, null);
  assert.equal(calls.length, 3);
  const other = await invoke(objectPath, 216430, 350511, 1);
  assert.equal(other.display_image.imageid, 350511);
  assert.equal(calls.length, 5, 'another image reuses only the shared object record');
  await assert.rejects(invoke(objectPath, 216430, 999999), { status: 404 });
});

test('simultaneous Perspectives requests compute once and warm requests need no API calls', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async url => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return { ok: true, json: async () => url.includes('/object/')
      ? { id: 357409, title: 'Test', images: [{ imageid: 485206 }] }
      : { records: [] } };
  });
  const compute = t.mock.method(perspectives, 'compute', () => ({ observations: { count: 3 } }));
  const path = objectPath + '/perspectives';
  const results = await Promise.all(Array.from({ length: 16 }, () => invoke(path, 357409, 485206)));
  assert.equal(calls, 2);
  assert.equal(compute.mock.callCount(), 1);
  results[0].observations.count = 99;
  assert.equal((await invoke(path, 357409, 485206)).observations.count, 3);
  assert.equal(calls, 2);
});
