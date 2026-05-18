require('dotenv').config({path: '.env'})

var express = require('express');
var router = express.Router();
var querystring = require('querystring');
var _ = require('lodash');
var appendscript = require('../public/javascripts/appendscript')
var organize = require('../public/javascripts/organize')
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

const API_KEY = process.env['API_KEY']

let statsCache = null;

async function refreshStatsCache() {
  const aggs = {
    "image_count": {
      "cardinality": { "field": "imageid", "precision_threshold": 100 }
    },
    "date_stats": {
      "extended_stats": { "field": "createdate" }
    },
    "by_source": {
      "terms": {
        "field": "source", "min_doc_count": 0, "size": 20,
        "exclude": "Manual", "order": { "_key": "asc" }
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
    },
    "by_type": {
      "terms": { "field": "type", "order": { "_key": "asc" } },
      "aggs": {
        "by_source": {
          "terms": {
            "field": "source", "min_doc_count": 0, "size": 20,
            "exclude": "Manual", "order": { "_key": "asc" }
          }
        }
      }
    }
  };
  const qs = { size: 0, apikey: API_KEY, aggregation: JSON.stringify(aggs) };
  const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    data.aggregations.by_source.buckets.forEach(a => {
      a.image_coverage.percentage =
        (a.image_coverage.value / data.aggregations.image_count.value) * 100;
    });
    data.refreshed_at = new Date().toISOString();
    statsCache = data;
    console.log(`Stats cache refreshed at ${statsCache.refreshed_at}`);
  } catch (e) {
    console.error('Stats cache refresh failed:', e.message);
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
        "min_confidence": {"min": {"field": "confidence"}},
        "top_annotations": {
          "top_hits": {
            "size": 75,
            "sort": [{"confidence": "desc"}],
            "_source": ["body", "confidence", "source", "type", "feature"]
          }
        }
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

  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    if (tag_results.info.totalrecords === 0) {
      return res.render('search', {title: `No search results for '${req.params.tag}'`,
                                  navbar: true, error: true,
                                  tag_list: tag_list, mobile_tag_list: mobile_tag_list, image_list: image_list});
    }
    
    let all_buckets = tag_results.aggregations.top_images.buckets;
    let page_buckets = all_buckets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    let total_images = tag_results.aggregations.image_count.value;
    let total_sources = tag_results.aggregations.source_count.value;
    let total_pages = Math.ceil(total_images / PAGE_SIZE);
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
    let object_url = appendscript.idappend(imageid_list);
    fetch(object_url).then(response => response.json())
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
    .catch(() => {res.render('search', {title: `No search results for '${req.params.tag}'`,
                                        navbar: true, error: true,
                                        tag_list: tag_list, mobile_tag_list: mobile_tag_list, image_list: image_list})})
  })
  .catch(() => {res.render('search', {title: `No search results for '${req.params.tag}'`,
                                      navbar: true, error: true,
                                      tag_list: tag_list, mobile_tag_list: mobile_tag_list, image_list: image_list})})
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

  fetch(tag_url).then(response => response.json())
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
    fetch(object_url).then(response => response.json())
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
  });
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

  fetch(tag_url).then(response => response.json())
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
    fetch(object_url).then(response => response.json())
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
  });
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
  fetch(category_url).then(response => response.json())
  .then(category_results => {
    let category_results_info = category_results.info;
    let category_stats = category_results.aggregations;
    category_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1}
    category_results = _.orderBy(category_results.records, ['confidence'], ['desc'])
    let imageid_results = _.map(category_results, 'imageid')
    let object_url = appendscript.idappend(imageid_results)
    fetch(object_url).then(response => response.json())
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
  })
});

/* GET object info. */
router.get('/object/:object_id/:image?/:image_id?', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);

  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;
  
  fetch(object_url).then(response => response.json())
  .then(object_info => {
    let imageid = object_info.images[0].imageid;
    if (req.params.image_id > 0) {
      imageid = req.params.image_id;
    }

    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + imageid + `&size=2000&apikey=` + API_KEY;
    fetch(ai_url).then(response => response.json())
    .then(ai_info => {
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc']);
      // Divide data into general categories
      let ai_sorted = organize.divide(ai_data)

      let display_image = _.find(object_info.images, {imageid: parseInt(imageid)});

      res.render('object', { title: 'AI Data for ' + object_info.title,
                             navbar: false,
                             year: new Date().getFullYear(),
                             ai_data: ai_data,
                             ai_sorted: ai_sorted,
                             object_info: object_info,
                             display_image: display_image,  
                           });
    })
    .catch(() => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                            navbar: true,
                                            year: new Date().getFullYear(),
                                            error: true,
                                            tag_list: tag_list,
                                            mobile_tag_list: mobile_tag_list,
                                            image_list: image_list})})
  })
  .catch(() => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                          navbar: true,
                                          year: new Date().getFullYear(),
                                          error: true,
                                          tag_list: tag_list,
                                          mobile_tag_list: mobile_tag_list,
                                          image_list: image_list})})
});

/* GET compare descriptions view. */
router.get('/compare/:object_id/:image_id?', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);

  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;

  fetch(object_url).then(response => response.json())
  .then(object_info => {
    let imageid = object_info.images[0].imageid;
    if (req.params.image_id > 0) {
      imageid = req.params.image_id;
    }

    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + imageid + `&size=2000&apikey=` + API_KEY;
    fetch(ai_url).then(response => response.json())
    .then(ai_info => {
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc']);
      let ai_sorted = organize.divide(ai_data);
      let display_image = _.find(object_info.images, {imageid: parseInt(imageid)});

      let descriptions_list = [];

      if (object_info.labeltext) {
        descriptions_list.push({ key: 'labeltext', source: 'Human', model: 'Wall Label', createdate: '', body: object_info.labeltext, isHuman: true });
      }
      if (display_image && display_image.description) {
        descriptions_list.push({ key: 'imagedesc', source: 'Human', model: 'Image Description', createdate: '', body: display_image.description, isHuman: true });
      }

      for (let [key, val] of Object.entries(ai_sorted.descriptions)) {
        for (let desc of val.descriptions) {
          let raw_model = desc.model || '';
          let usage = null;
          if (desc.raw && desc.raw.usage) {
            let u = desc.raw.usage;
            let input  = u.inputTokens  != null ? u.inputTokens  : (u.prompt_tokens     != null ? u.prompt_tokens     : null);
            let output = u.outputTokens != null ? u.outputTokens : (u.completion_tokens != null ? u.completion_tokens : null);
            if (input !== null || output !== null) usage = { input, output };
          }
          descriptions_list.push({ key: 'desc_' + descriptions_list.length, source: val.source, model: raw_model, display_model: models[raw_model] || raw_model, createdate: desc.createdate, body: desc.body, isHuman: false, usage });
        }
      }

      res.render('compare', { title: 'Compare — ' + object_info.title,
                               navbar: false,
                               year: new Date().getFullYear(),
                               object_info: object_info,
                               display_image: display_image,
                               descriptions_list: descriptions_list,
                             });
    })
    .catch(() => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                            navbar: true,
                                            year: new Date().getFullYear(),
                                            error: true,
                                            tag_list: tag_list,
                                            mobile_tag_list: mobile_tag_list,
                                            image_list: image_list})})
  })
  .catch(() => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                          navbar: true,
                                          year: new Date().getFullYear(),
                                          error: true,
                                          tag_list: tag_list,
                                          mobile_tag_list: mobile_tag_list,
                                          image_list: image_list})})
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
