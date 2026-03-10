import type { Bot, Context } from "grammy"
import { registry } from "../../actor/index"

// ── Onboarding State ──────────────────────────────────────────────────

interface OnboardingSession {
	step: "domain" | "boundaries" | "seeds" | "confirm"
	domain: string
	boundaries: string[]
	seeds: string[]
}

const sessions = new Map<number, OnboardingSession>()

// ── Registration ──────────────────────────────────────────────────────

export function registerOnboarding(bot: Bot): void {
	const actor = registry.get("OpenSentient")

	bot.command("start", async (ctx) => {
		const status = await actor.getStatus()

		if (status.initialized) {
			await ctx.reply(
				`*${status.domain}* is live.\nSessions: ${status.sessionCount}\nPending proofs: ${status.pendingProofs}\n\nUse /status, /positions, /calibration, or /run.`,
				{ parse_mode: "Markdown" },
			)
			return
		}

		// Begin onboarding
		sessions.set(ctx.chat.id, { step: "domain", domain: "", boundaries: [], seeds: [] })
		await ctx.reply("What should your agent be an expert in?")
	})

	// Handle onboarding conversation steps
	bot.on("message:text", async (ctx, next) => {
		const session = sessions.get(ctx.chat.id)
		if (!session) return next()

		const text = ctx.message.text

		switch (session.step) {
			case "domain":
				session.domain = text
				session.step = "boundaries"
				await ctx.reply("What are the specific boundaries? (comma-separated)")
				break

			case "boundaries":
				session.boundaries = text
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
				session.step = "seeds"
				await ctx.reply(
					"Share a few starting positions your agent already knows. (one per line, or 'skip')",
				)
				break

			case "seeds":
				if (text.toLowerCase() !== "skip") {
					session.seeds = text
						.split("\n")
						.map((s) => s.trim())
						.filter(Boolean)
				}
				session.step = "confirm"
				await ctx.reply(
					`*Preview*\nDomain: ${session.domain}\nBoundaries: ${session.boundaries.join(", ")}\nSeeds: ${session.seeds.length || "none"}\n\nReply *deploy* to launch.`,
					{ parse_mode: "Markdown" },
				)
				break

			case "confirm": {
				if (text.toLowerCase() !== "deploy") {
					await ctx.reply("Reply *deploy* to launch, or /start to restart.", {
						parse_mode: "Markdown",
					})
					return
				}

				// Build config + instructions and initialize
				const configJsonc = buildSentientJsonc(session)
				const instructions = buildInstructions(session)
				await actor.initialize(configJsonc, instructions)
				await actor.setTelegramChatId(ctx.chat.id)

				sessions.delete(ctx.chat.id)
				await ctx.reply("Your agent is live. I'll message you when it finds something.")
				break
			}
		}
	})
}

// ── Config Builder ────────────────────────────────────────────────────

function buildSentientJsonc(session: OnboardingSession): string {
	const slug = session.domain.toLowerCase().replace(/\s+/g, "-")
	const config = {
		name: slug,
		domain: {
			name: session.domain,
			description: `Expert intelligence on ${session.domain}`,
			boundaries: session.boundaries,
			adjacencies: [],
		},
		models: {
			actor: { provider: "anthropic", name: "claude-haiku-4-5" },
			embedding: { provider: "openrouter", name: "baai/bge-m3", dimensions: 1024 },
			sandbox: { harness: "opencode", name: "claude-opus-4-6" },
		},
		session: {
			threshold: 0.6,
			calibration_threshold: 0.4,
			daily_scan: true,
			scan_interval_hours: 24,
			session_cooldown_minutes: 1,
			signal_ttl_days: 7,
		},
		skills: { curated: [], system_external: [] },
		integrations: { telegram: true },
		api: {
			discovery: true,
			public_skills: true,
			public_positions: false,
			public_inquiries: false,
		},
		seed_positions: session.seeds.map((s, i) => ({
			slug: `seed-${i + 1}`,
			text: s,
			confidence: 0.7,
		})),
	}
	return JSON.stringify(config, null, "\t")
}

// ── Instructions Builder ──────────────────────────────────────────────

function buildInstructions(session: OnboardingSession): string {
	return [
		`# ${session.domain} Intelligence`,
		"",
		`You are a domain intelligence agent specializing in ${session.domain}.`,
		"Your knowledge lives in knowledge/. Read INDEX.md before every session.",
		"Update position nodes after findings. Link related nodes with wikilinks.",
	].join("\n")
}
