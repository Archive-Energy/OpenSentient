import { db } from "rivetkit/db"

export const actorDb = db({
	onMigrate: async (database) => {
		await database.execute(`
      CREATE TABLE IF NOT EXISTS positions (
        slug TEXT PRIMARY KEY,
        confidence REAL NOT NULL DEFAULT 0.0,
        surprise_delta REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'settled',
        source_session TEXT,
        text TEXT NOT NULL,
        wikilinks TEXT, -- JSON array
        public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_positions_surprise
        ON positions (surprise_delta DESC)
    `)

		await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_positions_status
        ON positions (status)
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS inquiries (
        slug TEXT PRIMARY KEY,
        tension REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'open',
        text TEXT NOT NULL,
        related_positions TEXT, -- JSON array
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_inquiries_tension
        ON inquiries (tension DESC)
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS record (
        id TEXT PRIMARY KEY,
        trigger_signal_id TEXT,
        tension_at_trigger REAL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        positions_updated INTEGER DEFAULT 0,
        inquiries_opened INTEGER DEFAULT 0,
        narrative TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        bucket TEXT NOT NULL DEFAULT 'system', -- system | curated | generated
        source TEXT,
        sessions_used INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0.0,
        installed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        source_provider TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        content TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'medium',
        credibility REAL NOT NULL DEFAULT 0.5,
        tension_score REAL,
        processed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS calibration (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- proof_accepted | proof_rejected | tension_dismissed | correction
        slug TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'owner',
        detail TEXT, -- JSON
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

		await database.execute(`
      CREATE TABLE IF NOT EXISTS cost_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- triage | scan | session | embedding | x402_purchase
        cost_usd REAL NOT NULL DEFAULT 0.0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        model TEXT,
        provider TEXT,
        created_at INTEGER NOT NULL -- epoch ms
      )
    `)

		await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_cost_log_created
        ON cost_log (created_at DESC)
    `)
	},
})
