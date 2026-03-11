---
name: ingest-dataset
description: Ingest structured data from any source into the knowledge
  graph. Handles CSV, JSON, JSONL, URLs, HuggingFace, Parquet, and
  anything else — install what you need and parse it.
runtime: sandbox
trigger: ingest_dataset command or datasets config in sentient.jsonc
---

# Ingest — Dataset

Transform structured data from any source into signals or positions
for the knowledge graph.

## Task

You receive a dataset configuration as JSON context. Your job:

1. **Load the data** from the specified source and URI
2. **Parse rows** up to the configured `limit` (default 1000)
3. **Transform** each row into the output schema for the configured `mode`
4. **Write** the output JSON to the specified path

Install any dependencies you need. If the source is a HuggingFace
dataset, `pip install datasets` and use it. If it's Parquet, use
`pandas` or `pyarrow`. For CSV/JSON/JSONL/URL, use whatever is
fastest — Python, Node, or shell tools.

## Input

Dataset config is written to `/workspace/output/dataset-request.json`:

```json
{
  "source": "csv",
  "uri": "knowledge/seed-data.csv",
  "mode": "signals",
  "limit": 500,
  "content_column": "text",
  "label_column": "confidence",
  "credibility": 0.7
}
```

### Source types

Any string is valid. Common sources:

| Source | Example URI | Approach |
|--------|-------------|----------|
| `csv` | `knowledge/data.csv` | Read file, parse CSV |
| `json` | `knowledge/data.json` | Read file, parse JSON array |
| `jsonl` | `knowledge/data.jsonl` | Read file, one JSON per line |
| `url` | `https://api.example.com/data.json` | Fetch URL, auto-detect format |
| `huggingface` | `squad` or `user/dataset-name` | `pip install datasets && python3 -c ...` |
| `parquet` | `knowledge/data.parquet` | `pip install pandas pyarrow && python3 -c ...` |

For unknown source types, interpret the source string and URI as
best you can. The operator chose this source for a reason.

### Column mapping

- `content_column` — which column to use as the main text. If not
  set, try `text`, `content`, `body`, `description` in order.
  Fall back to the first string column.
- `label_column` — which column maps to confidence (0.0-1.0). If
  not set, use the `credibility` default from config.

## Output modes

### `signals` mode

Write to `/workspace/output/dataset-signals.json`:

```json
{
  "source": "csv:knowledge/seed-data.csv",
  "rowsProcessed": 500,
  "signals": [
    {
      "id": "dataset-<uuid>",
      "sourceProvider": "dataset",
      "sourceMode": "batch",
      "content": "The extracted text content",
      "urgency": "medium",
      "credibility": 0.7,
      "timestamp": 1234567890,
      "metadata": { "datasetSource": "csv", "datasetUri": "knowledge/seed-data.csv", "rowIndex": 0 }
    }
  ]
}
```

### `positions` mode

Write to `/workspace/output/dataset-positions.json`:

```json
{
  "source": "csv:knowledge/seed-data.csv",
  "rowsProcessed": 500,
  "positions": [
    {
      "slug": "descriptive-slug-from-content",
      "text": "The position text",
      "confidence": 0.7,
      "surpriseDelta": 0,
      "priorConfidence": 0,
      "status": "settled"
    }
  ]
}
```

Generate slugs from content: lowercase, replace spaces with hyphens,
strip punctuation, truncate to 60 chars. Ensure uniqueness by
appending row index if needed.

## Error handling

If the data cannot be loaded (bad URL, missing file, auth failure),
write an error file to `/workspace/output/dataset-error.json`:

```json
{
  "source": "huggingface:user/private-dataset",
  "error": "401 Unauthorized — set HF_TOKEN in .env for private datasets"
}
```

## Environment

- `HF_TOKEN` — Available if set in `.env`. Use for private HuggingFace datasets.
- `GITHUB_TOKEN` — Available if set. Use for private GitHub-hosted data.
- You have full shell access. Install what you need.
