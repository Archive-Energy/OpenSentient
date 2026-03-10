import type { Context } from "hono"
import type { IngestSignal } from "../../actor/types"

interface ActorHandle {
	receiveSignal: (signal: IngestSignal) => Promise<void>
	runNow: (reason?: string) => Promise<void>
	correctPosition: (slug: string, text: string, confidence: number) => Promise<void>
	adjustThreshold: (value: number) => Promise<void>
	adjustSignalWeight: (source: string, weight: number) => Promise<void>
}

let actorRef: ActorHandle | null = null
export function setActorRef(ref: ActorHandle) {
	actorRef = ref
}

export async function handlePost(c: Context, route: string) {
	if (!actorRef) return c.json({ error: "Actor not initialized" }, 503)

	switch (route) {
		case "signal": {
			const body = await c.req.json()
			const signal = {
				id: `api-${Date.now()}`,
				sourceProvider: "owner",
				sourceMode: "api",
				content: body.content,
				urgency: body.urgency ?? "medium",
				credibility: body.credibility ?? 1.0,
				timestamp: Date.now(),
				metadata: body.metadata,
			}
			await actorRef.receiveSignal(signal)
			return c.json({ accepted: true, signalId: signal.id })
		}

		case "run": {
			const body = await c.req.json().catch(() => ({}))
			await actorRef.runNow(body.reason)
			return c.json({ queued: true })
		}

		case "correct": {
			const slug = c.req.param("slug")
			const body = await c.req.json()
			if (typeof body.confidence === "number" && (body.confidence < 0 || body.confidence > 1)) {
				return c.json({ error: "Confidence must be between 0 and 1" }, 400)
			}
			await actorRef.correctPosition(slug, body.text, body.confidence)
			return c.json({ corrected: true, slug })
		}

		case "config": {
			const body = await c.req.json()
			// Update model config, thresholds, etc.
			if (body.threshold !== undefined) {
				await actorRef.adjustThreshold(body.threshold)
			}
			if (body.signalWeight) {
				await actorRef.adjustSignalWeight(body.signalWeight.source, body.signalWeight.weight)
			}
			return c.json({ updated: true })
		}

		default:
			return c.text("Not found", 404)
	}
}
