import { actor, event, queue, setup } from "rivetkit"
import { workflow } from "rivetkit/workflow"
import type { SandboxAgent } from "sandbox-agent"
import { ensureSandbox, mountWorkspace, runDatasetSession, runSession } from "../sandbox/index"
import {
	DEFAULT_BUDGET,
	calculateCost,
	checkBudget,
	fetchModelPricing,
	getDailyDigest,
	recordCost,
	resetBudgetIfNewDay,
} from "./budget"
import { ingestDatasetLocal } from "./dataset"
import {
	commitProof,
	drainDatasetPositions,
	drainSession,
	rejectProof,
	validateSummary,
} from "./drain"
import { parseSentientConfig } from "./materialize"
import { actorDb } from "./schema"
import { runActorSkill } from "./skill-runner"
import { embed, evaluateTension } from "./tension"
import type {
	ActorDb,
	AgentCommand,
	CalibrationEvent,
	CalibrationState,
	DatasetConfig,
	IngestSignal,
	SentientState,
	SessionSummary,
	TriageResult,
} from "./types"
import { needsSandbox } from "./types"

// ── Actor Definition ──────────────────────────────────────────────────

const opensentient = actor({
	options: { name: "OpenSentient" },

	createState: (): SentientState => ({
		initialized: false,
		domain: { name: "", description: "", boundaries: [], adjacencies: [] },
		modelConfig: {
			actor: { provider: "anthropic", name: "claude-haiku-4-5" },
			embedding: {
				provider: "openrouter",
				name: "baai/bge-m3",
				dimensions: 1024,
			},
			sandbox: { name: "claude-opus-4-6", harness: "opencode" },
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
		dirty: true,
		cachedAgentsMdBody: null,
		budgetState: { ...DEFAULT_BUDGET },
		triageEnabled: true,
		modelPricingCache: null,
		positionEmbeddings: {},
	}),

	events: {
		calibrationEvent: event<CalibrationEvent>(),
	},

	queues: {
		signals: queue<IngestSignal>(),
		commands: queue<AgentCommand>(),
	},

	db: actorDb,

	// ── Lifecycle ───────────────────────────────────────────────────────

	onCreate: async (c) => {
		// Start the daily scan timer
		c.schedule.after(24 * 60 * 60 * 1000, "enqueueDailyScan")
	},

	// ── Workflow (durable main loop) ────────────────────────────────────

	run: workflow(async (ctx) => {
		await ctx.loop("agent-loop", async (loopCtx) => {
			// Wait for any signal or command
			const message = await loopCtx.queue.next("wait-trigger", {
				names: ["signals", "commands"],
			})

			// Route commands vs signals
			if ("type" in message.body && typeof (message.body as AgentCommand).type === "string") {
				const cmd = message.body as AgentCommand
				if (cmd.type === "run") {
					// Manual run — create a synthetic signal
					const signal: IngestSignal = {
						id: `manual-${crypto.randomUUID()}`,
						sourceProvider: "owner",
						sourceMode: "command",
						content: (cmd.payload.reason as string) ?? "Manual session triggered",
						urgency: "high",
						credibility: 1.0,
						timestamp: Date.now(),
					}
					await processSignal(loopCtx as unknown as ProcessContext, signal)
				} else if (cmd.type === "ingest_dataset") {
					await processDatasetIngestion(
						loopCtx as unknown as ProcessContext,
						cmd.payload.dataset as DatasetConfig,
					)
				}
				return // next loop iteration
			}

			// Process signal
			const signal = message.body as IngestSignal
			await processSignal(loopCtx as unknown as ProcessContext, signal)
		})
	}),

	// ── Actions ─────────────────────────────────────────────────────────

	actions: {
		initialize: async (c, configJsonc: string, instructionsMd: string) => {
			const config = parseSentientConfig(configJsonc)
			c.state.initialized = true
			c.state.domain = config.domain
			c.state.modelConfig = config.models
			c.state.repos = config.repos ?? []
			c.state.tensionThreshold = config.session.threshold
			c.state.calibrationThreshold = config.session.calibration_threshold
			c.state.cachedAgentsMdBody = instructionsMd
			c.state.dirty = false

			// v0.2: Budget config
			if (config.budget) {
				c.state.budgetState.dailyBudgetUsd = config.budget.daily_usd
				c.state.budgetState.x402AllocationPct = config.budget.x402_allocation_pct
				c.state.triageEnabled = config.budget.triage_enabled ?? true
			}

			// Index seed positions
			for (const seed of config.seed_positions ?? []) {
				await c.db.execute(
					`INSERT OR IGNORE INTO positions (slug, confidence, status, text, created_at, updated_at)
           VALUES (?, ?, 'settled', ?, datetime('now'), datetime('now'))`,
					seed.slug,
					seed.confidence,
					seed.text,
				)
				// Write seed position markdown
				const md = [
					"---",
					`id: ${seed.slug}`,
					`confidence: ${seed.confidence}`,
					"surprise_delta: 0",
					"status: settled",
					"source_session: seed",
					`updated_at: ${new Date().toISOString()}`,
					"public: false",
					"---",
					"",
					seed.text,
				].join("\n")
				await Bun.write(`knowledge/positions/${seed.slug}.md`, md)
			}

			// Configure signal weights
			if (config.signals) {
				for (const [provider, cfg] of Object.entries(config.signals)) {
					const weight = (cfg as Record<string, unknown>).weight
					if (typeof weight === "number") {
						c.state.signalWeights[provider] = weight
					}
				}
			}

			// v0.2: Fetch model pricing on init
			try {
				c.state.modelPricingCache = await fetchModelPricing(null)
			} catch (err) {
				console.warn("[init] Failed to fetch model pricing:", err)
			}

			// v0.3: Enqueue init-scheduled dataset ingestions
			for (const ds of config.datasets ?? []) {
				if (ds.schedule === "init") {
					await c.queue.send("commands", {
						type: "ingest_dataset",
						payload: { dataset: ds },
					})
				}
			}
		},

		receiveSignal: async (c, signal: IngestSignal) => {
			await c.queue.send("signals", signal)
		},

		runNow: async (c, reason?: string) => {
			await c.queue.send("commands", {
				type: "run",
				payload: { reason: reason ?? "Manual session" },
			})
		},

		enqueueDailyScan: async (c) => {
			// v0.2: Reset daily budget
			const didReset = resetBudgetIfNewDay(c.state)
			if (didReset) {
				c.broadcast("calibrationEvent", {
					type: "budgetReset",
					dailyBudgetUsd: c.state.budgetState.dailyBudgetUsd,
				})
			}

			// v0.2: Refresh pricing cache daily
			try {
				c.state.modelPricingCache = await fetchModelPricing(c.state.modelPricingCache)
			} catch (err) {
				console.warn("[daily] Failed to refresh model pricing:", err)
			}

			const signal: IngestSignal = {
				id: `daily-scan-${crypto.randomUUID()}`,
				sourceProvider: "system",
				sourceMode: "poll",
				content: "Scheduled daily domain scan",
				urgency: "medium",
				credibility: 0.5,
				timestamp: Date.now(),
			}
			await c.queue.send("signals", signal)

			// v0.3: Enqueue daily-scheduled dataset ingestions
			// Note: datasets config is not in actor state — would need to re-parse
			// or store in state. For now, daily datasets are triggered via API.

			// Re-schedule unconditionally
			c.schedule.after(24 * 60 * 60 * 1000, "enqueueDailyScan")
		},

		getStatus: (c) => ({
			initialized: c.state.initialized,
			domain: c.state.domain.name,
			sessionCount: c.state.sessionCount,
			pendingProofs: c.state.pendingProofs.length,
			lastSessionAt: c.state.lastSessionAt,
			alive: true,
		}),

		getCalibrationState: (c): CalibrationState => ({
			pendingProofs: c.state.pendingProofs,
			tensions: [], // populated from SQLite in real usage
			inquiries: [], // populated from SQLite in real usage
			threshold: c.state.tensionThreshold,
			calibrationThreshold: c.state.calibrationThreshold,
			signalWeights: c.state.signalWeights,
			lastSessionAt: c.state.lastSessionAt,
			sessionCount: c.state.sessionCount,
		}),

		acceptProof: async (c, slug: string) => {
			await commitProof({ db: c.db, state: c.state, broadcast: c.broadcast }, slug)
		},

		rejectProof: async (c, slug: string, note: string) => {
			const correctionSignal = await rejectProof(
				{ db: c.db, state: c.state, broadcast: c.broadcast },
				slug,
				note,
			)
			// Enqueue correction signal for next session
			await c.queue.send("signals", correctionSignal)
		},

		confirmTension: async (c, slug: string) => {
			await c.db.execute(
				"UPDATE positions SET status = 'under_interrogation', updated_at = datetime('now') WHERE slug = ?",
				slug,
			)
			// Enqueue a signal to investigate this tension
			const signal: IngestSignal = {
				id: `tension-confirmed-${slug}-${crypto.randomUUID()}`,
				sourceProvider: "owner",
				sourceMode: "command",
				content: `Owner confirmed tension on position: ${slug}. Investigate.`,
				urgency: "high",
				credibility: 1.0,
				timestamp: Date.now(),
			}
			await c.queue.send("signals", signal)
			c.broadcast("calibrationEvent", { type: "tensionConfirmed", slug })
		},

		dismissTension: async (c, slug: string) => {
			await c.db.execute(
				"UPDATE positions SET status = 'settled', updated_at = datetime('now') WHERE slug = ?",
				slug,
			)
			// Reduce signal weight for the source that created this tension
			const weightAdj = -0.05
			c.broadcast("calibrationEvent", {
				type: "tensionDismissed",
				slug,
				weightAdjustment: weightAdj,
			})

			// Write calibration log
			await c.db.execute(
				"INSERT INTO calibration (id, type, slug, detail) VALUES (?, 'tension_dismissed', ?, ?)",
				`dismiss-${slug}-${crypto.randomUUID()}`,
				slug,
				JSON.stringify({ weightAdjustment: weightAdj }),
			)
		},

		correctPosition: async (c, slug: string, text: string, confidence: number) => {
			await c.db.execute(
				`UPDATE positions SET text = ?, confidence = ?, status = 'settled', updated_at = datetime('now')
         WHERE slug = ?`,
				text,
				confidence,
				slug,
			)
			// Write correction as calibration log
			await c.db.execute(
				"INSERT INTO calibration (id, type, slug, detail) VALUES (?, 'correction', ?, ?)",
				`correct-${slug}-${crypto.randomUUID()}`,
				slug,
				JSON.stringify({ text, confidence }),
			)
		},

		adjustThreshold: (c, value: number) => {
			c.state.tensionThreshold = value
			c.broadcast("calibrationEvent", { type: "thresholdAdjusted", value })
		},

		adjustSignalWeight: (c, source: string, weight: number) => {
			c.state.signalWeights[source] = weight
		},

		setTelegramChatId: (c, chatId: number) => {
			c.state.telegramChatId = chatId
		},

		getDailyDigest: (c) => getDailyDigest(c.state),

		adjustBudget: (c, dailyUsd: number, x402Pct?: number) => {
			c.state.budgetState.dailyBudgetUsd = dailyUsd
			if (x402Pct !== undefined) {
				c.state.budgetState.x402AllocationPct = x402Pct
			}
		},

		ingestDataset: async (c, datasetConfig: DatasetConfig) => {
			await c.queue.send("commands", {
				type: "ingest_dataset",
				payload: { dataset: datasetConfig },
			})
		},
	},
})

// ── Signal Processing (used inside workflow) ──────────────────────────

type ProcessContext = {
	state: SentientState
	db: ActorDb
	broadcast: (event: string, payload: CalibrationEvent) => void
	step: <T>(opts: {
		name: string
		timeout?: number
		maxRetries?: number
		retryBackoffBase?: number
		run: () => T
	}) => Promise<T>
	rollbackCheckpoint: (name: string) => Promise<void>
}

async function withSandbox(ctx: ProcessContext, stepPrefix = ""): Promise<SandboxAgent> {
	const prefix = stepPrefix ? `${stepPrefix}-` : ""
	const { sdk } = await ctx.step({
		name: `${prefix}ensure-sandbox`,
		timeout: 120_000,
		maxRetries: 2,
		retryBackoffBase: 5_000,
		run: () => ensureSandbox(ctx.state),
	})
	await ctx.step({
		name: `${prefix}mount-workspace`,
		timeout: 60_000,
		run: () => mountWorkspace(sdk, ctx.state),
	})
	return sdk
}

/** Embed and cache position texts so future tension evaluations use them. */
async function cachePositionEmbeddings(
	ctx: ProcessContext,
	positions: Array<{ slug: string; text: string }>,
): Promise<void> {
	for (const p of positions) {
		try {
			const { embedding } = await embed(p.text, ctx.state.modelConfig.embedding)
			ctx.state.positionEmbeddings[p.slug] = Array.from(embedding)
		} catch {
			// Non-fatal — position will be re-embedded on next cache miss
		}
	}
}

async function processSignal(ctx: ProcessContext, signal: IngestSignal): Promise<void> {
	// TTL check
	if (Date.now() - signal.timestamp > 7 * 24 * 60 * 60 * 1000) return

	// Session cooldown
	if (Date.now() - ctx.state.lastSessionAt < 60_000) return

	// v0.2: Reset budget if new day
	resetBudgetIfNewDay(ctx.state)

	// Get position slugs for tension evaluation
	const positions = (await ctx.db.execute("SELECT slug FROM positions")) as Array<{
		slug: string
		confidence: number
		text: string
	}>
	const positionSlugs = positions.map((p) => p.slug)

	// Build position embeddings array from cache (order matches positionSlugs)
	const positionEmbeddings: Float32Array[] = positionSlugs
		.filter((slug) => ctx.state.positionEmbeddings[slug])
		.map((slug) => new Float32Array(ctx.state.positionEmbeddings[slug]))

	// Evaluate tension (domain relevance + embedding similarity)
	const { tension, embeddingCost, signalEmbedding } = await evaluateTension(
		signal,
		ctx.state.domain,
		positionSlugs,
		positionEmbeddings,
		ctx.state.modelConfig.embedding,
		ctx.state.signalWeights,
	)

	// v0.2: Record embedding cost
	if (embeddingCost.inputTokens > 0 && ctx.state.modelPricingCache) {
		const embCostUsd = calculateCost(
			ctx.state.modelPricingCache,
			ctx.state.modelConfig.embedding.provider ?? "openrouter",
			ctx.state.modelConfig.embedding.name,
			embeddingCost,
		)
		recordCost(ctx.state, {
			type: "embedding",
			costUsd: embCostUsd,
			tokenUsage: embeddingCost,
			timestamp: Date.now(),
		})
		await logCost(ctx.db, "embedding", embCostUsd, embeddingCost)
	}

	// Log signal
	await ctx.db.execute(
		"INSERT INTO signals (id, source_provider, source_mode, content, urgency, credibility, tension_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
		signal.id,
		signal.sourceProvider,
		signal.sourceMode,
		signal.content,
		signal.urgency,
		signal.credibility,
		tension,
	)

	// Below threshold — skip
	if (tension < ctx.state.tensionThreshold) return

	// v0.2: Triage gate — classify signal before committing to Sandbox
	if (ctx.state.triageEnabled) {
		// Budget check for triage call
		if (!checkBudget(ctx.state, "triage")) {
			ctx.broadcast("calibrationEvent", {
				type: "budgetExhausted",
				spentUsd: ctx.state.budgetState.spentTodayUsd,
				dailyBudgetUsd: ctx.state.budgetState.dailyBudgetUsd,
			})
			return // Signal lost — queuing for tomorrow would require persistence
		}

		try {
			const triageContext = {
				signal: {
					content: signal.content,
					source: signal.sourceProvider,
					urgency: signal.urgency,
					credibility: signal.credibility,
				},
				positions: positions.slice(0, 5).map((p) => ({
					slug: p.slug,
					confidence: p.confidence,
					text: (p.text ?? "").slice(0, 200),
				})),
				budgetRemaining: ctx.state.budgetState.dailyBudgetUsd - ctx.state.budgetState.spentTodayUsd,
			}

			const { result: triage, usage: triageUsage } = await runActorSkill<TriageResult>(
				"signal-triage",
				triageContext,
				ctx.state.modelConfig.actor,
			)

			// Record triage cost
			const pricingCache = ctx.state.modelPricingCache
			const triageCostUsd = pricingCache
				? calculateCost(
						pricingCache,
						ctx.state.modelConfig.actor.provider ?? "anthropic",
						ctx.state.modelConfig.actor.name,
						triageUsage,
					)
				: 0
			recordCost(ctx.state, {
				type: "triage",
				costUsd: triageCostUsd,
				tokenUsage: triageUsage,
				timestamp: Date.now(),
			})
			await logCost(ctx.db, "triage", triageCostUsd, triageUsage)

			ctx.broadcast("calibrationEvent", {
				type: "triageComplete",
				action: triage.action,
				slug: triage.positions[0] ?? signal.id,
			})

			// CONFIRM / UPDATE — Actor handles directly, no Sandbox needed
			if (triage.action === "confirm" || triage.action === "update") {
				await handleActorTriage(ctx, triage)
				return
			}

			// CONTRADICT / NEW_TERRITORY — falls through to Sandbox session
		} catch (err) {
			console.warn("[triage] Triage failed, falling through to sandbox session:", err)
			ctx.broadcast("calibrationEvent", {
				type: "sessionError",
				error: `Triage failed: ${err instanceof Error ? err.message : String(err)}`,
				retryable: true,
			})
		}
	}

	// v0.2: Budget check for full Sandbox session
	if (!checkBudget(ctx.state, "session")) {
		ctx.broadcast("calibrationEvent", {
			type: "budgetExhausted",
			spentUsd: ctx.state.budgetState.spentTodayUsd,
			dailyBudgetUsd: ctx.state.budgetState.dailyBudgetUsd,
		})
		return
	}

	// Broadcast session start
	ctx.broadcast("calibrationEvent", {
		type: "sessionStarted",
		triggeredBy: signal.sourceProvider,
		tensionAt: tension,
	})

	// Set rollback checkpoint — if anything below fails, we revert
	await ctx.rollbackCheckpoint("session-checkpoint")

	try {
		const sdk = await withSandbox(ctx)

		// Run agent session
		const summary: SessionSummary = await ctx.step({
			name: "run-session",
			timeout: 10 * 60 * 1000, // 10 minutes max
			run: () => runSession(sdk, ctx.state, signal),
		})

		// Validate summary
		if (!validateSummary(summary)) {
			ctx.broadcast("calibrationEvent", {
				type: "sessionError",
				error: "Session produced invalid summary",
				retryable: true,
			})
			return
		}

		// Drain session
		await ctx.step({
			name: "drain-session",
			run: () => drainSession({ db: ctx.db, state: ctx.state, broadcast: ctx.broadcast }, summary),
		})

		// Cache embeddings for new/updated positions
		await cachePositionEmbeddings(ctx, [...summary.newPositions, ...summary.updatedPositions])

		// v0.2: Record session cost from sandbox token usage
		if (summary.tokenUsage && ctx.state.modelPricingCache) {
			const sessionCostUsd = calculateCost(
				ctx.state.modelPricingCache,
				"anthropic", // Sandbox provider — inferred from harness
				ctx.state.modelConfig.sandbox.name,
				summary.tokenUsage,
			)
			recordCost(ctx.state, {
				type: "session",
				costUsd: sessionCostUsd,
				tokenUsage: summary.tokenUsage,
				timestamp: Date.now(),
			})
			await logCost(ctx.db, "session", sessionCostUsd, summary.tokenUsage)
		} else {
			// No usage data — record session with zero cost (estimation deferred to cost-calibration)
			recordCost(ctx.state, { type: "session", costUsd: 0, timestamp: Date.now() })
		}

		// Update last session timestamp
		ctx.state.lastSessionAt = Date.now()

		// Broadcast completion
		ctx.broadcast("calibrationEvent", {
			type: "sessionComplete",
			summary,
		})
	} catch (error) {
		ctx.broadcast("calibrationEvent", {
			type: "sessionError",
			error: error instanceof Error ? error.message : String(error),
			retryable: true,
		})
	}
}

// ── Actor Triage Handlers (CONFIRM / UPDATE) ──────────────────────────

async function handleActorTriage(ctx: ProcessContext, triage: TriageResult): Promise<void> {
	for (const slug of triage.positions) {
		if (triage.action === "confirm" && triage.confidenceNudge !== undefined) {
			// Small confidence adjustment — no deep analysis needed
			await ctx.db.execute(
				`UPDATE positions
				 SET confidence = MIN(1.0, MAX(0.0, confidence + ?)),
				     updated_at = datetime('now')
				 WHERE slug = ?`,
				triage.confidenceNudge,
				slug,
			)
		} else if (triage.action === "update" && triage.newText) {
			// Minor factual update — Actor handles directly
			await ctx.db.execute(
				`UPDATE positions
				 SET text = ?,
				     confidence = MIN(1.0, MAX(0.0, confidence + ?)),
				     updated_at = datetime('now')
				 WHERE slug = ?`,
				triage.newText,
				triage.confidenceNudge ?? 0,
				slug,
			)
		}
	}
}

// ── Cost Logging (to SQLite) ──────────────────────────────────────────

async function logCost(
	db: ProcessContext["db"],
	type: string,
	costUsd: number,
	usage?: { inputTokens: number; outputTokens: number },
): Promise<void> {
	await db.execute(
		"INSERT INTO cost_log (id, type, cost_usd, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		`cost-${crypto.randomUUID()}`,
		type,
		costUsd,
		usage?.inputTokens ?? 0,
		usage?.outputTokens ?? 0,
		Date.now(),
	)
}

// ── Dataset Ingestion (used inside workflow) ─────────────────────────

async function processDatasetIngestion(ctx: ProcessContext, config: DatasetConfig): Promise<void> {
	// Budget check
	const costType = needsSandbox(config.source) ? "session" : "triage"
	if (!checkBudget(ctx.state, costType)) {
		ctx.broadcast("calibrationEvent", {
			type: "budgetExhausted",
			spentUsd: ctx.state.budgetState.spentTodayUsd,
			dailyBudgetUsd: ctx.state.budgetState.dailyBudgetUsd,
		})
		return
	}

	try {
		let output: import("./types").DatasetOutput

		if (needsSandbox(config.source)) {
			// Heavy format — run in sandbox
			const sdk = await withSandbox(ctx, "dataset")

			output = await ctx.step({
				name: "run-dataset-session",
				timeout: 5 * 60 * 1000,
				run: () => runDatasetSession(sdk, ctx.state, config),
			})
		} else {
			// Lightweight format — run on actor
			output = await ctx.step({
				name: "ingest-dataset-local",
				timeout: 60_000,
				run: () => ingestDatasetLocal(config),
			})
		}

		// Route output based on mode
		if (config.mode === "signals" && output.signals) {
			for (const signal of output.signals) {
				await ctx.db.execute(
					"INSERT INTO signals (id, source_provider, source_mode, content, urgency, credibility) VALUES (?, ?, ?, ?, ?, ?)",
					signal.id,
					signal.sourceProvider,
					signal.sourceMode,
					signal.content,
					signal.urgency,
					signal.credibility,
				)
			}
			// Process first 50 directly, rest are logged for future tension evaluation
			for (const signal of output.signals.slice(0, 50)) {
				await processSignal(ctx, signal)
			}
		} else if (config.mode === "positions" && output.positions) {
			await drainDatasetPositions(
				{ db: ctx.db, state: ctx.state, broadcast: ctx.broadcast },
				output.positions,
				output.source,
			)
		} else if (config.mode === "analysis" && output.summary) {
			if (validateSummary(output.summary)) {
				await drainSession(
					{ db: ctx.db, state: ctx.state, broadcast: ctx.broadcast },
					output.summary,
				)
			}
		}

		ctx.broadcast("calibrationEvent", {
			type: "datasetIngested",
			source: output.source,
			mode: config.mode,
			rowsProcessed: output.rowsProcessed,
		})
	} catch (error) {
		ctx.broadcast("calibrationEvent", {
			type: "datasetError",
			source: `${config.source}:${config.uri}`,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

// ── Registry ──────────────────────────────────────────────────────────

export const registry = setup({
	use: { opensentient },
})

export { opensentient }
export default registry.serve()
