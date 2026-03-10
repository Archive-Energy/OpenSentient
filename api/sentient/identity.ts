import type { Context } from "hono"
import { projectSentientJson } from "../../actor/identity"
import { parseSentientConfig } from "../../actor/materialize"

export async function handleIdentity(c: Context): Promise<Response> {
	try {
		const configRaw = await Bun.file("sentient.jsonc").text()
		const config = parseSentientConfig(configRaw)

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
