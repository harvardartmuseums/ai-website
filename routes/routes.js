var express = require('express');
var router = express.Router();
var fetch = require('node-fetch')
require('cross-fetch/polyfill');
require('dotenv').config({path: '.env'})
var async = require('async');
var _ = require('lodash');
var appendscript = require('../public/javascripts/appendscript')
var organize = require('../public/javascripts/organize')
var imagga_categories = require('../public/categories/imagga_categories')
var example_tags = require('../public/examples/exampletags')
var example_images = require('../public/examples/exampleimages')

const API_KEY = process.env['API_KEY']

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

router.get('/about', function(req, res, nect) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  res.render('about', {title: 'About',
                        navbar: true,
                        tag_list: tag_list,
                        image_list: image_list})
})


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
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  const tag_url = `https://api.harvardartmuseums.org/annotation/?q=body:` + req.params.tag + `&size=300&sort=confidence&sortorder=desc&apikey=` + API_KEY;
  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let tag_results_info = tag_results.info
    tag_results_info.pagenumber = {nextpage: 2};
    if (tag_results_info.pages > 33) {
      tag_results_info.pages = 33
    }
    // Sort tag results by confidence percent
    tag_results = _.filter(tag_results.records, {type: 'tag'})
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
                             navbar: true,
                             object_results: object_results,
                             tag_results: tag_results,
                             error: false,
                             tag: tag,
                             firstpage: true,
                             tag_results_info: tag_results_info
                           });
    })
    .catch(error => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                            navbar: true,
                                            error: true,
                                            tag_list: tag_list,
                                            image_list: image_list})})
  })
  .catch(error => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                          navbar: true,
                                          error: true,
                                          tag_list: tag_list,
                                          image_list: image_list})})
});

/* GET search results. */
router.get('/search/:tag/:page', function(req, res, next) {
  // If it's the first page, redirect to other route
  if (req.params.page == 1) {
    res.redirect('/search/' + req.params.tag)
  }
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  const tag_url = `https://api.harvardartmuseums.org/annotation/?q=body:` + req.params.tag + `&size=300&sort=confidence&sortorder=desc&apikey=` + API_KEY + '&page=' + req.params.page;
  fetch(tag_url).then(response => response.json())
  .then(tag_results => {
    let tag_results_info = tag_results.info
    tag_results_info.pagenumber = {nextpage: parseFloat(req.params.page) + 1, previouspage:  parseFloat(req.params.page) - 1}
    if (tag_results_info.pages > 33) {
      tag_results_info.pages = 33
    }
    // Sort tag results by confidence percent
    tag_results = _.filter(tag_results.records, {type: 'tag'})
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
                             navbar: true,
                             object_results: object_results,
                             tag_results: tag_results,
                             error: false,
                             tag: tag,
                             tag_results_info: tag_results_info,
                             firstpage: false
                           });
    })
    .catch(error => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                            navbar: true,
                                            error: true,
                                            tag_list: tag_list,
                                            image_list: image_list})})
  })
  .catch(error => {res.render('search', {title: "No search results for '" + req.params.tag + "'",
                                          navbar: true,
                                          error: true,
                                          tag_list: tag_list,
                                          image_list: image_list})})
});


router.get('/category/:category', function(req, res, next) {
  const category_url = `https://api.harvardartmuseums.org/annotation/?size=100&sort=confidence&sortorder=desc&apikey=` + API_KEY + `&q=type:category AND body:` + req.params.category
  fetch(category_url).then(response => response.json())
  .then(category_results => {
    let category_results_info = category_results.info
    category_results_info.pagenumber = {nextpage: parseFloat(req.params.page) + 1, previouspage:  parseFloat(req.params.page) - 1}
    if (category_results_info.pages > 33) {
      category_results_info.pages = 33
    }
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
                             category: req.params.category,
                             category_results_info: category_results_info,
                           });
    })
  })
});

router.get('/category/:category/:page', function(req, res, next) {
  if (req.params.page == 1) {
    res.redirect('/category/' + req.params.category)
  }
  const category_url = `https://api.harvardartmuseums.org/annotation/?size=100&sort=confidence&sortorder=desc&apikey=` + API_KEY + `&q=type:category AND body:` + req.params.category + '&page=' + req.params.page;
  fetch(category_url).then(response => response.json())
  .then(category_results => {
    let category_results_info = category_results.info
    category_results_info.pagenumber = {nextpage: parseFloat(req.params.page) + 1, previouspage:  parseFloat(req.params.page) - 1}
    if (category_results_info.pages > 33) {
      category_results_info.pages = 33
    }
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
                             category: req.params.category,
                             category_results_info: category_results_info
                           });
    })
  })
});

/* GET object info. */
router.get('/object/:object_id', function(req, res, next) {
  let tag_list = _.sampleSize(example_tags.tags_list, 5);
  let image_list = _.sampleSize(example_images.image_list, 6)
  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;
  fetch(object_url).then(response => response.json())
  .then(object_info => {
    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + object_info.images[0].imageid + `&size=2000&apikey=` + API_KEY;
    fetch(ai_url).then(response => response.json())
    .then(ai_info => {
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc'])
      // Divide data into general categories
      let ai_sorted = organize.divide(ai_data)
      console.log(ai_sorted)
      res.render('object', { title: 'Object info',
                             navbar: false,
                             ai_data: ai_data,
                             ai_sorted: ai_sorted,
                             object_info: object_info,
                           });
    })
    .catch(error => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                            navbar: true,
                                            error: true,
                                            tag_list: tag_list,
                                            image_list: image_list})})
  })
  .catch(error => {res.render('search', {title: "No AI data for object ID '" + req.params.object_id + "'",
                                          navbar: true,
                                          error: true,
                                          tag_list: tag_list,
                                          image_list: image_list})})
});


/* GET object info with a highlighted tag. */
router.get('/object/:object_id/:tag', function(req, res, next) {
  const object_url = `https://api.harvardartmuseums.org/object/` + req.params.object_id + `?apikey=` + API_KEY;
  fetch(object_url).then(response => response.json())
  .then(object_info => {
    const ai_url = `https://api.harvardartmuseums.org/annotation/?image=` + object_info.images[0].imageid + `&size=300&apikey=` + API_KEY;
    fetch(ai_url).then(response => response.json())
    .then(ai_info => {
      let ai_data = _.orderBy(ai_info.records, ['confidence'], ['desc'])
      // Divide data into general categories
      let ai_sorted = organize.divide(ai_data)
      res.render('object', { title: 'Object info',
                             navbar: false,
                             ai_data: ai_data,
                             ai_sorted: ai_sorted,
                             object_info: object_info,
                             tag: req.params.tag
                           });
    })
  })
});

router.post('/search', function(req, res){
  res.redirect('/search/' + req.body.search)
})

router.get('/category', function(req,res){
  res.redirect('/category/' + 'Interior objects')
})


module.exports = router;
