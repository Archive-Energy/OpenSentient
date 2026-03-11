// ── FSM Status Enums ──────────────────────────────────────────────────

export type PositionStatus = "settled" | "under_interrogation" | "pending_review" | "contradicted"

export type TensionStatus =
	| "detected"
	| "pending_review"
	| "confirmed"
	| "session_running"
	| "resolved"
	| "dismissed"

export type InquiryStatus = "open" | "active" | "promoted" | "resolved" | "closed"

// ── Inference ─────────────────────────────────────────────────────────

export interface TokenUsage {
	inputTokens: number
	outputTokens: number
}

export interface InferenceResult {
	text: string
	usage: TokenUsage
}

// ── Domain ────────────────────────────────────────────────────────────

export interface Domain {
	name: string
	description: string
	boundaries: string[]
	adjacencies: string[]
}

// ── Model Config ──────────────────────────────────────────────────────

export interface ModelRole {
	provider?: string // "anthropic" | "openrouter" | "openai"
	name: string // model ID
	dimensions?: number // embedding only
}

export type HarnessBackend = "opencode" | "claude" | "codex" | "amp"

export interface SandboxModelConfig {
	harness: HarnessBackend
	name: string // model ID
}

export interface ModelConfig {
	actor: ModelRole
	embedding: ModelRole
	sandbox: SandboxModelConfig
}

// ── Dataset Config ────────────────────────────────────────────────────

export type DatasetSourceType = "huggingface" | "csv" | "parquet" | "json" | "jsonl" | "url"
export type DatasetMode = "signals" | "positions" | "analysis"
export type DatasetSchedule = "init" | "daily" | "manual"

export interface DatasetConfig {
	source: DatasetSourceType
	uri: string // HF name, file path, or URL
	config?: string // HF dataset config name
	split?: string // HF split (train, test, validation)
	mode: DatasetMode
	limit?: number // max rows (default 1000)
	column_map?: Record<string, string> // source col -> OS field
	content_column?: string // which column maps to content/text
	label_column?: string // which column maps to confidence/label
	credibility?: number // default credibility for signals mode (0.0-1.0)
	schedule?: DatasetSchedule // when to run ingestion
}

export interface DatasetOutput {
	source: string
	rowsProcessed: number
	signals?: IngestSignal[]
	positions?: PositionUpdate[]
	summary?: SessionSummary
}

/** Returns true if the dataset source requires the sandbox (Python). */
export function needsSandbox(source: DatasetSourceType): boolean {
	return source === "huggingface" || source === "parquet"
}

// ── Repo Config ───────────────────────────────────────────────────────

export interface RepoConfig {
	url: string
	branch_prefix: string
	auto_pr: boolean
	pr_reviewers: string[]
	default_base: string
}

// ── Signals ───────────────────────────────────────────────────────────

export interface IngestSignal {
	id: string
	sourceProvider: string // "parallel" | "owner" | "correction" | "x402"
	sourceMode: string // "webhook" | "poll" | "command" | "system"
	content: string
	urgency: "low" | "medium" | "high"
	credibility: number // 0.0 - 1.0
	timestamp: number
	metadata?: Record<string, unknown>
	x402Source?: {
		sentientId: string
		cost: number // USDC paid
	}
}

// ── Agent Commands ────────────────────────────────────────────────────

export interface AgentCommand {
	type: "run" | "correct_position" | "update_config" | "initialize" | "ingest_dataset"
	payload: Record<string, unknown>
}

// ── Session Summary ───────────────────────────────────────────────────

export interface PositionUpdate {
	slug: string
	text: string
	confidence: number
	surpriseDelta: number
	priorConfidence: number
	status: PositionStatus
	wikilinks?: string[]
}

export interface InquiryUpdate {
	slug: string
	text: string
	tension: number
	status: InquiryStatus
	relatedPositions: string[]
}

export interface PullRequestArtifact {
	repo: string
	url: string
	branch: string
	title: string
	filesChanged: number
}

export interface SessionSummary {
	id: string
	triggerSignalId: string
	tensionAtTrigger: number
	startedAt: number
	completedAt: number
	newPositions: PositionUpdate[]
	updatedPositions: PositionUpdate[]
	newInquiries: InquiryUpdate[]
	layersApplied: string[]
	signalCredibility: number
	sessionNarrative: string
	domainTrajectory: string
	watchSignals: string[]
	artifacts: {
		pullRequests: PullRequestArtifact[]
	}
	tokenUsage?: TokenUsage // Sandbox session token usage (from ACP)
}

// ── Calibration ───────────────────────────────────────────────────────

export interface PositionProofOfWork {
	index: number
	slug: string
	sourceSignalId: string
	priorConfidence: number
	posteriorConfidence: number
	surpriseDelta: number
	text: string
	sessionId: string
}

export interface CalibrationState {
	pendingProofs: PositionProofOfWork[]
	tensions: Array<{
		slug: string
		surpriseDelta: number
		status: TensionStatus
		detectedAt: number
	}>
	inquiries: Array<{
		slug: string
		tension: number
		status: InquiryStatus
	}>
	threshold: number
	calibrationThreshold: number
	signalWeights: Record<string, number>
	lastSessionAt: number
	sessionCount: number
}

export type CalibrationEvent =
	| { type: "proofSurfaced"; proof: PositionProofOfWork }
	| { type: "proofAccepted"; slug: string }
	| { type: "proofRejected"; slug: string; note: string }
	| { type: "tensionDetected"; slug: string; surpriseDelta: number }
	| { type: "tensionConfirmed"; slug: string }
	| { type: "tensionDismissed"; slug: string; weightAdjustment: number }
	| { type: "sessionStarted"; triggeredBy: string; tensionAt: number }
	| { type: "sessionComplete"; summary: SessionSummary }
	| { type: "sessionError"; error: string; retryable: boolean }
	| { type: "positionUpdated"; slug: string; confidence: number; surpriseDelta: number }
	| { type: "inquiryRaised"; slug: string; tension: number }
	| { type: "thresholdAdjusted"; value: number }
	| { type: "heartbeat" }
	| { type: "budgetExhausted"; spentUsd: number; dailyBudgetUsd: number }
	| { type: "budgetReset"; dailyBudgetUsd: number }
	| { type: "triageComplete"; action: TriageAction; slug: string }
	| { type: "datasetIngested"; source: string; mode: DatasetMode; rowsProcessed: number }
	| { type: "datasetError"; source: string; error: string }

// ── Actor State ───────────────────────────────────────────────────────

export interface SentientState {
	initialized: boolean
	domain: Domain
	modelConfig: ModelConfig
	repos: RepoConfig[]
	tensionThreshold: number
	calibrationThreshold: number
	signalWeights: Record<string, number>
	pendingProofs: PositionProofOfWork[]
	sessionCount: number
	lastSessionAt: number
	sandboxId: string | null
	telegramChatId: number | null
	dirty: boolean
	cachedAgentsMdBody: string | null
	budgetState: BudgetState
	triageEnabled: boolean
	modelPricingCache: ModelPricingCache | null
	/** Cached position embeddings keyed by slug. */
	positionEmbeddings: Record<string, number[]>
}

// ── Triage ────────────────────────────────────────────────────────────

export type TriageAction = "confirm" | "update" | "contradict" | "new_territory"

export interface TriageResult {
	action: TriageAction
	positions: string[] // affected position slugs
	reasoning: string
	confidenceNudge?: number // for confirm/update (±0.01-0.05)
	newText?: string // for update — the updated position text
	contradictionNature?: string // for contradict
	newTerritoryDescription?: string // for new_territory
}

// ── Budget & Cost ─────────────────────────────────────────────────────

export interface BudgetState {
	dailyBudgetUsd: number
	x402AllocationPct: number
	spentTodayUsd: number
	lastResetAt: number // epoch ms (midnight UTC)
	sessionsToday: number
	triagesToday: number
	scansToday: number
	x402SpentTodayUsd: number
}

export interface CostRecord {
	type: "triage" | "scan" | "session" | "embedding" | "x402_purchase"
	costUsd: number
	tokenUsage?: TokenUsage
	timestamp: number
}

export interface ModelPricingCache {
	data: Record<string, { models: Record<string, { cost: { input: number; output: number } }> }>
	fetchedAt: number // epoch ms
}

// ── Actor DB Interface ────────────────────────────────────────────────

/** Minimal typed interface for Rivet's opaque DB handle. */
export interface ActorDb {
	execute: (sql: string, ...params: unknown[]) => Promise<unknown[]>
}

// ── Skill Metadata ────────────────────────────────────────────────────

export type SkillRuntime = "actor" | "sandbox"

export interface SkillMeta {
	name: string
	description: string
	runtime?: SkillRuntime
	escalate_to?: SkillRuntime
	trigger?: string
	layer?: string
}

// ── Sentient Config Schema (Zod) ──────────────────────────────────────

import { z } from "zod"

const ModelRoleSchema = z.object({
	provider: z.string().optional(),
	name: z.string(),
	dimensions: z.number().optional(),
})

const SandboxModelSchema = z.object({
	harness: z.enum(["opencode", "claude", "codex", "amp"]),
	name: z.string(),
})

const DatasetConfigSchema = z.object({
	source: z.enum(["huggingface", "csv", "parquet", "json", "jsonl", "url"]),
	uri: z.string(),
	config: z.string().optional(),
	split: z.string().optional(),
	mode: z.enum(["signals", "positions", "analysis"]),
	limit: z.number().optional(),
	column_map: z.record(z.string(), z.string()).optional(),
	content_column: z.string().optional(),
	label_column: z.string().optional(),
	credibility: z.number().min(0).max(1).optional(),
	schedule: z.enum(["init", "daily", "manual"]).optional(),
})

const SkillSourceSchema = z.object({
	type: z.enum(["github", "local", "git"]),
	source: z.string(),
	skills: z.array(z.string()).optional(),
	ref: z.string().optional(),
	subpath: z.string().optional(),
})

export const SentientConfigSchema = z
	.object({
		name: z.string(),
		namespace: z.string().optional(),
		domain: z.object({
			name: z.string(),
			description: z.string(),
			boundaries: z.array(z.string()),
			adjacencies: z.array(z.string()),
		}),
		models: z.object({
			actor: ModelRoleSchema,
			embedding: ModelRoleSchema,
			sandbox: SandboxModelSchema,
		}),
		session: z.object({
			threshold: z.number(),
			calibration_threshold: z.number(),
			daily_scan: z.boolean(),
			scan_interval_hours: z.number(),
			session_cooldown_minutes: z.number(),
			signal_ttl_days: z.number(),
		}),
		signals: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
		repos: z
			.array(
				z.object({
					url: z.string(),
					branch_prefix: z.string(),
					auto_pr: z.boolean(),
					pr_reviewers: z.array(z.string()),
					default_base: z.string(),
				}),
			)
			.optional(),
		skills: z.object({
			curated: z.array(SkillSourceSchema),
			system_external: z.array(SkillSourceSchema),
		}),
		integrations: z
			.object({
				parse: z.boolean().optional(),
				telegram: z.boolean(),
			})
			.passthrough(),
		api: z.object({
			discovery: z.boolean(),
			public_skills: z.boolean(),
			public_positions: z.boolean(),
			public_inquiries: z.boolean(),
		}),
		datasets: z.array(DatasetConfigSchema).optional(),
		seed_positions: z
			.array(
				z.object({
					slug: z.string(),
					text: z.string(),
					confidence: z.number(),
				}),
			)
			.optional(),
		// v0.2 — all optional for backward compat
		budget: z
			.object({
				daily_usd: z.number(),
				x402_allocation_pct: z.number(),
				triage_enabled: z.boolean().optional(),
			})
			.optional(),
		payments: z
			.object({
				enabled: z.boolean(),
				stripe_connected_account: z.string(),
				default_pricing: z.record(z.string(), z.string()),
			})
			.optional(),
		wallet: z
			.object({
				autonomous_spending: z.object({
					enabled: z.boolean(),
					monthly_budget_usdc: z.number(),
					per_query_limit_usdc: z.number(),
					require_approval_above: z.number(),
				}),
			})
			.optional(),
		registry: z
			.object({
				url: z.string(),
			})
			.optional(),
		brief: z
			.object({
				source: z.string(),
				last_generated: z.string(),
				generation_model: z.string(),
			})
			.optional(),
	})
	.passthrough()

export type AgentsConfig = z.infer<typeof SentientConfigSchema>
