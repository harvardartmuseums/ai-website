/*
 * Overview tab — fills the summary cards from the perspectives JSON.
 *
 * Every number on a card is a way into the evidence: selecting a shared term,
 * a dimension or a mood word opens All outputs filtered to the descriptions
 * behind it; a divergence item opens that description in the reader.
 *
 * Called once by the perspectives loader in object.hbs:
 *   window.renderResearchOverview(data)   // data is null if loading failed
 */
(function () {
  'use strict';

  var MAX_DIVERGENCE_ITEMS = 5;

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function slot(name) {
    return document.querySelector('[data-overview-slot="' + name + '"]');
  }

  function note(text) {
    return el('p', 'research-note', text);
  }

  // A button that switches to All outputs and then runs `action` there.
  function outputsButton(className, action) {
    var button = el('button', className);
    button.type = 'button';
    button.addEventListener('click', function () {
      location.hash = 'outputs';
      if (window.researchOutputs) action(window.researchOutputs);
    });
    return button;
  }

  // "Claude Opus 4.5" for an annotation id, read from the index row.
  function modelName(id) {
    var row = document.querySelector('.outputs-row[data-annotation-id="' + id + '"]');
    return row ? row.dataset.model : 'Annotation ' + id;
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  // One sentence about the most-mentioned noun, then a bar per shared term.
  function renderAgreement(target, overview) {
    var terms = overview.agreement || [], total = overview.descriptions_count;
    if (!terms.length) {
      target.replaceChildren(note('No noun appears in more than one description.'));
      return;
    }
    var top = terms[0];
    var sentence = top.descriptions_count === total
      ? 'Every description mentions “' + top.term + '”.'
      : '“' + top.term + '” appears in ' + top.descriptions_count + ' of ' + total + ' descriptions.';
    var bars = el('div', 'overview-bars');
    terms.forEach(function (term) {
      var bar = outputsButton('overview-bar', function (outputs) { outputs.filter(term.term, term.annotation_ids); });
      bar.appendChild(el('span', 'overview-bar-label', term.term));
      var track = el('span', 'overview-bar-track');
      var fill = el('span', 'overview-bar-fill');
      fill.style.width = Math.round(term.descriptions_count / total * 100) + '%';
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el('span', 'overview-bar-count', term.descriptions_count + '/' + total));
      bar.setAttribute('aria-label', term.term + ': ' + term.descriptions_count + ' of ' + total + ' descriptions. Show them.');
      bars.appendChild(bar);
    });
    target.replaceChildren(el('p', 'overview-lede', sentence), bars,
      note('Select a term to see the descriptions that use it.'));
  }

  // Claims that differ from the museum record, then the length range.
  function renderDivergence(target, overview) {
    var signals = overview.divergence || [];
    var items = el('ul', 'overview-list');
    var claims = signals.filter(function (s) { return s.kind !== 'length_range'; });

    claims.slice(0, MAX_DIVERGENCE_ITEMS).forEach(function (signal) {
      var item = el('li');
      var button = outputsButton('overview-item', function (outputs) { outputs.select(signal.annotation_id); });
      var name = el('strong', null, modelName(signal.annotation_id));
      button.appendChild(name);
      if (signal.kind === 'unrecorded_names') {
        button.appendChild(document.createTextNode(' names ' + signal.names.join(' and ') + ', who ' + (signal.names.length === 1 ? 'is' : 'are') + ' not in the museum record.'));
      } else if (signal.kind === 'unrecorded_medium') {
        button.appendChild(document.createTextNode(' mentions ' + signal.media.join(' and ')
          + (signal.record_medium ? '; the record says ' + signal.record_medium.toLowerCase() : '') + '.'));
      }
      item.appendChild(button);
      items.appendChild(item);
    });
    if (claims.length > MAX_DIVERGENCE_ITEMS) {
      items.appendChild(el('li', 'research-note', 'and ' + plural(claims.length - MAX_DIVERGENCE_ITEMS, 'more flag') + ' in All outputs.'));
    }

    var range = signals.find(function (s) { return s.kind === 'length_range'; });
    if (range) {
      var item = el('li');
      var button = outputsButton('overview-item', function (outputs) { outputs.sort('words-desc'); });
      button.appendChild(el('strong', null, 'Length.'));
      button.appendChild(document.createTextNode(' From ' + plural(range.shortest.words, 'word') + ' (' + modelName(range.shortest.annotation_id)
        + ') to ' + range.longest.words + ' (' + modelName(range.longest.annotation_id) + ').'));
      item.appendChild(button);
      items.appendChild(item);
    }

    var children = [];
    if (!claims.length) children.push(note('No description names a person or a paint medium that contradicts the museum record.'));
    if (items.children.length) children.push(items);
    target.replaceChildren.apply(target, children);
  }

  // A tile per radar dimension; darker tiles mean more descriptions.
  function renderAttention(target, overview) {
    var dimensions = overview.attention || [], total = overview.descriptions_count;
    if (!dimensions.length || !total) {
      target.replaceChildren(note('No descriptions to measure.'));
      return;
    }
    var tiles = el('div', 'overview-tiles');
    dimensions.forEach(function (d) {
      var tile = outputsButton('overview-tile', function (outputs) { outputs.filter(d.label, d.annotation_ids); });
      var share = d.descriptions_count / total;
      // Four steps of emphasis; the class carries colour and contrast.
      tile.classList.add('overview-tile--' + (share >= 0.75 ? 4 : share >= 0.5 ? 3 : share >= 0.25 ? 2 : 1));
      tile.disabled = d.descriptions_count === 0;
      tile.appendChild(el('span', 'overview-tile-label', d.label));
      tile.appendChild(el('strong', 'overview-tile-count', String(d.descriptions_count)));
      tile.setAttribute('aria-label', d.label + ': ' + d.descriptions_count + ' of ' + total + ' descriptions');
      tiles.appendChild(tile);
    });
    var vocabulary = el('a', 'overview-link', 'Compare models on the vocabulary radar →');
    vocabulary.href = '#vocabulary';
    target.replaceChildren(tiles, note('Descriptions that use words from each dimension.'), vocabulary);
  }

  function renderMood(target, overview) {
    var mood = overview.mood || [];
    if (!mood.length) {
      target.replaceChildren(note('The descriptions use no mood words more than once.'));
      return;
    }
    var words = el('div', 'overview-words');
    mood.forEach(function (m) {
      var word = outputsButton('overview-word', function (outputs) { outputs.filter('“' + m.phrase + '”', m.annotation_ids); });
      word.appendChild(document.createTextNode(m.phrase + ' '));
      word.appendChild(el('span', 'overview-word-count', String(m.descriptions_count)));
      word.setAttribute('aria-label', m.phrase + ': ' + plural(m.descriptions_count, 'description') + '. Show them.');
      words.appendChild(word);
    });
    var more = el('a', 'overview-link', 'Mood palette and thematic terms →');
    more.href = '#vocabulary';
    target.replaceChildren(words, more);
  }

  // Faces on the Detections card. Each service records one annotation per face
  // it finds, so a raw count multiplies faces by services. face_stats gives the
  // number of faces per service instead: "1 face, found by 3 services".
  function renderFaces(target, summary) {
    var stats = summary.face_stats;
    if (!summary.has_faces || !stats) {
      target.textContent = 'No faces detected';
      return;
    }
    var services = plural(stats.services_reporting, 'service');
    var lead = stats.min === stats.max
      ? plural(stats.min, 'face') + ', found by ' + services + (stats.services_reporting > 1 ? ' (all agree)' : '')
      : stats.min + '–' + stats.max + ' faces, depending on the service';
    var breakdown = stats.per_service.map(function (s) { return s.source + ' ' + s.count; }).join(' · ');
    target.replaceChildren(
      document.createTextNode(lead),
      el('span', 'overview-fact-detail', breakdown + '. Face detection is unreliable on paintings, prints and sculpture.')
    );
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  window.renderResearchOverview = function (data) {
    var overview = data && data.overview;
    // Faces don't depend on there being descriptions, only on the summary.
    var faces = document.querySelector('[data-overview-faces]');
    if (faces && data && data.summary) renderFaces(faces, data.summary);
    var renderers = { agreement: renderAgreement, divergence: renderDivergence, attention: renderAttention, mood: renderMood };
    Object.keys(renderers).forEach(function (name) {
      var target = slot(name);
      if (!target) return;
      if (!overview) {
        var reason = data && data.status === 'no_annotations' ? 'No AI annotations are available for this image.' : 'The analysis could not be loaded.';
        target.replaceChildren(note(reason));
        return;
      }
      if (!overview.descriptions_count) {
        target.replaceChildren(note('There are no AI descriptions of this image to summarise.'));
        return;
      }
      renderers[name](target, overview);
    });
  };

  // "Compare with an AI description" on the human-reference card.
  document.querySelectorAll('[data-compare-human]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (window.compareWithHumanReference) window.compareWithHumanReference(button.dataset.compareHuman);
    });
  });
})();
