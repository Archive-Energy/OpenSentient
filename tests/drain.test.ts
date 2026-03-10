import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import {
	calibrationEntryToMarkdown,
	commitProof,
	inquiryToMarkdown,
	positionToMarkdown,
	rejectProof,
	sessionRecordToMarkdown,
	validateSummary,
} from "../actor/drain"
import type {
	CalibrationEvent,
	InquiryUpdate,
	PositionProofOfWork,
	PositionUpdate,
	SessionSummary,
} from "../actor/types"

// ── Fixtures ──────────────────────────────────────────────────────────

function makePosition(overrides?: Partial<PositionUpdate>): PositionUpdate {
	return {
		slug: "test-position",
		text: "Test position text",
		confidence: 0.8,
		surpriseDelta: 0.2,
		priorConfidence: 0.6,
		status: "settled",
		wikilinks: ["related-position"],
		...overrides,
	}
}

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
	return {
		id: "session-001",
		triggerSignalId: "signal-001",
		tensionAtTrigger: 0.75,
		startedAt: Date.now() - 60_000,
		completedAt: Date.now(),
		newPositions: [],
		updatedPositions: [makePosition()],
		newInquiries: [],
		layersApplied: ["signal-evaluation", "belief-updating", "sensemaking"],
		signalCredibility: 0.9,
		sessionNarrative: "Test session narrative",
		domainTrajectory: "Stable",
		watchSignals: ["watch-this"],
		artifacts: { pullRequests: [] },
		...overrides,
	}
}

function makeProof(overrides?: Partial<PositionProofOfWork>): PositionProofOfWork {
	return {
		index: 1,
		slug: "test-position",
		sourceSignalId: "signal-001",
		priorConfidence: 0.6,
		posteriorConfidence: 0.85,
		surpriseDelta: 0.5,
		text: "Updated position text",
		sessionId: "session-001",
		...overrides,
	}
}

function makeMockDb() {
	const calls: Array<{ sql: string; params: unknown[] }> = []
	return {
		calls,
		execute: async (sql: string, ...params: unknown[]) => {
			calls.push({ sql, params })
			return []
		},
	}
}

function makeMockBroadcast() {
	const events: Array<{ event: string; payload: CalibrationEvent }> = []
	return {
		events,
		fn: (event: string, payload: CalibrationEvent) => {
			events.push({ event, payload })
		},
	}
}

// ── Markdown Round-Trip ───────────────────────────────────────────────

describe("positionToMarkdown", () => {
	test("produces valid frontmatter with all fields", () => {
		const md = positionToMarkdown(makePosition(), "session-001")
		const { data, content } = matter(md)

		expect(data.id).toBe("test-position")
		expect(data.confidence).toBe(0.8)
		expect(data.surprise_delta).toBe(0.2)
		expect(data.status).toBe("settled")
		expect(data.source_session).toBe("record/session-001.md")
		expect(data.public).toBe(false)
		expect(content).toContain("Test position text")
	})

	test("includes wikilinks in Related section", () => {
		const md = positionToMarkdown(makePosition(), "session-001")
		expect(md).toContain("## Related")
		expect(md).toContain("[[related-position]]")
	})

	test("omits Related section when no wikilinks", () => {
		const md = positionToMarkdown(makePosition({ wikilinks: undefined }), "session-001")
		expect(md).not.toContain("## Related")
	})
})

describe("inquiryToMarkdown", () => {
	test("produces valid frontmatter", () => {
		const inquiry: InquiryUpdate = {
			slug: "test-inquiry",
			text: "What about this?",
			tension: 0.75,
			status: "open",
			relatedPositions: ["pos-a", "pos-b"],
		}
		const md = inquiryToMarkdown(inquiry)
		const { data, content } = matter(md)

		expect(data.id).toBe("test-inquiry")
		expect(data.tension).toBe(0.75)
		expect(data.status).toBe("open")
		expect(content).toContain("What about this?")
		expect(md).toContain("[[pos-a]]")
		expect(md).toContain("[[pos-b]]")
	})
})

describe("sessionRecordToMarkdown", () => {
	test("includes all sections", () => {
		const md = sessionRecordToMarkdown(makeSummary())
		const { data } = matter(md)

		expect(data.id).toBe("session-001")
		expect(data.trigger_signal_id).toBe("signal-001")
		expect(md).toContain("## Positions Updated")
		expect(md).toContain("## Inquiries Opened")
		expect(md).toContain("## Narrative")
		expect(md).toContain("Test session narrative")
		expect(md).toContain("## Watch Signals")
	})

	test("shows position deltas", () => {
		const md = sessionRecordToMarkdown(makeSummary())
		expect(md).toContain("[[test-position]]")
		expect(md).toContain("0.60 -> 0.80")
	})
})

describe("calibrationEntryToMarkdown", () => {
	test("includes type and slug", () => {
		const md = calibrationEntryToMarkdown("proof_accepted", "test-pos", { score: 0.9 })
		const { data, content } = matter(md)

		expect(data.type).toBe("proof_accepted")
		expect(data.slug).toBe("test-pos")
		expect(data.actor).toBe("owner")
		expect(content).toContain('"score": 0.9')
	})
})

// ── Proof-of-Work Gate ────────────────────────────────────────────────

describe("commitProof", () => {
	test("removes proof from pending and broadcasts", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof()
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position")

		expect(state.pendingProofs).toHaveLength(0)
		expect(broadcast.events).toHaveLength(1)
		expect(broadcast.events[0].payload.type).toBe("proofAccepted")
	})

	test("throws on unknown slug", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const state = { pendingProofs: [], calibrationThreshold: 0.4, sessionCount: 0 }

		expect(commitProof({ db, state, broadcast: broadcast.fn }, "nonexistent")).rejects.toThrow(
			"No pending proof",
		)
	})

	test("reindexes remaining proofs after removal", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proofs = [
			makeProof({ index: 1, slug: "pos-a" }),
			makeProof({ index: 2, slug: "pos-b" }),
			makeProof({ index: 3, slug: "pos-c" }),
		]
		const state = { pendingProofs: proofs, calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "pos-b")

		expect(state.pendingProofs).toHaveLength(2)
		expect(state.pendingProofs[0].index).toBe(1)
		expect(state.pendingProofs[0].slug).toBe("pos-a")
		expect(state.pendingProofs[1].index).toBe(2)
		expect(state.pendingProofs[1].slug).toBe("pos-c")
	})

	test("accepts without override — broadcasts proofAccepted", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const state = { pendingProofs: [makeProof()], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position")

		expect(broadcast.events[0].payload.type).toBe("proofAccepted")
	})

	test("accepts with confidence override — broadcasts proofAdjusted", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof({ posteriorConfidence: 0.85 })
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position", 0.72)

		expect(broadcast.events[0].payload.type).toBe("proofAdjusted")
		expect((broadcast.events[0].payload as { finalConfidence: number }).finalConfidence).toBe(0.72)
	})

	test("override writes adjusted confidence to db", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof({ posteriorConfidence: 0.85 })
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position", 0.72)

		// First db call is UPDATE positions with the override confidence
		const updateCall = db.calls.find((c) => c.sql.includes("UPDATE positions"))
		expect(updateCall).toBeDefined()
		expect(updateCall?.params[0]).toBe(0.72)
	})

	test("override matching proposed confidence is not treated as adjusted", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof({ posteriorConfidence: 0.85 })
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position", 0.85)

		// Same value as proposed — should be proofAccepted, not proofAdjusted
		expect(broadcast.events[0].payload.type).toBe("proofAccepted")
	})

	test("calibration log includes overrideDelta when adjusted", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof({ posteriorConfidence: 0.85 })
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		await commitProof({ db, state, broadcast: broadcast.fn }, "test-position", 0.72)

		const calInsert = db.calls.find((c) => c.sql.includes("INSERT INTO calibration"))
		expect(calInsert).toBeDefined()
		// Type should be proof_adjusted
		expect(calInsert?.params[1]).toBe("proof_adjusted")
		// Detail JSON should contain overrideDelta
		const detail = JSON.parse(calInsert?.params[3] as string)
		expect(detail.overrideDelta).toBeCloseTo(-0.13, 2)
		expect(detail.finalConfidence).toBe(0.72)
		expect(detail.proposedConfidence).toBe(0.85)
	})

	test("throws on confidence override above 1", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const state = { pendingProofs: [makeProof()], calibrationThreshold: 0.4, sessionCount: 1 }

		expect(
			commitProof({ db, state, broadcast: broadcast.fn }, "test-position", 1.5),
		).rejects.toThrow("Confidence must be between 0 and 1")
	})

	test("throws on confidence override below 0", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const state = { pendingProofs: [makeProof()], calibrationThreshold: 0.4, sessionCount: 1 }

		expect(
			commitProof({ db, state, broadcast: broadcast.fn }, "test-position", -0.1),
		).rejects.toThrow("Confidence must be between 0 and 1")
	})

	test("allows confidence override at boundaries (0 and 1)", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()

		const state0 = {
			pendingProofs: [makeProof({ slug: "pos-a" })],
			calibrationThreshold: 0.4,
			sessionCount: 1,
		}
		await commitProof({ db, state: state0, broadcast: broadcast.fn }, "pos-a", 0)
		expect(state0.pendingProofs).toHaveLength(0)

		const state1 = {
			pendingProofs: [makeProof({ slug: "pos-b" })],
			calibrationThreshold: 0.4,
			sessionCount: 1,
		}
		await commitProof({ db, state: state1, broadcast: broadcast.fn }, "pos-b", 1)
		expect(state1.pendingProofs).toHaveLength(0)
	})
})

describe("rejectProof", () => {
	test("returns correction signal with credibility 1.0", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const proof = makeProof()
		const state = { pendingProofs: [proof], calibrationThreshold: 0.4, sessionCount: 1 }

		const signal = await rejectProof(
			{ db, state, broadcast: broadcast.fn },
			"test-position",
			"This is wrong because X",
		)

		expect(signal.credibility).toBe(1.0)
		expect(signal.sourceProvider).toBe("correction")
		expect(signal.urgency).toBe("high")
		expect(signal.content).toContain("test-position")
		expect(signal.content).toContain("This is wrong because X")
		expect(state.pendingProofs).toHaveLength(0)
	})

	test("broadcasts proofRejected with note", async () => {
		const db = makeMockDb()
		const broadcast = makeMockBroadcast()
		const state = { pendingProofs: [makeProof()], calibrationThreshold: 0.4, sessionCount: 1 }

		await rejectProof({ db, state, broadcast: broadcast.fn }, "test-position", "bad data")

		const event = broadcast.events.find((e) => e.payload.type === "proofRejected")
		expect(event).toBeDefined()
		expect((event?.payload as { note: string }).note).toBe("bad data")
	})
})
