import { describe, expect, test } from "bun:test"
import { projectSentientJson } from "../actor/identity"
import type { AgentsConfig } from "../actor/types"

// ── Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AgentsConfig>): AgentsConfig {
	return {
		name: "solar-nem-tracker",
		domain: {
			name: "Solar NEM Policy",
			description: "Residential solar installation economics and NEM policy tracking",
			boundaries: ["net energy metering", "solar tariffs"],
			adjacencies: ["battery storage"],
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
		skills: { curated: [], system_external: [] },
		integrations: { telegram: true },
		api: {
			discovery: true,
			public_skills: true,
			public_positions: false,
			public_inquiries: false,
		},
		...overrides,
	} as AgentsConfig
}

// ── projectSentientJson ───────────────────────────────────────────────

describe("projectSentientJson", () => {
	test("generates correct client_id from base URL", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app")
		expect(doc.client_id).toBe("https://solar.railway.app/.well-known/sentient.json")
	})

	test("strips trailing slash from base URL", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app/")
		expect(doc.client_id).toBe("https://solar.railway.app/.well-known/sentient.json")
	})

	test("includes domain identity fields", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app")
		expect(doc.name).toBe("solar-nem-tracker")
		expect(doc.domain).toBe("Solar NEM Policy")
		expect(doc.description).toContain("Residential solar")
		expect(doc.boundaries).toEqual(["net energy metering", "solar tariffs"])
		expect(doc.adjacencies).toEqual(["battery storage"])
	})

	test("includes API visibility settings", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app")
		expect(doc.api).toBeDefined()
		expect(doc.api?.discovery).toBe(true)
		expect(doc.api?.public_positions).toBe(false)
	})

	test("excludes payments when not enabled", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app")
		expect(doc.payments).toBeUndefined()
	})

	test("includes payments when enabled", () => {
		const config = makeConfig({
			payments: {
				enabled: true,
				stripe_connected_account: "acct_secret_123",
				default_pricing: { query: "0.10", position_history: "0.05" },
			},
		})
		const doc = projectSentientJson(config, "https://solar.railway.app")
		expect(doc.payments).toBeDefined()
		expect(doc.payments?.enabled).toBe(true)
		expect(doc.payments?.pricing?.query).toBe("0.10")
	})

	test("does NOT expose stripe_connected_account", () => {
		const config = makeConfig({
			payments: {
				enabled: true,
				stripe_connected_account: "acct_secret_123",
				default_pricing: { query: "0.10" },
			},
		})
		const doc = projectSentientJson(config, "https://solar.railway.app")
		const serialized = JSON.stringify(doc)
		expect(serialized).not.toContain("acct_secret_123")
		expect(serialized).not.toContain("stripe_connected_account")
	})

	test("does NOT expose model config or internal fields", () => {
		const doc = projectSentientJson(makeConfig(), "https://solar.railway.app")
		const serialized = JSON.stringify(doc)
		expect(serialized).not.toContain("claude-haiku")
		expect(serialized).not.toContain("claude-opus")
		expect(serialized).not.toContain("opencode")
		expect(serialized).not.toContain("threshold")
		expect(serialized).not.toContain("scan_interval")
		expect(serialized).not.toContain('"curated"')
	})

	test("includes registry URL when configured", () => {
		const config = makeConfig({
			registry: { url: "https://os.archive.energy" },
		})
		const doc = projectSentientJson(config, "https://solar.railway.app")
		expect(doc.registry?.url).toBe("https://os.archive.energy")
	})

	test("adds facilitator from registry when payments enabled", () => {
		const config = makeConfig({
			payments: {
				enabled: true,
				stripe_connected_account: "acct_123",
				default_pricing: { query: "0.10" },
			},
			registry: { url: "https://os.archive.energy" },
		})
		const doc = projectSentientJson(config, "https://solar.railway.app")
		expect(doc.payments?.facilitator).toBe("https://os.archive.energy")
	})
})
