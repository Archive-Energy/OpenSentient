---
name: validate-config
description: Validate sentient.jsonc config and .env before first session.
  Checks all provider keys resolve from .env by convention, all endpoints
  are reachable, all model IDs are valid for their provider, and all fixed
  infrastructure keys are present. Runs at first boot only.
  Outputs a clear pass/fail report with remediation steps.
runtime: actor
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

For each model role in sentient.jsonc `models` block:

1. Resolve key by provider convention (e.g., `provider: "anthropic"` → `ANTHROPIC_API_KEY`)
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

## v0.2 Fields

Additionally validate these optional sentient.jsonc sections if present:

```
budget:
  daily_usd        number > 0?
  x402_allocation_pct   0-100?
  triage_enabled   boolean?

payments:
  enabled          boolean?
  STRIPE_CONNECTED_ACCOUNT_ID   present in .env?

wallet:
  autonomous_spending:
    monthly_budget_usdc    number > 0?
    per_query_limit_usdc   number > 0?
    require_approval_above number > 0?

registry:
  url              valid URL?
```

Also validate signal source keys:
```
PARALLEL_API_KEY           present? (if signals.parallel configured)
PARALLEL_WEBHOOK_SECRET    present? (if signals.parallel configured)
```

## Key Constraint
validate-config never modifies any config.
It reads, checks, and reports. All fixes are made by the human.
If any check fails: print full report, halt, do not proceed.
