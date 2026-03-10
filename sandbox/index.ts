import { Daytona } from "@daytonaio/sdk"
import { SandboxAgent } from "sandbox-agent"
import { buildHarnessConfig, buildSandboxEnvVars } from "../actor/materialize"
import type {
	IngestSignal,
	RepoConfig,
	SentientState,
	SessionSummary,
	TokenUsage,
} from "../actor/types"

// ── Daytona Sandbox Lifecycle ─────────────────────────────────────────

export async function ensureSandbox(
	state: SentientState,
): Promise<{ sandbox: Awaited<ReturnType<Daytona["create"]>>; sdk: SandboxAgent }> {
	const daytona = new Daytona()

	let sandbox: Awaited<ReturnType<Daytona["create"]>>

	if (state.sandboxId) {
		try {
			sandbox = await daytona.get(state.sandboxId)
			if (sandbox.state === "stopped") {
				await sandbox.start()
			} else if (sandbox.state === "archived" || sandbox.state === "error") {
				sandbox = await createFreshSandbox(daytona, state)
				state.sandboxId = sandbox.id
			}
		} catch {
			// Sandbox not found — create fresh
			sandbox = await createFreshSandbox(daytona, state)
			state.sandboxId = sandbox.id
		}
	} else {
		sandbox = await createFreshSandbox(daytona, state)
		state.sandboxId = sandbox.id
	}

	// Connect Sandbox Agent SDK
	const baseUrl = `https://${sandbox.id}-2468.app.daytona.io`
	const sdk = await SandboxAgent.connect({
		baseUrl,
		waitForHealth: { timeoutMs: 120_000 },
	})

	return { sandbox, sdk }
}

async function createFreshSandbox(
	daytona: Daytona,
	state: SentientState,
): Promise<Awaited<ReturnType<Daytona["create"]>>> {
	const sandboxEnvVars = buildSandboxEnvVars(state.modelConfig.sandbox)

	const sandbox = await daytona.create({
		snapshot: "sandbox-agent-ready",
		envVars: sandboxEnvVars,
		resources: { cpu: 2, memory: 4, disk: 8 },
		ephemeral: false,
		autoStopInterval: 15,
	})

	// Start sandbox-agent server inside the sandbox
	await sandbox.process.createSession("sa-server")
	await sandbox.process.executeSessionCommand("sa-server", {
		command: "sandbox-agent server --no-token --host 0.0.0.0 --port 2468",
		runAsync: true,
	})

	// Wait for sandbox-agent to be ready
	await new Promise((resolve) => setTimeout(resolve, 3000))

	return sandbox
}

// ── Mount Workspace ───────────────────────────────────────────────────

export async function mountWorkspace(sdk: SandboxAgent, state: SentientState): Promise<void> {
	// Create workspace directories
	await sdk.mkdirFs({ path: "/workspace/knowledge/positions" })
	await sdk.mkdirFs({ path: "/workspace/knowledge/inquiries" })
	await sdk.mkdirFs({ path: "/workspace/knowledge/record" })
	await sdk.mkdirFs({ path: "/workspace/knowledge/calibration" })
	await sdk.mkdirFs({ path: "/workspace/skills/.system" })
	await sdk.mkdirFs({ path: "/workspace/skills/.curated" })

	// Write AGENTS.md (body only — frontmatter stripped)
	if (state.cachedAgentsMdBody) {
		await sdk.writeFsFile({ path: "/workspace/AGENTS.md" }, state.cachedAgentsMdBody)
	}

	// Generate harness config
	const harnessConfig = buildHarnessConfig(
		state.modelConfig.sandbox.harness,
		state.cachedAgentsMdBody ?? "",
	)
	if (harnessConfig) {
		const dir = harnessConfig.filename.includes("/")
			? `/workspace/${harnessConfig.filename.split("/").slice(0, -1).join("/")}`
			: null
		if (dir) await sdk.mkdirFs({ path: dir })
		await sdk.writeFsFile({ path: `/workspace/${harnessConfig.filename}` }, harnessConfig.content)
	}

	// Configure skills sources
	const skillSources: Array<{ type: string; source: string; skills?: string[] }> = [
		{ type: "github", source: "rivet-dev/skills", skills: ["sandbox-agent"] },
		{ type: "github", source: "kepano/obsidian-skills", skills: ["defuddle"] },
		{ type: "local", source: "/workspace/skills/.system" },
		{ type: "local", source: "/workspace/skills/.curated" },
	]

	await sdk.setSkillsConfig(
		{ directory: "/workspace", skillName: "default" },
		{ sources: skillSources },
	)

	// Clone repos if configured
	if (state.repos.length > 0) {
		for (const repo of state.repos) {
			await cloneRepo(sdk, repo)
		}
	}
}

// ── Clone Repos ───────────────────────────────────────────────────────

async function cloneRepo(sdk: SandboxAgent, repo: RepoConfig): Promise<void> {
	const token = process.env.GITHUB_TOKEN
	if (!token) throw new Error("Missing env var: GITHUB_TOKEN (required for repo cloning)")
	const urlWithAuth = repo.url.replace("https://", `https://${token}@`)
	const repoName = repo.url.split("/").slice(-1)[0].replace(".git", "")

	await sdk.runProcess({
		command: "git",
		args: ["clone", urlWithAuth, `/workspace/${repoName}`],
		timeoutMs: 120_000,
	})

	// Authenticate gh CLI
	await sdk.runProcess({
		command: "sh",
		args: ["-c", `echo "${token}" | gh auth login --with-token`],
		timeoutMs: 10_000,
	})
}

// ── Run Session ───────────────────────────────────────────────────────

export async function runSession(
	sdk: SandboxAgent,
	state: SentientState,
	trigger: IngestSignal,
): Promise<SessionSummary> {
	const harness = state.modelConfig.sandbox.harness
	const model = state.modelConfig.sandbox.name

	// Create agent session
	const session = await sdk.createSession({
		agent: harness === "opencode" ? "opencode" : harness,
		model,
		sessionInit: {
			cwd: "/workspace",
			mcpServers: process.env.PARSE_API_KEY
				? [
						{
							name: "parse",
							url: "https://api.parse.bot/mcp",
							headers: { "X-API-Key": process.env.PARSE_API_KEY },
						},
					]
				: [],
		},
	})

	// Inject context — knowledge graph state + trigger
	const contextInjection = buildContextInjection(state, trigger)
	const contextResponse = await session.prompt([{ type: "text", text: contextInjection }])

	// Run the session — agent applies Alethic Method
	const sessionPrompt = buildSessionPrompt(trigger)
	const sessionResponse = await session.prompt([{ type: "text", text: sessionPrompt }])

	// Aggregate token usage from both prompt calls (ACP experimental)
	const tokenUsage: TokenUsage = {
		inputTokens:
			(contextResponse.usage?.inputTokens ?? 0) + (sessionResponse.usage?.inputTokens ?? 0),
		outputTokens:
			(contextResponse.usage?.outputTokens ?? 0) + (sessionResponse.usage?.outputTokens ?? 0),
	}

	// Read session output
	const outputBytes = await sdk.readFsFile({ path: "/workspace/output/session-summary.json" })
	const outputText = new TextDecoder().decode(outputBytes)
	const summary = JSON.parse(outputText) as SessionSummary

	// Ensure required fields
	summary.id = summary.id || `session-${Date.now()}`
	summary.startedAt = summary.startedAt || Date.now() - 60_000
	summary.completedAt = summary.completedAt || Date.now()
	summary.triggerSignalId = trigger.id
	summary.artifacts = summary.artifacts || { pullRequests: [] }

	// Attach token usage if available
	if (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0) {
		summary.tokenUsage = tokenUsage
	}

	await sdk.destroySession(session.id)

	return summary
}

// ── Teardown Session ──────────────────────────────────────────────────

export async function teardownSession(sdk: SandboxAgent, sessionId: string): Promise<void> {
	try {
		await sdk.destroySession(sessionId)
	} catch {
		// Session may already be destroyed
	}
}

// ── Context Building ──────────────────────────────────────────────────

function buildContextInjection(state: SentientState, trigger: IngestSignal): string {
	return [
		"# Session Context",
		"",
		`## Domain: ${state.domain.name}`,
		state.domain.description,
		"",
		"## Trigger Signal",
		`Source: ${trigger.sourceProvider} (${trigger.sourceMode})`,
		`Credibility: ${trigger.credibility}`,
		`Content: ${trigger.content}`,
		"",
		"## Instructions",
		"Read the AGENTS.md file for your full system prompt and methodology.",
		"Read knowledge/INDEX.md for the current domain topology.",
		"Apply the Alethic Method skills in order: signal-evaluation, belief-updating,",
		"contradiction-synthesis, sensemaking.",
		"Write your session output to /workspace/output/session-summary.json",
		"following the SessionSummary schema.",
		"",
		"If repos are cloned in /workspace/, create branches and PRs for code changes.",
		"Follow the git-workflow skill for branch naming and commit conventions.",
	].join("\n")
}

function buildSessionPrompt(trigger: IngestSignal): string {
	return [
		"Process this signal through the Alethic Method:",
		"",
		`"${trigger.content}"`,
		"",
		"1. Evaluate signal credibility (Layer 1)",
		"2. Update beliefs against existing positions (Layer 2)",
		"3. Synthesize any contradictions (Layer 3)",
		"4. Make sense of what this session reveals (Layer 4)",
		"5. Write all outputs to /workspace/output/session-summary.json",
		"6. If repo work is needed, create a branch, commit, and open a PR",
	].join("\n")
}
