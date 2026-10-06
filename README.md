# Nortia Supply

React (JavaScript), Vite, Tailwind, TanStack Table/Virtual, and Supabase, deployed as
one Cloudflare Worker serving the frontend and `/api/*`. Desktop layout, minimum
width 1024px, without responsive breakpoints.

## Current scope — Phases 1–5

- Environment template and browser/request-scoped Supabase clients using `@supabase/ssr`.
- Email/password login and local-session logout, with no public signup.
- Authorized-user access via `usuarios_autorizados`, backed by the existing RLS policies.
- Read-only cash overview: bank balance, receivables, overdue balances, disputes, and
  overdue/next-seven-day obligations.
- Searchable, filterable, sortable obligations table using native TanStack Table v9
  and TanStack Virtual.
- Configuration, loading, empty, denied-access, error, and retry states.
- Separate Cobranza view: prioritized customer queue, filters, contacts, and invoice/payment/credit-note details.
- Four-file CSV imports with validation, private archives, preview, history, and explicit atomic activation.
- 13-week cash forecast with base/conservative scenarios, daily shortfall indicators,
  weekly chart/table, and explicit historical timing assumptions.

Saving collection activity, AI drafts, password recovery, and additional screens
are future phases. The seven-day cash signal assumes no new collections; it is not a
prediction. Financial values come from the active validated import, with no demo-data
fallback and no use of the system date as the business cutoff.

## Run locally

Use Node 22.13+ within the Node 22 line (`.nvmrc`), or Node 24+, and npm.

```sh
nvm use
npm ci
cp -n .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:5173**. Vite runs React and the Worker API together; no separate
backend process or Cloudflare login is needed locally.

Fill both pairs in `.env.local` with the same project's public configuration:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is available in Supabase Project Settings → API. A legacy anon
key also works in these variables. Never use a secret/service-role key here.
`VITE_*` values are embedded in the browser build; the unprefixed values configure the
Worker. `.env.local` is ignored by Git. Restart Vite after changing it. Do not add
`.dev.vars`, which overrides Cloudflare's dotenv loading.

**Complete [the Supabase setup guide](docs/SUPABASE.md)** to configure Auth, add the
read-only dashboard RPC to your existing schema, and authorize a test user. No data
import is required to test login and the empty state. Your existing financial schema
must already exist; this repository's dashboard migration does not recreate it.

For CSV imports, complete [Phase 3 setup](docs/IMPORTS.md): apply the second migration
and add the server-only `SUPABASE_SECRET_KEY`. Login and dashboard reads still use
the public key.

For the 13-week forecast, apply [Phase 4 setup](docs/FORECAST.md). It adds one read-only
RPC and uses the existing imported data and public credentials.

For the separate collections workspace, apply [Phase 5 setup](docs/COLLECTIONS.md).
It adds two read-only RPCs and uses your existing imports, with no new secret.

## Architecture and files

| Files | Purpose |
| --- | --- |
| `.env.example`, `.nvmrc`, `package.json`, `package-lock.json` | Environment and dependencies |
| `vite.config.js`, `wrangler.jsonc` | React/Tailwind integration and single Worker deployment |
| `eslint.config.js`, `.gitignore` | Code checks and local/generated-file exclusions |
| `index.html`, `src/main.jsx`, `src/styles.css` | Entry point, 1024px layout, Tailwind |
| `src/App.jsx`, `src/components/ErrorBoundary.jsx` | Authenticated shell and rendering failures |
| `src/features/auth/` | Login form and safe sign-in errors |
| `src/hooks/use-session-status.js`, `src/lib/api.js` | Session verification, timeouts, cancellation, API errors |
| `src/features/cash/` | Dashboard fetching, cash summary, virtualized obligations |
| `src/features/forecast/`, `worker/forecast/`, `worker/routes/forecast.js` | Forecast UI, exact calculation engine, authorized GET API |
| `supabase/migrations/202610060003_forecast.sql`, `docs/FORECAST.md` | Forecast query and model/setup documentation |
| `src/lib/supabase/browser.js` | Lazy cookie-based browser client |
| `shared/supabase-config.js` | Configuration validation |
| `shared/dashboard-contract.js`, `shared/format.js` | Payload validation and exact amount/date formatting |
| `worker/index.js`, `worker/routes/dashboard.js` | Read-only session and dashboard API routes |
| `worker/lib/supabase/` | Request-scoped server client, authentication, authorization |
| `supabase/migrations/202610060001_dashboard.sql` | Additive, authorized dashboard RPC |
| `supabase/verify-phase2.sql` | Read-only schema/security inspection |
| `docs/SUPABASE.md` | Exact hosted-project setup steps |
| `tests/`, `supabase/tests/dashboard.test.sql` | API, formatting, and SQL regression tests |

The browser uses the official Supabase client for login/logout. The Worker verifies
identity with `auth.getUser()` and separately checks `usuarios_autorizados` before
calling the dashboard RPC. Both use the public key plus the user's session; neither
bypasses RLS. `withAuthenticatedUser` is a Worker handler wrapper, not a Next.js Server
Action; financial handlers use `withAuthorizedUser`.

Every server request gets a fresh Supabase client. Refreshed/cleared cookies and cache
headers reach the browser even on errors and redirects. Authenticated responses use
`Cache-Control: private, no-store`; unsafe methods require a matching Origin. Import writes use a separate privileged server client only after authentication and
authorization. Provider requests and browser API waits are bounded.

`GET /api/session` returns verified identity. `GET /api/dashboard` returns a single
consistent snapshot, its summary, and pending obligations. Monetary values are decimal
strings over JSON and formatted with BigInt, avoiding unsafe Number conversions.
Credit notes and payment allocations are aggregated separately to avoid multiplying
amounts; replacement invoices remain independent receivables. Future-dated transactions
are excluded from cutoff balances, and negative invoice balances are rejected.

Error responses contain safe messages and a request ID. Worker error logs contain
only status, code, and request ID, not credentials or financial payloads. External
uptime monitoring and alert delivery remain future work.

Imports use `GET/POST /api/importaciones` and `POST /api/importaciones/:id/activar`.
The parser and reconciliation live in `worker/imports/`, handlers in
`worker/routes/imports.js`, and the UI in `src/features/imports/Imports.jsx`.
`supabase/migrations/202610060002_imports.sql` supplies the transactional write RPCs
and private archive bucket. See [the import guide](docs/IMPORTS.md) for limits and recovery.

## Validation

```sh
npm run check    # ESLint, Node tests, production build
npm run preview  # Preview the built application locally
npm run test:sql # Optional: isolated PostgreSQL regression (PostgreSQL binaries required)
```

Node tests mock Supabase calls and need no real credentials. They cover cookie refresh,
redirect responses, concurrent session isolation, authorization, API/provider errors,
invalid financial payloads, integer precision, dates, CSV reconciliation, and import failures.
The optional SQL runner creates and removes its own local cluster; it never connects to Supabase. Browser smoke tests use
synthetic responses for login, logout, dashboard states, and virtualized-table behavior.

The SQL regression file was validated in an isolated local PostgreSQL cluster. To run
it yourself, use a fresh disposable cluster with no existing anon/authenticated roles,
create an empty database named `nortia_dashboard_test`, then:

```sh
psql -X -v ON_ERROR_STOP=1 -d nortia_dashboard_test -f supabase/tests/dashboard.test.sql
```

The fixture creates synthetic schema/roles. Never run it against Supabase or an existing
application database; discard the whole test cluster afterward. Hosted schema deployment
and real-account login still need the steps in the Supabase setup guide.

## Cloudflare deployment

Deployment is configured but has not been performed by this implementation.
Provide both `VITE_*` values during the build, then:

```sh
npx wrangler login
npm run deploy
```

For the first deployment, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the
created Worker in the Cloudflare dashboard, then verify the app. `keep_vars: true`
preserves dashboard variables on later deploys. Local dotenv values are not automatically
published as Worker bindings. For imports, also run `npx wrangler secret put SUPABASE_SECRET_KEY`.
Worker logs are enabled. CSV parsing can exceed the Workers Free CPU allowance;
see [deployment limits](docs/IMPORTS.md#deployment).

## References

- [Supabase browser/server clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Cloudflare React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [TanStack Table v9](https://tanstack.com/table/latest/docs/framework/react)
