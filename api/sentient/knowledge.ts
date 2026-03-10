import { readdir } from "node:fs/promises"
import matter from "gray-matter"
import type { Context } from "hono"

export async function handleKnowledge(c: Context) {
	const url = new URL(c.req.url)
	const path = url.pathname.replace("/sentient/knowledge/", "")

	// Serve skills as always-public
	const isSkills = path.startsWith("skills/")

	// Directory listing
	if (path.endsWith("/") || path === "") {
		const dirPath = `knowledge/${path}`
		try {
			const files = await readdir(dirPath)
			const mdFiles = files.filter((f) => f.endsWith(".md"))
			return c.json({ files: mdFiles, path: dirPath })
		} catch {
			return c.json({ files: [], path: dirPath })
		}
	}

	// Single file
	const filePath = isSkills ? `skills/${path.replace("skills/", "")}` : `knowledge/${path}`

	try {
		const file = await Bun.file(filePath).text()

		// Check per-node public override
		try {
			const { data: frontmatter } = matter(file)
			if (!isSkills && !frontmatter.public) {
				// Auth already checked by middleware for non-public routes
				// This is for fine-grained per-node control
			}
		} catch {
			// No frontmatter — serve as-is
		}

		return c.text(file, 200, { "Content-Type": "text/markdown" })
	} catch {
		return c.text("Not found", 404)
	}
}
