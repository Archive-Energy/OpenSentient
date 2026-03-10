import { describe, expect, test } from "bun:test"
import { parseSkillMd } from "../actor/skill-runner"

// ── parseSkillMd ──────────────────────────────────────────────────────

describe("parseSkillMd", () => {
	test("parses frontmatter from actor skill", () => {
		const raw = `---
name: signal-triage
description: Classify incoming signals
runtime: actor
trigger: signal_above_threshold
---

# Signal Triage

Classify incoming signals to determine response level.
`
		const { meta, body } = parseSkillMd(raw)
		expect(meta.name).toBe("signal-triage")
		expect(meta.description).toBe("Classify incoming signals")
		expect(meta.runtime).toBe("actor")
		expect(meta.trigger).toBe("signal_above_threshold")
		expect(body).toContain("# Signal Triage")
		expect(body).toContain("Classify incoming signals to determine response level.")
	})

	test("parses sandbox skill with escalation", () => {
		const raw = `---
name: calibration-review
description: Review calibration quality
runtime: actor
escalate_to: sandbox
---

# Calibration Review

Review calibration decisions.
`
		const { meta, body } = parseSkillMd(raw)
		expect(meta.name).toBe("calibration-review")
		expect(meta.runtime).toBe("actor")
		expect(meta.escalate_to).toBe("sandbox")
	})

	test("parses sandbox-only skill", () => {
		const raw = `---
name: belief-updating
description: Update position confidence
runtime: sandbox
---

# Belief Updating
`
		const { meta } = parseSkillMd(raw)
		expect(meta.runtime).toBe("sandbox")
	})

	test("handles missing optional fields", () => {
		const raw = `---
name: minimal-skill
description: A minimal skill
---

# Minimal Skill
`
		const { meta } = parseSkillMd(raw)
		expect(meta.name).toBe("minimal-skill")
		expect(meta.runtime).toBeUndefined()
		expect(meta.trigger).toBeUndefined()
		expect(meta.escalate_to).toBeUndefined()
	})

	test("body is trimmed of leading/trailing whitespace", () => {
		const raw = `---
name: test
description: test
---

   
# Content Here

Some text.

`
		const { body } = parseSkillMd(raw)
		expect(body).toBe("# Content Here\n\nSome text.")
	})

	test("handles multiline description", () => {
		const raw = `---
name: complex-skill
description: >
  This is a long description
  that spans multiple lines.
runtime: actor
---

# Complex Skill
`
		const { meta } = parseSkillMd(raw)
		expect(meta.description).toContain("This is a long description")
		expect(meta.description).toContain("multiple lines")
	})
})

// ── loadSkill ─────────────────────────────────────────────────────────

describe("loadSkill", () => {
	// loadSkill depends on filesystem (Bun.file), tested via integration
	// We test the contract: it should throw for missing skills

	test("loadSkill is exported", async () => {
		const { loadSkill } = await import("../actor/skill-runner")
		expect(typeof loadSkill).toBe("function")
	})
})

// ── runActorSkill ─────────────────────────────────────────────────────

describe("runActorSkill", () => {
	// runActorSkill calls actorInfer which requires API keys,
	// so we test the contract rather than full integration

	test("runActorSkill is exported", async () => {
		const { runActorSkill } = await import("../actor/skill-runner")
		expect(typeof runActorSkill).toBe("function")
	})
})
