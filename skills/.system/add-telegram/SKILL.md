---
name: add-telegram
description: Add Telegram as a full interaction channel to this
  opensentient fork. Implements all three channel modes — conversation,
  command, and signal. Serves as the reference implementation that all
  other channel skills (add-slack, add-discord, add-whatsapp) follow.
---

# Add Telegram Channel

## What This Does
Transforms the fork to add Telegram as a full interaction channel.
Implements conversation, command, and signal modes.
Writes clean integration code — no framework, no dead conditionals.

## Three Modes (all required for any channel skill)

**Conversation** — Actor responds from knowledge graph in natural language.
Any message that isn't a command or explicit assertion routes here.
Conversation topics are extracted as low-weight signals (0.3-0.6).
If Actor has nothing on a raised topic, opens an inquiry automatically.

**Command** — Structured calibration acts via slash commands.
/accept /reject /tensions /promote /close etc.
Explicit FSM transitions. Convenience wrappers around CalibrationAPI.

**Signal** — Owner asserts a fact directly.
Natural language assertion ("X happened today") from owner role.
Credibility 1.0. Runs through full evaluation pipeline immediately.
Actor acknowledges and enqueues — no command syntax required.

## Steps
1. Confirm Grammy is in package.json — add if missing
2. Write channels/telegram/bot.ts — Grammy bot + startup registration
3. Write channels/telegram/onboard.ts — conversational AGENTS.md builder
4. Write channels/telegram/commands.ts — full command surface
5. Update app entry to import and start telegram channel at boot
6. Add TELEGRAM_BOT_TOKEN to .env.example
7. bun run build — verify clean compile

## ChannelMessage Shape (all channels normalize to this)
  channelId:  "telegram"
  role:       "owner" | "consumer"
  mode:       "conversation" | "command" | "signal"
  content:    message text

## Signal Shape (enqueued from all three modes)
  sourceProvider: "telegram"
  sourceMode:     "conversation" | "command" | "signal"
  credibility:    1.0 (owner signal/command) | 0.3-0.6 (conversation extract)

## Output
Clean Telegram integration. All three modes implemented.
Reference implementation for add-slack, add-discord, add-whatsapp.
