'use strict';

/**
 * audit-mood-seeds.js
 *
 * Pulls LLM description annotations from the Harvard Art Museums API and
 * extracts mood/atmosphere language using three strategies:
 *   1. Seed word matching against MOOD_SEEDS
 *   2. Pattern prefix extraction ("sense of X", "evokes X", etc.)
 *   3. Semantic similarity via transformers.js embeddings — finds adjectives
 *      and phrases that are close in embedding space to mood/atmosphere anchors
 *
 * Supports full-corpus processing with incremental caching:
 *   - Descriptions are streamed from the API and cached locally as JSONL
 *   - Extraction maps (seed/pattern/adj counts) are serialized between runs
 *   - Embeddings are cached per-phrase so re-runs with different thresholds
 *     don't require re-embedding
 *   - Incremental mode fetches only records newer than last run
 *
 * Usage:
 *   node utilities/audit-mood-seeds.js [options]
 *
 * Options:
 *   --pages N          Max pages to fetch (default: all available)
 *   --threshold 0.50   Similarity threshold for semantic discovery
 *   --full             Force full re-fetch (ignore cache)
 *   --no-fetch         Skip API fetch, use cached corpus only
 *   --no-embed         Skip embedding step, report extractions only
 *
 * Requires a valid API_KEY in .env
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const API_KEY = process.env['API_KEY'];
if (!API_KEY) {
  console.error('ERROR: No API_KEY found in .env');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};
const hasFlag = (name) => args.includes(name);

const MAX_PAGES = hasFlag('--pages') ? parseInt(getArg('--pages', '999999'), 10) : 999999;
const SIMILARITY_THRESHOLD = parseFloat(getArg('--threshold', '0.50'));
const FORCE_FULL = hasFlag('--full');
const NO_FETCH = hasFlag('--no-fetch');
const NO_EMBED = hasFlag('--no-embed');

// ---------------------------------------------------------------------------
// Cache paths
// ---------------------------------------------------------------------------

const CACHE_DIR = path.resolve(__dirname, 'mood-cache');
const CORPUS_PATH = path.join(CACHE_DIR, 'corpus.jsonl');
const META_PATH = path.join(CACHE_DIR, 'corpus-meta.json');
const EXTRACTIONS_PATH = path.join(CACHE_DIR, 'extractions.json');
const EMBEDDINGS_PATH = path.join(CACHE_DIR, 'embeddings.json');
const ANCHORS_PATH = path.join(CACHE_DIR, 'anchors.json');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Current mood seeds (mirrored from perspectives.js)
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

const NUM_ANCHOR_CLUSTERS = 12;

const SEMANTIC_EXCLUDE = new Set([
  'large','small','long','short','high','low','wide','narrow',
  'left','right','upper','lower','front','back','central',
  'dark','light','bright','deep','thick','thin','flat','round',
  'red','blue','green','yellow','orange','purple','white','black','brown',
  'golden','silver','grey','gray','pink','warm','cool',
  'painting','drawing','image','artwork','figure','composition','scene',
  'depicts','features','shows','appears','includes','contains',
  'also','very','much','many','most','some','other','each','both',
  'first','second','third','only','just','still','even','well',
]);

// ---------------------------------------------------------------------------
// Transformers.js setup
// ---------------------------------------------------------------------------

let pipeline;
let embedder = null;

async function initEmbedder() {
  const { pipeline: pipelineFn } = await import('@huggingface/transformers');
  pipeline = pipelineFn;
  console.log('  Loading embedding model (all-MiniLM-L6-v2)...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
  });
  console.log('  Model loaded.\n');
}

async function embed(texts) {
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

// ---------------------------------------------------------------------------
// Embedding cache — persists vectors between runs
// ---------------------------------------------------------------------------

let embeddingCache = new Map();

function loadEmbeddingCache() {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));
      embeddingCache = new Map(Object.entries(data));
      console.log(`  Loaded ${embeddingCache.size} cached embeddings.`);
    } catch (e) {
      console.log('  Could not load embedding cache, starting fresh.');
      embeddingCache = new Map();
    }
  }
}

function saveEmbeddingCache() {
  const obj = Object.fromEntries(embeddingCache);
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(obj));
  console.log(`  Saved ${embeddingCache.size} embeddings to cache.`);
}

async function embedWithCache(texts) {
  const uncached = [];
  const uncachedIndices = [];

  for (let i = 0; i < texts.length; i++) {
    if (!embeddingCache.has(texts[i])) {
      uncached.push(texts[i]);
      uncachedIndices.push(i);
    }
  }

  if (uncached.length > 0) {
    const BATCH_SIZE = 64;
    for (let b = 0; b < uncached.length; b += BATCH_SIZE) {
      const batch = uncached.slice(b, b + BATCH_SIZE);
      const embeddings = await embed(batch);
      for (let j = 0; j < batch.length; j++) {
        embeddingCache.set(batch[j], embeddings[j]);
      }
    }
  }

  return texts.map(t => embeddingCache.get(t));
}

// ---------------------------------------------------------------------------
// K-means clustering
// ---------------------------------------------------------------------------

function kmeans(vectors, k, maxIter = 50) {
  const dim = vectors[0].length;
  const n = vectors.length;

  const centroids = [];
  centroids.push(vectors[Math.floor(Math.random() * n)].slice());

  for (let c = 1; c < k; c++) {
    const dists = vectors.map(v => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = 1 - cosineSim(v, cent);
        if (d < minD) minD = d;
      }
      return minD;
    });
    const sum = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push(vectors[i].slice());
        break;
      }
    }
    if (centroids.length === c) centroids.push(vectors[Math.floor(Math.random() * n)].slice());
  }

  let assignments = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosineSim(vectors[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }
    if (!changed) break;

    for (let c = 0; c < k; c++) {
      const members = [];
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) members.push(vectors[i]);
      }
      if (members.length === 0) continue;
      const mean = new Array(dim).fill(0);
      for (const m of members) {
        for (let d = 0; d < dim; d++) mean[d] += m[d];
      }
      for (let d = 0; d < dim; d++) mean[d] /= members.length;
      centroids[c] = normalize(mean);
    }
  }

  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) {
    clusters[assignments[i]].push(i);
  }

  return { centroids, assignments, clusters };
}

// ---------------------------------------------------------------------------
// Data-driven anchor generation (with caching)
// ---------------------------------------------------------------------------

function seedListHash() {
  return Array.from(MOOD_SEEDS).sort().join('|');
}

async function buildDataDrivenAnchors(seedsFound) {
  const currentHash = seedListHash();

  // Check if cached anchors are still valid
  if (fs.existsSync(ANCHORS_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(ANCHORS_PATH, 'utf8'));
      if (cached.seed_hash === currentHash) {
        console.log('  Using cached anchors (seed list unchanged).\n');
        return { centroids: cached.centroids, labels: cached.labels };
      }
    } catch (e) { /* fall through to recompute */ }
  }

  const anchorSeeds = seedsFound.slice(0, 60).map(s => s.word);

  if (anchorSeeds.length < NUM_ANCHOR_CLUSTERS) {
    console.log(`  Only ${anchorSeeds.length} seeds found — using all as individual anchors.`);
    const embeddings = await embedWithCache(anchorSeeds);
    return { centroids: embeddings, labels: anchorSeeds.map(s => [s]) };
  }

  console.log(`  Embedding top ${anchorSeeds.length} corpus seeds for clustering...`);
  const embeddings = await embedWithCache(anchorSeeds);

  console.log(`  Running k-means (k=${NUM_ANCHOR_CLUSTERS})...`);
  const { centroids, clusters } = kmeans(embeddings, NUM_ANCHOR_CLUSTERS);

  const labels = clusters.map(memberIndices => {
    return memberIndices.map(i => anchorSeeds[i]).slice(0, 3);
  });

  const validCentroids = [];
  const validLabels = [];
  for (let i = 0; i < centroids.length; i++) {
    if (clusters[i].length > 0) {
      validCentroids.push(centroids[i]);
      validLabels.push(labels[i]);
    }
  }

  console.log(`  Derived ${validCentroids.length} anchor clusters from corpus:\n`);
  for (let i = 0; i < validLabels.length; i++) {
    console.log(`    Cluster ${i + 1}: ${validLabels[i].join(', ')} (${clusters[i].length} seeds)`);
  }
  console.log('');

  // Cache anchors
  fs.writeFileSync(ANCHORS_PATH, JSON.stringify({
    seed_hash: currentHash,
    centroids: validCentroids,
    labels: validLabels,
    generated_at: new Date().toISOString(),
  }));

  return { centroids: validCentroids, labels: validLabels };
}

// ---------------------------------------------------------------------------
// Corpus fetching — streaming to JSONL with incremental support
// ---------------------------------------------------------------------------

function loadMeta() {
  if (fs.existsSync(META_PATH)) {
    try { return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); }
    catch (e) { return null; }
  }
  return null;
}

function saveMeta(meta) {
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

async function fetchAndCacheCorpus() {
  const meta = FORCE_FULL ? null : loadMeta();
  const isIncremental = !!meta && !FORCE_FULL;

  let query = 'type:description';
  if (isIncremental && meta.last_createdate) {
    query += ` AND createdate:>${meta.last_createdate}`;
    console.log(`  Incremental mode: fetching records after ${meta.last_createdate}`);
  } else {
    console.log('  Full corpus fetch mode.');
    if (fs.existsSync(CORPUS_PATH) && !FORCE_FULL) {
      console.log('  (corpus.jsonl exists — use --full to re-fetch)');
    }
    if (FORCE_FULL && fs.existsSync(CORPUS_PATH)) {
      fs.unlinkSync(CORPUS_PATH);
    }
  }

  const appendStream = fs.createWriteStream(CORPUS_PATH, { flags: 'a' });
  let page = 1;
  let fetched = 0;
  let lastCreatedate = meta ? meta.last_createdate : null;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    const qs = {
      q: query,
      size: 100,
      page,
      sort: 'createdate',
      sortorder: 'asc',
      fields: 'body,source,createdate,id',
      apikey: API_KEY,
    };

    const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
    process.stdout.write(`  Page ${page}...`);

    let data;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(` HTTP ${res.status}, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      data = await res.json();
    } catch (e) {
      console.log(` network error, retrying in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (!data.records || data.records.length === 0) {
      hasMore = false;
      process.stdout.write(' no more records.\n');
      break;
    }

    for (const rec of data.records) {
      appendStream.write(JSON.stringify({
        id: rec.id,
        body: rec.body,
        source: rec.source,
        createdate: rec.createdate,
      }) + '\n');
      if (rec.createdate && (!lastCreatedate || rec.createdate > lastCreatedate)) {
        lastCreatedate = rec.createdate;
      }
    }

    fetched += data.records.length;
    process.stdout.write(` +${data.records.length} (total new: ${fetched})\n`);

    const info = data.info || {};
    hasMore = page < (info.pages || 0);
    page++;

    await new Promise(r => setTimeout(r, 250));
  }

  appendStream.end();
  await new Promise(resolve => appendStream.on('finish', resolve));

  // Update meta
  const totalLines = await countLines(CORPUS_PATH);
  const newMeta = {
    last_createdate: lastCreatedate,
    total_records: totalLines,
    last_fetch: new Date().toISOString(),
    last_fetch_new_records: fetched,
  };
  saveMeta(newMeta);

  console.log(`\n  Corpus cache: ${totalLines} total records. Fetched ${fetched} new this run.`);
  return newMeta;
}

async function countLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  let count = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Streaming extraction — process corpus line by line, build Maps
// ---------------------------------------------------------------------------

function stripMarkdown(str) {
  return str
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[.*?\]\(.*?\)/g, ' ')
    .replace(/#{1,6}\s*/g, ' ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/>\s*/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAdjPhrases(text) {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3);
  const adjSuffixes = ['ous','ive','ful','less','ent','ant','ine','ile','ial','ical','esque'];
  const phrases = new Set();

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (SEMANTIC_EXCLUDE.has(w)) continue;
    if (MOOD_SEEDS.has(w)) continue;

    const isAdj = adjSuffixes.some(s => w.endsWith(s));
    if (isAdj && w.length > 4) {
      phrases.add(w);
      if (i + 1 < words.length && !SEMANTIC_EXCLUDE.has(words[i + 1])) {
        phrases.add(w + ' ' + words[i + 1]);
      }
    }
  }
  return phrases;
}

// Serializable extraction state
function emptyExtractions() {
  return {
    seedHits: {},       // word → { count, sources: [] }
    patternHits: {},    // phrase → { count, sources: [] }
    adjCounts: {},      // phrase → { count, sources: [] }
    nounOfPatterns: {}, // prefix → { totalCount, sources: [], completions: { phrase: { count, sources: [] } } }
    verbPatterns: {},   // verb → same structure
    processedIds: new Set(),
    totalProcessed: 0,
  };
}

function loadExtractions() {
  if (fs.existsSync(EXTRACTIONS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(EXTRACTIONS_PATH, 'utf8'));
      data.processedIds = new Set(data.processedIds || []);
      console.log(`  Loaded cached extractions (${data.totalProcessed} records processed).`);
      return data;
    } catch (e) {
      console.log('  Could not load extractions cache, starting fresh.');
    }
  }
  return emptyExtractions();
}

function saveExtractions(ext) {
  const serializable = {
    ...ext,
    processedIds: Array.from(ext.processedIds),
  };
  fs.writeFileSync(EXTRACTIONS_PATH, JSON.stringify(serializable));
  console.log(`  Saved extractions (${ext.totalProcessed} records).`);
}

function mergeIntoMap(map, key, source) {
  if (!map[key]) map[key] = { count: 0, sources: [] };
  map[key].count++;
  if (!map[key].sources.includes(source)) map[key].sources.push(source);
}

function processRecord(rec, ext) {
  if (ext.processedIds.has(rec.id)) return;

  const body = stripMarkdown(rec.body || '');
  if (!body) return;
  const source = rec.source || 'unknown';
  const bodyLower = body.toLowerCase();
  const words = bodyLower.replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3);

  // Seed hits
  for (const word of words) {
    if (MOOD_SEEDS.has(word)) {
      mergeIntoMap(ext.seedHits, word, source);
    }
  }

  // Pattern extraction
  for (const prefix of MOOD_PATTERN_PREFIXES) {
    const re = new RegExp('\\b' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([a-z][a-z\\s-]{1,30}?)(?=[.,;:!?\\)]|\\s(?:and|but|or|that|which|while|in|on|with|the|a)\\b|$)', 'gi');
    let match;
    while ((match = re.exec(bodyLower)) !== null) {
      let extracted = match[1].trim().replace(/\s+/g, ' ');
      extracted = extracted.replace(/\s+(the|a|an|and|or|its|this|that|is|are|was)$/i, '').trim();
      if (extracted.length < 3 || extracted.split(/\s+/).length > 4) continue;

      const full = prefix + ' ' + extracted;
      mergeIntoMap(ext.patternHits, full, source);
    }
  }

  // Adjective candidates
  const adjPhrases = extractAdjPhrases(body);
  for (const phrase of adjPhrases) {
    mergeIntoMap(ext.adjCounts, phrase, source);
  }

  // Prefix discovery: [noun] of [X]
  const frameNounRe = /\b([a-z]+(?:\s+[a-z]+)?)\s+of\s+([a-z][a-z\s-]{2,25}?)(?=[.,;:!?)\]]|\s(?:and|but|or|that|which|while|in|on|with|the|a)\b|$)/gi;
  let m;
  frameNounRe.lastIndex = 0;
  while ((m = frameNounRe.exec(bodyLower)) !== null) {
    const prefix = m[1].trim();
    let completion = m[2].trim().replace(/\s+(the|a|an|and|or|its|this|that)$/i, '').trim();
    if (completion.length < 3) continue;
    const key = prefix + ' of';
    if (!ext.nounOfPatterns[key]) ext.nounOfPatterns[key] = { totalCount: 0, sources: [], completions: {} };
    const entry = ext.nounOfPatterns[key];
    entry.totalCount++;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (!entry.completions[completion]) entry.completions[completion] = { count: 0, sources: [] };
    entry.completions[completion].count++;
    if (!entry.completions[completion].sources.includes(source)) entry.completions[completion].sources.push(source);
  }

  // Prefix discovery: [verb] [X]
  const verbRe = /\b(evokes?|suggests?|conveys?|radiates?|emanates?|exudes?|projects?|creates?|conjures?|imparts?|inspires?|instills?|elicits?|captures?|embodies?|reflects?|expresses?|communicates?|transmits?|generates?|produces?|infuses?|pervades?|permeates?|envelops?)\s+(?:a\s+)?([a-z][a-z\s-]{2,25}?)(?=[.,;:!?)\]]|\s(?:and|but|or|that|which|while|in|on|with|the|a)\b|$)/gi;
  verbRe.lastIndex = 0;
  while ((m = verbRe.exec(bodyLower)) !== null) {
    const verb = m[1].trim().replace(/s$/, '');
    let completion = m[2].trim().replace(/\s+(the|a|an|and|or|its|this|that)$/i, '').trim();
    if (completion.length < 3) continue;
    if (!ext.verbPatterns[verb]) ext.verbPatterns[verb] = { totalCount: 0, sources: [], completions: {} };
    const entry = ext.verbPatterns[verb];
    entry.totalCount++;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (!entry.completions[completion]) entry.completions[completion] = { count: 0, sources: [] };
    entry.completions[completion].count++;
    if (!entry.completions[completion].sources.includes(source)) entry.completions[completion].sources.push(source);
  }

  // [participle] with [X]
  const withRe = /\b([a-z]+ed)\s+with\s+([a-z][a-z\s-]{2,25}?)(?=[.,;:!?)\]]|\s(?:and|but|or|that|which|while|in|on|with|the|a)\b|$)/gi;
  withRe.lastIndex = 0;
  while ((m = withRe.exec(bodyLower)) !== null) {
    const participle = m[1].trim();
    let completion = m[2].trim().replace(/\s+(the|a|an|and|or|its|that)$/i, '').trim();
    if (completion.length < 3) continue;
    const key = participle + ' with';
    if (!ext.nounOfPatterns[key]) ext.nounOfPatterns[key] = { totalCount: 0, sources: [], completions: {} };
    const entry = ext.nounOfPatterns[key];
    entry.totalCount++;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (!entry.completions[completion]) entry.completions[completion] = { count: 0, sources: [] };
    entry.completions[completion].count++;
    if (!entry.completions[completion].sources.includes(source)) entry.completions[completion].sources.push(source);
  }

  ext.processedIds.add(rec.id);
  ext.totalProcessed++;
}

async function streamExtract(ext) {
  if (!fs.existsSync(CORPUS_PATH)) {
    console.log('  No corpus cache found. Run without --no-fetch first.');
    return;
  }

  const startProcessed = ext.totalProcessed;
  let lineCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(CORPUS_PATH),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }
    processRecord(rec, ext);

    if (lineCount % 10000 === 0) {
      process.stdout.write(`  Processed ${lineCount} lines (${ext.totalProcessed - startProcessed} new)...\r`);
    }
  }

  const newRecords = ext.totalProcessed - startProcessed;
  console.log(`  Stream complete: ${lineCount} lines read, ${newRecords} new records processed.`);
}

// ---------------------------------------------------------------------------
// Semantic enrichment
// ---------------------------------------------------------------------------

async function semanticEnrich(adjCounts, anchors) {
  const { centroids: anchorEmbeddings, labels: anchorLabels } = anchors;

  const candidates = [];
  for (const [phrase, data] of Object.entries(adjCounts)) {
    if (data.count >= 3 && data.sources.length >= 2) {
      candidates.push({ phrase, count: data.count, sources: data.sources.length });
    }
  }

  if (candidates.length === 0) return [];

  const dim = anchorEmbeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const emb of anchorEmbeddings) {
    for (let i = 0; i < dim; i++) centroid[i] += emb[i];
  }
  const normCentroid = normalize(centroid);

  console.log(`  Scoring ${candidates.length} candidate phrases against mood space...`);
  const texts = candidates.map(c => c.phrase);
  const embeddings = await embedWithCache(texts);

  const results = [];
  for (let j = 0; j < candidates.length; j++) {
    const simToCentroid = cosineSim(embeddings[j], normCentroid);

    let maxAnchorSim = 0;
    let closestCluster = '';
    for (let k = 0; k < anchorEmbeddings.length; k++) {
      const sim = cosineSim(embeddings[j], anchorEmbeddings[k]);
      if (sim > maxAnchorSim) {
        maxAnchorSim = sim;
        closestCluster = anchorLabels[k].join(', ');
      }
    }

    if (simToCentroid >= SIMILARITY_THRESHOLD || maxAnchorSim >= SIMILARITY_THRESHOLD + 0.05) {
      results.push({
        phrase: candidates[j].phrase,
        count: candidates[j].count,
        sources: candidates[j].sources,
        similarity_to_centroid: Math.round(simToCentroid * 1000) / 1000,
        max_anchor_similarity: Math.round(maxAnchorSim * 1000) / 1000,
        closest_cluster: closestCluster,
      });
    }
  }

  results.sort((a, b) => b.similarity_to_centroid - a.similarity_to_centroid);
  return results;
}

async function rankPatternsBySemantic(patternHits) {
  const patterns = [];
  for (const [phrase, data] of Object.entries(patternHits)) {
    if (data.count >= 2) {
      patterns.push({ phrase, count: data.count, sources: data.sources.length });
    }
  }

  if (patterns.length === 0) return [];

  console.log(`  Ranking ${patterns.length} pattern phrases by mood relevance...`);

  const idealTexts = ['emotional atmosphere mood feeling tone quality'];
  const idealEmbeddings = await embedWithCache(idealTexts);
  const idealVec = idealEmbeddings[0];

  const texts = patterns.map(p => p.phrase);
  const embeddings = await embedWithCache(texts);

  const results = [];
  for (let j = 0; j < patterns.length; j++) {
    const sim = cosineSim(embeddings[j], idealVec);
    results.push({
      phrase: patterns[j].phrase,
      count: patterns[j].count,
      sources: patterns[j].sources,
      mood_relevance: Math.round(sim * 1000) / 1000,
    });
  }

  results.sort((a, b) => b.mood_relevance - a.mood_relevance);
  return results;
}

async function rankDiscoveredPrefixes(nounOfPatterns, verbPatterns, anchors) {
  const { centroids: anchorEmbeddings } = anchors;

  const dim = anchorEmbeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const emb of anchorEmbeddings) {
    for (let i = 0; i < dim; i++) centroid[i] += emb[i];
  }
  const moodCentroid = normalize(centroid);

  const candidates = [];

  for (const [prefix, data] of Object.entries(nounOfPatterns)) {
    if (data.totalCount < 3 || data.sources.length < 2) continue;
    const topCompletions = Object.entries(data.completions)
      .filter(([, d]) => d.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    for (const [completion, cData] of topCompletions) {
      candidates.push({
        prefix, completion, full: prefix + ' ' + completion,
        count: cData.count, sources: cData.sources.length, type: 'noun_of',
      });
    }
  }

  for (const [verb, data] of Object.entries(verbPatterns)) {
    if (data.totalCount < 3 || data.sources.length < 2) continue;
    const topCompletions = Object.entries(data.completions)
      .filter(([, d]) => d.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    for (const [completion, cData] of topCompletions) {
      candidates.push({
        prefix: verb, completion, full: verb + ' ' + completion,
        count: cData.count, sources: cData.sources.length, type: 'verb',
      });
    }
  }

  if (candidates.length === 0) return { rankedPhrases: [], prefixScores: [] };

  console.log(`  Scoring ${candidates.length} discovered prefix+completion phrases...`);
  const texts = candidates.map(c => c.full);
  const embeddings = await embedWithCache(texts);

  const scored = [];
  for (let j = 0; j < candidates.length; j++) {
    const sim = cosineSim(embeddings[j], moodCentroid);
    scored.push({ ...candidates[j], mood_similarity: Math.round(sim * 1000) / 1000 });
  }
  scored.sort((a, b) => b.mood_similarity - a.mood_similarity);

  // Aggregate prefix-level scores
  const prefixAgg = new Map();
  for (const s of scored) {
    if (!prefixAgg.has(s.prefix)) prefixAgg.set(s.prefix, { sims: [], totalCount: 0, type: s.type });
    const agg = prefixAgg.get(s.prefix);
    agg.sims.push(s.mood_similarity);
    agg.totalCount += s.count;
  }

  const prefixScores = Array.from(prefixAgg.entries())
    .map(([prefix, agg]) => ({
      prefix,
      type: agg.type,
      avg_mood_sim: Math.round((agg.sims.reduce((a, b) => a + b, 0) / agg.sims.length) * 1000) / 1000,
      max_mood_sim: Math.max(...agg.sims),
      completions_scored: agg.sims.length,
      total_occurrences: agg.totalCount,
      is_known: MOOD_PATTERN_PREFIXES.some(p => prefix === p || prefix.replace(/ (of|with)$/, '') === p),
    }))
    .sort((a, b) => b.avg_mood_sim - a.avg_mood_sim);

  return { rankedPhrases: scored, prefixScores };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Mood Palette Seed Audit (streaming + incremental caching)');
  console.log('='.repeat(70));
  console.log(`  Similarity threshold: ${SIMILARITY_THRESHOLD}`);
  console.log(`  Max pages: ${MAX_PAGES === 999999 ? 'unlimited' : MAX_PAGES}`);
  console.log(`  Mode: ${FORCE_FULL ? 'full re-fetch' : NO_FETCH ? 'cached only' : 'incremental'}`);
  console.log(`  Embedding: ${NO_EMBED ? 'skipped' : 'enabled'}`);
  console.log('');

  ensureCacheDir();

  // -------------------------------------------------------------------------
  // Step 1: Fetch corpus (streaming to JSONL)
  // -------------------------------------------------------------------------
  if (!NO_FETCH) {
    console.log('='.repeat(70));
    console.log(' FETCHING CORPUS');
    console.log('='.repeat(70));
    console.log('');
    await fetchAndCacheCorpus();
    console.log('');
  }

  // -------------------------------------------------------------------------
  // Step 2: Stream extraction (process new records only)
  // -------------------------------------------------------------------------
  console.log('='.repeat(70));
  console.log(' EXTRACTING MOOD DATA');
  console.log('='.repeat(70));
  console.log('');

  const ext = FORCE_FULL ? emptyExtractions() : loadExtractions();
  await streamExtract(ext);
  saveExtractions(ext);
  console.log('');

  // -------------------------------------------------------------------------
  // Step 3: Report extraction results
  // -------------------------------------------------------------------------
  console.log('='.repeat(70));
  console.log(' CURRENT SEED COVERAGE');
  console.log('='.repeat(70));
  console.log('');

  const seedsFound = Object.entries(ext.seedHits)
    .map(([word, data]) => ({ word, count: data.count, sources: data.sources.length }))
    .sort((a, b) => b.count - a.count);

  const seedsMissing = Array.from(MOOD_SEEDS).filter(s => !ext.seedHits[s]).sort();

  console.log(`  Seeds appearing in corpus: ${seedsFound.length}/${MOOD_SEEDS.size}`);
  console.log(`  Total records processed: ${ext.totalProcessed}`);
  console.log('');
  console.log('  Top seeds by frequency:');
  console.log('  ' + '-'.repeat(50));
  for (const s of seedsFound.slice(0, 30)) {
    console.log(`    ${s.word.padEnd(20)} ${String(s.count).padStart(8)}x  (${s.sources} sources)`);
  }

  if (seedsMissing.length > 0) {
    console.log('');
    console.log(`  Seeds NOT found in corpus (${seedsMissing.length}):`);
    console.log('  ' + '-'.repeat(50));
    for (let i = 0; i < seedsMissing.length; i += 4) {
      const row = seedsMissing.slice(i, i + 4).map(w => w.padEnd(18)).join('');
      console.log('    ' + row);
    }
  }

  // Patterns
  console.log('');
  console.log('='.repeat(70));
  console.log(' PATTERN-EXTRACTED PHRASES (top 50)');
  console.log('='.repeat(70));
  console.log('');

  const patterns = Object.entries(ext.patternHits)
    .map(([phrase, data]) => ({ phrase, count: data.count, sources: data.sources.length }))
    .sort((a, b) => {
      if (b.sources !== a.sources) return b.sources - a.sources;
      return b.count - a.count;
    });

  for (const p of patterns.slice(0, 50)) {
    console.log(`    ${p.phrase.padEnd(40)} ${String(p.count).padStart(7)}x  (${p.sources} sources)`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Semantic analysis (skip if --no-embed)
  // -------------------------------------------------------------------------
  const isSmallCorpus = ext.totalProcessed < 50000;
  let semanticResults = [];
  let rankedPatterns = [];
  let prefixScores = [];
  let newPrefixes = [];
  let topDiscoveredMood = [];
  let anchors = null;

  if (!NO_EMBED) {
    await initEmbedder();
    loadEmbeddingCache();

    // Build anchors
    console.log('');
    console.log('='.repeat(70));
    console.log(' BUILDING DATA-DRIVEN ANCHORS');
    console.log('='.repeat(70));
    console.log('');

    anchors = await buildDataDrivenAnchors(seedsFound);

    // Prefix discovery
    console.log('='.repeat(70));
    console.log(' PREFIX DISCOVERY');
    console.log('='.repeat(70));
    console.log('');

    const nounOfCount = Object.values(ext.nounOfPatterns).filter(d => d.totalCount >= 3 && d.sources.length >= 2).length;
    const verbCount = Object.values(ext.verbPatterns).filter(d => d.totalCount >= 3 && d.sources.length >= 2).length;
    console.log(`  Found ${nounOfCount} "[X] of/with" prefixes and ${verbCount} verb prefixes\n`);

    const prefixResult = await rankDiscoveredPrefixes(ext.nounOfPatterns, ext.verbPatterns, anchors);
    prefixScores = prefixResult.prefixScores;

    console.log('\n  Prefix-level mood relevance:\n');
    console.log('  ' + 'Prefix'.padEnd(22) + 'Type'.padEnd(10) + 'AvgSim'.padStart(7) + '  Count'.padStart(7) + '  Known?');
    console.log('  ' + '-'.repeat(60));
    for (const p of prefixScores.slice(0, 30)) {
      const known = p.is_known ? ' *' : '';
      console.log(`    ${p.prefix.padEnd(20)} ${p.type.padEnd(10)} ${p.avg_mood_sim.toFixed(3).padStart(6)}  ${String(p.total_occurrences).padStart(5)}x  ${known}`);
    }

    const prefixMinCount = isSmallCorpus ? 2 : 5;
    newPrefixes = prefixScores.filter(p => !p.is_known && p.avg_mood_sim >= 0.40 && p.total_occurrences >= prefixMinCount);
    console.log(`\n  Recommended NEW prefixes (avg_sim >= 0.40, count >= ${prefixMinCount}):\n`);
    if (newPrefixes.length > 0) {
      for (const p of newPrefixes.slice(0, 15)) {
        console.log(`    "${p.prefix}" — avg_sim=${p.avg_mood_sim.toFixed(3)}, ${p.total_occurrences}x`);
      }
    } else {
      console.log('    None found. Try fetching more pages to increase occurrence counts.');
    }

    topDiscoveredMood = (prefixResult.rankedPhrases || []).filter(p => p.mood_similarity >= 0.45).slice(0, 25);
    if (topDiscoveredMood.length > 0) {
      console.log('\n  Top mood-relevant prefix+completion phrases:\n');
      console.log('  ' + 'Phrase'.padEnd(38) + 'Sim'.padStart(6) + 'Count'.padStart(7));
      console.log('  ' + '-'.repeat(55));
      for (const p of topDiscoveredMood) {
        console.log(`    ${p.full.padEnd(36)} ${p.mood_similarity.toFixed(3).padStart(6)} ${String(p.count).padStart(5)}x`);
      }
    }

    // Semantic discovery
    console.log('');
    console.log('='.repeat(70));
    console.log(' SEMANTIC DISCOVERY — adjectives near mood space');
    console.log(`   (threshold: ${SIMILARITY_THRESHOLD})`);
    console.log('='.repeat(70));
    console.log('');

    semanticResults = await semanticEnrich(ext.adjCounts, anchors);

    console.log(`\n  Found ${semanticResults.length} terms above threshold:\n`);
    console.log('  ' + 'Phrase'.padEnd(28) + 'Sim'.padStart(6) + 'Count'.padStart(7) + '  Nearest cluster');
    console.log('  ' + '-'.repeat(70));
    for (const r of semanticResults.slice(0, 60)) {
      console.log(`    ${r.phrase.padEnd(26)} ${r.similarity_to_centroid.toFixed(3).padStart(6)} ${String(r.count).padStart(5)}x  ${r.closest_cluster}`);
    }

    // Ranked patterns
    console.log('');
    console.log('='.repeat(70));
    console.log(' PATTERN PHRASES RANKED BY MOOD RELEVANCE');
    console.log('='.repeat(70));
    console.log('');

    rankedPatterns = await rankPatternsBySemantic(ext.patternHits);

    console.log('  ' + 'Phrase'.padEnd(42) + 'Relev'.padStart(7) + 'Count'.padStart(7) + '  Srcs');
    console.log('  ' + '-'.repeat(65));
    for (const p of rankedPatterns.slice(0, 40)) {
      console.log(`    ${p.phrase.padEnd(40)} ${p.mood_relevance.toFixed(3).padStart(7)} ${String(p.count).padStart(5)}x  ${p.sources}`);
    }

    // Save embedding cache
    saveEmbeddingCache();
  }

  // -------------------------------------------------------------------------
  // Recommendations — adapt thresholds based on corpus size
  // -------------------------------------------------------------------------
  const recMinCount = isSmallCorpus ? 2 : 5;
  const recMinSources = 2;
  const recMinSim = 0.55;

  const recommendations = semanticResults
    .filter(r => r.similarity_to_centroid >= recMinSim && r.count >= recMinCount && r.sources >= recMinSources)
    .filter(r => !MOOD_SEEDS.has(r.phrase));

  console.log('');
  console.log('='.repeat(70));
  console.log(' RECOMMENDED SEED ADDITIONS');
  console.log(`   (sim >= ${recMinSim}, count >= ${recMinCount}, ${recMinSources}+ sources${isSmallCorpus ? ' — relaxed for small corpus' : ''})`);
  console.log('='.repeat(70));
  console.log('');

  if (recommendations.length === 0) {
    console.log('  No recommendations at this threshold.');
    if (semanticResults.length > 0) {
      console.log(`  (${semanticResults.length} terms above similarity threshold but didn't meet count/source minimums)`);
      console.log('  Try: --threshold 0.45, or fetch more pages to increase counts.');
    } else {
      console.log('  No terms scored above similarity threshold. Try: --threshold 0.40');
    }
  } else {
    for (const r of recommendations.slice(0, 30)) {
      console.log(`    ${r.phrase.padEnd(26)} sim=${r.similarity_to_centroid.toFixed(3)}  ${r.count}x  near: [${r.closest_cluster}]`);
    }
  }

  // -------------------------------------------------------------------------
  // Write JSON report
  // -------------------------------------------------------------------------
  const report = {
    generated_at: new Date().toISOString(),
    config: {
      similarity_threshold: SIMILARITY_THRESHOLD,
      descriptions_processed: ext.totalProcessed,
      num_anchor_clusters: NUM_ANCHOR_CLUSTERS,
    },
    seeds: {
      total: MOOD_SEEDS.size,
      found_in_corpus: seedsFound.length,
      missing: seedsMissing,
      top_by_frequency: seedsFound.slice(0, 50),
    },
    anchors: anchors ? { derived_from: 'corpus seed embeddings (k-means)', clusters: anchors.labels } : null,
    patterns: {
      total_extracted: patterns.length,
      top_by_frequency: patterns.slice(0, 100),
      ranked_by_mood_relevance: rankedPatterns.slice(0, 100),
    },
    prefix_discovery: {
      prefix_scores: prefixScores.slice(0, 50),
      new_prefix_recommendations: newPrefixes.slice(0, 20),
      top_mood_phrases: topDiscoveredMood,
    },
    semantic_discovery: {
      total_above_threshold: semanticResults.length,
      results: semanticResults.slice(0, 100),
    },
    recommendations: recommendations.slice(0, 50),
  };

  const outPath = path.resolve(__dirname, 'mood-seeds-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report written to: ${outPath}`);

  // -------------------------------------------------------------------------
  // Copy-paste ready output
  // -------------------------------------------------------------------------
  if (recommendations.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log(' COPY-PASTE — add to MOOD_SEEDS in perspectives.js');
    console.log('='.repeat(70));
    console.log('');
    console.log('  ' + recommendations.slice(0, 50).map(r => `'${r.phrase}'`).join(','));
    console.log('');
  }

  if (newPrefixes.length > 0) {
    console.log('='.repeat(70));
    console.log(' COPY-PASTE — add to MOOD_PATTERN_PREFIXES in perspectives.js');
    console.log('='.repeat(70));
    console.log('');
    console.log('  ' + newPrefixes.slice(0, 20).map(p => `'${p.prefix}'`).join(','));
    console.log('');
  }

  // Summary
  console.log('='.repeat(70));
  console.log(' CACHE SUMMARY');
  console.log('='.repeat(70));
  const meta = loadMeta();
  console.log(`  Corpus:      ${meta ? meta.total_records : '?'} records (${CORPUS_PATH})`);
  console.log(`  Extractions: ${ext.totalProcessed} processed`);
  console.log(`  Embeddings:  ${embeddingCache.size} cached vectors`);
  console.log(`  Disk usage:  ~${estimateDiskUsage()}`);
  console.log('');
}

function estimateDiskUsage() {
  let total = 0;
  const files = [CORPUS_PATH, META_PATH, EXTRACTIONS_PATH, EMBEDDINGS_PATH, ANCHORS_PATH];
  for (const f of files) {
    try { total += fs.statSync(f).size; } catch (e) { /* skip */ }
  }
  if (total > 1024 * 1024 * 1024) return (total / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (total > 1024 * 1024) return (total / (1024 * 1024)).toFixed(1) + ' MB';
  return (total / 1024).toFixed(0) + ' KB';
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
