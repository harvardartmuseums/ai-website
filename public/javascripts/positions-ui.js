/*
 * Where they looked — the position views, from the perspectives JSON's
 * positions block (built by positions.js).
 *
 *   Overview card   up to three claims and one flag. Choosing a row
 *                   spotlights its place on the image in the left pane.
 *   Positions tab   every claim; each opens to show where the descriptions
 *                   put it, their words, and the check against detected boxes.
 *                   Then every detection-only flag, and the position phrases
 *                   set aside (directions, relative positions …).
 *   Viewer          the spotlight and boxes are OpenSeadragon overlays on
 *                   the left-pane image, so they stay put when zooming. They
 *                   clear when another tab opens.
 *
 * A claim is { id, label, heads, usual, spread, placed, placed_by, mentioned,
 * split, reading_offset, check, boxes, evidence }; see positions.js.
 *
 * Called by the perspectives loader in object.hbs:
 *   window.renderPositions(data)   // data is null if loading failed
 */
(function () {
  'use strict';

  // Each cell as [row, column]; null means the whole row or column.
  var CELL_AXES = {
    'top-left': [0, 0], 'top': [0, null], 'top-right': [0, 2],
    'left': [null, 0], 'center': [1, 1], 'right': [null, 2],
    'bottom-left': [2, 0], 'bottom': [2, null], 'bottom-right': [2, 2],
  };
  // How a place reads in a row's "where" line, and in short lists.
  var PLACE_NAMES = {
    'top-left': 'Top left corner', 'top': 'Along the top', 'top-right': 'Top right corner',
    'left': 'Left side', 'center': 'Centre', 'right': 'Right side',
    'bottom-left': 'Bottom left corner', 'bottom': 'Along the bottom', 'bottom-right': 'Bottom right corner',
  };
  var SHORT_NAMES = {
    'top-left': 'top left', 'top': 'top', 'top-right': 'top right', 'left': 'left', 'center': 'centre',
    'right': 'right', 'bottom-left': 'lower left', 'bottom': 'bottom', 'bottom-right': 'lower right',
  };
  // How set-aside kinds are described on the Positions tab.
  var SET_ASIDE = {
    direction: 'say which way something faces or looks (“facing to the right”)',
    relative: 'place something next to something else (“to the right of the rabbit”)',
    trajectory: 'say where something extends or moves (“extending towards the right”)',
    nested: 'give a place inside something else (“at the top” of a caption)',
  };
  var MAX_QUOTES = 3;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function note(text) { return el('p', 'research-note', text); }
  function capitalise(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
  function listText(items) {
    return items.length > 1 ? items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1] : items[0];
  }

  // The squares a cell covers (0–8, row by row): a corner or the centre is
  // one square, a side three.
  function squaresOf(cell) {
    var axes = CELL_AXES[cell], rows = axes[0] === null ? [0, 1, 2] : [axes[0]], cols = axes[1] === null ? [0, 1, 2] : [axes[1]];
    var squares = [];
    rows.forEach(function (r) { cols.forEach(function (c) { squares.push(r * 3 + c); }); });
    return squares;
  }
  // Do two places agree? The same cell, or a side containing the other.
  function agree(a, b) {
    var sa = squaresOf(a), sb = squaresOf(b);
    var contains = function (outer, inner) { return inner.every(function (s) { return outer.indexOf(s) >= 0; }); };
    return a === b || contains(sa, sb) || contains(sb, sa);
  }

  // -------------------------------------------------------------------------
  // A claim's row text
  // -------------------------------------------------------------------------

  // "Seal and signature", "Figures on the left".
  function subjectText(claim) { return capitalise(claim.label); }

  // "8 of 9": descriptions putting it where most do, of those that place it.
  function countText(claim) {
    var agreeing = claim.spread.filter(function (s) { return agree(claim.usual, s[0]); })
      .reduce(function (sum, s) { return sum + s[1]; }, 0);
    return Math.min(agreeing, claim.placed) + ' of ' + claim.placed;
  }

  // "Centre · 4 others say left, lower left or bottom"
  function whereText(claim) {
    var others = claim.spread.filter(function (s) { return !agree(claim.usual, s[0]); });
    var where = PLACE_NAMES[claim.usual];
    if (!others.length) return where;
    var count = others.reduce(function (sum, s) { return sum + s[1]; }, 0);
    return where + ' · ' + count + (count === 1 ? ' other says ' : ' others say ') +
      listText(others.map(function (s) { return SHORT_NAMES[s[0]]; }));
  }

  // "AWS Rekognition found text here", "AWS Rekognition found 3 faces here",
  // "Clarifai boxed “Animal” here". Each service boxes the same things
  // separately, so the line names one service and counts only its boxes: the
  // one with the most, preferring text and faces over tags.
  function checkText(claim) {
    if (claim.check !== 'seen' || !claim.boxes.length) return '– Nothing detected here to check against';
    var groups = {};
    claim.boxes.forEach(function (b) {
      var key = (b.source || 'A vision service') + '|' + b.type + '|' + (b.type === 'tag' ? b.label : '');
      (groups[key] = groups[key] || []).push(b);
    });
    var rank = { text: 2, face: 1, tag: 0 };
    var best = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      return (rank[b[0].type] - rank[a[0].type]) || (b.length - a.length);
    })[0];
    var box = best[0], source = box.source || 'A vision service';
    if (box.type === 'text') return '✓ ' + source + ' found text here';
    if (box.type === 'face') return '✓ ' + source + ' found ' + (best.length === 1 ? 'a face' : best.length + ' faces') + ' here';
    return '✓ ' + source + ' boxed “' + box.label + '” here';
  }

  // "AWS Rekognition (9) and Clarifai (1)", or one name when one service drew them all.
  // "AWS Rekognition drew 5 boxes", "AWS Rekognition drew 9 boxes, Clarifai 1"
  function bySource(flag) {
    var list = flag.by_source || [];
    if (!list.length) return flag.count + ' boxes';
    return list.map(function (s, i) {
      return s[0] + (i === 0 ? ' drew ' + s[1] + (s[1] === 1 ? ' box' : ' boxes') : ' ' + s[1]);
    }).join(', ');
  }

  // A flag reads like a claim row: what was detected, who boxed it, and how
  // few descriptions agree.
  //   Labelled “Bird”
  //   AWS Rekognition drew 5 boxes
  //   ◌ Only 4 of 42 descriptions mention “bird”
  function flagLines(flag, descriptionCount) {
    var word = '“' + flag.label.toLowerCase() + '”';
    return {
      title: 'Labelled “' + flag.label + '”',
      detail: bySource(flag),
      check: flag.mentioned === 0 ? 'No description mentions ' + word
        : 'Only ' + flag.mentioned + ' of ' + descriptionCount + ' descriptions mention ' + word,
    };
  }

  // The 3×3 locator.
  function glyph(cell) {
    var node = el('span', 'positions-glyph');
    node.setAttribute('aria-hidden', 'true');
    var lit = cell ? squaresOf(cell) : [];
    for (var i = 0; i < 9; i++) node.appendChild(el('span', lit.indexOf(i) >= 0 ? 'is-lit' : ''));
    return node;
  }

  // One claim's row button: locator, subject, where, check, count.
  function claimRow(claim) {
    var row = el('button', 'positions-row');
    row.type = 'button';
    var text = el('span', 'positions-row-text');
    text.append(
      el('strong', null, subjectText(claim)),
      el('span', 'positions-row-where', whereText(claim)),
      el('span', 'positions-row-check' + (claim.check === 'seen' ? ' is-seen' : ''), checkText(claim))
    );
    row.append(glyph(claim.usual), text, el('span', 'positions-row-count', countText(claim)));
    return row;
  }

  // One flag's row button.
  function flagRow(flag, descriptionCount) {
    var lines = flagLines(flag, descriptionCount);
    var row = el('button', 'positions-row positions-row--flag');
    row.type = 'button';
    var text = el('span', 'positions-row-text');
    text.append(
      el('strong', null, lines.title),
      el('span', 'positions-row-where', lines.detail),
      el('span', 'positions-row-check is-flag', lines.check)
    );
    row.append(el('span', 'positions-flag-mark', '◌'), text);
    return row;
  }

  // Switch to Descriptions, showing only the given descriptions.
  function openDescriptions(label, ids) {
    location.hash = 'descriptions';
    if (window.researchOutputs) window.researchOutputs.filter(label, ids);
  }
  function openDescription(id) {
    location.hash = 'descriptions';
    if (window.researchOutputs) window.researchOutputs.select(id);
  }

  // -------------------------------------------------------------------------
  // Spotlight on the left-pane viewer (OpenSeadragon overlays)
  // -------------------------------------------------------------------------

  var overlays = [];

  function clearSpotlight() {
    if (!window.viewer) return;
    overlays.forEach(function (node) { window.viewer.removeOverlay(node); });
    overlays = [];
  }

  // Dim the image except `cell` (or all of it lightly when cell is null) and
  // draw `boxes` ({ x, y, w, h } in % of the image). kind 'flag' draws dashed
  // amber boxes.
  function spotlight(cell, boxes, kind) {
    var viewer = window.viewer;
    if (!viewer || !window.OpenSeadragon) return;
    var image = viewer.world.getItemAt(0);
    if (!image) { viewer.addOnceHandler('open', function () { spotlight(cell, boxes, kind); }); return; }
    clearSpotlight();
    var bounds = image.getBounds();
    function rect(x, y, w, h) {   // fractions of the image → viewport rectangle
      return new OpenSeadragon.Rect(bounds.x + x * bounds.width, bounds.y + y * bounds.height, w * bounds.width, h * bounds.height);
    }
    function add(node, location) {
      viewer.addOverlay({ element: node, location: location });
      overlays.push(node);
    }
    if (cell) {
      var squares = squaresOf(cell);
      var rows = squares.map(function (s) { return Math.floor(s / 3); }), cols = squares.map(function (s) { return s % 3; });
      var top = Math.min.apply(null, rows), left = Math.min.apply(null, cols);
      add(el('div', 'positions-viewer-spot'), rect(left / 3, top / 3,
        (Math.max.apply(null, cols) - left + 1) / 3, (Math.max.apply(null, rows) - top + 1) / 3));
    } else {
      add(el('div', 'positions-viewer-dim'), rect(0, 0, 1, 1));
    }
    boxes.forEach(function (b) {
      var node = el('div', 'positions-viewer-box' + (kind === 'flag' ? ' positions-viewer-box--flag' : ''));
      node.title = (b.source ? b.source + ': ' : '') + b.label;
      add(node, rect(b.x / 100, b.y / 100, b.w / 100, b.h / 100));
    });
  }

  // The spotlight belongs to the position views; other tabs show the plain image.
  var workspace = document.querySelector('.image-research-workspace');
  if (workspace) {
    workspace.addEventListener('researchview', function (event) {
      if (event.detail !== 'overview' && event.detail !== 'positions') clearSpotlight();
    });
  }

  // -------------------------------------------------------------------------
  // Overview card
  // -------------------------------------------------------------------------

  function renderCard(target, positions, descriptionCount) {
    var claims = positions.card.map(function (id) {
      return positions.claims.find(function (c) { return c.id === id; });
    }).filter(Boolean);
    var flag = positions.flags[0] || null;
    if (!claims.length && !flag) {
      target.replaceChildren(note('Too few descriptions say where things are in the image to show here.'));
      return;
    }
    var rows = [], list = el('div', 'positions-rows');
    var link = el('a', 'overview-link');
    link.href = '#positions';

    // Choosing a row spotlights it; choosing it again turns the spotlight off.
    var selected = -1;
    function select(index) {
      selected = selected === index ? -1 : index;
      rows.forEach(function (row, i) {
        row.classList.toggle('is-selected', i === selected);
        row.setAttribute('aria-pressed', String(i === selected));
      });
      if (selected === -1) clearSpotlight();
      else if (selected < claims.length) spotlight(claims[selected].usual, claims[selected].boxes, 'claim');
      else spotlight(null, flag.boxes, 'flag');
      link.href = '#positions' + (selected >= 0 && selected < claims.length ? '/' + claims[selected].id : '');
    }

    claims.forEach(function (claim, i) {
      var row = claimRow(claim);
      row.addEventListener('click', function () { select(i); });
      rows.push(row);
      list.appendChild(row);
    });
    if (flag) {
      var row = flagRow(flag, descriptionCount);
      row.addEventListener('click', function () { select(claims.length); });
      rows.push(row);
      list.appendChild(row);
    }
    var total = positions.claims.length + positions.flags.length;
    link.textContent = total > rows.length ? 'All ' + total + ' positions →' : 'Positions, with the descriptions’ words →';
    target.replaceChildren(list, link);
  }

  // -------------------------------------------------------------------------
  // Positions tab
  // -------------------------------------------------------------------------

  // The detail under a chosen claim: where each description puts it, a few of
  // their sentences, and links to the descriptions.
  function claimDetail(claim) {
    var detail = el('div', 'positions-detail');
    if (claim.spread.length > 1) {
      var top = claim.spread[0][1];
      var bars = el('ul', 'positions-spread');
      claim.spread.forEach(function (s, i) {
        var item = el('li', i === 0 ? 'is-usual' : '');
        var track = el('span', 'positions-spread-track');
        var fill = el('span', 'positions-spread-fill');
        fill.style.width = Math.round(s[1] / top * 100) + '%';
        track.appendChild(fill);
        item.append(el('span', 'positions-spread-label', capitalise(SHORT_NAMES[s[0]])), track, el('span', 'positions-spread-count', String(s[1])));
        bars.appendChild(item);
      });
      detail.appendChild(bars);
    }
    // Sentences, one per description: up to MAX_QUOTES, those in the usual
    // place first, but keeping a slot for one that places it elsewhere.
    var seen = {};
    var unique = claim.evidence.filter(function (e) {
      if (seen[e.annotation_id]) return false;
      seen[e.annotation_id] = true;
      return true;
    });
    var agreeing = unique.filter(function (e) { return agree(claim.usual, e.cell); });
    var dissent = unique.filter(function (e) { return !agree(claim.usual, e.cell); });
    var quotes = agreeing.slice(0, dissent.length ? MAX_QUOTES - 1 : MAX_QUOTES).concat(dissent.slice(0, 1));
    quotes.forEach(function (e) {
      var quote = el('blockquote', 'positions-quote' + (agree(claim.usual, e.cell) ? '' : ' is-dissent'));
      var at = e.sentence.indexOf(e.phrase);
      var words = el('span', 'positions-quote-text');
      if (at >= 0) {
        words.append('“' + e.sentence.slice(0, at), el('mark', null, e.phrase), e.sentence.slice(at + e.phrase.length) + '”');
      } else {
        words.textContent = '“' + e.sentence + '”';
      }
      var by = el('button', 'overview-link positions-quote-source', (e.source || 'Description') +
        (agree(claim.usual, e.cell) ? '' : ' · places it ' + SHORT_NAMES[e.cell]) + ' →');
      by.type = 'button';
      by.addEventListener('click', function () { openDescription(e.annotation_id); });
      quote.append(words, by);
      detail.appendChild(quote);
    });
    var all = el('button', 'overview-link', 'Read the ' + claim.placed + ' descriptions that place it →');
    all.type = 'button';
    all.addEventListener('click', function () {
      openDescriptions(subjectText(claim) + (claim.split ? '' : ' · ' + SHORT_NAMES[claim.usual]), claim.placed_by);
    });
    detail.appendChild(all);
    return detail;
  }

  var panelSelect = null;   // set by renderPanel: select a claim by id

  function renderPanel(target, positions, descriptionCount) {
    target.replaceChildren();
    if (!positions.claims.length && !positions.flags.length) {
      target.appendChild(note('None of the descriptions place anything in the image often enough to group.'));
    }

    var items = [];   // { row, detail, claim } in display order
    function select(id) {
      items.forEach(function (item) {
        var on = item.claim.id === id;
        item.row.classList.toggle('is-selected', on);
        item.row.setAttribute('aria-expanded', String(on));
        item.detail.hidden = !on;
      });
      var claim = positions.claims.find(function (c) { return c.id === id; });
      if (claim) spotlight(claim.usual, claim.boxes, 'claim');
    }
    panelSelect = select;

    if (positions.claims.length) {
      var list = el('div', 'positions-rows positions-rows--panel');
      positions.claims.forEach(function (claim) {
        var row = claimRow(claim);
        var detail = claimDetail(claim);
        detail.hidden = true;
        row.addEventListener('click', function () {
          // Keep the hash in step, so the chosen claim can be linked to.
          if (location.hash !== '#positions/' + claim.id) history.replaceState(null, '', '#positions/' + claim.id);
          select(claim.id);
        });
        var wrap = el('div', 'positions-item');
        wrap.append(row, detail);
        list.appendChild(wrap);
        items.push({ row: row, detail: detail, claim: claim });
      });
      target.appendChild(list);
    }

    if (positions.flags.length) {
      target.appendChild(el('h3', 'positions-subhead', 'Detected, but few descriptions mention it'));
      var flags = el('div', 'positions-rows');
      positions.flags.forEach(function (flag) {
        var row = flagRow(flag, descriptionCount);
        row.addEventListener('click', function () {
          items.forEach(function (item) { item.row.classList.remove('is-selected'); item.detail.hidden = true; });
          spotlight(null, flag.boxes, 'flag');
        });
        flags.appendChild(row);
      });
      target.appendChild(flags);
    }

    var kinds = Object.keys(SET_ASIDE).filter(function (k) { return positions.set_aside[k]; });
    if (kinds.length) {
      var aside = el('details', 'positions-aside');
      var count = kinds.reduce(function (sum, k) { return sum + positions.set_aside[k].count; }, 0);
      aside.appendChild(el('summary', null, count + ' position phrases set aside: they don’t say where something is in the image'));
      kinds.forEach(function (k) {
        var group = positions.set_aside[k];
        aside.appendChild(el('p', 'positions-aside-kind', group.count + ' ' + SET_ASIDE[k]));
        group.examples.forEach(function (e) {
          var at = e.sentence.indexOf(e.phrase);
          var line = el('p', 'positions-aside-example');
          if (at >= 0) line.append('“' + e.sentence.slice(0, at), el('em', null, e.phrase), e.sentence.slice(at + e.phrase.length) + '” · ' + e.source);
          else line.textContent = '“' + e.sentence + '” · ' + e.source;
          aside.appendChild(line);
        });
      });
      target.appendChild(aside);
    }
  }

  // Open the claim a "#positions/<claim id>" hash names, or the first claim.
  function syncPanel() {
    var parts = location.hash.slice(1).split('/');
    if (parts[0] !== 'positions' || !panelSelect || !lastPositions) return;
    var id = parts[1] || (lastPositions.claims[0] && lastPositions.claims[0].id);
    if (id) panelSelect(id);
  }
  window.addEventListener('hashchange', syncPanel);

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  var lastPositions = null;

  window.renderPositions = function (data) {
    var card = document.querySelector('[data-positions-card]');
    var panel = document.querySelector('[data-positions-panel]');
    var count = document.querySelector('[data-positions-count]');
    var positions = data && data.positions;
    if (!positions) {
      var reason = data ? 'No position analysis for this image.' : 'The analysis could not be loaded.';
      if (card) card.replaceChildren(note(reason));
      if (panel) panel.replaceChildren(note(reason));
      return;
    }
    lastPositions = positions;
    var descriptionCount = Object.keys(positions.by_description).length;
    if (count) count.textContent = positions.claims.length;
    if (card) renderCard(card, positions, descriptionCount);
    if (panel) renderPanel(panel, positions, descriptionCount);
    syncPanel();
  };
})();
