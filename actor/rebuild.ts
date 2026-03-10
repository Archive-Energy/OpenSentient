#!/usr/bin/env bun
/**
 * Rebuild SQLite index from knowledge/ markdown files.
 * Usage: bun run rebuild-index [--embed]
 *
 * Deletes and reconstructs the SQLite database from markdown source of truth.
 * With --embed: also runs embedding pass for tension evaluation.
 */

import { readdir } from "node:fs/promises"
import matter from "gray-matter"
import { parseAgentsMd } from "./materialize"
import { embed } from "./tension"
import type { ModelRole } from "./types"

const shouldEmbed = process.argv.includes("--embed")

async function parseMarkdownDir(
	dir: string,
): Promise<Array<{ slug: string; data: Record<string, unknown>; content: string }>> {
	const entries: Array<{ slug: string; data: Record<string, unknown>; content: string }> = []
	try {
		const files = await readdir(dir)
		for (const file of files) {
			if (!file.endsWith(".md")) continue
			const raw = await Bun.file(`${dir}/${file}`).text()
			try {
				const { data, content } = matter(raw)
				const slug = data.id ?? file.replace(".md", "")
				entries.push({ slug, data, content: content.trim() })
			} catch {
				console.warn(`  Skipping ${file} — unparseable frontmatter`)
			}
		}
	} catch {
		// Directory doesn't exist yet — ok
	}
	return entries
}

async function main() {
	console.log("REBUILD INDEX")
	console.log("─".repeat(50))

	// Read AGENTS.md for embedding config
	let embeddingConfig: ModelRole | null = null
	try {
		const agentsMdRaw = await Bun.file("AGENTS.md").text()
		const { config } = parseAgentsMd(agentsMdRaw)
		embeddingConfig = config.models.embedding
	} catch {
		if (shouldEmbed) {
			console.error("  Cannot embed: AGENTS.md not found or invalid")
			process.exit(1)
		}
	}

	// Parse positions
	const positions = await parseMarkdownDir("knowledge/positions")
	console.log(`  Positions: ${positions.length} files`)

	// Parse inquiries
	const inquiries = await parseMarkdownDir("knowledge/inquiries")
	console.log(`  Inquiries: ${inquiries.length} files`)

	// Parse record
	const records = await parseMarkdownDir("knowledge/record")
	console.log(`  Records:   ${records.length} files`)

	// Open database (this will be the Actor's SQLite — for local dev/rebuild)
	const db = new (await import("bun:sqlite")).Database("opensentient.db")
	db.exec("DROP TABLE IF EXISTS positions")
	db.exec("DROP TABLE IF EXISTS inquiries")
	db.exec("DROP TABLE IF EXISTS record")

	// Recreate tables
	db.exec(`CREATE TABLE positions (
    slug TEXT PRIMARY KEY, confidence REAL, surprise_delta REAL,
    status TEXT, source_session TEXT, text TEXT, wikilinks TEXT,
    public INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
  )`)
	db.exec("CREATE INDEX idx_positions_surprise ON positions (surprise_delta DESC)")
	db.exec("CREATE INDEX idx_positions_status ON positions (status)")

	db.exec(`CREATE TABLE inquiries (
    slug TEXT PRIMARY KEY, tension REAL, status TEXT, text TEXT,
    related_positions TEXT, created_at TEXT, updated_at TEXT
  )`)

	db.exec(`CREATE TABLE record (
    id TEXT PRIMARY KEY, trigger_signal_id TEXT, tension_at_trigger REAL,
    started_at TEXT, completed_at TEXT, positions_updated INTEGER,
    inquiries_opened INTEGER, narrative TEXT, created_at TEXT
  )`)

	// Insert positions
	const insertPos = db.prepare(
		`INSERT INTO positions (slug, confidence, surprise_delta, status, source_session, text, wikilinks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const p of positions) {
		insertPos.run(
			p.slug,
			p.data.confidence ?? 0,
			p.data.surprise_delta ?? 0,
			p.data.status ?? "settled",
			p.data.source_session ?? null,
			p.content,
			JSON.stringify(p.data.wikilinks ?? []),
			p.data.created_at ?? new Date().toISOString(),
			p.data.updated_at ?? new Date().toISOString(),
		)
	}

	// Insert inquiries
	const insertInq = db.prepare(
		`INSERT INTO inquiries (slug, tension, status, text, related_positions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const i of inquiries) {
		insertInq.run(
			i.slug,
			i.data.tension ?? 0,
			i.data.status ?? "open",
			i.content,
			JSON.stringify(i.data.related_positions ?? []),
			i.data.created_at ?? new Date().toISOString(),
			i.data.updated_at ?? new Date().toISOString(),
		)
	}

	// Insert records
	const insertRec = db.prepare(
		`INSERT INTO record (id, trigger_signal_id, tension_at_trigger, started_at, completed_at, positions_updated, inquiries_opened, narrative, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const r of records) {
		insertRec.run(
			r.slug,
			r.data.trigger_signal_id ?? null,
			r.data.tension_at_trigger ?? null,
			r.data.started_at ?? null,
			r.data.completed_at ?? null,
			r.data.positions_updated ?? 0,
			r.data.inquiries_opened ?? 0,
			r.content,
			r.data.created_at ?? new Date().toISOString(),
		)
	}

	console.log("  SQLite rebuilt.")

	// Optional embedding pass
	if (shouldEmbed && embeddingConfig) {
		console.log("  Running embedding pass...")
		for (const p of positions) {
			try {
				const embedding = await embed(p.content, embeddingConfig)
				console.log(`    Embedded: ${p.slug} (${embedding.length} dims)`)
			} catch (err) {
				console.warn(`    Failed: ${p.slug} — ${err}`)
			}
		}
		console.log("  Embedding pass complete.")
	}

	db.close()
	console.log("─".repeat(50))
	console.log(
		`Done. ${positions.length} positions, ${inquiries.length} inquiries, ${records.length} records.`,
	)
}

main().catch(console.error)
