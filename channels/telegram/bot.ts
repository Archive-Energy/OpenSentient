import { Bot, InlineKeyboard } from "grammy"
import { registry } from "../../actor/index"
import type { CalibrationEvent, PositionProofOfWork } from "../../actor/types"
import { registerCommands } from "./commands"

// ── Bot Setup ─────────────────────────────────────────────────────────

export function createBot(): Bot {
	const token = process.env.TELEGRAM_BOT_TOKEN
	if (!token) throw new Error("Missing env var: TELEGRAM_BOT_TOKEN")
	const bot = new Bot(token)

	// Register command handlers
	registerCommands(bot)

	return bot
}

// ── Push Notifications ────────────────────────────────────────────────

export function subscribeToPushNotifications(bot: Bot): void {
	const actor = registry.get("OpenSentient")

	actor.on("calibrationEvent", async (event: CalibrationEvent) => {
		const chatId = actor.state.telegramChatId
		if (!chatId) return

		switch (event.type) {
			case "proofSurfaced":
				await sendProofNotification(bot, chatId, event.proof)
				break
			case "sessionComplete":
				await bot.api.sendMessage(
					chatId,
					`Session complete. ${event.summary.updatedPositions.length} positions updated, ` +
						`${event.summary.newInquiries.length} new inquiries.`,
				)
				break
			case "sessionError":
				await bot.api.sendMessage(chatId, `Session error: ${event.error}`)
				break
			case "tensionDetected":
				await sendTensionNotification(bot, chatId, event.slug, event.surpriseDelta)
				break
		}
	})
}

// ── Notification Formatters ───────────────────────────────────────────

async function sendProofNotification(
	bot: Bot,
	chatId: number,
	proof: PositionProofOfWork,
): Promise<void> {
	const keyboard = new InlineKeyboard()
		.text("Accept", `accept:${proof.slug}`)
		.text("Adjust", `adjust:${proof.slug}`)
		.text("Reject", `reject:${proof.slug}`)

	await bot.api.sendMessage(
		chatId,
		`*Proof of work #${proof.index}*\n` +
			`Position: \`${proof.slug}\`\n` +
			`Confidence: ${proof.priorConfidence.toFixed(2)} → ${proof.posteriorConfidence.toFixed(2)}\n` +
			`Surprise delta: ${proof.surpriseDelta.toFixed(2)}\n\n` +
			`${proof.text.slice(0, 200)}...`,
		{ parse_mode: "Markdown", reply_markup: keyboard },
	)
}

async function sendTensionNotification(
	bot: Bot,
	chatId: number,
	slug: string,
	surpriseDelta: number,
): Promise<void> {
	const keyboard = new InlineKeyboard()
		.text("Confirm", `confirm:${slug}`)
		.text("Dismiss", `dismiss:${slug}`)

	await bot.api.sendMessage(
		chatId,
		`*Tension detected*\nPosition: \`${slug}\`\nSurprise delta: ${surpriseDelta.toFixed(2)}`,
		{ parse_mode: "Markdown", reply_markup: keyboard },
	)
}

// ── Start ─────────────────────────────────────────────────────────────

export async function startTelegramBot(): Promise<Bot> {
	const bot = createBot()
	subscribeToPushNotifications(bot)
	bot.start()
	return bot
}
