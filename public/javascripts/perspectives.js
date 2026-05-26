'use strict';

var nlp = require('compromise');
var _ = require('lodash');
var stopwords = require('../vocabularies/stopwords');

// ---------------------------------------------------------------------------
// Versioned config — bump algorithm_version on any change (see semver rules
// in the plan: patch for list changes, minor for scoring/threshold changes,
// major for schema/NLP backend changes).
// ---------------------------------------------------------------------------

const ALGORITHM_VERSION = 'ace-v1.0.0';

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
]);

// Pairs of semantically incompatible concepts (cross-service divergence).
const INCOMPATIBILITY_LIST = [
  ['indoor', 'outdoor'],
  ['interior', 'exterior'],
  ['day', 'night'],
  ['daytime', 'nighttime'],
  ['man', 'woman'],
  ['boy', 'girl'],
  ['portrait', 'landscape'],  // as genre terms
  ['abstract', 'figurative'],
  ['monochrome', 'color'],
  ['monochrome', 'colour'],
];

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeText(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
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

function extractFromDescription(annotation) {
  const raw = annotation.body || '';
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
  return {
    concept_text:    phrase,
    source:          annotation.source,
    annotation_id:   annotation.id,
    type:            type,
    people_related:  isPeopleRelated(phrase),
    concept_type:    conceptType(phrase),
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
        concept:          key,
        services:         new Set(),
        annotation_ids:   new Set(),
        types:            new Set(),
        count_total:      0,
        people_related:   false,
        interpretive_count: 0,
        total_count:      0,
        // keep up to 3 raw occurrences as evidence snippets
        _occurrences:     [],
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
// Main compute function
// ---------------------------------------------------------------------------

function compute(ai_data, object_info, display_image) {
  // Build annotation lookup for snippet extraction
  const annotationsById = new Map();
  for (const rec of ai_data) {
    annotationsById.set(rec.id, rec);
  }

  // Separate annotation types
  const tagAnnotations  = ai_data.filter(r => r.type === 'tag' && r.feature === 'full');
  const descAnnotations = ai_data.filter(r => r.type === 'description');
  const faceAnnotations = ai_data.filter(r => r.type === 'face');
  const textAnnotations = ai_data.filter(r => r.type === 'text');

  if (tagAnnotations.length === 0 && descAnnotations.length === 0) {
    return {
      objectid:          object_info ? object_info.id : null,
      imageid:           display_image ? display_image.imageid : null,
      status:            'no_annotations',
      algorithm_version: ALGORITHM_VERSION,
      generated_at:      new Date().toISOString(),
    };
  }

  // Extract concept occurrences
  const occurrences = [];
  for (const ann of tagAnnotations)  occurrences.push(...extractFromTag(ann));
  for (const ann of descAnnotations) occurrences.push(...extractFromDescription(ann));

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

    agreementConcepts.push({
      concept:             entry.concept,
      concept_type:        cType,
      consensus_score:     consensusScore,
      agreement_level:     agreementLevel(normServices, normAnnotations),
      services_count:      sCount,
      annotations_count:   aCount,
      types:               Array.from(entry.types),
      people_related:      entry.people_related,
      example_annotations: buildExamples(entry, annotationsById),
    });
  }
  agreementConcepts.sort((a, b) => b.consensus_score - a.consensus_score);
  const topConcepts = agreementConcepts.slice(0, CONFIG.top_N);

  // -------------------------------------------------------------------------
  // Divergence signals
  // -------------------------------------------------------------------------
  const divergenceSignals = [];

  // Pattern A: single-service concepts with >= 2 annotations from that service
  const singleServiceCandidates = [];
  for (const [, entry] of conceptMap) {
    if (entry.services.size !== 1) continue;
    if (entry.annotation_ids.size < 2) continue;
    const service = Array.from(entry.services)[0];
    const exampleOcc = entry._occurrences[0];
    const rec = annotationsById.get(exampleOcc ? exampleOcc.annotation_id : null);
    const body = rec ? (rec.body || '') : '';
    singleServiceCandidates.push({
      type:            'single_service',
      concept:         entry.concept,
      concept_type:    entry.interpretive_count / entry.total_count > 0.5 ? 'interpretive' : 'descriptive',
      service:         service,
      annotations_count: entry.annotation_ids.size,
      example_snippet: body.length > 120 ? body.slice(0, 120) + '…' : body,
    });
  }
  singleServiceCandidates.sort((a, b) => b.annotations_count - a.annotations_count);

  // Pattern B: cross-service disagreements from incompatibility list
  const allConceptTexts = new Set(conceptMap.keys());
  const crossDisagreements = [];
  for (const [termA, termB] of INCOMPATIBILITY_LIST) {
    if (!allConceptTexts.has(termA) || !allConceptTexts.has(termB)) continue;
    const entryA = conceptMap.get(termA);
    const entryB = conceptMap.get(termB);
    if (!entryA || !entryB) continue;
    crossDisagreements.push({
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

  // Merge: cross-service first (more interesting), then single-service, cap at max_divergence
  const combined = [...crossDisagreements, ...singleServiceCandidates];
  const topDivergence = combined.slice(0, CONFIG.max_divergence);

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
      total_raw_concepts:         occurrences.length,
      concepts_returned:          topConcepts.length,
      divergence_signals_returned: topDivergence.length,
      has_text:                   hasText,
      text_sample:                textSample,
      has_faces:                  hasFaces,
      face_stats:                 faceStats,
      depicts_people:             depictsPeople,
      depicts_people_level:       depictsPeopleLevel,
      depicts_people_examples:    depictsPeopleExamples,
    },
    concepts:           topConcepts,
    divergence_signals: topDivergence,
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
