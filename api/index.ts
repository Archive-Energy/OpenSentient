import { Hono } from "hono"
import { handleCalibration } from "./sentient/calibration"
import { handleGet } from "./sentient/get"
import { handleKnowledge } from "./sentient/knowledge"
import { handlePost } from "./sentient/post"
import { handleStream } from "./sentient/stream"

const app = new Hono()

// ── Auth Middleware ────────────────────────────────────────────────────

import type { Context } from "hono"

const authMiddleware = async (c: Context, next: () => Promise<void>) => {
	const apiKey = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace("Bearer ", "")
	if (!apiKey) return c.text("Unauthorized", 401)
	// Unkey validation would go here — for now accept any key
	await next()
}

// ── Public Routes ─────────────────────────────────────────────────────

app.get("/sentient/status", (c) => handleGet(c, "status"))
app.get("/sentient/knowledge/INDEX.md", (c) => handleKnowledge(c))
app.get("/sentient/knowledge/skills/*", (c) => handleKnowledge(c))

// ── Authenticated Routes ──────────────────────────────────────────────

app.use("/sentient/knowledge/*", authMiddleware)
app.use("/sentient/frontier", authMiddleware)
app.use("/sentient/stream", authMiddleware)
app.use("/sentient/calibration/*", authMiddleware)

app.get("/sentient/knowledge/*", (c) => handleKnowledge(c))
app.get("/sentient/frontier", (c) => handleGet(c, "frontier"))
app.get("/sentient/stream", (c) => handleStream(c, "all"))
app.get("/sentient/calibration/stream", (c) => handleStream(c, "calibration"))
app.get("/sentient/calibration", (c) => handleGet(c, "calibration"))

// ── Calibration Routes ────────────────────────────────────────────────

app.post("/sentient/calibration/*", (c) => handleCalibration(c))

// ── Owner Routes ──────────────────────────────────────────────────────

app.post("/sentient/signal", (c) => handlePost(c, "signal"))
app.post("/sentient/run", (c) => handlePost(c, "run"))
app.post("/sentient/correct/:slug", (c) => handlePost(c, "correct"))
app.post("/sentient/config", (c) => handlePost(c, "config"))

export { app }
export type AppType = typeof app
