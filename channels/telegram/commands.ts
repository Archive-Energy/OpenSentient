import type { Bot, Context } from "grammy"
import { registry } from "../../actor/index"

// Pending adjust: chatId -> slug (waiting for confidence value)
const pendingAdjust = new Map<number, string>()

// ── Command Registration ──────────────────────────────────────────────

export function registerCommands(bot: Bot): void {
	const actor = registry.get("OpenSentient")

	// ── Text Commands ───────────────────────────────────────────────────

	bot.command("status", async (ctx) => {
		const status = await actor.getStatus()
		await ctx.reply(
			`*${status.domain || "Uninitialized"}*\n` +
				`Sessions: ${status.sessionCount}\n` +
				`Pending proofs: ${status.pendingProofs}\n` +
				`Last session: ${status.lastSessionAt ? new Date(status.lastSessionAt).toLocaleString() : "never"}`,
			{ parse_mode: "Markdown" },
		)
	})

	bot.command("run", async (ctx) => {
		const reason = ctx.match || "Manual Telegram trigger"
		await actor.runNow(reason)
		await ctx.reply("Session queued.")
	})

	bot.command("calibration", async (ctx) => {
		const cal = await actor.getCalibrationState()
		await ctx.reply(
			`Proofs pending: ${cal.pendingProofs.length}\n` +
				`Threshold: ${cal.threshold}\n` +
				`Calibration threshold: ${cal.calibrationThreshold}\n` +
				`Sessions: ${cal.sessionCount}`,
		)
	})

	bot.command("proofs", async (ctx) => {
		const cal = await actor.getCalibrationState()
		if (cal.pendingProofs.length === 0) {
			await ctx.reply("No pending proofs.")
			return
		}
		const lines = cal.pendingProofs.map(
			(p) =>
				`#${p.index} \`${p.slug}\`: ${p.priorConfidence.toFixed(2)} → ${p.posteriorConfidence.toFixed(2)} (delta ${p.surpriseDelta.toFixed(2)})`,
		)
		await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" })
	})

	bot.command("accept", async (ctx) => {
		const parts = (ctx.match || "").split(" ")
		const slug = resolveSlugOrIndexFromParts(parts[0], actor)
		if (!slug) return await ctx.reply("Usage: /accept <slug or #index> [confidence]")
		const confidence = parts[1] ? Number.parseFloat(parts[1]) : undefined
		if (
			confidence !== undefined &&
			(Number.isNaN(confidence) || confidence < 0 || confidence > 1)
		) {
			return await ctx.reply("Confidence must be between 0.0 and 1.0")
		}
		await actor.acceptProof(slug, confidence)
		const label =
			confidence !== undefined ? `Adjusted to ${confidence}: ${slug}` : `Committed: ${slug}`
		await ctx.reply(label)
	})

	bot.command("adjust", async (ctx) => {
		const parts = (ctx.match || "").split(" ")
		const slug = resolveSlugOrIndexFromParts(parts[0], actor)
		if (!slug) return await ctx.reply("Usage: /adjust <slug or #index> <confidence>")
		const confidence = Number.parseFloat(parts[1] ?? "")
		if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
			return await ctx.reply("Usage: /adjust <slug or #index> <0.0-1.0>")
		}
		await actor.acceptProof(slug, confidence)
		await ctx.reply(`Adjusted to ${confidence}: ${slug}`)
	})

	bot.command("reject", async (ctx) => {
		const parts = (ctx.match || "").split(" ")
		const slug = resolveSlugOrIndexFromParts(parts[0], actor)
		if (!slug) return await ctx.reply("Usage: /reject <slug or #index> <note>")
		const note = parts.slice(1).join(" ") || "Rejected via Telegram"
		await actor.rejectProof(slug, note)
		await ctx.reply(`Rejected: ${slug}. Correction queued.`)
	})

	bot.command("threshold", async (ctx) => {
		const value = Number.parseFloat(ctx.match || "")
		if (Number.isNaN(value) || value < 0 || value > 1) {
			return await ctx.reply("Usage: /threshold <0.0-1.0>")
		}
		await actor.adjustThreshold(value)
		await ctx.reply(`Threshold set to ${value}`)
	})

	bot.command("positions", async (ctx) => {
		const positions = (await actor.db.execute(
			"SELECT slug, confidence, surprise_delta, status FROM positions ORDER BY surprise_delta DESC LIMIT 5",
		)) as Array<{ slug: string; confidence: number; surprise_delta: number; status: string }>

		if (positions.length === 0) return await ctx.reply("No positions yet.")

		const lines = positions.map(
			(p) =>
				`\`${p.slug}\` — ${p.confidence.toFixed(2)} (delta ${p.surprise_delta.toFixed(2)}) [${p.status}]`,
		)
		await ctx.reply(`*Top 5 by surprise delta:*\n${lines.join("\n")}`, { parse_mode: "Markdown" })
	})

	// ── Inline Button Callbacks ─────────────────────────────────────────

	bot.callbackQuery(/^accept:(.+)$/, async (ctx) => {
		const slug = ctx.match?.[1]
		await actor.acceptProof(slug)
		await ctx.answerCallbackQuery(`Committed: ${slug}`)
		await ctx.editMessageText(`Accepted: \`${slug}\``, { parse_mode: "Markdown" })
	})

	bot.callbackQuery(/^adjust:(.+)$/, async (ctx) => {
		const slug = ctx.match?.[1]
		if (!slug || !ctx.chat) return
		pendingAdjust.set(ctx.chat.id, slug)
		await ctx.answerCallbackQuery("Reply with confidence (0.0-1.0)")
		await ctx.editMessageText(`Adjusting \`${slug}\`. Reply with your confidence (0.0-1.0):`, {
			parse_mode: "Markdown",
		})
	})

	// Handle pending adjust replies
	bot.on("message:text", async (ctx, next) => {
		const chatId = ctx.chat.id
		const slug = pendingAdjust.get(chatId)
		if (!slug) return next()

		const confidence = Number.parseFloat(ctx.message.text)
		if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
			await ctx.reply("Send a number between 0.0 and 1.0, or /accept to accept as-is.")
			return
		}

		pendingAdjust.delete(chatId)
		await actor.acceptProof(slug, confidence)
		await ctx.reply(`Adjusted \`${slug}\` to ${confidence.toFixed(2)}`, { parse_mode: "Markdown" })
	})

	bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
		const slug = ctx.match?.[1]
		await actor.rejectProof(slug, "Rejected via Telegram button")
		await ctx.answerCallbackQuery(`Rejected: ${slug}`)
		await ctx.editMessageText(`Rejected: \`${slug}\`. Correction queued.`, {
			parse_mode: "Markdown",
		})
	})

	bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
		const slug = ctx.match?.[1]
		await actor.confirmTension(slug)
		await ctx.answerCallbackQuery(`Confirmed: ${slug}`)
		await ctx.editMessageText(`Tension confirmed: \`${slug}\`. Session queued.`, {
			parse_mode: "Markdown",
		})
	})

	bot.callbackQuery(/^dismiss:(.+)$/, async (ctx) => {
		const slug = ctx.match?.[1]
		await actor.dismissTension(slug)
		await ctx.answerCallbackQuery(`Dismissed: ${slug}`)
		await ctx.editMessageText(`Tension dismissed: \`${slug}\`. Signal weight adjusted.`, {
			parse_mode: "Markdown",
		})
	})
}

// ── Helpers ───────────────────────────────────────────────────────────

function resolveSlugOrIndex(ctx: Context, actor: ReturnType<typeof registry.get>): string | null {
	return resolveSlugOrIndexFromParts(ctx.match as string, actor)
}

function resolveSlugOrIndexFromParts(
	input: string | undefined,
	actor: ReturnType<typeof registry.get>,
): string | null {
	if (!input) return null
	const trimmed = input.trim()

	// Check if it's a numeric index
	const index = Number.parseInt(trimmed.replace("#", ""), 10)
	if (!Number.isNaN(index)) {
		const cal = actor.state.pendingProofs
		const proof = cal.find((p) => p.index === index)
		return proof?.slug ?? null
	}

	return trimmed
}
