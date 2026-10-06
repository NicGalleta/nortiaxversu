# Cash forecast — Phase 4

Caja now includes a 13-week forecast, base/conservative switch, comparison chart,
weekly table, and daily shortfall indicators. It reads the active import; no new
CSV columns, keys, services, or data reimport are needed.

## Enable it

After Phases 2 and 3, run
[`202610060003_forecast.sql`](../supabase/migrations/202610060003_forecast.sql)
in Supabase SQL Editor. This adds one read-only, RLS-protected function. It does not
change financial records or activate an import.

Run `npm run dev`, open **Caja**, and select **Actualizar datos**. The forecast appears
above the obligations table. If the migration is missing, the forecast section
shows a setup error while the existing cash summary continues working.

## Model version 1

The horizon is 91 calendar days starting the day after the import's cutoff, split
into 13 consecutive seven-day periods. These are not necessarily Monday–Sunday
calendar weeks. No calculation uses the system date.

Outstanding amounts use invoices plus credit notes minus allocated payments as
of cutoff, exactly as the dashboard does. Replacement invoices remain independent;
only actual credit notes and payments reduce balances.

Historical observations are fully cash-paid invoices from the active snapshot,
excluding disputes and any invoice adjusted by a credit note. Each invoice counts
once. Its delay is the last payment date minus due date, floored at zero. Partial
payments affect balances but unfinished invoices are not timing observations.
Future payments and documents are excluded from the cutoff calculation. No data
from inactive snapshots trains the estimates.

Select the first profile with sufficient history:

| Profile | Minimum settled invoices |
| --- | ---: |
| Customer | 5 |
| Customer segment | 10 |
| Whole portfolio | 10 |
| Fixed assumption | No minimum: 30 days base, 60 conservative |

Percentiles use the observed-value (`percentile_disc`) definition. Each eligible
invoice's remaining amount is collected in full on one estimated date:

- Base: due date plus median historical delay, no earlier than cutoff + 1 day.
- Conservative: due date plus the 80th-percentile delay, and at least 14 days after
  that invoice's base date.
- For invoices due on or before cutoff, the earliest dates become cutoff + 7 days
  (base) and cutoff + 21 days (conservative). These explicit future floors prevent
  placing overdue collections in the past; they are assumptions, not a fitted
  model of how long the debt will remain overdue.
- Disputed amounts are excluded from both scenarios and disclosed separately.
- Collections after day 91 are disclosed as beyond the horizon, not lost or
  compressed into week 13. There is no write-off assumption or collection haircut.

All pending obligations are scheduled at their due dates. Those already due are
scheduled on day 1. Both scenarios use the same expenses; obligations after day 91
are disclosed separately. Future payroll, tax, and service costs may already be
estimates in the ERP exports.

Daily closing cash starts from the imported bank balance. It adds collections and
subtracts obligations. The first negative day and largest negative balance include
an already-negative opening bank balance. The weekly minimum also includes its
opening balance. A positive weekly close can therefore coexist with a daily deficit.
There is no intraday ordering assumption: same-day movements are netted.

## Reading the result

The switch changes the metrics and 13 table rows. The chart shows weekly closing
balances for both scenarios; focus or hover points for exact values. The table has
opening cash, collections, obligations, closing cash, and minimum daily cash.
Thirteen rows use TanStack Table without virtualization; the longer obligations
list retains TanStack Virtual.

The assumptions section reports how much eligible debt uses each profile, how many
historical invoices informed the model, disputed debt, and amounts beyond the horizon.
Amounts stay integer strings in JSON and use BigInt for all calculations. Only chart
pixel positions use approximate numbers.

This is a scenario model for existing receivables and known obligations, not a
prediction of the entire business. It does not include future sales, unrecorded
expenses, borrowing, payment promises, predicted installments, or default probabilities.
Using only completed payments can underestimate delays because unpaid invoices have
not yet produced settlement observations. The conservative scenario is a timing
stress, not a statistical confidence interval or a worst-case guarantee.

## Reference result for the provided CSVs

With cutoff 2026-09-27 and bank balance 270,000,000, model version 1 produces:

| Indicator | Base | Conservative |
| --- | ---: | ---: |
| First negative daily balance | 2026-10-01 | 2026-10-01 |
| Maximum shortfall | 13,717,506 | 362,087,506 |
| Closing cash at week 13 | 50,226,537 | 37,897,398 |
| Eligible receivables beyond the horizon | 0 | 12,329,139 |

Both exclude disputed receivables of 18,293,595. Timing profiles use 5,740 settled
invoices; 840 pending eligible invoices use customer history and 291 use segment
history. These are scenario outputs under the assumptions above, not actual future
cash results. The isolated PostgreSQL run verified source reconciliation and both
scenarios against the supplied files.

## Files and consistency

- `supabase/migrations/202610060003_forecast.sql`: authorized source query and
  historical percentiles; uses the same stable database snapshot as its nested
  dashboard query.
- `worker/forecast/project.js`: validated inputs, profile selection, daily balances,
  weekly aggregation, and exact monetary arithmetic.
- `worker/routes/forecast.js`: authenticated `GET /api/forecast`, public key plus
  user session, sanitized errors, no privileged key.
- `src/features/forecast/Forecast.jsx`: loading/error states, scenarios, chart,
  TanStack table, and assumptions. Embedded in the existing Caja screen.
- `tests/forecast*.test.js`: financial boundary cases and API authorization/errors.
- `scripts/test-imports-sql.mjs`: extended isolated PostgreSQL tests for migration,
  RLS, final payment timing, cutoff filtering, snapshot isolation, and real CSV totals.

The browser loads the forecast separately from the summary, then compares import
IDs. If activation occurred between requests, it requires refreshing the entire
Caja screen before showing a forecast. It never combines two imports silently.

## Verification

```sh
npm run check
npm run test:sql
```

The SQL runner requires local PostgreSQL binaries and creates/removes its own
isolated cluster. Do not run the source-schema test fixtures in Supabase.
No browser is opened by either command. Manual UI verification: select both
scenarios, inspect a week, refresh, and activate a different import to confirm the
cutoff and results update together.
