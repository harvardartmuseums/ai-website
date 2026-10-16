require('dotenv').config({path: '.env'})

var express = require('express');
var router = express.Router();
var { apiJSON } = require('../lib/request-protection');
var querystring = require('querystring');
var _ = require('lodash');
var appendscript = require('../public/javascripts/appendscript')
var organize = require('../public/javascripts/organize')
var perspectives = require('../public/javascripts/perspectives')
var models = require('../models')
var imagga_categories = require('../public/categories/imagga_categories')
var example_tags = require('../public/examples/exampletags')
var example_images = require('../public/examples/exampleimages')
var terms = require('../public/vocabularies/terms')
var features = require('../public/vocabularies/features')
var descriptions = require('../public/vocabularies/descriptions')
var people = require('../public/vocabularies/people')
var places = require('../public/vocabularies/places')
var organizations = require('../public/vocabularies/organizations')
var statistics = require('../public/vocabularies/stats')
var model_history = require('../public/vocabularies/model-history')
var stopwords = require('../public/vocabularies/stopwords');

const API_KEY = process.env['API_KEY']

let statsCache = null;

// In-memory perspectives cache: object ID + image ID + algorithm version.
// TTL 12 hours, max 1000 entries and 16 MiB of serialized results.
const PERSPECTIVES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PERSPECTIVES_CACHE_MAX    = 1000;
const PERSPECTIVES_CACHE_BYTES = 16 * 1024 * 1024;
const perspectivesCache = new Map();
let perspectivesCacheBytes = 0;

function perspectivesCacheDelete(key) {
  const entry = perspectivesCache.get(key);
  if (entry) perspectivesCacheBytes -= entry.bytes;
  perspectivesCache.delete(key);
}

function perspectivesCacheGet(key) {
  const entry = perspectivesCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PERSPECTIVES_CACHE_TTL_MS) {
    perspectivesCacheDelete(key);
    return null;
  }
  return entry.result;
}

function perspectivesCacheSet(key, result) {
  const bytes = Buffer.byteLength(JSON.stringify(result));
  perspectivesCacheDelete(key);
  if (bytes > PERSPECTIVES_CACHE_BYTES) return;
  while (perspectivesCache.size >= PERSPECTIVES_CACHE_MAX || perspectivesCacheBytes + bytes > PERSPECTIVES_CACHE_BYTES) {
    perspectivesCacheDelete(perspectivesCache.keys().next().value);
  }
  perspectivesCache.set(key, { result, bytes, ts: Date.now() });
  perspectivesCacheBytes += bytes;
}

async function refreshStatsCache() {
  const queries = [
    {
      "image_count": {
        "cardinality": { "field": "imageid", "precision_threshold": 100 }
      },
      "date_stats": {
        "extended_stats": { "field": "createdate" }
      }
    },
    {
      "by_source": {
        "terms": {
          "field": "source", "min_doc_count": 0, "size": 20,
          "exclude": "Manual|Azure OpenAI Service", "order": { "_key": "asc" }
        },
        "aggs": {
          "image_coverage": {
            "cardinality": { "field": "imageid", "precision_threshold": 1000 }
          },
          "by_type": {
            "terms": { "field": "type", "min_doc_count": 0, "order": { "_key": "asc" } }
          },
          "by_model": {
            "terms": { "field": "model.keyword", "size": 50 }
          }
        }
      }
    },
    {
      "by_type": {
        "terms": { "field": "type", "order": { "_key": "asc" } },
        "aggs": {
          "by_source": {
            "terms": {
              "field": "source", "min_doc_count": 0, "size": 20,
              "exclude": "Manual|Azure OpenAI Service", "order": { "_key": "asc" }
            }
          }
        }
      }
    }
  ];

  const start = Date.now();
  try {
    const results = await Promise.all(queries.map(async (aggs) => {
      const qs = { size: 0, apikey: API_KEY, aggregation: JSON.stringify(aggs) };
      const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
      return apiJSON(url);
    }));

    const aggregations = Object.assign({}, ...results.map(r => r.aggregations));
    aggregations.by_source.buckets.forEach(a => {
      a.image_coverage.percentage =
        (a.image_coverage.value / aggregations.image_count.value) * 100;
    });

    statsCache = {
      info: results[0].info,
      aggregations,
      refreshed_at: new Date().toISOString()
    };
    console.log(`Stats cache refreshed at ${statsCache.refreshed_at} (${Date.now() - start}ms)`);
  } catch (e) {
    console.error(`Stats cache refresh failed after ${Date.now() - start}ms:`, e.message);
  }
}

refreshStatsCache();
setInterval(refreshStatsCache, 24 * 60 * 60 * 1000);

function termDistributionSummary(tagAnnotations, totalAnnotations, tagImages, totalImages) {
  if (!totalAnnotations || !totalImages || !tagImages) return null;

  const imageShare = tagImages / totalImages;
  const datasetDensity = totalAnnotations / totalImages;
  const termDensity = tagAnnotations / tagImages;
  const densityRatio = termDensity / datasetDensity;

  const imageSharePct = (imageShare * 100).toFixed(1) + '%';
  let sentence1;
  if (imageShare >= 0.20) {
    sentence1 = `This term appears across a large share of the collection’s images (${imageSharePct}).`;
  } else if (imageShare >= 0.05) {
    sentence1 = `This term is found across a wide portion of the collection’s images (${imageSharePct}).`;
  } else if (imageShare >= 0.01) {
    sentence1 = `This term appears on a meaningful portion of the collection’s images (${imageSharePct}).`;
  } else {
    sentence1 = `This is a niche term within the collection — it appears in only a small portion of images (${imageSharePct}).`;
  }

  let sentence2;
  if (densityRatio >= 2.0) {
    sentence2 = "When it appears, it tends to generate many annotations per image.";
  } else if (densityRatio >= 0.75) {
    sentence2 = "Annotations per image are roughly typical for the collection.";
  } else {
    sentence2 = "Annotations per image are sparser than average for this term.";
  }

  return `${sentence1} ${sentence2}`;
}

function sourceDistributionSummary(buckets) {
  if (!buckets || buckets.length === 0) return null;
  let total = buckets.reduce((s, b) => s + b.doc_count, 0);
  if (total === 0) return null;
  let top = buckets[0];
  let share = top.doc_count / total;
  if (buckets.length === 1) return `All annotations come from ${top.key}.`;
  if (share >= 0.7) return `The vast majority of annotations come from ${top.key}.`;
  if (share >= 0.5) return `Most annotations come from ${top.key}.`;
  if (share >= 0.35) return `${top.key} contributes the most annotations, but results span multiple sources.`;
  return `Annotations are distributed broadly across sources.`;
}

const _computeStats = organize.computeStats;

function _buildImageSummary(ai_sorted) {
  const sections = {};

  // CV annotations
  const tagsect = ai_sorted.tagsect || [];
  if (tagsect.length > 0) {
    const names = tagsect.map(s => s.source).join(', ');
    const total = tagsect.reduce((n, s) => n + (s.tags ? s.tags.length : 0), 0);
    const svcLabel = tagsect.length === 1 ? '1 service' : `${tagsect.length} services`;
    sections.tags = `Tags were generated by ${svcLabel} (${names}), covering ${total} total labels.`;
  }

  const facesect = ai_sorted.facesect || [];
  if (facesect.length > 0) {
    const names = facesect.map(s => s.source).join(', ');
    const svcLabel = facesect.length === 1 ? '1 service' : `${facesect.length} services`;
    sections.faces = `Faces were detected by ${svcLabel}: ${names}.`;
  }

  const featuresect = Object.values(ai_sorted.featuresect || {}).filter(s => Object.keys(s.features || {}).length > 0);
  if (featuresect.length > 0) {
    const names = featuresect.map(s => s.source).join(', ');
    const svcLabel = featuresect.length === 1 ? '1 service' : `${featuresect.length} services`;
    sections.features = `Object detection was run by ${svcLabel}: ${names}.`;
  }

  const categories = ai_sorted.categories || [];
  if (categories.length > 0) {
    const names = categories.map(s => s.source).join(', ');
    const svcLabel = categories.length === 1 ? '1 service' : `${categories.length} services`;
    sections.categories = `Image categories were assigned by ${svcLabel}: ${names}.`;
  }

  const textsect = ai_sorted.textsect || [];
  if (textsect.length > 0) {
    const names = textsect.map(s => s.source).join(', ');
    const svcLabel = textsect.length === 1 ? '1 service' : `${textsect.length} services`;
    sections.text = `Text (OCR) was extracted by ${svcLabel}: ${names}.`;
  }

  const captions = ai_sorted.captions || [];
  if (captions.length > 0) {
    const names = captions.map(s => s.source).join(', ');
    const svcLabel = captions.length === 1 ? '1 service' : `${captions.length} services`;
    sections.captions = `Short captions were generated by ${svcLabel}: ${names}.`;
  }

  // LLM descriptions
  const ai_descs = Object.values(ai_sorted.descriptions || {}).flatMap(s => s.descriptions || []);
  if (ai_descs.length > 0) {
    const providerCount = new Set(ai_descs.map(d => d.source)).size;
    const withDates = ai_descs.filter(d => d.model_released).sort((a, b) => a.model_released.localeCompare(b.model_released));
    const oldest = withDates[0];
    const newest = withDates[withDates.length - 1];
    const runDates = ai_descs.map(d => d.createdate).filter(date => Number.isFinite(Date.parse(date))).sort();
    const firstRun = runDates[0];
    const lastRun = runDates[runDates.length - 1];
    const modelCount = new Set(ai_descs.filter(d => d.model).map(d => d.source + '\0' + d.model)).size;
    const modelLabel = modelCount === 1 ? '1 model' : `${modelCount} models`;
    const providerLabel = providerCount === 1 ? '1 provider' : `${providerCount} providers`;
    const descParts = [`This image has ${ai_descs.length} description${ai_descs.length === 1 ? '' : 's'} from ${providerLabel}${modelCount ? ' (' + modelLabel + ')' : ''}.`];
    if (oldest && newest && (oldest.model !== newest.model || oldest.source !== newest.source)) {
      descParts.push(`The oldest model is ${oldest.display_model} (${oldest.model_released.slice(0,4)}) and the newest is ${newest.display_model} (${newest.model_released.slice(0,4)}).`);
    } else if (oldest) {
      descParts.push(`The model is ${oldest.display_model} (${oldest.model_released.slice(0,4)}).`);
    }
    if (firstRun && lastRun) {
      const fmt = d => new Date(d).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
      descParts.push(firstRun === lastRun
        ? `Descriptions were collected in ${fmt(firstRun)}.`
        : `Descriptions were collected between ${fmt(firstRun)} and ${fmt(lastRun)}.`);
    }
    sections.descriptions = descParts.join('<br>');
  }

  const allParts = Object.values(sections);
  if (allParts.length === 0) return null;
  return { ...sections, full: allParts.join('<br>') };
}

function _tfidfCosine(textA, textB) {
  function tokenise(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean); }
  function tf(tokens) {
    var freq = {}; tokens.forEach(function(t) { freq[t] = (freq[t] || 0) + 1; });
    var len = tokens.length || 1; Object.keys(freq).forEach(function(t) { freq[t] /= len; }); return freq;
  }
  function idf(a, b) {
    var s = {}; Object.keys(a).concat(Object.keys(b)).forEach(function(t) {
      if (!(t in s)) { var df = (a[t] ? 1 : 0) + (b[t] ? 1 : 0); s[t] = Math.log(3 / (df + 1)) + 1; }
    }); return s;
  }
  function vec(tfMap, idfMap) { var v = {}; Object.keys(tfMap).forEach(function(t) { v[t] = tfMap[t] * idfMap[t]; }); return v; }
  function cosine(a, b) {
    var dot = 0, mA = 0, mB = 0, seen = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function(t) {
      if (seen[t]) return; seen[t] = true;
      var av = a[t] || 0, bv = b[t] || 0; dot += av * bv; mA += av * av; mB += bv * bv;
    });
    return (mA && mB) ? dot / (Math.sqrt(mA) * Math.sqrt(mB)) : 0;
  }
  var tfA = tf(tokenise(textA)), tfB = tf(tokenise(textB)), ids = idf(tfA, tfB);
  return Math.round(cosine(vec(tfA, ids), vec(tfB, ids)) * 100);
}

function _wordOverlap(textA, textB) {
  var wordsA = textA.toLowerCase().split(/\s+/).filter(Boolean);
  var wordsB = textB.toLowerCase().split(/\s+/).filter(Boolean);
  var setB = {}; wordsB.forEach(function(w) { setB[w] = true; });
  var setA = {}; wordsA.forEach(function(w) { setA[w] = true; });
  var shared = Object.keys(setA).filter(function(w) { return setB[w]; }).length;
  var total = Object.keys(setA).length + Object.keys(setB).length - shared;
  return { pct: total === 0 ? 0 : Math.round((shared / total) * 100), shared, uniqueA: Object.keys(setA).length - shared, uniqueB: Object.keys(setB).length - shared };
}

function _sentenceOverlap(textA, textB) {
  function split(t) { return t.split(/(?<=[.!?])\s+|(?<=[.!?])$/).map(function(s) { return s.trim(); }).filter(Boolean); }
  function words(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean); }
  function score(wa, wb) {
    var sA = {}, sB = {}; wa.forEach(function(w) { sA[w] = true; }); wb.forEach(function(w) { sB[w] = true; });
    var sh = Object.keys(sA).filter(function(w) { return sB[w]; }).length;
    var d = Math.max(Object.keys(sA).length, Object.keys(sB).length);
    return d === 0 ? 0 : sh / d;
  }
  var sentA = split(textA), sentB = split(textB);
  if (!sentA.length || !sentB.length) return { pct: 0, matchedA: 0, totalA: sentA.length, matchedB: 0, totalB: sentB.length };
  var wA = sentA.map(words), wB = sentB.map(words);
  var mA = wA.filter(function(a) { return wB.some(function(b) { return score(a, b) >= 0.4; }); }).length;
  var mB = wB.filter(function(b) { return wA.some(function(a) { return score(a, b) >= 0.4; }); }).length;
  return { pct: Math.round(((mA / sentA.length) + (mB / sentB.length)) / 2 * 100), matchedA: mA, totalA: sentA.length, matchedB: mB, totalB: sentB.length };
}

function _keyPhrases(textA, textB) {
  function tokenise(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !stopwords[w]; }); }
  function tf(tokens) {
    var freq = {}; tokens.forEach(function(t) { freq[t] = (freq[t] || 0) + 1; });
    var len = tokens.length || 1; Object.keys(freq).forEach(function(t) { freq[t] /= len; }); return freq;
  }
  var tfA = tf(tokenise(textA)), tfB = tf(tokenise(textB)), idfMap = {};
  Object.keys(tfA).concat(Object.keys(tfB)).forEach(function(t) {
    if (!(t in idfMap)) { var df = (tfA[t] ? 1 : 0) + (tfB[t] ? 1 : 0); idfMap[t] = Math.log(3 / (df + 1)) + 1; }
  });
  function top(tfMap, n) {
    return Object.keys(tfMap).map(function(t) { return { term: t, score: tfMap[t] * (idfMap[t] || 1) }; })
      .sort(function(a, b) { return b.score - a.score; }).slice(0, n).map(function(x) { return x.term; });
  }
  var tA = top(tfA, 8), tB = top(tfB, 8), sB = {}, sA = {};
  tB.forEach(function(t) { sB[t] = true; }); tA.forEach(function(t) { sA[t] = true; });
  return { shared: tA.filter(function(t) { return sB[t]; }), onlyA: tA.filter(function(t) { return !sB[t]; }), onlyB: tB.filter(function(t) { return !sA[t]; }) };
}

router.post('/api/analyze', express.json(), function(req, res) {
  var text = (req.body && req.body.text) || '';
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json(_computeStats(text) || {});
});

router.post('/api/compare', express.json(), function(req, res) {
  var textA = (req.body && req.body.textA) || '';
  var textB = (req.body && req.body.textB) || '';
  if (!textA || !textB) return res.status(400).json({ error: 'textA and textB required' });
  res.json({
    tfidf:          _tfidfCosine(textA, textB),
    wordOverlap:    _wordOverlap(textA, textB),
    sentenceOverlap: _sentenceOverlap(textA, textB),
    keyPhrases:     _keyPhrases(textA, textB)
  });
});

router.post('/api/consensus', express.json(), function(req, res) {
  var texts = (req.body && Array.isArray(req.body.texts)) ? req.body.texts : [];
  if (texts.length < 2) return res.status(400).json({ error: 'at least 2 texts required' });
  res.json({ consensus: [], bySource: {}, divergence: [] });
});

// ── End Text Analysis API ──────────────────────────────────────────────────

/* GET home page. */
router.get('/', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);
  let annotation_count = statsCache ? statsCache.info.totalrecords.toLocaleString() : '—';
  let image_count = statsCache ? statsCache.aggregations.image_count.value.toLocaleString() : '—';
  res.render('index', {title: 'Home',
                        navbar: true,
                        year: new Date().getFullYear(),
                        tag_list: tag_list,
                        mobile_tag_list: mobile_tag_list,
                        image_list: image_list,
                        annotation_count: annotation_count,
                        image_count: image_count});
});

/* GET about page. */
router.get('/about', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);
  let annotation_count = statsCache ? statsCache.info.totalrecords.toLocaleString() : '—';
  let image_count = statsCache ? statsCache.aggregations.image_count.value.toLocaleString() : '—';
  res.render('about', {title: 'About',
                        navbar: true,
                        year: new Date().getFullYear(),
                        tag_list: tag_list,
                        mobile_tag_list: mobile_tag_list,
                        image_list: image_list,
                        annotation_count: annotation_count,
                        image_count: image_count});
})


/* GET explore page. */
router.get('/explore', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);
  res.render('explore', { title: 'Explore',
                          navbar: true,
                          year: new Date().getFullYear(),
                          tag_list: tag_list,
                          mobile_tag_list: mobile_tag_list,
                          image_list: image_list
                        });
});


/* GET search results. */
router.get('/search/:tag/:page?', function(req, res, next) {
  const PAGE_SIZE = 24;
  const PAGE_CAP = 100;
  if (req.params.page && (!/^\d+$/.test(req.params.page) || Number(req.params.page) < 1 || Number(req.params.page) > PAGE_CAP)) {
    return next(Object.assign(new Error('Search page not found.'), { status: 404 }));
  }
  let page = 1;
  if (req.params.page > 1 && req.params.page <= PAGE_CAP) {
    page = parseFloat(req.params.page);
  }

  const VALID_SOURCES = new Set(statistics.all_sources || statistics.sources.map(s => s.source));
  const VALID_MODELS  = new Set(statistics.models || []);
  const source = VALID_SOURCES.has(req.query.source) ? req.query.source : null;
  const model  = VALID_MODELS.has(req.query.model)   ? req.query.model  : null;
  const sort   = req.query.sort === 'frequency' ? 'frequency' : 'confidence';

  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);

  let q = `(type:tag OR type:description) AND accesslevel:1 AND body:("${_.lowerCase(req.params.tag)}")`;
  if (source) q += ` AND source:"${source}"`;
  if (model)  q += ` AND model.keyword:"${model}"`;

  let aggs = {
    "top_images": {
      "terms": {
        "field": "imageid",
        "size": page * PAGE_SIZE,
        "order": sort === 'frequency' ? {"_count": "desc"} : {"max_confidence": "desc"},
      },
      "aggs": {
        "max_confidence": {"max": {"field": "confidence"}},
        "min_confidence": {"min": {"field": "confidence"}}
      }
    },
    "image_count": {
      "cardinality": {"field": "imageid", "precision_threshold": 1000}
    },
    "source_count": {
      "cardinality": {"field": "source", "precision_threshold": 1000}
    },
    "by_source": {
      "terms": {"field": "source", "size": 50, "min_doc_count": 0, "exclude": "Manual", "order": {"_key": "asc"}},
      "aggs": {
        "by_model": {
          "terms": {"field": "model.keyword", "size": 50, "min_doc_count": 1, "order": {"_key": "asc"}}
        }
      }
    },
    "confidences": {
      "histogram": {
        "field": "confidence",
        "interval": 0.05,
        "order": {"_key": "desc"},
        "hard_bounds": {"min": 0.0, "max": 1.0},
        "extended_bounds": {"min": 0.0, "max": 1.0}
      }
    }
  };

  let qs = {
    'q': q,
    'size': 0,
    'sort': 'confidence',
    'sortorder': 'desc',
    'apikey': API_KEY,
    'aggregation': JSON.stringify(aggs)
  };
  const tag_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;

  apiJSON(tag_url, req.upstreamSignal)
  .then(async tag_results => {
    if (tag_results.info.totalrecords === 0) {
      return res.render('search', {title: `No search results for '${req.params.tag}'`,
                                  navbar: true, error: true,
                                  tag_list: tag_list, mobile_tag_list: mobile_tag_list, image_list: image_list});
    }
    
    let all_buckets = tag_results.aggregations.top_images.buckets;
    let page_buckets = all_buckets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    let total_images = tag_results.aggregations.image_count.value;
    let total_sources = tag_results.aggregations.source_count.value;
    let total_pages = Math.min(PAGE_CAP, Math.ceil(total_images / PAGE_SIZE));
    let tag_stats = tag_results.aggregations;
    let sourceBucketsByCount = _.orderBy(tag_stats.by_source.buckets, 'doc_count', 'desc');
    let source_summary = sourceDistributionSummary(sourceBucketsByCount);
    let term_distribution_summary = statsCache
      ? termDistributionSummary(
          tag_results.info.totalrecords,
          statsCache.info.totalrecords,
          total_images,
          statsCache.aggregations.image_count.value
        )
      : null;
    let total_dataset_sources = (statistics.all_sources || statistics.sources.map(s => s.source)).length;

    let tag_results_info = {
      totalrecords: tag_results.info.totalrecords,
      totalrecords_localized: tag_results.info.totalrecords.toLocaleString(),
      page: page,
      pages: total_pages,
      pagenumber: {nextpage: page + 1, previouspage: page - 1}
    };

    let imageid_list = page_buckets.map(b => b.key);
    if (!imageid_list.length) {
      return next(Object.assign(new Error('Search page not found.'), { status: 404 }));
    }
    // Rank using lightweight buckets, then fetch text for only the visible page.
    // Previously page 100 downloaded up to 180,000 hits to display 24 images.
    const detailQS = {
      ...qs,
      q: `(${q}) AND imageid:(${imageid_list.join(' OR ')})`,
      aggregation: JSON.stringify({
        top_images: {
          terms: { field: 'imageid', size: PAGE_SIZE },
          aggs: {
            top_annotations: {
              top_hits: {
                size: 75,
                sort: [{ confidence: 'desc' }],
                _source: ['body', 'confidence', 'source', 'type', 'feature']
              }
            }
          }
        }
      })
    };
    const details = await apiJSON(`https://api.harvardartmuseums.org/annotation/?${querystring.encode(detailQS)}`, req.upstreamSignal);
    const hitsByImage = new Map(details.aggregations.top_images.buckets.map(bucket => [String(bucket.key), bucket.top_annotations]));
    page_buckets = page_buckets.map(bucket => ({
      ...bucket,
      top_annotations: hitsByImage.get(String(bucket.key)) || { hits: { hits: [] } }
    }));
    let object_url = appendscript.idappend(imageid_list);
    return apiJSON(object_url, req.upstreamSignal)
    .then(object_results => {
      let results = appendscript.bucketappend(page_buckets, object_results.records || [], _.lowerCase(req.params.tag));
      let filterParts = [];
      if (source) filterParts.push(`source=${encodeURIComponent(source)}`);
      if (model)  filterParts.push(`model=${encodeURIComponent(model)}`);
      if (sort === 'frequency') filterParts.push('sort=frequency');
      let filterParams = filterParts.length ? '?' + filterParts.join('&') : '';

      let filterPartsNoSort = [];
      if (source) filterPartsNoSort.push(`source=${encodeURIComponent(source)}`);
      if (model)  filterPartsNoSort.push(`model=${encodeURIComponent(model)}`);
      let filterParamsNoSort = filterPartsNoSort.length ? '?' + filterPartsNoSort.join('&') : '';

      res.render('search', {
        title: `Search results for '${req.params.tag}'`,
        subtitle: `${tag_results_info.totalrecords_localized} annotations containing '${req.params.tag}' found on ${total_images.toLocaleString()} images`,
        navbar: true,
        year: new Date().getFullYear(),
        object_results: results,
        tag_stats: tag_stats,
        error: false,
        tag: req.params.tag,
        tag_results_info: tag_results_info,
        term_distribution_summary: term_distribution_summary,
        source_summary: source_summary,
        total_sources: total_dataset_sources,
        active_source: source,
        active_model: model,
        active_sort: sort,
        filterParams: filterParams,
        filterParamsNoSort: filterParamsNoSort
      });
    })
  })
  .catch(next);
});

router.get('/feature/:tag/:page?', function(req, res, next) {
  let tag = _.lowerCase(req.params.tag);
  let page = 1;
  if (req.params.page > 1 && req.params.page < 9616) { // This is to keep the search request from going deeper than 500K records in to the dataset. Elasticsearch will throw an error. 500,000/52 = 9615.38
    page = req.params.page;
  } else {
    // send them to /dev/null ?!?!
  }
  let qs = {
    'q': `confidence:>=0.0 AND type:tag AND feature:region AND body.exact:("${tag}" OR "${_.capitalize(tag)}" OR "${_.startCase(tag)}")`,
    'size': 52,
    'page': page,
    'sort': 'confidence',
    'sortorder': 'desc',
    'fields': 'imageid,confidence,source,body,type,feature,selectors,target',
    'apikey': API_KEY,
  };
  const tag_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;

  apiJSON(tag_url, req.upstreamSignal)
  .then(tag_results => {
    let feature_results_info = tag_results.info;
    feature_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1};
    tag_results.records.forEach(tag => {
      coords = tag.selectors[0].value.replace('xywh=','');
      tag.imagefragmenturl = tag.target.replace('/full/full', `/${coords}/full`);
      if (tag.confidence <= 1) {
        tag.confidence = _.round((tag.confidence * 100), 1)
      }
    });

    let imageid_list = _.map(tag_results.records, 'imageid');
    let object_url = appendscript.idappend(imageid_list);
    return apiJSON(object_url, req.upstreamSignal)
    .then(object_results => {
      tag_results.records = appendscript.objectappend(tag_results.records, object_results.records);
      
      res.render('feature', {title: `Results for feature '${tag}'`,
                              subtitle: `${feature_results_info.totalrecords.toLocaleString()} occurrences of '${tag}' found`,
                              navbar: true, 
                              feature_list: features,
                              feature: tag,
                              results: tag_results.records,
                              feature_results_info: feature_results_info});
      });
  }).catch(next);
});

router.get('/face/:page?', function(req, res, next) {
  let tag = _.lowerCase(req.params.tag);
  let page = 1;
  if (req.params.page > 1 && req.params.page < 9616) { // This is to keep the search request from going deeper than 500K records in to the dataset. Elasticsearch will throw an error. 500,000/52 = 9615.38
    page = req.params.page;
  } else {
    // send them to /dev/null ?!?!
  }
  let qs = {
    'q': `confidence:>=0.0 AND accesslevel:1 AND type:face AND source:"AWS Rekognition"`,
    'size': 52,
    'page': page,
    'sort': 'confidence',
    'sortorder': 'desc',
    'fields': 'imageid,confidence,source,body,type,feature,selectors,target',
    'apikey': API_KEY,
  };
  const tag_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;

  apiJSON(tag_url, req.upstreamSignal)
  .then(tag_results => {
    let feature_results_info = tag_results.info;
    feature_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1};
    tag_results.records.forEach(tag => {
      coords = tag.selectors[0].value.replace('xywh=','');
      tag.imagefragmenturl = tag.target.replace('/full/full', `/${coords}/full`);
      if (tag.confidence <= 1) {
        tag.confidence = _.round((tag.confidence * 100), 1)
      }
    });

    let imageid_list = _.map(tag_results.records, 'imageid');
    let object_url = appendscript.idappend(imageid_list);
    return apiJSON(object_url, req.upstreamSignal)
    .then(object_results => {
      tag_results.records = appendscript.objectappend(tag_results.records, object_results.records);
      
      res.render('face', {title: `Results for faces`,
                              subtitle: `${feature_results_info.totalrecords.toLocaleString()} faces found`,
                              navbar: true, 
                              feature_list: features,
                              feature: 'face',
                              results: tag_results.records,
                              feature_results_info: feature_results_info});
      });
  }).catch(next);
});

/* GET category results. */
router.get('/category/:category/:page?', function(req, res, next) {
  let page = 1;
  if (req.params.page > 1 && req.params.page < 5000) { // This is to keep the search request from going deeper than 500K records in to the dataset. Elasticsearch will throw an error. 500,000/100 = 5000
    page = req.params.page;
  } else {
    // send them to /dev/null ?!?!
  }
  let aggs = {
    "image_count": {
        "cardinality": {
            "field": "imageid",
            "precision_threshold": 1000
        }
    }
  };  
  let qs = {
    'q': `confidence:>=0.0 AND type:category AND accesslevel:1 AND body.exact:"${_.lowerCase(req.params.category)}"`,
    'size': 100,
    'page': page,
    'sort': 'confidence',
    'sortorder': 'desc',
    'fields': 'imageid,confidence,source,body,type,feature',
    'apikey': API_KEY, 
    'aggregation': JSON.stringify(aggs)
  };  
  const category_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
  apiJSON(category_url, req.upstreamSignal)
  .then(category_results => {
    let category_results_info = category_results.info;
    let category_stats = category_results.aggregations;
    category_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1}
    category_results = _.orderBy(category_results.records, ['confidence'], ['desc'])
    let imageid_results = _.map(category_results, 'imageid')
    let object_url = appendscript.idappend(imageid_results)
    return apiJSON(object_url, req.upstreamSignal)
    .then(object_results => {
      object_results = object_results.records
      object_results = appendscript.categoryappend(object_results, category_results)
      res.render('category', { title: "Category results for '" + req.params.category + "'",
                               subtitle: `${category_results_info.totalrecords.toLocaleString()} occurrences of '${req.params.category}' found`,
                             navbar: true,
                             year: new Date().getFullYear(),
                             object_results: object_results,
                             category_results: category_results,
                             category_list: imagga_categories.categories_list,
                             category: _.capitalize(req.params.category),
                             category_results_info: category_results_info,
                           });
    })
  }).catch(next);
});

// Counts for the research page header and the Overview's detections card.
// Counted from the raw annotation records so every number matches the data
// a researcher can download, independent of how organize.divide groups them.
function buildWorkspaceStats(ai_data) {
  const count = (type, feature) => ai_data.filter(r => r.type === type && (!feature || r.feature === feature)).length;
  const descriptions = ai_data.filter(r => r.type === 'description' && (r.body || '').trim());
  const years = ai_data.map(r => Number(String(r.createdate || '').slice(0, 4))).filter(Number.isFinite).filter(y => y > 0);
  const first = years.length ? Math.min(...years) : null, last = years.length ? Math.max(...years) : null;
  const stats = {
    descriptions: descriptions.length,
    providers: new Set(descriptions.map(r => r.source)).size,
    tags: count('tag', 'full'),
    regions: count('tag', 'region'),
    faces: count('face'),
    categories: count('category'),
    // AWS Rekognition reports text as both a line and a word, so a one-word
    // inscription arrives twice. Count distinct readings per service, the
    // same way organize.divide lists them on the Tags & detections tab.
    text: new Set(ai_data.filter(r => r.type === 'text').map(r => r.source + '\0' + r.body)).size,
    // When the annotations were generated, e.g. "2018–2026"; not artwork dates.
    years: first === null ? null : first === last ? String(first) : `${first}–${last}`,
  };
  stats.detections = stats.tags + stats.regions + stats.faces + stats.categories + stats.text;
  return stats;
}

// Thumbnails for the image strip under the viewer, one per image of the
// object in museum display order. Labels identify an image without its ID:
// position, the image's date, and a short alt text or description.
function buildImageChoices(object_info, imageid) {
  const images = (object_info.images || []).slice().sort((a, b) => (a.displayorder || 0) - (b.displayorder || 0));
  const shorten = (text, max) => text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text;
  return images.map((image, index) => {
    const year = image.date ? String(image.date).slice(0, 4) : null;
    const about = image.alttext || image.description || '';
    const label = [`Image ${index + 1} of ${images.length}`, year && `photographed ${year}`]
      .filter(Boolean).join(', ') + (about ? ': ' + shorten(about, 120) : '');
    return {
      imageid: image.imageid,
      url: `/object/${encodeURIComponent(object_info.id)}/image/${image.imageid}`,
      // IIIF: fit within 96×96 so tall and wide images both stay whole.
      thumbnail: image.baseimageurl ? `${image.baseimageurl}/full/!96,96/0/default.jpg` : null,
      label,
      selected: image.imageid === Number(imageid),
    };
  });
}

// One row per AI description for the Descriptions index. Human-authored
// references stay out of the index; they appear on the Overview and in Compare.
function buildOutputRows(descriptions_list) {
  // Older services record no model ("unknown"); name the provider instead so
  // the row still says whose output it is.
  const hasModelName = d => d.display_model && d.display_model !== 'unknown';
  return descriptions_list.filter(d => !d.isHuman).map(d => ({
    ...d,
    display_model: hasModelName(d) ? d.display_model : d.source + ' (model not recorded)',
    words: d.stats ? d.stats.total : d.body.split(/\s+/).filter(Boolean).length,
  }));
}

function buildResearchDescriptions(ai_sorted, object_info, display_image) {
  let descriptions_list = [];

      if (object_info.labeltext) {
        descriptions_list.push({ key: 'labeltext', scope: 'Object wall label', source: 'Human', model: 'Wall Label Text', createdate: '?', body: object_info.labeltext, isHuman: true, stats: _computeStats(object_info.labeltext) });
      }
      if (display_image && display_image.description) {
        descriptions_list.push({ key: 'imagedesc', scope: 'Human image description', source: 'Human', model: 'Image Description', createdate: '?', body: display_image.description, isHuman: true, stats: _computeStats(display_image.description) });
      }

      for (let [key, val] of Object.entries(ai_sorted.descriptions || {})) {
        for (let desc of val.descriptions) {
          descriptions_list.push({
            key:           'annotation_' + desc.id,
            annotation_id: desc.id,
            source_raw: desc.source,
            scope: 'Image ' + (display_image ? display_image.imageid : ''),
            source:        val.source,
            model:         desc.model || '',
            display_model: desc.display_model || desc.model || '',
            model_released: desc.model_released || null,
            createdate:    desc.createdate,
            age:           desc.age || '',
            body:          desc.body || '',
            isHuman:       false,
            cost:         desc.cost,
            stats:         desc.stats || null
          });
        }
      }

  return descriptions_list;
}

/* GET object info. */
router.get('/object/:object_id/:image?/:image_id?', function(req, res, next) {
  if (req.params.image === 'compare' && !req.params.image_id) return res.redirect('/object/' + encodeURIComponent(req.params.object_id) + '#compare');
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);

  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;
  
  apiJSON(object_url, req.upstreamSignal)
  .then(object_info => {
    const selected = req.params.image_id
      ? (object_info.images || []).find(image => image.imageid === Number(req.params.image_id))
      : (object_info.images || [])[0];
    if (!selected) {
      const error = new Error('No matching image is available for this object.');
      error.status = 404;
      return next(error);
    }
    const imageid = selected.imageid;

    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + imageid + `&size=2000&apikey=` + API_KEY;
    // The full image record carries data the summary embedded in the object
    // record lacks, notably this image's own colour palette. It is optional:
    // if the request fails, the page renders without those fields.
    const image_url = `https://api.harvardartmuseums.org/image/` + imageid + `?apikey=` + API_KEY;
    const image_record = apiJSON(image_url, req.upstreamSignal)
      .catch(error => {
        if (req.upstreamSignal && req.upstreamSignal.aborted) throw error;
        return null;
      });

    return Promise.all([apiJSON(ai_url, req.upstreamSignal), image_record])
    .then(([ai_info, image_info]) => {
      // Evidence links retain the complete, original annotation body and model
      // identifier before organize.divide enriches/mutates the display records.
      const selected_annotation = req.query && req.query.annotation
        ? _.cloneDeep((ai_info.records || []).find(record => String(record.id) === req.query.annotation)) : null;
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc']);
      // Divide data into general categories
      let ai_sorted = organize.divide(ai_data)
      const image_summary = _buildImageSummary(ai_sorted);

      // The embedded summary keeps fields only it has (displayorder,
      // publiccaption); the full image record adds colors, fingerprints, etc.
      const embedded_image = _.find(object_info.images, {imageid: parseInt(imageid)});
      const display_image = image_info && image_info.imageid === embedded_image.imageid
        ? { ...embedded_image, ...image_info } : embedded_image;
      const descriptions_list = buildResearchDescriptions(ai_sorted, object_info, display_image);
      // An evidence link to a description opens it in the Descriptions reader;
      // any other annotation (tags, faces, regions) is shown as a source record.
      const linksToDescription = selected_annotation && selected_annotation.type === 'description';
      const image_choices = buildImageChoices(object_info, imageid);

      // Matches the page heading; the layout appends "| AI Explorer | Harvard Art Museums".
      res.render('object', { title: 'How AI describes ' + object_info.title + ' (image ' + imageid + ')',
                             selected_annotation: linksToDescription ? null : selected_annotation,
                             selected_output_id: linksToDescription ? selected_annotation.id : null,
                             descriptions_list,
                             output_rows: buildOutputRows(descriptions_list),
                             workspace_stats: buildWorkspaceStats(ai_info.records || []),
                             // Same display order as the image strip, so "(2 of 7)" matches it.
                             image_position: image_choices.findIndex(choice => choice.selected) + 1,
                             has_other_analysis: Boolean(display_image.colors && display_image.colors.length || ai_sorted.facesect || ai_sorted.featuresect || ai_sorted.categories && ai_sorted.categories.length || ai_sorted.captions && ai_sorted.captions.length || ai_sorted.textsect && ai_sorted.textsect.length),
                             multiple_images: object_info.images.length > 1,
                             object_images: object_info.images.map(image => ({...image, selected: image.imageid === Number(imageid)})),
                             image_choices,
                             navbar: true,
                             year: new Date().getFullYear(),
                             ai_data: ai_data,
                             ai_sorted: ai_sorted,
                             object_info: object_info,
                             display_image: display_image,
                             image_summary: image_summary,
                           });
    })
  })
  .catch(next);
});

/* Legacy comparison links now open the selected image workspace. */
router.get('/object/:object_id/:image?/:image_id?/compare', function(req, res) {
  const path = '/object/' + encodeURIComponent(req.params.object_id) + (req.params.image_id ? '/image/' + encodeURIComponent(req.params.image_id) : '');
  res.redirect(path + '#compare');
});

/* GET AI Perspectives JSON for an object/image. */
router.get('/object/:object_id/:image?/:image_id?/perspectives', function(req, res, next) {
  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;

  apiJSON(object_url, req.upstreamSignal)
  .then(object_info => {
    const selected = req.params.image_id
      ? (object_info.images || []).find(image => image.imageid === Number(req.params.image_id))
      : (object_info.images || [])[0];
    if (!selected) {
      const error = new Error('No matching image is available for this object.');
      error.status = 404;
      return next(error);
    }
    const imageid = selected.imageid;

    const cacheKey = `${object_info.id}_${imageid}_${perspectives.ALGORITHM_VERSION}`;
    const cached = perspectivesCacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + imageid + `&size=2000&apikey=` + API_KEY;
    return apiJSON(ai_url, req.upstreamSignal)
    .then(ai_info => {
      const ai_data      = ai_info.records || [];
      const display_image = _.find(object_info.images, {imageid: parseInt(imageid)});
      const result       = perspectives.compute(ai_data, object_info, display_image);
      perspectivesCacheSet(cacheKey, result);
      res.json(result);
    })
  })
  .catch(next);
});

router.get('/statistics', function(req, res, next) {
  if (!statsCache) {
    return res.status(503).send('Statistics are loading, please try again in a moment.');
  }

  let termClusters = _.groupBy(terms, (i) => _.lowerCase(i.term[0]));
  let samples = {
    "people": _.sortBy(_.sampleSize(people, 20), "term"),
    "places": _.sortBy(_.sampleSize(places, 20), "term"),
    "organizations": _.sortBy(_.sampleSize(organizations, 20), "term"),
    "terms": _.sortBy(_.sampleSize(terms, 20), "term"),
    "descriptions": _.sortBy(_.sampleSize(descriptions, 20), "term")
  };

  let stats = {
    term_count: terms.length.toLocaleString(),
    people_count: people.length.toLocaleString(),
    place_count: places.length.toLocaleString(),
    organization_count: organizations.length.toLocaleString(),
    description_count: descriptions.length.toLocaleString(),
    sources: statistics.sources,
    build_date: statistics.build_date,
    model_history: model_history,
    aggregations: statsCache.aggregations,
    date_of_oldest: statsCache.aggregations.date_stats.min_as_string.substr(0, 10),
    date_of_newest: statsCache.aggregations.date_stats.max_as_string.substr(0, 10),
    image_count: statsCache.aggregations.image_count.value.toLocaleString(),
    annotation_count: statsCache.info.totalrecords.toLocaleString(),
    refreshed_at: statsCache.refreshed_at
  };

  res.render('statistics', { title: 'Statistics',
                              navbar: true,
                              year: new Date().getFullYear(),
                              samples: samples,
                              terms: terms,
                              groups: termClusters,
                              descriptions: descriptions,
                              people: people,
                              places: places,
                              organizations: organizations,
                              stats: stats
                            });
});

/* REDIRECT to search page through post request from search bar */
router.post('/search', function(req, res){
  res.redirect('/search/' + req.body.search)
})

/* REDIRECT to explore page if a user removes the search tag from search URL */
router.get('/search', function(req, res){
  res.redirect('/explore')
})

/* REDIRECT to an arbitrary category once a user lands on category page. */
router.get('/category', function(req,res){
  res.redirect('/category/' + 'Interior objects')
})

/* REDIRECT to an arbitrary category once a user lands on category page. */
router.get('/feature', function(req,res){
  res.redirect('/feature/' + 'apple')
})

module.exports = router;
