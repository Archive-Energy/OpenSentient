import type { Context } from "hono"
import { streamSSE } from "hono/streaming"

// Actor ref reserved for production event subscription
let _actorRef: unknown = null
export function setActorRef(ref: unknown) {
	_actorRef = ref
}

export function handleStream(c: Context, mode: "all" | "calibration") {
	return streamSSE(c, async (stream) => {
		// Send initial heartbeat
		await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })

		// Subscribe to actor events
		// In production, this would use the rivetkit client event subscription
		// For now, we poll at a reasonable interval
		const interval = setInterval(async () => {
			try {
				await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })
			} catch {
				clearInterval(interval)
			}
		}, 30_000)

		// Keep connection alive until client disconnects
		stream.onAbort(() => {
			clearInterval(interval)
		})

		// In production with rivetkit client:
		// const conn = actorHandle.connect()
		// conn.on("calibrationEvent", async (event) => {
		//   if (mode === "calibration" && !isCalibrationEvent(event)) return
		//   await stream.writeSSE({ data: JSON.stringify(event) })
		// })
		//
		// stream.onAbort(() => conn.dispose())

		// Block until aborted
		await new Promise(() => {})
	})
}

// function isCalibrationEvent(event: any): boolean {
//   const calibrationTypes = [
//     "proofSurfaced", "proofAccepted", "proofRejected",
//     "tensionDetected", "tensionConfirmed", "tensionDismissed",
//     "thresholdAdjusted",
//   ]
//   return calibrationTypes.includes(event.type)
// }
