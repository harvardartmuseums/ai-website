require('dotenv').config({path: '.env'})

const querystring = require('querystring');
const fs = require("fs");
const path = require('path');
const _ = require('lodash');
const nlp = require('compromise');

const API_KEY = process.env['API_KEY']

main();

async function main() {
    await fetchTags();
    await fetchDescriptions();
};

async function fetchTags() {
    let aggs = {
        "by_term": {
            "terms": {
                "field": "body.exact",
                "size": 35000
            },
            "aggs": {
                "by_source": {
                    "terms": {
                        "field": "source"
                    }
                }
            }
        }
    };
    
    let qs = {
      'q': `type:tag`,
      'size': 0,
      'apikey': API_KEY, 
      'aggregation': JSON.stringify(aggs)
    };
    const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
    
    let results = await fetch(url);
    let output = await results.json();
    
    let terms = _.map(output.aggregations.by_term.buckets, (item) => {
        item.original_key = item.key;
        item.key = _.lowerCase(item.key);
        return item;
    })
    terms = _.sortBy(terms, 'key');
    let u = _.groupBy(terms, 'key');
    let list = [];

    _.forEach(u, (v,k,c) => {
        let i = {
            term: k,
            count: _.sumBy(v, "doc_count"),
            original: v
        };
        list.push(i);
    })

    console.log(`${list.length} terms`);
    console.log('Writing terms file');
    fs.writeFileSync("./public/vocabularies/terms.js", 'module.exports = ' + JSON.stringify(list), {flag:'w+'});
}

async function fetchDescriptions() {
    let aggs = {
        "by_term": {
            "terms": {
                "field": "body.exact",
                "size": 65000
            }
        }
    };
    
    let qs = {
      'q': `type:description`,
      'size': 0,
      'apikey': API_KEY, 
      'aggregation': JSON.stringify(aggs)
    };
    const url = `https://api.harvardartmuseums.org/annotation/?${querystring.encode(qs)}`;
    
    let results = await fetch(url);
    let output = await results.json();
    
    let terms = _.map(output.aggregations.by_term.buckets, (item) => {
        item.original_key = item.key;
        item.key = _.lowerCase(item.key);
        return item;
    })
    terms = _.sortBy(terms, 'key');
    let u = _.groupBy(terms, 'key');
    let list = [];
    // let topics = [];
    let people = [];
    let places = [];
    let organizations = [];

    _.forEach(u, (v,k,c) => {
        let i = {
            term: k,
            count: _.sumBy(v, "doc_count"),
            original: v
        };
        list.push(i);
        
        // do some NLP on the text
        let description = v[0].original_key;
        let doc = nlp(description);
        let topics = doc.topics();

        if (topics.people().length > 0) {
            let p = topics.people().out('array');
            people = people.concat(p.map(item => ({term: item.replace(/,+$/, ""), description: description})));
        }
        if (topics.places().length > 0) {
            let pl = topics.places().out('array');
            places = places.concat(pl.map(item => ({term: item.replace(/,+$/, ""), description: description})));
        }
        if (topics.organizations().length > 0) {
            let org = topics.organizations().out('array');
            organizations = organizations.concat(org.map(item => ({term: item.replace(/,+$/, ""), description: description})));
        }
    })

    console.log(`${list.length} descriptions`);
    console.log('Writing descriptions file');
    fs.writeFileSync("./public/vocabularies/descriptions.js", 'module.exports = ' + JSON.stringify(list), {flag:'w+'});

    // Finish preparing the list of people names
    people = _.sortBy(people, "term");
    people = _.groupBy(people, "term");
    list = [];
    _.forEach(people, (v,k,c) => {
        let i = {
            term: k,
            count: v.length,
            original: v
        };
        list.push(i);
    });

    console.log(`${list.length} people`);
    console.log('Writing people file');
    fs.writeFileSync("./public/vocabularies/people.js", 'module.exports = ' + JSON.stringify(list), {flag:'w+'});
    
    
    places = _.sortBy(places, "term");
    places = _.groupBy(places, "term");
    list = [];
    _.forEach(places, (v,k,c) => {
        let i = {
            term: k,
            count: v.length,
            original: v
        };
        list.push(i);
    });

    console.log(`${list.length} places`);
    console.log('Writing places file');
    fs.writeFileSync("./public/vocabularies/places.js", 'module.exports = ' + JSON.stringify(list), {flag:'w+'});
    

    organizations = _.sortBy(organizations, "term");
    organizations = _.groupBy(organizations, "term");
    list = [];
    _.forEach(organizations, (v,k,c) => {
        let i = {
            term: k,
            count: v.length,
            original: v
        };
        list.push(i);
    });

    console.log(`${list.length} organizations`);
    console.log('Writing organizations file');
    fs.writeFileSync("./public/vocabularies/organizations.js", 'module.exports = ' + JSON.stringify(list), {flag:'w+'});
}