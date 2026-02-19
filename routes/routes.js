require('dotenv').config({path: '.env'})

var express = require('express');
var router = express.Router();
var querystring = require('querystring');
var _ = require('lodash');
var appendscript = require('../public/javascripts/appendscript')
var organize = require('../public/javascripts/organize')
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

const API_KEY = process.env['API_KEY']

/* GET home page. */
router.get('/', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6)
  const tag_url = `https://api.harvardartmuseums.org/annotation/?apikey=${API_KEY}&size=0&aggregation={"image_count":{"cardinality":{"field":"imageid","precision_threshold":100}}}`;
  
  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let annotation_count = tag_results.info.totalrecords.toLocaleString();
    let image_count = tag_results.aggregations.image_count.value.toLocaleString();
    res.render('index', {title: 'Home',
                          navbar: true,
                          year: new Date().getFullYear(),
                          tag_list: tag_list,
                          mobile_tag_list: mobile_tag_list,
                          image_list: image_list,
                          annotation_count: annotation_count,
                          image_count: image_count})
  })
});

/* GET about page. */
router.get('/about', function(req, res, nect) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);
  let image_list = _.sampleSize(example_images.image_list, 6);
  const tag_url = `https://api.harvardartmuseums.org/annotation/?apikey=${API_KEY}&size=0&aggregation={"image_count":{"cardinality":{"field":"imageid","precision_threshold":100}}}`;
  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let annotation_count = tag_results.info.totalrecords.toLocaleString();
    let image_count = tag_results.aggregations.image_count.value.toLocaleString();
    res.render('about', {title: 'About',
                          navbar: true,
                          year: new Date().getFullYear(),
                          tag_list: tag_list,
                          mobile_tag_list: mobile_tag_list,
                          image_list: image_list,
                          annotation_count: annotation_count,
                          image_count: image_count})
  })
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
  let page = 1;
  if (req.params.page > 1) {
    page = req.params.page;
  }  

  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6);
  let mobile_tag_list = _.sampleSize(example_tags.tags_list, 4);

  let aggs = {
      "by_source": {
          "terms": {
              "field": "source",
              "size": 20,
              "min_doc_count": 0,
              "exclude": "Manual"
          }
      },
      "image_count": {
          "cardinality": {
              "field": "imageid",
              "precision_threshold": 1000
          }
      },
      "confidences": {
          "histogram": {
              "field": "confidence",
              "interval": 0.05,
              "order": {"_key": "desc"},
              "extended_bounds": {
                "min": 0.0,
                "max": 1.0
              }
          }
      }
  };

  let qs = {
    'q': `confidence:>=0.0 AND (type:tag OR type:description) AND accesslevel:1 AND body.exact:("${_.lowerCase(req.params.tag)}" OR "${_.capitalize(req.params.tag)}" OR "${_.startCase(req.params.tag)}")`,
    'size': 300,
    'page': page,
    'sort': 'confidence',
    'sortorder': 'desc',
    'fields': 'imageid,confidence,source,body,type,feature',
    'apikey': API_KEY, 
    'aggregation': JSON.stringify(aggs)
  };
  const tag_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;

  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let tag_results_info = tag_results.info;    
    let tag_stats = tag_results.aggregations;
    tag_results_info.totalrecords_localized = tag_results.info.totalrecords.toLocaleString();
    tag_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1}

    // Sort tag results by confidence percent
    // tag_results = _.filter(tag_results.records, {type: 'tag'})
    tag_results = tag_results.records;
    tag_results = _.orderBy(tag_results, ['confidence'], ['desc'])
    // Create a new array of the image IDs that will show up
    let imageid_results = _.map(tag_results, 'imageid')
    // Function to create a new query to retrieve objects from image ids
    let object_url = appendscript.idappend(imageid_results)
    fetch(object_url).then(response => response.json())
    .then(object_results => {
      object_results = object_results.records
      // Match the object list with their corresponding tag results
      object_results = appendscript.tagappend(object_results, tag_results)
      let tag = req.params.tag
      res.render('search', { title: "Search results for '" + req.params.tag + "'",
                             subtitle: `${tag_results_info.totalrecords_localized} occurrences of '${req.params.tag}' found on ${tag_stats.image_count.value.toLocaleString()} images`,
                             navbar: true,
                             year: new Date().getFullYear(),
                             object_results: object_results,
                             tag_results: tag_results,
                             tag_stats: tag_stats,
                             error: false,
                             tag: req.params.tag,
                             tag_results_info: tag_results_info
                           });
    })
    .catch(() => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                            navbar: true,
                                            error: true,
                                            tag_list: tag_list,
                                            mobile_tag_list: mobile_tag_list,
                                            image_list: image_list})})
  })
  .catch(() => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                          navbar: true,
                                          error: true,
                                          tag_list: tag_list,
                                          mobile_tag_list: mobile_tag_list,
                                          image_list: image_list})})
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
    'fields': 'imageid,idsid,confidence,source,body,type,feature,selectors,target',
    'apikey': API_KEY,
  };
  const tag_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;

  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let feature_results_info = tag_results.info;
    feature_results_info.pagenumber = {nextpage: parseFloat(page) + 1, previouspage:  parseFloat(page) - 1};
    tag_results.records.forEach(tag => {
      coords = tag.selectors[0].value.replace('xywh=','');
      tag.imagefragmenturl = `https://ids.lib.harvard.edu/ids/iiif/${tag.idsid}/${coords}/full/0/default.jpg`;
      // tag.imagefragmenturl = tag.target.replace('/full/full', `/${coords}/full`);
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

router.get('/statistics', function(req, res, next) {
  // cluster terms by the first character of each term
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
    model_history: [
      {
        date_of_change: "2025-12-31",
        service: "Clarifai",
        summary: "Clarifai Legacy Models Decommissioning on December 31",
        details: `See https://docs.clarifai.com/product-updates/upcoming-api-changes/decommission-legacy-models/`
      },
      {
        date_of_change: "2026-01-30",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Claude 3 Opus 'anthropic.claude-3-opus-20240229-v1:0'",
        details: `Hello,

We are contacting you because you have used the following model ID 'anthropic.claude-3-opus-20240229-v1:0' [1] on Amazon Bedrock in the past 30 days.

This is the final notice that on January 30, 2026, the model will reach end-of-life [2] and will no longer be accessible in Amazon Bedrock.

We recommend migrating your usage to newer models launched by Anthropic or another model on Amazon Bedrock by updating your application code [3].

If you have any questions, please reach out to AWS support [4].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html#versions-for-legacy
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://aws.amazon.com/support`
      },
      {
        date_of_change: "2026-03-31",
        service: "Azure",
        summary: "Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 retired",
        details: `Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 will be retired 31 March 2026

On 31 March 2026, Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 will be retired.

As part of this retirement, the replacement model will be set to gpt-5.1 version 2025-11-13 on 9 March 2026. If you've selected the option to auto upgrade your standard, data-zone standard, or global standard deployment(s), they will be automatically upgraded to the replacement model version during the weeks prior to retirement. Learn more about setting your deployment upgrade options.

After the retirement date, model gpt-4o version(s) 2024-05-13 and 2024-08-06 will no longer be available or operable. This retirement will only timpact base-model deployments.

Beginning on 31 March 2026, fine-tuning on model gpt-4o version(s) 2024-05-13 and 2024-08-06 will no longer be allowed. Existing fine-tuned deployments will continue to operate for an additional year.`
      },
      {
        date_of_change: "2026-04-28",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Claude 3.7 Sonnet 'anthropic.claude-3-7-sonnet-20250219-v1:0'",
        details: `Hello,

We are contacting you because you have used model ID anthropic.claude-3-7-sonnet-20250219-v1:0 [1] on Amazon Bedrock in the past 30 days. Effective immediately, by moving Claude 3.7 Sonnet into the Legacy state [2], Anthropic is initiating the deprecation process for this model in the applicable Regions provided later in this message. Once the model enters the Legacy state, no additional Service Quota increases will be granted in the applicable Regions for the model. Claude 3.7 Sonnet will stay in the Legacy state until January 27, 2026, when the model will enter the Extended Access state. On April 28, 2026, the model will go end-of-life and will no longer be accessible from any of the following applicable regions.

Applicable Regions:
US-EAST-1
US-EAST-2
US-WEST-2
AP-NORTHEAST-1
AP-NORTHEAST-2
AP-NORTHEAST-3
AP-SOUTH-1
AP-SOUTH-2
AP-SOUTHEAST-1
AP-SOUTHEAST-2
EU-CENTRAL-1
EU-NORTH-1
EU-WEST-1
EU-WEST-3

Important dates:
- January 27, 2026: Extended access will begin.
- April 28, 2026: This model will no longer be available for use and requests made to this model ID will fail.

We recommend migrating your usage to the Claude Sonnet 4.5 from Anthropic [1] by updating your application code [3]. You can request an increase to your Claude Sonnet 4.5 quotas through Service Quotas [4].

If you have any questions or concerns, please reach out to AWS Support [5].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html#versions-for-legacy
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
[5] https://aws.amazon.com/support`
      },
      {
        date_of_change: "2026-05-19",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Command R+",
        details: `Hello,
        
We are contacting you because you have used model ID cohere.command-r-plus-v1:0 [1] on Amazon Bedrock in the past 30 days. Cohere will be sunsetting this model as of May 19, 2026.

Effective February 19, 2026, we are moving Command R+ into the Legacy state [2] in all AWS Regions. Once the model enters the Legacy state, no additional Service Quota increases will be granted for the model. For customers that need more time to migrate beyond May 19, 2026, Cohere is offering extended access with premium pricing until August 19, 2026. The model will no longer be available on Amazon Bedrock after August 19, 2026, in any AWS Region.

Important dates:
February 19, 2026: Legacy state begins
May 19, 2026: Model sunset date; extended access available with premium pricing
August 19, 2026: This model will no longer be available for use and requests made to this model ID will fail

Updated Pricing for On Demand Inference (Effective May 19, 2026):
Input tokens: $0.006 per 1,000 tokens
Output tokens: $0.03 per 1,000 tokens

Please note: If you have an existing private pricing agreement with Cohere or use provisioned throughput, your current pricing terms will continue to apply.

We recommend migrating your usage to alternative models [1] available on Amazon Bedrock, such as Anthropic Claude Sonnet 4.5, Amazon Nova Pro, or Mistral Large 3 by updating your application code [3]. You can request an increase to your quotas for these models through Service Quotas [4].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
[5] https://aws.amazon.com/support`
      },    
    ]
  }

  let aggs = {
    "image_count": {
      "cardinality": { 
        "field": "imageid",
        "precision_threshold":100
      }
    },
    "date_stats": {
      "extended_stats": {
          "field": "createdate"
      }
    },    
    "by_source": {
      "terms": {
        "field": "source",
        "min_doc_count": 0,
        "size": 20,
        "exclude": "Manual",
        "order": { "_key": "asc" }     
      },
      "aggs": {
        "image_coverage": {
            "cardinality": {
                "field": "imageid",
                "precision_threshold": 1000
            }
        },
        "by_type": {
          "terms": {
            "field": "type",
            "min_doc_count": 0,
            "order": { "_key": "asc" }            
          }
        }
      }
    },
    "by_type": {
        "terms": {
            "field": "type",
            "order": { "_key": "asc" }   
        },
        "aggs": {
            "by_source": {
                "terms": {
                    "field": "source",
                    "min_doc_count": 0,
                    "size": 20,
                    "exclude": "Manual",
                    "order": { "_key": "asc" }
                } 
            }
        }
    }
  };

  let qs = {
    'size': 0,
    'apikey': API_KEY, 
    'aggregation': JSON.stringify(aggs)
  };
  const stats_url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
  fetch(stats_url).then(response => response.json())
  .then(stats_results => {
            stats.aggregations = stats_results.aggregations;
            stats.aggregations.by_source.buckets.forEach(a => {
              a.image_coverage.percentage = (a.image_coverage.value/stats.aggregations.image_count.value)*100;
            });
            stats.date_of_oldest = stats.aggregations.date_stats.min_as_string.substr(0, 10);
            stats.date_of_newest = stats.aggregations.date_stats.max_as_string.substr(0, 10);
            stats.image_count = stats.aggregations.image_count.value.toLocaleString();
            stats.annotation_count = stats_results.info.totalrecords.toLocaleString();
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
