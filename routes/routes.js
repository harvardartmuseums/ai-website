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
  if (req.params.page > 1) {
    page = req.params.page;
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
  if (req.params.page > 1) {
    page = req.params.page;
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
  if (req.params.page > 1) {
    page = req.params.page;
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
    build_date: statistics.build_date
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
