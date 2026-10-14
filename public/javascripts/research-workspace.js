(function () {
  'use strict';
  var root = document.querySelector('.image-research-workspace');
  if (!root) return;
  var panels = Array.from(root.querySelectorAll('[data-research-panel]'));
  // Hashes from the previous layout, kept so bookmarks and evidence links work.
  // (#descriptions needs no entry: it is the Descriptions tab's own hash.)
  var LEGACY_VIEWS = { perspectives: 'vocabulary', tags: 'detections', other: 'detections' };
  function showView(name) {
    name = LEGACY_VIEWS[name] || name;
    if (!panels.some(function (p) { return p.dataset.researchPanel === name; })) name = 'overview';
    panels.forEach(function (p) { p.hidden = p.dataset.researchPanel !== name; });
    root.querySelectorAll('[data-research-tab]').forEach(function (link) {
      if (link.dataset.researchTab === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    root.dispatchEvent(new CustomEvent('researchview', { detail: name }));
  }
  // Sections that were merged into "What the models cover".
  var LEGACY_SECTIONS = { noticed: 'coverage', radar: 'coverage', mood: 'coverage-mood' };
  // A hash may name a section within a view: "#vocabulary/coverage" opens the
  // Vocabulary tab, expands that section if it is collapsed, and scrolls to it.
  function syncHash() {
    var parts = location.hash.slice(1).split('/');
    showView(parts[0]);
    var name = parts[1] && (LEGACY_SECTIONS[parts[1]] || parts[1]);
    var section = name && root.querySelector('[data-research-section="' + name + '"]');
    if (!section) return;
    if (section.tagName === 'DETAILS') section.open = true;
    // Scroll now: scrollIntoView lays out the page itself, and deferring to an
    // animation frame never fires while the page is in a background tab.
    section.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', syncHash);
  syncHash();
  // Called by the perspectives loader once Vocabulary sections exist.
  window.syncResearchSection = function () { if (location.hash.indexOf('/') !== -1) syncHash(); };

  // Image strip: keep each thumbnail's link pointing at the current tab, so
  // switching images (or opening one in a new tab) stays on the same view.
  var imageLinks = Array.from(document.querySelectorAll('.research-image-strip a'));
  function syncImageLinks() { imageLinks.forEach(function (link) { link.hash = location.hash; }); }
  window.addEventListener('hashchange', syncImageLinks);
  syncImageLinks();

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
  // Open Compare with a human reference ("imagedesc" or "labeltext") on one
  // side and the first AI description on the other.
  window.compareWithHumanReference = function (key) {
    var firstAI = document.querySelector('.desc-data[data-annotation-id]:not([data-annotation-id=""])');
    if (window.researchCompare) window.researchCompare(key, firstAI && firstAI.dataset.key);
    location.hash = 'compare';
  };
  document.addEventListener('DOMContentLoaded', function () {
    var record = document.getElementById('research-source-record');
    // Evidence URLs can target a view hash. Bring the complete source into view
    // after the browser's initial anchor navigation, rather than burying it
    // above the description cards or other-analysis sections.
    if (record) requestAnimationFrame(function () { record.scrollIntoView({ block: 'start' }); });
  });
})();
