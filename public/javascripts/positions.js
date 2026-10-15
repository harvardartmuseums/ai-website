'use strict';

// ---------------------------------------------------------------------------
// Positions — where the descriptions say things are in the image.
//
// extractPositions(text) finds position phrases ("lower right corner", "on the
// left side of the image", "in the background") and says, for each one, what
// kind of position it is. Only kind 'place' is a place on the image; every
// other kind is kept, labelled, so the UI can show what was set aside:
//
//   place       image-relative: "at the bottom right corner", "on the left"
//   depth       a depth layer: "in the foreground", "in the background"
//   direction   which way something faces or looks: "facing to the right"
//   trajectory  where something extends or moves: "extending towards the right"
//   relative    relative to something else: "to the right of the rabbit"
//   nested      inside something else: the caption's text "… at the top"
//   backdrop    "background" as the backdrop, not a depth: "the background is gold"
//   anatomical  a body part: "her left side", "the bird's right wing"
//
// Cells are a 3×3 grid: 'top-left' … 'bottom-right', 'center', and the one-side
// cells 'top', 'bottom', 'left', 'right', which mean the whole row or column.
//
// The grammar comes from the position survey (.plans/position-survey/), which
// measured how often each kind of noise turns up across 392 objects.
// ---------------------------------------------------------------------------

var nlp = require('compromise');

// Words for the image itself. "Of the image" keeps a position image-relative;
// "of the rabbit" makes it relative to something else.
const FRAME_WORDS = ['image', 'picture', 'painting', 'composition', 'frame', 'canvas',
  'print', 'work', 'piece', 'photograph', 'photo', 'drawing', 'scene', 'sheet', 'page',
  'paper', 'panel', 'object', 'coin', 'surface', 'design', 'card', 'plate', 'artwork',
  'engraving', 'etching', 'woodcut', 'lithograph', 'illustration', 'view'];
const FRAME = '(?:' + FRAME_WORDS.join('|') + ')';
// "Left of centre" is still a place on the image.
const IMAGE_ANCHORS = new Set(FRAME_WORDS.concat(['center', 'centre', 'middle']));

// Text inside the image. "At the top of the caption" is nested in the caption.
// Not "plaque" or "banner": those are often the object itself.
const TEXT_CONTAINERS = new Set(['caption', 'inscription', 'label', 'text', 'title',
  'cartouche', 'legend']);

const ROW = { top: 'top', upper: 'top', bottom: 'bottom', lower: 'bottom' };

// Position patterns, most specific first. A later pattern never claims text an
// earlier one already matched. Each returns a cell or a depth layer.
const PATTERNS = [
  // "lower right corner", "upper-left", "bottom right quadrant", "top left of the image"
  { re: /\b(upper|lower|top|bottom)[\s-]+(left|right)(?:[\s-]+(?:hand\s+)?(?:corner|side|quadrant|portion|area|section|edge|region|part))?\b/gi,
    cell: m => ROW[m[1].toLowerCase()] + '-' + m[2].toLowerCase() },
  // "the left side of the image", "right half", "left edge"
  { re: /\b(left|right)(?:[\s-]+hand)?\s+(side|half|edge|portion|border|margin|part|area|section|third|panel)\b/gi,
    cell: m => m[1].toLowerCase() },
  // "upper half", "lower register", "top edge"
  { re: /\b(upper|lower|top|bottom)\s+(half|edge|portion|border|margin|part|area|section|register|third|band)\b/gi,
    cell: m => ROW[m[1].toLowerCase()] },
  // "at the top", "along the bottom of the image"
  { re: new RegExp('\\b(?:at|along|near|across|on)\\s+the\\s+(?:very\\s+)?(top|bottom)\\b', 'gi'),
    cell: m => m[1].toLowerCase() },
  // "on the left", "to the right", "at left", "towards the far left"
  { re: /\b(?:on|to|at|toward|towards)\s+(?:the\s+)?(?:far\s+)?(left|right)\b/gi,
    cell: m => m[1].toLowerCase() },
  // "in the center", "centre of the composition", "middle of the image", "centrally"
  { re: /\b(?:in|at|near)\s+the\s+(?:very\s+)?(?:center|centre|middle)\b|\bcentrally\b/gi,
    cell: () => 'center' },
  // Depth layers. "background" alone is usually the backdrop; see classify().
  { re: /\b(foreground|middle\s?ground|midground|background|distance)\b/gi,
    depth: m => /back|distance/i.test(m[1]) ? 'background' : /fore/i.test(m[1]) ? 'foreground' : 'middle ground' },
];

// Body parts and possessives: "his right hand", "the bird's left wing".
const ANATOMICAL_BEFORE = /\b(?:his|her|their|its|one's|\w+'s)\s+(?:far\s+)?$/i;
const BODY_AFTER = /^\s*(?:hand|arm|leg|foot|feet|shoulder|eye|ear|cheek|wing|knee|hip|thigh|elbow|wrist|paw|side\s+of\s+(?:his|her|their|its))\b/i;
// Facing and looking: "facing to the right", "head is turned to the left".
const DIRECTION_BEFORE = /\b(?:fac(?:e|es|ed|ing)|turn(?:s|ed|ing)?|look(?:s|ed|ing)?|gaz(?:e|es|ed|ing)|glanc(?:e|es|ed|ing)|star(?:e|es|ed|ing)|peer(?:s|ed|ing)?|point(?:s|ed|ing)?|lean(?:s|ed|ing)?|tilt(?:s|ed|ing)?|orient(?:s|ed|ing)?|angled|directed)\b[\w\s,]{0,20}$/i;
// Extending and moving: "extending towards the right", "flowing to the left".
const TRAJECTORY_BEFORE = /\b(?:extend(?:s|ed|ing)?|stretch(?:es|ed|ing)?|reach(?:es|ed|ing)?|lead(?:s|ing)?|sweep(?:s|ing)?|curv(?:e|es|ed|ing)|arc(?:s|ed|ing)?|flow(?:s|ed|ing)?|run(?:s|ning)?|mov(?:e|es|ed|ing)|walk(?:s|ed|ing)?|fl(?:y|ies|ying)|swim(?:s|ming)?|head(?:s|ed|ing)|slop(?:e|es|ed|ing)|diagonally)\b[\w\s,]{0,20}$/i;
// Only "to/towards the left" style phrases can be directions or trajectories;
// "on the left" and "in the corner" always name a place. The "towards" may
// also sit just before the match: "extending towards the left side".
const DIRECTIONAL_PHRASE = /^(?:to|toward|towards)\b/i;
const DIRECTIONAL_LEAD = /\b(?:to|toward|towards|into)\s+(?:the\s+)?(?:far\s+)?$/i;
// "facing the left side", "looking the other way": a direction with no "to".
const FACING_RIGHT_BEFORE = /\b(?:fac(?:e|es|ed|ing)|look(?:s|ed|ing)?|point(?:s|ed|ing)?)\s+(?:the\s+)?$/i;
// "… of the rabbit", "… of the central figure": the thing a position is
// relative to. Captures the next two words; either may be the noun.
const OF_WHAT = /^\s+of\s+(?:the\s+|a\s+|an\s+|this\s+|that\s+|his\s+|her\s+|its\s+|their\s+)?(\w+)(?:\s+(\w+))?/i;
// Right after a quoted string: the caption's text "… at the top".
const AFTER_QUOTE = /["”’]\s*$/;
// Depth layer phrasing: "in the background", "in the far distance".
const DEPTH_PHRASE_BEFORE = /\b(?:in|into|toward|towards|against)\s+(?:the\s+)?(?:far\s+|distant\s+)?$/i;

// Nouns too general to be what a position refers to.
const GENERIC = new Set(('image picture painting composition frame canvas print work piece photograph ' +
  'photo drawing scene sheet page paper panel side corner edge half portion border margin part area ' +
  'section region quadrant register center centre middle top bottom left right foreground background ' +
  'distance ground view detail element feature appearance style color colour tone quality way ' +
  'something there it this that which').split(' '));

function sentencesOf(text) {
  return String(text || '').replace(/\*\*|__|#+\s|`/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

// Clause boundaries: ; and : (so a list item's heading, "Bamboo: on the right
// side …", stays with its own phrase), and conjunctions that start a new
// clause ("…, while bamboo leaves are painted at the bottom").
const CLAUSE_BREAK = /;|:|,\s+(?:while|whereas|but|and|with)\s+|\s+(?:while|whereas)\s+/gi;

// The clause around a match.
function clauseAround(sentence, start, end) {
  let from = 0, to = sentence.length;
  for (const m of sentence.matchAll(CLAUSE_BREAK)) {
    if (m.index + m[0].length <= start) from = m.index + m[0].length;
    else if (m.index >= end) { to = m.index; break; }
  }
  return sentence.slice(from, to);
}

// Spatial prepositional phrases name a landmark, not the subject: in "Above
// the rabbit, delicate branches extend across the top", the branches are at
// the top, not the rabbit. These are removed before the subject is chosen.
const LANDMARK_PHRASE = /\b(?:above|below|behind|beneath|beside|under|underneath|over|near|around|among|amongst|next\s+to|in\s+front\s+of|on\s+top\s+of|to\s+the\s+(?:left|right)\s+of)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|its\s+|their\s+)?(?:[\w-]+\s+){0,2}?[\w-]+(?=[\s,.;:]|$)/gi;

// Words that can never end a subject phrase, by their tag in context:
// pronouns ("they", "she"), numbers ("two") and lone nationalities ("French").
const NOT_A_HEAD_TAGS = ['Pronoun', 'Value', 'Demonym'];

// Plain-text phrase from compromise terms, without leading determiners.
function phraseOf(terms) {
  return terms.map(t => t.text).join(' ').toLowerCase()
    .replace(/[^a-z\s'-]/g, '').trim()
    .replace(/^(?:the|a|an|this|that|these|those|his|her|their|its|some)\s+/, '');
}

// Split a noun chunk at "and" / "&": "the signature and the seal" names two
// subjects. Commas are not split: "a faint, pencil signature" is one.
function coordinated(terms) {
  const parts = [[]];
  for (const t of terms) {
    if (/^(?:and|&)$/i.test(t.text)) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts.filter(part => part.length);
}

// A part is a subject when its last word works as a noun in its sentence and
// the phrase is not just generic words ("the left side").
function isSubject(part) {
  const head = part[part.length - 1];
  if (!head.tags.includes('Noun') || NOT_A_HEAD_TAGS.some(tag => head.tags.includes(tag))) return false;
  const phrase = phraseOf(part);
  return !!phrase && !phrase.split(/\s+/).every(w => GENERIC.has(w));
}

// The subjects a position refers to: the first concrete noun phrase in its
// clause, once landmark phrases are removed, split into its coordinated parts.
// Returns [] when there is none.
function subjectsOf(clause) {
  const chunks = nlp(clause.replace(LANDMARK_PHRASE, ' ')).nouns().json();
  for (let i = 0; i < chunks.length; i++) {
    const words = chunks[i].terms.filter(t => !t.tags.includes('Determiner'));
    // compromise reads the first of a list of adjectives as a noun: in "a
    // plump, gray rabbit" it finds "a plump," and "gray rabbit". A one-word
    // chunk ending in a comma, followed by a chunk that opens with an
    // adjective, is that case.
    const next = chunks[i + 1];
    const listed = words.length === 1 && /,/.test(words[0].post || '') &&
      next && next.terms[0] && next.terms[0].tags.includes('Adjective');
    if (listed) continue;
    const parts = coordinated(chunks[i].terms).filter(isSubject).map(phraseOf);
    if (parts.length) return parts;
  }
  return [];
}

// What kind of position a match is, from the words either side of it.
// `anchors` are the words that mean the image itself.
function classify(match, pattern, sentence, start, end, anchors) {
  const before = sentence.slice(Math.max(0, start - 40), start);
  const after = sentence.slice(end, end + 40);
  const text = match[0];

  if (pattern.depth) {
    if (pattern.depth(match) !== 'background') return 'depth';
    // "in the background" is a depth; "the background is gold" is the backdrop.
    return DEPTH_PHRASE_BEFORE.test(before) ? 'depth' : 'backdrop';
  }
  if (ANATOMICAL_BEFORE.test(before) || BODY_AFTER.test(after)) return 'anatomical';
  if (FACING_RIGHT_BEFORE.test(before)) return 'direction';
  const lead = DIRECTIONAL_LEAD.exec(before);
  if (DIRECTIONAL_PHRASE.test(text) || lead) {
    // Test the words before the "towards", if it sits outside the match. When
    // both kinds of verb appear ("its pointed end is extending towards"), the
    // one nearest the phrase decides.
    const verbs = lead ? before.slice(0, lead.index) : before;
    const direction = DIRECTION_BEFORE.exec(verbs), trajectory = TRAJECTORY_BEFORE.exec(verbs);
    if (direction && trajectory) return direction.index > trajectory.index ? 'direction' : 'trajectory';
    if (direction) return 'direction';
    if (trajectory) return 'trajectory';
  }
  if (AFTER_QUOTE.test(before)) return 'nested';
  const of = OF_WHAT.exec(after);
  if (of) {
    // "of the image for reference": the first word is the anchor. "of the
    // central figure": the second is. Image words win either way.
    const words = [of[1], of[2]].filter(Boolean).map(w => w.toLowerCase());
    if (words.some(w => anchors.has(w))) return 'place';
    if (words.some(w => TEXT_CONTAINERS.has(w))) return 'nested';
    return 'relative';
  }
  return 'place';
}

// Every position phrase in a text, in reading order, with its kind.
//
// options.objectWords: words for this object ("plaque", "coin", "vase"), so
// "at the top of the plaque" counts as a place when the object is a plaque.
//
// Returns [{ phrase, kind, cell, depth, subject, subjects, clause, sentence, offset }].
// subjects lists coordinated subjects ("the signature and the seal"); subject
// is the first. offset is the phrase's position in the whole text (0–1).
function extractPositions(text, options = {}) {
  const anchors = new Set([...IMAGE_ANCHORS, ...(options.objectWords || []).map(w => String(w).toLowerCase())]);
  const found = [];
  const body = String(text || '');
  let searchFrom = 0;
  for (const sentence of sentencesOf(body)) {
    const sentenceAt = Math.max(0, body.indexOf(sentence.slice(0, 20), searchFrom));
    searchFrom = sentenceAt;
    const taken = [];
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      for (const m of sentence.matchAll(pattern.re)) {
        const start = m.index, end = start + m[0].length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        taken.push([start, end]);
        const kind = classify(m, pattern, sentence, start, end, anchors);
        const clause = clauseAround(sentence, start, end);
        // Remove the phrase with its determiner, so "The top section has a
        // series of lines" doesn't leave "The has" for the noun finder.
        const rest = clause.replace(new RegExp('(?:\\b(?:the|a|an)\\s+)?' + m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
        const subjects = kind === 'anatomical' ? [] : subjectsOf(rest);
        found.push({
          phrase: m[0],
          kind,
          cell: pattern.cell ? pattern.cell(m) : null,
          depth: pattern.depth && kind === 'depth' ? pattern.depth(m) : null,
          subjects,
          subject: subjects[0] || null,
          clause,
          sentence,
          offset: body.length ? (sentenceAt + start) / body.length : 0,
        });
      }
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

// Only the places on the image: what the position views count.
function placesIn(text, options) {
  return extractPositions(text, options).filter(p => p.kind === 'place');
}

// ---------------------------------------------------------------------------
// Claims — grouping positioned subjects.
//
// A claim is one subject and where the descriptions put it ("seal and
// signature · bottom right · 22 descriptions"). Subjects are reduced to their
// singular head noun ("small red seal" → seal), then heads are joined when:
//
//   together  descriptions name them in the same clause as the position, in
//             at least MIN_TOGETHER descriptions ("a signature followed by a
//             red seal"), and their usual places agree; or
//   family    they belong to the same small family (text and marks, plants,
//             people) and their usual places are the same.
//
// "Usual place" is the cell most descriptions give; places agree when they are
// the same cell or one is a side containing the other (bottom ⊃ bottom-right).
// Grouping was tuned on 15 objects across classifications; see
// .plans/position-survey/README.md.
// ---------------------------------------------------------------------------

var overview = require('./overview');

// A head must be placed by at least this many descriptions to become a claim.
const MIN_CLAIM_DESCRIPTIONS = 2;
// Heads named together in at least this many descriptions may join.
const MIN_TOGETHER = 2;
// A group placed in two places that don't agree ("left" and "right") is split
// into one claim per place when the second place has at least this share of
// the placings and at least SPLIT_MIN descriptions: two birds, not one bird
// with dissent.
const SPLIT_SHARE = 0.25;
const SPLIT_MIN = 3;

// Heads that are never subjects: function words, the image and its parts,
// technique ("strokes"), vague nouns ("design", "shape") that make claims
// that say nothing, verbs and gerunds compromise mistakes for nouns,
// photography scale bars, the sheet itself, and bare colour words.
const NOT_SUBJECTS = new Set((
  'the a an it this that there here one ' +
  'image picture engraving scene artwork work piece section part area portion corner edge ' +
  'bottom top left right center centre middle side element detail view object item thing ' +
  'background foreground color colour tone space presence use way feature stroke brushstroke ' +
  'design shape form structure composition display showcase artifact subject hint formation ' +
  'material surface darker lighter faint ' +
  'visible contain include depict appear show itself likely stand holding interacting ' +
  'scale ruler centimeter centimetre inch measurement marker reference ' +
  'paper page sheet document folio ' +
  'red blue green yellow black white gray grey gold golden brown orange pink purple'
).split(' '));

// Small families whose members are often the same thing in one place. Kept
// narrow on purpose: a bigger family joins things that merely look alike.
const CLAIM_FAMILIES = {
  marks: ['seal', 'signature', 'inscription', 'text', 'character', 'calligraphy', 'caption',
    'title', 'stamp', 'letter', 'writing', 'script', 'mark', 'monogram', 'legend', 'label',
    'word', 'date', 'name', 'initial', 'notation', 'number'],
  plants: ['tree', 'foliage', 'branch', 'trunk', 'shrub', 'bush', 'leaf', 'plant', 'bamboo',
    'grass', 'reed', 'stem', 'vine'],
  flowers: ['flower', 'blossom', 'bloom', 'petal', 'bud', 'berry'],
  people: ['figure', 'man', 'woman', 'person', 'people', 'child', 'boy', 'girl', 'individual'],
};
const FAMILY_OF = new Map(Object.entries(CLAIM_FAMILIES).flatMap(([f, heads]) => heads.map(h => [h, f])));

// Each cell as [row, column], with null for the whole row or column.
const CELL_AXES = {
  'top-left': [0, 0], top: [0, null], 'top-right': [0, 2],
  left: [null, 0], center: [1, 1], right: [null, 2],
  'bottom-left': [2, 0], bottom: [2, null], 'bottom-right': [2, 2],
};
// Does a one-side cell ("bottom") contain another cell ("bottom-right")?
function sideContains(side, cell) {
  const [r1, c1] = CELL_AXES[side], [r2, c2] = CELL_AXES[cell];
  if (r1 === null) return c1 === c2;
  if (c1 === null) return r1 === r2;
  return false;
}
function placesAgree(a, b) {
  return a === b || sideContains(a, b) || sideContains(b, a);
}

function usableHead(head, objectWords) {
  return !!head && head.length > 2 && /^[a-z][a-z'-]*$/.test(head) &&
    !NOT_SUBJECTS.has(head) && !objectWords.has(head);
}

// The cell most descriptions give, from a { cell: count } tally.
function usualCell(cells) {
  return Object.entries(cells).sort((a, b) => b[1] - a[1])[0][0];
}

// Group the positioned subjects in a set of descriptions into claims.
//
// descriptions: [{ id, body }]
// options.objectWords: the object's own words (from its classification), which
//   are neither subjects nor landmarks: "coin", "vessel".
// options.extracted: Map(description id → extractPositions(body)), if already done.
//
// Returns claims, most-placed first:
//   [{ heads, label, placed, spread, usual, mentioned, split }]
//   heads      the grouped head nouns, most-placed first
//   placed     ids of the descriptions that place the claim
//   spread     [[cell, descriptions]], most first
//   usual      the cell most descriptions give
//   mentioned  how many descriptions mention any of the heads anywhere
//   split      true when the group was split by place (two birds, left and right)
//   readingOffset  how far into a description it first comes up, on average
//   evidence   [{ id, cell, phrase, sentence }], the placements behind it
function groupClaims(descriptions, options = {}) {
  const objectWords = new Set((options.objectWords || []).map(w => overview.headNoun(w)));
  // heads[head] = { placed: Set(description id), cells: { cell: descriptions },
  //                 byDescription: Map(description id → Set(cell)),
  //                 evidence: [{ id, cell, phrase, sentence }] }
  const heads = new Map();
  const together = new Map();   // 'a+b' → descriptions naming both in a positioned clause
  const positioned = descriptions.map(d => ({
    id: d.id,
    // "the signature and the seal" places both: one entry per coordinated subject.
    // options.extracted (description id → extractPositions result) saves a
    // second parse when the caller has already extracted positions.
    places: ((options.extracted && options.extracted.get(d.id)) || extractPositions(d.body, { objectWords: [...objectWords] }))
      .filter(p => p.kind === 'place')
      .flatMap(p => p.subjects.map(subject => ({ ...p, head: overview.headNoun(subject) })))
      .filter(p => usableHead(p.head, objectWords)),
  }));

  for (const { id, places } of positioned) {
    const counted = new Set();
    for (const p of places) {
      const entry = heads.get(p.head) || { placed: new Set(), cells: {}, byDescription: new Map(), evidence: [] };
      heads.set(p.head, entry);
      entry.placed.add(id);
      entry.evidence.push({ id, cell: p.cell, phrase: p.phrase, sentence: p.sentence });
      entry.byDescription.set(id, (entry.byDescription.get(id) || new Set()).add(p.cell));
      if (!counted.has(p.head + '|' + p.cell)) {
        counted.add(p.head + '|' + p.cell);
        entry.cells[p.cell] = (entry.cells[p.cell] || 0) + 1;
      }
    }
  }
  // Which heads each positioned clause names, beyond its own subject.
  for (const { places } of positioned) {
    const pairs = new Set();
    for (const p of places) {
      for (const other of heads.keys()) {
        if (other !== p.head && overview.mentions(p.clause, other)) pairs.add([p.head, other].sort().join('+'));
      }
    }
    for (const pair of pairs) together.set(pair, (together.get(pair) || 0) + 1);
  }

  // Union–find over the heads placed often enough to be claims.
  const parent = new Map();
  for (const [head, entry] of heads) if (entry.placed.size >= MIN_CLAIM_DESCRIPTIONS) parent.set(head, head);
  const root = h => (parent.get(h) === h ? h : root(parent.get(h)));
  const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(root(a), root(b)); };
  const usual = h => usualCell(heads.get(h).cells);

  for (const [pair, n] of together) {
    const [a, b] = pair.split('+');
    if (n >= MIN_TOGETHER && parent.has(a) && parent.has(b) && placesAgree(usual(a), usual(b))) join(a, b);
  }
  const candidates = [...parent.keys()];
  for (const a of candidates) {
    for (const b of candidates) {
      if (a < b && FAMILY_OF.has(a) && FAMILY_OF.get(a) === FAMILY_OF.get(b) && usual(a) === usual(b)) join(a, b);
    }
  }

  // Collect each group's descriptions and places.
  const groups = new Map();
  for (const head of candidates) {
    const r = root(head);
    groups.set(r, (groups.get(r) || []).concat(head));
  }
  return [...groups.values()]
    .flatMap(members => splitByPlace(members.sort((a, b) => heads.get(b).placed.size - heads.get(a).placed.size), heads, descriptions))
    .sort((a, b) => b.placed.length - a.placed.length);
}

// One claim per place for a group of heads; usually just one.
function splitByPlace(members, heads, descriptions) {
  // Each description's places for the group, and the descriptions per cell.
  const byDescription = new Map();
  for (const h of members) {
    for (const [id, cells] of heads.get(h).byDescription) {
      byDescription.set(id, new Set([...(byDescription.get(id) || []), ...cells]));
    }
  }
  const tally = {};
  for (const cells of byDescription.values()) for (const cell of cells) tally[cell] = (tally[cell] || 0) + 1;
  const spread = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const total = spread.reduce((sum, [, n]) => sum + n, 0);

  // Zones: the strong places, merged when they agree ("bottom" and "bottom-right").
  const strong = spread.filter(([, n]) => n >= Math.max(SPLIT_MIN, SPLIT_SHARE * total)).map(([cell]) => cell);
  const zones = [];
  for (const cell of strong) if (!zones.some(z => placesAgree(z, cell))) zones.push(cell);
  if (!zones.length) zones.push(spread[0][0]);
  // Every place goes to the first zone it agrees with; places that agree with
  // none stay with the main zone, as dissent.
  const zoneOf = cell => zones.find(z => placesAgree(z, cell)) || zones[0];

  // How many descriptions mention the group at all, and how far into them
  // (0 = start, 1 = end) it first comes up, on average: the reading order.
  const patterns = members.map(h => overview.nounPattern(h));
  const firsts = descriptions.map(d => {
    const at = patterns.map(re => d.body.search(re)).filter(i => i >= 0);
    return at.length ? Math.min(...at) / Math.max(1, d.body.length) : null;
  }).filter(x => x !== null);
  const mentioned = firsts.length;
  const readingOffset = firsts.length ? +(firsts.reduce((a, b) => a + b, 0) / firsts.length).toFixed(3) : null;
  const evidence = members.flatMap(h => heads.get(h).evidence);

  return zones.map(zone => {
    const cells = {}, placed = [];
    for (const [id, set] of byDescription) {
      const mine = [...set].filter(cell => zoneOf(cell) === zone);
      if (!mine.length) continue;
      placed.push(id);
      for (const cell of mine) cells[cell] = (cells[cell] || 0) + 1;
    }
    const zoneSpread = Object.entries(cells).sort((a, b) => b[1] - a[1]);
    return {
      heads: members,
      label: members.slice(0, 2).join(' and '),
      placed,
      spread: zoneSpread,
      usual: zoneSpread[0][0],
      mentioned,
      split: zones.length > 1,
      readingOffset,
      // The sentences that place it here, one per description and phrase.
      evidence: evidence.filter((e, i) => zoneOf(e.cell) === zone &&
        evidence.findIndex(o => o.id === e.id && o.sentence === e.sentence) === i),
    };
  });
}

// The claims an Overview card shows: those at least CARD_MIN_PLACED
// descriptions place, most-placed first, at most `max`. Weaker claims stay
// in the viewer, which lists every claim. Measured across 392 objects:
// without the minimum, 29% of card rows rested on just 2 descriptions.
const CARD_MIN_PLACED = 3;
const CARD_MAX_ROWS = 3;
function cardClaims(claims, max = CARD_MAX_ROWS) {
  return claims.filter(c => c.placed.length >= CARD_MIN_PLACED)
    .sort((a, b) => b.placed.length - a.placed.length)
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Checks — claims against what the vision services located.
//
// The services store boxes for OCR text, faces and region tags. Each claim is
// checked against the boxes that could be the same thing:
//
//   marks (seal, signature, text …)  → OCR text boxes
//   people (figure, man, face …)     → face boxes, and Person/Man/Woman tags
//   anything else                    → region tags whose label is the claim's
//                                      noun or a broader word for it
//                                      ("Animal" for a rabbit)
//
// The check is 'seen' when a matching box sits where the claim says (a box
// counts as in a cell when its centre is; one-side cells accept their side),
// and 'none' otherwise. There is no 'wrong': across 392 objects, claims the
// boxes seemed to contradict turned out to be the services missing things (a
// cursive signature OCR can't read, faces it didn't find in a crowded print)
// or positions on one face of a two-sided coin. Boxes covering most of the
// image ("Painting", "Picture frame") say nothing about place and are ignored.
//
// Separately, detectionOnly() lists region tags the services found repeatedly
// that few descriptions mention, such as leaves boxed as "Bird".
// ---------------------------------------------------------------------------

// Boxes larger than this share of the image are the whole object, not a place.
const MAX_BOX_AREA = 0.4;
// A tag label must be boxed at least this often before it is a detection-only
// flag, and mentioned by fewer than this share of descriptions. On Young
// Rabbit, 10 "Bird" boxes sit on leaves, and 4 of 39 descriptions mention a
// bird (two of them Microsoft captions, from a vision service too).
const MIN_DETECTION_BOXES = 3;
const MAX_DETECTION_MENTION_SHARE = 0.15;

const FACE_WORDS = new Set(['face', 'head', 'portrait']);
const PERSON_TAGS = new Set(['person', 'man', 'woman', 'human', 'people', 'boy', 'girl', 'child']);
// Broader tag labels services use for a claim's noun ("Animal" for a rabbit).
const BROADER = {
  animal: ['rabbit', 'hare', 'dog', 'cat', 'horse', 'lion', 'deer', 'cow', 'ox', 'sheep', 'goat',
    'pig', 'bear', 'monkey', 'elephant', 'tiger', 'fox', 'wolf', 'bird', 'fish', 'dragon', 'creature', 'beast'],
  plant: CLAIM_FAMILIES.plants,
  flower: CLAIM_FAMILIES.flowers,
  bird: ['crane', 'stork', 'peacock', 'heron', 'duck', 'goose', 'eagle', 'hawk', 'swan', 'dove', 'parrot', 'rooster', 'owl'],
  vehicle: ['boat', 'ship', 'gondola', 'sailboat', 'car', 'cart', 'carriage', 'wagon', 'truck', 'bus', 'train', 'bicycle', 'automobile', 'vessel'],
  food: ['fruit', 'bread', 'cake', 'meat', 'fish', 'vegetable', 'grape', 'apple'],
};
// Generic tag labels that descriptions rarely name even when true ("Clothing",
// "Adult", "Human nose"). Not worth flagging: the flag is for likely mislabels.
const GENERIC_TAGS = new Set(['clothing', 'footwear', 'shoe', 'adult', 'male', 'female', 'baby',
  'person', 'man', 'woman', 'human', 'people', 'boy', 'girl', 'child', 'face', 'head', 'hand',
  'arm', 'eye', 'nose', 'ear', 'mouth', 'hair', 'leg', 'foot', 'finger', 'frame', 'tableware',
  'furniture', 'building', 'plant', 'animal', 'art', 'pattern', 'text', 'font', 'sleeve', 'dress']);

// A box from an annotation record, in % of the image, with its centre's cell.
// Box coordinates are pixels in the full-size image the API's image record
// describes (its width and height).
function boxOf(record, image) {
  const xywh = selectorOf(record);
  const width = image && image.width, height = image && image.height;
  if (!xywh || !width || !height) return null;
  const [x, y, w, h] = xywh;
  if ((w * h) / (width * height) > MAX_BOX_AREA) return null;
  const cx = (x + w / 2) / width, cy = (y + h / 2) / height;
  const row = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : null;
  const col = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : null;
  return {
    type: record.type,
    source: record.source,
    label: record.type === 'tag' ? String(record.body || '') : record.type,
    head: record.type === 'tag' ? overview.headNoun(String(record.body || '').split(/\s+/).pop() || '') : record.type,
    cell: row && col ? row + '-' + col : row || col || 'center',
    // % of the image, for drawing.
    x: +(x / width * 100).toFixed(1), y: +(y / height * 100).toFixed(1),
    w: +(w / width * 100).toFixed(1), h: +(h / height * 100).toFixed(1),
  };
}

function selectorOf(record) {
  const m = /xywh=(-?\d+),(-?\d+),(\d+),(\d+)/.exec((record.selectors && record.selectors[0] && record.selectors[0].value) || '');
  return m ? m.slice(1).map(Number) : null;
}

// OCR of the photographer's scale ruler or colour target: "cm", "inches",
// bare numbers. Not text in the work.
const SCALE_TEXT = /^\s*(?:cm|mm|in|inch|inches|centimet(?:er|re)s?|[\d\s.,|-]+)\s*$/i;

// The detected boxes in a set of annotation records, ignoring whole-image ones
// and scale-ruler text.
function boxesIn(records, image) {
  return (records || [])
    .filter(r => r.type === 'face' || (r.type === 'tag' && r.feature === 'region') ||
      (r.type === 'text' && !SCALE_TEXT.test(String(r.body || ''))))
    .map(r => boxOf(r, image))
    .filter(Boolean);
}

// Is a box in the place a description gives? One-side cells accept their side.
function boxIn(cell, box) {
  return cell === box.cell || sideContains(cell, box.cell);
}

// The boxes that could be the thing a claim names: OCR text for marks, faces
// and person tags for people, otherwise region tags with the claim's noun or
// a broader word for it ("Animal" for a rabbit).
function matchingBoxes(claim, boxes) {
  const heads = new Set(claim.heads);
  if (claim.heads.some(h => FAMILY_OF.get(h) === 'marks')) return boxes.filter(b => b.type === 'text');
  if (claim.heads.some(h => FAMILY_OF.get(h) === 'people' || FACE_WORDS.has(h))) {
    return boxes.filter(b => b.type === 'face' || (b.type === 'tag' && (PERSON_TAGS.has(b.head) || FACE_WORDS.has(b.head))));
  }
  return boxes.filter(b => b.type === 'tag' &&
    (heads.has(b.head) || (BROADER[b.head] || []).some(h => heads.has(h))));
}

// Check each claim against the boxes. Adds { check, boxes } to a copy of each:
//   check  'seen' when a matching box is where the claim says, else 'none'
//   boxes  the matching boxes in the claim's place, for drawing
function checkClaims(claims, records, image) {
  const boxes = boxesIn(records, image);
  return claims.map(claim => {
    const here = matchingBoxes(claim, boxes).filter(b => boxIn(claim.usual, b));
    return { ...claim, check: here.length ? 'seen' : 'none', boxes: here };
  });
}

// Region tags boxed at least MIN_DETECTION_BOXES times that fewer than
// MAX_DETECTION_MENTION_SHARE of descriptions mention (by the label or a
// narrower word for it). Generic labels are skipped. Most-boxed first:
//   [{ label, head, count, sources, mentioned, boxes }]
//   mentioned  how many descriptions do mention it
function detectionOnly(descriptions, records, image) {
  const byHead = new Map();
  for (const box of boxesIn(records, image)) {
    if (box.type !== 'tag' || !usableHead(box.head, new Set()) || GENERIC_TAGS.has(box.head) ||
      /^human\b/i.test(box.label)) continue;
    byHead.set(box.head, (byHead.get(box.head) || []).concat(box));
  }
  const peopleWords = CLAIM_FAMILIES.people.concat([...PERSON_TAGS]);
  const mentionedBy = head => {
    const words = PERSON_TAGS.has(head) || FACE_WORDS.has(head) ? peopleWords.concat([head]) : [head].concat(BROADER[head] || []);
    return descriptions.filter(d => words.some(w => overview.mentions(d.body, w))).length;
  };
  return [...byHead.entries()]
    .filter(([, list]) => list.length >= MIN_DETECTION_BOXES)
    .map(([head, list]) => ({
      label: list[0].label, head, count: list.length,
      sources: [...new Set(list.map(b => b.source))],
      mentioned: mentionedBy(head), boxes: list,
    }))
    .filter(flag => flag.mentioned < MAX_DETECTION_MENTION_SHARE * descriptions.length)
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// The positions block in perspectives.compute's result.
// ---------------------------------------------------------------------------

// Kinds of position that are set aside, with how many examples to keep.
const SET_ASIDE_KINDS = ['direction', 'relative', 'trajectory', 'nested'];
const SET_ASIDE_EXAMPLES = 3;

// Everything the position views need, from one object image's descriptions
// and annotation records:
//
//   claims          every claim, most-placed first, each with
//                   { id, label, heads, usual, spread, placed, placed_by,
//                     mentioned, split, reading_offset, check, boxes, evidence }
//                   (evidence entries name their annotation and source)
//   card            ids of the claims the Overview card shows (cardClaims)
//   flags           detection-only flags (detectionOnly), most-boxed first
//   set_aside       { kind: { count, examples } } for directions, positions
//                   relative to something else, trajectories and positions
//                   inside something else ("the top of the caption")
//   by_description  { annotation id: [{ phrase, kind, cell, subject, offset }] },
//                   every position phrase in reading order, for the reader
//
// descriptions: [{ id, source, body }]; records: all the image's annotation
// records (boxes are taken from the region, text and face ones); image: the
// image record ({ width, height }); objectInfo: the object record.
function computePositions({ descriptions, records, image, objectInfo }) {
  const objectWords = objectInfo && objectInfo.classification ? [objectInfo.classification] : [];
  const sourceOf = new Map(descriptions.map(d => [d.id, d.source]));

  // Parse each description once; grouping and the reader both use it.
  const extracted = new Map(descriptions.map(d => [d.id, extractPositions(d.body, { objectWords })]));

  const claims = checkClaims(groupClaims(descriptions, { objectWords, extracted }), records, image)
    .map((c, i) => ({
      id: 'claim-' + (i + 1),
      label: c.label,
      heads: c.heads,
      usual: c.usual,
      spread: c.spread,
      placed: c.placed.length,
      placed_by: c.placed,
      mentioned: c.mentioned,
      split: c.split,
      reading_offset: c.readingOffset,
      check: c.check,
      boxes: c.boxes,
      evidence: c.evidence.map(e => ({ annotation_id: e.id, source: sourceOf.get(e.id), cell: e.cell, phrase: e.phrase, sentence: e.sentence })),
    }));
  // cardClaims works on the grouped shape, where placed is a list of ids.
  const card = cardClaims(claims.map(c => ({ ...c, placed: c.placed_by }))).map(c => c.id);

  const setAside = {};
  const byDescription = {};
  for (const d of descriptions) {
    const found = extracted.get(d.id);
    byDescription[d.id] = found.map(p => ({ phrase: p.phrase, kind: p.kind, cell: p.cell, subject: p.subject, offset: +p.offset.toFixed(3) }));
    for (const p of found) {
      if (!SET_ASIDE_KINDS.includes(p.kind)) continue;
      const entry = setAside[p.kind] = setAside[p.kind] || { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < SET_ASIDE_EXAMPLES) {
        entry.examples.push({ annotation_id: d.id, source: d.source, phrase: p.phrase, sentence: p.sentence });
      }
    }
  }

  return {
    claims,
    card,
    flags: detectionOnly(descriptions, records, image).map(f => ({ kind: 'detection_only', ...f })),
    set_aside: setAside,
    by_description: byDescription,
  };
}

module.exports = { extractPositions, placesIn, groupClaims, cardClaims, checkClaims, detectionOnly, boxesIn, computePositions };
