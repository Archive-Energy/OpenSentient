---
name: skill-writer
description: Write new SKILL.md files from patterns observed in record sessions.
  Autonomous post-hoc extraction — not interactive generation. Produces
  API-deployable skills from session evidence without human in the loop.
  Also maintains skills/SKILLPACK.md — the living composition document.
---

# Skill Writer

When you solve a multi-step problem you will need again, write a skill.

## Distinction from skill-creator

skill-creator (Anthropic's tool) is interactive — a human describes
what they want and skill-creator scaffolds it conversationally.

skill-writer (this skill) is autonomous and post-hoc — it observes
what actually worked in a session, extracts the pattern as evidence,
and crystallizes it into a reusable skill without human involvement.

## When to Use
- Solved a problem requiring multiple steps that will recur
- Discovered a domain-specific reasoning pattern
- A session produced a high-confidence position update via a
  repeatable sequence — extract that sequence as a skill

## Technical Requirements
All generated skills must comply with the Anthropic Skills spec:
- Folder named in kebab-case, no spaces or capitals
- SKILL.md named exactly (case-sensitive)
- YAML frontmatter with --- delimiters
- name: kebab-case only
- description: under 1024 characters, includes WHAT and WHEN,
  no XML tags, includes specific trigger phrases
- No README.md inside skill folder

## Quality Criteria
- Steps are concrete and executable, not aspirational
- Narrow scope: one skill, one capability
- Name is a noun phrase
- description triggers on relevant queries, not on everything

## Process
1. Identify the reusable pattern from session evidence
2. State: "This skill enables X"
3. Write ordered, concrete steps
4. Define structured output
5. Validate: name kebab-case, description under 1024 chars, no XML
6. Save to: skills/.curated/[name]/SKILL.md

## SKILLPACK.md Responsibility

skill-writer also maintains `skills/SKILLPACK.md` — the living
composition document for this Sentient's proven skill combinations.

After every record session:
1. Read SKILLPACK.md frontmatter
2. Identify which skills co-activated in this session
3. Update confidence score based on co-activation evidence
4. Add entry to ## Confidence History table
5. Update ## Open Composition Questions with new patterns
6. If confidence > 0.8 AND session_count > 30: set proposed_at
7. Write updated SKILLPACK.md — file is source of truth
