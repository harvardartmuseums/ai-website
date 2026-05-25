/* Pairwise text analysis functions — interactive/client-side only.
   Depends on: window.stopwords (from stopwords.js), Diff (from diff CDN) */

function tfidfCosine(textA, textB) {
  function tokenise(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  }
  function tf(tokens) {
    var freq = {};
    tokens.forEach(function(t) { freq[t] = (freq[t] || 0) + 1; });
    var len = tokens.length || 1;
    Object.keys(freq).forEach(function(t) { freq[t] /= len; });
    return freq;
  }
  function idf(tfA, tfB) {
    var scores = {};
    var vocab = Object.keys(tfA).concat(Object.keys(tfB));
    vocab.forEach(function(t) {
      if (!(t in scores)) {
        var df = (tfA[t] ? 1 : 0) + (tfB[t] ? 1 : 0);
        scores[t] = Math.log(3 / (df + 1)) + 1;
      }
    });
    return scores;
  }
  function tfidfVec(tfMap, idfMap) {
    var vec = {};
    Object.keys(tfMap).forEach(function(t) { vec[t] = tfMap[t] * idfMap[t]; });
    return vec;
  }
  function cosine(vecA, vecB) {
    var dot = 0, magA = 0, magB = 0;
    var seen = {};
    Object.keys(vecA).concat(Object.keys(vecB)).forEach(function(t) {
      if (seen[t]) return;
      seen[t] = true;
      var a = vecA[t] || 0, b = vecB[t] || 0;
      dot += a * b; magA += a * a; magB += b * b;
    });
    return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  }
  var tokA = tokenise(textA), tokB = tokenise(textB);
  var tfA = tf(tokA), tfB = tf(tokB);
  var idfScores = idf(tfA, tfB);
  return Math.round(cosine(tfidfVec(tfA, idfScores), tfidfVec(tfB, idfScores)) * 100);
}

function wordOverlap(textA, textB) {
  var diffResult = Diff.diffWords(textA, textB);
  var shared = 0, uniqueA = 0, uniqueB = 0;
  diffResult.forEach(function(part) {
    var count = part.value.trim() === '' ? 0 : part.value.trim().split(/\s+/).length;
    if (part.removed) uniqueA += count;
    else if (part.added) uniqueB += count;
    else shared += count;
  });
  var total = shared + uniqueA + uniqueB;
  return { pct: total === 0 ? 0 : Math.round((shared / total) * 100), shared: shared, uniqueA: uniqueA, uniqueB: uniqueB };
}

function sentenceOverlap(textA, textB) {
  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+|(?<=[.!?])$/).map(function(s) { return s.trim(); }).filter(Boolean);
  }
  function sentenceWords(s) {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  }
  function overlapScore(wordsA, wordsB) {
    var setA = {}, setB = {};
    wordsA.forEach(function(w) { setA[w] = true; });
    wordsB.forEach(function(w) { setB[w] = true; });
    var shared = Object.keys(setA).filter(function(w) { return setB[w]; }).length;
    var denom = Math.max(Object.keys(setA).length, Object.keys(setB).length);
    return denom === 0 ? 0 : shared / denom;
  }
  var sentA = splitSentences(textA);
  var sentB = splitSentences(textB);
  if (!sentA.length || !sentB.length) return { pct: 0, matchedA: 0, totalA: sentA.length, matchedB: 0, totalB: sentB.length };
  var wordsA = sentA.map(sentenceWords);
  var wordsB = sentB.map(sentenceWords);
  var threshold = 0.4;
  var matchedA = wordsA.filter(function(wa) {
    return wordsB.some(function(wb) { return overlapScore(wa, wb) >= threshold; });
  }).length;
  var matchedB = wordsB.filter(function(wb) {
    return wordsA.some(function(wa) { return overlapScore(wa, wb) >= threshold; });
  }).length;
  var pct = Math.round(((matchedA / sentA.length) + (matchedB / sentB.length)) / 2 * 100);
  return { pct: pct, matchedA: matchedA, totalA: sentA.length, matchedB: matchedB, totalB: sentB.length };
}

function keyPhrases(textA, textB) {
  var sw = window.stopwords || {};
  function tokenise(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function(t) { return t.length > 2 && !sw[t]; });
  }
  function tf(tokens) {
    var freq = {};
    tokens.forEach(function(t) { freq[t] = (freq[t] || 0) + 1; });
    var len = tokens.length || 1;
    Object.keys(freq).forEach(function(t) { freq[t] /= len; });
    return freq;
  }
  function topTerms(tfMap, idfMap, n) {
    return Object.keys(tfMap).map(function(t) {
      return { term: t, score: tfMap[t] * (idfMap[t] || 1) };
    }).sort(function(a, b) { return b.score - a.score; }).slice(0, n).map(function(x) { return x.term; });
  }
  var tokA = tokenise(textA), tokB = tokenise(textB);
  var tfA = tf(tokA), tfB = tf(tokB);
  var idfMap = {};
  Object.keys(tfA).concat(Object.keys(tfB)).forEach(function(t) {
    if (!(t in idfMap)) {
      var df = (tfA[t] ? 1 : 0) + (tfB[t] ? 1 : 0);
      idfMap[t] = Math.log(3 / (df + 1)) + 1;
    }
  });
  var topA = topTerms(tfA, idfMap, 8);
  var topB = topTerms(tfB, idfMap, 8);
  var setB = {}, setA = {};
  topB.forEach(function(t) { setB[t] = true; });
  topA.forEach(function(t) { setA[t] = true; });
  return {
    shared: topA.filter(function(t) { return setB[t]; }),
    onlyA:  topA.filter(function(t) { return !setB[t]; }),
    onlyB:  topB.filter(function(t) { return !setA[t]; })
  };
}
