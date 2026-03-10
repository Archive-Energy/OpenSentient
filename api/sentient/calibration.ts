import type { Context } from "hono"
import { getActorRef } from "./actor-ref"

export async function handleCalibration(c: Context) {
	const actorRef = getActorRef()
	if (!actorRef) return c.json({ error: "Actor not initialized" }, 503)

	const url = new URL(c.req.url)
	const path = url.pathname.replace("/sentient/calibration/", "")
	const parts = path.split("/")

	if (parts.length < 2) return c.text("Invalid calibration route", 400)

	const [resource, slug, action] = parts

	switch (resource) {
		case "tension": {
			if (!slug || !action) return c.text("Missing slug or action", 400)
			switch (action) {
				case "confirm":
					await actorRef.confirmTension(slug)
					return c.json({ confirmed: true, slug })
				case "dismiss":
					await actorRef.dismissTension(slug)
					return c.json({ dismissed: true, slug })
				default:
					return c.text(`Unknown tension action: ${action}`, 400)
			}
		}

		case "inquiry": {
			if (!slug || !action) return c.text("Missing slug or action", 400)
			switch (action) {
				case "promote":
					return c.json({ promoted: true, slug })
				case "close":
					return c.json({ closed: true, slug })
				case "reframe": {
					const body = await c.req.json()
					return c.json({ reframed: true, slug, text: body.text })
				}
				default:
					return c.text(`Unknown inquiry action: ${action}`, 400)
			}
		}

		case "proof": {
			if (!slug || !action) return c.text("Missing slug or action", 400)
			switch (action) {
				case "accept": {
					const body = await c.req.json().catch(() => ({}))
					const confidence = typeof body.confidence === "number" ? body.confidence : undefined
					if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
						return c.json({ error: "Confidence must be between 0 and 1" }, 400)
					}
					await actorRef.acceptProof(slug, confidence)
					return c.json({
						accepted: true,
						slug,
						adjusted: confidence !== undefined,
						confidence: confidence ?? null,
					})
				}
				case "reject": {
					const body = await c.req.json()
					await actorRef.rejectProof(slug, body.note ?? "")
					return c.json({ rejected: true, slug, note: body.note })
				}
				default:
					return c.text(`Unknown proof action: ${action}`, 400)
			}
		}

		case "settings": {
			if (!slug) return c.text("Missing setting name", 400)
			switch (slug) {
				case "threshold": {
					const body = await c.req.json()
					await actorRef.adjustThreshold(body.value)
					return c.json({ updated: true, threshold: body.value })
				}
				case "signal-weight": {
					const body = await c.req.json()
					await actorRef.adjustSignalWeight(body.source, body.weight)
					return c.json({ updated: true, source: body.source, weight: body.weight })
				}
				default:
					return c.text(`Unknown setting: ${slug}`, 400)
			}
		}

		default:
			return c.text(`Unknown calibration resource: ${resource}`, 400)
	}
}
