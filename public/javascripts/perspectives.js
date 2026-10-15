'use strict';

var nlp = require('compromise');
var _ = require('lodash');
var stopwords = require('../vocabularies/stopwords');
var MODELS = require('../../models');
var overview = require('./overview');
var positions = require('./positions');

// ---------------------------------------------------------------------------
// Versioned config — bump algorithm_version on any change (see semver rules
// in the plan: patch for list changes, minor for scoring/threshold changes,
// major for schema/NLP backend changes).
// ---------------------------------------------------------------------------

// Stage 3 adds individual output series and separates the object reference.
// Use a major version for the radar schema and AI-only normalization contract.
// 4.1 adds the additive `overview` block (see overview.js); no existing field changes.
// 4.2 adds overview.colour_words and attribution-pattern name detection.
// 4.3 lists every observed phrase (no 25-per-dimension cap); excerpts only
//     for the top 25 per dimension.
// 4.4 widens Action into "Pose & Action", adds a ninth "Condition & State"
//     dimension, and lists their words as phrases when found in the text.
// 4.5 categorises phrases by whole phrase, then head word, then any word,
//     singularising and splitting hyphens (fewer phrases fall into Other).
// 4.5.1 adds reviewed vocabulary to six dimensions (body and bearing,
//     clothing, text and marks, landscape, colour, mark-making); see
//     .plans/vocabulary-additions-draft.md.
// 4.6 vocabulary matching (radar, grid, pose/condition phrases, concept
//     families, excerpts) also matches plurals of listed nouns.
// 4.7 adds the additive `positions` block (see positions.js): where the
//     descriptions place things, grouped into claims and checked against
//     detected boxes. No existing field changes.
// 4.7.1 labels groups of people "figures", names the place in claims split
//     by place ("figures on the left"), and counts flag boxes per service.
// 4.7.2 position sentences drop markdown list markers ("- ", "* ", "1. ").
// 4.8 adds overview.divergence kind 'unrecorded_title': a title a
//     description gives ("titled "The Reader"") that the record doesn't have,
//     leaving out titles read off the image. Signals list titles first.
const ALGORITHM_VERSION = 'ace-v4.8.0';

const CONFIG = {
  min_services:                2,
  min_annotations:             3,
  top_N:                       15,
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
  // Every observed phrase is listed; only the top phrases per dimension (by
  // provider count) carry excerpts, which are most of the JSON's weight.
  // Phrases below this rank keep their counts and annotation_ids.
  observations_snippet_entries: 25,
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
  'facial expression',
  // Body-part terms from region detection (Clarifai)
  'human face','human arm','human eye','human nose','human head',
  'human hair','human leg','human mouth','human hand','human ear',
  'human foot','human beard',
  // Body-part general terms
  'face','arm','eye','nose','head','hair','leg','mouth','hand','ear','foot',
  'neck','beard','torso','shoulder','chest','back','stomach','waist','hip',
  'chin','cheek','forehead','eyebrow','eyelash','eyelid','lip','teeth','tongue',
  'moustache','mustache','wrist','complexion','thigh',
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

// Stage 2: equivalence and family membership are different relationships.
// Only conservative linguistic alternatives/inflections affect agreement.
// A crown and a helmet share a family; neither becomes a "hat" vote.
const SYNONYM_MAP = {
  hat: ['hats'], crown: ['crowns'], helmet: ['helmets'],
  vessel: ['vessels'], vase: ['vases'], cup: ['cups'], bowl: ['bowls'],
  tree: ['trees'], book: ['books'], bird: ['birds'], horse: ['horses'],
  dog: ['dogs'], flower: ['flowers'], fruit: ['fruits'], mountain: ['mountains'],
  arch: ['arches', 'archway'], column: ['columns', 'pillar', 'pillars'],
  window: ['windows'], cross: ['crosses'], candle: ['candles'],
  seated: ['sitting'], halo: ['nimbus', 'aureole'],
  watercolor: ['watercolour'], color: ['colour'],
};

// Curated browsing families. Membership never contributes to agreement scores.
// These are deliberately bounded, inspectable relationships, not a complete
// ontology or a numerical semantic distance. Missing membership means unknown.
const CONCEPT_FAMILIES = {
  // Vessels and containers
  'vessel':       ['vase', 'urn', 'jar', 'jug', 'pitcher', 'pot', 'bowl', 'flask', 'amphora', 'chalice', 'goblet', 'cup'],
  // Textiles and drapery
  'drapery':      ['drape', 'curtain', 'cloth', 'fabric', 'textile', 'garment', 'robe', 'cloak', 'mantle', 'veil'],
  // Headwear
  'headwear':     ['hat', 'tricorn', 'tricorne', 'cap', 'bonnet', 'helmet', 'headdress', 'crown', 'turban', 'hood'],
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
  'vegetation':   ['tree', 'trees', 'foliage', 'branches', 'trunk', 'shrub', 'bush', 'grove', 'forest', 'woodland', 'grass'],
  'water':        ['river', 'stream', 'lake', 'pond', 'pool', 'sea', 'ocean', 'waves', 'waterway', 'waterfall', 'fountain'],
  'landforms':    ['mountain', 'hill', 'hills', 'mountains', 'peak', 'cliff', 'rock', 'rocks', 'rocky', 'terrain'],
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
  'writing':      ['book', 'books', 'manuscript', 'scroll', 'text', 'inscription', 'tablet'],
  // Cross / crucifix
  'cross':        ['crucifix', 'cruciform'],
  // Light source
  'candle':       ['candles', 'candlestick', 'torch', 'flame', 'lamp', 'lantern'],
};

CONCEPT_FAMILIES.medium = ['oil', 'watercolor', 'watercolour', 'tempera', 'gouache', 'ink', 'charcoal', 'pastel'];
CONCEPT_FAMILIES.posture = ['standing', 'seated', 'sitting', 'kneeling', 'lying'];
CONCEPT_FAMILIES.atmosphere = ['formal', 'dignified', 'solemn', 'serene', 'calm', 'dramatic', 'somber', 'joyful'];
for (const [label, terms] of Object.entries(CONCEPT_FAMILIES)) {
  // Original family labels that are also observed words remain matchable.
  if (!['headwear', 'writing', 'vegetation', 'landforms', 'medium', 'posture', 'atmosphere'].includes(label)) terms.unshift(label);
  // Make plural/synonymous surface forms visible within their family too.
  CONCEPT_FAMILIES[label] = [...new Set(terms.flatMap(term => [term, ...(SYNONYM_MAP[term] || [])]))];
}

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
      'beast','creature','animal','animals','monster','sea monster','mythical creature','mythical animal',
    ]),
  },
  {
    // How figures are posed and what they are doing. Mostly verbs and
    // participles, so these words are also matched directly in the text
    // (see VOCABULARY_PHRASE_CATEGORIES), not only inside noun phrases.
    key:   'action',
    label: 'Pose & Action',
    seeds: new Set([
      'holding','carrying','standing','seated','sitting','kneeling','lying',
      'reaching','pointing','gesturing','gazing','looking','watching','walking',
      'riding','fighting','praying','embracing','raising',
      'turning','bowing','leaning','reclining','enthroned','blessing',
      'falling','fleeing','ascending','descending','draped','veiled',
      // Left out after a 92-object survey, as mostly figurative in
      // descriptions: striking ("a striking contrast"), extending ("extending
      // across"), offering ("offering a glimpse"), running ("running along the
      // edge"), reading ("an inscription reading"), working ("working process").
      // Pose and orientation
      'in profile','three-quarter view','frontal','facing left','facing right',
      'facing forward','looking over','turned','tilted','crouching','squatting',
      'perched','resting','slumped','hunched','upright','posed','pose','posture',
      'gesture','profile','gaze','stance',
      // Hands and arms
      'clasped','folded','crossed arms','arms crossed','outstretched','raised hand',
      'raised arm','hand raised','arm raised','hands together','hand on hip',
      // Activities
      'dancing','playing','writing','sleeping','eating','drinking',
      'smoking','smiling','laughing','weeping','frowning',
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
      'rug','furniture','shelf','desk','couch','stool','pillow','chain',
      'calligraphy','watermark','monogram','label','caption','signature','text','script','stamp',
      'garment','attire','robe','cloak','mantle','veil','shawl','tunic','kimono','sari','sash',
      'staff','ribbon','headgear','gown','collar','sleeve','costume','jewelry','jewellery',
      'shawl','cravat','uniform','pendant','cane','button','sandal','wig','trousers','cape','vest','bodice',
      'waistcoat','apron','boot','brooch','epaulette','medal','ruff','carriage','wagon',
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
      'river','lake','sea','ocean','shore','coast','harbour','bridge', 'water',
      'city','town','village','mountain','hill','waterfall','pond','leaf',
      'cliff','cave','canyon','desert','beach','island','volcano',
      'ruins','snow','ice','sand','rock','sunset','sunrise','dawn','dusk',
      'street','road','path','staircase','archway','gate','wall',
      'sky','cloud','horizon','distance','background','architectural',
      'urban','rural','domestic','sacred','secular','night','day',
      // Buildings and structures from region detection
      'house','building','skyscraper','office building','lighthouse','porch',
      'fireplace','fountain','swimming pool','stairs',
      // Vegetation (spatially grounded)
      'tree','plant','flower','houseplant','palm tree','flowerpot','vine','hedge',
      'bush','shrub','grass','lawn','orchard','vineyard',
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
      'contrast','lighting','palette','hue','gradient','tint','spectrum',
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
      'gilding','glaze','impasto','wash','hatching','crosshatching','gold leaf',
      'carved','cast','modelled','painted','drawn','printed','woven','embroidered',
      'texture','linework','brushwork','brushstroke','layer','stipple','inlay','mosaic',
    ]),
  },
  {
    // The physical state of the object as photographed. Ambiguous words are
    // left out or used only in longer phrases: "worn" usually means wearing
    // ("worn by the sitter"), "faint" a faint smile, "tears" crying. Also left
    // out after a 92-object survey: restoration (the historical period), rust
    // ("rust-coloured"), stained/staining (stained glass, lab staining),
    // fading (colour gradients) and erosion (used as a theme).
    key:   'condition',
    label: 'Condition & State',
    seeds: new Set([
      'unfinished','incomplete','fragment','fragmentary','damaged','damage',
      'faded','discolored','discoloured','discoloration','discolouration',
      'yellowed','stains','water stains','water damage','foxing','foxed',
      'cracked','cracks','craquelure','frayed','tattered','abraded','abrasion',
      'flaking','peeling','chipped','dented','scratched','scratches','creased',
      'creases','crumpled','restored','repaired','repairs','patina','tarnished',
      'corroded','corrosion','weathered','eroded','rusted',
      'signs of wear','signs of age','signs of aging','wear and tear','worn edges',
      'worn surface','heavily worn','well-worn','losses','paint loss',
    ]),
  },
];

// Categories whose words are matched directly in description text and listed
// as phrases themselves (like the mood palette), because they are mostly
// verbs, participles and adjectives that noun-phrase extraction misses.
const VOCABULARY_PHRASE_CATEGORIES = ['action', 'condition'];
const categorySeeds = key => OBSERVATION_CATEGORIES.find(cat => cat.key === key).seeds;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function stripMarkdown(str) {
  return str
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`]*`/g, ' ')          // inline code
    .replace(/!\[.*?\]\(.*?\)/g, ' ')  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // preserve link labels, discard destinations
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

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termPattern(term) {
  return '\\b' + term.split(/\s+/).map(escapeRegExp).join('\\s+') + '\\b';
}

// Plural of a vocabulary word, or null when it should match only as written.
// Only nouns get a plural: compromise must read the word as a noun after
// "the" ("the tree"), and the word must not be an adjective on its own
// ("red", "gold", "calm"), which keeps verbs and adjectives from matching
// new forms. Cached; this runs once per vocabulary word.
//   - NO_PLURAL lists nouns whose plural is mostly a verb in descriptions,
//     checked in context on 20 survey objects: "casts a shadow", "does
//     not", "bears an inscription", "a band crosses the forehead", "which
//     highlights the texture".
//   - When compromise returns the word unchanged ("mark"), add "s"; for
//     invariant plurals ("sheep") the extra form simply never matches.
const NO_PLURAL = new Set(['cast', 'doe', 'bear', 'cross', 'highlight']);
const pluralCache = new Map();
function pluralOf(word) {
  if (!pluralCache.has(word)) {
    let plural = null;
    const inContext = nlp('the ' + word).terms().last();
    const alone = nlp(word).terms().last();
    if (!NO_PLURAL.has(word) && inContext.has('#Noun') && !inContext.has('#Verb') && !inContext.has('#Adjective') && !alone.has('#Adjective')) {
      plural = nlp('the ' + word).nouns().toPlural().text().toLowerCase().replace(/^the\s+/, '');
      if (!plural || plural === word) plural = /s$/.test(word) ? null : word + 's';
    }
    pluralCache.set(word, plural);
  }
  return pluralCache.get(word);
}

// Like termPattern, but a vocabulary noun also matches its plural on the last
// word: "tree" matches "trees", "palm tree" matches "palm trees", "man"
// matches "men". Used wherever text is matched against vocabulary lists.
function vocabularyPattern(term) {
  const parts = term.split(/\s+/);
  const last = parts.pop();
  const plural = pluralOf(last);
  const lastPattern = plural ? '(?:' + escapeRegExp(last) + '|' + escapeRegExp(plural) + ')' : escapeRegExp(last);
  return '\\b' + parts.map(part => escapeRegExp(part) + '\\s+').join('') + lastPattern + '\\b';
}

// Stage 1: match whole vocabulary entries, including multi-word seeds.
// Testing entries independently preserves overlapping terms without matching
// "man" inside "woman" or stitching a compound across sentence punctuation.
// A match is reported under the listed term, so "trees" counts as "tree".
const vocabularyPatterns = new WeakMap();
function matchVocabulary(text, seeds) {
  if (!vocabularyPatterns.has(seeds)) {
    vocabularyPatterns.set(seeds, Array.from(seeds, term => [term, new RegExp(vocabularyPattern(term), 'gi')]));
  }
  const matches = new Map();
  for (const [term, re] of vocabularyPatterns.get(seeds)) {
    re.lastIndex = 0;
    const hits = Array.from(text.matchAll(re));
    if (hits.length) matches.set(term, hits);
  }
  return matches;
}

// Stage 1: an excerpt must contain the term, not merely the start of a long
// annotation. Prefer its sentence; center a bounded window on the match when
// that sentence is too long. A missing match yields no fabricated evidence.
function supportingSnippet(body, forms, limit = 160) {
  const clean = stripMarkdown(body || '');
  // Plural-aware, so an excerpt is found for a vocabulary match on "trees".
  const hits = forms.map(form => new RegExp(vocabularyPattern(form), 'i').exec(clean)).filter(Boolean);
  if (!hits.length) return null;
  const match = hits.sort((a, b) => a.index - b.index)[0];
  const before = clean.slice(0, match.index);
  const boundaries = Array.from(before.matchAll(/[.!?]\s+/g));
  const last = boundaries[boundaries.length - 1];
  const sentenceStart = last ? last.index + last[0].length : 0;
  const after = clean.slice(match.index + match[0].length);
  const end = /[.!?](?:\s|$)/.exec(after);
  const sentenceEnd = end ? match.index + match[0].length + end.index + 1 : clean.length;
  const sentence = clean.slice(sentenceStart, sentenceEnd);
  if (sentence.length <= limit) return sentence.trim();
  const offset = match.index - sentenceStart;
  const start = Math.max(0, Math.min(offset - Math.floor((limit - match[0].length) / 2), sentence.length - limit));
  return (start ? '…' : '') + sentence.slice(start, start + limit).trim() + (start + limit < sentence.length ? '…' : '');
}

function annotationEvidence(annotation, snippet, context = {}) {
  const model = annotation.model || null;
  const metadata = model && MODELS[model];
  const hasTarget = context.objectid != null && context.imageid != null && annotation.id != null;
  return {
    annotation_id: annotation.id,
    type: annotation.type,
    source: annotation.source,
    model,
    display_model: metadata ? metadata.name : (model || annotation.source),
    imageid: context.imageid == null ? null : context.imageid,
    url: hasTarget ? '/object/' + encodeURIComponent(context.objectid) + '/image/' + encodeURIComponent(context.imageid)
      + '?annotation=' + encodeURIComponent(annotation.id) + (annotation.type === 'description' ? '#descriptions' : '#other') : null,
    snippet,
  };
}

function representativeOccurrences(occurrences, limit = 3) {
  // One example per source first, then fill remaining slots. This prevents
  // repeated matches in the first provider's output from hiding other sources.
  const selected = [], sources = new Set(), ids = new Set();
  for (const occurrence of occurrences) {
    if (sources.has(occurrence.source) || ids.has(occurrence.annotation_id)) continue;
    selected.push(occurrence); sources.add(occurrence.source); ids.add(occurrence.annotation_id);
    if (selected.length === limit) return selected;
  }
  for (const occurrence of occurrences) {
    if (ids.has(occurrence.annotation_id)) continue;
    selected.push(occurrence); ids.add(occurrence.annotation_id);
    if (selected.length === limit) break;
  }
  return selected;
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
        // Retain distinct annotation evidence; choose representative examples
        // only after aggregation, without altering occurrence-based scoring.
        _occurrences:       [],
      });
    }
    const entry = map.get(key);
    const hasAnnotationEvidence = entry.annotation_ids.has(occ.annotation_id);
    entry.services.add(occ.source);
    entry.annotation_ids.add(occ.annotation_id);
    entry.types.add(occ.type);
    entry.count_total++;
    if (occ.people_related) entry.people_related = true;
    if (occ.concept_type === 'interpretive') entry.interpretive_count++;
    entry.total_count++;
    if (!hasAnnotationEvidence) entry._occurrences.push(occ);

    // Track which services used which variant word (including canonical itself)
    const word = occ.original_text || occ.concept_text;
    if (!entry._variants.has(word)) entry._variants.set(word, new Set());
    entry._variants.get(word).add(occ.source);
  }
  return map;
}

// Stage 2: inspect complete seed terms in original text, independently of NLP
// chunking. Each term retains every distinct supporting annotation, including
// single-provider observations. Repetition does not add annotation support.
function extractConceptRelationships(annotations, context) {
  const families = [];
  for (const [family, vocabulary] of Object.entries(CONCEPT_FAMILIES)) {
    const terms = new Map();
    const seeds = new Set(vocabulary);
    for (const annotation of annotations) {
      for (const term of matchVocabulary(stripMarkdown(annotation.body || ''), seeds).keys()) {
        if (!terms.has(term)) terms.set(term, new Map());
        const snippet = supportingSnippet(annotation.body, [term]);
        if (snippet) terms.get(term).set(annotation.id, annotationEvidence(annotation, snippet, context));
      }
    }
    // A neighborhood needs two observed terms, but no agreement threshold.
    if (terms.size < 2) continue;
    const entries = [...terms].sort(([a], [b]) => a.localeCompare(b)).map(([term, records]) => {
      const evidence = [...records.values()];
      return { term, equivalent_term: canonicalize(term),
        services: [...new Set(evidence.map(e => e.source))].sort(),
        annotations_count: evidence.length, annotation_ids: [...records.keys()],
        example_annotations: evidence };
    });
    const equivalents = new Map();
    for (const entry of entries) {
      if (!equivalents.has(entry.equivalent_term)) equivalents.set(entry.equivalent_term, []);
      equivalents.get(entry.equivalent_term).push(entry.term);
    }
    families.push({ family, relationship: 'shared_family', terms: entries,
      synonym_groups: [...equivalents].filter(([, forms]) => forms.length > 1)
        .map(([concept, forms]) => ({ concept, terms: forms, relationship: 'same_meaning' })) });
  }
  return families;
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

function buildExamples(entry, annotationsById, context) {
  return representativeOccurrences(entry._occurrences).map(occ => {
    const rec = annotationsById.get(occ.annotation_id);
    if (!rec) return null;
    const forms = CANONICAL_TO_FORMS.get(entry.concept) || [occ.original_text || entry.concept];
    const snippet = supportingSnippet(rec.body, forms);
    return snippet ? annotationEvidence(rec, snippet, context) : null;
  }).filter(Boolean);
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

function extractThematicConcepts(descAnnotations, annotationsById, context) {
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
    const supporting = descAnnotations.filter(ann => supportingSnippet(ann.body, [entry.term]));
    entry.example_annotations = representativeOccurrences(supporting.map(ann => ({source: ann.source, annotation_id: ann.id})))
      .map(occ => {
        const ann = annotationsById.get(occ.annotation_id);
        return annotationEvidence(ann, supportingSnippet(ann.body, [entry.term]), context);
      });
    entry.snippet = entry.example_annotations.length ? entry.example_annotations[0].snippet : null;
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Mood palette — expressive/interpretive language across descriptions
// ---------------------------------------------------------------------------

function extractMoodPalette(descAnnotations, context) {
  if (descAnnotations.length === 0) return [];

  const phraseMap = new Map(); // phrase → sources, occurrence count, annotation IDs, evidence

  for (const ann of descAnnotations) {
    const body = stripMarkdown(ann.body || '');
    if (!body) continue;
    const source = ann.source;
    const annId = ann.id;
    const bodyLower = body.toLowerCase();

    // Strategy 1: seed-word extraction — find mood adjectives in context
    for (const [word, hits] of matchVocabulary(body, MOOD_SEEDS)) {
      if (!phraseMap.has(word)) {
        phraseMap.set(word, { phrase: word, sources: new Set(), annotation_ids: new Set(), count: 0, snippets: [] });
      }
      const entry = phraseMap.get(word);
      entry.sources.add(source);
      entry.annotation_ids.add(annId);
      entry.count += hits.length;
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
          phraseMap.set(canonical, { phrase: canonical, sources: new Set(), annotation_ids: new Set(), count: 0, snippets: [] });
        }
        const entry = phraseMap.get(canonical);
        entry.sources.add(source);
        entry.annotation_ids.add(annId);
        entry.count++;
      }
    }

    // Stage 1: retain complete provenance and a match-centered excerpt.
    for (const [phrase, entry] of phraseMap) {
      if (!entry.annotation_ids.has(annId) || entry.snippets.some(s => s.annotation_id === annId)) continue;
      const snippet = supportingSnippet(body, [phrase]);
      if (snippet) entry.snippets.push({ ...annotationEvidence(ann, snippet, context), text: snippet });
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
      occurrences_count: entry.count,
      annotations_count: entry.annotation_ids.size,
      annotation_ids: Array.from(entry.annotation_ids),
      sources:       [...entry.sources],
      snippets:      entry.snippets,
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

// Singular form of one word, cached: "trees" → "tree", "leaves" → "leaf".
// The leading "the" gives compromise enough context to treat a lone word as
// a noun. Words it cannot singularise are returned unchanged.
const singularCache = new Map();
function singularWord(word) {
  if (!singularCache.has(word)) {
    const singular = nlp('the ' + word).nouns().toSingular().text().toLowerCase().replace(/^the\s+/, '');
    singularCache.set(word, singular || word);
  }
  return singularCache.get(word);
}

// Is this word, or its singular, in the vocabulary?
function seedsHaveWord(seeds, word) {
  return seeds.has(word) || seeds.has(singularWord(word));
}

// Which category does a noun phrase belong to? Tried in this order, each
// across all categories, so the most specific evidence wins:
//   1. the whole phrase           "palm tree", "signs of wear"
//   2. its last word (the noun)   "horse-drawn carriage" → carriage
//   3. any other word in it       "black tricorn hat" → black (if hat were unknown)
// Words are singularised ("palm trees" → tree) and hyphenated words split
// ("horse-drawn" → horse, drawn). Pose & Action takes whole-phrase matches
// only: its words are verbs and participles that also occur inside unrelated
// noun phrases ("social standing", "striking feature"), and they are already
// listed as phrases of their own from the text.
function categorizePhrase(phrase) {
  for (const cat of OBSERVATION_CATEGORIES) {
    if (cat.seeds.has(phrase)) return cat.key;
  }
  const words = phrase.split(/[\s-]+/).filter(Boolean);
  const head = words[words.length - 1];
  const wordCategories = OBSERVATION_CATEGORIES.filter(cat => cat.key !== 'action');
  for (const cat of wordCategories) {
    if (seedsHaveWord(cat.seeds, head)) return cat.key;
  }
  for (const cat of wordCategories) {
    if (words.some(word => seedsHaveWord(cat.seeds, word))) return cat.key;
  }
  return 'other';
}

function extractObservations(descAnnotations, regionAnnotations, context) {
  if (descAnnotations.length === 0 && (!regionAnnotations || regionAnnotations.length === 0)) return {};

  // Stage 1 count contract: count/occurrences_count are textual matches plus
  // region annotations; annotations_count counts distinct supporting records.
  // Per-type annotation counts keep detections separate from prose mentions.
  const phraseMap = new Map();

  function ensureEntry(canonical) {
    if (!phraseMap.has(canonical)) {
      phraseMap.set(canonical, { sources: new Set(), annotation_ids: new Set(), description_ids: new Set(), region_ids: new Set(), count: 0, spatial: new Map(), snippets: [] });
    }
    return phraseMap.get(canonical);
  }

  // --- LLM description extraction (existing logic) ---
  for (const ann of descAnnotations) {
    const clean = stripMarkdown(ann.body || '');
    if (!clean.trim()) continue;
    const source = ann.source;
    const annId = ann.id;
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
      matchedCanonicals.add(canonical);
    }

    // Stage 1: noun and adjective+noun extractors can return the same
    // candidate. Count text matches once per canonical/annotation instead of
    // counting extractor hits. Distinct annotation support is a separate metric.
    for (const canonical of matchedCanonicals) {
      const entry = phraseMap.get(canonical);
      if (entry.description_ids.has(annId)) continue;
      entry.annotation_ids.add(annId); entry.description_ids.add(annId);
      const forms = CANONICAL_TO_FORMS.get(canonical) || [canonical];
      const re = new RegExp(forms.map(termPattern).join('|'), 'gi');
      entry.count += Array.from(clean.matchAll(re)).length;
      const snippet = supportingSnippet(clean, forms);
      if (snippet) entry.snippets.push({ ...annotationEvidence(ann, snippet, context), text: snippet });
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
      if (entry.region_ids.has(ann.id)) continue;
      entry.annotation_ids.add(ann.id); entry.region_ids.add(ann.id);
      entry.count++;
      const snippet = supportingSnippet(ann.body, CANONICAL_TO_FORMS.get(canonical) || [phrase]);
      if (snippet) entry.snippets.push({ ...annotationEvidence(ann, snippet, context), text: snippet });

      // Track bounding-box instances per service
      const src = ann.source;
      entry.spatial.set(src, (entry.spatial.get(src) || 0) + 1);
    }
  }

  // --- Vocabulary words for pose and condition, matched in the text ---
  // Noun-phrase extraction misses "clasped", "seated" or "faded"; list each
  // word found as a phrase of its own, with an excerpt for context.
  for (const ann of descAnnotations) {
    const clean = stripMarkdown(ann.body || '');
    if (!clean.trim()) continue;
    for (const key of VOCABULARY_PHRASE_CATEGORIES) {
      for (const [term, hits] of matchVocabulary(clean, categorySeeds(key))) {
        const entry = ensureEntry(term);
        entry.category = key;
        entry.sources.add(ann.source);
        if (entry.description_ids.has(ann.id)) continue;
        entry.annotation_ids.add(ann.id); entry.description_ids.add(ann.id);
        entry.count += hits.length;
        const snippet = supportingSnippet(clean, [term]);
        if (snippet) entry.snippets.push({ ...annotationEvidence(ann, snippet, context), text: snippet });
      }
    }
  }

  // Bucket into categories, sort by source count then total count
  const buckets = {};
  for (const cat of OBSERVATION_CATEGORIES) buckets[cat.key] = [];
  buckets['other'] = [];

  for (const [phrase, data] of phraseMap) {
    const cat = data.category || categorizePhrase(phrase);
    const obs = {
      phrase,
      sources:       Array.from(data.sources),
      sources_count: data.sources.size,
      count:         data.count,
      occurrences_count: data.count,
      annotations_count: data.annotation_ids.size,
      annotation_ids: Array.from(data.annotation_ids),
      description_annotations_count: data.description_ids.size,
      region_annotations_count: data.region_ids.size,
      snippets:      data.snippets,
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
      .map((entry, rank) => rank < CONFIG.observations_snippet_entries ? entry : { ...entry, snippets: [] });
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
// Coverage Radar — per-source term coverage across dimensions
// ---------------------------------------------------------------------------

const RADAR_DIMENSIONS = [
  { key: 'people',             label: 'People & Figures',     seeds: categorySeeds('people') },
  { key: 'objects',            label: 'Objects & Artefacts',  seeds: categorySeeds('objects') },
  { key: 'setting',            label: 'Setting & Space',      seeds: categorySeeds('setting') },
  { key: 'colour_light',       label: 'Colour & Light',       seeds: categorySeeds('colour_light') },
  { key: 'action',             label: 'Pose & Action',        seeds: categorySeeds('action') },
  { key: 'animals',            label: 'Animals & Creatures',  seeds: categorySeeds('animals') },
  { key: 'material_technique', label: 'Material & Technique', seeds: categorySeeds('material_technique') },
  { key: 'condition',          label: 'Condition & State',    seeds: categorySeeds('condition') },
  { key: 'mood',               label: 'Mood & Atmosphere',    seeds: MOOD_SEEDS },
];

function extractCoverageRadar(descAnnotations, object_info, context) {
  // Stage 3: one series per annotation, not a silently pooled model history.
  // A provider series remains the union of its outputs. Both views use maxima
  // from the complete AI provider unions, so switching/hiding never rescales.
  const dimensions = () => Object.fromEntries(RADAR_DIMENSIONS.map(d => [d.key, new Set()]));
  const providers = new Map(), outputs = [];
  const seen = new Set();
  for (const annotation of descAnnotations) {
    const body = stripMarkdown(annotation.body || '').trim();
    if (!body || seen.has(annotation.id)) continue;
    seen.add(annotation.id);
    const source = annotation.source;
    if (!providers.has(source)) providers.set(source, { terms: dimensions(), ids: dimensions(), outputs: [] });
    const provider = providers.get(source), terms = dimensions();
    for (const d of RADAR_DIMENSIONS) {
      for (const term of matchVocabulary(body, d.seeds).keys()) {
        terms[d.key].add(term);
        provider.terms[d.key].add(term);
        provider.ids[d.key].add(annotation.id);
      }
    }
    const { snippet, ...metadata } = annotationEvidence(annotation, null, context);
    const output = { ...metadata, createdate: annotation.createdate || null,
      word_count: body.split(/\s+/).length, _terms: terms };
    outputs.push(output); provider.outputs.push(output);
  }
  const maxPerDim = Object.fromEntries(RADAR_DIMENSIONS.map(d => [d.key, 0]));
  for (const provider of providers.values()) {
    for (const d of RADAR_DIMENSIONS) maxPerDim[d.key] = Math.max(maxPerDim[d.key], provider.terms[d.key].size);
  }
  function values(terms, ids) {
    return Object.fromEntries(RADAR_DIMENSIONS.map(d => {
      const raw = terms[d.key].size, maximum = maxPerDim[d.key];
      return [d.key, { raw, normalized: maximum ? raw / maximum : null,
        exceeds_scale: raw > maximum, terms: [...terms[d.key]].sort(),
        annotation_ids: ids ? [...ids[d.key]] : [] }];
    }));
  }
  const sources = [...providers].sort(([a], [b]) => a.localeCompare(b)).map(([source, provider]) => ({
    source, output_count: provider.outputs.length,
    model_count: new Set(provider.outputs.filter(o => o.model).map(o => o.model)).size,
    word_count: provider.outputs.reduce((sum, o) => sum + o.word_count, 0),
    values: values(provider.terms, provider.ids),
  }));
  const serializedOutputs = outputs.map(({ _terms, ...output }) => ({ ...output,
    values: values(_terms, Object.fromEntries(RADAR_DIMENSIONS.map(d => [d.key,
      _terms[d.key].size ? new Set([output.annotation_id]) : new Set()]))),
  }));
  // Object language never sets an AI axis maximum. Preserve overflow and the
  // undefined ratio for zero-coverage AI axes; the renderer marks/clamps these
  // explicitly instead of stretching the chart or discarding raw evidence.
  let reference = null;
  if (object_info && object_info.labeltext) {
    const terms = dimensions();
    for (const d of RADAR_DIMENSIONS) {
      for (const term of matchVocabulary(stripMarkdown(object_info.labeltext), d.seeds).keys()) terms[d.key].add(term);
    }
    reference = { label: 'Object wall label', values: values(terms), body: object_info.labeltext };
  }
  return { dimensions: RADAR_DIMENSIONS.map(d => ({ key: d.key, label: d.label })),
    sources, outputs: serializedOutputs, reference, max_per_dimension: maxPerDim,
    scale_basis: 'complete_ai_provider_unions' };
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

  // Stage 1: region detections, OCR, and faces are annotations too. Keep their
  // observations/flags available even when there are no full-image tags or prose.
  if (![tagAnnotations, regionAnnotations, descAnnotations, faceAnnotations, textAnnotations].some(records => records.length)) {
    return {
      objectid:          object_info ? object_info.id : null,
      imageid:           display_image ? display_image.imageid : null,
      status:            'no_annotations',
      algorithm_version: ALGORITHM_VERSION,
      generated_at:      new Date().toISOString(),
    };
  }

  const context = { objectid: object_info ? object_info.id : null, imageid: display_image ? display_image.imageid : null };

  // Extract concept occurrences (tags + noun chunks from descriptions)
  const occurrences = [];
  for (const ann of tagAnnotations)  occurrences.push(...extractFromTag(ann));
  for (const ann of descAnnotations) occurrences.push(...extractFromDescription(ann));

  // Thematic extraction — TF-IDF across LLM descriptions only
  const thematicConcepts = extractThematicConcepts(descAnnotations, annotationsById, context);

  // Observations — broad extraction, categorized, no agreement threshold
  const observations = extractObservations(descAnnotations, regionAnnotations, context);

  // Mood palette — expressive/interpretive language from descriptions
  const moodPalette = extractMoodPalette(descAnnotations, context);

  // Coverage radar — per-source term coverage across dimensions
  const coverageRadar = extractCoverageRadar(descAnnotations, object_info, context);

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
      example_annotations:  buildExamples(entry, annotationsById, context),
    });
  }
  agreementConcepts.sort((a, b) => b.consensus_score - a.consensus_score);
  const topConcepts = agreementConcepts.slice(0, CONFIG.top_N);

  // Stage 2: co-occurring concepts are neither conflicts nor independent
  // agreement votes. Expose curated relationships with exact surface evidence.
  const conceptRelationships = extractConceptRelationships(
    [...tagAnnotations, ...regionAnnotations, ...descAnnotations], context);

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
  // Overview block — summary facts for the Overview tab (see overview.js)
  // -------------------------------------------------------------------------
  // Noun phrases already extracted above, regrouped per description so the
  // overview can find phrases that only one description uses.
  const phrasesByDescription = new Map();
  for (const occ of occurrences) {
    if (occ.type !== 'description') continue;
    if (!phrasesByDescription.has(occ.annotation_id)) phrasesByDescription.set(occ.annotation_id, new Set());
    phrasesByDescription.get(occ.annotation_id).add(occ.original_text || occ.concept_text);
  }
  const overviewBlock = overview.computeOverview({
    descriptions: descAnnotations
      .map(ann => ({ id: ann.id, source: ann.source, body: stripMarkdown(ann.body || '').trim(), raw: ann.body || '' }))
      .filter(d => d.body),
    observations,
    moodPalette,
    coverageRadar,
    phrasesByDescription,
    objectInfo: object_info,
    ocrText: textAnnotations.map(ann => ann.body || '').join(' '),
  });

  // -------------------------------------------------------------------------
  // Positions block — where the descriptions place things (see positions.js)
  // -------------------------------------------------------------------------
  const positionsBlock = positions.computePositions({
    descriptions: descAnnotations
      .map(ann => ({ id: ann.id, source: ann.source, body: (ann.body || '').trim() }))
      .filter(d => d.body),
    records: ai_data,
    image: display_image,
    objectInfo: object_info,
  });

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
      concept_relationships_returned: conceptRelationships.length,
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
    concept_relationships: conceptRelationships,
    observations:        observations,
    mood_palette:        moodPalette,
    coverage_radar:      coverageRadar,
    overview:            overviewBlock,
    positions:           positionsBlock,
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
