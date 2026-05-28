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

## AI Perspectives (Beta)

The AI Perspectives panel (`/object/:id/perspectives`) surfaces where multiple AI services notice similar things in an artwork—and where they diverge—and provides a broad, categorized index of everything the AI descriptions collectively noticed. It is accessible from the object page, loaded on demand.

### What it computes

For a given image, the tool pulls all tag, description, face, and OCR annotations and runs four separate analyses:

**Agreement concepts** — noun-phrase concepts (1–3 tokens) extracted from tags and AI descriptions using [compromise.js](https://github.com/spencermountain/compromise). Markdown is stripped from description bodies before extraction. Concepts appearing in annotations from at least 2 distinct services and at least 3 annotation records are ranked by a scoring function that weights source breadth (60%) over annotation volume (40%), with log scaling to limit diminishing returns from a single prolific source. Each concept is typed as `descriptive` (visually observed features: `bridge`, `snow`, `crowd`) or `interpretive` (genre or iconographic readings: `portrait`, `altarpiece`, `vanitas`).

A **synonym map** normalizes variant terms to a canonical form before aggregation — `vase`, `urn`, and `pitcher` all count toward the `vessel` concept. When multiple variants are present, the panel shows which specific word each service used, making vocabulary diversity visible: "Called: vase (Amazon, Google), urn (Clarifai), pitcher (Microsoft)."

**Thematic terms** — unigrams, bigrams, and trigrams extracted from long-form LLM descriptions only (Claude, GPT, Gemini, and others), scored by TF-IDF across all descriptions for the image. Terms appearing in descriptions from at least 2 distinct providers and at least 3 descriptions are ranked by source breadth weighted with average TF-IDF. Phrases containing a unigram that is itself subsumed by a higher-scoring phrase are suppressed to keep the output readable. These reflect conceptual and thematic content—subject matter, emotional register, narrative vocabulary—rather than observed features.

**Divergence signals** — cross-service disagreements from a configurable incompatibility list: pairs of concepts (e.g. `indoor`/`outdoor`, `sacred`/`secular`, `living`/`dead`, `portrait`/`landscape`) where different services reached opposing conclusions about the same image. The list covers setting, light and time, figure and subject, mood and register, genre, medium, and compositional oppositions. Signals are only fired when both terms in a pair are independently present in the extracted concepts.

**What the AIs noticed** — a broad, unconstrained extraction from LLM descriptions with no agreement threshold. Noun chunks and adjective-noun compounds up to 5 tokens are extracted, cleaned of markdown and parenthetical fragments, and grouped into six categories: People & Figures, Action & Gesture, Objects & Artefacts, Setting & Space, Colour & Light, and Material & Technique (plus Other). Each phrase shows which sources mentioned it and how many times. This section is designed for browsing and inventory rather than consensus-finding.

**Summary flags** — `has_text` (OCR detected), `has_faces` with a full per-service spread (min/max/avg face count across reporting services, with per-service breakdown), and `depicts_people` (weak/strong) inferred from a people lexicon applied to tags and descriptions.

### Catalogue context

Every perspectives response includes a `catalogue` block drawn from the human record: title, classification, medium, culture, people, places, keywords, wall label text (`labeltext`), and the image-level `alttext` and `description` fields. The image fields are especially useful for secondary images (details, versos, alternate views) where the human cataloguer's focus may differ substantially from the AI's.

### JSON endpoint

The raw output is available as a JSON download or directly at:

```
GET /object/:object_id/perspectives
GET /object/:object_id/image/:image_id/perspectives
```

The second form targets a specific image within an object's image list. Results are cached in memory keyed on `imageid + algorithm_version` with a 12-hour TTL. The response is versioned (`algorithm_version: "ace-v1.x.x"`) following semver: patch for list/config changes, minor for scoring or extraction changes, major for schema changes. Current version: `ace-v1.4.0`.

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

**Divergence signals**

| Option | Default | Description |
|--------|---------|-------------|
| `max_divergence` | 5 | Maximum number of divergence signals returned |

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
| `observations_max_per_category` | 25 | Maximum phrases returned per category |
| `observations_max_phrase_tokens` | 5 | Maximum tokens in an extracted noun phrase |

### Design intent

Agreement does not mean correctness — multiple services noticing the same surface feature increases the chance something is worth a look, not that the description is accurate or art-historically meaningful. The panel is designed as a thinking aid for curators, cataloguers, and data wranglers: AI observations to follow up, ignore, or find generative. No automatic writes to the catalogue. Results are labeled Beta and the panel includes explicit notes on face detection limitations and English-only annotation handling.

## Description Comparison Tool

The comparison tool (`/compare/:object_id`) lets you place two descriptions side-by-side and analyze how they differ. It is accessible from the "Compare" link in the Captions section of any object page.

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

On startup, the server fires a background query to the annotation API to fetch aggregated statistics (annotation counts, image coverage by source, annotation type breakdowns, date range). The result is stored in memory and reused by the `/statistics`, `/`, and `/about` routes — eliminating per-request API calls that were causing timeouts. The cache refreshes automatically every 24 hours. If the refresh fails, the server continues serving the last successful result. A timestamp of the last successful refresh is displayed at the bottom of the statistics page.

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
