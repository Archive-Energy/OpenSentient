import { resolveEndpoint, resolveProviderKey } from "./inference"
import type { Domain, IngestSignal, ModelRole, TokenUsage } from "./types"

// ── Domain Relevance Gate ─────────────────────────────────────────────

// Common English words that should never trigger domain relevance on their own
const STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"being",
	"between",
	"could",
	"different",
	"every",
	"first",
	"found",
	"great",
	"having",
	"house",
	"important",
	"intelligence",
	"large",
	"might",
	"never",
	"number",
	"other",
	"people",
	"place",
	"point",
	"right",
	"should",
	"small",
	"still",
	"story",
	"their",
	"there",
	"these",
	"thing",
	"think",
	"those",
	"three",
	"through",
	"under",
	"using",
	"value",
	"water",
	"where",
	"which",
	"while",
	"world",
	"would",
	"write",
	"years",
])

/** Word-boundary-aware check: ensures the term appears as a whole word, not a substring. */
function containsWholeWord(text: string, term: string): boolean {
	const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
	return pattern.test(text)
}

export function isDomainRelevant(
	signal: IngestSignal,
	domain: Domain,
	positionSlugs: string[],
): boolean {
	const text = signal.content.toLowerCase()

	// Check domain boundaries (these are explicit terms — trust them)
	for (const boundary of domain.boundaries) {
		if (containsWholeWord(text, boundary)) return true
	}

	// Check domain description keywords — require multiple matches to reduce false positives
	const domainTerms = domain.description
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 5 && !STOP_WORDS.has(t))
	let domainHits = 0
	for (const term of domainTerms) {
		if (containsWholeWord(text, term)) domainHits++
	}
	if (domainHits >= 2) return true

	// Check existing position slugs as domain vocabulary
	for (const slug of positionSlugs) {
		const slugTerms = slug.split("-").filter((t) => t.length > 4 && !STOP_WORDS.has(t))
		const matches = slugTerms.filter((t) => containsWholeWord(text, t))
		if (matches.length >= 2) return true
	}

	return false
}

// ── Embedding ─────────────────────────────────────────────────────────

export async function embed(
	text: string,
	config: ModelRole,
): Promise<{ embedding: Float32Array; usage: TokenUsage }> {
	const key = resolveProviderKey(config.provider ?? "openrouter")
	const endpoint = resolveEndpoint(config.provider ?? "openrouter")

	const res = await fetch(`${endpoint}/embeddings`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.name,
			input: text,
			dimensions: config.dimensions,
		}),
	})

	if (!res.ok) {
		const body = await res.text()
		throw new Error(`Embedding failed (${res.status}): ${body}`)
	}

	const data = (await res.json()) as {
		data: Array<{ embedding: number[] }>
		usage?: { prompt_tokens?: number; total_tokens?: number }
	}
	return {
		embedding: new Float32Array(data.data[0].embedding),
		usage: {
			inputTokens: data.usage?.prompt_tokens ?? 0,
			outputTokens: 0, // embeddings have no output tokens
		},
	}
}

// ── Cosine Similarity ─────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0
	let normA = 0
	let normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}

// ── Tension Evaluation ────────────────────────────────────────────────

export async function evaluateTension(
	signal: IngestSignal,
	domain: Domain,
	positionSlugs: string[],
	positionEmbeddings: Float32Array[],
	embeddingConfig: ModelRole,
	signalWeights: Record<string, number>,
): Promise<{ tension: number; embeddingCost: TokenUsage; signalEmbedding?: Float32Array }> {
	const zeroCost: TokenUsage = { inputTokens: 0, outputTokens: 0 }

	// Manual /run or owner correction — always trigger
	if (signal.sourceMode === "command" || signal.sourceProvider === "correction") {
		return { tension: 1.0, embeddingCost: zeroCost }
	}

	// First session — no positions yet, everything is novel
	if (positionSlugs.length === 0) return { tension: 1.0, embeddingCost: zeroCost }

	// Domain relevance gate — free, instant
	if (!isDomainRelevant(signal, domain, positionSlugs)) {
		return { tension: 0.0, embeddingCost: zeroCost }
	}

	// Embed signal
	const { embedding: signalEmbedding, usage: embeddingUsage } = await embed(
		signal.content,
		embeddingConfig,
	)

	// Find max similarity against existing positions
	let maxSimilarity = 0
	for (const posEmbedding of positionEmbeddings) {
		const sim = cosineSimilarity(signalEmbedding, posEmbedding)
		if (sim > maxSimilarity) maxSimilarity = sim
	}

	// Tension = novelty × source weight
	const sourceWeight = signalWeights[signal.sourceProvider] ?? 1.0
	const tension = (1 - maxSimilarity) * sourceWeight

	return { tension, embeddingCost: embeddingUsage, signalEmbedding }
}
