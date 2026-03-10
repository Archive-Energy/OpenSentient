# OpenSentient Development

## Architecture
OpenSentient is a factory protocol for deploying domain intelligence agents (Sentients).
Each Sentient is a finite state machine backed by Rivet for durable state and workflows.

## Key Files
- `actor/index.ts` — Main Rivet Actor: workflow loop, actions, events, queues
- `actor/types.ts` — All type definitions, FSM enums, constants
- `actor/schema.ts` — SQLite schema (positions, inquiries, record, signals, calibration)
- `actor/tension.ts` — Domain relevance gate + embedding-based tension evaluation
- `actor/inference.ts` — Actor model (Haiku) inference, key resolution
- `actor/materialize.ts` — AGENTS.md parsing, harness config generation
- `actor/drain.ts` — Session drain: proof gate, markdown + SQLite atomic writes
- `sandbox/index.ts` — Daytona lifecycle + Sandbox Agent SDK
- `sandbox/events.ts` — Agent event normalization
- `api/` — Hono HTTP server with auth, SSE, knowledge serving
- `channels/telegram/` — Grammy bot, commands, onboarding
- `knowledge/` — Markdown knowledge graph (positions, inquiries, record, calibration)
- `skills/.system/` — 11 system skills (Alethic Method + meta + ingest + channel)

## Commands
- `bun run dev` — Start with watch mode
- `bun run build` — Build for production
- `bun run rebuild-index` — Rebuild SQLite from markdown
- `bun run check` — Biome lint/format check
- `bun run format` — Auto-format

## Conventions
- AGENTS.md frontmatter is the single config source. `.env` holds only secrets.
- Knowledge graph markdown is source of truth. SQLite is a fast index only.
- All model config uses `${VAR_NAME}` references resolved from `.env` at runtime.
- No hardcoded endpoints, model names, or keys in TypeScript.
- Drain writes markdown first, then SQLite atomically.
- High surprise_delta positions surface as proofs for human review.
- Low surprise_delta positions auto-commit.
