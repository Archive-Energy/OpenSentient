---
name: ingest-exa
description: Register Exa web search as a polling signal source.
  Polls Exa on session schedule for domain-relevant content, normalizes
  results to IngestSignal, enqueues on signals queue. Install when
  your domain requires web signal coverage beyond structured monitoring.
---

# Ingest — Exa

Polls Exa web search on the Actor's daily schedule. Surfaces
domain-relevant content the structured monitors miss. Normalizes
results into IngestSignal shape.

## Approach
Polling rather than webhook — Exa is queried at session trigger time,
not pushed. Domain queries derived from AGENTS.md domain.description
and current high-tension positions (frontier context).

## Process
1. At session trigger: read frontier -> extract domain query terms
2. POST exa.search with neural query + domain constraints
3. Filter results by relevance score threshold
4. For each result above threshold: normalize -> IngestSignal
5. Enqueue all signals -> tension evaluation runs across batch
6. Deduplicate against signals seen in last 7 days

## Signal Normalization
exa_result.title + summary -> signal.content
exa_result.score           -> signal.urgency (threshold-derived)
exa_result.publishedDate   -> signal.timestamp

## Query Construction
Base query from: AGENTS.md domain.description
Augmented with: top 3 positions by surprise_delta
Constrained by: AGENTS.md domain.boundaries

## Output
Batch of IngestSignals on signals queue before session begins.
Enriches session context with web signal coverage.

## Environment
EXA_API_KEY
