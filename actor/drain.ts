import type {
	ActorDb,
	CalibrationEvent,
	IngestSignal,
	InquiryUpdate,
	PositionProofOfWork,
	PositionUpdate,
	SessionSummary,
} from "./types"

// ── Summary Validation ────────────────────────────────────────────────

export function validateSummary(summary: SessionSummary): boolean {
	if (!summary.triggerSignalId) return false
	if (!summary.layersApplied.includes("signal-evaluation")) return false

	for (const p of [...summary.newPositions, ...summary.updatedPositions]) {
		if (!p.slug || p.confidence === undefined) return false
	}

	return true
}

// ── Markdown Helpers ──────────────────────────────────────────────────

export function positionToMarkdown(p: PositionUpdate, sessionId: string): string {
	const wikilinks = p.wikilinks?.map((w) => `[[${w}]]`).join(", ") ?? ""
	return [
		"---",
		`id: ${p.slug}`,
		`confidence: ${p.confidence}`,
		`surprise_delta: ${p.surpriseDelta}`,
		`status: ${p.status}`,
		`source_session: record/${sessionId}.md`,
		`updated_at: ${new Date().toISOString()}`,
		"public: false",
		"---",
		"",
		p.text,
		"",
		wikilinks ? `## Related\n${wikilinks}` : "",
	]
		.filter(Boolean)
		.join("\n")
}

export function inquiryToMarkdown(i: InquiryUpdate): string {
	const related = i.relatedPositions.map((r) => `[[${r}]]`).join(", ")
	return [
		"---",
		`id: ${i.slug}`,
		`tension: ${i.tension}`,
		`status: ${i.status}`,
		`updated_at: ${new Date().toISOString()}`,
		"---",
		"",
		i.text,
		"",
		related ? `## Related Positions\n${related}` : "",
	]
		.filter(Boolean)
		.join("\n")
}

export function sessionRecordToMarkdown(summary: SessionSummary): string {
	const positions = [...summary.newPositions, ...summary.updatedPositions]
		.map(
			(p) =>
				`- [[${p.slug}]]: ${p.priorConfidence.toFixed(2)} -> ${p.confidence.toFixed(2)} (delta ${p.surpriseDelta.toFixed(2)})`,
		)
		.join("\n")

	const inquiries = summary.newInquiries
		.map((i) => `- [[${i.slug}]]: tension ${i.tension.toFixed(2)}`)
		.join("\n")

	const prs = summary.artifacts.pullRequests
		.map((pr) => `- [${pr.title}](${pr.url}) — ${pr.filesChanged} files`)
		.join("\n")

	return [
		"---",
		`id: ${summary.id}`,
		`trigger_signal_id: ${summary.triggerSignalId}`,
		`tension_at_trigger: ${summary.tensionAtTrigger}`,
		`started_at: ${new Date(summary.startedAt).toISOString()}`,
		`completed_at: ${new Date(summary.completedAt).toISOString()}`,
		`positions_updated: ${positions.length}`,
		`inquiries_opened: ${summary.newInquiries.length}`,
		`layers_applied: [${summary.layersApplied.join(", ")}]`,
		"---",
		"",
		`# Session ${summary.id}`,
		"",
		"## Positions Updated",
		positions || "_None_",
		"",
		"## Inquiries Opened",
		inquiries || "_None_",
		"",
		"## Pull Requests",
		prs || "_None_",
		"",
		"## Narrative",
		summary.sessionNarrative,
		"",
		"## Domain Trajectory",
		summary.domainTrajectory,
		"",
		"## Watch Signals",
		summary.watchSignals.map((s) => `- ${s}`).join("\n") || "_None_",
	].join("\n")
}

export function calibrationEntryToMarkdown(
	type: string,
	slug: string,
	detail: Record<string, unknown>,
): string {
	const id = `${type}-${slug}-${crypto.randomUUID()}`
	return [
		"---",
		`id: ${id}`,
		`type: ${type}`,
		`slug: ${slug}`,
		"actor: owner",
		`created_at: ${new Date().toISOString()}`,
		"---",
		"",
		JSON.stringify(detail, null, 2),
	].join("\n")
}

// ── Drain Context & Shared Helpers ────────────────────────────────────

interface DrainContext {
	db: ActorDb
	state: {
		pendingProofs: PositionProofOfWork[]
		calibrationThreshold: number
		sessionCount: number
	}
	broadcast: (event: string, payload: CalibrationEvent) => void
}

type DrainResult = { proofsSurfaced: PositionProofOfWork[]; autoCommitted: PositionUpdate[] }

/** Pending file write accumulated during drain, flushed after SQLite commit. */
interface PendingWrite {
	path: string
	content: string
}

/** Shared position drain: proof gate, SQLite upserts, pending markdown writes. */
async function drainPositions(
	ctx: DrainContext,
	positions: PositionUpdate[],
	sessionId: string,
	triggerSignalId: string,
	pendingWrites: PendingWrite[],
): Promise<DrainResult> {
	const proofsSurfaced: PositionProofOfWork[] = []
	const autoCommitted: PositionUpdate[] = []

	for (const position of positions) {
		if (position.surpriseDelta > ctx.state.calibrationThreshold) {
			const proof: PositionProofOfWork = {
				index: ctx.state.pendingProofs.length + proofsSurfaced.length + 1,
				slug: position.slug,
				sourceSignalId: triggerSignalId,
				priorConfidence: position.priorConfidence,
				posteriorConfidence: position.confidence,
				surpriseDelta: position.surpriseDelta,
				text: position.text,
				sessionId,
			}
			proofsSurfaced.push(proof)
			position.status = "pending_review"
			ctx.broadcast("calibrationEvent", { type: "proofSurfaced", proof })
		} else {
			autoCommitted.push(position)
		}

		pendingWrites.push({
			path: `knowledge/positions/${position.slug}.md`,
			content: positionToMarkdown(position, sessionId),
		})
	}

	// SQLite position upserts
	for (const p of positions) {
		await ctx.db.execute(
			`INSERT INTO positions (slug, confidence, surprise_delta, status, source_session, text, wikilinks, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET
         confidence = excluded.confidence,
         surprise_delta = excluded.surprise_delta,
         status = excluded.status,
         source_session = excluded.source_session,
         text = excluded.text,
         wikilinks = excluded.wikilinks,
         updated_at = datetime('now')`,
			p.slug,
			p.confidence,
			p.surpriseDelta,
			p.status,
			`record/${sessionId}.md`,
			p.text,
			JSON.stringify(p.wikilinks ?? []),
		)
	}

	ctx.state.pendingProofs.push(...proofsSurfaced)
	ctx.state.sessionCount += 1

	return { proofsSurfaced, autoCommitted }
}

/** Flush pending writes to disk. Called after successful SQLite commit. */
async function flushWrites(writes: PendingWrite[]): Promise<void> {
	for (const w of writes) {
		await Bun.write(w.path, w.content)
	}
}

// ── Drain Session ─────────────────────────────────────────────────────

export async function drainSession(
	ctx: DrainContext,
	summary: SessionSummary,
): Promise<DrainResult> {
	const allPositions = [...summary.newPositions, ...summary.updatedPositions]
	const pendingWrites: PendingWrite[] = []

	// Queue session record markdown
	pendingWrites.push({
		path: `knowledge/record/${summary.id}.md`,
		content: sessionRecordToMarkdown(summary),
	})

	// Queue inquiry markdown
	for (const inquiry of summary.newInquiries) {
		pendingWrites.push({
			path: `knowledge/inquiries/${inquiry.slug}.md`,
			content: inquiryToMarkdown(inquiry),
		})
	}

	// SQLite atomic transaction
	await ctx.db.execute("BEGIN")
	try {
		const result = await drainPositions(
			ctx,
			allPositions,
			summary.id,
			summary.triggerSignalId,
			pendingWrites,
		)

		for (const i of summary.newInquiries) {
			await ctx.db.execute(
				`INSERT INTO inquiries (slug, tension, status, text, related_positions, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(slug) DO UPDATE SET
           tension = excluded.tension,
           status = excluded.status,
           text = excluded.text,
           related_positions = excluded.related_positions,
           updated_at = datetime('now')`,
				i.slug,
				i.tension,
				i.status,
				i.text,
				JSON.stringify(i.relatedPositions),
			)
		}

		await ctx.db.execute(
			`INSERT INTO record (id, trigger_signal_id, tension_at_trigger, started_at, completed_at, positions_updated, inquiries_opened, narrative)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			summary.id,
			summary.triggerSignalId,
			summary.tensionAtTrigger,
			new Date(summary.startedAt).toISOString(),
			new Date(summary.completedAt).toISOString(),
			allPositions.length,
			summary.newInquiries.length,
			summary.sessionNarrative,
		)

		await ctx.db.execute("COMMIT")

		// Flush markdown to disk only after successful commit
		await flushWrites(pendingWrites)

		return result
	} catch (error) {
		await ctx.db.execute("ROLLBACK")
		throw error
	}
}

// ── Drain Dataset Positions ───────────────────────────────────────────

export async function drainDatasetPositions(
	ctx: DrainContext,
	positions: PositionUpdate[],
	datasetSource: string,
): Promise<DrainResult> {
	const syntheticSessionId = `dataset-${crypto.randomUUID()}`
	const pendingWrites: PendingWrite[] = []

	// Queue synthetic session record
	const recordMd = [
		"---",
		`id: ${syntheticSessionId}`,
		"trigger_signal_id: dataset-ingest",
		"tension_at_trigger: 1.0",
		`started_at: ${new Date().toISOString()}`,
		`completed_at: ${new Date().toISOString()}`,
		`positions_updated: ${positions.length}`,
		"inquiries_opened: 0",
		"layers_applied: [ingest-dataset]",
		"---",
		"",
		`# Dataset Ingestion: ${datasetSource}`,
		"",
		`Ingested ${positions.length} positions from dataset.`,
	].join("\n")
	pendingWrites.push({ path: `knowledge/record/${syntheticSessionId}.md`, content: recordMd })

	// SQLite atomic transaction
	await ctx.db.execute("BEGIN")
	try {
		const result = await drainPositions(
			ctx,
			positions,
			syntheticSessionId,
			"dataset-ingest",
			pendingWrites,
		)

		await ctx.db.execute(
			`INSERT INTO record (id, trigger_signal_id, tension_at_trigger, started_at, completed_at, positions_updated, inquiries_opened, narrative)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			syntheticSessionId,
			"dataset-ingest",
			1.0,
			new Date().toISOString(),
			new Date().toISOString(),
			positions.length,
			0,
			`Dataset ingestion from ${datasetSource}`,
		)

		await ctx.db.execute("COMMIT")

		// Flush markdown to disk only after successful commit
		await flushWrites(pendingWrites)

		return result
	} catch (error) {
		await ctx.db.execute("ROLLBACK")
		throw error
	}
}

// ── Commit Proof (Accept / Adjust) ────────────────────────────────────

export async function commitProof(
	ctx: DrainContext,
	slug: string,
	confidenceOverride?: number,
): Promise<void> {
	if (confidenceOverride !== undefined && (confidenceOverride < 0 || confidenceOverride > 1)) {
		throw new Error(`Confidence must be between 0 and 1, got: ${confidenceOverride}`)
	}

	const proofIndex = ctx.state.pendingProofs.findIndex((p) => p.slug === slug)
	if (proofIndex === -1) throw new Error(`No pending proof for slug: ${slug}`)

	const proof = ctx.state.pendingProofs[proofIndex]
	const finalConfidence = confidenceOverride ?? proof.posteriorConfidence
	const wasAdjusted =
		confidenceOverride !== undefined && confidenceOverride !== proof.posteriorConfidence

	// Update position — use override confidence if provided
	await ctx.db.execute(
		"UPDATE positions SET confidence = ?, status = 'settled', updated_at = datetime('now') WHERE slug = ?",
		finalConfidence,
		slug,
	)

	// Write calibration log — include override delta if adjusted
	const calType = wasAdjusted ? "proof_adjusted" : "proof_accepted"
	const calDetail: Record<string, unknown> = {
		priorConfidence: proof.priorConfidence,
		proposedConfidence: proof.posteriorConfidence,
		finalConfidence,
		surpriseDelta: proof.surpriseDelta,
	}
	if (wasAdjusted) {
		calDetail.overrideDelta = finalConfidence - proof.posteriorConfidence
	}

	const calMd = calibrationEntryToMarkdown(calType, slug, calDetail)
	const acceptCalId = `accept-${slug}-${crypto.randomUUID()}`
	await Bun.write(`knowledge/calibration/${acceptCalId}.md`, calMd)

	await ctx.db.execute(
		"INSERT INTO calibration (id, type, slug, detail) VALUES (?, ?, ?, ?)",
		acceptCalId,
		calType,
		slug,
		JSON.stringify(calDetail),
	)

	// Remove from pending
	ctx.state.pendingProofs.splice(proofIndex, 1)
	// Reindex remaining proofs
	ctx.state.pendingProofs.forEach((p, i) => {
		p.index = i + 1
	})

	ctx.broadcast("calibrationEvent", {
		type: wasAdjusted ? "proofAdjusted" : "proofAccepted",
		slug,
		finalConfidence,
	})
}

// ── Reject Proof ──────────────────────────────────────────────────────

export async function rejectProof(
	ctx: DrainContext,
	slug: string,
	note: string,
): Promise<IngestSignal> {
	const proofIndex = ctx.state.pendingProofs.findIndex((p) => p.slug === slug)
	if (proofIndex === -1) throw new Error(`No pending proof for slug: ${slug}`)

	const proof = ctx.state.pendingProofs[proofIndex]

	// Revert position to prior confidence
	await ctx.db.execute(
		`UPDATE positions SET
       confidence = ?,
       status = 'contradicted',
       updated_at = datetime('now')
     WHERE slug = ?`,
		proof.priorConfidence,
		slug,
	)

	// Write calibration log
	const calMd = calibrationEntryToMarkdown("proof_rejected", slug, {
		priorConfidence: proof.priorConfidence,
		attemptedConfidence: proof.posteriorConfidence,
		note,
	})
	const rejectCalId = `reject-${slug}-${crypto.randomUUID()}`
	await Bun.write(`knowledge/calibration/${rejectCalId}.md`, calMd)

	await ctx.db.execute(
		"INSERT INTO calibration (id, type, slug, detail) VALUES (?, 'proof_rejected', ?, ?)",
		rejectCalId,
		slug,
		JSON.stringify({ note, prior: proof.priorConfidence, attempted: proof.posteriorConfidence }),
	)

	// Remove from pending
	ctx.state.pendingProofs.splice(proofIndex, 1)
	ctx.state.pendingProofs.forEach((p, i) => {
		p.index = i + 1
	})

	// Create correction signal
	const correctionSignal: IngestSignal = {
		id: `correction-${slug}-${crypto.randomUUID()}`,
		sourceProvider: "correction",
		sourceMode: "system",
		content: `Owner correction for position "${slug}": ${note}`,
		urgency: "high",
		credibility: 1.0,
		timestamp: Date.now(),
		metadata: { correctedSlug: slug, priorConfidence: proof.priorConfidence },
	}

	ctx.broadcast("calibrationEvent", { type: "proofRejected", slug, note })

	return correctionSignal
}
