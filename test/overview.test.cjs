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

test('media are compared with the record; underdrawings, color words and missing records are not flagged', () => {
  const descriptions = [
    d(1, 'Likely a watercolor.'),
    d(2, 'Oil over a charcoal underdrawing.'),
    d(3, 'A man in a charcoal-gray coat.'),
    d(4, 'A charcoal drawing of a man.'),
  ];
  const flagged = overviewOf({ descriptions, objectInfo: { medium: 'Oil on canvas' } });
  assert.deepEqual(flagged.divergence.filter(s => s.kind === 'unrecorded_medium').map(s => [s.annotation_id, s.media]),
    [[1, ['watercolor']], [4, ['charcoal']]]);
  const unknown = overviewOf({ descriptions, objectInfo: {} });
  assert.equal(unknown.divergence.some(s => s.kind === 'unrecorded_medium'), false);
});

test('hedges, comparisons, purposes and color uses of medium words are not claims', () => {
  const descriptions = [
    d(1, 'It is drawn in charcoal or graphite.'),
    d(2, 'The style is reminiscent of Renaissance frescoes.'),
    d(3, 'Likely a preparatory drawing for a ceiling fresco.'),
    d(4, 'A light pastel bluish-gray background.'),
    d(5, 'The figures are drawn in charcoal on paper.'),
  ];
  const result = overviewOf({ descriptions, objectInfo: { medium: 'Black chalk on paper' } });
  assert.deepEqual(result.divergence.filter(s => s.kind === 'unrecorded_medium').map(s => [s.annotation_id, s.media]),
    [[5, ['charcoal']]]);
});

test('record synonyms: opaque watercolor is gouache; print techniques only on prints', () => {
  const gouache = overviewOf({ descriptions: [d(1, 'A gouache painting of a court.')], objectInfo: { medium: 'Opaque watercolor and gold on paper' } });
  assert.equal(gouache.divergence.some(s => s.kind === 'unrecorded_medium'), false);
  const silver = overviewOf({ descriptions: [d(1, 'The engraving on the lid shows a crest.')], objectInfo: { medium: 'Silver', classification: 'Vessels' } });
  assert.equal(silver.divergence.some(s => s.kind === 'unrecorded_medium'), false);
});

test('print techniques are compared with the record', () => {
  const descriptions = [d(1, 'This engraving shows a ship.'), d(2, 'A woodcut of a ship.')];
  const result = overviewOf({ descriptions, objectInfo: { medium: 'Etching', technique: 'Etching' } });
  assert.deepEqual(result.divergence.filter(s => s.kind === 'unrecorded_medium').map(s => [s.annotation_id, s.media]),
    [[1, ['engraving']], [2, ['woodcut']]]);
  const recorded = overviewOf({ descriptions, objectInfo: { medium: 'Engraving' } });
  assert.deepEqual(recorded.divergence.filter(s => s.kind === 'unrecorded_medium').map(s => s.annotation_id), [2]);
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

// --- What matches the museum record --------------------------------------------

const recordOf = (descriptions, objectInfo, ocrText = '') => computeOverview({
  descriptions, observations: {}, moodPalette: [], coverageRadar: null,
  phrasesByDescription: new Map(), objectInfo, ocrText,
}).record_match.rows;
const rowOf = (rows, field) => rows.find(r => r.field === field);

test('record match: title subject, given title and other titles', () => {
  const rows = recordOf([
    d(1, 'A young rabbit crouches in the grass.'),
    d(2, 'An ink painting titled "Young Rabbit" shows a rabbit.'),
    d(3, 'A painting titled "Spring Hare".'),
  ], { title: 'Young Rabbit' });
  const title = rowOf(rows, 'title');
  assert.equal(title.subject.term, 'rabbit');
  assert.deepEqual(title.subject.annotation_ids, [1, 2]);
  assert.deepEqual(title.given_ids, [2]);
  assert.deepEqual(title.other_titles, [{ annotation_id: 3, titles: ['Spring Hare'] }]);
});

test('record match: a person in the title is matched as a whole name', () => {
  const rows = recordOf([d(1, 'A collage with a photograph of Anna May Wong.'), d(2, 'A collage of a giraffe.')],
    { title: 'Untitled [with Anna May Wong]' });
  assert.deepEqual(rowOf(rows, 'title').subject, { term: 'Anna May Wong', annotation_ids: [1] });
});

test('record match: medium from any segment of the record; object type counts its kinds', () => {
  const rows = recordOf([d(1, 'Black ink on paper.'), d(2, 'An engraving of a ship.')],
    { title: 'A Ship', medium: 'Album leaf; ink and light color on paper', worktypes: [{ worktype: 'print' }] });
  assert.equal(rowOf(rows, 'medium').term, 'ink');
  assert.deepEqual(rowOf(rows, 'medium').annotation_ids, [1]);
  assert.deepEqual(rowOf(rows, 'object_type').annotation_ids, [2]);
});

test('record match: artist by surname, noted when the name is printed on the work', () => {
  const rows = recordOf([d(1, 'A painting by Renoir.'), d(2, 'A painting by Mary Cassatt.')],
    { title: 'At the Milliner’s', people: [{ name: 'Pierre-Auguste Renoir', displayname: 'Pierre-Auguste Renoir', alphasort: 'Renoir, Pierre-Auguste', role: 'Artist' }] },
    'Renoir pinx.');
  const artist = rowOf(rows, 'artist');
  assert.deepEqual(artist.annotation_ids, [1]);
  assert.equal(artist.in_image, true);
  assert.deepEqual(artist.others, [{ annotation_id: 2, names: ['Mary Cassatt'] }]);
});

test('names the image OCR read, or not written as names, are not divergence', () => {
  const result = computeOverview({ descriptions: [d(1, 'Engraved by Gaspard Duchange.'), d(2, 'A woman with a bob haircut.')],
    observations: {}, moodPalette: [], coverageRadar: null, phrasesByDescription: new Map(),
    objectInfo: { title: 'Print' }, ocrText: 'Gaspard Duchange sculp.' });
  assert.equal(result.divergence.some(s => s.kind === 'unrecorded_names'), false);
});

test('record match: culture counts origin claims, not script, subject, styles or hedges', () => {
  const rows = recordOf([
    d(1, 'A Japanese woodblock print of a tiger.'),
    d(2, 'This is a traditional Chinese painting.'),
    d(3, 'The text is written in Chinese characters.'),
    d(4, 'It may be Chinese or Japanese in origin.'),
    d(5, 'A Chinese-style composition with a tiger.'),
  ], { title: 'Tiger', culture: 'Japanese' });
  const culture = rowOf(rows, 'culture');
  assert.deepEqual(culture.annotation_ids, [1]);
  assert.deepEqual(culture.others, [{ term: 'Chinese', annotation_ids: [2] }]);
});

test('record match: a broader culture term agrees ("Islamic" for Persian work)', () => {
  const rows = recordOf([d(1, 'An Islamic manuscript page.'), d(2, 'A Persian miniature painting.')], { title: 'Page', culture: 'Persian' });
  assert.deepEqual(rowOf(rows, 'culture').annotation_ids, [1, 2]);
});

test('record match: dates agree within 25 years; bare years need a dating phrase', () => {
  const rows = recordOf([
    d(1, 'An early 20th-century collage.'),
    d(2, 'Probably made in the 1960s.'),
    d(3, 'It depicts the war of 1812.'),
    d(4, 'Created around 1931 in Germany.'),
  ], { title: 'Collage', dated: '1929', datebegin: 1929, dateend: 1929 });
  const date = rowOf(rows, 'date');
  assert.deepEqual(date.annotation_ids, [1, 4]);
  assert.deepEqual(date.others, [{ annotation_id: 2, phrases: ['1960s'] }]);
});

test('record match: a year the image OCR read is not a date claim', () => {
  const rows = recordOf([d(1, 'A poster dated 2019.')], { title: 'Concert', dated: '1975', datebegin: 1975, dateend: 1975 }, 'ICA 2019');
  assert.deepEqual(rowOf(rows, 'date').others, []);
});

test('record match: a record dated only in text ("20th century", "X/XI c.") still gets a date row', () => {
  const century = rowOf(recordOf([d(1, 'An early 20th-century ink painting.')], { title: 'Rabbit', dated: '20th century', datebegin: 0, dateend: 0 }), 'date');
  assert.deepEqual(century.annotation_ids, [1]);
  const roman = rowOf(recordOf([d(1, 'A coin from the 10th century.'), d(2, 'Minted in the 15th century.')], { title: 'Coin', dated: 'X/XI c.', datebegin: 0, dateend: 0 }), 'date');
  assert.deepEqual(roman.annotation_ids, [1]);
  assert.deepEqual(roman.others.map(o => o.annotation_id), [2]);
});

test('record match: named periods count as dates, not styles, subjects or open ends', () => {
  const rows = recordOf([
    d(1, 'A lacquer box from the Edo period.'),
    d(2, 'Likely late Ming or early Qing dynasty.'),
    d(8, 'A Song or Yuan dynasty work.'),
    d(3, 'Possibly from the Heian period.'),
    d(4, 'Decorated in an Edo-period style.'),
    d(5, 'A scene from the Heian period.'),
    d(6, 'Probably Tang dynasty or later.'),
    d(7, 'A Baroque ornament.'),
  ], { title: 'Letter Box', dated: 'circa 1700', datebegin: 1690, dateend: 1710 });
  const date = rowOf(rows, 'date');
  // Late Ming or early Qing (1534–1751) overlaps circa 1700.
  assert.deepEqual(date.annotation_ids, [1, 2]);
  assert.deepEqual(date.others, [
    { annotation_id: 8, phrases: ['Song or Yuan dynasty'] },
    { annotation_id: 3, phrases: ['Heian period'] },
  ]);
});

test('record match: a record dated only by its period gets a date row', () => {
  const rows = recordOf([d(1, 'A Japanese hanging scroll from the Muromachi period.')],
    { title: 'Scroll', period: 'Muromachi period, 1392-1568', datebegin: 0, dateend: 0 });
  assert.deepEqual(rowOf(rows, 'date').annotation_ids, [1]);
});
