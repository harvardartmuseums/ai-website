'use strict';

var nlp = require('compromise');
var _ = require('lodash');
var stopwords = require('../vocabularies/stopwords');
var MODELS = require('../../models');

// ---------------------------------------------------------------------------
// Versioned config — bump algorithm_version on any change (see semver rules
// in the plan: patch for list changes, minor for scoring/threshold changes,
// major for schema/NLP backend changes).
// ---------------------------------------------------------------------------

const ALGORITHM_VERSION = 'ace-v1.6.1';

const CONFIG = {
  min_services:                2,
  min_annotations:             3,
  top_N:                       15,
  max_divergence:              5,
  S_cap:                       5,
  A_cap:                       20,
  w_services:                  0.6,
  w_annotations:               0.4,
  people_services_min:         2,
  people_annotations_min:      3,
  strong_people_services:      3,
  strong_people_annotations:   5,
  stronger_norm_services_min:  0.6,
  stronger_norm_annotations_min: 0.5,
  // Thematic extraction (LLM descriptions only)
  thematic_min_sources:        2,   // distinct AI providers that must mention the term
  thematic_min_descriptions:   3,   // total description annotations that must mention it
  thematic_top_N:              15,
  thematic_S_cap:              9,   // distinct LLM providers in the dataset
  // Observations (what the AIs noticed)
  observations_max_per_category: 25,
  observations_max_phrase_tokens: 5,
  // Mood palette
  mood_max: 20,
};

// Terms suppressed before any concept is emitted.
const IGNORE_LIST = new Set([
  'artwork','picture','illustration','image','painting','drawing','photograph',
  'background','foreground','scene','composition','detail','view','subject',
  'work','canvas','piece','photo','depiction','representation','color','colour',
  'light','shadow','texture','surface','figure',
  // evaluative / subjective
  'beautiful','ugly','boring','stunning','interesting','typical','unusual',
  'nice','great','good','bad','old','new',
]);

// Short tokens (< 3 chars) that are domain-meaningful and should be kept.
const SHORT_TOKEN_ALLOWLIST = new Set([
  'ox','ax','urn','war','sky','arc','bow','nun','orb','god',
]);

// Concepts whose concept_type is "interpretive" rather than "descriptive".
const INTERPRETIVE_TERMS = new Set([
  'portrait','self-portrait','group portrait','figure study','landscape',
  'still life','genre scene','history painting','allegory','vanitas','tondo',
  'altarpiece','narrative scene','devotional image',
]);

// People-related terms used for depicts_people inference.
// `god` is also in SHORT_TOKEN_ALLOWLIST (extraction stage); here it operates
// at the labeling stage (people_related = true). Sequential, non-conflicting.
const PEOPLE_LEXICON = new Set([
  'man','woman','boy','girl','child','person','figure','figures','people',
  'crowd','group of people','family','soldier','soldiers','bather','bathers',
  'nude','pilgrim','peasant','peasants','merchant',
  'portrait','self-portrait','group portrait','figure study',
  'saint','apostle','angel','angels','madonna','christ','deity','goddess',
  'buddha','bodhisattva','prophet','martyr','evangelist','god',
  // Body-part terms from region detection (Clarifai)
  'human face','human arm','human eye','human nose','human head',
  'human hair','human leg','human mouth','human hand','human ear',
  'human foot','human beard',
  // Age/gender terms from region detection (AWS)
  'adult','male','female','baby','teen','bride',
]);

// ---------------------------------------------------------------------------
// Mood palette — seed vocabulary for expressive/interpretive language.
// Two-part: (1) single-word adjectives that express mood, atmosphere, or
// emotional register; (2) pattern prefixes that signal interpretive phrasing
// when followed by a noun ("sense of X", "feeling of X", etc.).
// ---------------------------------------------------------------------------

const MOOD_SEEDS = new Set([
  // Atmosphere & tone
  'serene','tranquil','peaceful','calm','still','quiet','hushed','gentle',
  'somber','solemn','melancholy','mournful','elegiac','wistful','pensive',
  'contemplative','meditative','reflective','introspective',
  'dramatic','theatrical','intense','powerful','forceful','dynamic','energetic',
  'turbulent','chaotic','violent','aggressive','fierce','stormy',
  'mysterious','enigmatic','cryptic','eerie','uncanny','haunting','otherworldly',
  'dreamlike','surreal','fantastical','ethereal','spectral',
  'intimate','tender','delicate','vulnerable','fragile','soft',
  'monumental','imposing','majestic','grandiose','awe-inspiring','sublime',
  'austere','stark','severe','restrained','minimal','sparse',
  'lush','opulent','lavish','sumptuous','abundant','rich',
  'playful','whimsical','lighthearted','humorous','witty','ironic',
  'sensual','erotic','voluptuous',
  'sacred','devotional','spiritual','transcendent','reverent','divine',
  'nostalgic','sentimental','bittersweet','longing',
  'ominous','foreboding','menacing','threatening','sinister','dark',
  'triumphant','heroic','victorious','celebratory','joyful','jubilant','exuberant',
  'tragic','sorrowful','grieving','despairing','anguished',
  'dignified','noble','regal','stately','formal','ceremonial',
  'rustic','pastoral','idyllic','bucolic',
  'desolate','bleak','barren','lonely','isolated','solitary',
  'luminous','radiant','glowing','shimmering','dappled',
  'muted','subdued','understated','restrained','mystical','beautiful serene','cheerful',
  'pleasant','elegant','stressful','suspenseful','seductive','vibrant','colorful',
  'worshipful','lustrous','prayerful','artful','grotesque','masterful','provocative',
  'vibrant intense','thoughtful intimate','vibrant feel','elegant refined','delightful',
  'respectful','elegant poised','vibrant surreal','thoughtful serene','magical','graceful',
  'vibrant artistic','vibrant festive','serious solemn','anxious','creative'
]);

const MOOD_PATTERN_PREFIXES = [
  'sense of','feeling of','atmosphere of','mood of','tone of',
  'air of','quality of','aura of','spirit of','impression of',
  'evokes','suggests','conveys','radiates','emanates','exudes',
  'creates a','projects a','imbued with','suffused with','charged with',
];

// Additional ignore list for thematic extraction — positional, dimensional, and
// colour-adjacent words that pass the general stopwords filter but carry no
// thematic meaning when appearing in isolation.
const THEMATIC_IGNORE = new Set([
  // positional / compositional
  'left','right','center','centre','upper','lower','top','bottom','middle',
  'front','back','side','foreground','background','corner','edge',
  // vague size / amount
  'large','small','long','short','high','low','wide','narrow','dark','light',
  'bright','deep','rich','full','open','close','closed',
  // temporal (non-thematic usage)
  'early','late','recent','ancient','modern','contemporary',
  // generic action / state
  'appears','seems','shows','depicts','features','includes','contains',
  'creates','makes','gives','takes','stands','sits','holds','looks','seen',
  // meta-description
  'artwork','image','painting','drawing','print','figure','composition',
  'scene','detail','style','work','piece','object','form','use','way','part',
]);

// Pairs of semantically incompatible concepts (cross-service divergence).
// Add pairs as encountered during pilot review; keep phrasing close to what
// AI services actually produce so matches fire in practice.
const INCOMPATIBILITY_LIST = [
  // Setting
  ['indoor', 'outdoor'],
  ['interior', 'exterior'],
  ['urban', 'rural'],
  ['domestic', 'public'],
  ['sacred', 'secular'],
  ['natural', 'architectural'],

  // Light and time
  ['day', 'night'],
  ['daytime', 'nighttime'],
  ['summer', 'winter'],
  ['spring', 'autumn'],

  // Figure and subject
  ['man', 'woman'],
  ['boy', 'girl'],
  ['nude', 'clothed'],
  ['standing', 'seated'],
  ['single figure', 'group'],
  ['living', 'dead'],
  ['human', 'animal'],

  // Mood and register
  ['joyful', 'somber'],
  ['calm', 'turbulent'],
  ['sacred', 'profane'],
  ['celebratory', 'mournful'],

  // Genre
  ['portrait', 'landscape'],
  ['portrait', 'figure study'],
  ['religious', 'secular'],
  ['mythological', 'historical'],
  ['narrative', 'devotional'],

  // Medium and technique (where services guess)
  ['oil', 'watercolor'],
  ['drawing', 'print'],

  // Compositional
  ['horizontal', 'vertical'],
  ['symmetrical', 'asymmetrical'],
  ['crowded', 'empty'],

  // Color
  ['monochrome', 'color'],
  ['monochrome', 'colour'],
  ['abstract', 'figurative'],
];

// ---------------------------------------------------------------------------
// Synonym map — canonical term → array of variant terms that should be treated
// as equivalent. Conservative: only merge where the distinction genuinely
// doesn't matter for cataloguing. Extend during quarterly config review.
// ---------------------------------------------------------------------------

const SYNONYM_MAP = {
  // Vessels and containers
  'vessel':       ['vase', 'urn', 'jar', 'jug', 'pitcher', 'pot', 'bowl', 'flask', 'amphora', 'chalice', 'goblet', 'cup'],
  // Textiles and drapery
  'drapery':      ['drape', 'curtain', 'cloth', 'fabric', 'textile', 'garment', 'robe', 'cloak', 'mantle', 'veil'],
  // Headwear
  'hat':          ['cap', 'bonnet', 'helmet', 'headdress', 'crown', 'turban', 'hood'],
  // Weapons
  'weapon':       ['sword', 'spear', 'lance', 'dagger', 'knife', 'bow', 'arrow', 'shield', 'axe', 'mace'],
  // Religious halo
  'halo':         ['nimbus', 'aureole', 'glory', 'mandorla'],
  // Seated figure
  'seated':       ['sitting', 'enthroned', 'seated figure'],
  // Standing figure
  'standing':     ['upright', 'standing figure', 'erect'],
  // Group of people
  'group':        ['crowd', 'gathering', 'assembly', 'multitude', 'congregation', 'procession', 'throng'],
  // Landscape features
  'tree':         ['trees', 'foliage', 'branches', 'trunk', 'shrub', 'bush', 'grove', 'forest', 'woodland'],
  'water':        ['river', 'stream', 'lake', 'pond', 'pool', 'sea', 'ocean', 'waves', 'waterway'],
  'mountain':     ['hill', 'hills', 'mountains', 'peak', 'cliff', 'rock', 'rocks', 'rocky', 'terrain'],
  'sky':          ['clouds', 'cloud', 'heavens', 'firmament'],
  // Architectural elements
  'arch':         ['arches', 'arcade', 'archway', 'vault', 'vaulting'],
  'column':       ['columns', 'pillar', 'pillars', 'colonnade'],
  'window':       ['windows', 'aperture', 'opening'],
  // Animals
  'horse':        ['equine', 'steed', 'mare', 'stallion', 'horses'],
  'dog':          ['hound', 'dogs', 'canine'],
  'bird':         ['birds', 'fowl', 'dove', 'eagle', 'hawk', 'swan'],
  // Colour modifiers
  'golden':       ['gold', 'gilt', 'gilded', 'aureate'],
  // Vegetation
  'flower':       ['flowers', 'floral', 'bloom', 'blossom', 'bouquet', 'wreath', 'garland'],
  'fruit':        ['fruits', 'grapes', 'apple', 'pear', 'pomegranate', 'lemon', 'orange'],
  // Book / writing
  'book':         ['books', 'manuscript', 'scroll', 'text', 'inscription', 'tablet'],
  // Cross / crucifix
  'cross':        ['crucifix', 'cruciform'],
  // Light source
  'candle':       ['candles', 'candlestick', 'torch', 'flame', 'lamp', 'lantern'],
};

// Inverted lookup: variant → canonical, built once at load time.
const TERM_TO_CANONICAL = new Map();
// Forward lookup: canonical → all surface forms (for snippet matching).
const CANONICAL_TO_FORMS = new Map();
for (const [canonical, variants] of Object.entries(SYNONYM_MAP)) {
  CANONICAL_TO_FORMS.set(canonical, [canonical, ...variants]);
  for (const variant of variants) {
    TERM_TO_CANONICAL.set(variant, canonical);
  }
}

// ---------------------------------------------------------------------------
// Observation categories — seed words for classification.
// Each phrase is checked token-by-token against each category's set;
// first match wins. PEOPLE_LEXICON is used for 'people' to stay in sync.
// ---------------------------------------------------------------------------

const OBSERVATION_CATEGORIES = [
  {
    key:   'people',
    label: 'People & Figures',
    seeds: PEOPLE_LEXICON,  // reuse existing set
  },
  {
    key:   'animals',
    label: 'Animals & Creatures',
    seeds: new Set([
      'horse','horses','equine','steed','mare','stallion',
      'dog','dogs','hound','canine','dalmatian','dachshund',
      'cat','lion','lioness','tiger','leopard','panther','carnivore',
      'deer','stag','doe','elk','antelope','giraffe','zebra',
      'bird','birds','fowl','dove','eagle','hawk','swan','owl','parrot','peacock','crane','heron',
      'sparrow','falcon','goose','duck','turkey','penguin','ostrich','chicken',
      'fish','dolphin','whale','serpent','snake','dragon','shark','goldfish',
      'lamb','sheep','goat','ram','ox','bull','cow','cattle','pig','mule',
      'rabbit','hare','monkey','ape','giant panda','kangaroo','rhinoceros',
      'elephant','camel','bear','wolf','fox','rat','mouse',
      'griffin','phoenix','unicorn','sphinx','centaur','dinosaur',
      'insect','bee','honey bee','spider','butterfly','beetle','caterpillar','snail',
      'lobster','turtle','tortoise','frog','lizard','crocodile',
      'jellyfish','seahorse','shellfish','oyster',
      'mammal','marine mammal','marine invertebrates','invertebrate','reptile',
      'beast','creature','animal','animals',
    ]),
  },
  {
    key:   'action',
    label: 'Action & Gesture',
    seeds: new Set([
      'holding','carrying','standing','seated','sitting','kneeling','lying',
      'reaching','pointing','gesturing','gazing','looking','watching','walking',
      'running','riding','fighting','praying','embracing','raising','extending',
      'turning','bowing','leaning','reclining','enthroned','blessing','offering',
      'striking','falling','fleeing','ascending','descending','draped','veiled',
    ]),
  },
  {
    key:   'objects',
    label: 'Objects & Artefacts',
    seeds: new Set([
      'vessel','vase','urn','jar','jug','pitcher','bowl','cup','chalice','goblet',
      'flask','amphora','basket','box','chest','casket','bag','sack',
      'sword','spear','lance','dagger','knife','axe','shield','bow','arrow','mace','weapon',
      'gun','rifle','cannon','grenade',
      'book','manuscript','scroll','tablet','inscription','letter','document',
      'cross','crucifix','halo','nimbus','aureole','mandorla',
      'crown','sceptre','orb','throne','altar','reliquary','icon','triptych',
      'hat','cap','bonnet','helmet','headdress','turban','hood',
      'clothing','footwear','shoe','dress','suit','coat','jacket','shirt',
      'jeans','skirt','glove','belt','scarf',
      'candle','candlestick','torch','lamp','lantern','flame',
      'mirror','clock','hourglass','skull','globe','map','coin','ring','jewel',
      'necklace','bracelet','earrings','locket',
      'table','chair','bench','bed','cradle','curtain','drapery','cloth','fabric',
      'column','arch','window','door','frame','niche','pedestal',
      'ship','boat','cart','chariot','wheel','car','vehicle','bicycle','motorcycle',
      'airplane','train','truck','bus','helicopter',
      'bottle','plate','spoon','fork','teapot','saucer','platter',
      'sculpture','bust','doll','toy','balloon','flag',
      'musical instrument','guitar','piano','violin','drum','harp',
      'umbrella','glasses','sunglasses','camera','pen',
      'rug','furniture','shelf','desk','couch','stool','pillow',
    ]),
  },
  {
    key:   'setting',
    label: 'Setting & Space',
    seeds: new Set([
      'landscape','interior','exterior','indoor','outdoor','garden','courtyard',
      'church','cathedral','chapel','temple','palace','castle','tower','hall',
      'room','chamber','alcove','niche','loggia','portico','arcade',
      'forest','woodland','grove','meadow','field','hillside','valley','plain',
      'river','lake','sea','ocean','shore','coast','harbour','bridge',
      'street','road','path','staircase','archway','gate','wall',
      'sky','cloud','horizon','distance','background','architectural',
      'urban','rural','domestic','sacred','secular','night','day',
      // Buildings and structures from region detection
      'house','building','skyscraper','office building','lighthouse','porch',
      'fireplace','fountain','swimming pool','stairs',
      // Vegetation (spatially grounded)
      'tree','plant','flower','houseplant','palm tree','flowerpot',
    ]),
  },
  {
    key:   'colour_light',
    label: 'Colour & Light',
    seeds: new Set([
      'red','blue','green','yellow','orange','purple','violet','pink',
      'white','black','grey','gray','brown','gold','golden','silver',
      'dark','pale','vivid','muted','warm','cool','saturated',
      'gilded','gilt','aureate','monochrome',
      'light','shadow','shade','highlight','glow','radiance','illumination',
      'sunlight','candlelight','reflected light','chiaroscuro',
    ]),
  },
  {
    key:   'material_technique',
    label: 'Material & Technique',
    seeds: new Set([
      'oil','watercolour','watercolor','tempera','fresco','gouache','pastel',
      'ink','charcoal','pencil','chalk','engraving','etching','woodcut','lithograph',
      'bronze','marble','terracotta','ceramic','porcelain','ivory','wood','stone',
      'silk','linen','canvas','panel','parchment','vellum','paper','metal',
      'gilding','glaze','impasto','wash','hatching','crosshatching',
      'carved','cast','modelled','painted','drawn','printed','woven','embroidered',
    ]),
  },
];

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function stripMarkdown(str) {
  return str
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`]*`/g, ' ')          // inline code
    .replace(/!\[.*?\]\(.*?\)/g, ' ')  // images
    .replace(/\[.*?\]\(.*?\)/g, ' ')   // links — keep only the label text
    .replace(/#{1,6}\s*/g, ' ')        // headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')   // italic
    .replace(/^\s*[-*+]\s+/gm, ' ')    // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, ' ')    // ordered list markers
    .replace(/>\s*/g, ' ')             // blockquotes
    .replace(/\|/g, ' ')               // table pipes
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function stripDeterminer(str) {
  return str.replace(/^(the|a|an)\s+/i, '').trim();
}

function tokenCount(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

function isKeepable(phrase) {
  if (!phrase || phrase.length < 2) return false;
  const tokens = phrase.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  // Each token must be >= 2 chars OR be in the short-token allowlist
  for (const t of tokens) {
    if (t.length < 2 && !SHORT_TOKEN_ALLOWLIST.has(t)) return false;
  }
  if (IGNORE_LIST.has(phrase)) return false;
  // Reject if every token is a stopword
  if (tokens.every(t => stopwords[t])) return false;
  return true;
}

function conceptType(phrase) {
  const lower = phrase.toLowerCase();
  for (const term of INTERPRETIVE_TERMS) {
    if (lower === term || lower.endsWith(' ' + term)) return 'interpretive';
  }
  return 'descriptive';
}

function isPeopleRelated(phrase) {
  const lower = phrase.toLowerCase();
  if (PEOPLE_LEXICON.has(lower)) return true;
  if (lower.endsWith('portrait')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Concept extraction from a single annotation record
// ---------------------------------------------------------------------------

function extractFromTag(annotation) {
  const raw = annotation.body || '';
  // Tags can be comma/semicolon/pipe delimited multi-values
  const parts = raw.split(/[,;|]+/);
  const results = [];
  for (const part of parts) {
    let phrase = normalizeText(part);
    phrase = stripDeterminer(phrase);
    if (!isKeepable(phrase)) continue;
    results.push(makeOccurrence(phrase, annotation, 'tag'));
  }
  return results;
}

function canonicalize(phrase) {
  return TERM_TO_CANONICAL.get(phrase) || phrase;
}

function extractFromDescription(annotation) {
  const raw = stripMarkdown(annotation.body || '');
  if (!raw.trim()) return [];
  const doc = nlp(raw);
  const chunks = doc.nouns().out('array');
  const results = [];
  for (const chunk of chunks) {
    let phrase = normalizeText(chunk);
    phrase = stripDeterminer(phrase);
    // Strip trailing stopwords
    const tokens = phrase.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && stopwords[tokens[tokens.length - 1]]) tokens.pop();
    phrase = tokens.join(' ');
    if (!isKeepable(phrase)) continue;
    results.push(makeOccurrence(phrase, annotation, 'description'));
  }
  return results;
}

function makeOccurrence(phrase, annotation, type) {
  const canonical = canonicalize(phrase);
  return {
    concept_text:    canonical,
    original_text:   phrase !== canonical ? phrase : null,
    source:          annotation.source,
    annotation_id:   annotation.id,
    type:            type,
    people_related:  isPeopleRelated(canonical),
    concept_type:    conceptType(canonical),
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregateOccurrences(occurrences) {
  const map = new Map();
  for (const occ of occurrences) {
    const key = occ.concept_text;
    if (!map.has(key)) {
      map.set(key, {
        concept:            key,
        services:           new Set(),
        annotation_ids:     new Set(),
        types:              new Set(),
        count_total:        0,
        people_related:     false,
        interpretive_count: 0,
        total_count:        0,
        // variant_text → Set of sources that used that specific word
        _variants:          new Map(),
        // keep up to 3 raw occurrences as evidence snippets
        _occurrences:       [],
      });
    }
    const entry = map.get(key);
    entry.services.add(occ.source);
    entry.annotation_ids.add(occ.annotation_id);
    entry.types.add(occ.type);
    entry.count_total++;
    if (occ.people_related) entry.people_related = true;
    if (occ.concept_type === 'interpretive') entry.interpretive_count++;
    entry.total_count++;
    if (entry._occurrences.length < 3) entry._occurrences.push(occ);

    // Track which services used which variant word (including canonical itself)
    const word = occ.original_text || occ.concept_text;
    if (!entry._variants.has(word)) entry._variants.set(word, new Set());
    entry._variants.get(word).add(occ.source);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function score(entry) {
  const sc = Math.min(entry.services.size, CONFIG.S_cap) / CONFIG.S_cap;
  const ac = Math.log(1 + Math.min(entry.annotation_ids.size, CONFIG.A_cap)) /
             Math.log(1 + CONFIG.A_cap);
  return Math.round((CONFIG.w_services * sc + CONFIG.w_annotations * ac) * 1000) / 1000;
}

function agreementLevel(normServices, normAnnotations) {
  if (normServices >= CONFIG.stronger_norm_services_min &&
      normAnnotations >= CONFIG.stronger_norm_annotations_min) {
    return 'stronger';
  }
  return 'weaker';
}

// ---------------------------------------------------------------------------
// Build example_annotations snippets from raw annotation records
// ---------------------------------------------------------------------------

function buildExamples(entry, annotationsById) {
  return entry._occurrences.map(occ => {
    const rec = annotationsById.get(occ.annotation_id);
    const body = rec ? (rec.body || '') : '';
    const snippet = body.length > 120 ? body.slice(0, 120) + '…' : body;
    return {
      annotation_id: occ.annotation_id,
      type:          occ.type,
      source:        occ.source,
      snippet:       snippet,
    };
  });
}

// ---------------------------------------------------------------------------
// Thematic extraction — TF-IDF across LLM description annotations
// ---------------------------------------------------------------------------

// Tokenize a description into a flat word array, filtering noise.
// Raw words are kept in order so ngrams can be built from them.
function tokenizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

// Return true if a candidate phrase is worth keeping as a thematic term.
function isKeepableThematic(tokens) {
  if (tokens.length === 0 || tokens.length > 3) return false;
  // At least one content token — not all stopwords/ignore words
  const hasContent = tokens.some(
    w => !stopwords[w] && !THEMATIC_IGNORE.has(w) && !IGNORE_LIST.has(w) && w.length > 2
  );
  if (!hasContent) return false;
  // Reject phrases that start or end with a stopword or ignore word
  const first = tokens[0];
  const last  = tokens[tokens.length - 1];
  if (stopwords[first] || THEMATIC_IGNORE.has(first)) return false;
  if (stopwords[last]  || THEMATIC_IGNORE.has(last))  return false;
  return true;
}

// Generate all unigrams, bigrams, and trigrams from a word array.
function generateNgrams(words) {
  const ngrams = new Set();
  for (let i = 0; i < words.length; i++) {
    const w1 = words[i];
    if (isKeepableThematic([w1])) ngrams.add(w1);
    if (i + 1 < words.length) {
      const w2 = words[i + 1];
      if (isKeepableThematic([w1, w2])) ngrams.add(w1 + ' ' + w2);
    }
    if (i + 2 < words.length) {
      const w2 = words[i + 1];
      const w3 = words[i + 2];
      if (isKeepableThematic([w1, w2, w3])) ngrams.add(w1 + ' ' + w2 + ' ' + w3);
    }
  }
  return ngrams;
}

function extractThematicConcepts(descAnnotations, annotationsById) {
  if (descAnnotations.length === 0) return [];

  // Build per-annotation ngram sets and word lists for TF computation
  const annotationData = descAnnotations.map(ann => {
    const words = tokenizeWords(stripMarkdown(ann.body || ''));
    const ngrams = generateNgrams(words);
    return { ann, words, ngrams };
  });

  const N = annotationData.length;
  if (N === 0) return [];

  // Document frequency: how many annotations contain each ngram
  const df = new Map();
  for (const { ngrams } of annotationData) {
    for (const ng of ngrams) {
      df.set(ng, (df.get(ng) || 0) + 1);
    }
  }

  // Build term data: TF-IDF per annotation, track sources and annotation ids.
  // TF for a phrase = (count of phrase occurrences) / (total word tokens).
  // Using word count as denominator normalises phrase length fairly.
  const termData = new Map();

  for (const { ann, words, ngrams } of annotationData) {
    if (words.length === 0) continue;

    // Count phrase occurrences in the raw word stream
    const phraseCount = {};
    for (const ng of ngrams) {
      const parts = ng.split(' ');
      let count = 0;
      for (let i = 0; i <= words.length - parts.length; i++) {
        if (parts.every((p, j) => words[i + j] === p)) count++;
      }
      if (count > 0) phraseCount[ng] = count;
    }

    for (const [ng, freq] of Object.entries(phraseCount)) {
      const docFreq = df.get(ng) || 1;
      if (docFreq < CONFIG.thematic_min_descriptions) continue;

      const tf    = freq / words.length;
      const idf   = Math.log(N / docFreq) + 1;
      const tfidf = tf * idf;

      if (!termData.has(ng)) {
        termData.set(ng, {
          term:           ng,
          sources:        new Set(),
          annotation_ids: new Set(),
          tfidf_sum:      0,
          tfidf_count:    0,
        });
      }
      const entry = termData.get(ng);
      entry.sources.add(ann.source);
      entry.annotation_ids.add(ann.id);
      entry.tfidf_sum   += tfidf;
      entry.tfidf_count += 1;
    }
  }

  // Filter, score, and suppress unigrams that are subsumed by a higher-scoring
  // phrase containing them — keeps the output readable.
  const passing = [];
  for (const [, entry] of termData) {
    if (entry.sources.size        < CONFIG.thematic_min_sources)      continue;
    if (entry.annotation_ids.size < CONFIG.thematic_min_descriptions) continue;

    const normSources   = Math.min(entry.sources.size, CONFIG.thematic_S_cap) / CONFIG.thematic_S_cap;
    const avgTfidf      = entry.tfidf_sum / entry.tfidf_count;
    const thematicScore = Math.round(((0.6 * normSources) + (0.4 * avgTfidf)) * 1000) / 1000;

    passing.push({
      term:               entry.term,
      concept_type:       'thematic',
      thematic_score:     thematicScore,
      sources_count:      entry.sources.size,
      descriptions_count: entry.annotation_ids.size,
      snippet:            null, // filled below for survivors only
    });
  }

  passing.sort((a, b) => b.thematic_score - a.thematic_score);

  // Subsumption: if a unigram is a token inside a higher-ranked phrase, drop it.
  const kept = [];
  const keptPhrases = [];
  for (const candidate of passing) {
    const tokens = candidate.term.split(' ');
    if (tokens.length === 1) {
      const subsumed = keptPhrases.some(p => p.split(' ').includes(candidate.term));
      if (subsumed) continue;
    }
    keptPhrases.push(candidate.term);
    kept.push(candidate);
    if (kept.length >= CONFIG.thematic_top_N) break;
  }

  // Fill snippets only for surviving terms
  for (const entry of kept) {
    entry.snippet = findSnippetForTerm(entry.term, descAnnotations);
  }

  return kept;
}

function findSnippetForTerm(term, descAnnotations) {
  const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  for (const ann of descAnnotations) {
    const body = ann.body || '';
    const sentences = body.split(/(?<=[.!?])\s+|(?<=[.!?])$/).map(s => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      if (re.test(sentence)) {
        return sentence.length > 160 ? sentence.slice(0, 160) + '…' : sentence;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mood palette — expressive/interpretive language across descriptions
// ---------------------------------------------------------------------------

function extractMoodPalette(descAnnotations) {
  if (descAnnotations.length === 0) return [];

  const phraseMap = new Map(); // canonical phrase → { sources, count, snippets }

  for (const ann of descAnnotations) {
    const body = stripMarkdown(ann.body || '');
    if (!body) continue;
    const source = ann.source;
    const annId = ann.id;
    const model = ann.model || null;
    const modelName = model && MODELS[model] ? MODELS[model].name : null;
    const bodyLower = body.toLowerCase();
    const sentences = body.split(/(?<=[.!?])\s+|(?<=[.!?])$/).map(s => s.trim()).filter(Boolean);

    // Strategy 1: seed-word extraction — find mood adjectives in context
    const words = bodyLower.replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (!MOOD_SEEDS.has(word)) continue;
      if (!phraseMap.has(word)) {
        phraseMap.set(word, { phrase: word, sources: new Set(), count: 0, snippets: [] });
      }
      const entry = phraseMap.get(word);
      entry.sources.add(source);
      entry.count++;
    }

    // Strategy 2: pattern extraction — "sense of X", "evokes X", etc.
    for (const prefix of MOOD_PATTERN_PREFIXES) {
      const re = new RegExp('\\b' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([a-z][a-z\\s-]{1,30}?)(?=[.,;:!?\\)]|\\s(?:and|but|or|that|which|while|in|on|with|the|a)\\b|$)', 'gi');
      let match;
      while ((match = re.exec(bodyLower)) !== null) {
        let extracted = match[1].trim().replace(/\s+/g, ' ');
        // Strip trailing stopwords
        extracted = extracted.replace(/\s+(the|a|an|and|or|its|this|that|is|are|was)$/i, '').trim();
        if (extracted.length < 3 || extracted.split(/\s+/).length > 4) continue;
        // Skip if it's purely a physical descriptor
        const tokens = extracted.split(/\s+/);
        if (tokens.every(t => THEMATIC_IGNORE.has(t) || stopwords[t])) continue;

        const canonical = prefix + ' ' + extracted;
        if (!phraseMap.has(canonical)) {
          phraseMap.set(canonical, { phrase: canonical, sources: new Set(), count: 0, snippets: [] });
        }
        const entry = phraseMap.get(canonical);
        entry.sources.add(source);
        entry.count++;
      }
    }

    // Strategy 3: sentence-level — one snippet per annotation for provenance
    for (const sentence of sentences) {
      const sentLower = sentence.toLowerCase();
      for (const [phrase, entry] of phraseMap) {
        if (!entry.sources.has(source)) continue;
        if (entry.snippets.some(s => s.id === annId)) continue;
        const re = new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (re.test(sentLower)) {
          const snip = sentence.length > 160 ? sentence.slice(0, 160) + '...' : sentence;
          entry.snippets.push({ source, model: modelName || source, id: annId, text: snip });
        }
      }
    }
  }

  // Score and rank: multi-source phrases first, then by count
  const results = [];
  for (const [, entry] of phraseMap) {
    if (entry.count < 2) continue;
    results.push({
      phrase:        entry.phrase,
      sources_count: entry.sources.size,
      count:         entry.count,
      sources:       [...entry.sources],
      snippets:      entry.snippets.map(s => ({ source: s.source, model: s.model, annotation_id: s.id, text: s.text })),
    });
  }

  results.sort((a, b) => {
    if (b.sources_count !== a.sources_count) return b.sources_count - a.sources_count;
    return b.count - a.count;
  });

  return results.slice(0, CONFIG.mood_max);
}

// ---------------------------------------------------------------------------
// Observations — what the AIs noticed, categorized
// ---------------------------------------------------------------------------

function categorizePhrase(phrase) {
  const tokens = phrase.split(/\s+/);
  for (const cat of OBSERVATION_CATEGORIES) {
    if (cat.seeds.has(phrase)) return cat.key;
    for (const token of tokens) {
      if (cat.seeds.has(token)) return cat.key;
    }
  }
  return 'other';
}

function extractObservations(descAnnotations, regionAnnotations) {
  if (descAnnotations.length === 0 && (!regionAnnotations || regionAnnotations.length === 0)) return {};

  // phrase → { sources: Set, count, spatial: Map<source, count>, snippets: [] }
  const phraseMap = new Map();

  function ensureEntry(canonical) {
    if (!phraseMap.has(canonical)) {
      phraseMap.set(canonical, { sources: new Set(), count: 0, spatial: new Map(), snippets: [] });
    }
    return phraseMap.get(canonical);
  }

  // --- LLM description extraction (existing logic) ---
  for (const ann of descAnnotations) {
    const clean = stripMarkdown(ann.body || '');
    if (!clean.trim()) continue;
    const source = ann.source;
    const annId = ann.id;
    const model = ann.model || null;
    const modelName = model && MODELS[model] ? MODELS[model].name : null;
    const doc = nlp(clean);

    const nouns = doc.nouns().out('array');
    const adjNouns = doc.match('#Adjective+ #Noun+').out('array');
    const candidates = [...nouns, ...adjNouns];

    const matchedCanonicals = new Set();

    for (const raw of candidates) {
      let phrase = raw.replace(/\(.*?\)/g, ' ').replace(/\([^)]*$/, '');
      phrase = normalizeText(phrase);
      phrase = stripDeterminer(phrase);
      const tokens = phrase.split(/\s+/).filter(Boolean);
      while (tokens.length > 0 && stopwords[tokens[tokens.length - 1]]) tokens.pop();
      phrase = tokens.join(' ');

      if (!phrase || tokens.length === 0 || tokens.length > CONFIG.observations_max_phrase_tokens) continue;
      if (tokens.every(t => stopwords[t] || IGNORE_LIST.has(t))) continue;
      if (IGNORE_LIST.has(phrase)) continue;

      const canonical = tokens.length === 1 ? canonicalize(phrase) : phrase;
      const entry = ensureEntry(canonical);
      entry.sources.add(source);
      entry.count++;
      matchedCanonicals.add(canonical);
    }

    // Collect one snippet per annotation for each matched phrase
    const sentences = clean.split(/(?<=[.!?])\s+|(?<=[.!?])$/).map(s => s.trim()).filter(Boolean);
    for (const canonical of matchedCanonicals) {
      const entry = phraseMap.get(canonical);
      if (entry.snippets.some(s => s.id === annId)) continue;
      const forms = CANONICAL_TO_FORMS.get(canonical) || [canonical];
      const pattern = forms.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const re = new RegExp('\\b(?:' + pattern + ')(?:s|es|ed|ing|ly)?\\b', 'i');
      for (const sentence of sentences) {
        if (re.test(sentence)) {
          const snip = sentence.length > 160 ? sentence.slice(0, 160) + '...' : sentence;
          entry.snippets.push({ source, model: modelName || source, id: annId, text: snip });
          break;
        }
      }
    }
  }

  // --- Feature-region tags: merge into phrase map with spatial tracking ---
  if (regionAnnotations && regionAnnotations.length > 0) {
    for (const ann of regionAnnotations) {
      let phrase = normalizeText(ann.body || '');
      phrase = stripDeterminer(phrase);
      const tokens = phrase.split(/\s+/).filter(Boolean);
      if (!phrase || tokens.length === 0 || tokens.length > CONFIG.observations_max_phrase_tokens) continue;
      if (IGNORE_LIST.has(phrase)) continue;

      const canonical = tokens.length === 1 ? canonicalize(phrase) : phrase;
      const entry = ensureEntry(canonical);
      entry.sources.add(ann.source);
      entry.count++;

      // Track bounding-box instances per service
      const src = ann.source;
      entry.spatial.set(src, (entry.spatial.get(src) || 0) + 1);
    }
  }

  // Bucket into categories, sort by source count then total count
  const buckets = {};
  for (const cat of OBSERVATION_CATEGORIES) buckets[cat.key] = [];
  buckets['other'] = [];

  for (const [phrase, data] of phraseMap) {
    const cat = categorizePhrase(phrase);
    const obs = {
      phrase,
      sources:       Array.from(data.sources),
      sources_count: data.sources.size,
      count:         data.count,
      snippets:      data.snippets.map(s => ({ source: s.source, model: s.model, annotation_id: s.id, text: s.text })),
    };

    // Attach spatial detection metadata when region tags contributed
    if (data.spatial.size > 0) {
      const perService = [];
      let totalInstances = 0;
      for (const [src, n] of data.spatial) {
        perService.push({ source: src, instances: n });
        totalInstances += n;
      }
      perService.sort((a, b) => b.instances - a.instances);
      obs.spatially_detected = {
        services: perService.length,
        total_instances: totalInstances,
        per_service: perService,
      };
    }

    buckets[cat].push(obs);
  }

  const result = {};
  for (const cat of [...OBSERVATION_CATEGORIES, { key: 'other', label: 'Other' }]) {
    const entries = (buckets[cat.key] || [])
      .sort((a, b) => b.sources_count - a.sources_count || b.count - a.count)
      .slice(0, CONFIG.observations_max_per_category);
    if (entries.length > 0) {
      result[cat.key] = {
        label:   cat.label || 'Other',
        entries,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main compute function
// ---------------------------------------------------------------------------

function compute(ai_data, object_info, display_image) {
  // Build annotation lookup for snippet extraction
  const annotationsById = new Map();
  for (const rec of ai_data) {
    annotationsById.set(rec.id, rec);
  }

  // Separate annotation types
  const tagAnnotations    = ai_data.filter(r => r.type === 'tag' && r.feature === 'full');
  const regionAnnotations = ai_data.filter(r => r.type === 'tag' && r.feature === 'region');
  const descAnnotations   = ai_data.filter(r => r.type === 'description');
  const faceAnnotations   = ai_data.filter(r => r.type === 'face');
  const textAnnotations   = ai_data.filter(r => r.type === 'text');

  if (tagAnnotations.length === 0 && descAnnotations.length === 0) {
    return {
      objectid:          object_info ? object_info.id : null,
      imageid:           display_image ? display_image.imageid : null,
      status:            'no_annotations',
      algorithm_version: ALGORITHM_VERSION,
      generated_at:      new Date().toISOString(),
    };
  }

  // Extract concept occurrences (tags + noun chunks from descriptions)
  const occurrences = [];
  for (const ann of tagAnnotations)  occurrences.push(...extractFromTag(ann));
  for (const ann of descAnnotations) occurrences.push(...extractFromDescription(ann));

  // Thematic extraction — TF-IDF across LLM descriptions only
  const thematicConcepts = extractThematicConcepts(descAnnotations, annotationsById);

  // Observations — broad extraction, categorized, no agreement threshold
  const observations = extractObservations(descAnnotations, regionAnnotations);

  // Mood palette — expressive/interpretive language from descriptions
  const moodPalette = extractMoodPalette(descAnnotations);

  // Aggregate
  const conceptMap = aggregateOccurrences(occurrences);

  // -------------------------------------------------------------------------
  // Agreement concepts
  // -------------------------------------------------------------------------
  const agreementConcepts = [];
  for (const [, entry] of conceptMap) {
    const sCount = entry.services.size;
    const aCount = entry.annotation_ids.size;
    if (sCount < CONFIG.min_services || aCount < CONFIG.min_annotations) continue;

    const normServices    = Math.min(sCount, CONFIG.S_cap) / CONFIG.S_cap;
    const normAnnotations = Math.log(1 + Math.min(aCount, CONFIG.A_cap)) /
                            Math.log(1 + CONFIG.A_cap);
    const consensusScore  = score(entry);
    const cType = entry.interpretive_count / entry.total_count > 0.5
      ? 'interpretive'
      : 'descriptive';

    // Serialize variant vocabulary: [{term, services:[...]}] sorted by service count
    const variants = Array.from(entry._variants.entries())
      .map(([term, srcs]) => ({ term, services: Array.from(srcs) }))
      .sort((a, b) => b.services.length - a.services.length);

    agreementConcepts.push({
      concept:              entry.concept,
      concept_type:         cType,
      consensus_score:      consensusScore,
      agreement_level:      agreementLevel(normServices, normAnnotations),
      services_count:       sCount,
      annotations_count:    aCount,
      types:                Array.from(entry.types),
      people_related:       entry.people_related,
      vocabulary_diversity: variants.length,
      variants:             variants.length > 1 ? variants : null,
      example_annotations:  buildExamples(entry, annotationsById),
    });
  }
  agreementConcepts.sort((a, b) => b.consensus_score - a.consensus_score);
  const topConcepts = agreementConcepts.slice(0, CONFIG.top_N);

  // -------------------------------------------------------------------------
  // Divergence signals — cross-service disagreements only
  // -------------------------------------------------------------------------
  const allConceptTexts = new Set(conceptMap.keys());
  const topDivergence = [];
  for (const [termA, termB] of INCOMPATIBILITY_LIST) {
    if (topDivergence.length >= CONFIG.max_divergence) break;
    if (!allConceptTexts.has(termA) || !allConceptTexts.has(termB)) continue;
    const entryA = conceptMap.get(termA);
    const entryB = conceptMap.get(termB);
    if (!entryA || !entryB) continue;
    topDivergence.push({
      type:          'cross_service_disagreement',
      concepts:      [termA, termB],
      concept_types: [
        entryA.interpretive_count / entryA.total_count > 0.5 ? 'interpretive' : 'descriptive',
        entryB.interpretive_count / entryB.total_count > 0.5 ? 'interpretive' : 'descriptive',
      ],
      services:      [Array.from(entryA.services)[0], Array.from(entryB.services)[0]],
      note:          `Services disagree: "${termA}" vs "${termB}"`,
    });
  }

  // -------------------------------------------------------------------------
  // Flags: has_text, has_faces
  // -------------------------------------------------------------------------
  const hasText    = textAnnotations.length > 0;
  const textSample = hasText
    ? (textAnnotations[0].body || '').slice(0, 100)
    : null;

  // Group face annotations by source to get per-service counts, then derive
  // the spread across services (min, max, avg, total).
  const hasFaces = faceAnnotations.length > 0;
  let faceStats  = null;
  if (hasFaces) {
    const byService = _.groupBy(faceAnnotations, 'source');
    const perService = Object.entries(byService).map(([source, recs]) => ({
      source,
      count: recs.length,
    }));
    const counts = perService.map(s => s.count);
    const faceMin = Math.min(...counts);
    const faceMax = Math.max(...counts);
    const faceAvg = Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10;
    faceStats = {
      services_reporting: perService.length,
      per_service:        perService,
      min:                faceMin,
      max:                faceMax,
      avg:                faceAvg,
    };
  }

  // -------------------------------------------------------------------------
  // depicts_people
  // -------------------------------------------------------------------------
  const peopleServicesUnion     = new Set();
  const peopleAnnotationsUnion  = new Set();
  const peopleConcepts          = [];

  for (const [, entry] of conceptMap) {
    if (!entry.people_related) continue;
    for (const s of entry.services)       peopleServicesUnion.add(s);
    for (const id of entry.annotation_ids) peopleAnnotationsUnion.add(id);
    peopleConcepts.push({ concept: entry.concept, annotations_count: entry.annotation_ids.size });
  }

  const peopleServicesCount    = peopleServicesUnion.size;
  const peopleAnnotationsCount = peopleAnnotationsUnion.size;
  const depictsPeople = peopleServicesCount    >= CONFIG.people_services_min &&
                        peopleAnnotationsCount >= CONFIG.people_annotations_min;

  let depictsPeopleLevel = null;
  if (depictsPeople) {
    depictsPeopleLevel = (
      peopleServicesCount    >= CONFIG.strong_people_services &&
      peopleAnnotationsCount >= CONFIG.strong_people_annotations
    ) ? 'strong' : 'weak';
  }

  peopleConcepts.sort((a, b) => b.annotations_count - a.annotations_count);
  const depictsPeopleExamples = peopleConcepts.slice(0, 3).map(p => p.concept);

  // -------------------------------------------------------------------------
  // Catalogue block
  // -------------------------------------------------------------------------
  const catalogue = buildCatalogue(object_info, display_image);

  // -------------------------------------------------------------------------
  // Assemble response
  // -------------------------------------------------------------------------
  return {
    objectid:          object_info ? object_info.id : null,
    imageid:           display_image ? display_image.imageid : null,
    status:            'ok',
    algorithm_version: ALGORITHM_VERSION,
    generated_at:      new Date().toISOString(),
    catalogue:         catalogue,
    summary: {
      total_raw_concepts:           occurrences.length,
      concepts_returned:            topConcepts.length,
      thematic_concepts_returned:   thematicConcepts.length,
      divergence_signals_returned:  topDivergence.length,
      has_text:                   hasText,
      text_sample:                textSample,
      has_faces:                  hasFaces,
      face_stats:                 faceStats,
      depicts_people:             depictsPeople,
      depicts_people_level:       depictsPeopleLevel,
      depicts_people_examples:    depictsPeopleExamples,
    },
    concepts:            topConcepts,
    thematic_concepts:   thematicConcepts,
    divergence_signals:  topDivergence,
    observations:        observations,
    mood_palette:        moodPalette,
  };
}

function buildCatalogue(object_info, display_image) {
  if (!object_info) return null;
  return {
    title:          object_info.title          || null,
    classification: object_info.classification || null,
    medium:         object_info.medium         || null,
    technique:      object_info.technique      || null,
    culture:        object_info.culture        || null,
    period:         object_info.period         || null,
    people:         object_info.people         || [],
    places:         object_info.places         || [],
    keywords:       (object_info.keywords || []).map(k => k.name || k),
    labeltext:      object_info.labeltext      || null,
    image: display_image ? {
      alttext:     display_image.alttext     || null,
      description: display_image.description || null,
    } : null,
  };
}

module.exports = { compute, ALGORITHM_VERSION };
