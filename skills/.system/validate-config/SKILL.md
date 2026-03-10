---
name: validate-config
description: Validate AGENTS.md config and .env before first session.
  Checks all variable references resolve, all endpoints are reachable,
  all model IDs are valid for their provider, and all fixed
  infrastructure keys are present. Runs at first boot only.
  Outputs a clear pass/fail report with remediation steps.
---

# Validate Config

Boot-time config validation. Runs before onboarding, before any
session, before anything else. If this fails, nothing else runs.

## Fixed Infrastructure (always required)

Check these keys exist in .env:

```
RIVET_TOKEN                  present?
RIVET_PROJECT_ID             present?
DAYTONA_API_KEY              present?
DAYTONA_SERVER_URL           present? valid URL format?
TELEGRAM_BOT_TOKEN           present?
```

## Model Config (endpoint + key + name)

For each model role in AGENTS.md `models:` block:

1. Resolve ${VAR} reference — does the env var exist?
2. Ping endpoint with resolved key:
   GET {endpoint}/models  (OpenAI-compatible)
   GET {endpoint}/v1/models  (fallback)
   Expected: 200 or 401 (401 = endpoint live, key may be wrong)
   Fail: connection refused, timeout, 404
3. Validate model name exists on that endpoint (if /models returns list)

## Output

```
VALIDATE CONFIG
---
Fixed infrastructure
  [check] RIVET_TOKEN              present
  [check] DAYTONA_API_KEY          present
  [check] TELEGRAM_BOT_TOKEN       present

Model: actor
  [check] key                      present
  [check] endpoint                 reachable
  [check] model                    found

Model: embedding
  [check] key                      present
  [check] endpoint                 reachable
  [check] model                    found
---
Config valid. Proceeding to onboarding.
```

## Key Constraint
validate-config never modifies any config.
It reads, checks, and reports. All fixes are made by the human.
If any check fails: print full report, halt, do not proceed.
