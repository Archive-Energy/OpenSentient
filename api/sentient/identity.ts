import type { Context } from "hono"
import { projectSentientJson } from "../../actor/identity"
import { parseSentientConfig } from "../../actor/materialize"

/**
 * GET /.well-known/sentient.json
 *
 * Serves the CIMD identity document — a public projection of the
 * factory's sentient.jsonc config. No auth required.
 *
 * The document is generated on each request from the config file.
 * In production, this could be cached and invalidated on config change.
 */
export async function handleIdentity(c: Context): Promise<Response> {
	try {
		const configRaw = await Bun.file("sentient.jsonc").text()
		const config = parseSentientConfig(configRaw)

		// Derive base URL from request or env
		const baseUrl =
			process.env.SENTIENT_BASE_URL ||
			`${c.req.header("x-forwarded-proto") ?? "https"}://${c.req.header("host")}`

		const doc = projectSentientJson(config, baseUrl)

		return c.json(doc, 200, {
			"Cache-Control": "public, max-age=300",
			"Content-Type": "application/json",
		})
	} catch (error) {
		return c.json(
			{
				error: "Identity document unavailable",
				detail: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
}
