import type { ModelRole } from "./types"

// ── Key Resolution ────────────────────────────────────────────────────

export function resolveKey(ref: string): string {
	const match = ref.match(/^\$\{(.+)\}$/)
	if (!match) return ref
	const value = process.env[match[1]]
	if (!value) throw new Error(`Missing env var: ${match[1]}`)
	return value
}

// ── Provider Endpoints ────────────────────────────────────────────────

const ENDPOINTS: Record<string, string> = {
	anthropic: "https://api.anthropic.com",
	openrouter: "https://openrouter.ai/api/v1",
	openai: "https://api.openai.com/v1",
}

export function resolveEndpoint(provider: string): string {
	const endpoint = ENDPOINTS[provider]
	if (!endpoint) throw new Error(`Unknown provider: ${provider}`)
	return endpoint
}

// ── Actor Model Inference (Haiku) ─────────────────────────────────────

export async function actorInfer(
	config: ModelRole,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const key = resolveKey(config.key)
	const endpoint = resolveEndpoint(config.provider ?? "anthropic")

	if (config.provider === "anthropic") {
		const res = await fetch(`${endpoint}/v1/messages`, {
			method: "POST",
			headers: {
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: config.name,
				max_tokens: 1024,
				system: systemPrompt,
				messages: [{ role: "user", content: userPrompt }],
			}),
		})
		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Actor inference failed (${res.status}): ${body}`)
		}
		const data = (await res.json()) as { content: Array<{ text: string }> }
		return data.content[0]?.text ?? ""
	}

	// OpenRouter / OpenAI compatible
	const res = await fetch(`${endpoint}/chat/completions`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.name,
			max_tokens: 1024,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		}),
	})
	if (!res.ok) {
		const body = await res.text()
		throw new Error(`Actor inference failed (${res.status}): ${body}`)
	}
	const data = (await res.json()) as {
		choices: Array<{ message: { content: string } }>
	}
	return data.choices[0]?.message?.content ?? ""
}
