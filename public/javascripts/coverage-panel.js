/*
 * "What the models cover" — the Vocabulary tab's topic-coverage section.
 *
 * One section brings together what used to be the radar and "What the AIs
 * noticed":
 *
 *   controls   Providers | Individual models, then toggle buttons for
 *              providers or a grouped picker for models (up to MAX_SERIES)
 *   radar      distinct vocabulary per dimension for the selected series,
 *              optionally with the object wall label as a dashed reference
 *   grid       every provider × every dimension at once, shaded by coverage;
 *              a provider's column heading toggles it on the radar
 *   rows       one collapsible row per dimension: how many descriptions use
 *              it, the selected series' word counts, and the phrases the AIs
 *              used, each with the excerpts it came from
 *
 * Each row is a <details> with data-research-section="coverage-<dimension>",
 * so "#vocabulary/coverage-objects" (and the radar's axis labels) open it.
 *
 * Called once by the perspectives loader in object.hbs:
 *   window.renderCoverage(data)
 */
(function () {
  'use strict';

  var COLORS = ['#3869a3', '#b54c56', '#94723d', '#5b8171', '#8065a3', '#3c8292', '#a55d8a', '#607e37', '#687094', '#956951'];
  var MAX_SERIES = 6;
  var PHRASES_SHOWN = 8;     // phrases visible in a row before "Show all"
  var SNIPPETS_SHOWN = 5;    // excerpts visible under a phrase before "Show all"
  var INITIAL_SERIES = 3;
  var AXIS_LABELS = { people: 'People', objects: 'Objects', setting: 'Setting', colour_light: 'Color',
    action: 'Pose', animals: 'Animals', material_technique: 'Technique', condition: 'Condition', mood: 'Mood' };

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text != null) node.textContent = text;
    return node;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function monthYear(date) {
    var time = Date.parse(date);
    return Number.isFinite(time) ? new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date unknown';
  }

  // Switch to the Descriptions tab and run `action` with its API.
  function openDescriptions(action) {
    location.hash = 'descriptions';
    if (window.researchOutputs) action(window.researchOutputs);
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  window.renderCoverage = function (data) {
    var panel = document.getElementById('coverage-panel');
    var radar = data.coverage_radar;
    if (!panel || !radar || !radar.sources.length) return;
    panel.hidden = false;

    var dimensions = radar.dimensions;
    var total = (data.overview && data.overview.descriptions_count) || radar.outputs.length;
    var attention = {};
    ((data.overview && data.overview.attention) || []).forEach(function (a) { attention[a.key] = a; });

    // Both kinds of series, each with a stable id and colour.
    var providers = radar.sources.map(function (s, i) {
      return { id: 'provider:' + s.source, label: s.source, values: s.values, color: COLORS[i % COLORS.length], source: s };
    });
    // Older services record no model ("unknown"); name the provider instead,
    // as the Descriptions index does.
    var models = radar.outputs.map(function (o, i) {
      var named = o.display_model && o.display_model !== 'unknown';
      return { id: 'output:' + o.annotation_id, label: named ? o.display_model : o.source + ' (model not recorded)',
        values: o.values, color: COLORS[i % COLORS.length], output: o };
    });

    // Start with the providers (and, in model mode, each provider's newest
    // description) that have the most descriptions.
    var byCount = providers.slice().sort(function (a, b) { return b.source.output_count - a.source.output_count; });
    var state = {
      mode: 'providers',
      selected: {
        providers: byCount.slice(0, INITIAL_SERIES).map(function (p) { return p.id; }),
        models: newestPerProvider(byCount.slice(0, INITIAL_SERIES)),
      },
      showReference: false,
      pickerOpen: false,   // the model picker stays open while choosing
    };

    function newestPerProvider(providerList) {
      return providerList.map(function (p) {
        var own = models.filter(function (m) { return m.output.source === p.label; });
        own.sort(function (a, b) { return String(b.output.createdate).localeCompare(String(a.output.createdate)); });
        return own[0] && own[0].id;
      }).filter(Boolean);
    }

    function allSeries() { return state.mode === 'providers' ? providers : models; }
    // Providers keep one colour each. Models are coloured by selection order
    // instead: with 39 descriptions, fixed colours would repeat, and two
    // selected models could otherwise share one.
    function selectedSeries() {
      var ids = state.selected[state.mode];
      var chosen = allSeries().filter(function (s) { return ids.indexOf(s.id) !== -1; });
      if (state.mode === 'providers') return chosen;
      return chosen.map(function (s, i) { return Object.assign({}, s, { color: COLORS[i % COLORS.length] }); });
    }
    function toggle(id) {
      var ids = state.selected[state.mode], i = ids.indexOf(id);
      if (i !== -1) ids.splice(i, 1);
      else if (ids.length < MAX_SERIES) ids.push(id);
      update();
    }

    // Containers from the template.
    var controls = document.getElementById('coverage-controls');
    var chart = document.getElementById('coverage-chart');
    var grid = document.getElementById('coverage-grid');
    var rowsBox = document.getElementById('coverage-rows');

    // Rows sorted by how many descriptions use each dimension.
    var ordered = dimensions.slice().sort(function (a, b) {
      return ((attention[b.key] || {}).descriptions_count || 0) - ((attention[a.key] || {}).descriptions_count || 0);
    });

    var rowSeriesCells = {};   // dimension key → element showing selected series' counts
    var gridHeaders = {};      // provider id → column heading button

    renderGrid();
    renderRows();
    update();

    // Redraw everything that depends on the selection; rows keep their
    // open/closed state because only their series counts are replaced.
    function update() {
      renderControls();
      renderChart();
      Object.keys(rowSeriesCells).forEach(function (key) { fillSeriesCounts(rowSeriesCells[key], key); });
      Object.keys(gridHeaders).forEach(function (id) {
        var on = state.mode === 'providers' && state.selected.providers.indexOf(id) !== -1;
        gridHeaders[id].setAttribute('aria-pressed', String(on));
        gridHeaders[id].style.boxShadow = on ? 'inset 0 -3px 0 ' + providers.find(function (p) { return p.id === id; }).color : '';
      });
    }

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------

    function renderControls() {
      controls.replaceChildren();

      var top = el('div', 'coverage-controls-top');
      var modes = el('div', 'coverage-modes');
      modes.setAttribute('role', 'group');
      modes.setAttribute('aria-label', 'Compare by');
      [['providers', 'Providers'], ['models', 'Individual models']].forEach(function (pair) {
        var button = el('button', 'coverage-mode', pair[1]);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(state.mode === pair[0]));
        button.addEventListener('click', function () { state.mode = pair[0]; update(); });
        modes.appendChild(button);
      });
      top.appendChild(modes);

      var count = state.selected[state.mode].length;
      top.appendChild(el('span', 'coverage-status', state.mode === 'providers'
        ? 'Showing ' + count + ' of ' + providers.length + ' providers'
        : 'Showing ' + count + ' of ' + models.length + ' descriptions'));

      var actions = el('span', 'coverage-actions');
      var clear = el('button', 'overview-link', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', function () { state.selected[state.mode] = []; update(); });
      actions.appendChild(clear);
      if (radar.reference) {
        var label = el('label', 'coverage-reference');
        var box = el('input');
        box.type = 'checkbox';
        box.checked = state.showReference;
        box.addEventListener('change', function () { state.showReference = box.checked; renderChart(); });
        label.append(box, document.createTextNode(' Wall label'));
        actions.appendChild(label);
      }
      top.appendChild(actions);
      controls.appendChild(top);

      if (state.mode === 'providers') controls.appendChild(providerButtons());
      else controls.appendChild(modelPicker());

      controls.appendChild(el('p', 'research-note', state.mode === 'providers'
        ? 'Numbers are descriptions per provider. A provider’s shape pools the vocabulary of all its descriptions. Up to ' + MAX_SERIES + ' at a time.'
        : 'Each shape is one description. Up to ' + MAX_SERIES + ' at a time; dates are when each was generated.'));
    }

    // Providers: one toggle per provider, coloured when selected.
    function providerButtons() {
      var row = el('div', 'coverage-chips');
      providers.forEach(function (p) {
        var on = state.selected.providers.indexOf(p.id) !== -1;
        var button = seriesChip(p, on);
        button.appendChild(el('span', 'coverage-chip-count', String(p.source.output_count)));
        button.disabled = !on && state.selected.providers.length >= MAX_SERIES;
        if (button.disabled) button.title = 'Up to ' + MAX_SERIES + ' at a time. Remove one first.';
        button.addEventListener('click', function () { toggle(p.id); });
        row.appendChild(button);
      });
      return row;
    }

    function seriesChip(series, on) {
      var button = el('button', 'coverage-chip');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(on));
      if (on) button.style.borderColor = series.color;
      var dot = el('span', 'coverage-chip-dot');
      dot.style.background = on ? series.color : 'transparent';
      button.append(dot, document.createTextNode(series.label));
      return button;
    }

    // Models: the selected descriptions as removable chips, then a picker
    // grouped by provider with search and quick picks.
    function modelPicker() {
      var wrap = el('div', 'coverage-chips');
      selectedSeries().forEach(function (m) {
        var chip = seriesChip(m, true);
        chip.appendChild(el('span', 'coverage-chip-count', monthYear(m.output.createdate)));
        chip.setAttribute('aria-label', 'Remove ' + m.label + ', ' + m.output.source);
        chip.appendChild(el('span', 'coverage-chip-remove', '×'));
        chip.addEventListener('click', function () { toggle(m.id); });
        wrap.appendChild(chip);
      });

      var picker = el('details', 'coverage-picker');
      picker.appendChild(el('summary', 'coverage-picker-toggle', '+ Add a description'));
      var body = el('div', 'coverage-picker-body');

      var search = el('input', 'coverage-picker-search');
      search.type = 'search';
      search.placeholder = 'Find a model or provider';
      search.setAttribute('aria-label', 'Find a model or provider');
      body.appendChild(search);

      var quick = el('div', 'coverage-picker-quick');
      quick.appendChild(el('span', 'research-note', 'Quick picks:'));
      quickPick(quick, 'Newest per provider', function () {
        var top = byCount.slice(0, MAX_SERIES);
        return newestPerProvider(top);
      });
      quickPick(quick, 'Oldest and newest', function () {
        var dated = models.filter(function (m) { return Number.isFinite(Date.parse(m.output.createdate)); })
          .sort(function (a, b) { return Date.parse(a.output.createdate) - Date.parse(b.output.createdate); });
        return dated.length > 1 ? [dated[0].id, dated[dated.length - 1].id] : [];
      });
      body.appendChild(quick);

      var list = el('div', 'coverage-picker-list');
      providers.forEach(function (p) {
        var own = models.filter(function (m) { return m.output.source === p.label; });
        if (!own.length) return;
        var group = el('div', 'coverage-picker-group');
        group.appendChild(el('span', 'coverage-picker-heading', p.label + ' · ' + own.length));
        own.forEach(function (m) {
          var on = state.selected.models.indexOf(m.id) !== -1;
          var option = el('label', 'coverage-picker-option');
          var box = el('input');
          box.type = 'checkbox';
          box.checked = on;
          box.disabled = !on && state.selected.models.length >= MAX_SERIES;
          box.addEventListener('change', function () { toggle(m.id); });
          option.append(box, el('span', 'coverage-picker-name', m.label),
            el('span', 'coverage-picker-meta', monthYear(m.output.createdate) + ' · ' + m.output.word_count + ' w'));
          option.dataset.search = (m.label + ' ' + p.label).toLowerCase();
          group.appendChild(option);
        });
        list.appendChild(group);
      });
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        list.querySelectorAll('.coverage-picker-option').forEach(function (option) {
          option.hidden = q && option.dataset.search.indexOf(q) === -1;
        });
        list.querySelectorAll('.coverage-picker-group').forEach(function (group) {
          group.hidden = !group.querySelector('.coverage-picker-option:not([hidden])');
        });
      });
      body.appendChild(list);
      picker.appendChild(body);
      // Re-rendering replaces the picker; keep it open while choosing.
      picker.open = state.pickerOpen;
      picker.addEventListener('toggle', function () { state.pickerOpen = picker.open; });
      wrap.appendChild(picker);
      return wrap;
    }

    function quickPick(container, text, pick) {
      var button = el('button', 'coverage-quick', text);
      button.type = 'button';
      button.addEventListener('click', function () {
        state.selected.models = pick().slice(0, MAX_SERIES);
        state.pickerOpen = true;
        update();
      });
      container.appendChild(button);
    }

    // -----------------------------------------------------------------------
    // Radar
    // -----------------------------------------------------------------------

    // Fixed drawing scaled by CSS; the scale never changes when series are
    // added or removed (normalised to the largest provider). The drawing is
    // wider than tall so side labels ("Technique", "Setting") fit.
    function renderChart() {
      var width = 560, height = 420, cx = width / 2, cy = height / 2, radius = 150;
      var series = selectedSeries();
      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img',
        'aria-label': 'Vocabulary coverage across ' + dimensions.length + ' dimensions for ' + (series.length ? series.map(function (s) { return s.label; }).join(', ') : 'no selected series') + '. The table below lists the same values.' });
      function point(i, value) {
        var angle = i * Math.PI * 2 / dimensions.length - Math.PI / 2;
        return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value];
      }
      var gridLines = svg('g', { fill: 'none', stroke: 'var(--c-hovergray)' });
      [0.25, 0.5, 0.75, 1].forEach(function (v) {
        gridLines.appendChild(svg('polygon', { points: dimensions.map(function (_, i) { return point(i, v).join(','); }).join(' ') }));
      });
      dimensions.forEach(function (_, i) {
        var end = point(i, 1);
        gridLines.appendChild(svg('line', { x1: cx, y1: cy, x2: end[0], y2: end[1] }));
      });
      root.appendChild(gridLines);

      function shape(values, color, dashed) {
        var points = dimensions.map(function (d, i) {
          var v = values[d.key];
          return point(i, v.exceeds_scale ? 1 : Math.min(1, Math.max(v.normalized || 0, 0.015)));
        });
        root.appendChild(svg('polygon', { points: points.map(function (p) { return p.join(','); }).join(' '),
          fill: dashed ? 'none' : color, 'fill-opacity': 0.08, stroke: color, 'stroke-width': 2,
          'stroke-dasharray': dashed ? '5 4' : 'none' }));
        if (dashed) dimensions.forEach(function (d, i) {
          if (!values[d.key].exceeds_scale) return;
          var mark = svg('text', { x: points[i][0], y: points[i][1] - 6, 'text-anchor': 'middle', fill: color, 'font-weight': 'bold' }, '!');
          mark.appendChild(svg('title', {}, 'Wall label: ' + values[d.key].raw + ' words; AI maximum: ' + radar.max_per_dimension[d.key]));
          root.appendChild(mark);
        });
      }
      series.forEach(function (s) { shape(s.values, s.color, false); });
      if (state.showReference && radar.reference) shape(radar.reference.values, 'var(--c-grayblack)', true);

      // Axis labels link to the matching dimension row.
      dimensions.forEach(function (d, i) {
        var at = point(i, 1.16);
        var anchor = Math.abs(at[0] - cx) < 5 ? 'middle' : at[0] > cx ? 'start' : 'end';
        var link = svg('a', { href: '#vocabulary/coverage-' + d.key });
        link.appendChild(svg('text', { x: at[0], y: at[1], 'text-anchor': anchor, 'dominant-baseline': 'middle',
          'font-size': 13, fill: 'currentColor', class: 'coverage-axis-label' }, AXIS_LABELS[d.key] || d.label));
        root.appendChild(link);
      });
      chart.replaceChildren(root);
    }

    // -----------------------------------------------------------------------
    // Coverage grid: every provider × every dimension
    // -----------------------------------------------------------------------

    function renderGrid() {
      var table = el('table', 'coverage-grid');
      table.appendChild(el('caption', 'visually-hidden', 'Distinct words each provider used in each dimension, relative to the provider that used the most'));
      var head = el('tr');
      head.appendChild(el('th', 'coverage-grid-corner', 'Dimension'));
      providers.forEach(function (p) {
        var th = el('th');
        th.scope = 'col';
        var button = el('button', 'coverage-grid-provider', p.label);
        button.type = 'button';
        button.title = 'Show ' + p.label + ' on the radar';
        button.addEventListener('click', function () {
          state.mode = 'providers';
          var ids = state.selected.providers, i = ids.indexOf(p.id);
          if (i !== -1) ids.splice(i, 1);
          else { ids.push(p.id); if (ids.length > MAX_SERIES) ids.shift(); }
          update();
        });
        gridHeaders[p.id] = button;
        th.appendChild(button);
        head.appendChild(th);
      });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);

      var body = el('tbody');
      ordered.forEach(function (d) {
        var tr = el('tr');
        var th = el('th');
        th.scope = 'row';
        var link = el('a', null, d.label);
        link.href = '#vocabulary/coverage-' + d.key;
        th.appendChild(link);
        tr.appendChild(th);
        providers.forEach(function (p) {
          var value = p.values[d.key];
          var level = !value.raw ? 0 : value.normalized <= 0.34 ? 1 : value.normalized <= 0.67 ? 2 : 3;
          var td = el('td', 'coverage-cell coverage-cell--' + level);
          td.title = p.label + ' · ' + d.label + ': ' + plural(value.raw, 'distinct word');
          td.appendChild(el('span', 'visually-hidden', p.label + ': ' + value.raw));
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      grid.replaceChildren(table);
    }

    // -----------------------------------------------------------------------
    // Dimension rows: coverage and the phrases behind it
    // -----------------------------------------------------------------------

    function renderRows() {
      rowsBox.replaceChildren();
      ordered.forEach(function (d) {
        // Mood phrases come from the mood palette; the rest from observations.
        var entries = d.key === 'mood' ? (data.mood_palette || []) : (((data.observations || {})[d.key] || {}).entries || []);
        rowsBox.appendChild(dimensionRow(d, entries));
      });
      var other = ((data.observations || {}).other || {}).entries || [];
      if (other.length) rowsBox.appendChild(dimensionRow({ key: 'other', label: 'Other phrases' }, other));
    }

    function dimensionRow(d, entries) {
      var row = el('details', 'coverage-row');
      row.dataset.researchSection = 'coverage-' + d.key;
      var summary = el('summary', 'coverage-row-summary');
      summary.appendChild(el('span', 'coverage-row-name', d.label));
      summary.appendChild(el('span', 'coverage-row-phrases', plural(entries.length, 'phrase')));

      var used = attention[d.key];
      var bar = el('span', 'coverage-row-bar');
      if (used) {
        var track = el('span', 'coverage-row-track');
        var fill = el('span', 'coverage-row-fill');
        fill.style.width = Math.round(used.descriptions_count / total * 100) + '%';
        track.appendChild(fill);
        bar.append(track, el('span', 'coverage-row-share', used.descriptions_count + '/' + total));
        bar.title = used.descriptions_count + ' of ' + total + ' descriptions use words from this dimension';
      }
      summary.appendChild(bar);

      var counts = el('span', 'coverage-row-series');
      if (radar.max_per_dimension[d.key] != null) rowSeriesCells[d.key] = counts;
      summary.appendChild(counts);
      row.appendChild(summary);

      var body = el('div', 'coverage-row-body');
      if (!entries.length) body.appendChild(el('p', 'research-note', 'No phrases in this dimension.'));
      var list = el('ul', 'coverage-phrases');
      entries.forEach(function (entry, i) {
        var item = phraseItem(entry);
        if (i >= PHRASES_SHOWN) item.hidden = true;
        list.appendChild(item);
      });
      body.appendChild(list);

      var actions = el('p', 'coverage-row-actions');
      if (entries.length > PHRASES_SHOWN) {
        var more = el('button', 'overview-link', 'Show all ' + entries.length + ' phrases');
        more.type = 'button';
        more.addEventListener('click', function () {
          list.querySelectorAll('li[hidden]').forEach(function (li) { li.hidden = false; });
          more.remove();
        });
        actions.appendChild(more);
      }
      if (used && used.annotation_ids.length) {
        var open = el('button', 'overview-link', 'Open these ' + plural(used.descriptions_count, 'description') + ' →');
        open.type = 'button';
        open.addEventListener('click', function () { openDescriptions(function (outputs) { outputs.filter(d.label, used.annotation_ids); }); });
        actions.appendChild(open);
      }
      if (actions.children.length) body.appendChild(actions);
      row.appendChild(body);
      return row;
    }

    // The selected series' distinct-word counts for one dimension.
    function fillSeriesCounts(target, key) {
      target.replaceChildren();
      var series = selectedSeries();
      series.forEach(function (s) {
        var value = el('span', 'coverage-series-value');
        value.style.color = s.color;
        value.textContent = '● ' + s.values[key].raw;
        value.title = s.label + ': ' + plural(s.values[key].raw, 'distinct word');
        target.appendChild(value);
      });
      if (series.length) target.appendChild(el('span', 'coverage-series-max', 'of ' + radar.max_per_dimension[key]));
    }

    // One phrase: who used it and how often; opens to its excerpts.
    function phraseItem(entry) {
      var li = el('li');
      var details = el('details', 'coverage-phrase');
      var summary = el('summary');
      summary.appendChild(el('span', 'coverage-phrase-text', entry.phrase));
      var meta = el('span', 'coverage-phrase-meta');
      var providerCount = entry.sources_count || (entry.sources || []).length;
      meta.appendChild(el('span', 'coverage-badge', plural(providerCount, 'provider')));
      if (entry.spatially_detected) meta.appendChild(el('span', 'coverage-badge', '▣ ' + plural(entry.spatially_detected.total_instances, 'region')));
      meta.appendChild(el('span', null, plural(entry.description_annotations_count || entry.annotations_count, 'description')));
      summary.appendChild(meta);
      details.appendChild(summary);

      var snippets = entry.snippets || [];
      var list = el('ul', 'coverage-snippets');
      snippets.forEach(function (s, i) {
        var item = el('li');
        if (i >= SNIPPETS_SHOWN) item.hidden = true;
        var who = s.display_model && s.display_model !== s.source ? s.source + ' — ' + s.display_model : s.source;
        item.appendChild(el('span', 'coverage-snippet-source', who));
        item.appendChild(el('span', 'coverage-snippet-text', '“' + (s.text || s.snippet) + '”'));
        if (s.type === 'description' || !s.type) {
          var read = el('button', 'overview-link', 'Read in Descriptions');
          read.type = 'button';
          read.addEventListener('click', function () { openDescriptions(function (outputs) { outputs.select(s.annotation_id); }); });
          item.appendChild(read);
        } else if (s.url) {
          var link = el('a', 'overview-link', 'View the source record');
          link.href = s.url;
          item.appendChild(link);
        }
        list.appendChild(item);
      });
      details.appendChild(list);
      // Phrases beyond the top 25 per dimension arrive without excerpts (to
      // keep the JSON small); open the descriptions that use them instead.
      if (!snippets.length && entry.annotation_ids && entry.annotation_ids.length) {
        var count = entry.description_annotations_count || entry.annotations_count;
        var open = el('button', 'overview-link', count === 1
          ? 'Open the description that uses it →'
          : 'Open the ' + count + ' descriptions that use it →');
        open.type = 'button';
        open.addEventListener('click', function () {
          openDescriptions(function (outputs) { outputs.filter('“' + entry.phrase + '”', entry.annotation_ids); });
        });
        details.appendChild(open);
      }
      if (snippets.length > SNIPPETS_SHOWN) {
        var more = el('button', 'overview-link', 'Show all ' + snippets.length + ' excerpts');
        more.type = 'button';
        more.addEventListener('click', function () {
          list.querySelectorAll('li[hidden]').forEach(function (item) { item.hidden = false; });
          more.remove();
        });
        details.appendChild(more);
      }
      li.appendChild(details);
      return li;
    }
  };
})();
