import type { Context } from "hono"
import type { PositionProofOfWork } from "../../actor/types"
import { getActorRef } from "./actor-ref"

export async function handleGet(c: Context, route: string) {
	const actorRef = getActorRef()
	if (!actorRef) return c.json({ error: "Actor not initialized" }, 503)

	switch (route) {
		case "status": {
			const status = await actorRef.getStatus()
			return c.json(status)
		}

		case "frontier": {
			try {
				const indexMd = await Bun.file("knowledge/INDEX.md").text()
				const calibration = await actorRef.getCalibrationState()

				return c.json({
					index: indexMd,
					tensions: calibration.pendingProofs
						.filter((p: PositionProofOfWork) => p.surpriseDelta > 0.3)
						.map((p: PositionProofOfWork) => ({
							slug: p.slug,
							surpriseDelta: p.surpriseDelta,
							path: `/sentient/knowledge/positions/${p.slug}.md`,
						})),
					inquiries: calibration.inquiries
						.filter(
							(i: { slug: string; tension: number; status: string }) =>
								i.status === "open" || i.status === "promoted",
						)
						.map((i: { slug: string; tension: number; status: string }) => ({
							slug: i.slug,
							tension: i.tension,
							path: `/sentient/knowledge/inquiries/${i.slug}.md`,
						})),
				})
			} catch {
				return c.json({ index: "", tensions: [], inquiries: [] })
			}
		}

		case "calibration": {
			const state = await actorRef.getCalibrationState()
			return c.json(state)
		}

		default:
			return c.text("Not found", 404)
	}
}
