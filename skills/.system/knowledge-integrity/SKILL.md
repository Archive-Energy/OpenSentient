---
name: knowledge-integrity
description: Structural health check for the knowledge graph. Audits
  wikilink resolution, stale positions, stuck inquiries, INDEX.md sync,
  and signal pipeline liveness. Run on demand via /health or weekly.
  Findings surface as inquiries — never modifies the graph directly.
  Covers the gap between validate-config (boot) and calibration-review
  (drift) — this skill checks whether the graph is structurally sound
  right now.
runtime: actor
---

# Knowledge Integrity

Structural health check for the live knowledge graph.

validate-config checks "can this Sentient boot?"
calibration-review checks "are my scores calibrated over time?"
knowledge-integrity checks "is my knowledge graph structurally sound right now?"

## When to Run
- On demand: /health command in Telegram
- Scheduled: weekly
- Triggered: after any session that produces > 5 position updates
  (high-volume sessions are most likely to create structural issues)

## Checks

### 1. Wikilink Resolution
Scan all .md files in knowledge/ for [[wikilinks]].
For each wikilink, verify the target file exists.
Orphaned wikilinks = broken references the agent will follow to nothing.

Output: orphaned_wikilinks[] with source file and target

### 2. INDEX.md Sync
Compare INDEX.md listed positions against actual files in positions/.
Compare INDEX.md listed inquiries against actual files in inquiries/.
Detect: positions in filesystem but missing from INDEX.md (invisible to agent).
Detect: positions listed in INDEX.md but deleted from filesystem (dead links).

Output: missing_from_index[], dead_index_links[]

### 3. Stale Positions
Find positions where updated_at is older than 30 days AND
surprise_delta was > 0.3 at last update (high-tension positions
that went cold without resolution).

Output: stale_positions[] with slug, last_updated, surprise_delta

### 4. Stuck Inquiries
Find inquiries with status: open AND created more than 14 days ago
with no session referencing them in record/.
These are questions the Sentient opened but never investigated.

Output: stuck_inquiries[] with slug, created_at, days_idle

### 5. Signal Pipeline Liveness
Check signals table for most recent entry.
If no signal received in > 48 hours: warn (pipeline may be dead).
If no signal received in > 7 days: alert (pipeline is dead).
Check each configured signal source separately:
  - parallel-systems: last webhook received?
  - exa: last poll result?
  - telegram: last message processed?

Output: pipeline_status per source, last_signal_at, alert_level

### 6. Position Consistency
For each position in SQLite, verify the markdown file exists.
For each position markdown file, verify a SQLite row exists.
Detect drift between the two representations.

Output: sqlite_only[], markdown_only[]

## Process
1. Run all 6 checks
2. For each finding: classify severity (info | warning | alert)
3. For alerts: open an inquiry if one doesn't already exist
4. For warnings: log to knowledge/calibration/ for trend detection
5. Write health report to knowledge/calibration/health-{date}.md
6. Return summary: checks_passed, warnings, alerts

## Output
checks_passed: number
warnings: FindingItem[]
alerts: FindingItem[]
health_report_path: string
new_inquiries_opened: string[]

## Key Constraint
knowledge-integrity NEVER modifies positions or inquiries directly.
It reads, checks, and reports. Alerts surface as inquiries.
The agent or human decides what to do about structural issues.
Automatic repair would mask problems — visibility is the goal.
