var express = require('express');
var router = express.Router();
const API_KEY = '67669ae0-b77e-11e8-bf0e-e9322ccde4db';
var fetch = require('node-fetch')
require('cross-fetch/polyfill');
var async = require('async');
var _ = require('lodash');
var appendscript = require('../public/javascripts/appendscript')
var organize = require('../public/javascripts/organize')
var imagga_categories = require('../public/categories/imagga_categories')
var example_tags = require('../public/examples/exampletags')
var example_images = require('../public/examples/exampleimages')


/* GET home page. */
router.get('/', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  res.render('index', { title: 'Machine Tag Explorer',
                        navbar: true,
                        tag_list: tag_list,
                        image_list: image_list
                      });
});


/* GET explore page. */
router.get('/explore', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  res.render('explore', { title: 'Explore',
                          navbar: true,
                          tag_list: tag_list,
                          image_list: image_list
                        });
});


/* GET search results. */
router.get('/search/:tag', function(req, res, next) {
  const tag_url = `https://api.harvardartmuseums.org/annotation/?q=body:` + req.params.tag + `&size=100&apikey=` + API_KEY;
  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    // Sort tag results by confidence percent
    tag_results = _.orderBy(tag_results.records, ['confidence'], ['desc'])
    let imageid_results = _.map(tag_results, 'imageid')
    // Function to create a new query to retrieve objects from image ids
    let object_url = appendscript.idappend(imageid_results)
    fetch(object_url).then(response => response.json())
    .then(object_results => {
      object_results = object_results.records
      object_results = appendscript.tagappend(object_results, tag_results)
      res.render('search', { title: "Search results for '" + req.params.tag + "'",
                             navbar: true,
                             object_results: object_results,
                             tag_results: tag_results
                           });
    })
  })
});

router.get('/category/:category', function(req, res, next) {
  const category_url = `https://api.harvardartmuseums.org/annotation/?size=100&apikey=` + API_KEY + `&q=type:category AND body:` + req.params.category
  fetch(category_url).then(response => response.json())
  .then(category_results => {
    category_results = _.orderBy(category_results.records, ['confidence'], ['desc'])
    let imageid_results = _.map(category_results, 'imageid')
    let object_url = appendscript.idappend(imageid_results)
    fetch(object_url).then(response => response.json())
    .then(object_results => {
      object_results = object_results.records
      object_results = appendscript.categoryappend(object_results, category_results)
      res.render('category', { title: "Category results for '" + req.params.category + "'",
                             navbar: true,
                             object_results: object_results,
                             category_results: category_results,
                             category_list: imagga_categories.categories_list,
                             category: req.params.category
                           });
    })
  })
});

/* GET object info. */
router.get('/object/:object_id', function(req, res, next) {
  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;
  fetch(object_url).then(response => response.json())
  .then(object_info => {
    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + object_info.images[0].imageid + `&size=300&apikey=` + API_KEY;
    fetch(ai_url).then(response => response.json())
    .then(ai_info => {
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc'])
      // Divide data into general categories
      let ai_sorted = organize.divide(ai_data)
      console.log(object_info)
      res.render('object', { title: 'Object info',
                             navbar: false,
                             ai_data: ai_data,
                             ai_sorted: ai_sorted,
                             object_info: object_info,
                           });
    })
  })
});

router.post('/search', function(req, res){
  res.redirect('/search/' + req.body.search)
})


module.exports = router;