const test = require('node:test');
const assert = require('node:assert/strict');
const { compute, ALGORITHM_VERSION } = require('../public/javascripts/perspectives');

const run = records => compute(records, {id: 10}, {imageid: 20});
const description = (id, source, body) => ({id, source, body, type: 'description', model: 'unlisted-model-' + id});
const tag = (id, source, body, feature = 'full') => ({id, source, body, type: 'tag', feature});
const observation = (result, phrase) => Object.values(result.observations).flatMap(c => c.entries).find(e => e.phrase === phrase);

test('overlapping NLP extraction does not double-count a single phrase', () => {
  const entry = observation(run([description(1, 'Amazon', 'A red coat.')]), 'red coat');
  assert.equal(entry.occurrences_count, 1);
  assert.equal(entry.annotations_count, 1);
});

test('repeated mentions remain distinct from annotation support', () => {
  const entry = observation(run([
    description(1, 'Amazon', 'A red coat. Another red coat.'),
    description(2, 'Anthropic', 'A red coat.'),
  ]), 'red coat');
  assert.equal(entry.occurrences_count, 3);
  assert.equal(entry.annotations_count, 2);
  assert.equal(entry.description_annotations_count, 2);
  assert.equal(entry.snippets.length, 2);
});

test('complete compound seeds contribute to both observations and radar', () => {
  const result = run([description(1, 'Amazon', 'A giant panda stands by a tree.')]);
  assert.ok(observation(result, 'giant panda'));
  assert.deepEqual(result.coverage_radar.sources[0].values.animals.terms, ['giant panda']);
});

test('vocabulary matching respects word and sentence boundaries', () => {
  const result = run([description(1, 'Amazon', 'A woman walks. It is giant. Panda is written separately.')]);
  const radar = result.coverage_radar.sources[0];
  assert.deepEqual(radar.values.people.terms, ['woman']);
  assert.equal(radar.values.animals.raw, 0);
});

test('Markdown link labels survive while URL words do not become evidence', () => {
  const result = run([description(1, 'Amazon', '[A horse](https://example.org/panda)')]);
  assert.ok(observation(result, 'horse'));
  assert.deepEqual(result.coverage_radar.sources[0].values.animals.terms, ['horse']);
});

test('region-only records expose observations, provenance, and unique detection counts', () => {
  const region = tag(1, 'Amazon', 'hat', 'region');
  const result = run([region, {...region}]);
  assert.equal(result.status, 'ok');
  const entry = observation(result, 'hat');
  assert.equal(entry.annotations_count, 1);
  assert.equal(entry.region_annotations_count, 1);
  assert.equal(entry.spatially_detected.total_instances, 1);
  assert.equal(entry.snippets[0].type, 'tag');
  assert.equal(entry.snippets[0].url, '/object/10/image/20?annotation=1#other');
});

test('OCR-only and face-only records retain their flags; empty input stays empty', () => {
  const ocr = run([{id: 1, source: 'Google Vision', type: 'text', body: 'A label'}]);
  assert.equal(ocr.status, 'ok');
  assert.equal(ocr.summary.has_text, true);
  assert.equal(ocr.summary.text_sample, 'A label');
  const faces = run([{id: 2, source: 'Amazon', type: 'face'}]);
  assert.equal(faces.summary.has_faces, true);
  assert.equal(faces.summary.face_stats.max, 1);
  assert.equal(run([]).status, 'no_annotations');
});

test('agreement examples contain the matched term, retain unknown models, and cover sources', () => {
  const body = 'Context sentence. '.repeat(20) + 'A hat rests beside a window.';
  const result = run([description(1, 'Amazon', body), description(2, 'Amazon', body), description(3, 'Amazon', body), description(4, 'Anthropic', body)]);
  const concept = result.concepts.find(c => c.concept === 'hat');
  assert.ok(concept);
  assert.equal(concept.example_annotations.length, 3);
  assert.equal(new Set(concept.example_annotations.map(e => e.source)).size, 2);
  for (const example of concept.example_annotations) {
    assert.ok(example.snippet.includes('hat'));
    assert.equal(example.model, 'unlisted-model-' + example.annotation_id);
    assert.equal(example.display_model, example.model);
    assert.equal(example.url, '/object/10/image/20?annotation=' + example.annotation_id + '#descriptions');
  }
});

test('long mood excerpts retain the term and separate repetition from annotation counts', () => {
  const body = 'A study with ' + 'marked '.repeat(90) + 'dark tones and dark shadows.';
  const mood = run([description(1, 'Amazon', body)]).mood_palette.find(m => m.phrase === 'dark');
  assert.equal(mood.occurrences_count, 2);
  assert.equal(mood.annotations_count, 1);
  assert.ok(mood.snippets[0].text.includes('dark'));
  assert.ok(mood.snippets[0].text.length <= 162);
  assert.equal(mood.snippets[0].model, 'unlisted-model-1');
});

test('multi-word mood vocabulary is reachable without changing the minimum-occurrence threshold', () => {
  const records = [description(1, 'Amazon', 'A beautiful serene portrait.'), description(2, 'Anthropic', 'A beautiful serene portrait.')];
  const result = run(records);
  const mood = result.mood_palette.find(m => m.phrase === 'beautiful serene');
  assert.equal(mood.annotations_count, 2);
  assert.ok(result.coverage_radar.sources[0].values.mood.terms.includes('beautiful serene'));
  assert.equal(run(records.slice(0, 1)).mood_palette.some(m => m.phrase === 'beautiful serene'), false);
});

test('thematic examples carry source/model/annotation provenance', () => {
  const result = run([description(1, 'Amazon', 'A red coat.'), description(2, 'Anthropic', 'A red coat.'), description(3, 'Mistral', 'A red coat.')]);
  assert.ok(result.thematic_concepts.length);
  for (const term of result.thematic_concepts) {
    assert.ok(term.example_annotations.length);
    assert.ok(term.example_annotations.every(e => e.model && e.source && e.url));
  }
});

test('agreement weights, inclusion thresholds, and level thresholds remain unchanged', () => {
  const records = [tag(1, 'Amazon', 'bridge'), tag(2, 'Anthropic', 'bridge'), tag(3, 'Amazon', 'bridge')];
  assert.equal(run(records.slice(0, 2)).concepts.length, 0);
  const weak = run(records).concepts[0];
  assert.equal(weak.consensus_score, Math.round((0.6 * (2 / 5) + 0.4 * (Math.log(4) / Math.log(21))) * 1000) / 1000);
  assert.equal(weak.agreement_level, 'weaker');
  const strong = run([...records, tag(4, 'Mistral', 'bridge')]).concepts[0];
  assert.equal(strong.agreement_level, 'stronger');
  // 4.x versions only add the overview block; scoring is unchanged (asserted above).
  assert.equal(ALGORITHM_VERSION, 'ace-v4.8.1');
});

const family = (result, name) => result.concept_relationships.find(group => group.family === name);

test('headwear family preserves distinct terms without manufacturing agreement', () => {
  const result = run([tag(1, 'Amazon', 'hat'), tag(2, 'Anthropic', 'helmet'), tag(3, 'Mistral', 'crown')]);
  assert.equal(result.concepts.length, 0);
  assert.equal(result.divergence_signals, undefined);
  const group = family(result, 'headwear');
  assert.deepEqual(group.terms.map(t => t.term), ['crown', 'hat', 'helmet']);
  assert.deepEqual(group.synonym_groups, []);
  assert.ok(group.terms.every(t => t.annotations_count === 1 && t.services.length === 1));
});

test('linguistic equivalents share support while retaining surface vocabulary', () => {
  const result = run([tag(1, 'Amazon', 'hat'), tag(2, 'Anthropic', 'hats'), tag(3, 'Mistral', 'hat')]);
  const shared = result.concepts.find(c => c.concept === 'hat');
  assert.equal(shared.annotations_count, 3);
  assert.deepEqual(shared.variants.map(v => v.term).sort(), ['hat', 'hats']);
  assert.deepEqual(family(result, 'headwear').synonym_groups, [{concept: 'hat', terms: ['hat', 'hats'], relationship: 'same_meaning'}]);
});

test('family browsing includes single-provider terms and deduplicates supporting annotations', () => {
  const rec = description(1, 'Amazon', 'A helmet beside a crown. Another helmet.');
  const group = family(run([rec, {...rec}]), 'headwear');
  assert.ok(group);
  for (const term of group.terms) {
    assert.equal(term.annotations_count, 1);
    assert.deepEqual(term.annotation_ids, [1]);
    assert.ok(term.example_annotations[0].snippet.includes(term.term));
    assert.equal(term.example_annotations[0].model, 'unlisted-model-1');
    assert.equal(term.example_annotations[0].imageid, 20);
    assert.equal(term.example_annotations[0].url, '/object/10/image/20?annotation=1#descriptions');
  }
});

test('region terms retain their source type and full annotation link in families', () => {
  const group = family(run([tag(1, 'Amazon', 'helmet', 'region'), description(2, 'Anthropic', 'A crown.')]), 'headwear');
  const evidence = group.terms.find(t => t.term === 'helmet').example_annotations[0];
  assert.equal(evidence.type, 'tag');
  assert.equal(evidence.url, '/object/10/image/20?annotation=1#other');
});

test('related mediums remain distinct and are not classified as contradictions', () => {
  const result = run([tag(1, 'Amazon', 'oil'), tag(2, 'Anthropic', 'watercolour'), tag(3, 'Mistral', 'watercolor')]);
  const group = family(result, 'medium');
  assert.deepEqual(group.terms.map(t => t.term), ['oil', 'watercolor', 'watercolour']);
  assert.deepEqual(group.synonym_groups[0].terms, ['watercolor', 'watercolour']);
  assert.equal(result.divergence_signals, undefined);
  assert.equal(result.concepts.length, 0);
});

test('families respect boundaries and Markdown labels, and do not invent membership', () => {
  const result = run([description(1, 'Amazon', '[A crown](https://example.org/helmet) and a hatstand with an unknown widget.')]);
  assert.deepEqual(result.concept_relationships, []);
  assert.deepEqual(run([tag(1, 'Amazon', 'hat')]).concept_relationships, []);
});

test('former broad synonym families no longer inflate agreement or erase observations', () => {
  const result = run([tag(1, 'Amazon', 'vase'), tag(2, 'Anthropic', 'cup'), tag(3, 'Mistral', 'urn'),
    description(4, 'Amazon', 'A helmet. A crown.')]);
  assert.equal(result.concepts.some(c => c.concept === 'vessel'), false);
  assert.ok(observation(result, 'helmet'));
  assert.ok(observation(result, 'crown'));
  assert.equal(observation(result, 'hat'), undefined);
  assert.deepEqual(family(result, 'vessel').terms.map(t => t.term), ['cup', 'urn', 'vase']);
});

test('radar separates repeated runs and models from a provider vocabulary union', () => {
  const records = [
    {...description(1, 'Amazon', 'A horse.'), model: 'same-model', createdate: '2026-01-01T00:00:00Z'},
    {...description(2, 'Amazon', 'A dog.'), model: 'same-model', createdate: '2026-02-01T00:00:00Z'},
    {...description(3, 'Amazon', 'A bird.'), model: 'other-model'},
  ];
  const radar = run([...records, {...records[0]}]).coverage_radar;
  assert.equal(radar.outputs.length, 3);
  assert.equal(radar.sources.length, 1);
  assert.equal(radar.sources[0].output_count, 3);
  assert.equal(radar.sources[0].model_count, 2);
  assert.equal(radar.sources[0].word_count, 6);
  assert.deepEqual(radar.sources[0].values.animals.terms, ['bird', 'dog', 'horse']);
  assert.equal(radar.max_per_dimension.animals, 3);
  assert.ok(radar.outputs.every(o => o.values.animals.raw === 1 && o.values.animals.normalized === 1 / 3));
  assert.deepEqual(radar.outputs.map(o => o.annotation_id), [1, 2, 3]);
  assert.equal(radar.outputs[0].createdate, records[0].createdate);
  assert.equal(radar.outputs[0].url, '/object/10/image/20?annotation=1#descriptions');
  assert.equal(radar.outputs[0].word_count, 2);
});

test('wall label never sets AI scale and preserves overflow and zero-AI dimensions', () => {
  const radar = compute([description(1, 'Amazon', 'A horse.')], {id: 10, labeltext: 'A horse, dog, bird, and red coat.'}, {imageid: 20}).coverage_radar;
  assert.equal(radar.sources.some(s => s.source === 'Curator'), false);
  assert.equal(radar.max_per_dimension.animals, 1);
  assert.equal(radar.outputs[0].values.animals.normalized, 1);
  assert.equal(radar.reference.values.animals.raw, 3);
  assert.equal(radar.reference.values.animals.normalized, 3);
  assert.equal(radar.reference.values.animals.exceeds_scale, true);
  assert.equal(radar.max_per_dimension.colour_light, 0);
  assert.equal(radar.reference.values.colour_light.normalized, null);
  assert.equal(radar.reference.values.colour_light.exceeds_scale, true);
  assert.deepEqual(radar.reference.values.animals.annotation_ids, []);
  assert.equal(radar.scale_basis, 'complete_ai_provider_unions');
});

test('output metadata retains unknown models and missing dates without pooling or empty outputs', () => {
  const radar = run([description(1, 'New Provider', '[A horse](https://example.org/dog)'),
    {id: 2, type: 'description', source: 'New Provider', body: 'A dog.'}, description(3, 'Amazon', '')]).coverage_radar;
  assert.equal(radar.outputs.length, 2);
  assert.equal(radar.outputs[0].model, 'unlisted-model-1');
  assert.equal(radar.outputs[0].display_model, 'unlisted-model-1');
  assert.equal(radar.outputs[0].createdate, null);
  assert.equal(radar.outputs[1].model, null);
  assert.equal(radar.sources[0].model_count, 1);
  assert.deepEqual(radar.outputs[0].values.animals.terms, ['horse']);
  assert.equal(radar.outputs[0].word_count, 2);
  assert.equal(radar.reference, null);
});

test('phrases are categorised by whole phrase, then head word, with plurals and hyphens handled', () => {
  const result = run([
    description(1, 'Anthropic', 'A beach with palm trees and two white horses beside a horse-drawn cart.'),
    description(2, 'OpenAI', 'Palm trees line the shore; the horse-drawn cart waits.'),
  ]);
  const categoryOf = phrase => Object.keys(result.observations).find(key => result.observations[key].entries.some(e => e.phrase === phrase));
  assert.equal(categoryOf('palm trees'), 'setting', 'plural of a listed phrase');
  assert.equal(categoryOf('horse-drawn cart'), 'objects', 'the head noun (cart) wins over a word inside a hyphenated modifier (horse)');
  assert.equal(categoryOf('white horses'), 'animals', 'plural head word');
});

test('vocabulary matching counts plurals of listed nouns, but not of verbs or adjectives', () => {
  const result = run([
    description(1, 'Anthropic', 'Two men stand under palm trees. The lamp casts reds and golds across the scene.'),
  ]);
  const output = result.coverage_radar.outputs[0];
  assert.ok(output.values.people.terms.includes('man'), 'irregular plural: men → man');
  assert.ok(output.values.setting.terms.includes('palm tree'), 'plural on the last word of a compound');
  assert.ok(!output.values.material_technique.terms.includes('cast'), '"casts" is a verb here, not the noun "cast"');
  assert.ok(!output.values.colour_light.terms.includes('red'), 'adjectives do not gain a plural form');
});
