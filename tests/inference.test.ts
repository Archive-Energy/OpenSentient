import { afterEach, describe, expect, test } from "bun:test"
import { resolveEndpoint, resolveProviderKey } from "../actor/inference"

// ── resolveEndpoint ───────────────────────────────────────────────────

describe("resolveEndpoint", () => {
	test("resolves anthropic", () => {
		expect(resolveEndpoint("anthropic")).toBe("https://api.anthropic.com")
	})

	test("resolves openrouter", () => {
		expect(resolveEndpoint("openrouter")).toBe("https://openrouter.ai/api/v1")
	})

	test("resolves openai", () => {
		expect(resolveEndpoint("openai")).toBe("https://api.openai.com/v1")
	})

	test("throws on unknown provider", () => {
		expect(() => resolveEndpoint("deepseek")).toThrow("Unknown provider")
	})
})

// ── resolveProviderKey ────────────────────────────────────────────────

describe("resolveProviderKey", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	test("resolves provider name to env var", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-abc"
		expect(resolveProviderKey("anthropic")).toBe("sk-test-abc")
	})

	test("resolves openrouter provider", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-123"
		expect(resolveProviderKey("openrouter")).toBe("sk-or-123")
	})

	test("throws on missing env var", () => {
		process.env.ANTHROPIC_API_KEY = undefined
		expect(() => resolveProviderKey("anthropic")).toThrow("Missing env var")
	})

	test("throws on unknown provider", () => {
		expect(() => resolveProviderKey("deepseek")).toThrow("Unknown provider: deepseek")
	})
})

// ── InferenceResult type contract ─────────────────────────────────────

describe("InferenceResult contract", () => {
	test("InferenceResult has text and usage fields", () => {
		const result = {
			text: "hello",
			usage: { inputTokens: 10, outputTokens: 5 },
		}
		expect(result.text).toBe("hello")
		expect(result.usage.inputTokens).toBe(10)
		expect(result.usage.outputTokens).toBe(5)
	})
})
