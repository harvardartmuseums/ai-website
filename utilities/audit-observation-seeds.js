'use strict';

/**
 * audit-observation-seeds.js
 *
 * Pulls all distinct region-tag terms from the Harvard Art Museums annotation
 * API and classifies them against the current OBSERVATION_CATEGORIES seeds.
 * Outputs:
 *   - Terms already covered by a category
 *   - Uncategorized terms (candidates for new seeds)
 *   - Per-category coverage stats
 *
 * Usage:
 *   node utilities/audit-observation-seeds.js
 *
 * Requires a valid API_KEY in .env
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const querystring = require('querystring');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env['API_KEY'];
if (!API_KEY) {
  console.error('ERROR: No API_KEY found in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the current observation categories from perspectives.js by extracting
// the seed sets. We replicate them here to avoid require() issues with the
// compromise dependency in a standalone script context.
// ---------------------------------------------------------------------------

const PEOPLE_LEXICON = new Set([
  'man','woman','boy','girl','child','person','figure','figures','people',
  'crowd','group of people','family','soldier','soldiers','bather','bathers',
  'nude','pilgrim','peasant','peasants','merchant',
  'portrait','self-portrait','group portrait','figure study',
  'saint','apostle','angel','angels','madonna','christ','deity','goddess',
  'buddha','bodhisattva','prophet','martyr','evangelist','god',
  'human face','human arm','human eye','human nose','human head',
  'human hair','human leg','human mouth','human hand','human ear',
  'human foot','human beard',
  'adult','male','female','baby','teen','bride',
]);

const CATEGORIES = [
  {
    key: 'people',
    label: 'People & Figures',
    seeds: PEOPLE_LEXICON,
  },
  {
    key: 'animals',
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
    key: 'action',
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
    key: 'objects',
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
    key: 'setting',
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
      'house','building','skyscraper','office building','lighthouse','porch',
      'fireplace','fountain','swimming pool','stairs',
      'tree','plant','flower','houseplant','palm tree','flowerpot',
    ]),
  },
  {
    key: 'colour_light',
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
    key: 'material_technique',
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

// Terms that perspectives.js ignores outright
const IGNORE_LIST = new Set([
  'artwork','picture','illustration','image','painting','drawing','photograph',
  'background','foreground','scene','composition','detail','view','subject',
  'work','canvas','piece','photo','depiction','representation','color','colour',
  'light','shadow','texture','surface','figure',
  'beautiful','ugly','boring','stunning','interesting','typical','unusual',
  'nice','great','good','bad','old','new',
]);

// ---------------------------------------------------------------------------
// Classification logic — mirrors categorizePhrase in perspectives.js
// ---------------------------------------------------------------------------

function classify(term) {
  const lower = term.toLowerCase();
  const tokens = lower.split(/\s+/);
  for (const cat of CATEGORIES) {
    // Check full phrase first (handles multi-word seeds like "human face")
    if (cat.seeds.has(lower)) return cat.key;
    for (const token of tokens) {
      if (cat.seeds.has(token)) return cat.key;
    }
  }
  return 'uncategorized';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching all region-tag terms from annotation API...\n');

  const aggs = {
    by_term: {
      terms: {
        field: 'body.exact',
        size: 45000,
      },
      aggs: {
        by_source: {
          terms: { field: 'source', size: 20 },
        },
      },
    },
  };

  const qs = {
    q: 'type:tag AND feature:region',
    size: 0,
    apikey: API_KEY,
    aggregation: JSON.stringify(aggs),
  };

  const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
  const res = await fetch(url);
  const output = await res.json();

  if (!output.aggregations || !output.aggregations.by_term) {
    console.error('Unexpected API response:', JSON.stringify(output).slice(0, 500));
    process.exit(1);
  }

  const buckets = output.aggregations.by_term.buckets;
  console.log(`Total distinct region-tag terms: ${buckets.length}\n`);

  // Classify each term
  const categorized = {};
  const uncategorized = [];
  const ignored = [];

  for (const bucket of buckets) {
    const term = bucket.key.toLowerCase().trim();
    const sources = (bucket.by_source ? bucket.by_source.buckets : []).map(b => b.key);
    const entry = {
      term,
      original: bucket.key,
      doc_count: bucket.doc_count,
      sources,
    };

    if (IGNORE_LIST.has(term)) {
      ignored.push(entry);
      continue;
    }

    const cat = classify(term);
    if (cat === 'uncategorized') {
      uncategorized.push(entry);
    } else {
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push(entry);
    }
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log('='.repeat(70));
  console.log(' COVERAGE SUMMARY');
  console.log('='.repeat(70));
  console.log('');

  let totalCategorized = 0;
  for (const cat of CATEGORIES) {
    const entries = categorized[cat.key] || [];
    totalCategorized += entries.length;
    console.log(`  ${cat.label.padEnd(22)} ${String(entries.length).padStart(5)} terms covered`);
  }
  console.log('  ' + '-'.repeat(40));
  console.log(`  ${'Categorized'.padEnd(22)} ${String(totalCategorized).padStart(5)} terms`);
  console.log(`  ${'Ignored'.padEnd(22)} ${String(ignored.length).padStart(5)} terms`);
  console.log(`  ${'Uncategorized'.padEnd(22)} ${String(uncategorized.length).padStart(5)} terms`);
  console.log('');

  // Sort uncategorized by doc_count descending (most common first)
  uncategorized.sort((a, b) => b.doc_count - a.doc_count);

  console.log('='.repeat(70));
  console.log(' UNCATEGORIZED TERMS (sorted by frequency)');
  console.log('='.repeat(70));
  console.log('');
  console.log('  Term'.padEnd(36) + 'Count'.padStart(8) + '  Sources');
  console.log('  ' + '-'.repeat(66));

  for (const entry of uncategorized) {
    const termCol = ('  ' + entry.term).padEnd(36);
    const countCol = String(entry.doc_count).padStart(8);
    const srcCol = '  ' + entry.sources.join(', ');
    console.log(termCol + countCol + srcCol);
  }

  // ---------------------------------------------------------------------------
  // Write JSON report for further processing
  // ---------------------------------------------------------------------------

  const report = {
    generated_at: new Date().toISOString(),
    total_region_terms: buckets.length,
    categorized_count: totalCategorized,
    uncategorized_count: uncategorized.length,
    ignored_count: ignored.length,
    by_category: {},
    uncategorized,
    ignored,
  };

  for (const cat of CATEGORIES) {
    report.by_category[cat.key] = {
      label: cat.label,
      terms: (categorized[cat.key] || []).map(e => e.term),
    };
  }

  const outPath = path.resolve(__dirname, 'observation-seeds-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report written to: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
