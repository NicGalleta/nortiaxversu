# CSV imports — Phase 3

The React app uploads to the existing Cloudflare Worker API. No Supabase Edge
Function is required. Every authorized user can import and activate snapshots.

## Setup in Supabase

1. With the Phase 2 migration already applied, run
   [`202610060002_imports.sql`](../supabase/migrations/202610060002_imports.sql)
   in Supabase SQL Editor. It adds import functions, attempt/archive metadata,
   and the private `nortia-importaciones` Storage bucket. It also allows credit
   notes to have no due date; invoices still require one.
2. Obtain a server secret key from your project's API keys settings and add it
   to your existing `.env.local`:

   ```dotenv
   SUPABASE_SECRET_KEY=sb_secret_your_actual_key
   ```

   A legacy `service_role` key also works. Keep the four existing public variables.
   Never use `VITE_` for this secret, commit it, or paste it into chat.
3. Restart `npm run dev`, sign in, and open **Importaciones**.

If the migration reports a schema mismatch, retain the error so the migration can
be adapted. Do not recreate existing tables or disable RLS. SQL files under
`supabase/tests/` are local test fixtures, not hosted-project migrations.

## First import

Select the four original CSVs from `datos_nortia_candidatos`: clients, invoices,
payments, and obligations. Enter cutoff **2026-09-27** and bank balance
**270000000** (integer pesos, without separators). Submit for validation.

Expected preview for these files:

| Metric | Value |
| --- | ---: |
| Clients | 1,200 |
| Documents, including credit notes | 7,233 |
| Payments | 6,126 |
| Obligations | 443 |
| Receivables | $1,404,092,132 |
| Overdue receivables | $509,356,177 |
| Obligations overdue or due within seven days | $296,228,000 |
| Bank less those obligations | -$26,228,000 |

Review the preview, then click **Activar**. Uploading alone does not change the
dashboard. Activation replaces the active snapshot in one database transaction
and returns to the cash dashboard.

## Validation and recovery

- Each upload is a complete snapshot of all four files, not an incremental update.
  Files must be UTF-8, comma-separated CSVs with the expected headers. Quoted commas,
  multiline text, and UTF-8 BOM are supported.
- Limits: 4 MiB per file, 8 MiB combined, 25,000 records per file, 50,000 total.
  Monetary values must be integer strings, without decimal or thousands separators.
- Validation checks IDs, dates, customer references, credit notes, replacements,
  obligation status, and payment allocation. Multi-invoice payments must reconcile
  exactly to the referenced outstanding balances; ambiguous allocations are rejected.
- CSV errors identify the file, logical record, and field. Errors caught before
  database writes do not create history entries. Data insertion and database validation
  share one transaction, so a failed validation cannot leave partially inserted data.
- Identical file contents, cutoff, and bank balance reuse the existing import.
  History shows the latest 20 imports. A failed import can be uploaded again;
  abandoned processing attempts become retryable after 15 minutes.
- If a request times out, refresh history before retrying: the server may have
  completed it. Activation detects a changed active snapshot and requires you to
  reload the preview. Older cutoffs cannot replace newer active snapshots.
- Original files are retained privately, including files from failed or interrupted
  attempts. Automatic archive retention/cleanup is not implemented yet. Preview
  metadata is committed only with a successful import.

Authentication and membership are checked before privileged operations. Only
server credentials can execute write RPCs; the browser cannot insert source data.
The database checks membership again, and activation revalidates the snapshot.

## Local checks

```sh
npm run check
npm run test:sql
```

The first command runs lint, credential-free Node tests, and a production build.
The second requires PostgreSQL binaries (`initdb`, `pg_ctl`, `createdb`, `psql`),
creates its own temporary cluster with no TCP listener, and removes it afterward.
Set `NORTIA_PG_BIN` if those binaries are not on PATH. It tests atomic insertion,
retries, concurrent activation, permissions, and the actual CSV totals when the
local data folder is present. It never uses your Supabase credentials.

## Deployment

Set the existing Worker public bindings and add the server secret:

```sh
npx wrangler secret put SUPABASE_SECRET_KEY
```

The synchronous import parses and reconciles files inside the Worker. Workers Free
allows only 10 ms CPU per HTTP request; parsing this dataset can exceed that budget.
Plan for Workers Paid for this implementation, or move ingestion to a separate
processor if a free-only deployment is required. Hosted CPU usage has not yet been
measured. See [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/).

This phase has no background queue: uploads are bounded synchronous requests.
Larger datasets will need a staged upload and background ingestion flow.
