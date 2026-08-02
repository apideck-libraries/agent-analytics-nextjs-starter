import { NextResponse, type NextRequest } from 'next/server'
import { trackVisit, posthogAnalytics } from '@apideck/agent-analytics'
import {
  markdownServeDecision,
  markdownHeaders,
  synthesizeMarkdownPointer
} from '@apideck/agent-analytics/markdown'
// Identity verification lives on its own subpath: the published IP-range
// tables are only pulled into bundles that ask for them.
import { verifyRequest } from '@apideck/agent-analytics/verify'

const ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || 'http://localhost:3000'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

// Without a key, drop events on the floor instead of shipping them.
//
// The adapter does not check: given an empty apiKey it still POSTs to PostHog,
// which answers 401 and throws. On a deployment with no key configured — the
// state this template's own demo was in — that is one pointless outbound
// request and one error log per agent visit, and this template exists to be
// cloned by people who click Deploy before they have a key. The README has
// always promised a silent no-op here; this is what makes that true.
const analytics = POSTHOG_KEY
  ? posthogAnalytics({ apiKey: POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST })
  : { async capture() {} }

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

  // Track first, serve second — and track *every* agent request, not only the
  // ones that asked for Markdown.
  //
  // This used to sit inside `if (decision)`, which meant the starter captured
  // Markdown fetches and nothing else. That is a small slice of reality: on
  // Apideck's own properties, Markdown was 8,283 requests out of 9.96M from
  // machines over a quarter. Everything else — coding agents on curl and
  // python-requests, undeclared headless traffic — went unrecorded, so anyone
  // pointing a crawler at an HTML page saw an empty dashboard and reasonably
  // concluded the template was broken.
  void trackVisit(req, {
    analytics,

    // Browsers are the one thing worth dropping: they already run your
    // client-side analytics, so capturing them here just doubles the bill.
    // The exception is a browser that explicitly asked for Markdown — that is
    // a deliberate act and a genuine signal, so when there is a decision the
    // filter is lifted.
    skipBrowsers: !decision,

    // Where the request came from: 'ua-rewrite' | 'md-suffix' |
    // 'accept-header' when Markdown was requested, otherwise a plain page view.
    source: decision ? decision.reason : 'page-view',

    // Turns `bot_verification` into one of verified / spoofed / unverifiable /
    // not-claimed by checking the client IP against the vendor's published
    // ranges. A user agent is a claim; this is the only part of the event that
    // checks it. Costs one range lookup and no network call.
    verify: verifyRequest,

    // distinctId is an HMAC. Without a stable secret the library falls back to
    // a random per-instance one, so ids stop correlating between edge
    // instances. Set AGENT_ANALYTICS_ID_SECRET in your project.
    idSecret: process.env.AGENT_ANALYTICS_ID_SECRET,

    // Adapters surface non-2xx; without this a wrong PostHog key is
    // indistinguishable from success.
    onError: (err) => console.error('[agent-analytics]', err.message),

    properties: { site: 'starter' }
  })

  if (decision) {
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
