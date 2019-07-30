var _ = require('lodash');
var async = require('async');
const API_KEY = '67669ae0-b77e-11e8-bf0e-e9322ccde4db';


module.exports = {
  amazonfacesort: function (facedata) {
    _.map(facedata, function(face) {
      let agerange = face.raw.AgeRange.Low + '-' + face.raw.AgeRange.High
      let gendervalue = face.raw.Gender.Value + ", " + _.round(face.raw.Gender.Confidence, 1) +"%"
      let ageobject = {type: 'Age', body: agerange}
      let genderobject = {type: 'Gender', body: gendervalue}
      face.sorted_raw = _.concat(face.sorted_raw, ageobject, genderobject)
      let emotions = _.map(face.raw.Emotions, function(emotion) {
          emotion.type = _.capitalize(emotion.Type)
          emotion.body = _.round(emotion.Confidence, 1) + "%"
          let emotionobject = {type: emotion.type, body: emotion.body}
          face.sorted_raw = _.concat(face.sorted_raw, emotionobject)
      })
      face.sorted_raw.shift()
    })
  },
  microsoftfacesort: function (facedata) {
    _.map(facedata, function(face) {
      let age = face.raw.age
      let gender = face.raw.gender
      let ageobject = {type: 'Age', body: age}
      let genderobject = {type: 'Gender', body: gender}
      face.sorted_raw = _.concat(face.sorted_raw, ageobject, genderobject)
      face.sorted_raw.shift()
    })
  },
  googlefacesort: function (facedata){
    _.map(facedata, function(face) {
      // Take the emotions and format them for HTML looping
      let surprise = _.capitalize(face.raw.surpriseLikelihood).replace(/_/g, ' ');
      let anger = _.capitalize(face.raw.angerLikelihood).replace(/_/g, ' ');
      let sorrow = _.capitalize(face.raw.sorrowLikelihood).replace(/_/g, ' ');
      let joy = _.capitalize(face.raw.joyLikelihood).replace(/_/g, ' ');
      let headwear = _.capitalize(face.raw.headwearLikelihood).replace(/_/g, ' ');
      let blurred = _.capitalize(face.raw.blurredLikelihood).replace(/_/g, ' ');
      // Create a JSON object
      let surpriseobject = {type: 'Surprise', body: surprise},
          angerobject = {type: 'Anger', body: anger},
          sorrowobject = {type: 'Sorrow', body: sorrow},
          joyobject = {type: 'Joy', body: joy},
          headwearobject = {type: 'Headwear', body: headwear},
          blurredobject = {type: 'Blurred', body: blurred}
      face.sorted_raw = _.concat(face.sorted_raw,
                                 surpriseobject,
                                 angerobject,
                                 sorrowobject,
                                 joyobject,
                                 headwearobject,
                                 blurredobject)
      face.sorted_raw.shift()
    })
  },
  divide: function (ai_data) {
    ai_data = _.map(ai_data, function(annotation){
      annotation.confidence = _.round((annotation.confidence * 100), 1)
      return annotation
    })
    let ai_sorted = {}
    ai_sorted.tagsect = {Amazon:{source: 'Amazon', tags: {}},
                         Clarifai:{source: 'Clarifai', tags: {}},
                         Imagga:{source: 'Imagga', tags: {}},
                         Google:{source: 'Google', tags: {}},
                         Microsoft:{source: 'Microsoft', tags: {}}}
    ai_sorted.tagsect.Amazon.tags = _.filter(ai_data, {type: 'tag', source: 'AWS Rekognition'})
    ai_sorted.tagsect.Clarifai.tags = _.filter(ai_data, {type: 'tag', source: 'Clarifai'})
    ai_sorted.tagsect.Imagga.tags = _.filter(ai_data, {type: 'tag', source: 'Imagga'})
    ai_sorted.tagsect.Google.tags = _.filter(ai_data, {type: 'tag', source: 'Google Vision'})
    ai_sorted.tagsect.Microsoft.tags = _.filter(ai_data, {type: 'tag', source: 'Microsoft Cognitive Services'})
    if ( _.filter(ai_data, {type: 'face'}).length !== 0) {
      ai_sorted.facesect = {Amazon:{source:'Amazon', tags:{}},
                            Microsoft:{source:'Microsoft', tags:{}},
                            Google:{source:'Google', tags:{}}}
      amazonfaces = _.filter(ai_data, {type: 'face', source: 'AWS Rekognition'})
      ai_sorted.facesect.Amazon.faces = _.map(amazonfaces, module.exports.amazonfacesort(amazonfaces))
      microsoftfaces = _.filter(ai_data, {type: 'face', source: 'Microsoft Cognitive Services'})
      ai_sorted.facesect.Microsoft.faces = _.map(microsoftfaces, module.exports.microsoftfacesort(microsoftfaces))
      googlefaces = _.filter(ai_data, {type: 'face', source: 'Google Vision'})
      ai_sorted.facesect.Google.faces = _.map(googlefaces, module.exports.googlefacesort(googlefaces))
    }
    if (_.filter(ai_data, {type: 'tag', feature: 'region'}) !== 0) {
      ai_sorted.featuresect = {Amazon:{source:'Amazon', features:{}}}
      ai_sorted.featuresect.Amazon.features = _.uniqBy(_.filter(ai_data, {type: 'tag', feature: 'region'}), 'body')

    }
    console.log(ai_sorted.featuresect.Amazon.features)
    ai_sorted.captions = {}
    ai_sorted.captions.Microsoft = _.filter(ai_data, {type: 'description'})
    ai_sorted.categories = {}
    ai_sorted.categories.Imagga = _.filter(ai_data, {type: 'category'})
    return ai_sorted
  }
}
