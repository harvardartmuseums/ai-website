require('dotenv').config({path: '.env'})

var _ = require('lodash');
const API_KEY = process.env['API_KEY']


module.exports = {
  idappend: function (results) {
    let search_url = `https://api.harvardartmuseums.org/object?size=100&apikey=` + API_KEY + `&image=`
    _.map(results, function(imageid){
      search_url = search_url.concat(imageid + "|")
    })
    search_url = search_url.slice(0, -1)
    return search_url
  },
  tagappend: function (object_results, tag_results) {
    _.map(object_results, function(object){
      if (object.images?.[0]) {
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
          if (tag.confidence <= 1) {
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
      if (object.images?.[0]) {
        let categories = _.filter(category_results, {imageid: object.images[0].imageid})
        _.map(categories, function(category){
          if (category.confidence <= 1) {
            category.confidence = _.round((category.confidence * 100), 1)
          }
        })
        object.category = categories[0]
      }
    })
    object_results = _.orderBy(object_results, ['category.confidence'], ['desc'])
    object_results = _.remove(object_results, o => typeof o.category !== 'undefined')
    return object_results
  },
  bucketappend: function (buckets, object_results, tag) {
    let termRe = tag ? new RegExp(_.escapeRegExp(tag), 'gi') : null;
    return buckets.map(bucket => {
      let object = _.find(object_results, o => _.some(o.images, {imageid: bucket.key})) || {objectid: -1, title: 'Information not available at this time', images: []};
      let image = _.find(object.images, {imageid: bucket.key}) || {imageid: -1};
      let hits = bucket.top_annotations.hits.hits.map(h => {
        let tag = Object.assign({}, h._source);
        if (tag.source === 'AWS Rekognition') tag.source = 'Amazon';
        else if (tag.source === 'Google Vision') tag.source = 'Google';
        else if (tag.source === 'Microsoft Cognitive Services') tag.source = 'Microsoft';
        else if (tag.source === 'Azure OpenAI Service') tag.source = 'OpenAI GPT';
        if (tag.confidence >= 0 && tag.confidence <= 1) tag.confidence = _.round(tag.confidence * 100, 1);
        return tag;
      });

      let validHits = hits.filter(h => h.confidence >= 0);

      let term_frequency = termRe ? hits.reduce((sum, h) => {
        let body = typeof h.body === 'string' ? h.body : '';
        return sum + (body.match(termRe) || []).length;
      }, 0) : 0;

      let bySource = _.groupBy(hits, 'source');
      let sources_summary = _.orderBy(
        Object.entries(bySource).map(([source, srcHits]) => {
          let valid = srcHits.filter(h => h.confidence >= 0);
          if (valid.length > 0) {
            let confs = valid.map(h => h.confidence);
            return { source, count: srcHits.length, min: Math.min(...confs), max: Math.max(...confs), has_confidence: true };
          }
          return { source, count: srcHits.length, has_confidence: false };
        }),
        [s => s.has_confidence ? 1 : 0, 'max', 'count'],
        ['desc', 'desc', 'desc']
      );

      let rawMin = bucket.min_confidence ? bucket.min_confidence.value : null;
      let rawMax = bucket.max_confidence ? bucket.max_confidence.value : null;
      let minConf = null;
      if (rawMin !== null && rawMin >= 0) {
        minConf = _.round(rawMin * 100, 1);
      } else if (validHits.length > 0) {
        minConf = validHits[validHits.length - 1].confidence;
      }
      let maxConf = (rawMax !== null && rawMax >= 0) ? _.round(rawMax * 100, 1) : null;

      return Object.assign({}, object, {
        imagehit: image,
        sources_summary,
        frequency: bucket.doc_count,
        term_frequency,
        min_confidence: minConf,
        max_confidence: maxConf
      });
    }).filter(r => r.sources_summary !== undefined);
  },
  objectappend: function (image_results, object_results) {
    _.map(image_results, function(image) {
      let object = _.find(object_results, o =>         
          _.some(o.images, {imageid: image.imageid})
      );
      if (object !== undefined) {
        image.object = object;
      } else {
        image.object = {objectid: -1};
      }
    });
    return image_results;
  }
}
