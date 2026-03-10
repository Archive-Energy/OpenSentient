import type { Context } from "hono"
import { streamSSE } from "hono/streaming"

export function handleStream(c: Context, mode: "all" | "calibration") {
	return streamSSE(c, async (stream) => {
		await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })

		const interval = setInterval(async () => {
			try {
				await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })
			} catch {
				clearInterval(interval)
			}
		}, 30_000)

		stream.onAbort(() => {
			clearInterval(interval)
		})

		await new Promise(() => {})
	})
}
