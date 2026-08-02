import { NextResponse, type NextRequest } from 'next/server'
import { trackVisit, posthogAnalytics } from '@apideck/agent-analytics'
import {
  markdownServeDecision,
  markdownHeaders,
  synthesizeMarkdownPointer
} from '@apideck/agent-analytics/markdown'

const ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || 'http://localhost:3000'

const analytics = posthogAnalytics({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST
})

// Map public URLs to pre-built Markdown files under /md/. Extend this as you
// add more content — any path not covered here gets a synthesized pointer
// document so the Accept: text/markdown contract holds site-wide.
function resolveMirrorPath(pathname: string): string | null {
  if (pathname.startsWith('/docs/')) return `/md${pathname}.md`
  return null
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/md/') || pathname.startsWith('/_next/')) {
    return NextResponse.next()
  }

  const decision = markdownServeDecision(req)

  if (decision) {
    // Track every Markdown fetch with the source label (ua-rewrite,
    // md-suffix, accept-header). Errors are swallowed — analytics can
    // never break the response.
    //
    // No `onlyBots` filter on purpose: this only runs once the request has
    // already asked for Markdown, so even a plain browser hitting
    // /docs/intro.md is a signal worth keeping. Pass `onlyBots: true` to
    // restrict capture to declared crawlers, or `skipBrowsers: true` for
    // crawlers plus coding agents (curl/axios/got) only.
    void trackVisit(req, {
      analytics,
      source: decision.reason,
      // 0.12 keys distinctId with an HMAC. Without a stable secret the library
      // falls back to a random per-instance one, so ids stop correlating
      // between edge instances. Set AGENT_ANALYTICS_ID_SECRET in your project.
      idSecret: process.env.AGENT_ANALYTICS_ID_SECRET,
      // Adapters surface non-2xx now; without this a wrong PostHog key is
      // indistinguishable from success.
      onError: (err) => console.error('[agent-analytics]', err.message),
      properties: { site: 'starter' }
    })

    const target = resolveMirrorPath(decision.strippedPath)
    if (target) {
      const url = req.nextUrl.clone()
      url.pathname = target
      const response = NextResponse.rewrite(url)
      for (const [k, v] of Object.entries(markdownHeaders())) {
        response.headers.set(k, v)
      }
      return response
    }

    // No mirror for this path — return a pointer document so agents get
    // something parseable instead of HTML or a 404.
    const body = synthesizeMarkdownPointer({
      origin: ORIGIN,
      pathname: decision.strippedPath,
      llmsTxtUrl: `${ORIGIN}/llms.txt`
    })
    return new NextResponse(body, {
      status: 200,
      headers: markdownHeaders({ tokens: Math.ceil(body.length / 4) })
    })
  }

  // Plain HTML response — nothing special to do.
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/|md/|api/|favicon\\.ico|.*\\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|json|xml)).*)'
  ]
}
