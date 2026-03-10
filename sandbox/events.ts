import type { SandboxAgent } from "sandbox-agent"
import type { CalibrationEvent } from "../actor/types"

// ── Event Normalization ───────────────────────────────────────────────

interface AgentEvent {
	eventIndex: number
	sender: string
	payload: {
		type: string
		[key: string]: unknown
	}
}

/**
 * Subscribe to sandbox agent session events and normalize them
 * into CalibrationEvents for Actor broadcast.
 */
export function subscribeToSessionEvents(
	session: { onEvent: (cb: (event: AgentEvent) => void) => () => void },
	broadcast: (event: string, payload: CalibrationEvent) => void,
): () => void {
	return session.onEvent((event) => {
		const payload = event.payload

		// Normalize agent events to CalibrationEvents
		switch (payload.type) {
			case "tool_use":
				// Agent is using a tool — could be file write, git, etc.
				// We don't broadcast these, but could log them
				break

			case "text":
				// Agent text output — could extract position updates
				// In practice, we read the final session-summary.json
				break

			case "error":
				broadcast("calibrationEvent", {
					type: "sessionError",
					error: String(payload.message ?? "Unknown agent error"),
					retryable: false,
				})
				break

			default:
				// Unknown event type — ignore
				break
		}
	})
}

/**
 * Extract session progress from agent events.
 * Returns a cleanup function.
 */
export function trackSessionProgress(
	session: { onEvent: (cb: (event: AgentEvent) => void) => () => void },
	onProgress: (step: string) => void,
): () => void {
	return session.onEvent((event) => {
		const payload = event.payload

		if (payload.type === "tool_use" && typeof payload.name === "string") {
			onProgress(`Tool: ${payload.name}`)
		}

		if (payload.type === "text" && typeof payload.text === "string") {
			// Extract layer progress from agent output
			const text = payload.text as string
			if (text.includes("Layer 1")) onProgress("Signal evaluation")
			if (text.includes("Layer 2")) onProgress("Belief updating")
			if (text.includes("Layer 3")) onProgress("Contradiction synthesis")
			if (text.includes("Layer 4")) onProgress("Sensemaking")
		}
	})
}
