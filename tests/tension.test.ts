import { describe, expect, test } from "bun:test"
import { cosineSimilarity, isDomainRelevant } from "../actor/tension"
import type { Domain, IngestSignal } from "../actor/types"

// ── Fixtures ──────────────────────────────────────────────────────────

function makeSignal(content: string, overrides?: Partial<IngestSignal>): IngestSignal {
	return {
		id: "test-signal",
		sourceProvider: "exa",
		sourceMode: "webhook",
		content,
		urgency: "medium",
		credibility: 0.8,
		timestamp: Date.now(),
		...overrides,
	}
}

const domain: Domain = {
	name: "solar energy",
	description:
		"Residential solar installation economics, net energy metering policy, and battery storage performance",
	boundaries: ["NEM 3.0", "California solar", "LFP battery"],
	adjacencies: ["EV charging", "grid infrastructure"],
}

// ── Cosine Similarity ─────────────────────────────────────────────────

describe("cosineSimilarity", () => {
	test("identical vectors return 1.0", () => {
		const v = new Float32Array([1, 2, 3, 4])
		expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5)
	})

	test("orthogonal vectors return 0.0", () => {
		const a = new Float32Array([1, 0, 0])
		const b = new Float32Array([0, 1, 0])
		expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
	})

	test("opposite vectors return -1.0", () => {
		const a = new Float32Array([1, 0, 0])
		const b = new Float32Array([-1, 0, 0])
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
	})

	test("zero vector returns 0 (no division by zero)", () => {
		const a = new Float32Array([0, 0, 0])
		const b = new Float32Array([1, 2, 3])
		expect(cosineSimilarity(a, b)).toBe(0)
	})

	test("scaled vectors have similarity 1.0", () => {
		const a = new Float32Array([1, 2, 3])
		const b = new Float32Array([2, 4, 6])
		expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
	})

	test("partially similar vectors return intermediate value", () => {
		const a = new Float32Array([1, 1, 0])
		const b = new Float32Array([1, 0, 1])
		const sim = cosineSimilarity(a, b)
		expect(sim).toBeGreaterThan(0)
		expect(sim).toBeLessThan(1)
	})
})

// ── Domain Relevance Gate ─────────────────────────────────────────────

describe("isDomainRelevant", () => {
	test("matches on boundary keyword", () => {
		const signal = makeSignal("New NEM 3.0 rules announced today")
		expect(isDomainRelevant(signal, domain, [])).toBe(true)
	})

	test("matches case-insensitively on boundaries", () => {
		const signal = makeSignal("lfp battery prices dropping fast")
		expect(isDomainRelevant(signal, domain, [])).toBe(true)
	})

	test("matches on description keyword (>4 chars)", () => {
		const signal = makeSignal("New residential solar installation trends")
		expect(isDomainRelevant(signal, domain, [])).toBe(true)
	})

	test("does not match short description words", () => {
		// "and", "net" are <= 4 chars, should not match alone
		const signal = makeSignal("The net and the web are connected")
		// "energy" (6 chars) from description would match
		// but this signal doesn't contain "energy", "solar", "residential", etc.
		// It does contain "net" (3 chars, skipped) and "and" (3 chars, skipped)
		// "metering" (8 chars) not present, "policy" (6 chars) not present
		// "battery" (7 chars) not present, "storage" (7 chars) not present
		// "performance" (11 chars) not present
		// "residential" (11 chars) not present, "solar" (5 chars) not present
		// "installation" (12 chars) not present, "economics" (9 chars) not present
		expect(isDomainRelevant(signal, domain, [])).toBe(false)
	})

	test("matches on position slug terms (>= 2 matching)", () => {
		const signal = makeSignal("export value analysis for northern regions")
		const slugs = ["nem-3-export-value-norcal"]
		// slug terms: "export" (6), "value" (5), "norcal" (6) — "nem" (3) skipped
		// signal contains "export" and "value" -> 2 matches -> true
		expect(isDomainRelevant(signal, domain, slugs)).toBe(true)
	})

	test("single slug term match is insufficient", () => {
		const signal = makeSignal("The value of good coffee")
		const slugs = ["nem-3-export-value-norcal"]
		// Only "value" matches — need >= 2
		expect(isDomainRelevant(signal, domain, slugs)).toBe(false)
	})

	test("completely off-domain signal rejected", () => {
		const signal = makeSignal("Taylor Swift concert tickets on sale tomorrow")
		expect(isDomainRelevant(signal, domain, [])).toBe(false)
	})

	test("adjacency terms do not trigger relevance", () => {
		// Adjacencies are not checked by isDomainRelevant
		const signal = makeSignal("EV charging station deployment plans")
		// "charging" is not in boundaries or description keywords > 4 chars
		// Wait — "charging" doesn't appear in boundaries but let's check description
		// Description: "Residential solar installation economics, net energy metering policy, and battery storage performance"
		// No "charging" — correct, should be false (unless slug matches)
		expect(isDomainRelevant(signal, domain, [])).toBe(false)
	})
})
