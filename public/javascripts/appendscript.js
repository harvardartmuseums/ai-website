var _ = require('lodash');
var async = require('async');
require('dotenv').config({path: '.env'})
const API_KEY = process.env['API_KEY']


module.exports = {
  idappend: function (results) {
    let search_url = `https://api.harvardartmuseums.org/object?size=100&apikey=` + API_KEY + `&q=`
    _.map(results, function(imageid){
      search_url = search_url.concat('images.imageid:' + imageid + " OR ")
    })
    search_url = search_url.slice(0, -4)
    return search_url
  },
  tagappend: function (object_results, tag_results) {
    _.map(object_results, function(object){
      if (object.images[0]) {
        let tags = _.filter(tag_results, {imageid: object.images[0].imageid})
        _.map(tags, function(tag){
          // Rename sources to shorter versions
          if (tag.source === 'AWS Rekognition') {
            tag.source = 'Amazon'
          } else if (tag.source === 'Google Vision') {
            tag.source = 'Google'
          } else if (tag.source === 'Microsoft Cognitive Services') {
            tag.source = 'Microsoft'
          }
          // Round the percent confidence
          if (tag.confidence < 1) {
            tag.confidence = _.round((tag.confidence * 100), 1)
          }
        })
        object.firsttag = tags[0]
        object.secondarytags = _.drop(tags, 1)
      }
    })
    // Sort by % confidence in descending order
    object_results = _.orderBy(object_results, ['firsttag.confidence'], ['desc'])
    // Remove undefined % values
    object_results = _.remove(object_results, o => typeof o.firsttag !== 'undefined')
    return object_results
  },
  categoryappend: function (object_results, category_results) {
    _.map(object_results, function(object) {
      if (object.images[0]) {
        let categories = _.filter(category_results, {imageid: object.images[0].imageid})
        _.map(categories, function(category){
          if (category.confidence < 1) {
            category.confidence = _.round((category.confidence * 100), 1)
          }
        })
        object.category = categories[0]
      }
    })
    object_results = _.orderBy(object_results, ['category.confidence'], ['desc'])
    object_results = _.remove(object_results, o => typeof o.category !== 'undefined')
    return object_results
  }
}
