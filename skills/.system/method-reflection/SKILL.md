---
name: method-reflection
description: Reflect on whether the Sentient's methodology is well-matched
  to its domain. Self-improvement Layer 2. Runs monthly or when
  calibration-review surfaces methodological inquiries. Observes which
  skills are dormant, which position neighborhoods keep getting
  contradicted, and what patterns the Sentient keeps missing.
  All findings surface as inquiries — never mutates skills directly.
---

# Method Reflection

Self-improvement Layer 2 of the Alethic Method.

Calibration review asks "were my scores right?"
Method reflection asks "is my methodology well-matched?"

## When to Run
- Scheduled: monthly
- Triggered: when calibration-review opens methodological inquiries
- Triggered: when owner repeatedly corrects positions in same sub-domain

## Process
1. Audit skill usage: which skills are used, which are dormant?
   Dormant skills are candidates for removal or replacement.
2. Audit contradiction patterns: which position neighborhoods
   keep getting contradicted? Systematic contradiction = blind spot.
3. Audit owner override patterns: where does the human consistently
   override the agent? These are the Sentient's systematic weaknesses.
4. Audit signal coverage: which domain areas produce no signals?
   Dark spots in signal coverage = potential knowledge gaps.
5. For each finding: open an inquiry, never mutate directly.
   - "skill X has not been used in 20 sessions — retire or replace?"
   - "positions about CPUC procedure keep getting contradicted —
      do I need a better regulatory-reading skill?"
   - "owner dismisses Exa signals about hardware pricing —
      should signal weight for that sub-domain be reduced?"
6. Write method-reflection record to knowledge/calibration/

## Output
dormant_skills[]
contradiction_patterns[]
override_patterns[]
coverage_gaps[]
proposed_inquiries[]     — all findings surface as inquiries

## Key Constraint
Method reflection NEVER modifies skills directly.
It observes and proposes. The improvement loop is:
  method-reflection -> inquiry -> human approves -> skill-writer acts
This keeps methodology changes human-reviewed before execution.
