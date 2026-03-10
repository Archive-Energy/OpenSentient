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

// ── Constants ─────────────────────────────────────────────────────────

export const SIGNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const MIN_SESSION_GAP_MS = 60_000 // 1 minute
export const DEFAULT_THRESHOLD = 0.6
export const DEFAULT_CALIBRATION_THRESHOLD = 0.4

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
	key: string // "${ENV_VAR}" reference
	name: string // model ID
	dimensions?: number // embedding only
}

export type HarnessBackend = "opencode" | "claude" | "codex" | "amp"

export interface SandboxModelConfig extends Omit<ModelRole, "provider"> {
	harness: HarnessBackend
}

export interface ModelConfig {
	actor: ModelRole
	embedding: ModelRole
	sandbox: SandboxModelConfig
}

// ── Repo Config ───────────────────────────────────────────────────────

export interface RepoConfig {
	url: string
	branch_prefix: string
	auth: string // "${GITHUB_TOKEN}"
	auto_pr: boolean
	pr_reviewers: string[]
	default_base: string
}

// ── Signals ───────────────────────────────────────────────────────────

export interface IngestSignal {
	id: string
	sourceProvider: string // "parallel_systems" | "exa" | "owner" | "correction"
	sourceMode: string // "webhook" | "poll" | "command" | "system"
	content: string
	urgency: "low" | "medium" | "high"
	credibility: number // 0.0 - 1.0
	timestamp: number
	metadata?: Record<string, unknown>
}

// ── Agent Commands ────────────────────────────────────────────────────

export interface AgentCommand {
	type: "run" | "correct_position" | "update_config" | "initialize"
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
}

// ── Skill Config ──────────────────────────────────────────────────────

export interface SkillSource {
	type: "github" | "local" | "git"
	source: string
	skills?: string[]
	ref?: string
	subpath?: string
}

export interface SkillsConfig {
	curated: SkillSource[]
	system_external: SkillSource[]
}

// ── Integrations ──────────────────────────────────────────────────────

export interface IntegrationsConfig {
	parse?: { key: string }
	telegram: { token: string }
}

// ── AGENTS.md Parsed Config ───────────────────────────────────────────

export interface AgentsConfig {
	name: string
	namespace: string
	domain: Domain
	models: ModelConfig
	session: {
		threshold: number
		calibration_threshold: number
		daily_scan: boolean
		scan_interval_hours: number
		session_cooldown_minutes: number
		signal_ttl_days: number
	}
	signals: Record<string, Record<string, unknown>>
	repos: RepoConfig[]
	skills: SkillsConfig
	integrations: IntegrationsConfig
	api: {
		discovery: boolean
		public_skills: boolean
		public_positions: boolean
		public_inquiries: boolean
	}
	seed_positions: Array<{
		slug: string
		text: string
		confidence: number
	}>
}
