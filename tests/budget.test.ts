import { describe, expect, test } from "bun:test"
import {
	DEFAULT_BUDGET,
	DEFAULT_COST_PROFILE,
	checkBudget,
	estimateCostFromUsage,
	getDailyDigest,
	recordCost,
	resetBudgetIfNewDay,
} from "../actor/budget"
import type { BudgetState, CostRecord, ModelPricingCache, SentientState } from "../actor/types"

// ── Helpers ───────────────────────────────────────────────────────────

function makeState(budgetOverrides?: Partial<BudgetState>): SentientState {
	return {
		initialized: true,
		domain: { name: "test", description: "test domain", boundaries: [], adjacencies: [] },
		modelConfig: {
			actor: { provider: "anthropic", name: "claude-haiku-4-5" },
			embedding: { provider: "openrouter", name: "bge-m3", dimensions: 1024 },
			sandbox: { harness: "opencode", name: "claude-opus-4-6" },
		},
		repos: [],
		tensionThreshold: 0.6,
		calibrationThreshold: 0.4,
		signalWeights: {},
		pendingProofs: [],
		sessionCount: 0,
		lastSessionAt: 0,
		sandboxId: null,
		telegramChatId: null,
		dirty: false,
		cachedAgentsMdBody: null,
		budgetState: { ...DEFAULT_BUDGET, ...budgetOverrides },
		triageEnabled: true,
		modelPricingCache: null,
	}
}

// ── resetBudgetIfNewDay ───────────────────────────────────────────────

describe("resetBudgetIfNewDay", () => {
	test("resets when lastResetAt is 0 (first run)", () => {
		const state = makeState({ lastResetAt: 0, spentTodayUsd: 2.5, sessionsToday: 3 })
		const didReset = resetBudgetIfNewDay(state)
		expect(didReset).toBe(true)
		expect(state.budgetState.spentTodayUsd).toBe(0)
		expect(state.budgetState.sessionsToday).toBe(0)
		expect(state.budgetState.lastResetAt).toBeGreaterThan(0)
	})

	test("resets when day has changed (UTC)", () => {
		// Set lastResetAt to yesterday
		const yesterday = Date.now() - 25 * 60 * 60 * 1000
		const state = makeState({
			lastResetAt: yesterday,
			spentTodayUsd: 4.5,
			sessionsToday: 10,
			triagesToday: 50,
			scansToday: 3,
			x402SpentTodayUsd: 0.2,
		})
		const didReset = resetBudgetIfNewDay(state)
		expect(didReset).toBe(true)
		expect(state.budgetState.spentTodayUsd).toBe(0)
		expect(state.budgetState.sessionsToday).toBe(0)
		expect(state.budgetState.triagesToday).toBe(0)
		expect(state.budgetState.scansToday).toBe(0)
		expect(state.budgetState.x402SpentTodayUsd).toBe(0)
	})

	test("does not reset when same day", () => {
		// Set lastResetAt to 1 hour ago (same UTC day)
		const oneHourAgo = Date.now() - 60 * 60 * 1000
		// Ensure we're in the same UTC day by checking
		const nowDate = new Date()
		const resetDate = new Date(oneHourAgo)
		// Only run this check if both are same UTC day
		if (nowDate.getUTCDate() === resetDate.getUTCDate()) {
			const state = makeState({ lastResetAt: oneHourAgo, spentTodayUsd: 1.5 })
			const didReset = resetBudgetIfNewDay(state)
			expect(didReset).toBe(false)
			expect(state.budgetState.spentTodayUsd).toBe(1.5)
		}
	})
})

// ── checkBudget ───────────────────────────────────────────────────────

describe("checkBudget", () => {
	test("allows triage when budget has room", () => {
		const state = makeState({ dailyBudgetUsd: 5.0, spentTodayUsd: 0.0 })
		expect(checkBudget(state, "triage")).toBe(true)
	})

	test("blocks triage when budget exhausted", () => {
		const state = makeState({ dailyBudgetUsd: 5.0, spentTodayUsd: 5.0 })
		expect(checkBudget(state, "triage")).toBe(false)
	})

	test("allows session when remaining >= sessionAvg", () => {
		const state = makeState({ dailyBudgetUsd: 5.0, spentTodayUsd: 4.8 })
		expect(checkBudget(state, "session")).toBe(true) // remaining 0.20 >= sessionAvg 0.15
	})

	test("blocks session when remaining < sessionAvg", () => {
		const state = makeState({ dailyBudgetUsd: 5.0, spentTodayUsd: 4.9 })
		expect(checkBudget(state, "session")).toBe(false) // remaining 0.10 < sessionAvg 0.15
	})

	test("x402 purchases use separate allocation", () => {
		const state = makeState({
			dailyBudgetUsd: 10.0,
			x402AllocationPct: 10,
			spentTodayUsd: 9.5, // nearly exhausted inference budget
			x402SpentTodayUsd: 0.0, // x402 untouched
		})
		// x402 budget = 10 * 10% = 1.00. x402SpentTodayUsd = 0 < 1.00 -> allowed
		expect(checkBudget(state, "x402_purchase")).toBe(true)
	})

	test("blocks x402 when x402 allocation exhausted", () => {
		const state = makeState({
			dailyBudgetUsd: 10.0,
			x402AllocationPct: 10,
			x402SpentTodayUsd: 1.0, // exactly at limit
		})
		// x402 budget = 10 * 10% = 1.00. x402SpentTodayUsd = 1.00 is NOT < 1.00 -> blocked
		expect(checkBudget(state, "x402_purchase")).toBe(false)
	})

	test("accepts custom cost profile", () => {
		const state = makeState({ dailyBudgetUsd: 0.01, spentTodayUsd: 0.0 })
		const cheapProfile = { triageAvg: 0.001, scanAvg: 0.01, sessionAvg: 0.05, embeddingAvg: 0.0001 }
		// remaining = 0.01, scanAvg = 0.01 -> 0.01 >= 0.01 -> true
		expect(checkBudget(state, "scan", cheapProfile)).toBe(true)
	})
})

// ── recordCost ────────────────────────────────────────────────────────

describe("recordCost", () => {
	test("records triage cost and increments counter", () => {
		const state = makeState()
		const record: CostRecord = { type: "triage", costUsd: 0.003, timestamp: Date.now() }
		recordCost(state, record)
		expect(state.budgetState.spentTodayUsd).toBe(0.003)
		expect(state.budgetState.triagesToday).toBe(1)
	})

	test("records session cost and increments counter", () => {
		const state = makeState()
		const record: CostRecord = { type: "session", costUsd: 0.15, timestamp: Date.now() }
		recordCost(state, record)
		expect(state.budgetState.spentTodayUsd).toBe(0.15)
		expect(state.budgetState.sessionsToday).toBe(1)
	})

	test("records scan cost and increments counter", () => {
		const state = makeState()
		const record: CostRecord = { type: "scan", costUsd: 0.07, timestamp: Date.now() }
		recordCost(state, record)
		expect(state.budgetState.spentTodayUsd).toBe(0.07)
		expect(state.budgetState.scansToday).toBe(1)
	})

	test("records x402 cost in both main and x402 tracker", () => {
		const state = makeState()
		const record: CostRecord = { type: "x402_purchase", costUsd: 0.1, timestamp: Date.now() }
		recordCost(state, record)
		expect(state.budgetState.spentTodayUsd).toBe(0.1)
		expect(state.budgetState.x402SpentTodayUsd).toBe(0.1)
	})

	test("embedding cost adds to spent but no dedicated counter", () => {
		const state = makeState()
		const record: CostRecord = { type: "embedding", costUsd: 0.001, timestamp: Date.now() }
		recordCost(state, record)
		expect(state.budgetState.spentTodayUsd).toBe(0.001)
		// No dedicated counter for embeddings — only triages/scans/sessions/x402
	})

	test("accumulates multiple costs", () => {
		const state = makeState()
		recordCost(state, { type: "triage", costUsd: 0.003, timestamp: Date.now() })
		recordCost(state, { type: "triage", costUsd: 0.003, timestamp: Date.now() })
		recordCost(state, { type: "session", costUsd: 0.15, timestamp: Date.now() })
		expect(state.budgetState.spentTodayUsd).toBeCloseTo(0.156)
		expect(state.budgetState.triagesToday).toBe(2)
		expect(state.budgetState.sessionsToday).toBe(1)
	})
})

// ── estimateCostFromUsage ─────────────────────────────────────────────

describe("estimateCostFromUsage", () => {
	const mockCache: ModelPricingCache = {
		data: {
			anthropic: {
				models: {
					"claude-haiku-4-5": { cost: { input: 1.0, output: 5.0 } }, // $/Mtok
				},
			},
		},
		fetchedAt: Date.now(),
	}

	test("calculates cost from token usage and pricing cache", () => {
		const usage = { inputTokens: 1000, outputTokens: 200 }
		const cost = estimateCostFromUsage(usage, "anthropic", "claude-haiku-4-5", mockCache)
		// input: 1000 * 1.0 / 1M = 0.001
		// output: 200 * 5.0 / 1M = 0.001
		expect(cost).toBeCloseTo(0.002)
	})

	test("returns 0 when cache is null", () => {
		const usage = { inputTokens: 1000, outputTokens: 200 }
		expect(estimateCostFromUsage(usage, "anthropic", "claude-haiku-4-5", null)).toBe(0)
	})

	test("returns 0 for unknown provider", () => {
		const usage = { inputTokens: 1000, outputTokens: 200 }
		expect(estimateCostFromUsage(usage, "deepseek", "deepseek-v3", mockCache)).toBe(0)
	})

	test("returns 0 for unknown model", () => {
		const usage = { inputTokens: 1000, outputTokens: 200 }
		expect(estimateCostFromUsage(usage, "anthropic", "unknown-model", mockCache)).toBe(0)
	})

	test("handles zero tokens", () => {
		const usage = { inputTokens: 0, outputTokens: 0 }
		expect(estimateCostFromUsage(usage, "anthropic", "claude-haiku-4-5", mockCache)).toBe(0)
	})
})

// ── getDailyDigest ────────────────────────────────────────────────────

describe("getDailyDigest", () => {
	test("returns correct digest from state", () => {
		const state = makeState({
			dailyBudgetUsd: 10.0,
			spentTodayUsd: 3.5,
			sessionsToday: 5,
			triagesToday: 20,
			scansToday: 2,
			x402SpentTodayUsd: 0.5,
		})
		const digest = getDailyDigest(state)
		expect(digest.dailyBudgetUsd).toBe(10.0)
		expect(digest.spentTodayUsd).toBe(3.5)
		expect(digest.remainingUsd).toBe(6.5)
		expect(digest.sessions).toBe(5)
		expect(digest.triages).toBe(20)
		expect(digest.scans).toBe(2)
		expect(digest.x402SpentUsd).toBe(0.5)
	})

	test("remaining is 0 when fully spent", () => {
		const state = makeState({ dailyBudgetUsd: 5.0, spentTodayUsd: 5.0 })
		const digest = getDailyDigest(state)
		expect(digest.remainingUsd).toBe(0)
	})
})
