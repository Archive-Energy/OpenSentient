import matter from "gray-matter"
import { actorInfer } from "./inference"
import type { InferenceResult, ModelRole, SkillMeta, TokenUsage } from "./types"

// ── Skill Loading ─────────────────────────────────────────────────────

export function parseSkillMd(raw: string): { meta: SkillMeta; body: string } {
	const { data, content } = matter(raw)
	return { meta: data as SkillMeta, body: content.trim() }
}

export async function loadSkill(name: string): Promise<{ meta: SkillMeta; body: string }> {
	const path = `skills/.system/${name}/SKILL.md`
	const file = Bun.file(path)
	if (!(await file.exists())) {
		throw new Error(`Skill not found: ${path}`)
	}
	const raw = await file.text()
	return parseSkillMd(raw)
}

// ── Actor Skill Runner ────────────────────────────────────────────────

/**
 * Run a skill on the Actor (cheap model).
 * Injects skill body as system prompt, context as JSON user prompt.
 * Returns parsed JSON result + token usage for budget tracking.
 */
export async function runActorSkill<T>(
	skillName: string,
	context: Record<string, unknown>,
	actorConfig: ModelRole,
): Promise<{ result: T; usage: TokenUsage }> {
	const { meta, body } = await loadSkill(skillName)

	// Validate runtime — reject sandbox-only skills
	if (meta.runtime === "sandbox") {
		throw new Error(`Skill "${skillName}" is sandbox-only (runtime: sandbox). Cannot run on Actor.`)
	}

	const systemPrompt = [
		body,
		"",
		"## Response Format",
		"Respond with valid JSON only. No markdown, no explanation outside the JSON.",
	].join("\n")

	const userPrompt = JSON.stringify(context, null, 2)

	const { text, usage } = await actorInfer(actorConfig, systemPrompt, userPrompt)

	// Parse JSON from response — handle markdown code fences
	const jsonText = text
		.replace(/^```json?\n?/m, "")
		.replace(/\n?```$/m, "")
		.trim()
	const result = JSON.parse(jsonText) as T

	return { result, usage }
}
