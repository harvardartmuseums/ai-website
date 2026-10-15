const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const perspectives = require('../public/javascripts/perspectives');
const organize = require('../public/javascripts/organize');
const baseline = require('./fixtures/perspectives-before-workspace.json');

test('unaffected baseline scores and flags remain stable; radar counts stay consistent with their evidence', () => {
  const expected = structuredClone(baseline.result);
  const actual = perspectives.compute(baseline.records, baseline.object, baseline.image);
  // Radar counts follow the curated dimension vocabularies, which are edited
  // on purpose, so they are not frozen against the fixture. What must always
  // hold: each count is the number of matched terms, and every supporting
  // annotation is a real record.
  for (const source of actual.coverage_radar.sources) {
    for (const value of Object.values(source.values)) {
      assert.equal(value.terms.length, value.raw);
      assert.ok(value.annotation_ids.every(id => baseline.records.some(record => record.id === id)));
    }
  }
  // Agreement scoring, thresholds, thematic scoring and flags do not depend on
  // those vocabularies: keep the old fixture as an independent check of them.
  const scoring = result => ({
    summary: (({divergence_signals_returned, concept_relationships_returned, ...summary}) => summary)(result.summary),
    catalogue: result.catalogue,
    concepts: result.concepts.map(({example_annotations, ...concept}) => concept),
    thematic_concepts: result.thematic_concepts.map(({snippet, example_annotations, ...concept}) => concept),
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
  hbs.registerPartial('outputs_index', fs.readFileSync(path.join(__dirname, '../views/partials/outputs-index.hbs'), 'utf8'));
  const render = hbs.handlebars.compile(fs.readFileSync(path.join(__dirname, '../views/object.hbs'), 'utf8'));
  const html = render({ object_info: { id: 1, title: 'A title < & >' }, display_image: { imageid: 2 }, workspace_stats: { descriptions: 0, detections: 1 }, selected_annotation: {id: 3, source: 'Test', model: 'raw-model-id', type: 'tag', body: '<script>unsafe()</script>'}, ai_sorted: { tagsect: [{ source: 'Test', tags: [{ body: 'red/blue?', confidence: 50 }] }] } });
  // The heading frames the artwork as the subject of AI's account (escaped).
  assert.ok(html.includes('<h1>How AI describes <cite>A title &lt; &amp; &gt;</cite></h1>'));
  for (const view of ['overview', 'descriptions', 'vocabulary', 'compare', 'detections', 'data']) {
    assert.ok(html.includes(`data-research-panel="${view}"`), view + ' panel renders');
  }
  // The line under it sizes the data and names the image, in every case.
  assert.match(html, /No AI descriptions of image 2\s/);
  const one = render({ object_info: { id: 1, title: 'T' }, display_image: { imageid: 2 }, workspace_stats: { descriptions: 1, providers: 1, years: '2026' } });
  assert.match(one, /1 description from 1 provider of image 2, generated 2026\s/);
  const many = render({ object_info: { id: 1, title: 'T' }, display_image: { imageid: 2 }, multiple_images: true, image_position: 1, object_images: [{}, {}, {}], workspace_stats: { descriptions: 42, providers: 11, years: '2018–2026' } });
  assert.match(many, /42 descriptions from 11 providers of image 2 \(1 of 3\), generated 2018–2026/);
  // The museum record's label shows artist, date and medium; details open beneath.
  const record = render({ object_info: { id: 1, title: 'T', people: [{ name: 'Alfred Kubin' }], dated: 'c. 1910', medium: 'Ink', labeltext: 'Label.' }, display_image: { imageid: 2 }, workspace_stats: {} });
  assert.match(record, /<summary>Museum record: Alfred Kubin · c\. 1910 · Ink<\/summary>/);
  assert.ok(record.includes('Object wall label'));
  assert.match(render({ object_info: { id: 1, title: 'T' }, display_image: { imageid: 2 }, workspace_stats: {} }), /<summary>Museum record<\/summary>/);
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

test('the outputs index renders one row and one reader entry per AI description, escaping text', () => {
  const hbs = require('hbs');
  require('handlebars-helpers')({ handlebars: hbs });
  const render = hbs.handlebars.compile(fs.readFileSync(path.join(__dirname, '../views/partials/outputs-index.hbs'), 'utf8'));
  const html = render({ selected_output_id: 102, output_rows: [
    { key: 'annotation_101', annotation_id: 101, source: 'Amazon Nova', source_raw: 'Amazon', model: 'nova-id', display_model: 'Nova <Pro>', createdate: '2026-06-01', words: 3, body: 'A **hat**.' },
    { key: 'annotation_102', annotation_id: 102, source: 'OpenAI GPT', source_raw: 'OpenAI', model: '', display_model: 'Unspecified model', createdate: '', words: 2, body: 'A coat.', stats: { lexicalDensity: 50, ttr: 100, hapaxRatio: 100, avgSentLen: 2 } },
  ] });
  assert.equal((html.match(/class="outputs-row" /g) || []).length, 2);
  assert.equal((html.match(/class="outputs-entry"/g) || []).length, 2);
  assert.ok(html.includes('data-initial-selection="102"'));
  assert.ok(html.includes('Nova &lt;Pro&gt;'));
  assert.ok(html.includes('<strong>hat</strong>'), 'description Markdown renders');
  assert.ok(html.includes('not recorded'), 'a missing model identifier is stated, not left blank');
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
      // The full image record; image 10's request fails to show the fallback.
      if (url.includes('/image/')) return url.includes('/image/20?')
        ? { ok: true, json: async () => ({ imageid: 20, colors: [{ color: '#e1c8af', hue: 'Orange', percent: 0.34 }] }) }
        : { ok: false, json: async () => ({ error: 'Not found' }) };
      return { ok: true, json: async () => url.includes('/object/') ? structuredClone(object) : { records: [
        { id: 77, source: 'Amazon', type: 'description', confidence: 1, body: 'A man.', createdate: '2026-01-01T12:34:56Z' },
        // The same word read twice (line and word level) is one reading.
        { id: 78, source: 'AWS Rekognition', type: 'text', feature: 'region', body: 'thuli', createdate: '2026-01-01', target: 'https://x/full/full/0/default.jpg', selectors: [{ value: 'xywh=1,1,10,10' }] },
        { id: 79, source: 'AWS Rekognition', type: 'text', feature: 'region', body: 'thuli', createdate: '2026-01-01', target: 'https://x/full/full/0/default.jpg', selectors: [{ value: 'xywh=1,1,10,9' }] },
      ] } };
    };
    const routePath = '/object/:object_id/:image?/:image_id?';
    const valid = await invoke(routePath, { object_id: '1', image: 'image', image_id: '20' });
    assert.equal(valid.view, 'object');
    assert.equal(valid.context.display_image.imageid, 20);
    // Colours come from the image record; embedded fields survive the merge.
    assert.equal(valid.context.display_image.colors[0].color, '#e1c8af');
    assert.equal(valid.context.display_image.description, 'Image interpretation.');
    const withoutImageRecord = await invoke(routePath, { object_id: '1', image: 'image', image_id: '10' });
    assert.equal(withoutImageRecord.view, 'object', 'a failed image request still renders the page');
    assert.equal(withoutImageRecord.context.display_image.colors, undefined);
    assert.ok(valid.context.image_summary.descriptions.includes('Jan 2026'));
    assert.ok(requested.includes(true));
    assert.equal(valid.context.object_images[1].selected, true);
    assert.equal(valid.context.descriptions_list.find(d => d.key === 'labeltext').scope, 'Object wall label');
    assert.equal(valid.context.descriptions_list.find(d => d.annotation_id === 77).scope, 'Image 20');
    assert.deepEqual(valid.context.workspace_stats, { descriptions: 1, providers: 1, tags: 0, regions: 0, faces: 0, categories: 0, text: 1, years: '2026', detections: 1 });
    assert.equal(valid.context.output_rows.length, 1, 'human references stay out of the index');
    assert.equal(valid.context.output_rows[0].words, 2);
    assert.equal(valid.context.image_position, 2);
    // Image strip: one link per image, labelled without IDs, current one marked.
    assert.deepEqual(valid.context.image_choices.map(c => [c.url, c.label, c.selected, c.thumbnail]), [
      ['/object/1/image/10', 'Image 1 of 2', false, null],
      ['/object/1/image/20', 'Image 2 of 2: Image interpretation.', true, null],
    ]);
    // A link to a description opens it in the Descriptions reader rather than
    // as a separate source record.
    const linked = await invoke(routePath, { object_id: '1', image: 'image', image_id: '20' }, {annotation: '77'});
    assert.equal(linked.context.selected_output_id, 77);
    assert.equal(linked.context.selected_annotation, null);
    const invalid = await invoke(routePath, { object_id: '1', image: 'image', image_id: '999' });
    assert.equal(invalid.error.status, 404);
    const old = await invoke('/object/:object_id/:image?/:image_id?/compare', { object_id: '1', image: 'image', image_id: '20' });
    assert.equal(old.url, '/object/1/image/20#compare');
  } finally { global.fetch = originalFetch; }
});
