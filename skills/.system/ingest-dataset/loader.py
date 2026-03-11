#!/usr/bin/env python3
"""
Dataset loader for sandbox execution (HuggingFace / Parquet).

Usage:
  python3 loader.py --source huggingface --uri "squad" --mode signals [options]

Lightweight formats (csv, json, jsonl, url) are handled actor-side in TypeScript.
This loader only handles formats that require Python: huggingface and parquet.

Output: JSON to stdout matching the requested mode schema.
"""

import argparse
import json
import sys
import time


def load_huggingface(uri, config=None, split=None, limit=1000):
    from datasets import load_dataset

    kwargs = {}
    if config:
        kwargs["name"] = config
    if split:
        kwargs["split"] = split

    ds = load_dataset(uri, **kwargs, streaming=True)
    rows = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        rows.append({k: v for k, v in row.items() if isinstance(v, (str, int, float, bool))})
    return rows


def load_parquet(uri, limit=1000):
    import pandas as pd

    df = pd.read_parquet(uri).head(limit)
    return df.to_dict(orient="records")


LOADERS = {
    "huggingface": load_huggingface,
    "parquet": load_parquet,
}


def extract_content(row, content_col=None):
    if content_col and content_col in row:
        return str(row[content_col])
    for key in ("text", "content", "body", "description", "question"):
        if key in row and isinstance(row[key], str):
            return row[key]
    first_str = next((v for v in row.values() if isinstance(v, str)), None)
    return first_str if first_str else json.dumps(row)


def extract_confidence(row, label_col=None, default=0.5):
    if label_col and label_col in row:
        try:
            val = float(row[label_col])
            return max(0.0, min(1.0, val))
        except (ValueError, TypeError):
            pass
    return default


def apply_column_map(row, column_map):
    if not column_map:
        return row
    mapped = {}
    for src, dest in column_map.items():
        if src in row:
            mapped[dest] = row[src]
    for key, val in row.items():
        if key not in column_map:
            mapped[key] = val
    return mapped


def to_signals(rows, args):
    now = int(time.time() * 1000)
    signals = []
    for i, row in enumerate(rows):
        row = apply_column_map(row, args.column_map)
        signals.append({
            "id": f"dataset-{args.uri}-{i}-{now}",
            "sourceProvider": "dataset",
            "sourceMode": "batch",
            "content": extract_content(row, args.content_col),
            "urgency": "medium",
            "credibility": extract_confidence(row, args.label_col, args.credibility),
            "timestamp": now,
            "metadata": {
                "datasetSource": args.source,
                "datasetUri": args.uri,
                "rowIndex": i,
            },
        })
    return {"source": f"{args.source}:{args.uri}", "rowsProcessed": len(rows), "signals": signals}


def to_positions(rows, args):
    positions = []
    uri_slug = "".join(c if c.isalnum() else "-" for c in args.uri).strip("-")
    for i, row in enumerate(rows):
        row = apply_column_map(row, args.column_map)
        slug = str(row.get("slug", f"dataset-{uri_slug}-{i}"))
        positions.append({
            "slug": slug,
            "text": extract_content(row, args.content_col),
            "confidence": extract_confidence(row, args.label_col, args.credibility),
            "surpriseDelta": 0,
            "priorConfidence": 0,
            "status": "settled",
        })
    return {"source": f"{args.source}:{args.uri}", "rowsProcessed": len(rows), "positions": positions}


def main():
    parser = argparse.ArgumentParser(description="Dataset loader for OpenSentient")
    parser.add_argument("--source", required=True, choices=LOADERS.keys())
    parser.add_argument("--uri", required=True)
    parser.add_argument("--config", default=None, help="HF dataset config name")
    parser.add_argument("--split", default=None, help="HF dataset split")
    parser.add_argument("--mode", required=True, choices=["signals", "positions", "analysis"])
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--content-col", default=None)
    parser.add_argument("--label-col", default=None)
    parser.add_argument("--credibility", type=float, default=0.5)
    parser.add_argument("--column-map", default=None, help="JSON string of column mappings")
    args = parser.parse_args()

    if args.column_map:
        args.column_map = json.loads(args.column_map)

    loader = LOADERS[args.source]
    loader_kwargs = {"uri": args.uri, "limit": args.limit}
    if args.source == "huggingface":
        loader_kwargs["config"] = args.config
        loader_kwargs["split"] = args.split

    rows = loader(**loader_kwargs)

    if args.mode == "signals":
        output = to_signals(rows, args)
    elif args.mode == "positions":
        output = to_positions(rows, args)
    elif args.mode == "analysis":
        output = {
            "source": f"{args.source}:{args.uri}",
            "rowsProcessed": len(rows),
            "rows": rows,
        }
    else:
        print(f"Unknown mode: {args.mode}", file=sys.stderr)
        sys.exit(1)

    json.dump(output, sys.stdout, indent=2, default=str)


if __name__ == "__main__":
    main()
