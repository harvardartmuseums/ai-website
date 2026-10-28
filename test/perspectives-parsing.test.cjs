const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compute } = require('../public/javascripts/perspectives');
const baseline = require('./fixtures/perspectives-parsing-baseline.json');

function freezeInput(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freezeInput);
}

for (const example of baseline.cases) {
  test(`description parsing preserves full output: ${example.name}`, () => {
    let input = example.input;
    if (example.fixture) {
      const saved = require('./fixtures/' + example.fixture);
      input = {
        records: [...saved.records, ...saved.descriptions.map(record => ({ ...record, type: 'description' }))],
        object: { id: saved.id, title: saved.title, classification: saved.classification },
        image: saved.image,
      };
    }
    input = structuredClone(input);
    if (example.repeatFirstRecord) input.records.push(input.records[0]);
    const before = structuredClone(input);
    freezeInput(input);
    const result = compute(input.records, input.object, input.image);
    assert.deepEqual(input, before, 'analysis must not mutate its annotation or catalogue inputs');
    assert.ok(!Number.isNaN(Date.parse(result.generated_at)));
    delete result.generated_at;
    // Captured from the pre-refactor implementation. Preserve every remaining
    // field, array order, evidence excerpt, link, count, score and version.
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    assert.equal(hash, example.sha256, 'full output differs from the pre-refactor reference');
  });
}
