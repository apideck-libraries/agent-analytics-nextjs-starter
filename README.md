---
name: Agent Analytics Starter
slug: agent-analytics-starter
description: Track AI agent traffic (ClaudeBot, GPTBot, Perplexity, and 20+ more) in PostHog via middleware. Serves clean Markdown to agents on the same URLs — @apideck/agent-analytics wired in.
framework: Next.js
useCase: Edge Middleware
css: Plain CSS
deployUrl: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fapideck-libraries%2Fagent-analytics-nextjs-starter&env=NEXT_PUBLIC_POSTHOG_KEY,NEXT_PUBLIC_POSTHOG_HOST,AGENT_ANALYTICS_ID_SECRET&envDescription=PostHog%20key%20and%20host%2C%20plus%20a%20random%20secret%20for%20anonymous%20ids&envLink=https%3A%2F%2Fgithub.com%2Fapideck-libraries%2Fagent-analytics-nextjs-starter%23environment-variables&project-name=agent-analytics-starter&repository-name=agent-analytics-starter
demoUrl: https://agent-analytics-nextjs-starter.vercel.app
relatedTemplates:
  - bot-protection-datadome
  - bot-protection-botd
---

<div align="center">

<img src="./public/hero.svg" alt="Agent Analytics — see the agents your JavaScript can't." width="100%" />

# Agent Analytics — Next.js starter

### Next.js 15 starter that tracks AI agent traffic in PostHog — drop in your API key, deploy, watch ClaudeBot show up in your dashboard.

**One-click deploy.** Sample `/docs/` routes that serve as HTML to browsers and **clean Markdown to AI agents**. Every agent request fires an `agent_visit` event with `is_ai_bot`, `ua_category`, `bot_verification`, `source`, and `user_agent` — ready to segment in PostHog.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fapideck-libraries%2Fagent-analytics-nextjs-starter&env=NEXT_PUBLIC_POSTHOG_KEY,NEXT_PUBLIC_POSTHOG_HOST,AGENT_ANALYTICS_ID_SECRET&envDescription=PostHog%20key%20and%20host%2C%20plus%20a%20random%20secret%20for%20anonymous%20ids&envLink=https%3A%2F%2Fgithub.com%2Fapideck-libraries%2Fagent-analytics-nextjs-starter%23environment-variables&project-name=agent-analytics-starter&repository-name=agent-analytics-starter)

[**Live demo**](https://agent-analytics-nextjs-starter.vercel.app) · [**@apideck/agent-analytics**](https://github.com/apideck-libraries/agent-analytics) · [**The pattern, explained**](https://addyosmani.com/blog/agentic-engine-optimization/)

</div>

---

## What this template does

AI crawlers don't run JavaScript — so your client-side analytics never see them. This template closes that gap:

1. **`middleware.ts`** uses [`@apideck/agent-analytics`](https://www.npmjs.com/package/@apideck/agent-analytics) to detect 40+ known AI bots (ClaudeBot, GPTBot, PerplexityBot, Google-Extended, Applebot, Bytespider, DeepSeek, Grok, Cursor, Windsurf, and more) and capture an `agent_visit` event in PostHog on **every agent request** — HTML page views included, not only Markdown fetches.
2. **Coding agents and undeclared automation are captured too.** `curl`, `axios`, `python-requests` and headless browsers never announce themselves as crawlers, so they're classified by HTTP-client fingerprint and header shape instead of by name. Real browsers are skipped — they already run your client-side analytics.
3. **Every event carries a verification verdict.** `bot_verification` is `verified`, `spoofed`, `unverifiable`, or `not-claimed`, decided by checking the client IP against the vendor's published ranges. A user agent is a claim; this is the part that checks it.
4. **`/docs/` routes** are served as clean Markdown when an agent asks (via `.md` suffix, `Accept: text/markdown`, or a known bot UA) — otherwise HTML. Same URL, two representations.
5. **Every Markdown response** carries `Content-Signal`, `Vary: accept`, and `x-markdown-tokens` headers so agents can budget context before parsing.

Runs on Vercel's Fluid Compute. Zero infrastructure to manage, events land in PostHog seconds after deploy.

## Quick start

### 1. Deploy

Click the Deploy button above, or:

```bash
npx create-next-app --example https://github.com/apideck-libraries/agent-analytics-nextjs-starter my-app
cd my-app
vercel --prod
```

### 2. Set env vars

In the Vercel deploy prompt (or your project's env settings):

| Variable | Required | Example |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | yes | `phc_xxxxxxxx` — from PostHog project settings |
| `NEXT_PUBLIC_POSTHOG_HOST` | no (defaults to US cloud) | `https://us.i.posthog.com`, `https://eu.i.posthog.com`, or your own reverse-proxy |
| `AGENT_ANALYTICS_ID_SECRET` | recommended | any long random string — `openssl rand -hex 32` |

If `NEXT_PUBLIC_POSTHOG_KEY` is absent the middleware swaps in a no-op adapter: nothing breaks, no events flow, and — importantly — no outbound requests are made. The PostHog adapter itself doesn't check, so without this guard an unconfigured deployment would POST on every agent visit and log a 401 each time.

### 3. Verify

```bash
# A declared AI crawler — gets Markdown back, and is tracked
curl -A "ClaudeBot/1.0 probe-$(date +%s)" https://<your-deployment>.vercel.app/docs/intro

# A coding agent on an ordinary HTML page — also tracked
curl -A "curl/8.7.1" https://<your-deployment>.vercel.app/

# A real browser — deliberately NOT tracked
open https://<your-deployment>.vercel.app/docs/intro
```

Open PostHog → Activity and filter by `event = agent_visit`. You should see:

| probe | `bot_name` | `ua_category` | `is_ai_bot` | `bot_verification` | `source` |
|---|---|---|---|---|---|
| ClaudeBot | `Claude` | `declared-crawler` | `true` | `spoofed` | `ua-rewrite` |
| curl | `curl` | `coding-agent-hint` | `false` | `unverifiable` | `page-view` |
| browser | — | — | — | — | *no event* |

`spoofed` is the correct verdict for the first probe, and a useful thing to see once: you sent Anthropic's user agent from your laptop, and the IP check caught it. A real ClaudeBot from Anthropic's published range reports `verified`. `unverifiable` means the vendor publishes no range to check against — the honest answer for most coding agents, rather than a guess.

---

## How it works

```
 Agent / Browser                 middleware.ts                        PostHog
────────────────   ──────────────────────────────────────────────   ──────────
      │                                                                   │
      │ GET /docs/intro                                                   │
      ├────────────────────►                                              │
      │                                                                   │
      │           markdownServeDecision(req) → reason | null              │
      │                              │                                    │
      │           ┌──────────────────┴──────────────────┐                 │
      │           ▼                                     │                 │
      │   trackVisit(req, {                             │                 │
      │     skipBrowsers: !decision,  ← browsers only   │                 │
      │                                 skipped when    │                 │
      │                                 they didn't ask │                 │
      │                                 for Markdown    │                 │
      │     verify: verifyRequest,    ← IP vs published │                 │
      │                                 vendor ranges   │                 │
      │     source: reason ?? 'page-view',              │                 │
      │   }) ──fire-and-forget──keepalive fetch──►──────────────────►     │
      │                                                 │                 │
      │           ┌─────────────────────────────────────┘                 │
      │           ▼                                                       │
      │   decision ? rewrite → /md/…  :  NextResponse.next()              │
      │                                                                   │
      │ ◄──── 200 text/markdown  (or text/html)                           │
      │       Content-Signal, Vary: accept, x-markdown-tokens             │
      │                                                                   │
```

Tracking happens on the way through, before the routing branch — which is why an
AI crawler reading plain HTML is recorded just like one that asked for Markdown.

Key properties:

- **Fire-and-forget** — the capture is non-blocking. `keepalive: true` lets it survive after the response returns.
- **No person profiles** — `$process_person_profile: false` tells PostHog not to create one per unique bot fingerprint.
- **Keyed anon distinct_id** — HMAC-SHA-256 of `ip:ua` under `AGENT_ANALYTICS_ID_SECRET` collapses repeat fetches from the same agent into one visitor. Keyed rather than plain: the user agent ships in the clear on the same event, so an unkeyed hash is reversible back to the client IP by brute force.
- **Browsers cost you nothing** — `skipBrowsers: !decision` drops ordinary browser page views, which your client-side analytics already counts. A browser that explicitly requests Markdown is kept: that's a deliberate act, not background traffic.
- **Verification is a lookup, not a request** — `verifyRequest` matches the client IP against IP ranges published by the vendor and bundled with the library. No outbound call, nothing added to response latency. It ships from `@apideck/agent-analytics/verify` so the range tables only reach bundles that import them.

## Structure

```
.
├── middleware.ts               # The star of the show
├── middleware.test.ts          # What gets captured, and what gets routed where
├── middleware.nokey.test.ts    # No PostHog key → nothing leaves the box
├── app/
│   ├── layout.tsx
│   ├── page.tsx                # Landing page with probe instructions
│   ├── globals.css
│   └── docs/[slug]/page.tsx    # Human-facing docs (HTML)
├── public/
│   ├── md/docs/
│   │   ├── intro.md            # Agent-facing Markdown mirror
│   │   └── usage.md
│   └── llms.txt                # Agent-friendly site index
├── .env.example
├── package.json
└── README.md
```

## Tests

```bash
npm test          # vitest run
npm run test:watch
```

Ten tests over `middleware.ts`. Only the PostHog adapter is stubbed — `trackVisit`,
`markdownServeDecision` and `verifyRequest` all run for real, so the assertions
cover what the library actually does with the options passed to it, including the
`skipBrowsers` filtering that happens inside `trackVisit` rather than in this repo's
code.

The one worth keeping: **a `curl` user agent on a plain HTML path must produce an
event.** Tracking used to live inside the "did they ask for Markdown?" branch, which
meant the template recorded 0.08% of the agent traffic it claimed to measure. That is
an easy mistake to reintroduce and an invisible one in review, so it is pinned.

## Customising

**Add a new `/docs/` page**:

1. Create `public/md/docs/<slug>.md` — what agents see.
2. Add an entry to the `DOCS` object in `app/docs/[slug]/page.tsx` — what browsers see.
3. Update `public/llms.txt` so agents can discover it.

**Extend the mirror to cover other routes** (e.g. `/blog/*`, `/guides/*`):

Edit `resolveMirrorPath` in `middleware.ts`:

```ts
function resolveMirrorPath(pathname: string): string | null {
  if (pathname.startsWith('/docs/')) return `/md${pathname}.md`
  if (pathname.startsWith('/blog/')) return `/md${pathname}.md`   // ← add this
  return null
}
```

Then create matching `public/md/blog/*.md` files.

**Swap analytics backends** — replace the PostHog adapter with a webhook, Mixpanel, or your own callback:

```ts
import { trackVisit, webhookAnalytics } from '@apideck/agent-analytics'

const analytics = webhookAnalytics({
  url: 'https://collector.example.com/events',
  headers: { Authorization: `Bearer ${process.env.COLLECTOR_TOKEN}` }
})
```

Any `{ capture(event) }` object is a valid adapter.

## Environment variables

<a id="environment-variables"></a>

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key (the public key used by the JS SDK). Find it under *Project settings → Project API Key*. |
| `AGENT_ANALYTICS_ID_SECRET` | Secret used to key the anonymous `distinctId` HMAC. Any long random string. Without it each edge instance keys differently and ids stop correlating; publishing it makes the id reversible back to the client IP, so treat it like any other secret. |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingestion host. Defaults to `https://us.i.posthog.com`. Set to `https://eu.i.posthog.com` for EU cloud, or your own reverse-proxy domain (e.g. `https://svc.example.com`) to dodge ad-blockers. |

## Learn more

- [`@apideck/agent-analytics` on GitHub](https://github.com/apideck-libraries/agent-analytics) — the library powering this template
- [Agentic Engine Optimization](https://addyosmani.com/blog/agentic-engine-optimization/) — the case for agent-ready docs sites
- [contentsignals.org](https://contentsignals.org) — the `Content-Signal` header spec
- [developers.apideck.com](https://developers.apideck.com) — the production docs site this pattern was extracted from

## License

MIT © Apideck
