---
name: signal-evaluation
description: Evaluate incoming signals for credibility, corroboration,
  and relevance before updating any position. Layer 1 of the Alethic
  Method — the investigative layer. Apply to every IngestSignal before
  tension evaluation. A signal is not evidence until it passes this layer.
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

## Alethic Role
Determines whether a signal can uncover something real or is
concealing something false. This layer is the filter. Garbage
signals produce garbage tensions.
