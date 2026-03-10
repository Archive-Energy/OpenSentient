import type { BudgetState, CostRecord, ModelPricingCache, SentientState, TokenUsage } from "./types"

// ── Budget Defaults ───────────────────────────────────────────────────

export const DEFAULT_BUDGET: BudgetState = {
	dailyBudgetUsd: 5.0,
	x402AllocationPct: 10,
	spentTodayUsd: 0,
	lastResetAt: 0,
	sessionsToday: 0,
	triagesToday: 0,
	scansToday: 0,
	x402SpentTodayUsd: 0,
}

// ── Reset ─────────────────────────────────────────────────────────────

/** Reset daily counters if we've crossed midnight UTC. */
export function resetBudgetIfNewDay(state: SentientState): boolean {
	const now = Date.now()
	const lastReset = new Date(state.budgetState.lastResetAt)
	const today = new Date(now)

	const isNewDay =
		state.budgetState.lastResetAt === 0 ||
		lastReset.getUTCDate() !== today.getUTCDate() ||
		lastReset.getUTCMonth() !== today.getUTCMonth() ||
		lastReset.getUTCFullYear() !== today.getUTCFullYear()

	if (isNewDay) {
		state.budgetState.spentTodayUsd = 0
		state.budgetState.sessionsToday = 0
		state.budgetState.triagesToday = 0
		state.budgetState.scansToday = 0
		state.budgetState.x402SpentTodayUsd = 0
		state.budgetState.lastResetAt = now
		return true
	}
	return false
}

// ── Budget Check ──────────────────────────────────────────────────────

/** Estimated cost per operation type (USD). Updated by cost-calibration skill. */
export interface CostProfile {
	triageAvg: number
	scanAvg: number
	sessionAvg: number
	embeddingAvg: number
}

export const DEFAULT_COST_PROFILE: CostProfile = {
	triageAvg: 0.003,
	scanAvg: 0.07,
	sessionAvg: 0.15,
	embeddingAvg: 0.001,
}

/** Check if the budget allows the given operation. */
export function checkBudget(
	state: SentientState,
	costType: CostRecord["type"],
	costProfile: CostProfile = DEFAULT_COST_PROFILE,
): boolean {
	const budget = state.budgetState
	const remaining = budget.dailyBudgetUsd - budget.spentTodayUsd

	// x402 purchases have their own allocation
	if (costType === "x402_purchase") {
		const x402Budget = (budget.dailyBudgetUsd * budget.x402AllocationPct) / 100
		return budget.x402SpentTodayUsd < x402Budget
	}

	const estimatedCost: Record<string, number> = {
		triage: costProfile.triageAvg,
		scan: costProfile.scanAvg,
		session: costProfile.sessionAvg,
		embedding: costProfile.embeddingAvg,
	}

	return remaining >= (estimatedCost[costType] ?? 0)
}

// ── Cost Recording ────────────────────────────────────────────────────

/** Record a cost against the daily budget. Returns the cost in USD. */
export function recordCost(state: SentientState, record: CostRecord): void {
	state.budgetState.spentTodayUsd += record.costUsd

	switch (record.type) {
		case "triage":
			state.budgetState.triagesToday++
			break
		case "scan":
			state.budgetState.scansToday++
			break
		case "session":
			state.budgetState.sessionsToday++
			break
		case "x402_purchase":
			state.budgetState.x402SpentTodayUsd += record.costUsd
			break
	}
}

// ── Cost Estimation ───────────────────────────────────────────────────

/** Estimate cost from token usage using models.dev pricing cache. */
export function estimateCostFromUsage(
	usage: TokenUsage,
	provider: string,
	model: string,
	pricingCache: ModelPricingCache | null,
): number {
	if (!pricingCache) return 0

	const providerData = pricingCache.data[provider]
	if (!providerData) return 0

	const modelData = providerData.models[model]
	if (!modelData) return 0

	// models.dev costs are $/Mtok
	const inputCost = (usage.inputTokens * modelData.cost.input) / 1_000_000
	const outputCost = (usage.outputTokens * modelData.cost.output) / 1_000_000

	return inputCost + outputCost
}

// ── Daily Digest ──────────────────────────────────────────────────────

export interface DailyDigest {
	dailyBudgetUsd: number
	spentTodayUsd: number
	remainingUsd: number
	sessions: number
	triages: number
	scans: number
	x402SpentUsd: number
}

export function getDailyDigest(state: SentientState): DailyDigest {
	const budget = state.budgetState
	return {
		dailyBudgetUsd: budget.dailyBudgetUsd,
		spentTodayUsd: budget.spentTodayUsd,
		remainingUsd: budget.dailyBudgetUsd - budget.spentTodayUsd,
		sessions: budget.sessionsToday,
		triages: budget.triagesToday,
		scans: budget.scansToday,
		x402SpentUsd: budget.x402SpentTodayUsd,
	}
}
