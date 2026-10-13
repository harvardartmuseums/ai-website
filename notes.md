# AI Explorer — Design Notes

## Page structure: attention as organizing principle

The object page is reorganized around **signal strength** rather than source (human vs machine). The question driving layout is: "what should the viewer pay attention to?"

### Signal hierarchy

1. **Strongest** — A curator has decided this matters. (Rare — only a few thousand records have labeltext.)
2. **Strong** — Multiple independent AIs converge on the same thing. (AI Perspectives agreement.)
3. **Moderate** — Individual AIs describe what they observe. (Descriptions, tags — useful raw material but unsorted.)
4. **Weak** — Mechanical outputs. (Confidence scores, bounding boxes, face coordinates — technical detail.)

### Page order

1. Object identity (title, date, people, classification — fast orientation)
2. "Points of attention" — labeltext + AI Perspectives as peer voices
3. Machine Generated Data — raw evidence for the analytical/technical viewer

### Curator vs AI framing

Both are observers with different strengths and blind spots:

- **The curator** brings research, context, art-historical training, physical examination — but writes one text, from one vantage point, shaped by what their institution/era considers important. Curatorial statements are often speculative, especially for old objects. They don't truly know what an artist/maker was thinking at the time, or the true intent.
- **The AIs** bring no context but many independent readings, no assumptions about what matters, sometimes noticing things a human skips because it's "obvious" or "not important enough to mention."

Neither is authoritative. They are complementary lenses. The curator's voice is not elevated above the AI's — both get the same visual treatment. Labeltext is just one card among peers, not a hero block.

### Loading behavior

AI Perspectives loads automatically on page view (option 1). Since it's now a peer to the curator's voice in the primary attention section, it should be present without friction — just as labeltext is simply *there* when it exists.

---

## Observations: feature-region tags

Region tags (`type: tag, feature: region`) from AWS Rekognition and Clarifai provide spatially-grounded detections — bounding boxes around specific things in the image. These were previously excluded from the perspectives pipeline.

### Integration approach (options 2+3 combined)

- Region tags are merged into the observations phrase map — they contribute to source counts and total counts (boosting ranking).
- A `spatially_detected` field is attached when region tags contribute, showing per-service bounding box instance counts.
- This adds a new dimension beyond "mentioned in text": "bounded in the image." The viewer knows not just that multiple AIs described a tree, but that services drew 3 boxes around trees.

### Why not include region tags in agreement concepts?

- Agreement concepts already ingests full-image tags + description noun phrases with consensus thresholds. Including region tags there would double-count.
- The NLP extraction (compromise.js) yields nothing richer than the tag itself for a single word like "Tree".
- Observations is the right home: no agreement threshold, broad inventory, and the spatial signal adds value here.

---

## Observation categories

Categories classify extracted phrases by checking tokens against seed sets. First match wins.

### Populating seeds

Best approach: **corpus-driven** — pull all distinct region-tag bodies from the annotation API, sort them into categories once. This guarantees coverage of terms that actually exist in the data with no wasted entries.

The `utilities/audit-observation-seeds.js` script automates this:
- Fetches all distinct `body` values where `type=tag AND feature=region`
- Classifies each against current category seeds
- Reports coverage stats and uncategorized terms sorted by frequency
- Writes a JSON report for further processing

Run periodically: `node utilities/audit-observation-seeds.js`

### Category decisions

- **Animals & Creatures** added as a separate category (not merged with People & Figures). A painting of a horse is categorically different from a portrait. "Figure" in museum usage almost always means a human or anthropomorphic form.
- Placed between People & Figures and Action & Gesture — keeps living subjects together before transitioning to actions.
- Remaining uncategorized terms (poster, monitor, whiteboard, food items) are reasonable "Other" bucket material for an art collection. No new categories needed yet.

### Classification fix

`categorizePhrase()` now checks the full phrase against seed sets before token-level matching. This allows multi-word seeds like `human face`, `honey bee`, `palm tree` to match correctly.

### Observation entries: expandable with snippets

Each observation entry is now individually expandable (same pattern as mood palette and agreement concepts). Clicking an entry reveals per-annotation snippets showing the sentence where that phrase was used, attributed to `Source — Model`. The layout mirrors mood palette: phrase left, source badges + count right-aligned, triangle arrow for expandable entries.

Categories remain collapsible at the group level; the click handler lives on the category header only (not the whole container) to prevent event bubbling from entry clicks collapsing the category.

---

## Concept detail: collapsed by default

The agreement concepts and thematic terms sections were visually dense. Each concept row now:

- **Collapsed**: shows concept text + badges + service/annotation count (one scannable line)
- **Expanded on click**: reveals variants ("Called: vase (Amazon), urn (Clarifai)") and example snippets

A small triangle arrow indicates expandability. The list reads as a compact inventory you can scan in seconds, drilling into whatever catches your attention.

---

## Data provenance: tracing computed insights back to sources

Every computed insight in Perspectives must be traceable to the specific annotation(s) it came from. This is a non-negotiable design principle — the system computes derived views but never obscures its sources.

### Snippet structure

All expandable entries (observations, mood palette, agreement concepts) carry a `snippets` array:

```json
{
  "source": "Mistral",
  "model": "Pixtral Large",
  "annotation_id": 94338579,
  "text": "The man has a red coat, a white shirt, and a dark cravat."
}
```

- **source** — the AI service provider (Anthropic, Google Gemini, Meta, etc.)
- **model** — the specific model's friendly name, mapped via `models.js` from the raw model ID
- **annotation_id** — the HAM API annotation ID, enabling direct lookup
- **text** — the sentence from which the phrase/term was extracted (capped at 160 chars)

### One snippet per annotation, not per source

A single source may have many descriptions (from different models). Each gets its own snippet. This matters because "Anthropic — Claude Sonnet 4" and "Anthropic — Claude Opus 4.5" are meaningfully different observers even though they share a provider.

### Synonym-aware snippet matching

Observations use synonym canonicalization (e.g., "crown", "headdress", "turban" → "hat"). The snippet search must use all forms when looking for a match — not just the canonical. `CANONICAL_TO_FORMS` maps each canonical to its full synonym set, and the snippet regex alternates all forms with optional inflection suffixes (`s|es|ed|ing|ly`).

Without this, entries like "hat" (canonicalized from "crown" in the text) would show zero snippets despite being mentioned in many descriptions.

### UI overflow pattern

When an entry has more than 5 snippets, only the first 5 render immediately. A "Show all N references" button reveals the rest. This prevents 20+ blockquotes from overwhelming the expanded view while still providing full access.

### Click event isolation

Observation entries are nested inside collapsible categories. The category header has its own click handler (`toggleObsCategory`). Entry click handlers must not bubble — the `onclick` is on the `.obs-category-toggle` div (the header), not the entire `.obs-category` container, so clicking entries inside the body doesn't collapse the category.

---

## Mood palette

### What it extracts

The mood palette captures *how* the AIs characterize an image's atmosphere, not *what* they identify in it. "Tree" is an observation; "serene" is a mood. "Woman holding a book" is descriptive; "sense of quiet contemplation" is interpretive. The mood palette lives in that second register.

### Extraction strategies (hybrid approach)

Three strategies work together because no single one catches everything:

1. **Seed vocabulary** (~130 adjectives) — curated words that express atmosphere/emotion. Catches common mood language reliably: serene, dramatic, haunting, intimate, luminous, etc. Weakness: only finds terms you anticipated.

2. **Pattern extraction** — regex patterns like "sense of [noun]", "evokes [noun]", "atmosphere of [noun]", "imbued with [noun]". Catches richer multi-word constructions that single-adjective matching misses. These often surface the most interesting readings ("sense of quiet dignity", "atmosphere of reverent contemplation").

3. **Snippet collection** — for every mood term found, the function searches sentences from each contributing annotation for one containing the term. Each snippet is attributed to a specific source + model pair with its annotation ID, providing full provenance back to the original description.

### Why no agreement threshold

Unlike agreement concepts (2+ services, 3+ annotations), the mood palette requires only `count >= 2` across all descriptions. Reasoning:

- Mood language is inherently less convergent than object identification. Five AIs will all say "tree" but may characterize the same scene as "peaceful", "contemplative", "idyllic", "serene", and "tranquil" — all valid, none identical.
- The palette is *summative*, not *consensus-seeking*. It answers: "collectively, how do the AIs characterize the feeling of this work?"
- Multi-source terms still float to the top via the sort order (source breadth first, then count).

### Page placement

Between "What the AIs noticed" (observations) and "Where AI services tend to agree" (agreement concepts). This follows the attention progression: inventory of what's there → characterization of how it feels → convergence points.

### Seed maintenance: `utilities/audit-mood-seeds.js`

The seed list needs periodic review because AI models evolve their vocabulary. The audit script uses transformers.js (`all-MiniLM-L6-v2`) to go beyond string matching:

1. **Corpus scan** — fetches description annotations from the API, finds which seeds actually appear and which are dead weight.
2. **Data-driven anchors** — embeds the top 60 corpus-confirmed seeds, clusters them with k-means (k=12). Each cluster represents a naturally-occurring region of mood space as defined by the corpus itself, not hand-picked phrases.
3. **Semantic discovery** — embeds all adjective/adj-noun phrases found in descriptions and scores them against the cluster centroids. Terms that embed near mood space but aren't in the seed list are surfaced as candidates.
4. **Pattern ranking** — embeds pattern-extracted phrases and ranks them by mood relevance, separating genuine mood constructions ("sense of foreboding") from structural matches that aren't expressive ("sense of scale").

The key design decision: anchors are derived from the data, not imposed. Earlier iterations used hand-written anchor phrases ("somber melancholy mood", "serene peaceful atmosphere") which biased discovery toward moods the author anticipated. K-means clustering of actual corpus seeds lets the data define what "mood space" looks like for this collection.

5. **Prefix discovery** — scans descriptions for all `[noun(s)] of [phrase]`, `[verb] [phrase]`, and `[participle] with [phrase]` constructions. Embeds each full phrase, scores against the mood centroid, then aggregates at the prefix level. A prefix whose completions consistently land in mood space is a strong candidate for `MOOD_PATTERN_PREFIXES`. Known prefixes are flagged; unknown ones with high average mood similarity become recommendations.

This makes the pattern prefix list data-driven too. Instead of guessing which frame constructions signal mood language, the script discovers them from what the AIs actually write. "Sense of" might be obvious, but "pervaded by" or "tinged with" might not be — the script surfaces them if their completions cluster in mood space.

### Full-corpus + incremental caching

The script supports processing the entire description corpus (10M+ records) efficiently through streaming and caching:

**Cache structure** (`utilities/mood-cache/`, gitignored):

| File | Contents | Size at scale |
|------|----------|---------------|
| `corpus.jsonl` | Raw descriptions, appended incrementally | ~12GB at 10M records |
| `corpus-meta.json` | Last fetch date, total records | ~200 bytes |
| `extractions.json` | Serialized Maps (seed/pattern/adj/prefix counts + processed IDs) | ~10MB |
| `embeddings.json` | Text→vector cache, persists between runs | ~45MB at 15K phrases |
| `anchors.json` | K-means centroids + seed list hash | ~18KB |

**What's cached vs re-run:**

- **Corpus fetch** — incremental. Only records with `createdate` after last run are fetched. Sorted ascending so the append-only JSONL stays consistent.
- **Extraction** — incremental. Each record's ID is tracked; already-processed records are skipped on re-read. Maps are additive (new records only add counts, never subtract).
- **Embeddings** — permanent. Once "graceful" is embedded, it's cached forever (same model = same vector). Threshold changes don't trigger re-embedding.
- **Anchors** — invalidated only when `MOOD_SEEDS` changes. A hash of the seed list is stored; if it matches, cached centroids are reused.
- **Scoring** — always re-run (fast: operates on cached embeddings, no model inference needed).

**Memory management:** Corpus is streamed line-by-line during extraction. Peak memory is ~500MB regardless of corpus size — the Maps grow with vocabulary (bounded at ~50K entries), not with record count.

**Vocabulary saturation:** After ~50K descriptions, ~95% of adjectives and patterns that will ever appear have been seen. The remaining records add frequency accuracy but rarely discover new terms. A sample run (`--pages 500`) catches nearly all vocabulary; full-corpus confirms frequency rankings.

**Usage:**

| Command | Effect |
|---------|--------|
| `node utilities/audit-mood-seeds.js` | Incremental: fetch new records, process, embed new candidates |
| `node utilities/audit-mood-seeds.js --full` | Full re-fetch: clear corpus cache, start from scratch |
| `node utilities/audit-mood-seeds.js --no-fetch` | Cached only: skip API, re-process from local corpus |
| `node utilities/audit-mood-seeds.js --no-embed` | Extraction only: skip transformers.js, report seed/pattern hits |
| `node utilities/audit-mood-seeds.js --threshold 0.60` | Adjust similarity cutoff (instant if embeddings cached) |
| `node utilities/audit-mood-seeds.js --pages 100` | Limit fetch to 100 pages (10K records) for quick sample |

**Typical workflow:**
1. First run with `--pages 500` (50K records) — 15–30 minutes, captures nearly all vocabulary
2. Subsequent runs with no flags — incremental, fetches only new records, processes in seconds
3. After adding seeds to `perspectives.js`, run `--no-fetch` — re-scores with new anchors, no API calls
4. Optional overnight: no flags with unlimited pages — fills out full corpus for frequency accuracy

Output sections:
- Current seed coverage (which seeds appear, which are dead weight)
- Pattern-extracted phrases (top by frequency)
- Data-driven anchor clusters (k-means groupings of corpus seeds)
- Prefix discovery (ranked prefixes, new prefix recommendations, top mood-relevant phrases)
- Semantic discovery (adjectives near mood space)
- Pattern phrases ranked by mood relevance
- Recommended seed additions
- **Copy-paste blocks** — single-quoted comma-separated lists ready to paste into `MOOD_SEEDS` and `MOOD_PATTERN_PREFIXES` in `perspectives.js`
- **Cache summary** — disk usage, record counts, embedding count

JSON report: `utilities/mood-seeds-audit.json`

---

## Future considerations

- **Collection-level co-occurrence analysis** — flagged for a later phase. Identify chains of synonyms/antonyms across the full tag vocabulary by analyzing which terms co-occur on the same images.
- **Image-level description/alttext** — present on some records, especially secondary images. Could be added to the curator card when labeltext is absent but these fields exist.
- **Keywords** — human-assigned subject terms. Coverage is sparse in the current dataset but would create a natural bridge between curatorial vocabulary and AI-generated tags if populated.
