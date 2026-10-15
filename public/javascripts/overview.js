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
//                media), plus the shortest and longest descriptions
//   record_match what the descriptions confirm in the record: title, medium,
//                object type, artist
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
  charcoal: ['charcoal'],
  graphite: ['graphite'],
  chalk: ['chalk'],
  engraving: ['engraving'],
  woodcut: ['woodcut'],
  lithograph: ['lithograph', 'lithography', 'lithographic'],
};

// Uses of a medium word that don't claim the work's medium: a color ("a
// charcoal-gray coat") or an underdrawing ("oil over a charcoal underdrawing").
// Removed from a description before its media are read.
const MEDIUM_WORDS_NOT_MEDIUM = new RegExp([
  '\\bcharcoal[\\s-]+(?:gr[ae]y|black|colou?red|tones?|hues?)\\b',
  '\\bchalk[\\s-]+white\\b',
  '\\bpastel[\\s-]+(?:tones?|colou?rs?|hues?|shades?|palette|tints?|[a-z]+ish|(?:[a-z]+-)?(?:gr[ae]y|blue|green|pink|yellow|purple|violet|orange|red|brown|lavender|peach|mint|beige|cream)s?)\\b',
  '\\b(?:charcoal|graphite|chalk)[\\s-]+under-?drawings?\\b',
].join('|'), 'gi');

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
    // Written as a name: every word capitalized, apart from particles ("van",
    // "de"). Keeps out phrases tagged as names, like "bob haircut".
    .filter(name => name.split(/\s+/).every(w => /^\p{Lu}/u.test(w) || /^(?:van|von|de|del|der|da|di|le|la|du)$/.test(w)))
    .filter(name => ![...wordSet(name)].some(word => INSTITUTION_WORDS.has(word)));
  const unknown = names.filter(name => ![...wordSet(name)].some(word => recordedWords.has(word)));
  return [...new Set(unknown)];
}

// Record wording that names a family without its word: "opaque watercolor"
// is gouache, "wood engraving" and "woodblock" are woodcut-like. Gouache is a
// watercolor, so a gouache record also covers "watercolor".
const RECORD_SYNONYMS = {
  gouache: ['opaque watercolor', 'opaque watercolour', 'bodycolor', 'bodycolour', 'body color'],
  woodcut: ['wood engraving', 'woodblock', 'wood block'],
  // East Asian "ink and color" painting is a water-based color, like watercolor.
  watercolor: ['ink and color', 'ink and light color', 'light color'],
  fresco: ['pigment on plaster', 'on plaster'],
};
const RECORD_IMPLIES = { gouache: ['watercolor'] };

// Media families the record mentions, from medium, technique and classification.
function recordedMedia(objectInfo) {
  const text = [objectInfo && objectInfo.medium, objectInfo && objectInfo.technique,
    objectInfo && objectInfo.classification].filter(Boolean).join(' ');
  const found = new Set(Object.keys(MEDIUM_FAMILIES).filter(family =>
    MEDIUM_FAMILIES[family].concat(RECORD_SYNONYMS[family] || []).some(word => mentions(text, word))));
  for (const family of [...found]) for (const implied of RECORD_IMPLIES[family] || []) found.add(implied);
  return found;
}

// A medium word only counts as a claim when the description says the work
// *is* that medium. Tuned on 392 objects: most bare mentions were hedges
// ("charcoal or graphite"), comparisons ("reminiscent of Renaissance
// frescoes") or underdrawings, not claims.
//
// Claim shapes, around a medium word X:
const WORK_NOUN = '(?:drawing|print|painting|sketch|study|studies|work|piece|image|artwork|portrait|landscape|composition|illustration|impression|rendering|plate|sheet|mural|panel|scene)';
const MEDIUM_CLAIMS = [
  // "a charcoal drawing", "this oil painting"
  { before: /\b(?:a|an|this|the)\s+(?:[\w-]+\s+){0,2}$/i, after: new RegExp('^\\s+' + WORK_NOUN + '\\b', 'i') },
  // "charcoal on paper", "oil on canvas"
  { after: /^\s+(?:on|over)\s+(?:[\w-]+\s+){0,2}(?:paper|canvas|panel|board|vellum|parchment|silk|card|cardboard|wood|linen)\b/i },
  // "drawn in charcoal", "rendered with black chalk", "printed using lithography"
  { before: /\b(?:rendered|executed|drawn|painted|done|made|created|worked|printed|sketched|produced|applied)\s+(?:in|with|using)\s+(?:[\w-]+\s+){0,3}$/i },
  // For media that are also kinds of work: "a woodcut of a ship", "this
  // engraving", "appears to be a lithograph".
  { before: /\b(?:a|an|this|the|is|was|appears\s+to\s+be|seems\s+to\s+be)\s+(?:[\w-]+\s+){0,2}$/i, nounOnly: true },
  // "the medium is charcoal"
  { before: /\bmedium\s*(?:is|:|appears\s+to\s+be)\s*(?:[\w-]+\s+){0,3}$/i },
];
// Families whose word is also a kind of work: "this engraving", "a watercolor".
const MEDIUM_NOUNS = new Set(['watercolor', 'gouache', 'pastel', 'fresco', 'engraving', 'woodcut', 'lithograph']);
// Not claims: comparisons and references before the word, "-like" after it,
// and hedges with "or" on either side.
// "for a ceiling fresco" says what a drawing was made for, not what it is.
const MEDIUM_COMPARISON = /\b(?:like|reminiscent|resembl\w*|in\s+the\s+(?:manner|style|tradition)\s+of|similar\s+to|evok\w*|imitat\w*|mimic\w*|recall\w*|echo\w*|after|inspired\s+by|akin\s+to|as\s+in|for\s+(?:a|an|the))\b[^.;:]{0,40}$/i;
const MEDIUM_SUFFIX = /^[\s-]*(?:like|esque|style|inspired)\b/i;
const MEDIUM_HEDGE_BEFORE = /\bor\s+(?:[\w-]+\s+){0,2}$/i;
const MEDIUM_HEDGE_AFTER = /^(?:[\s,]+[\w-]+){0,2}[\s,]+or\b/i;

// The media families a description claims for the work.
function claimedMedia(text) {
  const body = String(text || '').replace(MEDIUM_WORDS_NOT_MEDIUM, ' ');
  const claimed = new Set();
  for (const [family, words] of Object.entries(MEDIUM_FAMILIES)) {
    for (const word of words) {
      for (const m of body.matchAll(new RegExp('\\b' + escapeRegExp(word) + '(?:s|es)?\\b', 'gi'))) {
        const before = body.slice(Math.max(0, m.index - 60), m.index);
        const after = body.slice(m.index + m[0].length, m.index + m[0].length + 50);
        if (MEDIUM_COMPARISON.test(before) || MEDIUM_SUFFIX.test(after)) continue;
        if (MEDIUM_HEDGE_BEFORE.test(before) || MEDIUM_HEDGE_AFTER.test(after)) continue;
        const isClaim = MEDIUM_CLAIMS.some(shape =>
          (!shape.nounOnly || MEDIUM_NOUNS.has(family)) &&
          (!shape.before || shape.before.test(before)) &&
          (!shape.after || shape.after.test(after)));
        if (isClaim) claimed.add(family);
      }
    }
  }
  return claimed;
}

// Print techniques are only compared on prints: on silver or a coin,
// "engraving" is how the object is decorated, not what kind of print it is.
const PRINT_FAMILIES = new Set(['engraving', 'woodcut', 'lithograph']);
const PRINT_RECORD = /\b(?:prints?|etching|engraving|woodcut|wood engraving|lithograph\w*|aquatint|mezzotint|drypoint|screenprint|intaglio|linocut|photomechanical)\b/i;

// Media families a description claims that the record does not mention.
// Skipped when the record has no medium information to compare with.
function unrecordedMedia(text, recorded, objectInfo) {
  const record = [objectInfo && objectInfo.medium, objectInfo && objectInfo.technique,
    objectInfo && objectInfo.classification].filter(Boolean).join(' ');
  if (!recorded.size && !(objectInfo && (objectInfo.medium || objectInfo.technique))) return [];
  const isPrint = PRINT_RECORD.test(record);
  return [...claimedMedia(text)].filter(family => !recorded.has(family) && (isPrint || !PRINT_FAMILIES.has(family)));
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
  // Names the image's OCR also read are printed on the work (an engraver's
  // line in a caption): reading them isn't a claim.
  const ocrWords = [...new Set(titleKey(ocrText).split(' ').filter(w => w.length >= 3))];
  const nameKey = name => name.split(/\s+/)[0].toLowerCase();
  const namesById = new Map(descriptions.map(d => [d.id, unrecordedNames(d.body, recordedWords)
    .filter(name => shareReadInImage(name, ocrWords) < MIN_TITLE_WORDS_READ)]));
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
    const claimed = unrecordedMedia(d.body, media, objectInfo);
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
// ---------------------------------------------------------------------------
// Record match: what the descriptions confirm in the museum record
// ---------------------------------------------------------------------------
// The other half of divergence: per record field, the descriptions that agree
// with it, and the ones that disagree. Fields that can be seen in the image
// come first (title subject, medium, object type), then context (artist).
// Agreement is matched loosely (a mention counts); disagreement reuses the
// divergence signals, which only count claims.

// Words in a record medium that name a support or a quality, not a medium:
// "Ink and light color on cream antique laid paper" → ink.
const MEDIUM_FILLER = new Set(['and', 'with', 'on', 'over', 'in', 'of', 'the', 'a', 'light', 'dark',
  'transparent', 'opaque', 'black', 'white', 'brown', 'red', 'gray', 'grey', 'blue', 'green', 'yellow',
  'gold', 'silver', 'cream', 'off', 'colored', 'coloured', 'touches', 'traces', 'album', 'leaf']);
// Kinds of work a description may call an object, for "37 call it a painting".
const WORK_TYPES = ['painting', 'drawing', 'print', 'photograph', 'collage', 'sculpture', 'engraving',
  'etching', 'woodcut', 'lithograph', 'watercolor', 'manuscript', 'scroll', 'vessel', 'vase', 'bowl',
  'coin', 'medal', 'textile', 'tapestry', 'book', 'poster', 'sketch'];
// Kinds of a type that count as that type: an engraving is a print.
const TYPE_KINDS = {
  print: ['engraving', 'etching', 'woodcut', 'lithograph', 'aquatint', 'mezzotint', 'screenprint', 'impression'],
  drawing: ['sketch', 'study'],
  photograph: ['photo', 'gelatin silver print'],
  painting: ['watercolor', 'oil painting'],
};
// Roles of people the record credits with making the work.
const MAKER_ROLE = /artist|printmaker|author|maker|painter|photographer|calligrapher|designer|sculptor|engraver|draftsman|draughtsman|illustrator|potter|manufacturer|workshop|studio/i;

const plainText = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const idsWhere = (descriptions, test) => descriptions.filter(test).map(d => d.id);

// The title's subject: its nouns, minus generic words ("Untitled [with Anna
// May Wong]" → Anna May Wong). The noun most descriptions mention leads.
function titleSubject(title, descriptions) {
  const doc = nlp(String(title || '').replace(/[[\]()]/g, ' '));
  // A person's name ("Anna May Wong") is matched as a whole. Titles are in
  // Title Case, so capitals alone don't mark a name: "Young Rabbit" isn't one.
  const people = doc.people().out('array').map(n => n.replace(/[^\p{L}\s'’-]/gu, '').trim()).filter(n => n.split(/\s+/).length > 1);
  const nouns = doc.nouns().out('array')
    .map(chunk => chunk.replace(/^(?:the|a|an|with|at)\s+/i, '').replace(/[^\p{L}\s'’-]/gu, '').trim())
    .filter(chunk => chunk && !people.some(p => chunk.includes(p) || p.includes(chunk)))
    .map(chunk => headNoun(chunk.replace(/['’]s$/, '')));
  const subjects = [
    ...people.map(name => ({ term: name, test: text => new RegExp('\\b' + escapeRegExp(plainText(name)) + '\\b', 'i').test(plainText(text)) })),
    ...nouns.map(head => ({ term: head, test: text => mentions(text, head) })),
  ].filter(s => s.term.length > 2 && !GENERIC_NOUNS.has(s.term.toLowerCase()) && s.term.toLowerCase() !== 'untitled');
  return subjects.map(s => ({ term: s.term, annotation_ids: idsWhere(descriptions, d => s.test(d.body)) }))
    .sort((a, b) => b.annotation_ids.length - a.annotation_ids.length)[0] || null;
}

// The record medium's first medium word: "Oil on canvas" → oil.
// Segments after a semicolon are tried too: "Album leaf; ink and light color
// on paper" → ink.
function mainMediumWord(medium) {
  for (const segment of String(medium || '').split(/;|\//)) {
    const before = segment.split(/\s+on\s+/i)[0];
    const words = before.toLowerCase().match(/[\p{L}-]+/gu) || [];
    const word = words.find(w => w.length > 2 && !MEDIUM_FILLER.has(w));
    if (word) return word;
  }
  return null;
}

// A person's surname as a description would write it: "Renoir, Pierre-
// Auguste" → Renoir; "Le Brun, Charles" → Le Brun; "Kawasaki, Shōko" → Kawasaki.
function surnameOf(person) {
  const sort = person.alphasort || '';
  if (sort.includes(',')) return sort.split(',')[0].trim();
  return String(person.displayname || person.name || '').trim().split(/\s+/).pop();
}

function computeRecordMatch(descriptions, objectInfo, divergence, ocrText) {
  const info = objectInfo || {};
  const rows = [];
  const signalsOf = kind => divergence.filter(s => s.kind === kind);

  // Title: descriptions naming its subject, and descriptions giving the title.
  if (info.title) {
    const recordTitles = [info.title, ...(info.titles || []).map(t => t.title)].filter(Boolean);
    const given = idsWhere(descriptions, d => claimedTitles(d.raw || d.body).some(t => isRecordedTitle(t, recordTitles)));
    const other = signalsOf('unrecorded_title');
    rows.push({ field: 'title', value: info.title, subject: titleSubject(info.title, descriptions),
      given_ids: given, other_titles: other.map(s => ({ annotation_id: s.annotation_id, titles: s.titles })) });
  }

  // Medium: descriptions mentioning the record's main medium word; media
  // claimed against the record disagree.
  const word = mainMediumWord(info.medium);
  if (word) {
    const disagree = {};
    for (const s of signalsOf('unrecorded_medium')) for (const m of s.media) (disagree[m] = disagree[m] || []).push(s.annotation_id);
    rows.push({ field: 'medium', value: info.medium, term: word,
      annotation_ids: idsWhere(descriptions, d => mentions(d.body, word)),
      others: Object.entries(disagree).map(([medium, ids]) => ({ term: medium, annotation_ids: ids }))
        .sort((a, b) => b.annotation_ids.length - a.annotation_ids.length) });
  }

  // Object type: descriptions using the record's type; the type most of the
  // others use instead ("37 call it a painting" for an album leaf).
  const type = (info.worktypes || [])[0] && info.worktypes[0].worktype;
  if (type) {
    const kinds = [type, ...(TYPE_KINDS[type.toLowerCase()] || [])];
    const uses = text => kinds.some(k => k.split(/\s+/).length > 1
      ? new RegExp('\\b' + escapeRegExp(k) + 's?\\b', 'i').test(text) : mentions(text, k));
    const agreeing = idsWhere(descriptions, d => uses(d.body));
    const instead = WORK_TYPES.filter(t => !kinds.some(k => k.toLowerCase().includes(t)))
      .map(t => ({ term: t, annotation_ids: idsWhere(descriptions, d => !uses(d.body) && mentions(d.body, t)) }))
      .sort((a, b) => b.annotation_ids.length - a.annotation_ids.length)[0];
    rows.push({ field: 'object_type', value: type, annotation_ids: agreeing,
      instead: instead && instead.annotation_ids.length ? instead : null });
  }

  // Artist: descriptions naming a recorded maker's surname. Noted when the
  // name is printed on the work (OCR read it), so naming it is reading it.
  const makers = (info.people || []).filter(p => !p.role || MAKER_ROLE.test(p.role));
  if (makers.length) {
    const surnames = [...new Set(makers.map(surnameOf).filter(n => n && n.length > 2))];
    const named = idsWhere(descriptions, d => surnames.some(n => new RegExp('\\b' + escapeRegExp(plainText(n)) + '\\b', 'i').test(plainText(d.body))));
    const ocr = plainText(ocrText).toLowerCase();
    rows.push({ field: 'artist', value: makers.map(p => p.displayname || p.name).join('; '), annotation_ids: named,
      in_image: surnames.some(n => ocr.includes(plainText(n).toLowerCase())),
      others: signalsOf('unrecorded_names').map(s => ({ annotation_id: s.annotation_id, names: s.names })) });
  }
  return { rows };
}

function computeOverview({ descriptions, observations, moodPalette, coverageRadar, phrasesByDescription, objectInfo, ocrText }) {
  const texts = descriptions.map(d => ({ ...d, words: d.body.split(/\s+/).filter(Boolean).length }));
  // Words from the classification ("Paintings", "Coins") describe the object
  // type, so they never headline agreement ("All 38 descriptions mention a coin").
  // Recorded names are excluded too: "gogh" is the artist, not the subject.
  const excludedWords = new Set([...wordSet(objectInfo && objectInfo.classification)].map(headNoun));
  for (const person of (objectInfo && objectInfo.people) || []) {
    for (const word of wordSet(person.name)) excludedWords.add(word);
  }
  const divergence = computeDivergence(texts, objectInfo, ocrText);
  return {
    descriptions_count: texts.length,
    providers_count: new Set(texts.map(d => d.source)).size,
    agreement: computeAgreement(texts, observations, excludedWords),
    mood: computeMood(moodPalette),
    colour_words: computeColourWords(texts),
    attention: computeAttention(coverageRadar),
    distinctive: computeDistinctive(phrasesByDescription || new Map()),
    divergence,
    record_match: computeRecordMatch(texts, objectInfo, divergence, ocrText),
  };
}

module.exports = { computeOverview, headNoun, mentions, nounPattern };
