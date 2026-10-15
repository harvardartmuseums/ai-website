/*
 * Descriptions — index + reader for the image research page.
 *
 * The server renders every description twice: as a compact row in the index
 * (#outputs-list) and as a full article in the reader (#outputs-reader). This
 * script only rearranges and reveals what is already in the page:
 *
 *   - filter rows by a shared term (ids supplied by the overview data) or by
 *     free text, and sort them; provider sort also groups rows under headers
 *   - selecting a row shows its article in the reader
 *   - ticking two rows shows both side by side, with a link to Compare
 *
 * Other scripts talk to it through window.researchOutputs (see the bottom).
 */
(function () {
  'use strict';

  var panel = document.getElementById('research-outputs');
  var list = document.getElementById('outputs-list');
  if (!panel || !list) return;

  var rows = Array.from(list.querySelectorAll('.outputs-row'));
  var entries = new Map(Array.from(panel.querySelectorAll('.outputs-entry')).map(function (entry) {
    return [entry.dataset.annotationId, entry];
  }));
  var controls = {
    terms: document.getElementById('outputs-terms'),
    find: document.getElementById('outputs-find'),
    sort: document.getElementById('outputs-sort'),
    count: document.getElementById('outputs-count'),
    empty: document.getElementById('outputs-empty'),
    clear: document.getElementById('outputs-clear'),
    pair: document.getElementById('outputs-pair'),
    pairColumns: document.getElementById('outputs-pair-columns'),
    pairOpen: document.getElementById('outputs-pair-open'),
    pairClear: document.getElementById('outputs-pair-clear'),
  };

  // The whole UI is a function of this state; render() redraws from it.
  var state = {
    filter: null,        // { label, ids: Set of annotation ids } or null
    query: '',           // free text from the Find box
    sort: 'provider',
    selected: panel.dataset.initialSelection || (rows[0] && rows[0].dataset.annotationId),
    pair: [],            // up to two annotation ids, oldest first
  };

  // Shared terms from the overview data, shown as filter buttons once loaded.
  var termFilters = [];

  // -------------------------------------------------------------------------
  // Filtering and sorting
  // -------------------------------------------------------------------------

  // Full searchable text per row: its metadata plus the complete description.
  var searchText = new Map(rows.map(function (row) {
    var entry = entries.get(row.dataset.annotationId);
    var text = [row.dataset.model, row.dataset.provider, row.dataset.created, entry ? entry.textContent : ''].join(' ');
    return [row, text.toLowerCase()];
  }));

  function isVisible(row) {
    if (state.filter && !state.filter.ids.has(row.dataset.annotationId)) return false;
    if (state.query && searchText.get(row).indexOf(state.query) === -1) return false;
    return true;
  }

  function byNumber(field, direction) {
    return function (a, b) { return (Number(a.dataset[field]) - Number(b.dataset[field])) * direction; };
  }
  // Dates may be missing; undated rows always sort last.
  function byDate(field, direction) {
    return function (a, b) {
      var x = Date.parse(a.dataset[field]), y = Date.parse(b.dataset[field]);
      if (!Number.isFinite(x)) return Number.isFinite(y) ? 1 : 0;
      if (!Number.isFinite(y)) return -1;
      return (x - y) * direction;
    };
  }
  var SORTERS = {
    'provider': function (a, b) {
      return a.dataset.provider.localeCompare(b.dataset.provider) || byDate('created', 1)(a, b);
    },
    'words-desc': byNumber('words', -1),
    'words-asc': byNumber('words', 1),
    'created-desc': byDate('created', -1),
    'created-asc': byDate('created', 1),
    'released-desc': byDate('released', -1),
    'released-asc': byDate('released', 1),
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function render() {
    var visible = rows.filter(isVisible).sort(SORTERS[state.sort]);
    renderList(visible);
    renderTermButtons();
    // Name the active filter: it may come from an Overview card (a mood word,
    // a dimension) that has no button of its own in the toolbar.
    controls.count.textContent = visible.length + ' of ' + rows.length + ' descriptions'
      + (state.filter ? ' · ' + state.filter.label : '');
    controls.empty.hidden = visible.length > 0;
    renderReader();
  }

  // Rebuild the list in display order. Provider sort adds a header per group.
  function renderList(visible) {
    list.querySelectorAll('.outputs-group').forEach(function (header) { header.remove(); });
    rows.forEach(function (row) { row.hidden = true; });
    var group = null;
    visible.forEach(function (row) {
      if (state.sort === 'provider' && row.dataset.provider !== group) {
        group = row.dataset.provider;
        list.appendChild(groupHeader(group, visible));
      }
      row.hidden = false;
      list.appendChild(row);
      var id = row.dataset.annotationId;
      row.classList.toggle('is-selected', state.pair.length < 2 && id === state.selected);
      row.classList.toggle('is-paired', state.pair.indexOf(id) !== -1);
      row.querySelector('.outputs-pair-toggle').checked = state.pair.indexOf(id) !== -1;
    });
  }

  function groupHeader(provider, visible) {
    var count = visible.filter(function (row) { return row.dataset.provider === provider; }).length;
    var header = document.createElement('li');
    header.className = 'outputs-group';
    header.textContent = provider + ' · ' + count;
    return header;
  }

  function renderTermButtons() {
    if (!termFilters.length) return;
    controls.terms.replaceChildren();
    var options = [{ label: 'Any', ids: null }].concat(termFilters);
    options.forEach(function (option) {
      var active = option.ids ? state.filter && state.filter.label === option.label : !state.filter;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'outputs-term' + (option.flagged ? ' outputs-term--flagged' : '');
      if (option.flagged) button.title = 'Descriptions that disagree with the museum record';
      button.setAttribute('aria-pressed', String(Boolean(active)));
      button.textContent = option.label + (option.ids ? ' ' + option.ids.size : '');
      button.addEventListener('click', function () { setFilter(option.ids ? option : null); });
      controls.terms.appendChild(button);
    });
  }

  // Show either the selected entry or, with two rows ticked, the pair.
  function renderReader() {
    var showPair = state.pair.length === 2;
    entries.forEach(function (entry, id) { entry.hidden = showPair || id !== state.selected; });
    controls.pair.hidden = !showPair;
    if (showPair) renderPair();
    else highlight(entries.get(state.selected));
  }

  // The side-by-side view copies the title, metadata and text of each entry.
  function renderPair() {
    controls.pairColumns.replaceChildren();
    state.pair.forEach(function (id) {
      var entry = entries.get(id);
      if (!entry) return;
      var column = document.createElement('div');
      column.className = 'outputs-pair-column';
      ['.outputs-entry-title', '.research-note', '.outputs-flag', '.outputs-body'].forEach(function (selector) {
        var part = entry.querySelector(selector);
        if (part && !part.hidden) column.appendChild(part.cloneNode(true));
      });
      controls.pairColumns.appendChild(column);
      highlight(column);
    });
  }

  // Mark Find matches inside a reader element. The original HTML is kept so
  // each render starts from clean text.
  var originalHTML = new WeakMap();
  function highlight(element) {
    if (!element) return;
    var body = element.querySelector('.outputs-body');
    if (!body) return;
    if (!originalHTML.has(body)) originalHTML.set(body, body.innerHTML);
    body.innerHTML = originalHTML.get(body);
    if (!state.query) return;
    var pattern = new RegExp(state.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (!pattern.test(node.nodeValue)) return;
      pattern.lastIndex = 0;
      var fragment = document.createDocumentFragment(), cursor = 0, match;
      while ((match = pattern.exec(node.nodeValue))) {
        fragment.appendChild(document.createTextNode(node.nodeValue.slice(cursor, match.index)));
        var mark = document.createElement('mark');
        mark.textContent = match[0];
        fragment.appendChild(mark);
        cursor = match.index + match[0].length;
      }
      fragment.appendChild(document.createTextNode(node.nodeValue.slice(cursor)));
      node.parentNode.replaceChild(fragment, node);
    });
  }

  // -------------------------------------------------------------------------
  // State changes
  // -------------------------------------------------------------------------

  // On narrow screens the reader stacks below the whole index, so bring it
  // into view; side by side, it is already visible.
  var stacked = window.matchMedia('(max-width: 900px)');

  function select(id) {
    if (!entries.has(String(id))) return;
    state.selected = String(id);
    state.pair = [];
    render();
    if (stacked.matches) document.getElementById('outputs-reader').scrollIntoView({ block: 'start' });
  }

  function togglePair(id) {
    var index = state.pair.indexOf(id);
    if (index !== -1) state.pair.splice(index, 1);
    else {
      state.pair.push(id);
      if (state.pair.length > 2) state.pair.shift();
    }
    // Unticking back to one row selects it, so the reader never goes blank.
    if (state.pair.length === 1) state.selected = state.pair[0];
    render();
  }

  // Filtering never leaves the reader on a hidden row: if the selected
  // description is filtered out, the first visible one is selected instead.
  function setFilter(filter) {
    state.filter = filter;
    state.pair = [];
    keepSelectionVisible();
    render();
  }

  function keepSelectionVisible() {
    var selectedRow = rows.find(function (row) { return row.dataset.annotationId === state.selected; });
    if (selectedRow && isVisible(selectedRow)) return;
    var first = rows.filter(isVisible).sort(SORTERS[state.sort])[0];
    if (first) state.selected = first.dataset.annotationId;
  }

  // -------------------------------------------------------------------------
  // Overview data: shared terms, notable phrases and divergence flags
  // -------------------------------------------------------------------------

  // Divergence signals that disagree with the museum record. Each kind has a
  // short label for the index row and a full sentence for the reader.
  // (The length range is also a divergence signal, but not a disagreement.)
  var FLAG_KINDS = {
    unrecorded_title: {
      label: 'title differs from record',
      text: function (s) {
        return 'Calls it ' + s.titles.map(function (t) { return '“' + t + '”'; }).join(' and ') + '; the record’s title is ' + s.record_title;
      },
    },
    unrecorded_names: {
      label: 'names a person not in the record',
      text: function (s) { return 'Names ' + s.names.join(' and ') + ', not in the museum record'; },
    },
    unrecorded_medium: {
      label: 'medium differs from record',
      text: function (s) { return 'Mentions ' + s.media.join(' and ') + (s.record_medium ? '; the record says ' + s.record_medium : ''); },
    },
  };

  function setOverview(overview) {
    // Group the record disagreements by description.
    var flags = new Map();
    (overview.divergence || []).forEach(function (signal) {
      if (!FLAG_KINDS[signal.kind]) return;
      var id = String(signal.annotation_id);
      flags.set(id, (flags.get(id) || []).concat(signal));
    });

    // Filter buttons: the shared terms, then every flagged description.
    termFilters = (overview.agreement || []).map(function (term) {
      return { label: term.term, ids: new Set(term.annotation_ids.map(String)) };
    });
    if (flags.size) termFilters.push({ label: 'flagged', ids: new Set(flags.keys()), flagged: true });

    // Notable column: why a row is flagged first, then its distinctive phrases.
    rows.forEach(function (row) {
      var id = row.dataset.annotationId;
      var cell = row.querySelector('.outputs-notable');
      cell.replaceChildren();
      (flags.get(id) || []).forEach(function (signal) {
        var label = document.createElement('span');
        label.className = 'outputs-flag-label';
        label.textContent = FLAG_KINDS[signal.kind].label;
        cell.appendChild(label);
      });
      var phrases = (overview.distinctive || {})[id];
      if (phrases) cell.appendChild(document.createTextNode(phrases.join(', ')));
    });

    // Reader: the full sentence above the description text.
    flags.forEach(function (signals, id) {
      var entry = entries.get(id);
      if (!entry) return;
      var flag = entry.querySelector('.outputs-flag');
      flag.textContent = signals.map(function (s) { return FLAG_KINDS[s.kind].text(s); }).join('. ') + '.';
      flag.hidden = false;
    });
    render();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  list.addEventListener('click', function (event) {
    var button = event.target.closest('.outputs-select');
    if (button) select(button.closest('.outputs-row').dataset.annotationId);
  });
  list.addEventListener('change', function (event) {
    if (event.target.classList.contains('outputs-pair-toggle')) togglePair(event.target.closest('.outputs-row').dataset.annotationId);
  });
  controls.find.addEventListener('input', function () {
    state.query = controls.find.value.trim().toLowerCase();
    keepSelectionVisible();
    render();
  });
  controls.sort.addEventListener('change', function () {
    state.sort = controls.sort.value;
    render();
  });
  controls.clear.addEventListener('click', function () {
    controls.find.value = '';
    state.query = '';
    setFilter(null);
  });
  controls.pairClear.addEventListener('click', function () {
    state.pair = [];
    render();
  });
  controls.pairOpen.addEventListener('click', function () {
    if (window.compareResearchAnnotations) window.compareResearchAnnotations(state.pair.slice());
  });

  render();

  // Bring a deep-linked description into view once the page has settled.
  if (panel.dataset.initialSelection) {
    requestAnimationFrame(function () {
      var row = rows.find(function (r) { return r.dataset.annotationId === state.selected; });
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
  }

  // -------------------------------------------------------------------------
  // Public API (used by overview-panel.js and the perspectives loader)
  // -------------------------------------------------------------------------

  window.researchOutputs = {
    setOverview: setOverview,
    // Show one description in the reader.
    select: function (id) {
      state.query = '';
      controls.find.value = '';
      state.filter = null;
      select(id);
    },
    // Show only the given descriptions, labelled for the term buttons.
    filter: function (label, ids) {
      setFilter({ label: label, ids: new Set(ids.map(String)) });
    },
    sort: function (key) {
      if (!SORTERS[key]) return;
      state.sort = controls.sort.value = key;
      setFilter(null);
    },
  };
})();
