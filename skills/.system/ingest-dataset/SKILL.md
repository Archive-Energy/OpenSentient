---
name: ingest-dataset
description: Generic dataset ingestion with pluggable source adapters.
  Supports HuggingFace, CSV, Parquet, JSON/JSONL, and URL endpoints.
  Lightweight formats run on the actor; heavy formats run in the sandbox.
runtime: actor
escalate_to: sandbox
trigger: ingest_dataset command or datasets config in sentient.jsonc
---

# Ingest — Dataset

Transforms structured data from multiple sources into signals or
positions for the knowledge graph.

## Source Adapters

| Source | Runtime | Library |
|--------|---------|---------|
| `huggingface` | Sandbox | `datasets` (Python) |
| `parquet` | Sandbox | `pyarrow` / `pandas` (Python) |
| `csv` | Actor | `Bun.csv()` native |
| `json` / `jsonl` | Actor | `Bun.file().json()` |
| `url` | Actor | `fetch` + auto-detect format |

## Output Modes

- **signals** — Each row becomes an `IngestSignal` flowing through the tension pipeline. Output: `dataset-signals.json`
- **positions** — Each row becomes a position written directly to knowledge/. Output: `dataset-positions.json`
- **analysis** — Sandbox agent loads dataset and applies Alethic Method, producing a standard `SessionSummary`. Output: `session-summary.json`

## Sandbox Execution (HuggingFace / Parquet)

```bash
python3 /workspace/skills/.system/ingest-dataset/loader.py \
  --source huggingface --uri "squad" --split "validation" \
  --mode signals --limit 100 --content-col "question" --credibility 0.7 \
  > /workspace/output/dataset-signals.json
```

## Column Mapping

Use `column_map` to rename source columns:

```json
{ "column_map": { "question": "content", "answer_score": "confidence", "id": "slug" } }
```

Special fields: `content_column` (main text), `label_column` (credibility/confidence).

## Configuration

```jsonc
"datasets": [
  { "source": "huggingface", "uri": "user/domain-data", "split": "train",
    "mode": "signals", "limit": 500, "content_column": "text",
    "credibility": 0.7, "schedule": "init" }
]
```

## Schedule

- `init` — Run once during Sentient initialization
- `daily` — Run during daily scan cycle
- `manual` — Only via API (`POST /sentient/run` with dataset config)

## Environment

`HF_TOKEN` — Required for private HuggingFace datasets (optional for public).
