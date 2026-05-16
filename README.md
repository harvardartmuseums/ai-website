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
