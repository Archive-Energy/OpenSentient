/**
 * x402 Payment Middleware (scaffold)
 *
 * Returns 402 Payment Required for routes that require payment.
 * Actual Stripe Machine Payments integration deferred to Phase 4
 * of the implementation plan — requires @x402/hono, Stripe Connect
 * account, and confirmation that Connect + Machine Payments compose.
 *
 * For now: route-level price gating with proper 402 response shape.
 */

import type { Context, Next } from "hono"

export interface RoutePrice {
	price: string // USD amount, e.g. "0.10"
	description: string
}

export interface X402Config {
	enabled: boolean
	pricing: Record<string, RoutePrice> // "GET /api/positions/:slug/history" -> price
	network: string // "base"
	currency: string // "USDC"
}

/**
 * Create x402 middleware for a Hono app.
 * When enabled, checks each route against pricing config and returns
 * 402 Payment Required if no valid payment proof header is present.
 */
export function createX402Middleware(config: X402Config) {
	return async (c: Context, next: Next) => {
		if (!config.enabled) return next()

		// Build route key: "METHOD /path"
		const method = c.req.method
		const path = new URL(c.req.url).pathname
		const routeKey = `${method} ${path}`

		// Check if this route requires payment
		const routePrice = config.pricing[routeKey]
		if (!routePrice) return next()

		// Check for payment proof header
		const paymentProof = c.req.header("X-Payment-Proof")
		if (paymentProof) {
			// TODO: Verify payment proof via Stripe x402 facilitator
			// For now, pass through if header is present
			return next()
		}

		// Return 402 Payment Required
		return c.json(
			{
				error: "Payment Required",
				price: routePrice.price,
				currency: config.currency,
				network: config.network,
				description: routePrice.description,
			},
			402,
		)
	}
}
