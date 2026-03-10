---
name: skill-finder
description: Find and evaluate skills from external sources for capability gaps.
  Meta skill of the Alethic Method. Use when a task pattern recurs that
  the Sentient has no skill for, or when a capability gap slows domain
  exploration. Searches npx skills find and evaluates candidates.
runtime: sandbox
---

# Skill Finder

When you encounter a task you don't have a skill for, find one.

## When to Use
- Task pattern you've solved manually more than once
- Capability gap that slows domain exploration
- After receiving signals in an unfamiliar sub-domain

## Process
1. State the capability gap explicitly
2. Search: npx skills find [keyword]
3. Evaluate: relevance, quality, concerns
4. If passes: npx skills add [source] --skill [name] --agent opencode --yes
5. Log acquisition in session

## Output
skill_name, source, capability, evaluation (relevance/quality/concerns), decision
