import { describe, expect, test } from "bun:test"
import { calculateCost, lookupCost } from "../actor/pricing"
import type { ModelPricingCache } from "../actor/types"

// ── Mock Cache ────────────────────────────────────────────────────────

const mockCache: ModelPricingCache = {
	data: {
		anthropic: {
			models: {
				"claude-haiku-4-5": { cost: { input: 1.0, output: 5.0 } },
				"claude-opus-4-6": { cost: { input: 15.0, output: 75.0 } },
			},
		},
		openai: {
			models: {
				"gpt-4o": { cost: { input: 2.5, output: 10.0 } },
			},
		},
	},
	fetchedAt: Date.now(),
}

// ── lookupCost ────────────────────────────────────────────────────────

describe("lookupCost", () => {
	test("returns cost for known provider + model", () => {
		const cost = lookupCost(mockCache, "anthropic", "claude-haiku-4-5")
		expect(cost).not.toBeNull()
		expect(cost?.input).toBe(1.0)
		expect(cost?.output).toBe(5.0)
	})

	test("returns cost for different model under same provider", () => {
		const cost = lookupCost(mockCache, "anthropic", "claude-opus-4-6")
		expect(cost).not.toBeNull()
		expect(cost?.input).toBe(15.0)
		expect(cost?.output).toBe(75.0)
	})

	test("returns cost for different provider", () => {
		const cost = lookupCost(mockCache, "openai", "gpt-4o")
		expect(cost).not.toBeNull()
		expect(cost?.input).toBe(2.5)
	})

	test("returns null for unknown provider", () => {
		expect(lookupCost(mockCache, "deepseek", "deepseek-v3")).toBeNull()
	})

	test("returns null for unknown model", () => {
		expect(lookupCost(mockCache, "anthropic", "nonexistent-model")).toBeNull()
	})
})

// ── calculateCost ─────────────────────────────────────────────────────

describe("calculateCost", () => {
	test("calculates correct cost for Haiku usage", () => {
		const usage = { inputTokens: 1_000_000, outputTokens: 100_000 }
		const cost = calculateCost(mockCache, "anthropic", "claude-haiku-4-5", usage)
		// input: 1M * 1.0 / 1M = 1.00
		// output: 100k * 5.0 / 1M = 0.50
		expect(cost).toBeCloseTo(1.5)
	})

	test("calculates correct cost for Opus usage", () => {
		const usage = { inputTokens: 10_000, outputTokens: 2_000 }
		const cost = calculateCost(mockCache, "anthropic", "claude-opus-4-6", usage)
		// input: 10k * 15.0 / 1M = 0.15
		// output: 2k * 75.0 / 1M = 0.15
		expect(cost).toBeCloseTo(0.3)
	})

	test("returns 0 for unknown provider", () => {
		const usage = { inputTokens: 1000, outputTokens: 500 }
		expect(calculateCost(mockCache, "unknown", "model", usage)).toBe(0)
	})

	test("returns 0 for unknown model", () => {
		const usage = { inputTokens: 1000, outputTokens: 500 }
		expect(calculateCost(mockCache, "anthropic", "unknown", usage)).toBe(0)
	})

	test("handles zero tokens", () => {
		const usage = { inputTokens: 0, outputTokens: 0 }
		expect(calculateCost(mockCache, "anthropic", "claude-haiku-4-5", usage)).toBe(0)
	})

	test("handles small token counts (typical triage)", () => {
		const usage = { inputTokens: 500, outputTokens: 100 }
		const cost = calculateCost(mockCache, "anthropic", "claude-haiku-4-5", usage)
		// input: 500 * 1.0 / 1M = 0.0005
		// output: 100 * 5.0 / 1M = 0.0005
		expect(cost).toBeCloseTo(0.001)
	})
})
