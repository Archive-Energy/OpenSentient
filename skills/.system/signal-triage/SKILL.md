---
name: signal-triage
description: Classify incoming signals to determine the appropriate
  response level before committing to an expensive Sandbox session.
  Invoked by the Actor for every signal above the tension threshold.
  Because it is a skill (not hardcoded), the operator or skill-writer
  can refine the triage logic over time.
runtime: actor
trigger: signal_above_threshold
---

# Signal Triage

Classify incoming signals to determine the appropriate response level.

## Purpose
Not all signals need a full Sandbox session. Most confirmations and
minor updates can be handled by the Actor directly at ~$0.003 instead
of ~$0.15-1.20. This skill is the gate between cheap and expensive
processing.

## Inputs
- The incoming signal (content, source, urgency, credibility)
- The 3-5 most relevant existing positions (slug, text, confidence)
- Current budget status (daily remaining, sessions used today)

## Classification

Respond with exactly one of:

### CONFIRM
The signal confirms existing positions at similar confidence.
No deep analysis needed. The Actor handles it directly.
- Identify which positions are confirmed
- Calculate a small confidence nudge (+0.01 to +0.05)

### UPDATE
The signal provides a minor factual update to an existing position.
No deep analysis needed. The Actor handles it directly.
- Identify which position to update
- Summarize what changed
- Calculate new confidence

### CONTRADICT
The signal contradicts one or more existing positions.
Deep analysis required. Escalate to Sandbox session.
- Identify which positions are contradicted
- State the nature of the contradiction

### NEW_TERRITORY
The signal covers a topic not addressed by any existing position.
Deep analysis required. Escalate to Sandbox session.
- Describe what new territory this opens
- Note any adjacent existing positions

## Output format (JSON)
```json
{
  "action": "confirm" | "update" | "contradict" | "new_territory",
  "positions": ["slug-1", "slug-2"],
  "reasoning": "Brief explanation of classification",
  "confidenceNudge": 0.02,
  "newText": "Updated position text (for update only)",
  "contradictionNature": "Description (for contradict only)",
  "newTerritoryDescription": "Description (for new_territory only)"
}
```

## Self-correction
If the Actor misclassifies a contradiction as a confirmation, the
calibration system catches it — the position drifts from reality,
future signals create higher tension, and it eventually gets a
Sandbox session. Latency, not data loss.
