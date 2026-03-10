import matter from "gray-matter"
import { resolveKey } from "./inference"
import type { AgentsConfig, HarnessBackend, SandboxModelConfig } from "./types"

// ── AGENTS.md Parsing ─────────────────────────────────────────────────

export function parseAgentsMd(raw: string): { config: AgentsConfig; body: string } {
	const { data, content } = matter(raw)
	return { config: data as AgentsConfig, body: content.trim() }
}

// ── Harness Config File Generation ────────────────────────────────────

export function buildHarnessConfig(
	harness: HarnessBackend,
	agentsMdBody: string,
): { filename: string; content: string } | null {
	switch (harness) {
		case "opencode":
			return {
				filename: "opencode.jsonc",
				content: JSON.stringify(
					{
						$schema: "https://opencode.ai/config.json",
						instructions: ["AGENTS.md"],
					},
					null,
					2,
				),
			}
		case "claude":
			return {
				filename: "CLAUDE.md",
				content: [
					agentsMdBody,
					"",
					"## Working Directory",
					"All knowledge files are in /workspace/knowledge/",
					"All skills are in /workspace/skills/",
					"",
					"## Session Output",
					"Write session results as structured JSON to /workspace/output/session-summary.json",
				].join("\n"),
			}
		case "amp":
			return {
				filename: ".amp/config.json",
				content: JSON.stringify({ instructions: agentsMdBody }, null, 2),
			}
		case "codex":
			// Codex reads AGENTS.md natively
			return null
	}
}

// ── Sandbox Environment Variables ─────────────────────────────────────

const HARNESS_KEY_MAP: Record<HarnessBackend, string[]> = {
	opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_API_KEY"],
	claude: ["ANTHROPIC_API_KEY"],
	codex: ["OPENAI_API_KEY"],
	amp: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
}

export function buildSandboxEnvVars(sandboxConfig: SandboxModelConfig): Record<string, string> {
	const envVars: Record<string, string> = {}
	const keysToForward = HARNESS_KEY_MAP[sandboxConfig.harness] ?? []

	for (const key of keysToForward) {
		if (process.env[key]) {
			envVars[key] = process.env[key] as string
		}
	}

	// Forward optional integration keys
	if (process.env.GITHUB_TOKEN) envVars.GITHUB_TOKEN = process.env.GITHUB_TOKEN
	if (process.env.PARSE_API_KEY) envVars.PARSE_API_KEY = process.env.PARSE_API_KEY
	if (process.env.EXA_API_KEY) envVars.EXA_API_KEY = process.env.EXA_API_KEY

	return envVars
}

// ── Materialize Full Context ──────────────────────────────────────────

export function materialize(agentsMdRaw: string) {
	const { config, body } = parseAgentsMd(agentsMdRaw)
	const harnessConfig = buildHarnessConfig(config.models.sandbox.harness, body)
	const sandboxEnvVars = buildSandboxEnvVars(config.models.sandbox)

	return {
		config,
		body,
		harnessConfig,
		sandboxEnvVars,
	}
}
