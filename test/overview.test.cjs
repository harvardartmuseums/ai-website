const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOverview, headNoun } = require('../public/javascripts/overview');
const perspectives = require('../public/javascripts/perspectives');

// Minimal inputs: descriptions plus the observation phrases perspectives would
// have extracted from them. Each test overrides only what it is about.
function overviewOf({ descriptions, phrases = [], objectInfo = {}, moodPalette = [], phrasesByDescription } = {}) {
  return computeOverview({
    descriptions,
    observations: { objects: { label: 'Objects', entries: phrases.map(phrase => ({ phrase })) } },
    moodPalette,
    coverageRadar: null,
    phrasesByDescription: phrasesByDescription || new Map(),
    objectInfo,
  });
}
const d = (id, body, source = 'Provider ' + id) => ({ id, source, body });

test('head nouns are singular, including irregular plurals', () => {
  assert.equal(headNoun('black tricorn hats'), 'hat');
  assert.equal(headNoun('green leaves'), 'leaf');
  assert.equal(headNoun('dress'), 'dress');
});

test('agreement counts descriptions, pooling phrasing variants of a noun', () => {
  const result = overviewOf({
    descriptions: [d(1, 'A black hat. The hat is tall. Another hat.'), d(2, 'Two tricorn hats.'), d(3, 'A red coat.')],
    phrases: ['black hat', 'tricorn hats', 'red coat'],
  });
  const hat = result.agreement.find(term => term.term === 'hat');
  assert.equal(hat.descriptions_count, 2, 'repeated mentions in one description count once');
  assert.deepEqual(hat.annotation_ids, [1, 2]);
  assert.equal(result.agreement.some(term => term.term === 'coat'), false, 'a noun in one description is not agreement');
});

test('agreement leaves out generic nouns, colours and the object classification', () => {
  const result = overviewOf({
    descriptions: [d(1, 'A painting of a coin, green, with a figure.'), d(2, 'A coin painting, green, one figure.')],
    phrases: ['painting', 'coin', 'green', 'figure'],
    objectInfo: { classification: 'Coins' },
  });
  assert.deepEqual(result.agreement, []);
});

test('names absent from the record are flagged; recorded and widely shared names are not', () => {
  const sign = 'A shop sign reads Horace Ely.';
  const descriptions = [
    d(1, 'A portrait by Gilbert Stuart.'),
    d(2, 'A portrait by John Singleton Copley.'),
    ...Array.from({ length: 10 }, (_, i) => d(10 + i, sign)),
  ];
  const result = overviewOf({ descriptions, objectInfo: { title: 'Portrait', people: [{ name: 'John Singleton Copley' }] } });
  const names = result.divergence.filter(s => s.kind === 'unrecorded_names');
  assert.deepEqual(names, [{ kind: 'unrecorded_names', annotation_id: 1, names: ['Gilbert Stuart'] }]);
});

test('attribution wording catches names the people tagger does not know, but not institutions', () => {
  const descriptions = [
    d(1, 'This image is an etching or drawing by the artist Edvard Munch, known for his expressive works.'),
    d(2, 'A drawing by Vincent van Gogh.'),
    d(3, 'Photographed by Harvard Art Museums.'),
    d(4, 'A drawing by Alfred Kubin.'),
  ];
  const result = overviewOf({ descriptions, objectInfo: { title: 'Head of a Woman', people: [{ name: 'Alfred Kubin' }] } });
  assert.deepEqual(result.divergence.filter(s => s.kind === 'unrecorded_names').map(s => [s.annotation_id, s.names]),
    [[1, ['Edvard Munch']], [2, ['Vincent van Gogh']]]);
});

test('paint media are compared with the record; drawing media and missing records are not flagged', () => {
  const descriptions = [d(1, 'Likely a watercolor.'), d(2, 'Oil over a charcoal underdrawing.')];
  const flagged = overviewOf({ descriptions, objectInfo: { medium: 'Oil on canvas' } });
  assert.deepEqual(flagged.divergence.filter(s => s.kind === 'unrecorded_medium'),
    [{ kind: 'unrecorded_medium', annotation_id: 1, media: ['watercolor'], record_medium: 'Oil on canvas' }]);
  const unknown = overviewOf({ descriptions, objectInfo: {} });
  assert.equal(unknown.divergence.some(s => s.kind === 'unrecorded_medium'), false);
});

test('the length range names the shortest and longest descriptions', () => {
  const result = overviewOf({ descriptions: [d(1, 'A man.'), d(2, 'A man in a very tall black hat.')] });
  assert.deepEqual(result.divergence.find(s => s.kind === 'length_range'),
    { kind: 'length_range', shortest: { annotation_id: 1, words: 2 }, longest: { annotation_id: 2, words: 8 } });
});

test('distinctive phrases are ones no other description uses, with leading filler removed', () => {
  const phrasesByDescription = new Map([
    [1, new Set(['this naval officer', 'red coat'])],
    [2, new Set(['red coat', 'something'])],
  ]);
  const result = overviewOf({ descriptions: [d(1, 'x'), d(2, 'y')], phrasesByDescription });
  assert.deepEqual(result.distinctive, { 1: ['naval officer'] });
});

test('colour words count descriptions, merge spelling variants and leave out tone words', () => {
  const result = overviewOf({ descriptions: [
    d(1, 'A red coat and a red sash on a dark ground.'),
    d(2, 'Gray hair under a black hat; a grey sky.'),
    d(3, 'A redwood frame, light and airy.'),
  ] });
  assert.deepEqual(result.colour_words.map(c => [c.word, c.descriptions_count, c.annotation_ids]),
    [['black', 1, [2]], ['gray', 1, [2]], ['red', 1, [1]]]);
});

test('mood keeps single interpretive words and drops tone words', () => {
  const moodPalette = [
    { phrase: 'dark', annotations_count: 9, annotation_ids: [1] },
    { phrase: 'serene', annotations_count: 4, annotation_ids: [1, 2] },
    { phrase: 'sense of depth', annotations_count: 3, annotation_ids: [2] },
  ];
  const result = overviewOf({ descriptions: [d(1, 'x')], moodPalette });
  assert.deepEqual(result.mood, [{ phrase: 'serene', descriptions_count: 4, annotation_ids: [1, 2] }]);
});

test('perspectives.compute includes an overview whose ids are real description annotations', () => {
  const records = [
    { id: 1, source: 'Amazon', type: 'description', body: 'A man in a black tricorn hat and a red coat, serene.' },
    { id: 2, source: 'OpenAI', type: 'description', body: 'An unfinished study of a man wearing a large hat, serene.' },
    { id: 3, source: 'Amazon', type: 'tag', feature: 'full', body: 'hat', confidence: 0.9 },
  ];
  const { overview } = perspectives.compute(records, { id: 10, title: 'Colonel', medium: 'Oil on canvas' }, { imageid: 20 });
  assert.equal(overview.descriptions_count, 2);
  const ids = new Set([1, 2]);
  for (const term of overview.agreement) assert.ok(term.annotation_ids.every(id => ids.has(id)));
  assert.ok(overview.agreement.some(term => term.term === 'hat'));
  assert.equal(overview.attention.length, 9);
});

// --- Titles ------------------------------------------------------------------

const titlesOf = ({ descriptions, objectInfo, ocrText = '' }) => computeOverview({
  descriptions, observations: {}, moodPalette: [], coverageRadar: null,
  phrasesByDescription: new Map(), objectInfo, ocrText,
}).divergence.filter(s => s.kind === 'unrecorded_title');
const milliner = { title: "At the Milliner's", titles: [{ title: "At the Milliner's" }, { title: 'Chez la Modiste' }] };

test('a title the record does not have is divergence (object 230941)', () => {
  const found = titlesOf({ objectInfo: milliner, descriptions: [
    d(1, 'This is a painting titled "The Reader" by Pierre-Auguste Renoir.'),
    { ...d(2, 'The painting titled The Theatre Box (La Loge), painted in 1874.'), raw: 'The painting titled ***The Theatre Box*** (*La Loge*), painted in 1874.' },
    d(3, 'A painting of women in a hat shop.'),
  ] });
  assert.deepEqual(found.map(s => [s.annotation_id, s.titles]), [[1, ['The Reader']], [2, ['The Theatre Box']]]);
  assert.equal(found[0].record_title, "At the Milliner's");
});

test('the record title, an alternate title, or a close spelling is not divergence', () => {
  const found = titlesOf({ objectInfo: { title: 'Modesta e Vanità (Modesty and Vanity)', titles: [] }, descriptions: [
    d(1, 'An engraving titled "Modestia e Vanita" shows two women.'),
    d(2, 'The print, titled "Modesty and Vanity", is Italian.'),
  ] });
  assert.deepEqual(found, []);
  assert.deepEqual(titlesOf({ objectInfo: milliner, descriptions: [d(1, 'A canvas titled "Chez la Modiste".')] }), []);
});

test('a title many descriptions share, or that OCR read, is text in the image', () => {
  const shared = Array.from({ length: 4 }, (_, i) => d(i + 1, 'The engraving titled "Plan Général de la Ville de Rheims" shows a map.'));
  assert.deepEqual(titlesOf({ objectInfo: { title: 'Allegory of Reims' }, descriptions: shared }), []);
  const read = [d(1, 'A document titled "To the Board of Health" with a form.')];
  assert.deepEqual(titlesOf({ objectInfo: { title: 'Health, General' }, descriptions: read, ocrText: 'TO THE BOARD OF HEALTH Cambridge' }), []);
});

test('"called" and "known as" introduce terms, not titles', () => {
  assert.deepEqual(titlesOf({ objectInfo: { title: 'Chestnut' }, descriptions: [d(1, 'The script is known as "sōsho", also called "grass script".')] }), []);
});
