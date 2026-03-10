---
name: ingest-parallel
description: Register Parallel as the default signal source using both
  Monitor API (continuous push-based monitoring) and Task API (on-demand
  deep research). Normalizes events to IngestSignal and enqueues on the
  signals queue. Replaces ingest-exa and ingest-parallel-systems.
runtime: actor
---

# Ingest — Parallel

Unified signal ingestion using Parallel's two APIs. Push-based
monitoring for continuous domain surveillance, on-demand research
for knowledge gap investigation.

## Monitor API — Continuous Signal Ingestion

Registers a webhook at boot. Parallel monitors the web for
domain-relevant changes and pushes events.

### Setup
1. On deploy, create a Parallel Monitor from domain description
2. Set frequency from `session.scan_interval_hours` (e.g., "1d", "1h")
3. Register POST /ingest/parallel on Hono app
4. Validate webhook signature (PARALLEL_WEBHOOK_SECRET)

### Signal Normalization
monitor_event.content  -> signal.content
monitor_event.priority -> signal.urgency (low|medium|high)
monitor_event.ts       -> signal.timestamp
sourceProvider         -> "parallel"
sourceMode             -> "webhook"

### Process
1. Receive webhook POST from Parallel Monitor API
2. Validate signature
3. Normalize payload -> IngestSignal
4. Enqueue on signals queue via Actor client
5. Return 200 — Actor handles async

## Task API — On-Demand Deep Research

Used during sessions when a knowledge gap is identified.
Actor skill chooses processor tier based on budget.

### Processor Tiers
- `base` — cheap scan, fast results (~$0.01)
- `core` — standard depth (~$0.05)
- `ultra` — deep investigation (~$0.15)

### Process
1. Skill identifies knowledge gap during session
2. Construct research query from gap + existing positions
3. Call Parallel Task API with structured input
4. Receive findings with citations + confidence
5. Normalize to IngestSignal with high credibility
6. Enqueue for tension evaluation

### Signal Normalization (Task API)
task_result.findings[]   -> signal.content (one signal per finding)
task_result.confidence   -> signal.credibility
task_result.citations    -> signal.metadata.citations
sourceProvider           -> "parallel"
sourceMode               -> "poll"

## Output
IngestSignal on signals queue. Triggers tension evaluation.

## Environment
PARALLEL_API_KEY
PARALLEL_WEBHOOK_SECRET
