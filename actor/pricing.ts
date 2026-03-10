import type { ModelPricingCache, TokenUsage } from "./types"

// ── models.dev Pricing Oracle ─────────────────────────────────────────

const MODELS_DEV_URL = "https://models.dev/api.json"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Fetch model pricing from models.dev. Returns cached data if fresh.
 * Community-maintained, open-source pricing database.
 */
export async function fetchModelPricing(
	existingCache: ModelPricingCache | null,
): Promise<ModelPricingCache> {
	// Return cache if fresh
	if (existingCache && Date.now() - existingCache.fetchedAt < CACHE_TTL_MS) {
		return existingCache
	}

	const res = await fetch(MODELS_DEV_URL)
	if (!res.ok) {
		// If fetch fails and we have stale cache, use it
		if (existingCache) return existingCache
		throw new Error(`Failed to fetch model pricing: ${res.status}`)
	}

	const data = (await res.json()) as ModelPricingCache["data"]
	return { data, fetchedAt: Date.now() }
}

/**
 * Look up cost per million tokens for a provider + model.
 * Returns { input, output } in $/Mtok.
 */
export function lookupCost(
	cache: ModelPricingCache,
	provider: string,
	model: string,
): { input: number; output: number } | null {
	const providerData = cache.data[provider]
	if (!providerData) return null

	const modelData = providerData.models[model]
	if (!modelData?.cost) return null

	return { input: modelData.cost.input, output: modelData.cost.output }
}

/**
 * Calculate actual cost from token usage and models.dev pricing.
 * Returns cost in USD.
 */
export function calculateCost(
	cache: ModelPricingCache,
	provider: string,
	model: string,
	usage: TokenUsage,
): number {
	const cost = lookupCost(cache, provider, model)
	if (!cost) return 0

	// models.dev costs are $/Mtok
	return (usage.inputTokens * cost.input + usage.outputTokens * cost.output) / 1_000_000
}
