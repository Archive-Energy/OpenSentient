---
name: cost-calibration
description: Review the Sentient's cost model accuracy against actual
  measured costs. Compares predicted session costs to actual, analyzes
  triage accuracy, and recommends model switches or budget adjustments.
  Runs after initial calibration period (day 3), then weekly or on
  cost deviation >20%.
runtime: actor
trigger: scheduled_weekly | cost_deviation_threshold
layer: self-improvement
---

# Cost Calibration

Review and calibrate the Sentient's cost model against actual
measured costs.

## Purpose
The budget allocator uses estimated costs to decide how many sessions,
scans, and triage passes fit in the daily budget. This skill validates
those estimates against reality and recommends adjustments.

## Inputs
- Session cost records from cost_log table
- models.dev pricing data (cached)
- Triage classification history (from calibration table)
- Budget configuration from AGENTS.md
- Current cost profile (avg cost per session type)

## Process
1. Calculate actual avg cost per session type:
   - scan (embedding calls during tension evaluation)
   - triage (Actor skill calls for signal classification)
   - sandbox-contradiction (full sessions triggered by contradictions)
   - sandbox-new (full sessions triggered by new territory)
2. Compare to predicted costs from cost profile
3. If deviation > 20%, flag for review
4. Analyze triage accuracy:
   - What % of CONFIRM/UPDATE classifications later triggered
     contradictions in subsequent sessions?
   - High misclassification rate suggests triage is too aggressive
5. Check model efficiency via models.dev:
   - Are cheaper models available that produce similar quality?
   - Would a different Actor model improve triage accuracy?
6. Generate recommendations

## Output format (JSON)
```json
{
  "costProfile": {
    "triageAvg": 0.004,
    "scanAvg": 0.07,
    "sessionAvg": 0.18,
    "embeddingAvg": 0.001
  },
  "deviations": [
    {
      "type": "session",
      "predicted": 0.15,
      "actual": 0.18,
      "deviationPct": 20
    }
  ],
  "triageAccuracy": {
    "totalTriaged": 142,
    "confirmCorrect": 95,
    "confirmIncorrect": 8,
    "accuracyPct": 92
  },
  "recommendations": [
    "Session costs average $0.18, 20% above estimate. Updated cost profile.",
    "Triage accuracy at 92% — no adjustment needed."
  ],
  "surfaceAsProof": true
}
```

## Rules
- Never changes models or budget directly — always surfaces as proof
- Updated cost profile is written to Actor state automatically
- Recommendations above threshold surface for operator review
- All findings logged to session record
