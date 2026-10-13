const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const perspectives = require('../public/javascripts/perspectives');
const organize = require('../public/javascripts/organize');
const baseline = require('./fixtures/perspectives-before-workspace.json');

test('unaffected baseline scores, flags, and raw AI radar counts remain stable', () => {
  const expected = structuredClone(baseline.result);
  const actual = perspectives.compute(baseline.records, baseline.object, baseline.image);
  for (const source of actual.coverage_radar.sources) {
    for (const value of Object.values(source.values)) {
      assert.equal(value.terms.length, value.raw);
      assert.ok(value.annotation_ids.every(id => baseline.records.some(record => record.id === id)));
      delete value.terms;
      delete value.annotation_ids;
    }
  }
  // Evidence and extraction counts intentionally change in stage 1. Keep the
  // old fixture as an independent check of unaffected analytical decisions.
  const scoring = result => ({
    summary: (({divergence_signals_returned, concept_relationships_returned, ...summary}) => summary)(result.summary),
    catalogue: result.catalogue,
    concepts: result.concepts.map(({example_annotations, ...concept}) => concept),
    thematic_concepts: result.thematic_concepts.map(({snippet, example_annotations, ...concept}) => concept),
    coverage_radar: result.coverage_radar.sources.filter(s => s.source !== 'Curator').map(s => ({
      source: s.source, raw: Object.fromEntries(Object.entries(s.values).map(([key, v]) => [key, v.raw]))
    })),
  });
  assert.deepEqual(scoring(actual), scoring(expected));
});

test('a provider outside the display catalog retains its image description and zero token usage', () => {
  const grouped = organize.divide([{ id: 404, source: 'New Provider', type: 'description', body: 'A man wears a hat.', confidence: 1, raw: { usage: { inputTokens: 10, outputTokens: 0 } } }]);
  const group = grouped.descriptions.find(group => group.source === 'New Provider');
  assert.equal(group.descriptions[0].id, 404);
  assert.equal(group.descriptions[0].cost.total, 10);
  assert.equal(group.descriptions[0].createdate, '');
});

test('workspace and comparison partials render sparse records and parse their embedded scripts', () => {
  const hbs = require('hbs');
  require('handlebars-helpers')({ handlebars: hbs });
  hbs.registerHelper('urlencode', value => encodeURIComponent(value == null ? '' : String(value)));
  hbs.registerPartial('image_context', fs.readFileSync(path.join(__dirname, '../views/partials/image-context.hbs'), 'utf8'));
  hbs.registerPartial('compare_workspace', fs.readFileSync(path.join(__dirname, '../views/partials/compare-workspace.hbs'), 'utf8'));
  const render = hbs.handlebars.compile(fs.readFileSync(path.join(__dirname, '../views/object.hbs'), 'utf8'));
  const html = render({ object_info: { id: 1, title: 'A title < & >' }, display_image: { imageid: 2 }, selected_annotation: {id: 3, source: 'Test', model: 'raw-model-id', type: 'description', body: '<script>unsafe()</script>'}, ai_sorted: { tagsect: [{ source: 'Test', tags: [{ body: 'red/blue?', confidence: 50 }] }] } });
  assert.ok(html.includes('AI analysis of image 2'));
  assert.ok(html.includes('No model descriptions are available for this image.'));
  assert.ok(html.includes('No descriptions available for this image.'));
  assert.ok(html.includes('A title &lt; &amp; &gt;'));
  assert.ok(html.includes('/search/red%2Fblue%3F'));
  assert.ok(html.includes('Complete source annotation'));
  assert.ok(html.includes('raw-model-id'));
  assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
  const repeatedRuns = hbs.handlebars.compile(fs.readFileSync(path.join(__dirname, '../views/partials/compare-workspace.hbs'), 'utf8'))({descriptions_list: [
    {key: 'annotation_101', annotation_id: 101, source: 'Amazon', model: 'same-model', body: 'A hat.', createdate: '2026-06-01'},
    {key: 'annotation_104', annotation_id: 104, source: 'Amazon', model: 'same-model', body: 'A hat.', createdate: '2026-07-01'},
  ]});
  assert.ok(repeatedRuns.includes('same-model · 2026-06-01 · Annotation 101'));
  assert.ok(repeatedRuns.includes('same-model · 2026-07-01 · Annotation 104'));
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
});

test('object routes bind analysis to the requested image, reject mismatches, and retain legacy comparison links', async () => {
  const originalFetch = global.fetch;
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer; };
  global.fetch = async () => ({ ok: true, json: async () => ({ aggregations: { by_source: { buckets: [] } } }) });
  const router = require('../routes/routes');
  global.setInterval = originalInterval;
  function invoke(routePath, params, query = {}) {
    const route = router.stack.find(layer => layer.route && layer.route.path === routePath);
    return new Promise(resolve => route.route.stack[0].handle({ params, query }, {
      render: (view, context) => resolve({ view, context }),
      redirect: url => resolve({ url }),
    }, error => resolve({ error })));
  }
  const object = { id: 1, title: 'Test', labeltext: 'Object interpretation.', images: [{ imageid: 10 }, { imageid: 20, description: 'Image interpretation.' }] };
  const requested = [];
  try {
    global.fetch = async url => {
      requested.push(url.includes('image=20'));
      return { ok: true, json: async () => url.includes('/object/') ? structuredClone(object) : { records: [{ id: 77, source: 'Amazon', type: 'description', confidence: 1, body: 'A man.', createdate: '2026-01-01T12:34:56Z' }] } };
    };
    const routePath = '/object/:object_id/:image?/:image_id?';
    const valid = await invoke(routePath, { object_id: '1', image: 'image', image_id: '20' });
    assert.equal(valid.view, 'object');
    assert.equal(valid.context.display_image.imageid, 20);
    assert.ok(valid.context.image_summary.descriptions.includes('Jan 2026'));
    assert.ok(requested.includes(true));
    assert.equal(valid.context.object_images[1].selected, true);
    assert.equal(valid.context.descriptions_list.find(d => d.key === 'labeltext').scope, 'Object wall label');
    assert.equal(valid.context.descriptions_list.find(d => d.annotation_id === 77).scope, 'Image 20');
    const linked = await invoke(routePath, { object_id: '1', image: 'image', image_id: '20' }, {annotation: '77'});
    assert.equal(linked.context.selected_annotation.id, 77);
    assert.equal(linked.context.selected_annotation.createdate, '2026-01-01T12:34:56Z');
    assert.equal(linked.context.selected_annotation.body, 'A man.');
    const invalid = await invoke(routePath, { object_id: '1', image: 'image', image_id: '999' });
    assert.equal(invalid.error.status, 404);
    const old = await invoke('/object/:object_id/:image?/:image_id?/compare', { object_id: '1', image: 'image', image_id: '20' });
    assert.equal(old.url, '/object/1/image/20#compare');
  } finally { global.fetch = originalFetch; }
});
