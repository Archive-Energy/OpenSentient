import type { AgentsConfig } from "./types"

// ── CIMD Identity Projection ──────────────────────────────────────────
// Projects the private sentient.jsonc config into a public
// /.well-known/sentient.json document following CIMD conventions.
// See: https://client.dev (draft-ietf-oauth-client-id-metadata-document)

export interface SentientIdentityDocument {
	client_id: string
	name: string
	domain: string
	description: string
	boundaries: string[]
	adjacencies: string[]
	api?: {
		discovery: boolean
		public_skills: boolean
		public_positions: boolean
		public_inquiries: boolean
	}
	payments?: {
		enabled: boolean
		facilitator?: string
		pricing?: Record<string, string>
	}
	registry?: {
		url: string
	}
}

/**
 * Project a public identity document from the private config.
 * Strips all secrets, internal fields, and infrastructure config.
 * The `client_id` is the canonical URL of this document.
 */
export function projectSentientJson(
	config: AgentsConfig,
	baseUrl: string,
): SentientIdentityDocument {
	// Normalize base URL (remove trailing slash)
	const normalizedBase = baseUrl.replace(/\/+$/, "")
	const clientId = `${normalizedBase}/.well-known/sentient.json`

	const doc: SentientIdentityDocument = {
		client_id: clientId,
		name: config.name,
		domain: config.domain.name,
		description: config.domain.description,
		boundaries: config.domain.boundaries,
		adjacencies: config.domain.adjacencies,
	}

	// Include API visibility settings
	if (config.api) {
		doc.api = {
			discovery: config.api.discovery,
			public_skills: config.api.public_skills,
			public_positions: config.api.public_positions,
			public_inquiries: config.api.public_inquiries,
		}
	}

	// Include payment info (public — no secrets)
	if (config.payments?.enabled) {
		doc.payments = {
			enabled: true,
			pricing: config.payments.default_pricing,
		}
		// Add facilitator from registry if configured
		if (config.registry?.url) {
			doc.payments.facilitator = config.registry.url
		}
	}

	// Include registry URL (public)
	if (config.registry) {
		doc.registry = { url: config.registry.url }
	}

	return doc
}
