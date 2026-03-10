---
name: git-workflow
description: Create pull requests against configured repos from session
  findings. Any Sentient can PR against any repo the token has access to.
  Use when a session produces actionable code changes, documentation
  updates, or configuration modifications that should be proposed as PRs.
runtime: sandbox
---

# Git Workflow

Create pull requests from session findings. Every Sentient ships
with this skill — the factory can PR against itself.

## When to Use
- Session produces code changes that should be proposed
- Documentation updates from position changes
- Configuration modifications from calibration findings
- The factory itself identifies self-improvements

## Process
1. Read repos config from AGENTS.md — url, branch_prefix, auth, auto_pr
2. Create a feature branch: {branch_prefix}/{session-id}-{slug}
3. Stage changes produced during the session
4. Commit with structured message referencing the session ID
5. Push branch to remote
6. If auto_pr is true: create PR with session narrative as description
7. Record PR artifact in SessionSummary.artifacts.pullRequests

## PR Format
Title: [{domain}] {position-slug}: {one-line summary}
Body:
  - Session ID and trigger signal
  - Positions updated with confidence deltas
  - Narrative from sensemaking layer
  - Link to session record in knowledge graph

## Output
pull_request_url
branch_name
files_changed
commit_sha

## Key Constraint
Branch protection on the target repo is the safety net.
The Sentient proposes — repo maintainers accept.
Never force-push. Never merge without review.
