# AI Explorer

[AI explorer](https://ai.harvardartmuseums.org) is a front-end for the Harvard Museums' data set of AI generated captions, descriptions, and tags. This is part of the museum's research in to using multiple AI computer vision services and large language models to interpret its art collections.

While the Harvard Art Museums began collecting AI generated data in 2016, the data was only publicly available through the [museum's API](https://hvrd.art/api). The AI website began development in June 2019 and launched in August 2019. This project was built in-house and is maintained by the department of Digital Infrastructure and Emerging Technology.

## Features

* Individual object data - see all annotations from 5 different AI computer vision services and more than 20 large language models for a particular artwork
* Search by keyword - a user-inputted keyword returns all artworks that were tagged with that word by AI services
* Search by category - returns all artworks sorted into 12 different broad categories by AI service Imagga
* Search by feature - returns all images sorted into groups by AWS Rekognition's feature detection
* Search by face - returns all faces found in all images

## Overview

The AI Explorer is an exploratory and educational website accessing the Harvard Art Museum's research data on how artificial intelligence views art. The website allows users to see how computer vision services Amazon Rekognition, Clarifai, Imagga, Google Vision, and Microsoft Cognitive Services interpret artworks in the Harvard Art Museums collection. Additionally, the site allows users to search by keyword in order to return artworks that were tagged by the AI services with that word.

## Term and Description Search

The search route (`/search/:term`) queries across both tag-type and description-type annotations. Each result card represents a single image and surfaces the following data:

### Confidence
Where available, a visual bar and label show the range of confidence scores across all sources that annotated the image with the search term. The bar spans from the minimum to maximum confidence value reported, giving a quick read of how consistently AI services agreed. Sources that don't report confidence (e.g. Clarifai tags) are excluded from the bar.

### Frequency
Two frequency values are shown per result:
- **Annotations** — how many individual annotations matched the search term for that image (e.g. `12 annotations`)
- **Uses** — how many times the term appears in the body text across those annotations (e.g. `~18 uses`). This is an approximation based on up to 75 returned annotation hits per image.

### Per-source breakdown
A compact table below each image lists each source and its confidence range (min–max). Sources that don't supply confidence show their annotation count instead.

### Filtering
Results can be filtered by source and, where available, by specific model within a source. Active filters are displayed inline with a dismiss link.

### Sorting
Results can be sorted by:
- **Confidence** (default) — images where the AI had the highest confidence in the search term appear first
- **Frequency** — images with the most matching annotations appear first

## CloudFront and WAF in front of Heroku

Use `ham-ai.herokuapp.com` as the HTTPS-only CloudFront origin, with origin path
blank. The default behavior must allow POST requests, redirect viewers to HTTPS,
use `CachingDisabled` during rollout, and use `AllViewerExceptHostHeader` to
preserve query parameters and cookies while routing to the correct Heroku app.
Enable WAF and explicitly switch rate limiting from monitor to blocking after
reviewing its threshold. WAF only filters traffic passing through CloudFront.

Add an origin custom header named `X-Origin-Verify` in CloudFront with a random
secret of at least 32 characters (32 random bytes or more is recommended). Keep
the value out of source control, browser code, and logs. Configure Heroku with:

| Config variable | Initial value |
| --- | --- |
| `CLOUDFRONT_ORIGIN_SECRET` | The same secret as the CloudFront origin header |
| `CLOUDFRONT_ORIGIN_MODE` | `monitor` |

Deploy the app with these settings before switching public DNS. With `monitor`,
all requests remain allowed, but matching origin headers authenticate the extra
CloudFront proxy hop for the app's per-visitor rate limiter. Direct requests keep
the existing one-hop Heroku behavior. Viewer-supplied forwarding prefixes are
ignored; IPv6 addresses retain the rate limiter's default /56 grouping. Keep
Express's global `trust proxy` setting at `1`; do not change it to `true` or `2`.
This assumes the origin path is CloudFront directly to the Heroku router.

The app logs `CloudFront origin: verified; mode=monitor` or `unverified` at most
once per outcome per minute per process. These are sampled confirmations, not
traffic counts. No header values are logged. Verify that CloudFront requests
produce `verified` before proceeding. Requests through the distribution's
assigned hostname can be tested before certificate or DNS changes.

After attaching the issued ACM certificate and `ai.harvardartmuseums.org` to the
distribution, switch the public DNS record to CloudFront. Wait at least the
previous DNS TTL from the time of the switch, verify normal traffic arrives
through CloudFront, then set `CLOUDFRONT_ORIGIN_MODE=enforce`. Missing or incorrect
headers now receive a non-cacheable 403 before redirects, body parsing, static
files, or routes. Test that the public site works and direct Heroku requests
return 403. Requests still reach Heroku's app process before rejection; this
does not provide a private origin or network-level isolation.

The default mode is `off`, which preserves the existing behavior. Unknown modes,
or enabled modes with secrets shorter than 32 characters, stop startup rather
than silently disabling protection. Config changes require a process restart
(Heroku restarts automatically when config vars change). To roll back public DNS
to Heroku, switch to `monitor` first. To rotate the secret without interrupting
traffic, switch to `monitor`, update both copies, confirm verified requests, then
return to `enforce`.

Route 53 can remain in a different AWS account. The certificate must be in the
CloudFront account in `us-east-1`; add its validation CNAME in the authoritative
public Route 53 hosted zone and retain it for renewal. Save the original website
DNS record for rollback and leave the origin pointing at the Heroku hostname.

## Heroku request protection

New expensive jobs are limited to 16 concurrent jobs per process by default.
`MAX_CONCURRENT_REQUESTS` retains its existing name but now sets the job limit,
not a global limit on visitors. Jobs include object metadata cache misses,
workspace/analysis cache misses, searches, feature/face/category browsing, text
analysis, statistics rendering, and the background statistics refresh. Metadata
loads finish before acquiring a workspace/analysis job, avoiding nested permits.
Each job may fetch multiple API resources in parallel.

Completed cache hits, Home, About, Explore, and redirects do not need a job slot.
Visitors sharing a cache miss consume only that loader's job slots. There is no
queue for new jobs: excess jobs receive a 503 response and `Retry-After: 5`.
Each cache separately allows at most 128 pending subscriptions across its keys;
set `MAX_CACHE_WAITERS` to a positive integer to adjust that cap. Internal cache
dependencies also count as subscriptions. Completed cache hits bypass the waiting
cap. This bounds waiting connections without blocking lightweight pages.

The per-IP limit still allows 120 dynamic requests per minute, including cached
pages and lightweight routes. Static assets bypass rate limiting. Set job and
waiting limits conservatively after observing memory and response times.

Museum API calls have a 10-second timeout, including downloading the body.
Dynamic requests and expensive jobs have 20-second deadlines. Completing or disconnecting aborts
their remaining API calls. API failures reach the Express error handler instead
of leaving rejected promises unhandled or reporting false empty search results.
Perspectives analysis runs in one reusable Node worker thread per web process,
so its text analysis does not block the web event loop. It uses the same
algorithm and cache as before. The worker allows one running analysis and one
waiting analysis per process, independently of `MAX_CONCURRENT_REQUESTS`.
Additional analyses receive the existing 503 response rather than occupying all
general job slots waiting for the same worker. Their API fetching still uses the
general job limit; this does not reserve slots during those fetches. Concurrent
visitors requesting the same analysis still share its single cached load.
The existing 20-second job deadline includes
time waiting for the worker. When all subscribers leave or the job expires, a
running analysis is terminated; a replacement worker starts for subsequent work.
Completed analyses reuse the worker. No additional service, dependency, or config
variable is required. Keep `MAX_CONCURRENT_REQUESTS=4` for the initial rollout.
Other synchronous work, including template rendering and JSON serialization,
still runs on the web thread and cannot be interrupted by these deadlines.

Search ranks images using count/confidence buckets, then fetches up to 75
annotation snippets for each of the 24 visible images. This keeps deep pages
from downloading snippets for every preceding page. Search supports pages 1–100;
invalid or unavailable pages return 404. Perspectives caching is limited to
1,000 entries and 16 MiB of serialized results (actual heap use is higher).

Object records, prepared image workspaces and Perspectives results are cached
for 12 hours by default. Set `CACHE_TTL_HOURS` to change this for all three caches
(for example, `12` for 12 hours, `1` for one hour, or `0.5` for 30 minutes).
Missing, invalid or nonpositive values fall back to 12 hours. The setting is read
when the server starts; restarting or deploying also clears these in-memory caches.
In Heroku, add it under Settings → Config Vars. Memory limits can evict entries
before expiry. Changing
an annotation link reuses the same workspace but selects that link's original
annotation separately. Concurrent requests for the same data share one load;
Perspectives requests also share one analysis computation. Each caller receives
an independent copy, so display processing cannot change another request's data.
Shared upstream work is cancelled when its last waiting request disconnects.
Failed loads are not cached. Optional image-record failures can leave a cached
workspace without those optional fields until its cache entry expires.

The object-record cache holds at most 100 entries and 4 MiB of serialized data;
the workspace cache holds at most 100 entries and 16 MiB. These bounds are in
addition to the Perspectives cache above. Each cache evicts least recently used
entries and skips results that exceed its byte limit. Dataset updates do not
automatically invalidate cached entries; expiry is measured from each entry's
creation rather than synchronized with dataset refreshes.

Run `npm run test:server` for request lifecycle, caching and search regression checks,
and `npm run test:research` for research workspace checks. After deployment,
monitor H12/H19 errors, memory, response times and 503s before raising concurrency.
An incident with R14 and heavy crawling also needs traffic controls at the proxy
or CDN; per-IP limits alone do not bound traffic spread across many addresses.

## AI Perspectives (Beta)

The selected image is the unit of analysis. `/object/:object_id/image/:image_id` provides Perspectives, Descriptions, Compare, Tags, and Other analyses in one workspace. Switching images changes the image and its annotations while retaining the active view. The associated object’s catalog metadata and wall label remain separate in the image sidebar.

Perspectives loads an overview of the selected image’s annotations. The radar defaults to **What models describe**, showing individual description outputs with model/provider, date, annotation ID, and word count. **What providers describe** pools vocabulary across each provider’s outputs. Search the selection list and choose series; switching views preserves each view’s choices. Both views share fixed AI-only axis scales. Expand a dimension’s evidence to inspect terms and supporting descriptions, then choose two outputs for inline comparison. The optional **Object wall label** is a dashed human reference about the object; overflow beyond AI maxima is explicitly marked. Shared vocabulary, concept families, mood, and thematic analysis remain expandable below the chart.

`perspectives.js` uses version `ace-v4.0.0`. Stage 3 changes the radar schema and excludes object-label vocabulary from AI normalization. Scoring weights and inclusion/level thresholds remain unchanged. The major version invalidates cached results.

### Stage 3 radar contract

- `coverage_radar.outputs` has one series per distinct nonempty description annotation. Repeated runs of the same model remain separate. Each output retains raw model ID, display name, provider, date, annotation ID, selected image ID, full annotation URL, and whitespace-delimited word count after Markdown cleanup.
- `coverage_radar.sources` contains AI provider unions only, with `output_count`, `model_count` (distinct nonempty model IDs), and total `word_count`. These are pooled breadth measures; they do not estimate a typical model’s attention.
- `max_per_dimension` is calculated from the complete AI provider unions for this image (`scale_basis: "complete_ai_provider_unions"`). Individual outputs and provider unions use the same denominator. Selecting/hiding series or switching views never changes it; changing images establishes a new comparison set.
- `reference` stores the object wall label separately. Raw counts and terms are retained. `normalized` is null when the AI maximum is zero; `exceeds_scale` records counts above the AI maximum. The UI clamps reference overflow to the boundary with an `!` marker and explanatory evidence text. The object label never increases AI maxima.
- Every dimension exposes raw counts, exact terms, and supporting annotation IDs. The comparison chooser requires exactly two distinct outputs, including two runs from the same provider/model if desired.
- Default selections are the first three available outputs/providers, not a ranking or recommendation. Search filters the unselected choices in “Add a series”; the legend shows selected series only. Word count supplies length context; no length normalization, numerical semantic distance, or concept-family pooling is introduced.

### Stage 2 vocabulary relationships

- `concepts` retains agreement scoring for exact normalized phrases and conservative equivalents (such as `hat`/`hats` and `watercolor`/`watercolour`). Surface forms remain available in `variants`.
- `concept_relationships` replaces `divergence_signals`. Each neighborhood has a `family`, `relationship: "shared_family"`, exact `terms`, and explicit `synonym_groups` with `relationship: "same_meaning"` for linguistic equivalents. These are curated browsing relationships, not a numerical distance or a specificity hierarchy.
- Each term retains distinct provider names, annotation IDs/counts, and all supporting excerpts with full source links. Full-image tags, region tags, and descriptions contribute; OCR and face records do not become concept claims. The UI exposes type and model in evidence.
- Families appear when at least two distinct vocabulary terms are observed, even within one provider. Family membership never increases agreement support. Unmapped words remain available in observations; absence from a family means the vocabulary has no relationship defined.
- The old incompatibility list is removed. Co-occurrence, relatedness, and omission do not establish contradictory claims. A family can contain contextually different uses of a word; inspect excerpts before interpreting their relationship.
- Radar extraction, provider pooling, scaling, thematic scoring, and mood thresholds are unchanged. Stage 3 adds model-level radar comparisons as described above.
- Review `SYNONYM_MAP` and `CONCEPT_FAMILIES` in `public/javascripts/perspectives.js` to adjust the explicit vocabulary. Comments identify the algorithm changes.

### Stage 1 evidence contract

- Stage 1 required distinct sources for the old divergence signals. Stage 2 supersedes that method with vocabulary relationships, as described above.
- Observations and mood entries expose `occurrences_count`, `annotations_count`, and `annotation_ids`. Observation occurrences count text matches plus region annotations; `description_annotations_count` and `region_annotations_count` distinguish their supporting records. `count` remains an alias for the occurrence count. The UI displays distinct annotation support.
- Radar and mood vocabulary match complete seed entries, including compounds such as `giant panda`; word boundaries prevent `man` from matching inside `woman`. Seed dictionaries and normalization formulas are unchanged.
- Agreement, thematic, observation, mood, and vocabulary-relationship examples contain match-centered excerpts, source, raw `model`, `display_model`, annotation ID, selected-image ID, and a URL to the complete source annotation. Unknown model identifiers are retained. Thematic entries retain their single `snippet` field and add structured `example_annotations`.
- Region-only, face-only, and OCR-only inputs return `ok` with their available observations/flags. `no_annotations` is reserved for inputs without any supported annotation types.
- `npm run test:research` covers the corrected cases, retained scoring behavior, evidence provenance, image selection, and rendering.

### What it computes

For a given image, the tool pulls all tag, description, face, and OCR annotations and runs five analyses:

**Agreement concepts** — noun-phrase concepts (1–3 tokens) extracted from tags and AI descriptions using [compromise.js](https://github.com/spencermountain/compromise). Markdown is stripped from description bodies before extraction. Concepts appearing in annotations from at least 2 distinct services and at least 3 annotation records are ranked by a scoring function that weights source breadth (60%) over annotation volume (40%), with log scaling to limit diminishing returns from a single prolific source. Each concept is typed as `descriptive` (visually observed features: `bridge`, `snow`, `crowd`) or `interpretive` (genre or iconographic readings: `portrait`, `altarpiece`, `vanitas`).

A **synonym map** normalizes conservative equivalents before aggregation. Distinct terms such as `vase`, `urn`, and `pitcher` retain separate support; their relationship is available in the vessel family. When linguistic variants are present, the panel shows the original word each service used.

**Thematic terms** — unigrams, bigrams, and trigrams extracted from long-form LLM descriptions only (Claude, GPT, Gemini, and others), scored by TF-IDF across all descriptions for the image. Terms appearing in descriptions from at least 2 distinct providers and at least 3 descriptions are ranked by source breadth weighted with average TF-IDF. Phrases containing a unigram that is itself subsumed by a higher-scoring phrase are suppressed to keep the output readable. These reflect conceptual and thematic content—subject matter, emotional register, narrative vocabulary—rather than observed features.

**Concept families** — exact vocabulary matched against curated families, exposed in “How descriptions relate.” Expand a family to explore its terms, then expand a term to inspect its supporting annotations. Terms can share a family without sharing a meaning; linguistic equivalents are identified separately.

**What the AIs noticed** — a broad extraction from LLM descriptions and feature-region tags with no agreement threshold. Noun chunks and adjective-noun compounds up to 5 tokens are extracted from descriptions, cleaned of markdown and parenthetical fragments. Feature-region tags (bounding-box detections from AWS Rekognition and Clarifai) are merged into the same phrase map, contributing to source counts and adding a `spatially_detected` field with per-service instance counts when present. Phrases are grouped into seven categories: People & Figures, Animals & Creatures, Action & Gesture, Objects & Artefacts, Setting & Space, Colour & Light, and Material & Technique (plus Other). Category classification checks the full phrase against seed sets first, then individual tokens — enabling multi-word seeds like `human face` and `palm tree`. Each phrase shows which sources mentioned it, how many times, and whether it was spatially grounded with bounding boxes. This section is designed for browsing and inventory rather than consensus-finding.

Category seeds are populated corpus-first: the `utilities/audit-observation-seeds.js` script pulls all distinct region-tag terms from the annotation API, classifies them against current seeds, and reports uncategorized terms for review. Run periodically to maintain coverage as new annotations are added.

**Mood palette** — expressive and interpretive language extracted from LLM descriptions using a hybrid approach. Unlike the other analyses (which focus on *what* is depicted), the mood palette captures *how* the AIs characterize atmosphere, feeling, and tone. Three extraction strategies work together:

1. *Seed vocabulary* — ~130 curated adjectives that express mood/atmosphere (serene, dramatic, haunting, intimate, etc.). Words appearing at least twice across descriptions are collected with per-source tracking.
2. *Pattern extraction* — regex patterns catch interpretive constructions: "sense of tranquility", "evokes stillness", "atmosphere of mystery", "imbued with warmth". Prefixes include `sense of`, `feeling of`, `atmosphere of`, `evokes`, `suggests`, `conveys`, `imbued with`, and others.
3. *Snippet evidence* — for each mood term, a source sentence is attached as expandable context showing the word in its original descriptive passage.

Results are ranked by source breadth (how many independent AIs used the term) then frequency. The section only appears when mood language is present. The mood palette sits between "What the AIs noticed" and "Where AI services tend to agree" in the page layout — observations establish what's there, mood characterizes how it feels, agreement identifies convergence.

Seed vocabulary and pattern lists are maintained with help from `utilities/audit-mood-seeds.js`, which uses [transformers.js](https://huggingface.co/docs/transformers.js) (`all-MiniLM-L6-v2`) for semantic enrichment. The script embeds the top corpus-confirmed seeds, clusters them with k-means to derive data-driven anchors representing regions of mood space, then scores unknown adjectives by cosine similarity to those anchors. This discovers expressive terms the seed list missed without relying on hand-picked anchor phrases.

**Summary flags** — `has_text` (OCR detected), `has_faces` with a full per-service spread (min/max/avg face count across reporting services, with per-service breakdown), and `depicts_people` (weak/strong) inferred from a people lexicon applied to tags and descriptions.

### Catalogue context

Every perspectives response includes a `catalogue` block drawn from the human record: title, classification, medium, culture, people, places, keywords, wall label text (`labeltext`), and the image-level `alttext` and `description` fields. The image fields are especially useful for secondary images (details, versos, alternate views) where the human cataloguer's focus may differ substantially from the AI's.

### JSON endpoint

The raw output is available as a JSON download or directly at:

```
GET /object/:object_id/perspectives
GET /object/:object_id/image/:image_id/perspectives
```

The second form targets a specific image within an object's image list. Results are cached in memory keyed on `objectid + imageid + algorithm_version` with a 12-hour TTL. The response is versioned (`algorithm_version: "ace-v4.x.x"`) following semver: patch for list/config changes, minor for scoring or extraction changes, major for schema changes. Current version: `ace-v4.0.0` (stage 3 individual outputs and AI-only radar scale).

### Configuration

All tuning parameters live in the `CONFIG` object at the top of `public/javascripts/perspectives.js`.

**Agreement concepts**

| Option | Default | Description |
|--------|---------|-------------|
| `min_services` | 2 | Minimum distinct services a concept must appear in to qualify |
| `min_annotations` | 3 | Minimum total annotation records a concept must appear in |
| `top_N` | 15 | Maximum concepts returned |
| `S_cap` | 5 | Service count cap for log-scaling (prevents one prolific source dominating) |
| `A_cap` | 20 | Annotation count cap for log-scaling |
| `w_services` | 0.6 | Weight given to source breadth in the ranking score |
| `w_annotations` | 0.4 | Weight given to annotation volume in the ranking score |
| `stronger_norm_services_min` | 0.6 | Normalized service threshold for upgrading `weak` depicts_people to `strong` |
| `stronger_norm_annotations_min` | 0.5 | Normalized annotation threshold for the same upgrade |

**Depicts people**

| Option | Default | Description |
|--------|---------|-------------|
| `people_services_min` | 2 | Minimum services needed to flag `depicts_people: weak` |
| `people_annotations_min` | 3 | Minimum annotations needed to flag `depicts_people: weak` |
| `strong_people_services` | 3 | Absolute service count threshold for `depicts_people: strong` |
| `strong_people_annotations` | 5 | Absolute annotation count threshold for `depicts_people: strong` |

**Thematic terms**

| Option | Default | Description |
|--------|---------|-------------|
| `thematic_min_sources` | 2 | Minimum distinct LLM providers a term must appear in |
| `thematic_min_descriptions` | 3 | Minimum description records a term must appear in |
| `thematic_top_N` | 15 | Maximum thematic terms returned |
| `thematic_S_cap` | 9 | Provider count cap for log-scaling thematic scores |

**Observations (What the AIs noticed)**

| Option | Default | Description |
|--------|---------|-------------|
| `observations_max_per_category` | 25 | Maximum phrases returned per category (7 categories + Other) |
| `observations_max_phrase_tokens` | 5 | Maximum tokens in an extracted noun phrase |

**Mood palette**

| Option | Default | Description |
|--------|---------|-------------|
| `mood_max` | 20 | Maximum mood terms returned |

### Design intent

Agreement does not mean correctness — multiple services noticing the same surface feature increases the chance something is worth a look, not that the description is accurate or art-historically meaningful. The panel is designed as a thinking aid for curators, cataloguers, and data wranglers: AI observations to follow up, ignore, or find generative. No automatic writes to the catalogue. Results are labeled Beta and the panel includes explicit notes on face detection limitations and English-only annotation handling.

The object page is organized around **attention** rather than source. Both the curator's voice (labeltext) and AI Perspectives occupy the same "Points of attention" section with equal visual weight — neither is presented as authoritative. Curatorial statements are often speculative, especially for old objects; AI observations are surface-level pattern matching. Both are entry points for looking. Concept details (variants, example snippets) are collapsed by default and expand on click, keeping the list scannable.

## Description Comparison Tool

The Compare view (`/object/:object_id/image/:image_id#compare`) places two descriptions side by side without leaving the image workspace. Open it from a description card or the radar’s supporting evidence. Legacy `/object/:object_id/image/:image_id/compare` links redirect to the inline view. Human image descriptions and object wall labels are explicitly labeled by scope.

### Selecting descriptions

Each dropdown is populated with every available description for the object, including:

- **Human-authored** entries — wall label text (`labeltext`) and image-level descriptions (`description`) from the Harvard Art Museums object record, when present
- **AI-generated** entries — long-form descriptions from all LLM sources (Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, Amazon Nova, Mistral, Qwen, Moonshot AI, Writer, Clarifai, Salesforce), one entry per model per date

Model names are resolved through a lookup table (`models.js`) that maps raw API model identifiers (e.g. `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) to human-readable labels (e.g. `Claude 3.5 Sonnet`).

### Word diff

Toggling "Show Diff" highlights word-level changes inline in each panel. Words present in A but not B are shown in red with strikethrough; words present in B but not A are shown in green. Computed using the [`diff`](https://github.com/kpdecker/jsdiff) library.

### Similarity metrics

Four similarity scores are computed and displayed as progress bars whenever the selection changes:

| Metric | Method |
|--------|--------|
| **TF-IDF similarity** | Cosine similarity of TF-IDF weighted term vectors. Rare shared words count more than common words like "the" or "a". |
| **Word overlap** | Jaccard-style metric: shared word tokens / total word tokens. Also reports shared, unique-to-A, and unique-to-B word counts. |
| **Sentence overlap** | Each sentence in A is matched to the closest sentence in B by word overlap. Reports how many sentences on each side have a sufficiently close match (threshold: 40% overlap). |
| **Semantic (MiniLM)** | Cosine similarity of sentence embeddings computed by `all-MiniLM-L6-v2` via [transformers.js](https://huggingface.co/docs/transformers.js). The model (~22 MB) is downloaded once and cached by the browser. This metric loads asynchronously after the others. |

### Key phrases

Below the similarity bars, the top-8 TF-IDF terms from each description are extracted and partitioned into three groups:

- **Shared** (gray) — significant terms appearing in both descriptions
- **Only in A** (blue) — terms distinctive to the first description
- **Only in B** (red) — terms distinctive to the second description

Common stopwords are excluded from phrase extraction.

### Information density

Each panel header includes per-description statistics:

| Stat | Definition |
|------|------------|
| **Lexical density** | Content words (non-stopwords) as a percentage of total words. Higher values indicate more substantive text. |
| **Vocab diversity** | Unique words / total words (type-token ratio). Low values suggest repetition. |
| **Specificity** | Words appearing exactly once / total words (hapax ratio). High values indicate highly specific detail. |
| **Avg sentence** | Mean words per sentence. |
| **Length** | Total word count. |

### Token usage

For AI-generated descriptions, a second stats row shows the token counts recorded when the annotation was created:

| Stat | Definition |
|------|------------|
| **Input tokens** | Tokens sent to the model (prompt + image encoding). |
| **Output tokens** | Tokens generated by the model. |
| **Total tokens** | Sum of input and output tokens. Shown only when both values are present. |

Token data is sourced from the `raw.usage` field on each annotation record. Both Bedrock field names (`inputTokens` / `outputTokens`) and OpenAI field names (`prompt_tokens` / `completion_tokens`) are normalized to a common shape. Human-authored entries have no token data and the row is omitted.

# Requirements

* NodeJS
* Harvard Art Museums API Key ([get one here](http://www.harvardartmuseums.org/collections/api))

## Installation
To get started with this project, use the following commands:

```
# Clone the repo to your git
git clone https://github.com/harvardartmuseums/ai-website.git

# Enter the folder that was created by the clone
cd ai-website

# Install node dependencies
npm install

# Create an .env file for your Harvard Art Museums API key
touch .env

# Add your personal API key to the .env file
echo "API_KEY = 000000-00000-00000-000000-000000" >> .env

# Build the vocabulary files (required before first run)
npm run build-vocab

# Start the program
npm start
```

### Vocabulary build

`npm run build-vocab` runs `vocab.js`, which queries the Harvard Art Museums annotation API and writes a set of static vocabulary files to `public/vocabularies/`:

| File | Contents |
|------|----------|
| `stats.js` | Total vocabulary sizes per source, list of all sources and models |
| `terms.js` | All tag terms with per-source breakdowns |
| `features.js` | Tags associated with region features |
| `descriptions.js` | All description-type annotation bodies |
| `people.js` | People names extracted from descriptions via NLP |
| `places.js` | Place names extracted from descriptions via NLP |
| `organizations.js` | Organization names extracted from descriptions via NLP |
| `text.js` | Text-type region annotation bodies |
| `terms-<source>.js` | Per-source tag vocabularies (one file per source) |

These files are loaded at server startup and used for autocomplete, the statistics page, and allowlist validation on search filters. Re-run `build-vocab` periodically to pick up new annotations added to the dataset.

### Statistics cache

On startup, the server fires a background query to the annotation API to fetch aggregated statistics (annotation counts, image coverage by source, annotation type breakdowns, date range). The result is stored in memory and reused by the `/statistics`, `/`, and `/about` routes — eliminating per-request API calls that were causing timeouts. After success, the next refresh is scheduled for 24 hours later. Failed attempts retry after 60 seconds, including failures during startup or when the job limit is full. Only one refresh runs at a time, and page visits do not trigger additional attempts. Existing successful data remains available during refreshes and after failures. Until the first successful load, `/statistics` returns 503. A timestamp of the last successful refresh is displayed at the bottom of the statistics page.

```json
{
  "info": { "totalrecords": "..." },
  "refreshed_at": "ISO timestamp",
  "aggregations": {
    "image_count": { "value": "..." },
    "date_stats": { "min_as_string": "...", "max_as_string": "..." },
    "by_source": {
      "buckets": [
        {
          "key": "source name",
          "doc_count": "...",
          "image_coverage": { "value": "...", "percentage": "..." },
          "by_type": { "buckets": [{ "key": "...", "doc_count": "..." }] },
          "by_model": { "buckets": [{ "key": "...", "doc_count": "..." }] }
        }
      ]
    },
    "by_type": {
      "buckets": [
        {
          "key": "type name",
          "doc_count": "...",
          "by_source": { "buckets": [{ "key": "...", "doc_count": "..." }] }
        }
      ]
    }
  }
}
```

## Acknowledgements

Supported by Harvard Art Museums' office of Digital Infrastructure and Emerging Technology
Designed and developed by [Marie Konopacki](https://www.mariekonopacki.com/)
