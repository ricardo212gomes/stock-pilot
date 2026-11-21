# Deploying to Vercel

StockPilot runs on [Vercel](https://vercel.com)'s Hobby plan (free for personal, non-commercial use). `main` deploys production, and `develop` and every pull request get a preview deployment. The scheduled jobs stay in GitHub Actions.

## The project

- Production is at **https://stock-pilot-three-vert.vercel.app** (`stock-pilot.vercel.app` was taken).
- Imported from the GitHub repository with the Next.js preset; the production branch is `main`.
- Node 22, from `engines` in `package.json`, as the GitHub Actions jobs use.
- Functions run in **Frankfurt (`fra1`)**, set in `vercel.json`, next to the Neon database (`eu-central-1`). Every page reads Postgres, and a US region would add a round trip to each query.

## Environment variables

They live in two places, and a rotated key has to be changed in both where it's listed twice.

| Variable | Vercel (Production) | Vercel (Preview) | GitHub Actions secrets |
| --- | --- | --- | --- |
| `FMP_API_KEY`, `GEMINI_API_KEY`, `FINNHUB_API_KEY`, `TIINGO_API_KEY`, `ALPHAVANTAGE_API_KEY` | Yes | Yes | Yes |
| `FRED_API_KEY`, `SEC_USER_AGENT` | Yes | Yes | Yes |
| `DATABASE_URL` | Yes | Yes, the same database | Yes |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Yes | Yes | Yes |
| `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` | Yes | Yes | Yes |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Yes | Yes, the same values | No |
| `AUTH_REDIRECT_PROXY_URL` | `https://stock-pilot-three-vert.vercel.app/api/auth` | The same | No |
| `APP_URL` | The production URL | No | The production URL |
| `AGENTS_GOOGLE_API_KEY`, `AI_PORTFOLIO_TRADING_ENABLED` | No | No | Yes, only the jobs read them |

- `AUTH_TRUST_HOST` isn't needed on Vercel: Auth.js trusts Vercel's host itself (`docs/auth.md`).
- Secrets are marked **Sensitive** in Vercel, so they can't be read back from the dashboard.

## Google sign-in

The Google OAuth client lists `https://stock-pilot-three-vert.vercel.app/api/auth/callback/google` as an authorized redirect URI, beside `http://localhost:3000/...` (`docs/auth.md`). A custom domain needs its own.

**Previews sign in through production.** Each preview has its own URL, and Google doesn't accept wildcard redirect URIs. With `AUTH_REDIRECT_PROXY_URL` set to production's `/api/auth`, Auth.js sends a preview's sign-in through production's redirect URI and back. That only needs the same `AUTH_SECRET` on both. Only production's URI is registered with Google.

Previews get the same `AUTH_*` variables as production on purpose. Without them the app treats sign-in as not set up: the account pages say "Sign-in isn't set up" and Data sources is shown to everyone. With them, someone who isn't signed in sees on a preview exactly what they see on production.

## The database

**One database everywhere:** production, previews, local development and the GitHub Actions jobs all use the same Neon database.

- `DATABASE_URL` is Neon's pooled connection string (the `-pooler` host). Serverless functions open many short connections, and `src/lib/db.ts` already turns off prepared statements for the pooler.
- A preview reads and writes the same data as production: signed in there, your portfolio, favorites and settings are the real ones.
- `npm run db:setup` stays a manual step after a schema change, as now.

## Limits that shaped the code

- **Function duration:** up to 300 seconds. The AI chat (`src/app/api/chat/route.ts`) and the pages whose server actions wait for Gemini or read a PDF (Portfolio, Financials, Transcripts, Intrinsic Value, Financial Projections, Plumas Projection) set `export const maxDuration = 300`.
- **Request body:** at most 4.5 MB. The Portfolio's statement import takes up to 4 MB (`src/lib/statement-limit.ts`), and the browser refuses a bigger file before sending it (`docs/portfolio.md`).
- **Cron jobs:** at most once a day on Hobby, so the schedules stay in GitHub Actions.
- **Caches:** Next's fetch cache (FMP, prices, Tiingo) is shared by the instances, which helps with FMP's daily limit. `/ai-portfolio` stays fresh with `connection()`.
- Going over a monthly allowance (1M invocations, 4 CPU-hours, 100 GB transfer) pauses the feature until the next period; Hobby never bills.

## GitHub Actions

The scheduled jobs (notifications, the AI portfolio, portfolio reviews, market valuation, the largest companies, pruning notifications) keep running in GitHub Actions, unchanged. They don't call the app, so the deployment doesn't affect them, except that `APP_URL` links Telegram messages to its pages:

```bash
gh secret set APP_URL   # https://stock-pilot-three-vert.vercel.app
```

The weekly largest-companies snapshot commits to `main`, and each of those commits deploys production; that's harmless.

`ci.yml` checks every pull request with lint, the type check, the Vitest tests and the Python tests (`agents/test_review.py`). The Vercel preview deployment is the other check, so a pull request merges once both pass.

## The Vercel MCP server

[Vercel's MCP server](https://vercel.com/docs/agent-resources/vercel-mcp) lets Claude Code list deployments, read build and runtime logs and search Vercel's docs:

```bash
claude mcp add --transport http vercel https://mcp.vercel.com
```

Then run `/mcp` in Claude Code to sign in with OAuth. It can do whatever your grant and team allow, so keep confirmation on for anything that deploys or changes settings. Useful questions: "why did the last deploy fail?", "show the runtime errors on /api/chat today", "is the preview for PR #N ready?".
