/*
 * Overview tab — "Where they looked" card.
 *
 * Shows the places the descriptions agree on (the positions block from
 * perspectives.compute, built by positions.js): up to three claims, each a row
 * with a 3×3 locator, the subject, where it is, how many descriptions say so,
 * and whether a detected box confirms it. Choosing a row spotlights that part
 * of the image and draws the boxes behind the check. One flag line below the
 * rows names a detection few descriptions mention ("Bird" boxes on leaves).
 *
 * Called by the perspectives loader in object.hbs:
 *   window.renderPositionsCard(data)   // data is null if loading failed
 */
(function () {
  'use strict';

  // Each cell as [row, column]; null means the whole row or column.
  var CELL_AXES = {
    'top-left': [0, 0], 'top': [0, null], 'top-right': [0, 2],
    'left': [null, 0], 'center': [1, 1], 'right': [null, 2],
    'bottom-left': [2, 0], 'bottom': [2, null], 'bottom-right': [2, 2],
  };
  // How each place reads in a row.
  var PLACE_NAMES = {
    'top-left': 'Top left corner', 'top': 'Along the top', 'top-right': 'Top right corner',
    'left': 'Left side', 'center': 'Centre', 'right': 'Right side',
    'bottom-left': 'Bottom left corner', 'bottom': 'Along the bottom', 'bottom-right': 'Bottom right corner',
  };
  var SHORT_NAMES = {
    'top-left': 'top left', 'top': 'top', 'top-right': 'top right', 'left': 'left', 'center': 'centre',
    'right': 'right', 'bottom-left': 'lower left', 'bottom': 'bottom', 'bottom-right': 'lower right',
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function note(text) { return el('p', 'research-note', text); }
  function capitalise(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

  // The squares a cell covers: a corner or the centre is one, a side three.
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
    var names = others.map(function (s) { return SHORT_NAMES[s[0]]; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : names[0];
    return where + ' · ' + count + (count === 1 ? ' other says ' : ' others say ') + list;
  }

  // The subject: "Seal and signature". Split claims share a label, so the
  // place is added to tell them apart: "Figure and man · left".
  function subjectText(claim, claims) {
    var twin = claims.some(function (c) { return c !== claim && c.label === claim.label; });
    return capitalise(claim.label) + (twin ? ' · ' + SHORT_NAMES[claim.usual] : '');
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

  // The 3×3 locator for a row.
  function glyph(cell) {
    var node = el('span', 'positions-glyph');
    node.setAttribute('aria-hidden', 'true');
    var lit = squaresOf(cell);
    for (var i = 0; i < 9; i++) node.appendChild(el('span', lit.indexOf(i) >= 0 ? 'is-lit' : ''));
    return node;
  }

  // Spotlight a place on the card's image and draw boxes over it.
  function show(figure, cell, boxes, kind) {
    var spot = figure.querySelector('[data-positions-spot]');
    var layer = figure.querySelector('[data-positions-boxes]');
    if (cell) {
      var squares = squaresOf(cell), rows = squares.map(function (s) { return Math.floor(s / 3); }), cols = squares.map(function (s) { return s % 3; });
      var top = Math.min.apply(null, rows), left = Math.min.apply(null, cols);
      spot.style.top = (top * 100 / 3) + '%';
      spot.style.left = (left * 100 / 3) + '%';
      spot.style.height = ((Math.max.apply(null, rows) - top + 1) * 100 / 3) + '%';
      spot.style.width = ((Math.max.apply(null, cols) - left + 1) * 100 / 3) + '%';
      spot.hidden = false;
    } else {
      spot.hidden = true;
    }
    figure.classList.toggle('is-dimmed', !cell);
    layer.replaceChildren.apply(layer, boxes.map(function (b) {
      var box = el('span', 'positions-box' + (kind === 'flag' ? ' positions-box--flag' : ''));
      box.style.left = b.x + '%'; box.style.top = b.y + '%'; box.style.width = b.w + '%'; box.style.height = b.h + '%';
      box.title = (b.source ? b.source + ': ' : '') + b.label;
      return box;
    }));
  }

  window.renderPositionsCard = function (data) {
    var slot = document.querySelector('[data-positions-slot]');
    var figure = document.querySelector('[data-positions-figure]');
    if (!slot || !figure) return;
    var positions = data && data.positions;
    if (!positions) {
      slot.replaceChildren(note(data ? 'No position analysis for this image.' : 'The analysis could not be loaded.'));
      return;
    }
    var claims = positions.card.map(function (id) {
      return positions.claims.find(function (c) { return c.id === id; });
    }).filter(Boolean);
    var flag = positions.flags[0] || null;
    if (!claims.length && !flag) {
      slot.replaceChildren(note('Too few descriptions say where things are in the image to show here.'));
      return;
    }

    var list = el('div', 'positions-rows');
    var link = el('button', 'overview-link');
    link.type = 'button';
    var rows = [];

    function select(index) {
      rows.forEach(function (row, i) { row.classList.toggle('is-selected', i === index); row.setAttribute('aria-pressed', String(i === index)); });
      if (index < claims.length) {
        var claim = claims[index];
        show(figure, claim.usual, claim.boxes, 'claim');
        link.textContent = 'Read the ' + claim.placed + ' descriptions that place it →';
        link.onclick = function () {
          location.hash = 'descriptions';
          if (window.researchOutputs) window.researchOutputs.filter(capitalise(claim.label) + ' · ' + SHORT_NAMES[claim.usual], claim.placed_by);
        };
        link.hidden = false;
      } else {
        show(figure, null, flag.boxes, 'flag');
        link.hidden = true;
      }
    }

    claims.forEach(function (claim, i) {
      var row = el('button', 'positions-row');
      row.type = 'button';
      var text = el('span', 'positions-row-text');
      text.append(
        el('strong', null, subjectText(claim, positions.claims)),
        el('span', 'positions-row-where', whereText(claim)),
        el('span', 'positions-row-check' + (claim.check === 'seen' ? ' is-seen' : ''), checkText(claim))
      );
      row.append(glyph(claim.usual), text, el('span', 'positions-row-count', countText(claim)));
      row.addEventListener('click', function () { select(i); });
      rows.push(row);
      list.appendChild(row);
    });

    if (flag) {
      var flagRow = el('button', 'positions-row positions-row--flag');
      flagRow.type = 'button';
      var mention = flag.mentioned === 0 ? 'no description mentions it'
        : flag.mentioned + ' of ' + Object.keys(positions.by_description).length + ' descriptions mention it';
      flagRow.append(
        el('span', 'positions-flag-mark', '◌'),
        el('span', 'positions-row-text', '“' + flag.label + '” × ' + flag.count + ' · boxed by ' + flag.sources.join(' and ') + '; ' + mention)
      );
      flagRow.addEventListener('click', function () { select(claims.length); });
      rows.push(flagRow);
      list.appendChild(flagRow);
    }

    slot.replaceChildren(list, link);
    figure.hidden = false;
    select(0);
  };
})();
