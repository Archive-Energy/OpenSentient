import { afterEach, describe, expect, test } from "bun:test"
import { resolveEndpoint, resolveProviderKey } from "../actor/inference"
import { buildHarnessConfig, buildSandboxEnvVars, parseSentientConfig } from "../actor/materialize"
import type { HarnessBackend, SandboxModelConfig } from "../actor/types"

// ── resolveProviderKey ────────────────────────────────────────────────

describe("resolveProviderKey", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	test("resolves anthropic provider to ANTHROPIC_API_KEY", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-123"
		expect(resolveProviderKey("anthropic")).toBe("sk-test-123")
	})

	test("resolves openrouter provider to OPENROUTER_API_KEY", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-456"
		expect(resolveProviderKey("openrouter")).toBe("sk-or-456")
	})

	test("resolves openai provider to OPENAI_API_KEY", () => {
		process.env.OPENAI_API_KEY = "sk-oai-789"
		expect(resolveProviderKey("openai")).toBe("sk-oai-789")
	})

	test("throws on unknown provider", () => {
		expect(() => resolveProviderKey("deepseek")).toThrow("Unknown provider: deepseek")
	})

	test("throws when env var is missing", () => {
		process.env.ANTHROPIC_API_KEY = undefined
		expect(() => resolveProviderKey("anthropic")).toThrow("Missing env var: ANTHROPIC_API_KEY")
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

// ── parseSentientConfig ───────────────────────────────────────────────

describe("parseSentientConfig", () => {
	const minimalJsonc = JSON.stringify({
		name: "test-agent",
		namespace: "test",
		domain: {
			name: "test-domain",
			description: "A test domain",
			boundaries: ["area one", "area two"],
			adjacencies: ["adjacent one"],
		},
		models: {
			actor: { provider: "anthropic", name: "claude-haiku-4-5" },
			embedding: { provider: "openrouter", name: "baai/bge-m3", dimensions: 1024 },
			sandbox: { harness: "opencode", name: "claude-opus-4-6" },
		},
		session: {
			threshold: 0.6,
			calibration_threshold: 0.4,
			daily_scan: true,
			scan_interval_hours: 24,
			session_cooldown_minutes: 1,
			signal_ttl_days: 7,
		},
		signals: { exa: { weight: 0.8 } },
		skills: { curated: [], system_external: [] },
		integrations: { telegram: true },
		api: {
			discovery: true,
			public_skills: true,
			public_positions: false,
			public_inquiries: false,
		},
		seed_positions: [{ slug: "seed-1", text: "Initial position", confidence: 0.7 }],
	})

	test("extracts config from JSONC", () => {
		const config = parseSentientConfig(minimalJsonc)
		expect(config.name).toBe("test-agent")
		expect(config.domain.name).toBe("test-domain")
		expect(config.domain.boundaries).toHaveLength(2)
		expect(config.models.actor.name).toBe("claude-haiku-4-5")
		expect(config.models.embedding.dimensions).toBe(1024)
		expect(config.models.sandbox.harness).toBe("opencode")
		expect(config.session.threshold).toBe(0.6)
	})

	test("parses JSONC with comments", () => {
		const jsonc = `{
			// This is a comment
			"name": "comment-test",
			"domain": {
				"name": "test",
				"description": "test",
				"boundaries": [],
				"adjacencies": []
			},
			"models": {
				"actor": { "provider": "anthropic", "name": "claude-haiku-4-5" },
				"embedding": { "provider": "openrouter", "name": "bge-m3" },
				"sandbox": { "harness": "opencode", "name": "claude-opus-4-6" }
			},
			"session": {
				"threshold": 0.6,
				"calibration_threshold": 0.4,
				"daily_scan": true,
				"scan_interval_hours": 24,
				"session_cooldown_minutes": 1,
				"signal_ttl_days": 7
			},
			"skills": { "curated": [], "system_external": [] },
			"integrations": { "telegram": true },
			"api": {
				"discovery": true,
				"public_skills": true,
				"public_positions": false,
				"public_inquiries": false
			}
		}`
		const config = parseSentientConfig(jsonc)
		expect(config.name).toBe("comment-test")
	})

	test("parses signal weights", () => {
		const config = parseSentientConfig(minimalJsonc)
		expect(config.signals?.exa).toBeDefined()
		expect((config.signals?.exa as Record<string, unknown>)?.weight).toBe(0.8)
	})

	test("preserves seed positions", () => {
		const config = parseSentientConfig(minimalJsonc)
		expect(config.seed_positions).toHaveLength(1)
		expect(config.seed_positions?.[0].slug).toBe("seed-1")
		expect(config.seed_positions?.[0].confidence).toBe(0.7)
	})

	test("v0.2 optional fields default to undefined when absent", () => {
		const config = parseSentientConfig(minimalJsonc)
		expect(config.budget).toBeUndefined()
		expect(config.payments).toBeUndefined()
		expect(config.wallet).toBeUndefined()
		expect(config.registry).toBeUndefined()
		expect(config.brief).toBeUndefined()
	})

	test("parses v0.2 budget config", () => {
		const data = JSON.parse(minimalJsonc)
		data.budget = { daily_usd: 5.0, x402_allocation_pct: 10, triage_enabled: true }
		const config = parseSentientConfig(JSON.stringify(data))
		expect(config.budget).toBeDefined()
		expect(config.budget?.daily_usd).toBe(5.0)
		expect(config.budget?.x402_allocation_pct).toBe(10)
		expect(config.budget?.triage_enabled).toBe(true)
	})

	test("parses v0.2 payments config", () => {
		const data = JSON.parse(minimalJsonc)
		data.payments = {
			enabled: true,
			stripe_connected_account: "acct_123",
			default_pricing: { query: "0.10", position_history: "0.05" },
		}
		const config = parseSentientConfig(JSON.stringify(data))
		expect(config.payments).toBeDefined()
		expect(config.payments?.enabled).toBe(true)
		expect(config.payments?.stripe_connected_account).toBe("acct_123")
		expect(config.payments?.default_pricing.query).toBe("0.10")
	})

	test("parses v0.2 wallet config", () => {
		const data = JSON.parse(minimalJsonc)
		data.wallet = {
			autonomous_spending: {
				enabled: true,
				monthly_budget_usdc: 50.0,
				per_query_limit_usdc: 1.0,
				require_approval_above: 5.0,
			},
		}
		const config = parseSentientConfig(JSON.stringify(data))
		expect(config.wallet).toBeDefined()
		expect(config.wallet?.autonomous_spending.enabled).toBe(true)
		expect(config.wallet?.autonomous_spending.monthly_budget_usdc).toBe(50.0)
	})

	test("parses v0.2 registry config (no api_key)", () => {
		const data = JSON.parse(minimalJsonc)
		data.registry = { url: "https://os.archive.energy" }
		const config = parseSentientConfig(JSON.stringify(data))
		expect(config.registry).toBeDefined()
		expect(config.registry?.url).toBe("https://os.archive.energy")
	})

	test("parses v0.2 brief config", () => {
		const data = JSON.parse(minimalJsonc)
		data.brief = {
			source: "Brief.md",
			last_generated: "2026-03-10T00:00:00Z",
			generation_model: "claude-haiku-4-5",
		}
		const config = parseSentientConfig(JSON.stringify(data))
		expect(config.brief).toBeDefined()
		expect(config.brief?.source).toBe("Brief.md")
		expect(config.brief?.generation_model).toBe("claude-haiku-4-5")
	})

	test("preserves unknown fields (passthrough)", () => {
		const data = JSON.parse(minimalJsonc)
		data.custom_field = "hello"
		const config = parseSentientConfig(JSON.stringify(data))
		expect((config as Record<string, unknown>).custom_field).toBe("hello")
	})

	test("throws on missing required field (name)", () => {
		const data = JSON.parse(minimalJsonc)
		const { name: _, ...withoutName } = data
		expect(() => parseSentientConfig(JSON.stringify(withoutName))).toThrow()
	})

	test("throws on wrong type (threshold as string)", () => {
		const data = JSON.parse(minimalJsonc)
		data.session.threshold = "high"
		expect(() => parseSentientConfig(JSON.stringify(data))).toThrow()
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
			name: "claude-opus-4-6",
		}
		const vars = buildSandboxEnvVars(config)

		expect(vars.GITHUB_TOKEN).toBeUndefined()
		expect(vars.EXA_API_KEY).toBeUndefined()
	})
})
