import type { DatasetConfig, DatasetOutput, IngestSignal, PositionUpdate } from "./types"
import { needsSandbox } from "./types"

// ── Column Mapping ───────────────────────────────────────────────────

function applyColumnMap(
	row: Record<string, unknown>,
	config: DatasetConfig,
): Record<string, unknown> {
	if (!config.column_map) return row
	const mapped: Record<string, unknown> = {}
	for (const [srcCol, destCol] of Object.entries(config.column_map)) {
		if (row[srcCol] !== undefined) mapped[destCol] = row[srcCol]
	}
	for (const [key, val] of Object.entries(row)) {
		if (!config.column_map[key]) mapped[key] = val
	}
	return mapped
}

function extractContent(row: Record<string, unknown>, config: DatasetConfig): string {
	if (config.content_column && row[config.content_column] !== undefined) {
		return String(row[config.content_column])
	}
	for (const key of ["text", "content", "body", "description"]) {
		if (typeof row[key] === "string") return row[key] as string
	}
	const firstString = Object.values(row).find((v) => typeof v === "string")
	return firstString ? String(firstString) : JSON.stringify(row)
}

function extractConfidence(row: Record<string, unknown>, config: DatasetConfig): number {
	if (config.label_column && row[config.label_column] !== undefined) {
		const val = Number(row[config.label_column])
		if (!Number.isNaN(val)) return Math.min(1, Math.max(0, val))
	}
	return config.credibility ?? 0.5
}

// ── Row Converters ───────────────────────────────────────────────────

function rowToSignal(
	row: Record<string, unknown>,
	index: number,
	config: DatasetConfig,
): IngestSignal {
	const mapped = applyColumnMap(row, config)
	return {
		id: `dataset-${config.uri}-${index}-${crypto.randomUUID()}`,
		sourceProvider: "dataset",
		sourceMode: "batch",
		content: extractContent(mapped, config),
		urgency: "medium",
		credibility: extractConfidence(mapped, config),
		timestamp: Date.now(),
		metadata: { datasetSource: config.source, datasetUri: config.uri, rowIndex: index },
	}
}

function rowToPosition(
	row: Record<string, unknown>,
	index: number,
	config: DatasetConfig,
): PositionUpdate {
	const mapped = applyColumnMap(row, config)
	const text = extractContent(mapped, config)
	const slug =
		typeof mapped.slug === "string"
			? (mapped.slug as string)
			: `dataset-${config.uri.replace(/[^a-z0-9]/gi, "-")}-${index}`
	return {
		slug,
		text,
		confidence: extractConfidence(mapped, config),
		surpriseDelta: 0,
		priorConfidence: 0,
		status: "settled",
	}
}

// ── Parsers ──────────────────────────────────────────────────────────

type Rows = Record<string, unknown>[]

const parsers: Record<string, (uri: string) => Promise<Rows>> = {
	async json(uri) {
		const data = await Bun.file(uri).json()
		return Array.isArray(data) ? data : [data]
	},
	async jsonl(uri) {
		const text = await Bun.file(uri).text()
		return text
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
	},
	async csv(uri) {
		return Bun.csv(Bun.file(uri), { headers: true }) as Promise<Rows>
	},
	async url(uri) {
		const res = await fetch(uri)
		if (!res.ok) throw new Error(`Dataset fetch failed (${res.status}): ${uri}`)
		const contentType = res.headers.get("content-type") ?? ""
		if (contentType.includes("json")) {
			const data = await res.json()
			return Array.isArray(data) ? (data as Rows) : [data as Rows[0]]
		}
		const text = await res.text()
		try {
			const data = JSON.parse(text)
			return Array.isArray(data) ? data : [data]
		} catch {
			return Bun.csv(text, { headers: true }) as unknown as Rows
		}
	},
}

// ── Local Ingestion (Actor-side) ─────────────────────────────────────

export async function ingestDatasetLocal(config: DatasetConfig): Promise<DatasetOutput> {
	if (needsSandbox(config.source)) {
		throw new Error(
			`Dataset source "${config.source}" requires sandbox. Use runDatasetSession() instead.`,
		)
	}

	const parser = parsers[config.source]
	if (!parser) throw new Error(`Unsupported local dataset source: ${config.source}`)

	const rows = (await parser(config.uri)).slice(0, config.limit ?? 1000)
	const output: DatasetOutput = {
		source: `${config.source}:${config.uri}`,
		rowsProcessed: rows.length,
	}

	if (config.mode === "signals") {
		output.signals = rows.map((row, i) => rowToSignal(row, i, config))
	} else if (config.mode === "positions") {
		output.positions = rows.map((row, i) => rowToPosition(row, i, config))
	}
	return output
}
