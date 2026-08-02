import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Behavioural tests for the middleware.
 *
 * The regression these exist to prevent: `trackVisit` used to sit inside
 * `if (decision)`, so the template only recorded requests that asked for
 * Markdown. Every coding agent on curl or python-requests, and all undeclared
 * headless traffic, went uncaptured — which for a template whose entire job is
 * "see the agents your JavaScript can't" is the feature not working.
 *
 * Only the PostHog *adapter* is stubbed. `trackVisit`, `markdownServeDecision`
 * and `verifyRequest` all run for real, so these assert what the library
 * actually does with the options the middleware passes — including the
 * `skipBrowsers` filtering, which happens inside `trackVisit` rather than in
 * our code. Stubbing `trackVisit` itself would only prove we call a function.
 */

const captured: Array<Record<string, unknown>> = []

vi.mock('@apideck/agent-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apideck/agent-analytics')>()
  return {
    ...actual,
    posthogAnalytics: () => ({
      async capture(event: { properties: Record<string, unknown> }) {
        captured.push(event.properties)
      }
    })
  }
})

// Must be set before the module under test is imported: the adapter is chosen
// once at module scope.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
vi.stubEnv('AGENT_ANALYTICS_ID_SECRET', 'test-secret')

const { middleware } = await import('./middleware')
const { NextRequest } = await import('next/server')

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Headers a real Chrome sends. Without these the UA alone reads as headless. */
const BROWSER_HEADERS = {
  'user-agent': BROWSER_UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1'
}

/**
 * Run the middleware and wait for the fire-and-forget capture to settle.
 *
 * The middleware deliberately does not await `trackVisit`, and the call chain
 * includes an async HMAC, so the event lands some ticks after the response.
 * A fixed `setTimeout(0)` is not enough — it made this suite flaky, with a
 * capture occasionally arriving after its assertion or bleeding into the next
 * test. So: return as soon as the event shows up, and only burn the full grace
 * period when a test is asserting that nothing was captured.
 */
const GRACE_MS = 500

async function visit(path: string, headers: Record<string, string>) {
  const before = captured.length
  const res = middleware(new NextRequest(`https://example.com${path}`, { headers }))

  const deadline = Date.now() + GRACE_MS
  while (Date.now() < deadline && captured.length === before) {
    await new Promise((r) => setTimeout(r, 2))
  }

  return res
}

beforeEach(() => {
  captured.length = 0
})

describe('agent capture', () => {
  it('records a coding agent on a plain HTML path', async () => {
    // The regression. Before the fix this produced nothing at all: no Markdown
    // was requested, so trackVisit was never reached.
    await visit('/docs/intro', { 'user-agent': 'curl/8.7.1' })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      bot_name: 'curl',
      ua_category: 'coding-agent-hint',
      is_ai_bot: false,
      source: 'page-view'
    })
  })

  it('records a declared AI crawler and labels how it was routed', async () => {
    await visit('/docs/intro', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      bot_name: 'ChatGPT',
      is_ai_bot: true,
      source: 'ua-rewrite'
    })
  })

  it('records an explicit .md request, even from a browser', async () => {
    // Asking for Markdown is a deliberate act, so the browser filter is lifted.
    await visit('/docs/intro.md', BROWSER_HEADERS)

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ source: 'md-suffix' })
  })

  it('ignores an ordinary browser page view', async () => {
    // Client-side analytics already counts these; capturing them here would
    // just double the bill.
    await visit('/docs/intro', BROWSER_HEADERS)

    expect(captured).toHaveLength(0)
  })

  it('attaches a verification verdict to every event', async () => {
    await visit('/docs/intro', { 'user-agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' })

    // A vendor UA arriving from an IP outside their published range is exactly
    // what the check is for. Whatever the verdict, the property must be there —
    // an event without it cannot be segmented on trust.
    expect(captured[0]).toHaveProperty('bot_verification')
    expect(['verified', 'spoofed', 'unverifiable', 'not-claimed']).toContain(
      captured[0].bot_verification
    )
  })
})

describe('routing', () => {
  it('rewrites a mirrored path to its Markdown twin', async () => {
    const res = await visit('/docs/intro', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' })

    expect(res.headers.get('x-middleware-rewrite')).toContain('/md/docs/intro.md')
  })

  it('serves a pointer document for a path with no mirror', async () => {
    const res = await visit('/pricing.md', { 'user-agent': 'curl/8.7.1' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    await expect(res.text()).resolves.toContain('llms.txt')
  })

  it('leaves a browser on the HTML response', async () => {
    const res = await visit('/docs/intro', BROWSER_HEADERS)

    // A pass-through carries neither the rewrite nor the Markdown headers.
    // `content-type` is absent entirely on NextResponse.next(), so the
    // Markdown-only headers are the reliable thing to assert against.
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('content-signal')).toBeNull()
    expect(res.headers.get('x-markdown-tokens')).toBeNull()
  })
})
