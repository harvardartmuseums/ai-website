var _ = require('lodash');
var async = require('async');
var appendscript = require('/appendscript')
var fetch = require('node-fetch')
var organize = require('/organize')

require('cross-fetch/polyfill');
require('dotenv').config({path: '.env'})
const API_KEY = process.env['API_KEY']

module.exports = {
  infinitescroll: function (tag) {
    const tag_url = `https://api.harvardartmuseums.org/annotation/?q=body:` + tag + `&size=300&sort=confidence&sortorder=desc&apikey=` + API_KEY;
    fetch(tag_url).then(response => response.json())
    .then(tag_results => {
      let next_page = tag_results.info.next
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
      })
    })
  }
}
