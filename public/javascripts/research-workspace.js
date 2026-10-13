(function () {
  'use strict';
  var root = document.querySelector('.image-research-workspace');
  if (!root) return;
  var panels = Array.from(root.querySelectorAll('[data-research-panel]'));
  function showView(name) {
    if (!panels.some(function (p) { return p.dataset.researchPanel === name; })) name = 'perspectives';
    panels.forEach(function (p) { p.hidden = p.dataset.researchPanel !== name; });
    root.querySelectorAll('[data-research-tab]').forEach(function (link) {
      if (link.dataset.researchTab === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    root.dispatchEvent(new CustomEvent('researchview', { detail: name }));
  }
  function syncHash() { showView(location.hash.slice(1)); }
  window.addEventListener('hashchange', syncHash);
  syncHash();
  var picker = document.getElementById('research-image-select');
  if (picker) picker.addEventListener('change', function () { location.assign(picker.value + location.hash); });

  function descForAnnotation(id) {
    return Array.from(document.querySelectorAll('.desc-data')).find(function (d) { return d.dataset.annotationId === String(id); });
  }
  window.compareResearchAnnotations = function (ids) {
    var choices = ids.map(descForAnnotation).filter(Boolean);
    if (!choices.length) return;
    if (window.researchCompare) window.researchCompare(choices[0].dataset.key, choices[1] && choices[1].dataset.key);
    location.hash = 'compare';
    showView('compare');
  };
  root.querySelectorAll('.research-compare-output').forEach(function (button) {
    button.addEventListener('click', function () { window.compareResearchAnnotations([button.dataset.annotationId]); });
  });
  function updateResults() {
    var cards = Array.from(root.querySelectorAll('.desc-card'));
    var count = cards.filter(function (c) { return c.style.display !== 'none'; }).length;
    var status = document.getElementById('desc-results-count');
    if (status) status.textContent = count + ' of ' + cards.length + ' descriptions shown';
    var empty = document.getElementById('desc-filter-empty');
    if (empty) empty.hidden = count !== 0;
    if (window.applyHighlight) window.applyHighlight();
  }
  ['desc-source-select', 'desc-model-select', 'desc-length-select'].forEach(function (id) {
    var select = document.getElementById(id);
    // The template registers its filtering handlers at DOMContentLoaded.
    // Count the results after those handlers have applied visibility.
    if (select) select.addEventListener('change', function () { queueMicrotask(updateResults); });
  });
  var reset = document.getElementById('desc-reset');
  if (reset) reset.addEventListener('click', function () {
    document.getElementById('desc-source-select').value = 'all';
    document.getElementById('desc-model-select').value = 'all';
    document.getElementById('desc-length-select').value = 'any';
    document.getElementById('desc-highlight-input').value = '';
    document.getElementById('desc-sort-select').value = 'source-asc';
    window.applyDescFilter(); window.applySort(); updateResults();
  });
  document.addEventListener('DOMContentLoaded', updateResults);
  document.addEventListener('DOMContentLoaded', function () {
    var record = document.getElementById('research-source-record');
    // Evidence URLs can target a view hash. Bring the complete source into view
    // after the browser's initial anchor navigation, rather than burying it
    // above the description cards or other-analysis sections.
    if (record) requestAnimationFrame(function () { record.scrollIntoView({ block: 'start' }); });
  });

  var radarObserver;
  window.renderResearchRadar = function (data) {
    var radar = data.coverage_radar;
    if (!radar || (!radar.sources.length && !radar.reference)) return;
    document.getElementById('perspectives-radar').style.display = '';
    var container = document.getElementById('perspectives-radar-chart');
    var legend = document.getElementById('perspectives-radar-legend');
    var dimensionSelect = document.getElementById('radar-dimension');
    var evidenceBox = document.getElementById('radar-evidence');
    var viewSelect = document.getElementById('radar-view');
    var search = document.getElementById('radar-search');
    var addSeries = document.getElementById('radar-add');
    var mode = 'outputs';
    var outputs = radar.outputs || [];
    function key(series) { return mode === 'outputs' ? 'output:' + series.annotation_id : 'provider:' + series.source; }
    var selected = {
      outputs: new Set(outputs.slice(0, 3).map(function(s) { return 'output:' + s.annotation_id; })),
      providers: new Set(radar.sources.slice(0, 3).map(function(s) { return 'provider:' + s.source; }))
    };
    var showReference = false;
    function series() { return mode === 'outputs' ? outputs : radar.sources; }
    function outputLabel(s) {
      return s.source + ' — ' + (s.model ? s.display_model + (s.display_model !== s.model ? ' (' + s.model + ')' : '') : 'Unspecified model')
        + ' · ' + (s.createdate ? String(s.createdate).split('T')[0] : 'Date unavailable') + ' · Annotation ' + s.annotation_id + ' · ' + s.word_count + ' words';
    }
    function seriesLabel(s) {
      return mode === 'outputs' ? outputLabel(s) : s.source + ' · ' + s.output_count
        + (s.output_count === 1 ? ' output · ' : ' outputs · ') + s.model_count
        + (s.model_count === 1 ? ' identified model · ' : ' identified models · ') + s.word_count + ' words total';
    }
    var colors = ['#3869a3', '#b54c56', '#94723d', '#5b8171', '#8065a3', '#3c8292', '#a55d8a', '#607e37', '#687094', '#956951'];
    var dimension = 0;
    var ns = 'http://www.w3.org/2000/svg';
    function node(tag, attrs, text) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (key) { n.setAttribute(key, attrs[key]); });
      if (text) n.textContent = text;
      return n;
    }
    function element(tag, text) { var n = document.createElement(tag); if (text) n.textContent = text; return n; }
    function draw() {
      var width = container.clientWidth;
      if (!width) return;
      var height = Math.min(430, Math.max(260, width * 0.85));
      var cx = width / 2, cy = height / 2;
      var radius = Math.max(35, Math.min(width / 2 - 82, height / 2 - 36));
      var svg = node('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Vocabulary breadth by ' + (mode === 'outputs' ? 'individual model output' : 'provider') + '. Reference overflow is marked at the axis edge. Inspect raw values and evidence below.' });
      svg.appendChild(node('title', {}, mode === 'outputs' ? 'What models describe' : 'What providers describe'));
      function point(i, value) { var angle = i * Math.PI * 2 / radar.dimensions.length - Math.PI / 2; return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value]; }
      [0.25, 0.5, 0.75, 1].forEach(function (v) {
        svg.appendChild(node('polygon', { points: radar.dimensions.map(function (_, i) { return point(i, v).join(','); }).join(' '), fill: 'none', stroke: 'var(--c-lightgray)', 'stroke-width': 1 }));
      });
      var shortLabels = ['People', 'Objects', 'Setting', 'Color & light', 'Action', 'Animals', 'Technique', 'Mood'];
      radar.dimensions.forEach(function (d, i) {
        var p = point(i, 1), label = point(i, 1.13);
        svg.appendChild(node('line', { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: 'var(--c-lightgray)', 'stroke-width': 1 }));
        svg.appendChild(node('text', { x: label[0], y: label[1], fill: 'currentColor', 'font-size': 12, 'text-anchor': Math.abs(label[0] - cx) < 5 ? 'middle' : label[0] > cx ? 'start' : 'end', 'dominant-baseline': 'middle', 'font-weight': i === dimension ? 'bold' : 'normal' }, shortLabels[i] || d.label));
      });
      function drawSeries(s, color, reference) {
        var points = radar.dimensions.map(function (d, i) {
          var value = s.values[d.key];
          // Reference overflow and zero-AI axes are visible at the boundary.
          return point(i, value.exceeds_scale ? 1 : Math.min(1, value.normalized || 0));
        });
        svg.appendChild(node('polygon', { points: points.map(function (p) { return p.join(','); }).join(' '), fill: reference ? 'none' : color, 'fill-opacity': 0.08, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': reference ? '5 4' : 'none' }));
        svg.appendChild(node('circle', { cx: points[dimension][0], cy: points[dimension][1], r: 3, fill: color }));
        if (reference) radar.dimensions.forEach(function(d, i) {
          if (!s.values[d.key].exceeds_scale) return;
          var marker = node('text', {x: points[i][0], y: points[i][1] - 6, 'text-anchor': 'middle', fill: color, 'font-weight': 'bold'}, '!');
          marker.appendChild(node('title', {}, 'Object reference: ' + s.values[d.key].raw + ' terms; AI maximum: ' + radar.max_per_dimension[d.key]));
          svg.appendChild(marker);
        });
      }
      series().forEach(function (s, idx) {
        if (selected[mode].has(key(s))) drawSeries(s, colors[idx % colors.length], false);
      });
      if (showReference && radar.reference) drawSeries(radar.reference, 'var(--c-grayblack)', true);
      container.replaceChildren(svg);
    }
    function evidence() {
      evidenceBox.replaceChildren();
      var d = radar.dimensions[dimension];
      evidenceBox.appendChild(element('h4', d.label));
      evidenceBox.appendChild(element('p', 'AI axis maximum: ' + radar.max_per_dimension[d.key] + ' distinct terms across the complete provider unions.'));
      var candidates = new Map();
      function evidenceRow(s, reference) {
        var value = s.values[d.key];
        var row = element('details'); row.className = 'radar-evidence-row';
        row.appendChild(element('summary', (reference ? 'Object wall label' : seriesLabel(s)) + ' — ' + value.raw + ' distinct terms'));
        row.appendChild(element('p', value.terms.length ? value.terms.join(', ') : 'No vocabulary terms matched this dimension.'));
        if (reference) {
          if (value.exceeds_scale) row.appendChild(element('p', '! Reference exceeds the AI maximum; shown at the chart edge.'));
          if (!radar.max_per_dimension[d.key]) row.appendChild(element('p', 'No matched AI vocabulary on this axis; a relative ratio is undefined.'));
          row.appendChild(element('blockquote', radar.reference.body));
          row.appendChild(element('p', 'Human-authored reference about the associated object.'));
        } else value.annotation_ids.forEach(function (id) {
          var desc = descForAnnotation(id);
          var output = outputs.find(function(o) { return String(o.annotation_id) === String(id); });
          if (!desc || !output) return;
          var excerpt = element('details');
          excerpt.appendChild(element('summary', outputLabel(output)));
          excerpt.appendChild(element('blockquote', desc.textContent.trim()));
          if (output.url) { var link = element('a', 'Read complete annotation'); link.href = output.url; excerpt.appendChild(link); }
          var button = element('button', 'Compare this output'); button.type = 'button'; button.className = 'quickbar-btn';
          button.addEventListener('click', function () { window.compareResearchAnnotations([id]); });
          excerpt.appendChild(button); row.appendChild(excerpt);
          candidates.set(String(id), output);
        });
        evidenceBox.appendChild(row);
      }
      series().forEach(function(s) { if (selected[mode].has(key(s))) evidenceRow(s, false); });
      if (showReference && radar.reference) evidenceRow(radar.reference, true);
      if (!selected[mode].size) evidenceBox.appendChild(element('p', 'Select a model output or provider to inspect vocabulary coverage.'));
      if (candidates.size > 1) {
        var choice = element('fieldset'); choice.className = 'radar-comparison-choices';
        choice.appendChild(element('legend', 'Choose two supporting outputs to compare'));
        var comparison = new Set(Array.from(candidates.keys()).slice(0, 2));
        var compare = element('button', 'Compare selected outputs'); compare.type = 'button'; compare.className = 'quickbar-btn';
        candidates.forEach(function(output, id) {
          var label = element('label'), input = element('input'); input.type = 'checkbox'; input.checked = comparison.has(id);
          label.appendChild(input); label.appendChild(element('span', outputLabel(output))); choice.appendChild(label);
          input.addEventListener('change', function() {
            if (input.checked) comparison.add(id); else comparison.delete(id);
            compare.disabled = comparison.size !== 2;
          });
        });
        compare.addEventListener('click', function() { window.compareResearchAnnotations(Array.from(comparison)); });
        choice.appendChild(compare); evidenceBox.appendChild(choice);
      }
    }
    function renderLegend() {
      legend.replaceChildren();
      var query = search.value.trim().toLowerCase();
      var matches = 0;
      addSeries.replaceChildren();
      var prompt = element('option', 'Select an output or provider…'); prompt.value = ''; addSeries.appendChild(prompt);
      series().forEach(function(s, idx) {
        var id = key(s), text = seriesLabel(s);
        if (!selected[mode].has(id)) {
          if (!query || (text + ' ' + (s.model || '') + ' ' + (s.createdate || '')).toLowerCase().includes(query)) {
            var option = element('option', text); option.value = id; addSeries.appendChild(option); matches++;
          }
          return;
        }
        var label = element('label'); label.className = 'radar-source-control';
        var input = element('input'); input.type = 'checkbox'; input.checked = selected[mode].has(id);
        var swatch = element('span'); swatch.className = 'radar-legend-swatch'; swatch.style.background = colors[idx % colors.length];
        label.appendChild(input); label.appendChild(swatch); label.appendChild(element('span', text));
        input.addEventListener('change', function() {
          if (input.checked) selected[mode].add(id); else selected[mode].delete(id);
          draw(); evidence(); renderLegend();
        });
        legend.appendChild(label);
      });
      if (!matches) prompt.textContent = query ? 'No matching unselected series' : 'All available series are selected';
      addSeries.disabled = !matches;
      if (radar.reference) {
        var label = element('label'); label.className = 'radar-source-control';
        var input = element('input'); input.type = 'checkbox'; input.checked = showReference;
        label.appendChild(input); label.appendChild(element('span', 'Object wall label · dashed reference'));
        input.addEventListener('change', function() { showReference = input.checked; draw(); evidence(); });
        legend.appendChild(label);
      }
    }
    dimensionSelect.replaceChildren();
    radar.dimensions.forEach(function (d, i) { var option = element('option', d.label); option.value = i; dimensionSelect.appendChild(option); });
    dimensionSelect.onchange = function () { dimension = Number(dimensionSelect.value); draw(); evidence(); };
    function viewNote() {
      document.getElementById('radar-heading').textContent = mode === 'outputs' ? 'What models describe' : 'What providers describe';
      document.getElementById('radar-view-note').textContent = mode === 'outputs'
        ? 'Each series is one model output. Repeated runs remain separate; select outputs by model, date, and annotation ID. Selected series stay visible while searching.'
        : 'Each series pools a provider’s vocabulary across its outputs. More or longer outputs offer more opportunities to match terms.';
    }
    viewSelect.value = mode;
    viewSelect.onchange = function() { mode = viewSelect.value; viewNote(); renderLegend(); draw(); evidence(); };
    search.oninput = renderLegend;
    addSeries.onchange = function() {
      if (!addSeries.value) return;
      selected[mode].add(addSeries.value); renderLegend(); draw(); evidence();
    };
    viewNote(); renderLegend();
    if (radarObserver) radarObserver.disconnect();
    radarObserver = new ResizeObserver(draw); radarObserver.observe(container);
    root.addEventListener('researchview', draw);
    draw(); evidence();
  };
})();
