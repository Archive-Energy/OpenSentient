import { actor, event, queue, setup } from "rivetkit"
import { Loop, workflow } from "rivetkit/workflow"
import { ensureSandbox, mountWorkspace, runSession, teardownSession } from "../sandbox/index"
import { commitProof, drainSession, rejectProof, validateSummary } from "./drain"
import { actorInfer } from "./inference"
import { materialize, parseAgentsMd } from "./materialize"
import { actorDb } from "./schema"
import { evaluateTension } from "./tension"
import type {
	AgentCommand,
	CalibrationEvent,
	CalibrationState,
	DEFAULT_CALIBRATION_THRESHOLD,
	DEFAULT_THRESHOLD,
	IngestSignal,
	MIN_SESSION_GAP_MS,
	SIGNAL_TTL_MS,
	SentientState,
	SessionSummary,
} from "./types"

// ── Actor Definition ──────────────────────────────────────────────────

const opensentient = actor({
	options: { name: "OpenSentient" },

	createState: (): SentientState => ({
		initialized: false,
		domain: { name: "", description: "", boundaries: [], adjacencies: [] },
		modelConfig: {
			actor: { provider: "anthropic", key: "${ANTHROPIC_API_KEY}", name: "claude-haiku-4-5" },
			embedding: {
				provider: "openrouter",
				key: "${EMBEDDING_API_KEY}",
				name: "baai/bge-m3",
				dimensions: 1024,
			},
			sandbox: { name: "claude-opus-4-6", harness: "opencode", key: "" },
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
						id: `manual-${Date.now()}`,
						sourceProvider: "owner",
						sourceMode: "command",
						content: (cmd.payload.reason as string) ?? "Manual session triggered",
						urgency: "high",
						credibility: 1.0,
						timestamp: Date.now(),
					}
					await processSignal(loopCtx, signal)
				}
				return // next loop iteration
			}

			// Process signal
			const signal = message.body as IngestSignal
			await processSignal(loopCtx, signal)
		})
	}),

	// ── Actions ─────────────────────────────────────────────────────────

	actions: {
		initialize: async (c, agentsMdRaw: string) => {
			const { config, body } = parseAgentsMd(agentsMdRaw)
			c.state.initialized = true
			c.state.domain = config.domain
			c.state.modelConfig = config.models
			c.state.repos = config.repos ?? []
			c.state.tensionThreshold = config.session.threshold
			c.state.calibrationThreshold = config.session.calibration_threshold
			c.state.cachedAgentsMdBody = body
			c.state.dirty = false

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
			const signal: IngestSignal = {
				id: `daily-scan-${Date.now()}`,
				sourceProvider: "system",
				sourceMode: "poll",
				content: "Scheduled daily domain scan",
				urgency: "medium",
				credibility: 0.5,
				timestamp: Date.now(),
			}
			await c.queue.send("signals", signal)
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
				id: `tension-confirmed-${slug}-${Date.now()}`,
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
				`dismiss-${slug}-${Date.now()}`,
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
				`correct-${slug}-${Date.now()}`,
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
	},
})

// ── Signal Processing (used inside workflow) ──────────────────────────

async function processSignal(
	ctx: {
		state: SentientState
		db: typeof opensentient extends { db: infer D } ? D : never
		broadcast: (event: string, payload: CalibrationEvent) => void
		step: <T>(opts: {
			name: string
			timeout?: number
			maxRetries?: number
			retryBackoffBase?: number
			run: () => T
		}) => Promise<T>
		rollbackCheckpoint: (name: string) => Promise<void>
	},
	signal: IngestSignal,
): Promise<void> {
	// TTL check
	if (Date.now() - signal.timestamp > 7 * 24 * 60 * 60 * 1000) return

	// Session cooldown
	if (Date.now() - ctx.state.lastSessionAt < 60_000) return

	// Get position slugs for tension evaluation
	const positions = (await ctx.db.execute("SELECT slug FROM positions")) as Array<{ slug: string }>
	const positionSlugs = positions.map((p) => p.slug)

	// Evaluate tension (domain relevance + embedding similarity)
	const tension = await evaluateTension(
		signal,
		ctx.state.domain,
		positionSlugs,
		[], // Position embeddings — would be cached in production
		ctx.state.modelConfig.embedding,
		ctx.state.signalWeights,
	)

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

	// Broadcast session start
	ctx.broadcast("calibrationEvent", {
		type: "sessionStarted",
		triggeredBy: signal.sourceProvider,
		tensionAt: tension,
	})

	// Set rollback checkpoint — if anything below fails, we revert
	await ctx.rollbackCheckpoint("session-checkpoint")

	try {
		// Ensure sandbox is running
		const { sandbox, sdk } = await ctx.step({
			name: "ensure-sandbox",
			timeout: 120_000,
			maxRetries: 2,
			retryBackoffBase: 5_000,
			run: () => ensureSandbox(ctx.state),
		})

		// Mount workspace files
		await ctx.step({
			name: "mount-workspace",
			timeout: 60_000,
			run: () => mountWorkspace(sdk, ctx.state),
		})

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
		const drainResult = await ctx.step({
			name: "drain-session",
			run: () => drainSession({ db: ctx.db, state: ctx.state, broadcast: ctx.broadcast }, summary),
		})

		// Update last session timestamp
		ctx.state.lastSessionAt = Date.now()

		// Broadcast completion
		ctx.broadcast("calibrationEvent", {
			type: "sessionComplete",
			summary,
		})

		// Teardown agent session (not the sandbox — it stays warm)
		await teardownSession(sdk, summary.id)
	} catch (error) {
		ctx.broadcast("calibrationEvent", {
			type: "sessionError",
			error: error instanceof Error ? error.message : String(error),
			retryable: true,
		})
	}
}

// ── Registry ──────────────────────────────────────────────────────────

export const registry = setup({
	use: { opensentient },
})

export { opensentient }
export default registry.serve()
