import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveEndpoint, resolveKey } from "../actor/inference"
import { buildHarnessConfig, buildSandboxEnvVars, parseAgentsMd } from "../actor/materialize"
import type { HarnessBackend, SandboxModelConfig } from "../actor/types"

// ── resolveKey ────────────────────────────────────────────────────────

describe("resolveKey", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	test("resolves ${VAR} reference from env", () => {
		process.env.TEST_KEY = "sk-test-123"
		expect(resolveKey("${TEST_KEY}")).toBe("sk-test-123")
	})

	test("returns literal string if not a ${} reference", () => {
		expect(resolveKey("plain-key")).toBe("plain-key")
	})

	test("throws on missing env var", () => {
		process.env.MISSING_VAR = undefined
		expect(() => resolveKey("${MISSING_VAR}")).toThrow("Missing env var: MISSING_VAR")
	})

	test("handles nested-looking refs correctly", () => {
		// Only matches exact ${...} pattern
		expect(resolveKey("prefix-${NOT_A_REF}")).toBe("prefix-${NOT_A_REF}")
	})
})

// ── resolveEndpoint ───────────────────────────────────────────────────

describe("resolveEndpoint", () => {
	test("resolves anthropic", () => {
		expect(resolveEndpoint("anthropic")).toBe("https://api.anthropic.com")
	})

	test("resolves openrouter", () => {
		expect(resolveEndpoint("openrouter")).toBe("https://openrouter.ai/api/v1")
	})

	test("resolves openai", () => {
		expect(resolveEndpoint("openai")).toBe("https://api.openai.com/v1")
	})

	test("throws on unknown provider", () => {
		expect(() => resolveEndpoint("unknown-provider")).toThrow("Unknown provider")
	})
})

// ── parseAgentsMd ─────────────────────────────────────────────────────

describe("parseAgentsMd", () => {
	const minimalAgentsMd = `---
name: test-agent
namespace: test
domain:
  name: test-domain
  description: A test domain
  boundaries:
    - area one
    - area two
  adjacencies:
    - adjacent one
models:
  actor:
    provider: anthropic
    key: \${ANTHROPIC_KEY}
    name: claude-haiku-4-5
  embedding:
    provider: openrouter
    key: \${EMBED_KEY}
    name: baai/bge-m3
    dimensions: 1024
  sandbox:
    harness: opencode
    key: \${HARNESS_KEY}
    name: claude-opus-4-6
session:
  threshold: 0.6
  calibration_threshold: 0.4
  daily_scan: true
  scan_interval_hours: 24
  session_cooldown_minutes: 1
  signal_ttl_days: 7
signals:
  exa:
    weight: 0.8
skills:
  curated: []
  system_external: []
integrations:
  telegram:
    token: \${TELEGRAM_TOKEN}
api:
  discovery: true
  public_skills: true
  public_positions: false
  public_inquiries: false
seed_positions:
  - slug: seed-1
    text: Initial position
    confidence: 0.7
---

# Test Agent

You are a test agent.
`

	test("extracts config from frontmatter", () => {
		const { config } = parseAgentsMd(minimalAgentsMd)
		expect(config.name).toBe("test-agent")
		expect(config.domain.name).toBe("test-domain")
		expect(config.domain.boundaries).toHaveLength(2)
		expect(config.models.actor.name).toBe("claude-haiku-4-5")
		expect(config.models.embedding.dimensions).toBe(1024)
		expect(config.models.sandbox.harness).toBe("opencode")
		expect(config.session.threshold).toBe(0.6)
		expect(config.signals.exa.weight).toBe(0.8)
	})

	test("extracts body content without frontmatter", () => {
		const { body } = parseAgentsMd(minimalAgentsMd)
		expect(body).toContain("# Test Agent")
		expect(body).toContain("You are a test agent.")
		expect(body).not.toContain("---")
	})

	test("preserves seed positions", () => {
		const { config } = parseAgentsMd(minimalAgentsMd)
		expect(config.seed_positions).toHaveLength(1)
		expect(config.seed_positions[0].slug).toBe("seed-1")
		expect(config.seed_positions[0].confidence).toBe(0.7)
	})
})

// ── buildHarnessConfig ────────────────────────────────────────────────

describe("buildHarnessConfig", () => {
	const body = "Agent instructions here"

	test("opencode produces opencode.jsonc", () => {
		const result = buildHarnessConfig("opencode", body)
		expect(result).not.toBeNull()
		expect(result?.filename).toBe("opencode.jsonc")
		const parsed = JSON.parse(result?.content)
		expect(parsed.instructions).toContain("AGENTS.md")
	})

	test("claude produces CLAUDE.md", () => {
		const result = buildHarnessConfig("claude", body)
		expect(result).not.toBeNull()
		expect(result?.filename).toBe("CLAUDE.md")
		expect(result?.content).toContain("Agent instructions here")
		expect(result?.content).toContain("/workspace/knowledge/")
	})

	test("amp produces .amp/config.json", () => {
		const result = buildHarnessConfig("amp", body)
		expect(result).not.toBeNull()
		expect(result?.filename).toBe(".amp/config.json")
		const parsed = JSON.parse(result?.content)
		expect(parsed.instructions).toBe(body)
	})

	test("codex returns null (reads AGENTS.md natively)", () => {
		const result = buildHarnessConfig("codex", body)
		expect(result).toBeNull()
	})
})

// ── buildSandboxEnvVars ───────────────────────────────────────────────

describe("buildSandboxEnvVars", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	test("forwards correct keys for opencode", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant"
		process.env.OPENAI_API_KEY = "sk-oai"
		process.env.OPENROUTER_API_KEY = "sk-or"
		process.env.OPENCODE_API_KEY = "sk-oc"

		const config: SandboxModelConfig = {
			harness: "opencode",
			key: "${HARNESS_KEY}",
			name: "claude-opus-4-6",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.ANTHROPIC_API_KEY).toBe("sk-ant")
		expect(vars.OPENAI_API_KEY).toBe("sk-oai")
		expect(vars.OPENROUTER_API_KEY).toBe("sk-or")
		expect(vars.OPENCODE_API_KEY).toBe("sk-oc")
	})

	test("forwards only ANTHROPIC_API_KEY for claude", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant"
		process.env.OPENAI_API_KEY = "sk-oai"

		const config: SandboxModelConfig = {
			harness: "claude",
			key: "${HARNESS_KEY}",
			name: "claude-opus-4-6",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.ANTHROPIC_API_KEY).toBe("sk-ant")
		expect(vars.OPENAI_API_KEY).toBeUndefined()
	})

	test("forwards only OPENAI_API_KEY for codex", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant"
		process.env.OPENAI_API_KEY = "sk-oai"

		const config: SandboxModelConfig = {
			harness: "codex",
			key: "${HARNESS_KEY}",
			name: "o3",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.OPENAI_API_KEY).toBe("sk-oai")
		expect(vars.ANTHROPIC_API_KEY).toBeUndefined()
	})

	test("includes optional integration keys when present", () => {
		process.env.GITHUB_TOKEN = "ghp-test"
		process.env.EXA_API_KEY = "exa-test"
		process.env.PARSE_API_KEY = "parse-test"

		const config: SandboxModelConfig = {
			harness: "opencode",
			key: "${HARNESS_KEY}",
			name: "claude-opus-4-6",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.GITHUB_TOKEN).toBe("ghp-test")
		expect(vars.EXA_API_KEY).toBe("exa-test")
		expect(vars.PARSE_API_KEY).toBe("parse-test")
	})

	test("omits missing optional keys", () => {
		process.env.GITHUB_TOKEN = undefined
		process.env.EXA_API_KEY = undefined

		const config: SandboxModelConfig = {
			harness: "opencode",
			key: "${HARNESS_KEY}",
			name: "claude-opus-4-6",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.GITHUB_TOKEN).toBeUndefined()
		expect(vars.EXA_API_KEY).toBeUndefined()
	})
})
