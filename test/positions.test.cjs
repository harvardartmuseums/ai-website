const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPositions, placesIn, groupClaims, cardClaims, checkClaims, detectionOnly, boxesIn } = require('../public/javascripts/positions');
const youngRabbit = require('./fixtures/positions-201162.json');
const differentNations = require('./fixtures/positions-241300.json');

// Most sentences below are real, from descriptions of Young Rabbit (201162) and
// Different Nations of America (241300), the two objects checked by hand.
const kinds = text => extractPositions(text).map(p => [p.phrase, p.kind]);

test('corner phrases are places, with the subject from the same clause', () => {
  const [p] = placesIn('At the bottom right corner, there is a signature followed by a red seal.');
  assert.equal(p.cell, 'bottom-right');
  assert.equal(p.subject, 'signature');
});

test('one-side phrases are places on their whole side', () => {
  const [p] = placesIn('The rabbit is on the left side of the composition, painted mostly in shades of gray.');
  assert.equal(p.cell, 'left');
  assert.equal(p.subject, 'rabbit');
});

test('"left of the center" is still a place on the image', () => {
  const [p] = placesIn('A plump, gray rabbit is the focal point, positioned slightly to the left of the center.');
  assert.equal(p.cell, 'left');
});

test('facing and turning are directions, not places', () => {
  assert.deepEqual(kinds('The rabbit is seated on the ground, facing to the right, with its ears perked up.'),
    [['to the right', 'direction']]);
  assert.deepEqual(kinds('The rabbit is sitting on the ground, and its head is turned to the right.'),
    [['to the right', 'direction']]);
});

test('extending towards a side is a trajectory', () => {
  assert.deepEqual(kinds('Behind the rabbit and extending towards the right, long, thin, dark lines suggest more tall grass.'),
    [['towards the right', 'trajectory']]);
});

test('"to the right of the rabbit" is relative to the rabbit', () => {
  assert.deepEqual(kinds('To the right of the rabbit, a branch of a plant or tree is visible.'),
    [['To the right', 'relative']]);
});

test('a position inside quoted caption text is nested, not a place', () => {
  const found = kinds('The engraving includes text at the bottom which reads: "Les différentes Nations de l\'Amérique" at the top, indicating the theme.');
  assert.deepEqual(found, [['at the bottom', 'place'], ['at the top', 'nested']]);
  assert.deepEqual(kinds('The name appears at the top of the caption.'), [['at the top', 'nested']]);
});

test('"in the background" is a depth; "the background" alone is the backdrop', () => {
  const [depth] = extractPositions('In the background, there are tall pillars or columns.');
  assert.equal(depth.kind, 'depth');
  assert.equal(depth.depth, 'background');
  assert.equal(extractPositions('The background includes a sky with clouds, adding depth.')[0].kind, 'backdrop');
});

test('body parts are anatomical', () => {
  assert.deepEqual(kinds('She rests her left side against the chair.'), [['left side', 'anatomical']]);
  assert.equal(placesIn('He holds a staff in his right hand.').length, 0);
});

test('"of the image" stays a place even with words after it', () => {
  assert.deepEqual(kinds('There is a scale on the right side of the image for reference.'), [['right side', 'place']]);
  assert.deepEqual(kinds('To the left of the central figure stands a man with a beard.'), [['To the left', 'relative']]);
});

test('a position on the object itself is a place when the object is named', () => {
  const sentence = 'There is a small hole at the top of the plaque.';
  assert.deepEqual(kinds(sentence), [['at the top', 'relative']]);
  assert.equal(placesIn(sentence, { objectWords: ['plaque'] })[0].cell, 'top');
});

test('the subject skips landmark phrases like "above the rabbit"', () => {
  const [p] = placesIn('Above the rabbit, delicate flowering branches extend across the upper portion of the painting.');
  assert.equal(p.cell, 'top');
  assert.match(p.subject, /branches/);
});

test('the subject comes from its own clause, not one joined by "while"', () => {
  const [p] = placesIn('The rabbit is rendered in soft gray tones, while bamboo leaves are painted in bold, dark strokes at the bottom of the composition.');
  assert.match(p.subject, /bamboo|leaves/);
});

test('a lone adjective is never the subject', () => {
  const [p] = placesIn('A plump, gray rabbit is the focal point, positioned slightly to the left of the center.');
  assert.match(p.subject, /rabbit/);
});

test('positions come back in reading order with offsets', () => {
  const found = extractPositions('A seal sits in the bottom right corner. Branches arc across the top.');
  assert.deepEqual(found.map(p => p.cell), ['bottom-right', 'top']);
  assert.ok(found[0].offset < found[1].offset);
});

// --- Claims ------------------------------------------------------------------

const d = (id, body) => ({ id, body });
const claimWith = (claims, head) => claims.find(c => c.heads.includes(head));

test('heads named together at the same place join one claim', () => {
  const claims = groupClaims([
    d(1, 'At the bottom right corner, there is a signature followed by a red seal.'),
    d(2, 'A red seal sits in the lower right corner beside the signature.'),
    d(3, 'The signature and the seal in the bottom right corner are faint.'),
  ]);
  const marks = claimWith(claims, 'seal');
  assert.ok(marks.heads.includes('signature'));
  assert.equal(marks.usual, 'bottom-right');
});

test('heads at different places stay separate claims', () => {
  const claims = groupClaims([
    d(1, 'An angel stands on the left side. Mary kneels on the right side.'),
    d(2, 'The angel is on the left, and Mary appears on the right.'),
  ]);
  assert.notEqual(claimWith(claims, 'angel'), claimWith(claims, 'mary'));
});

test('a subject placed by only one description is not a claim', () => {
  const claims = groupClaims([d(1, 'A small dog sits in the lower left corner.'), d(2, 'Clouds fill the upper half.')]);
  assert.equal(claims.length, 0);
});

test('function words, colours and the object itself are never claims', () => {
  const claims = groupClaims([
    d(1, 'The coin is shown on the left side. The red is in the center.'),
    d(2, 'The coin appears on the left side. The red is in the center.'),
  ], { objectWords: ['Coins'] });
  assert.equal(claims.length, 0);
});

// Real data: the two objects checked by hand against their detected boxes.
test('Young Rabbit: seal and signature at bottom right; the rabbit in the centre', () => {
  const claims = groupClaims(youngRabbit.descriptions, { objectWords: ['Paintings'] });
  const marks = claimWith(claims, 'seal');
  assert.deepEqual(marks.heads.slice(0, 2).sort(), ['seal', 'signature']);
  assert.equal(marks.usual, 'bottom-right');
  const rabbit = claimWith(claims, 'rabbit');
  assert.deepEqual(rabbit.spread, [['center', 5], ['left', 2], ['bottom-left', 1], ['bottom', 1]]);
  assert.equal(claimWith(claims, 'branch').usual, 'top');
});

test('Different Nations: the caption text along the bottom; figures across the middle', () => {
  const claims = groupClaims(differentNations.descriptions, { objectWords: ['Prints'] });
  const text = claimWith(claims, 'text');
  assert.ok(text.heads.includes('caption'));
  assert.equal(text.usual, 'bottom');
  assert.ok(claimWith(claims, 'figure'));
});

test('a group placed on opposite sides splits into one claim per side', () => {
  const both = 'A bird is on the left side, and another bird is on the right side.';
  const claims = groupClaims([d(1, both), d(2, both), d(3, both), d(4, 'A bird sits on the right side.')]);
  const birds = claims.filter(c => c.heads.includes('bird'));
  assert.deepEqual(birds.map(c => c.usual).sort(), ['left', 'right']);
  assert.ok(birds.every(c => c.split));
});

test('a minority place stays as dissent, not a second claim', () => {
  const claims = groupClaims(youngRabbit.descriptions, { objectWords: ['Paintings'] });
  assert.equal(claims.filter(c => c.heads.includes('rabbit')).length, 1);
});

test('"facing the left side" and "extending towards the left side" are not places', () => {
  assert.deepEqual(kinds('Its pointed end is facing the left side of the image.'), [['left side', 'direction']]);
  assert.deepEqual(kinds('Its pointed end is extending towards the left side of the frame.'), [['left side', 'trajectory']]);
});

test('removing the position phrase takes its determiner too', () => {
  const [p] = placesIn('The top section has a series of lines that seem to be forming a pattern.');
  assert.notEqual(p.subject, 'has');
});

test('the card shows at most three claims, each placed by at least three descriptions', () => {
  const rows = cardClaims(groupClaims(youngRabbit.descriptions, { objectWords: ['Paintings'] }));
  assert.deepEqual(rows.map(c => c.heads[0]), ['seal', 'branch', 'rabbit']);
  assert.ok(rows.every(c => c.placed.length >= 3));
});

test('Different Nations: figures split into left and right claims', () => {
  const figures = groupClaims(differentNations.descriptions, { objectWords: ['Prints'] }).filter(c => c.heads.includes('figure'));
  assert.deepEqual(figures.map(c => c.usual), ['left', 'right']);
});

// --- Checks against detected boxes -------------------------------------------

const checked = o => {
  const claims = checkClaims(groupClaims(o.descriptions, { objectWords: [o.classification] }), o.records, o.image);
  return head => claims.find(c => c.heads.includes(head));
};

test('Young Rabbit: seal, branch and rabbit are seen where described; bamboo has nothing to check', () => {
  const claim = checked(youngRabbit);
  assert.equal(claim('seal').check, 'seen');
  assert.equal(claim('seal').boxes[0].type, 'text');
  assert.equal(claim('rabbit').check, 'seen');
  assert.equal(claim('rabbit').boxes[0].label, 'Animal');
  assert.equal(claim('branch').check, 'seen');
  // The only plant box is the branch at the top: a broader label can't contradict.
  assert.equal(claim('bamboo').check, 'none');
});

test('Different Nations: caption text and both groups of figures are seen', () => {
  const claim = checked(differentNations);
  assert.equal(claim('text').check, 'seen');
  const figures = groupClaims(differentNations.descriptions, { objectWords: ['Prints'] }).filter(c => c.heads.includes('figure'));
  const results = checkClaims(figures, differentNations.records, differentNations.image);
  assert.deepEqual(results.map(c => c.check), ['seen', 'seen']);
});

test('a box elsewhere never contradicts a claim: the check is just "none"', () => {
  const claims = [{ heads: ['seal'], usual: 'top-left', placed: [1, 2, 3] }];
  const records = [{ type: 'text', body: 'seal', selectors: [{ value: 'xywh=900,900,40,40' }] }];
  const [c] = checkClaims(claims, records, { width: 1000, height: 1000 });
  assert.equal(c.check, 'none');
  assert.deepEqual(c.boxes, []);
});

test('boxes covering most of the image are ignored', () => {
  const records = [{ type: 'tag', feature: 'region', body: 'Painting', selectors: [{ value: 'xywh=10,10,950,900' }] }];
  assert.equal(boxesIn(records, { width: 1000, height: 1000 }).length, 0);
});

test('Young Rabbit: the "Bird" boxes on the leaves are a detection-only flag', () => {
  const [flag] = detectionOnly(youngRabbit.descriptions, youngRabbit.records, youngRabbit.image);
  assert.equal(flag.head, 'bird');
  assert.ok(flag.count >= 9);
  assert.equal(flag.mentioned, 4);
});

test('Different Nations: face tags are not flagged when the descriptions talk about people', () => {
  assert.deepEqual(detectionOnly(differentNations.descriptions, differentNations.records, differentNations.image), []);
});

test('box coordinates are pixels in the full-size image', () => {
  const image = { width: 4096, height: 1908 };
  const records = [
    { type: 'text', feature: 'region', source: 'Google Vision', body: 'HEAVENS', selectors: [{ value: 'xywh=3600,1500,200,100' }] },
    { type: 'tag', feature: 'region', source: 'Clarifai', body: 'Coin', selectors: [{ value: 'xywh=3000,700,600,600' }] },
  ];
  const [text, coin] = boxesIn(records, image);
  assert.equal(text.cell, 'bottom-right');
  assert.equal(coin.cell, 'right');
  assert.equal(coin.x, 73.2);
});

test('scale-ruler text ("cm", bare numbers) is not text in the work', () => {
  const records = ['cm', '12', 'HEAVENS'].map(body => ({ type: 'text', source: 'Google Vision', body, selectors: [{ value: 'xywh=10,10,20,20' }] }));
  assert.deepEqual(boxesIn(records, { width: 100, height: 100 }).map(b => b.type), ['text']);
});

// --- The positions block in perspectives.compute -------------------------------

test('compute adds a positions block: claims, card, flags, set-aside, by description', () => {
  const { compute } = require('../public/javascripts/perspectives');
  const aiData = youngRabbit.descriptions.map(d => ({ ...d, type: 'description', feature: 'full' }))
    .concat(youngRabbit.records);
  const result = compute(aiData, { id: youngRabbit.id, title: youngRabbit.title, classification: youngRabbit.classification }, youngRabbit.image);
  const { positions } = result;

  const cardLabels = positions.card.map(id => positions.claims.find(c => c.id === id).heads[0]);
  assert.deepEqual(cardLabels, ['seal', 'branch', 'rabbit']);
  const seal = positions.claims.find(c => c.heads.includes('seal'));
  assert.equal(seal.check, 'seen');
  assert.ok(seal.evidence.every(e => e.source && e.sentence && e.cell === 'bottom-right'));
  // The rabbit comes up before the seal in a typical description.
  const rabbit = positions.claims.find(c => c.heads.includes('rabbit'));
  assert.ok(rabbit.reading_offset < seal.reading_offset);
  assert.equal(positions.flags[0].head, 'bird');
  assert.ok(positions.set_aside.direction.count >= 3);
  assert.equal(Object.keys(positions.by_description).length, youngRabbit.descriptions.length);
  // Stored as JSON in the perspectives cache.
  assert.deepEqual(JSON.parse(JSON.stringify(positions)), positions);
});
