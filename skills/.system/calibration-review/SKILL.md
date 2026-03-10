---
name: calibration-review
description: Evaluate whether confidence scores are calibrated against
  actual outcomes. Self-improvement Layer 1 — runs on schedule or after
  N record sessions. Reads calibration log and record to detect
  systematic over/underconfidence. Proposes adjustments autonomously.
  Numerical confidence adjustments commit automatically. Methodology
  changes surface as inquiries for human review.
---

# Calibration Review

Self-improvement Layer 1 of the Alethic Method.

Positions accumulate confidence scores. Calibration review asks:
were those scores accurate? A Sentient confident at 0.9 should be
right about 90% of the time. Systematic deviation is a signal.

## When to Run
- Scheduled: weekly or after every 10 record sessions
- Triggered: when calibration log shows repeated human overrides
  of the same type

## Process
1. Read knowledge/calibration/*.md — what did humans correct?
2. Read knowledge/record/*.md — where did sessions produce
   high surprise_delta that was later contradicted?
3. Compute calibration curve: confidence bins vs actual accuracy
4. Identify systematic bias:
   - "positions about regulatory signals rated 0.2 too high"
   - "signals from source X consistently dismissed by owner"
5. For each bias found:
   - If numerical: propose confidence adjustments to positions
   - If source-based: propose signal_weight adjustment to AGENTS.md
   - If methodological: open an inquiry for human review
6. Write calibration-review session to knowledge/calibration/

## Output
calibration_curve
systematic_biases[]
proposed_adjustments[]    — numerical, commits autonomously
proposed_inquiries[]      — methodological, surfaces for human review

## Alethic Role
The uncovering process itself must be calibrated. If the Sentient
is systematically overconfident in a sub-domain, it is concealing
uncertainty rather than uncovering it. This layer detects that.

## Key Constraint
Numerical adjustments (confidence recalibration, signal weight tuning)
can commit autonomously — they are mechanical corrections.
Methodology changes (skill modifications, domain boundary changes)
surface as inquiries — these require human judgment.
