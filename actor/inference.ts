import type { InferenceResult, ModelRole, TokenUsage } from "./types"

// ── Key Resolution ────────────────────────────────────────────────────

const PROVIDER_KEY_MAP: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	openai: "OPENAI_API_KEY",
}

/** Resolve API key from provider name by convention. */
export function resolveProviderKey(provider: string): string {
	const envVar = PROVIDER_KEY_MAP[provider]
	if (!envVar) throw new Error(`Unknown provider: ${provider} (no key mapping)`)
	const value = process.env[envVar]
	if (!value) throw new Error(`Missing env var: ${envVar} (for provider "${provider}")`)
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
): Promise<InferenceResult> {
	const key = resolveProviderKey(config.provider ?? "anthropic")
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
		const data = (await res.json()) as {
			content: Array<{ text: string }>
			usage?: { input_tokens?: number; output_tokens?: number }
		}
		return {
			text: data.content[0]?.text ?? "",
			usage: {
				inputTokens: data.usage?.input_tokens ?? 0,
				outputTokens: data.usage?.output_tokens ?? 0,
			},
		}
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
		usage?: { prompt_tokens?: number; completion_tokens?: number }
	}
	return {
		text: data.choices[0]?.message?.content ?? "",
		usage: {
			inputTokens: data.usage?.prompt_tokens ?? 0,
			outputTokens: data.usage?.completion_tokens ?? 0,
		},
	}
}
