# OpenSentient

An open protocol for deploying domain intelligence agents. Each agent — a **Sentient** — is a finite state machine that ingests signals, evaluates them against a knowledge graph, updates positions with calibrated confidence scores, and surfaces changes for human review.

Fork this repo. Configure your domain. Deploy. Your Sentient starts building expertise autonomously and asks you to verify what it finds.

## How it works

A Sentient runs a continuous loop:

1. **Signal arrives** — from a webhook, web search, scheduled scan, or human message
2. **Tension evaluation** — embedding similarity + domain relevance gate determines if the signal is novel enough to act on
3. **Session runs** — an agent session in a sandboxed environment applies the Alethic Method: signal evaluation, belief updating, contradiction synthesis, sensemaking
4. **Drain** — session results write atomically to the knowledge graph (markdown) and index (SQLite)
5. **Proof gate** — high-surprise position updates surface for human review via Telegram inline buttons; low-surprise updates auto-commit
6. **Calibration** — human accepts or rejects proofs, the Sentient learns from corrections

The knowledge graph is markdown files in `knowledge/`. It's the source of truth. SQLite is a fast index. The graph survives independently of the running process — it lives in git.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Actor (Rivet)                                      │
│  Durable state, workflow loop, queues, scheduling   │
│                                                     │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Tension   │→ │ Sandbox  │→ │ Drain            │ │
│  │ Evaluator │  │ Session  │  │ Proof Gate       │ │
│  └───────────┘  └──────────┘  │ Knowledge Write  │ │
│                               └──────────────────┘ │
├─────────────────────────────────────────────────────┤
│  Channels          │  API (Hono)                    │
│  Telegram (Grammy) │  /sentient/* HTTP + SSE        │
└─────────────────────────────────────────────────────┘
         │                        │
    ┌────┴────┐              ┌────┴────┐
    │ Owner   │              │ Clients │
    │ (human) │              │ (web)   │
    └─────────┘              └─────────┘
```

**Three model roles:**
- **Actor** (claude-haiku-4-5) — cheap, fast. Handles signal triage, channel communication, tension evaluation dispatch
- **Embedding** (baai/bge-m3) — vector similarity for tension scoring
- **Sandbox** (claude-opus-4-6 via OpenCode) — full reasoning sessions inside a Daytona sandbox

## Quickstart

```bash
# 1. Fork this repo

# 2. Configure
cp .env.example .env
# Add your API keys to .env

# 3. Edit AGENTS.md
# Set your domain, boundaries, and model config

# 4. Install and run
bun install
bun run dev
```

### Required keys

| Key | What it's for |
|-----|---------------|
| `ANTHROPIC_API_KEY` | Actor model (Haiku) |
| `EMBEDDING_API_KEY` | Embedding model (OpenRouter) |
| `HARNESS_KEY` | Sandbox model (OpenCode Zen) |
| `DAYTONA_API_KEY` | Sandbox compute |
| `TELEGRAM_BOT_TOKEN` | Calibration channel |

See `.env.example` for the full list including optional integrations.

## AGENTS.md

The single configuration file. YAML frontmatter defines the agent's identity, domain, models, session behavior, signal sources, and integrations. The markdown body below the frontmatter is the agent's system prompt — what the sandbox session reads at start.

```yaml
---
name: my-agent
domain:
  name: Solar Energy Economics
  description: |
    Residential solar installation economics, NEM policy,
    and battery storage ROI in California.
  boundaries:
    - NEM 3.0
    - California solar
    - LFP battery
models:
  actor:
    provider: anthropic
    key: ${ANTHROPIC_API_KEY}
    name: claude-haiku-4-5
  embedding:
    provider: openrouter
    key: ${EMBEDDING_API_KEY}
    name: baai/bge-m3
    dimensions: 1024
  sandbox:
    harness: opencode
    key: ${HARNESS_KEY}
    name: claude-opus-4-6
---

# Solar Energy Intelligence

You are a domain intelligence agent specializing in
California residential solar economics...
```

## Calibration

Calibration is how you teach the Sentient. When a session produces a position update with high surprise (the confidence shifted significantly), the Sentient surfaces it as a **proof of work** — a push notification on Telegram with three options:

- **Accept** — the position update commits at the proposed confidence. The Sentient's reasoning was sound.
- **Adjust** — you agree with the direction but not the magnitude. Set your own confidence (0.0-1.0). The position commits at your value. The delta between the Sentient's proposal and your override becomes calibration data — over time, the Sentient learns *how much* it's miscalibrated, not just *that* it is.
- **Reject** + note — the position reverts to prior confidence. Your correction becomes a credibility-1.0 signal that triggers a new session.

Over time, the Sentient's calibration-review skill audits whether its confidence scores match reality and proposes adjustments. The pattern of adjustments is richer signal than binary accept/reject — it reveals systematic over/underconfidence by sub-domain.

### Telegram commands

| Command | What it does |
|---------|-------------|
| `/start` | Initialize or show status |
| `/status` | Domain, session count, pending proofs |
| `/run [reason]` | Trigger a session manually |
| `/proofs` | List pending proofs |
| `/accept <slug> [confidence]` | Accept a proof, optionally at adjusted confidence |
| `/adjust <slug> <confidence>` | Accept with explicit confidence override |
| `/reject <slug> <note>` | Reject with correction |
| `/positions` | Top 5 positions by surprise delta |
| `/threshold <0-1>` | Adjust tension threshold |
| `/calibration` | Calibration state overview |

## The Alethic Method

Sessions apply four layers of reasoning, each implemented as a system skill:

1. **Signal Evaluation** — investigative. Assess source credibility, corroboration, motivation, specificity before a signal can move any position.
2. **Belief Updating** — Bayesian. Prior confidence + evidence weight = posterior confidence. Surprise delta measures how much the domain revealed.
3. **Contradiction Synthesis** — dialectical. When two positions contradict, find the synthesis rather than choosing sides. The contradiction is information.
4. **Sensemaking** — retrospective. What do the individual position updates mean together? Where is this domain moving?

Two self-improvement skills run on schedule:
- **Calibration Review** — are confidence scores accurate over time? Detects systematic bias.
- **Method Reflection** — is the methodology well-matched to the domain? Audits skill usage and blind spots.

## File structure

```
actor/
  index.ts              Rivet actor — workflow loop, state, events, queues
  types.ts              All type definitions and FSM enums
  schema.ts             SQLite schema
  inference.ts          Actor model (Haiku) calls, key/endpoint resolution
  tension.ts            Domain relevance gate, embeddings, cosine similarity
  materialize.ts        AGENTS.md parsing, harness config generation
  drain.ts              Session drain — proof gate, markdown + SQLite writes
  rebuild.ts            CLI: rebuild SQLite index from markdown

sandbox/
  index.ts              Daytona lifecycle + Sandbox Agent SDK
  events.ts             Agent event normalization

api/
  index.ts              Hono app, auth middleware, route registration
  sentient/
    get.ts              GET /sentient/status, /frontier, /calibration
    post.ts             POST /sentient/signal, /run, /correct, /config
    stream.ts           SSE /sentient/stream/events, /calibration
    knowledge.ts        GET /sentient/knowledge/* (serve markdown)
    calibration.ts      POST /sentient/calibration/* (full CalibrationAPI)

channels/
  telegram/
    bot.ts              Grammy bot, push notifications, event subscriptions
    commands.ts         Slash commands + inline button callbacks
    onboard.ts          Conversational AGENTS.md builder

skills/
  .system/              12 system skills (SKILL.md each)
    signal-evaluation/    Layer 1 — investigative
    belief-updating/      Layer 2 — Bayesian
    contradiction-synthesis/  Layer 3 — dialectical
    sensemaking/          Layer 4 — retrospective
    calibration-review/   Self-eval 1 — confidence calibration
    method-reflection/    Self-eval 2 — methodology audit
    knowledge-integrity/  Structural health check
    skill-finder/         Find external skills for capability gaps
    skill-writer/         Extract reusable skills from sessions
    validate-config/      Boot-time config validation
    add-telegram/         Channel reference implementation
    ingest-parallel-systems/  Webhook signal ingestion
    ingest-exa/           Web search signal polling
    git-workflow/         PR creation from session findings
  .curated/             Skills generated by the Sentient

knowledge/
  INDEX.md              Entry point — read before every session
  positions/            Position nodes (markdown + frontmatter)
  inquiries/            Open questions under investigation
  record/               Session records
  calibration/          Human calibration log

tests/
  drain.test.ts         Proof gate, commit/reject, markdown round-trip
  tension.test.ts       Cosine similarity, domain relevance gate
  materialize.test.ts   AGENTS.md parsing, key resolution, harness config
  validate-summary.test.ts  Session summary validation edge cases

AGENTS.md               Agent configuration (YAML frontmatter + system prompt)
CLAUDE.md               Development reference
Dockerfile              Sandbox container image
rivet.json              Rivet actor module registration
.env.example            All environment variables documented
```

## API

All routes are under `/sentient/` and require an API key via `x-api-key` header or `Authorization: Bearer` header.

### Read

```
GET  /sentient/status              Actor state, session count, domain
GET  /sentient/frontier            INDEX + top tensions + active inquiries
GET  /sentient/calibration         Pending proofs, thresholds, session count
GET  /sentient/knowledge/:path     Serve any knowledge/ file as markdown
GET  /sentient/stream/events       SSE — all actor events
GET  /sentient/stream/calibration  SSE — calibration events only
```

### Write

```
POST /sentient/signal              Ingest a signal (owner credibility 1.0)
POST /sentient/run                 Trigger a session
POST /sentient/correct/:slug       Correct a position directly
POST /sentient/config              Update thresholds, signal weights
```

### Calibration

```
POST /sentient/calibration/proof/:slug/accept              # { confidence?: 0.0-1.0 }
POST /sentient/calibration/proof/:slug/reject              # { note: "..." }
POST /sentient/calibration/tension/:slug/confirm
POST /sentient/calibration/tension/:slug/dismiss
POST /sentient/calibration/inquiry/:slug/promote
POST /sentient/calibration/inquiry/:slug/close
POST /sentient/calibration/settings/threshold
POST /sentient/calibration/settings/signal-weight
```

## Scripts

```bash
bun run dev             # Start with watch mode
bun run build           # Build for production
bun run test            # Run test suite (55 tests)
bun run check           # Biome lint + format check
bun run format          # Auto-format
bun run rebuild-index   # Rebuild SQLite from knowledge/ markdown
```

## Deploying a fork

1. Fork this repo
2. Edit `AGENTS.md` — set your domain, boundaries, model config
3. Add your keys (`.env` locally, or Codespaces/platform secrets)
4. Optionally add repos to the `repos:` block for PR creation
5. Deploy anywhere that runs Node/Bun — VPS, Railway, Fly.io, Codespaces
6. Register at [os.archive.energy](https://os.archive.energy) for a vanity domain and web calibration UI

## License

MIT
