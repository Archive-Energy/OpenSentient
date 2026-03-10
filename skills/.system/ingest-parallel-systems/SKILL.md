---
name: ingest-parallel-systems
description: Register Parallel Systems as a signal source. Webhook
  receives monitor events, normalizes to IngestSignal, enqueues on
  signals queue. Ingest layer of the Alethic Method. Install when
  your domain requires real-time event monitoring from Parallel Systems.
---

# Ingest — Parallel Systems

Registers a webhook at boot. Normalizes Parallel Systems monitor
events into IngestSignal shape. Actor never knows the source.

## Approach
Borrowed from channel-as-skill pattern. An ingest provider is a
skill that self-registers its HTTP endpoint at boot and produces
identical IngestSignal output regardless of upstream format.

## Process
1. Register POST /ingest/parallel-systems on Hono app at boot
2. Validate webhook signature (PARALLEL_SYSTEMS_WEBHOOK_SECRET)
3. Normalize payload -> IngestSignal
4. Enqueue on signals queue via Actor client
5. Return 200 — Actor handles async

## Signal Normalization
monitor_event.content  -> signal.content
monitor_event.priority -> signal.urgency (low|medium|high)
monitor_event.ts       -> signal.timestamp

## Output
IngestSignal on signals queue. Triggers tension evaluation.

## Environment
PARALLEL_SYSTEMS_API_KEY
PARALLEL_SYSTEMS_WEBHOOK_SECRET
