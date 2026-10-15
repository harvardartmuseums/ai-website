'use strict';

// ---------------------------------------------------------------------------
// Overview — the summary layer of the image research page.
//
// perspectives.compute() does the heavy NLP work; this module turns its
// intermediate results into the small, scannable facts shown on the Overview
// tab, each of which links back to the exact descriptions behind it:
//
//   agreement    nouns most descriptions mention, counted across phrasing
//                variants ("hat", "black hat", "tricorn hat" all count as hat)
//   mood         interpretive mood words, excluding colour/tone adjectives
//   colour_words colours the descriptions name, to set beside the measured palette
//   attention    how many descriptions touch each radar dimension
//   distinctive  per description, phrases no other description uses
//   divergence   claims that disagree with the museum record (titles, names,
//                paint media), plus the shortest and longest descriptions
//
// Everything here is deterministic and counts *descriptions*, never repeated
// mentions inside one description. Agreement still does not mean accuracy.
// ---------------------------------------------------------------------------

var nlp = require('compromise');

// Agreement needs at least this many descriptions before a term is shown.
const MIN_AGREEMENT_DESCRIPTIONS = 2;
const MAX_AGREEMENT_TERMS = 5;
const MAX_MOOD_TERMS = 6;
const MAX_DISTINCTIVE_PER_DESCRIPTION = 2;
// Names used by more than this share of descriptions are treated as text in
// the image rather than as a divergent claim.
const MAX_NAME_SHARE = 0.1;

// Observation categories whose phrases can name what an image shows. Mood and
// action phrases are excluded: they are readings, not subjects.
const SUBJECT_CATEGORIES = new Set(['people', 'animals', 'objects', 'setting',
  'colour_light', 'material_technique', 'other']);

// Nouns that are true of nearly any artwork, or too abstract to say anything
// about this image ("element", "surface"). Format words like "portrait" are
// here for the same reason: they describe the kind of object, not its content.
const GENERIC_NOUNS = new Set([
  'image', 'artwork', 'work', 'art', 'piece', 'picture', 'painting', 'portrait',
  'photograph', 'photo', 'scene', 'composition', 'style', 'detail', 'background',
  'foreground', 'figure', 'person', 'subject', 'element', 'feature', 'surface',
  'setting', 'side', 'scale', 'structure', 'pattern', 'formation', 'dimension',
  'color', 'colour', 'shape', 'section', 'appearance', 'motif', 'frame', 'part',
  'area', 'object', 'form', 'edge', 'line', 'top', 'bottom', 'left', 'right',
  'center', 'centre', 'middle', 'item', 'sense', 'tone', 'texture', 'design',
  'view', 'light', 'shadow', 'interior', 'exterior', 'theme', 'quality',
  'depiction', 'representation', 'medium', 'expression', 'era', 'period',
  'century', 'time', 'way', 'use', 'look', 'overall', 'impression', 'something',
  'individual', 'activity', 'direction', 'holding', 'artist', 'status', 'power',
  'wealth', 'importance', 'significance', 'craftsmanship', 'characteristic',
  // Photography targets and rulers appear beside many objects, not in them.
  'centimeter', 'centimetre', 'inch', 'ruler', 'measurement',
]);

// Leading words stripped from distinctive phrases ("this striking self-portrait").
const LEADING_FILLER = new Set(['this', 'these', 'that', 'those', 'some', 'both',
  'its', 'his', 'her', 'their', 'overall', 'such', 'other', 'same', 'left', 'right']);

// Bare colour words make poor agreement headlines ("green appears in 25…");
// coloured objects ("red coat") still count under their noun.
const COLOUR_WORDS = new Set(['red', 'orange', 'yellow', 'green', 'blue',
  'purple', 'violet', 'pink', 'brown', 'black', 'white', 'gray', 'grey', 'gold',
  'silver', 'beige', 'cream', 'ochre', 'turquoise', 'teal', 'dark', 'light']);

// Colour words counted for the "Colour: measured and described" card. Spelling
// variants share one entry; "dark" and "light" are tone, not colour, and stay out.
const DESCRIBED_COLOURS = {
  red: ['red'], orange: ['orange'], yellow: ['yellow'], green: ['green'],
  blue: ['blue'], purple: ['purple', 'violet'], pink: ['pink'], brown: ['brown'],
  black: ['black'], white: ['white'], gray: ['gray', 'grey'], gold: ['gold', 'golden'],
  silver: ['silver'], beige: ['beige'], cream: ['cream'], ochre: ['ochre', 'ocher'],
  turquoise: ['turquoise'], teal: ['teal'],
};
const MAX_COLOUR_WORDS = 10;

// Mood-palette entries that describe value or colour rather than feeling.
const TONAL_WORDS = new Set(['dark', 'muted', 'vibrant', 'colorful', 'colourful',
  'soft', 'rich', 'bright', 'warm', 'cool', 'light', 'pale', 'subdued', 'earthy',
  'vivid', 'bold', 'delicate', 'lush', 'detailed', 'intricate', 'still',
  'sparse', 'stark', 'minimal']);

// Paint media a description might assert. A claim is flagged only when the
// museum record's medium/technique/classification names none of the same
// family. Drawing media (pencil, charcoal) and "photograph" are left out on
// purpose: descriptions use them truthfully for underdrawing and for the
// photograph of the object itself.
const MEDIUM_FAMILIES = {
  oil: ['oil'],
  watercolor: ['watercolor', 'watercolour'],
  gouache: ['gouache'],
  pastel: ['pastel'],
  tempera: ['tempera'],
  fresco: ['fresco'],
  acrylic: ['acrylic'],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Singular and plural forms of a noun, via compromise (which handles irregular
// plurals such as leaf/leaves). The leading "the" gives the tagger enough
// context to treat a lone word as a noun. Cached: this runs per candidate.
const inflections = new Map();
function inflect(word) {
  if (!inflections.has(word)) {
    const forms = text => text.toLowerCase().replace(/^the\s+/, '');
    const singular = forms(nlp('the ' + word).nouns().toSingular().text()) || word;
    const plural = forms(nlp('the ' + singular).nouns().toPlural().text()) || singular;
    inflections.set(word, { singular, plural });
  }
  return inflections.get(word);
}

// The last word of a phrase, singularised: "black tricorn hats" → "hat".
function headNoun(phrase) {
  return inflect(String(phrase).trim().split(/\s+/).pop().toLowerCase()).singular;
}

// A regular expression matching a noun in singular or plural, as a whole word.
function nounPattern(noun) {
  const { singular, plural } = inflect(noun);
  return new RegExp('\\b(?:' + escapeRegExp(singular) + '|' + escapeRegExp(plural) + ')\\b', 'i');
}

// Does the text use the noun, singular or plural, as a whole word?
function mentions(text, noun) {
  return nounPattern(noun).test(text);
}

// Is the word mostly written with a capital letter mid-sentence? Then it is a
// name or a proper adjective ("Chinese", "Kew"), not a subject noun.
function mostlyCapitalised(descriptions, word) {
  const pattern = new RegExp('(?<![.!?]\\s)(?<!^)\\b' + escapeRegExp(word) + '\\b', 'gi');
  let upper = 0, total = 0;
  for (const d of descriptions) {
    for (const match of d.body.matchAll(pattern)) {
      total++;
      if (match[0][0] !== match[0][0].toLowerCase()) upper++;
    }
  }
  return total > 0 && upper / total > 0.5;
}

// Lower-case words of a string, used to compare names against the record.
function wordSet(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-zÀ-ɏ]{3,}/g) || []);
}

// Does the phrase end in a noun? Observation phrases are noun chunks, but their
// last word can still be an adjective or verb ("visible", "holding"). Tagging
// the whole phrase matters: alone, "coat" and "bridge" read as verbs.
function endsInNoun(phrase) {
  const last = nlp(phrase).terms().last();
  return last.has('#Noun') && !last.has('#Verb') && !last.has('#Adjective');
}

// ---------------------------------------------------------------------------
// Agreement: nouns most descriptions mention
// ---------------------------------------------------------------------------

// Candidate nouns come from observation phrases; each candidate is then
// re-counted against every description so that phrasing variants pool
// together and the count is a plain "N of M descriptions".
function computeAgreement(descriptions, observations, excludedWords) {
  const candidates = new Set();
  for (const [category, group] of Object.entries(observations || {})) {
    if (!SUBJECT_CATEGORIES.has(category)) continue;
    for (const entry of group.entries) {
      const noun = headNoun(entry.phrase);
      if (noun.length < 3 || noun.includes('-') || GENERIC_NOUNS.has(noun) || COLOUR_WORDS.has(noun) || excludedWords.has(noun)) continue;
      if (candidates.has(noun) || !endsInNoun(entry.phrase)) continue;
      candidates.add(noun);
    }
  }

  const terms = [];
  for (const noun of candidates) {
    if (mostlyCapitalised(descriptions, noun)) continue;
    const pattern = nounPattern(noun);
    const matching = descriptions.filter(d => pattern.test(d.body));
    if (matching.length < MIN_AGREEMENT_DESCRIPTIONS) continue;
    terms.push({
      term: noun,
      descriptions_count: matching.length,
      providers_count: new Set(matching.map(d => d.source)).size,
      annotation_ids: matching.map(d => d.id),
    });
  }
  terms.sort((a, b) => b.descriptions_count - a.descriptions_count
    || b.providers_count - a.providers_count || a.term.localeCompare(b.term));
  return terms.slice(0, MAX_AGREEMENT_TERMS);
}

// ---------------------------------------------------------------------------
// Mood: interpretive words, minus colour and tone
// ---------------------------------------------------------------------------

// Only single words: pattern phrases such as "sense of depth" or "quality of a
// study" are often spatial or technical rather than about mood.
function computeMood(moodPalette) {
  return (moodPalette || [])
    .filter(m => !m.phrase.includes(' ') && !TONAL_WORDS.has(m.phrase))
    .slice(0, MAX_MOOD_TERMS)
    .map(m => ({ phrase: m.phrase, descriptions_count: m.annotations_count, annotation_ids: m.annotation_ids }));
}

// ---------------------------------------------------------------------------
// Colour words: which colours the descriptions name
// ---------------------------------------------------------------------------

// Shown beside the image's measured palette. Counts descriptions, not
// mentions; a description saying "red coat, red sash" counts once for red.
function computeColourWords(descriptions) {
  return Object.keys(DESCRIBED_COLOURS)
    .map(colour => {
      const pattern = new RegExp('\\b(?:' + DESCRIBED_COLOURS[colour].join('|') + ')\\b', 'i');
      const ids = descriptions.filter(d => pattern.test(d.body)).map(d => d.id);
      return { word: colour, descriptions_count: ids.length, annotation_ids: ids };
    })
    .filter(c => c.descriptions_count > 0)
    .sort((a, b) => b.descriptions_count - a.descriptions_count || a.word.localeCompare(b.word))
    .slice(0, MAX_COLOUR_WORDS);
}

// ---------------------------------------------------------------------------
// Attention: descriptions touching each radar dimension
// ---------------------------------------------------------------------------

function computeAttention(coverageRadar) {
  if (!coverageRadar) return [];
  return coverageRadar.dimensions.map(d => {
    const ids = coverageRadar.outputs
      .filter(output => output.values[d.key].raw > 0)
      .map(output => output.annotation_id);
    return { key: d.key, label: d.label, descriptions_count: ids.length, annotation_ids: ids };
  });
}

// ---------------------------------------------------------------------------
// Distinctive: phrases that only one description uses
// ---------------------------------------------------------------------------

// phrasesByDescription maps annotation id → Set of extracted noun phrases.
// A phrase is distinctive when no other description uses it. Multi-word
// phrases are preferred because they carry more context ("naval officer").
function computeDistinctive(phrasesByDescription) {
  // Clean each description's phrases first, so "this striking self-portrait"
  // and "striking self-portrait" count as the same phrase.
  const cleaned = new Map();
  for (const [id, phrases] of phrasesByDescription) {
    cleaned.set(id, new Set([...phrases].map(stripLeadingFiller).filter(isDistinctiveCandidate)));
  }
  const usage = new Map();
  for (const phrases of cleaned.values()) {
    for (const phrase of phrases) usage.set(phrase, (usage.get(phrase) || 0) + 1);
  }
  const result = {};
  for (const [id, phrases] of cleaned) {
    const unique = [...phrases]
      .filter(p => usage.get(p) === 1)
      .sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
    if (unique.length) result[id] = unique.slice(0, MAX_DISTINCTIVE_PER_DESCRIPTION);
  }
  return result;
}

function stripLeadingFiller(phrase) {
  const words = phrase.split(/\s+/);
  while (words.length > 1 && LEADING_FILLER.has(words[0])) words.shift();
  return words.join(' ');
}

// A phrase worth showing: no digits, a concrete head noun, and single words
// long enough to be specific ("gear" is fine, "item" is not).
function isDistinctiveCandidate(phrase) {
  if (/\d/.test(phrase) || LEADING_FILLER.has(phrase)) return false;
  const head = headNoun(phrase);
  if (GENERIC_NOUNS.has(head)) return false;
  return endsInNoun(phrase) && (phrase.includes(' ') || phrase.length >= 4);
}

// ---------------------------------------------------------------------------
// Divergence: claims that differ from the museum record
// ---------------------------------------------------------------------------

// Words that identify the people the record already knows about: every
// recorded person's names, plus the object title (which often names a sitter).
function recordedNameWords(objectInfo) {
  const words = wordSet(objectInfo && objectInfo.title);
  for (const person of (objectInfo && objectInfo.people) || []) {
    for (const field of [person.name, person.displayname, person.alphasort]) {
      for (const word of wordSet(field)) words.add(word);
    }
  }
  return words;
}

// A capitalised name of two to four words straight after attribution wording:
// "by Edvard Munch", "attributed to Gilbert Stuart", "the painter John Peter
// Russell", "by Vincent van Gogh". Lower-case name particles are allowed.
const ATTRIBUTION_PATTERN = new RegExp(
  '\\b(?:by|attributed to|the work of|(?:artist|painter|printmaker|sculptor|photographer|engraver|illustrator|draftsman|draughtsman))'
  + '\\s+((?:\\p{Lu}[\\p{L}\'’-]+)(?:\\s+(?:(?:van|von|de|del|der|da|di|le|la|du)\\s+)?\\p{Lu}[\\p{L}\'’-]+){1,3})', 'gu');

// Capitalised words that make a "name" an institution, not a person.
const INSTITUTION_WORDS = new Set(['museum', 'museums', 'gallery', 'collection', 'university',
  'institute', 'foundation', 'library', 'company', 'studio', 'school', 'art', 'arts']);

// Person names in a description that share no word with the record, e.g. a
// description attributing the work to a different painter. Two detectors:
//  - compromise's people() tagger, limited to names starting with a first
//    name it knows. This keeps out phrases it mistakes for people ("Art
//    Style") but misses unfamiliar first names ("Edvard").
//  - ATTRIBUTION_PATTERN, which finds a name of any spelling after wording
//    such as "by" or "the artist". This catches "by the artist Edvard Munch".
function unrecordedNames(text, recordedWords) {
  const tagged = nlp(text).people().filter(match => match.terms().first().has('#FirstName')).out('array');
  const attributed = Array.from(text.matchAll(ATTRIBUTION_PATTERN), match => match[1]);
  const names = [...tagged, ...attributed]
    .map(name => name.replace(/['’]s$/, '').replace(/[^\p{L}\s'-]/gu, '').trim())
    .filter(name => name.split(/\s+/).length >= 2)
    .filter(name => ![...wordSet(name)].some(word => INSTITUTION_WORDS.has(word)));
  const unknown = names.filter(name => ![...wordSet(name)].some(word => recordedWords.has(word)));
  return [...new Set(unknown)];
}

// Media families the record mentions, from medium, technique and classification.
function recordedMedia(objectInfo) {
  const text = [objectInfo && objectInfo.medium, objectInfo && objectInfo.technique,
    objectInfo && objectInfo.classification].filter(Boolean).join(' ');
  return new Set(Object.keys(MEDIUM_FAMILIES)
    .filter(family => MEDIUM_FAMILIES[family].some(word => mentions(text, word))));
}

// Media families a description asserts that the record does not mention.
// Skipped entirely when the record has no medium information to compare with.
function unrecordedMedia(text, recorded) {
  if (!recorded.size) return [];
  return Object.keys(MEDIUM_FAMILIES).filter(family => !recorded.has(family)
    && MEDIUM_FAMILIES[family].some(word => mentions(text, word)));
}

// ---------------------------------------------------------------------------
// Titles a description gives that the record doesn't have
// ---------------------------------------------------------------------------
// "a painting titled "The Reader" by Pierre-Auguste Renoir": a confident,
// checkable claim. Tuned on 392 objects (see .plans/title-divergence.md):
//  - Only "titled"/"entitled" cue a title. "Called", "known as" and "named"
//    almost always introduce a term ("a script known as sōsho").
//  - Most other mismatches are text read off the image (a document heading,
//    an inscription in French). Those are left out when several descriptions
//    give the same title, allowing for spelling variants, or when the image's
//    OCR text contains most of its words.

const TITLE_CUE = /\b(?:titled|entitled)\s*[:,]?\s*/gi;
// A quoted or emphasised title: "The Reader", “The Reader”, *The Reader*.
const QUOTED_TITLE = /^\(?\s*(?:["“”'‘’]|\*{1,3}|_{1,2})([^"“”*_\n]{1,120}?)(?:["“”'‘’]|\*{1,3}|_{1,2})/;
// An unquoted title: a run of capitalised words, with short linking words.
const TITLE_CASE_RUN = /^((?:(?:The|A|An|La|Le|Les|Il|Der|Die|Das)\s+)?\p{Lu}[\p{L}'’-]*(?:\s+(?:of|the|a|an|and|in|on|at|with|de|la|le|du|des|von|van|to|for|&|\p{Lu}[\p{L}'’-]*))*)/u;
// Shared by more than this share of descriptions (and at least 3): text in the image.
const MAX_TITLE_SHARE = 0.1;
// Spelling variants count as the same title above this bigram similarity.
const SAME_TITLE_SIMILARITY = 0.7;
// A title is read off the image when OCR found at least this share of its words.
const MIN_TITLE_WORDS_READ = 0.5;

// Lower case, no accents or punctuation, no leading articles.
function titleKey(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\b(?:the|a|an|le|la|les|il|der|die|das)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Dice similarity of two strings' letter pairs: 1 for the same, ~0.7 for
// "modestia e vanita" and "modesta e vanita".
function similarity(a, b) {
  const pairs = s => { const t = s.replace(/\s/g, ''), out = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };
  const A = pairs(a), B = pairs(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const pool = [...B];
  let shared = 0;
  for (const pair of A) { const i = pool.indexOf(pair); if (i >= 0) { shared++; pool.splice(i, 1); } }
  return 2 * shared / (A.length + B.length);
}

// The titles a description gives, from its raw text (markdown emphasis kept,
// since *The Theatre Box* is a quoted title).
function claimedTitles(text) {
  const titles = [];
  for (const cue of String(text || '').matchAll(TITLE_CUE)) {
    const rest = text.slice(cue.index + cue[0].length, cue.index + cue[0].length + 140);
    const quoted = QUOTED_TITLE.exec(rest);
    const run = !quoted && TITLE_CASE_RUN.exec(rest);
    const title = quoted ? quoted[1] : run && run[1].split(/\s+/).length >= 2 ? run[1].replace(/\s+(?:by|in|from|of|and|the)$/i, '') : null;
    if (!title) continue;
    const clean = title.trim().replace(/[.,;:]$/, '');
    // Mostly letters, at least four of them: not "20/100" or "L.F".
    const letters = (clean.match(/\p{L}/gu) || []).length;
    if (letters >= 4 && letters / clean.replace(/\s/g, '').length >= 0.6) titles.push(clean);
  }
  return titles;
}

// Does a claimed title match one of the record's? Equal, one contains the
// other, the record title is a whole word of the claim ("Madonna: Sex" for
// "Sex"), or they're spelled closely. Each record title is also tried in parts
// split at brackets and colons: "Chief of the Dwarfs (Goojez Bashi)".
function isRecordedTitle(claim, recordTitles) {
  const c = titleKey(claim);
  if (!c) return true;
  for (const full of recordTitles) {
    const parts = [full, ...String(full || '').split(/[():;]|\bknown as\b/i)].map(titleKey).filter(Boolean);
    for (const r of parts) {
      if (c === r || (c.length >= 5 && r.includes(c)) || (r.length >= 5 && c.includes(r)) ||
          new RegExp('\\b' + escapeRegExp(r) + '\\b').test(c) || similarity(c, r) >= SAME_TITLE_SIMILARITY) return true;
    }
  }
  return false;
}

// Share of a title's words (3+ letters) that OCR also read, allowing misreadings.
function shareReadInImage(title, ocrWords) {
  const words = titleKey(title).split(' ').filter(w => w.length >= 3);
  if (!words.length || !ocrWords.length) return 0;
  return words.filter(w => ocrWords.some(o => o === w || similarity(o, w) >= 0.75)).length / words.length;
}

function computeDivergence(descriptions, objectInfo, ocrText) {
  const signals = [];
  const recordedWords = recordedNameWords(objectInfo);
  const media = recordedMedia(objectInfo);

  // A name that many descriptions share is usually text visible in the image
  // (a shop sign, an inscription), not a disagreement. Only names used by a
  // small minority of descriptions count as divergence.
  // Names are grouped by first word so that misreadings of the same sign
  // ("Horace S Ely", "Horace S Elv") count as one shared name.
  const nameKey = name => name.split(/\s+/)[0].toLowerCase();
  const namesById = new Map(descriptions.map(d => [d.id, unrecordedNames(d.body, recordedWords)]));
  const nameUsage = new Map();
  for (const names of namesById.values()) {
    for (const key of new Set(names.map(nameKey))) nameUsage.set(key, (nameUsage.get(key) || 0) + 1);
  }
  const maxNameUsage = Math.max(1, Math.floor(descriptions.length * MAX_NAME_SHARE));

  // Titles first: a wrong title is the most specific claim. A title shared
  // (with spelling variants) by many descriptions, or read by OCR, is text in
  // the image rather than a claim about what the work is called.
  const recordTitles = [objectInfo && objectInfo.title,
    ...((objectInfo && objectInfo.titles) || []).map(t => t.title)].filter(Boolean);
  if (recordTitles.length) {
    const ocrWords = [...new Set(titleKey(ocrText).split(' ').filter(w => w.length >= 3))];
    const titlesById = new Map(descriptions.map(d => [d.id, claimedTitles(d.raw || d.body)
      .filter(title => !isRecordedTitle(title, recordTitles))]));
    const maxTitleUsage = Math.max(2, Math.floor(descriptions.length * MAX_TITLE_SHARE));
    const all = [...titlesById.entries()].flatMap(([id, titles]) => titles.map(title => ({ id, key: titleKey(title) })));
    const usage = title => new Set(all.filter(t => similarity(t.key, titleKey(title)) >= SAME_TITLE_SIMILARITY).map(t => t.id)).size;
    for (const d of descriptions) {
      const titles = [...new Set(titlesById.get(d.id))].filter(title =>
        usage(title) <= maxTitleUsage && shareReadInImage(title, ocrWords) < MIN_TITLE_WORDS_READ);
      if (titles.length) signals.push({ kind: 'unrecorded_title', annotation_id: d.id, titles, record_title: recordTitles[0] });
    }
  }

  for (const d of descriptions) {
    const names = namesById.get(d.id).filter(name => nameUsage.get(nameKey(name)) <= maxNameUsage);
    if (names.length) signals.push({ kind: 'unrecorded_names', annotation_id: d.id, names });
    const claimed = unrecordedMedia(d.body, media);
    if (claimed.length) signals.push({ kind: 'unrecorded_medium', annotation_id: d.id, media: claimed,
      record_medium: (objectInfo && objectInfo.medium) || null });
  }

  // Length range: always informative when there are at least two descriptions.
  if (descriptions.length >= 2) {
    const byLength = [...descriptions].sort((a, b) => a.words - b.words);
    const shortest = byLength[0], longest = byLength[byLength.length - 1];
    if (shortest.words !== longest.words) {
      signals.push({ kind: 'length_range',
        shortest: { annotation_id: shortest.id, words: shortest.words },
        longest: { annotation_id: longest.id, words: longest.words } });
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {Object}   input
 * @param {Array}    input.descriptions   [{id, source, body, raw}] — body is plain text, non-empty;
 *                                       raw keeps markdown, for quoted titles
 * @param {Object}   input.observations   perspectives observations, by category
 * @param {Array}    input.moodPalette    perspectives mood palette
 * @param {Object}   input.coverageRadar  perspectives coverage radar
 * @param {Map}      input.phrasesByDescription  annotation id → Set of noun phrases
 * @param {Object}   input.objectInfo     HAM object record
 * @param {string}   input.ocrText        the image's OCR text, joined (optional)
 */
function computeOverview({ descriptions, observations, moodPalette, coverageRadar, phrasesByDescription, objectInfo, ocrText }) {
  const texts = descriptions.map(d => ({ ...d, words: d.body.split(/\s+/).filter(Boolean).length }));
  // Words from the classification ("Paintings", "Coins") describe the object
  // type, so they never headline agreement ("All 38 descriptions mention a coin").
  // Recorded names are excluded too: "gogh" is the artist, not the subject.
  const excludedWords = new Set([...wordSet(objectInfo && objectInfo.classification)].map(headNoun));
  for (const person of (objectInfo && objectInfo.people) || []) {
    for (const word of wordSet(person.name)) excludedWords.add(word);
  }
  return {
    descriptions_count: texts.length,
    providers_count: new Set(texts.map(d => d.source)).size,
    agreement: computeAgreement(texts, observations, excludedWords),
    mood: computeMood(moodPalette),
    colour_words: computeColourWords(texts),
    attention: computeAttention(coverageRadar),
    distinctive: computeDistinctive(phrasesByDescription || new Map()),
    divergence: computeDivergence(texts, objectInfo, ocrText),
  };
}

module.exports = { computeOverview, headNoun, mentions, nounPattern };
