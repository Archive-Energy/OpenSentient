---
name: belief-updating
description: Update position confidence from credible signals using
  Bayesian reasoning. Layer 2 of the Alethic Method. Apply after
  signal passes evaluation. Computes surprise_delta and new confidence.
  High surprise_delta flags the position as a tension.
runtime: sandbox
---

# Belief Updating

The Bayesian layer of the Alethic Method.

A credible signal moves a position. The question is how much.
Bayesian reasoning gives a principled answer: prior confidence
+ evidence weight -> posterior confidence.

## Approach
Bayesian inference adapted for qualitative domain knowledge.
Confidence scores are priors. Signal credibility weights the update.
surprise_delta is the distance between prior and posterior.

## Process
1. State prior confidence explicitly
2. Weight signal by credibility score (from signal-evaluation)
3. Compute posterior: how much does this move the prior?
4. Compute surprise_delta: abs(posterior - prior)
5. If surprise_delta > threshold: set status: under_interrogation
6. Write updated confidence + surprise_delta to position node

## Output
prior_confidence
signal_weight
posterior_confidence
surprise_delta
tension_flag (boolean)

## Alethic Role
Measures how much each signal uncovers. High surprise_delta means
the domain revealed something the Sentient didn't know. That's the
live edge — where uncovering is happening fastest.
