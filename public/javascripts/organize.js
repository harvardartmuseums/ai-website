var _ = require('lodash');

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
	imaggafacesort: function (facedata) {
		_.map(facedata, function(face) {
			let faceinfo = {type: 'Traits', body: face.body}
			face.sorted_raw = _.concat(face.sorted_raw, faceinfo)
			face.sorted_raw.shift()
		})
	},
	divide: function (ai_data) {
		ai_data = _.map(ai_data, function(annotation){
			annotation.confidence = _.round((annotation.confidence * 100), 1)
			return annotation
		})
		// Declare new object to fill with sorted AI data
		let ai_sorted = {}
		ai_sorted.tagsect = {
			Amazon:{source: 'Amazon'},
			Clarifai:{source: 'Clarifai'},
			Imagga:{source: 'Imagga'},
			Google:{source: 'Google'},
			Microsoft:{source: 'Microsoft'}
		};
		ai_sorted.tagsect.Amazon.tags = _.filter(ai_data, {type: 'tag', feature: 'full', source: 'AWS Rekognition'})
		ai_sorted.tagsect.Clarifai.tags = _.filter(ai_data, {type: 'tag', feature: 'full', source: 'Clarifai'})
		ai_sorted.tagsect.Imagga.tags = _.filter(ai_data, {type: 'tag', feature: 'full', source: 'Imagga'})
		ai_sorted.tagsect.Google.tags = _.filter(ai_data, {type: 'tag', feature: 'full', source: 'Google Vision'})
		ai_sorted.tagsect.Microsoft.tags = _.filter(ai_data, {type: 'tag', feature: 'full', source: 'Microsoft Cognitive Services'})
		ai_sorted.tagsect = _.filter(ai_sorted.tagsect, function(service){
													if (service.tags.length > 0) {
														service.createdate = service.tags[0].createdate.substr(0,10);
														return service
													}
												})

		// Process faces
		if ( _.filter(ai_data, {type: 'face'}).length !== 0) {
			ai_sorted.facesect = {
				Amazon:{source:'Amazon'},
				Microsoft:{source:'Microsoft'},
				Google:{source:'Google'},
				Imagga:{source:'Imagga'}
			};
			amazonfaces = _.filter(ai_data, {type: 'face', source: 'AWS Rekognition'})
			ai_sorted.facesect.Amazon.faces = _.map(amazonfaces, module.exports.amazonfacesort(amazonfaces))

			microsoftfaces = _.filter(ai_data, {type: 'face', source: 'Microsoft Cognitive Services'})
			ai_sorted.facesect.Microsoft.faces = _.map(microsoftfaces, module.exports.microsoftfacesort(microsoftfaces))
			
			googlefaces = _.filter(ai_data, {type: 'face', source: 'Google Vision'})
			ai_sorted.facesect.Google.faces = _.map(googlefaces, module.exports.googlefacesort(googlefaces))
			
			imaggafaces = _.filter(ai_data, {type: 'face', source: 'Imagga'})
			ai_sorted.facesect.Imagga.faces = _.map(imaggafaces, module.exports.imaggafacesort(imaggafaces))
			
			ai_sorted.facesect = _.filter(ai_sorted.facesect, function(service){
				if(service.faces.length > 0) {
					service.createdate = service.faces[0].createdate.substr(0,10);
					return service
				}
			})
		}

		// Process features/object detection
		if (_.filter(ai_data, {type: 'tag', feature: 'region'}).length !== 0) {
			ai_sorted.featuresect = {
				Amazon: {source:'Amazon', features:{}},
				Clarifai: {source:'Clarifai', features:{}}
			}
			amazonfeatures = _.filter(ai_data, {type: 'tag', feature: 'region', source: 'AWS Rekognition'});
			amazonfeatures.forEach(e => {
				selector = e.selectors[0].value.replace('xywh=','');
				e.iiifFeatureImageURL = e.target.replace("/full/full", `/${selector}/full`);
			});
			ai_sorted.featuresect.Amazon.features = _.groupBy(amazonfeatures, 'body');
			
			clarifaifeatures = _.filter(ai_data, {type: 'tag', feature: 'region', source: 'Clarifai'});
			clarifaifeatures.forEach(e => {
				selector = e.selectors[0].value.replace('xywh=','');
				e.iiifFeatureImageURL = e.target.replace("/full/full", `/${selector}/full`);
			});
			ai_sorted.featuresect.Clarifai.features = _.groupBy(clarifaifeatures, 'body');		
		}

		// Process descriptions and captions
		if (_.filter(ai_data, {type: 'description'}).length !== 0) {
			// short captions
			ai_sorted.captions = {
				Microsoft: {
					source: 'Microsoft',
					captions: _.filter(ai_data, {type: 'description', source: 'Microsoft Cognitive Services'})
				}
			};
			ai_sorted.captions = _.filter(ai_sorted.captions, function(service){
				if(service.captions.length > 0) {
					service.createdate = service.captions[0].createdate.substr(0,10);
					return service;
				}
			}) 

			// long descriptions
			ai_sorted.descriptions = {
				Clarifai: {source: 'Clarifai', internalname: 'Clarifai', descriptions: []},
				Salesforce: {source: 'Salesforce', internalname: 'Salesforce', descriptions: []},
				OpenAI: {source: 'OpenAI GPT', internalname: 'Azure OpenAI Service', descriptions: []}, 
				Anthropic: {source: 'Anthropic Claude', internalname: 'Anthropic', descriptions: []},
				Meta: {source: 'Meta Llama', internalname: 'Meta', descriptions: []},
				Amazon: {source: 'Amazon Nova', internalname: 'Amazon', descriptions: []},
				Google: {source: 'Google Gemini', internalname: 'Google Gemini', descriptions: []},
				Mistral: {source: 'Mistral Pixtral', internalname: 'Mistral', descriptions: []},
				Qwen: {source: 'Qwen', internalname: 'Qwen', descriptions: []},
			};

			for (let service in ai_sorted.descriptions) {
				let descriptions = _.filter(ai_data, {type: 'description', source: ai_sorted.descriptions[service].internalname});
				ai_sorted.descriptions[service].descriptions = _.map(descriptions, function(item){
					item.createdate = item.createdate.substr(0,10);
					return item;
				});
			}
		}

		// Process categories
		ai_sorted.categories = {
			Imagga: {source:'Imagga', categories:[]},
			Microsoft: {source:'Microsoft', categories: []}
		};
		ai_sorted.categories.Imagga.categories = _.filter(ai_data, {type: 'category', source: 'Imagga'});
		ai_sorted.categories.Microsoft.categories = _.filter(ai_data, {type: 'category', source: 'Microsoft Cognitive Services'});
		ai_sorted.categories = _.filter(ai_sorted.categories, function(service){
													if (service.categories.length > 0) {
														service.createdate = service.categories[0].createdate.substr(0,10);
														return service
													}
												})		

		// Process text
		ai_sorted.textsect = {
			Amazon:{source:'Amazon'},
			Google:{source:'Google'}
		};
		ai_sorted.textsect.Google.text = _.uniqBy(_.filter(ai_data, {type: 'text', source: "Google Vision"}), 'body')
		ai_sorted.textsect.Amazon.text = _.uniqBy(_.filter(ai_data, {type: 'text', source: "AWS Rekognition"}), 'body')
		ai_sorted.textsect = _.filter(ai_sorted.textsect, function(service){
			if(service.text.length > 0) {
				service.createdate = service.text[0].createdate.substr(0,10);
				return service
			}
		})
		return ai_sorted
	}
}
