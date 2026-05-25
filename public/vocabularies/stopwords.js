var _stopwords = {
  the:1, a:1, an:1, and:1, or:1, but:1, in:1, on:1, at:1, to:1,
  for:1, of:1, with:1, by:1, from:1, is:1, are:1, was:1, were:1,
  it:1, its:1, this:1, that:1, these:1, those:1, as:1, be:1, been:1,
  being:1, have:1, has:1, had:1, do:1, does:1, did:1, will:1, would:1,
  could:1, should:1, may:1, might:1, which:1, who:1, what:1, where:1,
  when:1, how:1, also:1, both:1, each:1, into:1, through:1, between:1,
  while:1, their:1, there:1, they:1, them:1, his:1, her:1, he:1, she:1,
  we:1, our:1, us:1, you:1, your:1, i:1, my:1, me:1, not:1, no:1,
  more:1, most:1, very:1, one:1, two:1, three:1
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _stopwords;
} else {
  window.stopwords = _stopwords;
}
