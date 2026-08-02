import { describe, expect, it, vi } from 'vitest'

/**
 * With no PostHog key configured, nothing should leave the box.
 *
 * The adapter does not check for this itself: given an empty `apiKey` it still
 * POSTs to PostHog, which answers 401 and throws. On a deployment with no key —
 * the state this template's own demo was in — that is a wasted outbound request
 * and an error log on every agent visit. Since the template is built to be
 * cloned by people who click Deploy before they have a key, the middleware
 * swaps in a no-op adapter instead.
 *
 * Nothing is mocked here except `fetch`, so this exercises the real adapter
 * selection rather than a stand-in for it. Lives in its own file because the
 * adapter is chosen once, at module scope, from the environment.
 */

const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
vi.stubGlobal('fetch', fetchSpy)

vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
vi.stubEnv('AGENT_ANALYTICS_ID_SECRET', 'test-secret')

const { middleware } = await import('./middleware')
const { NextRequest } = await import('next/server')

describe('no PostHog key configured', () => {
  it('makes no outbound request for an agent visit', async () => {
    middleware(
      new NextRequest('https://example.com/docs/intro', {
        headers: { 'user-agent': 'curl/8.7.1' }
      })
    )
    // Generous: if a request were going to be made, it would be made by now.
    await new Promise((r) => setTimeout(r, 500))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still serves the Markdown twin', async () => {
    // Analytics being switched off must not change what agents are served.
    const res = middleware(
      new NextRequest('https://example.com/docs/intro', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' }
      })
    )

    expect(res.headers.get('x-middleware-rewrite')).toContain('/md/docs/intro.md')
  })
})
