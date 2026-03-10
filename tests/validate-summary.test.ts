import { describe, expect, test } from "bun:test"
import { validateSummary } from "../actor/drain"
import type { PositionUpdate, SessionSummary } from "../actor/types"

// ── Fixtures ──────────────────────────────────────────────────────────

function makeValidSummary(overrides?: Partial<SessionSummary>): SessionSummary {
	return {
		id: "session-001",
		triggerSignalId: "signal-001",
		tensionAtTrigger: 0.75,
		startedAt: Date.now() - 60_000,
		completedAt: Date.now(),
		newPositions: [],
		updatedPositions: [
			{
				slug: "test-pos",
				text: "Position text",
				confidence: 0.8,
				surpriseDelta: 0.2,
				priorConfidence: 0.6,
				status: "settled",
			},
		],
		newInquiries: [],
		layersApplied: ["signal-evaluation", "belief-updating", "sensemaking"],
		signalCredibility: 0.9,
		sessionNarrative: "Test narrative",
		domainTrajectory: "Stable",
		watchSignals: [],
		artifacts: { pullRequests: [] },
		...overrides,
	}
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("validateSummary", () => {
	test("accepts valid summary", () => {
		expect(validateSummary(makeValidSummary())).toBe(true)
	})

	test("rejects missing triggerSignalId", () => {
		expect(validateSummary(makeValidSummary({ triggerSignalId: "" }))).toBe(false)
	})

	test("rejects summary without signal-evaluation layer", () => {
		expect(
			validateSummary(makeValidSummary({ layersApplied: ["belief-updating", "sensemaking"] })),
		).toBe(false)
	})

	test("rejects position with empty slug", () => {
		expect(
			validateSummary(
				makeValidSummary({
					updatedPositions: [
						{
							slug: "",
							text: "Text",
							confidence: 0.5,
							surpriseDelta: 0.1,
							priorConfidence: 0.4,
							status: "settled",
						},
					],
				}),
			),
		).toBe(false)
	})

	test("rejects position with undefined confidence", () => {
		expect(
			validateSummary(
				makeValidSummary({
					newPositions: [
						{
							slug: "valid-slug",
							text: "Text",
							confidence: undefined as unknown as number,
							surpriseDelta: 0.1,
							priorConfidence: 0.4,
							status: "settled",
						},
					],
				}),
			),
		).toBe(false)
	})

	test("accepts summary with no positions (inquiry-only session)", () => {
		expect(
			validateSummary(
				makeValidSummary({
					newPositions: [],
					updatedPositions: [],
				}),
			),
		).toBe(true)
	})

	test("validates both newPositions and updatedPositions", () => {
		// Valid updatedPositions but invalid newPosition
		expect(
			validateSummary(
				makeValidSummary({
					newPositions: [
						{
							slug: "",
							text: "Bad",
							confidence: 0.5,
							surpriseDelta: 0.1,
							priorConfidence: 0.4,
							status: "settled",
						},
					],
				}),
			),
		).toBe(false)
	})

	test("accepts summary with multiple valid positions", () => {
		const positions: PositionUpdate[] = [
			{
				slug: "pos-a",
				text: "A",
				confidence: 0.8,
				surpriseDelta: 0.2,
				priorConfidence: 0.6,
				status: "settled",
			},
			{
				slug: "pos-b",
				text: "B",
				confidence: 0.7,
				surpriseDelta: 0.3,
				priorConfidence: 0.4,
				status: "under_interrogation",
			},
			{
				slug: "pos-c",
				text: "C",
				confidence: 0.9,
				surpriseDelta: 0.1,
				priorConfidence: 0.8,
				status: "settled",
			},
		]
		expect(validateSummary(makeValidSummary({ updatedPositions: positions }))).toBe(true)
	})

	test("accepts confidence of 0 (valid value, just very low)", () => {
		expect(
			validateSummary(
				makeValidSummary({
					updatedPositions: [
						{
							slug: "zero-conf",
							text: "Very uncertain",
							confidence: 0,
							surpriseDelta: 0.5,
							priorConfidence: 0.5,
							status: "under_interrogation",
						},
					],
				}),
			),
		).toBe(true)
	})
})
