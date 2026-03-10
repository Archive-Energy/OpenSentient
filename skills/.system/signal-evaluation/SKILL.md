---
name: signal-evaluation
description: Evaluate incoming signals for credibility, corroboration,
  and relevance before updating any position. Layer 1 of the Alethic
  Method — the investigative layer. Apply to every IngestSignal before
  tension evaluation. A signal is not evidence until it passes this layer.
runtime: actor
---

# Signal Evaluation

The investigative layer of the Alethic Method.

Before any signal can create tension against a position, it must be
evaluated. Raw signals are noise. Credible signals are evidence.

## Approach
Borrowed from investigative journalism and intelligence analysis.
Evaluate source, corroboration, motivation, and specificity before
allowing a signal to move any position.

## Process
1. Source credibility — who is saying this and why?
2. Corroboration — is anything else saying the same thing?
3. Contradiction — does this conflict with other signals?
4. Motivation — who benefits if this is believed?
5. Specificity — vague signals score lower than specific ones
6. Recency — how fresh is this signal?

## Output
signal_credibility_score (0-1)
corroboration_count
contradicting_signals[]
recommended_tension_weight

## x402-Acquired Signals (v0.2)
Signals purchased from other Sentients via x402 get different
credibility weighting:
- Check x402Source field on the signal
- Weight by the source Sentient's calibration acceptance rate
- A Sentient with 95% accept rate → credibility multiplier ~0.95
- A Sentient with 60% accept rate → credibility multiplier ~0.60
- Never trust below 0.5 accept rate (blocked by knowledge-acquisition)
- x402 signals carry citation metadata — factor into corroboration

## Alethic Role
Determines whether a signal can uncover something real or is
concealing something false. This layer is the filter. Garbage
signals produce garbage tensions.
