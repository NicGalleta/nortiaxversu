# Cobranza — Phase 5

Cobranza is a separate main-navigation view. Caja has no new sections. The customer
list uses a fixed-height virtualized table. Opening a customer replaces the list
with a detail screen; returning preserves the list's filters and ordering. The
detail uses separate invoice, payment, and credit-note tabs with bounded scroll areas.

## Enable it

After applying Phases 2–4, run
[`202610060004_collections.sql`](../supabase/migrations/202610060004_collections.sql)
in Supabase SQL Editor. It creates two read-only functions; no tables, new secrets,
Edge Functions, or reimports are required.

```sh
npm run dev
```

Sign in and choose **Cobranza**. The list includes customers with positive outstanding
balances in the active import, not all customers in the ERP. With no active import,
it directs you to Importaciones; an active import without receivables shows a separate
empty state. Missing SQL configuration produces a retryable setup message.

## Priority rule

The ranking is deterministic and explains each customer using actual balances:

1. Customers with overdue, undisputed invoices, ordered by that overdue amount
   descending, then greatest overdue age among undisputed invoices.
2. Customers with undisputed balances that are not overdue, for preventive follow-up.
3. Customers whose entire outstanding balance is disputed, for review with Comercial.

Remaining ties use total undisputed balance descending, then customer ID. Due today
is not overdue. All aging uses the active import's cutoff, never the system date.
Disputed invoices cannot inflate either the prioritized overdue amount or its age.
Mixed customers show their disputed amount separately.

This is an amount-and-age work queue, not a prediction of recoverability. The app
cannot infer responses to calls, prior collection efforts, payment promises, or
customer importance from data that is not present. Historical payment delay is
shown as context and does not change the ranking.

History uses the same settled-invoice definition as Phase 4: final payment delay,
floored at zero, excluding invoices with credit notes or disputes. The median is
shown only with at least five observations for that customer; otherwise the UI
reports insufficient history and the sample count. There is no segment substitution
in this customer-specific historical label.

## List and details

Search by name, tax identifier, or customer code. Filter by segment, undisputed
overdue balances, preventive follow-up, or disputes. Alternative sorting uses total
balance or undisputed overdue age. The priority number remains the original ranking
when filtering or changing the sort. Summary cards always cover the full portfolio.

Customer details include:

- Contact name, email and phone, with explicit missing-data fallbacks.
- Segment, city, tax identifier, account executive, credit terms and credit limit.
- The reason for priority, payment history, disputed balance, and oldest due date
  among all outstanding invoices (including disputes).
- Invoices: original amount, negative credit adjustments, allocated payments,
  remaining balance, disputes, replacement references and ERP observations.
  The default shows pending invoices; uncheck the filter to see settled invoices too.
- Payments: each receipt appears once, with the exact amount allocated to each invoice.
- Credit notes: negative amount, target invoice, issue date and observation.

All monetary calculations use BigInt and decimal strings. Replacement references
alone do not reduce balances. Credit notes and payment allocations do.

This phase is read-only. It neither sends messages nor stores notes or promises.
AI-assisted drafts belong to Phase 6.

## Reference totals

For the provided CSVs at cutoff 2026-09-27, the isolated database regression verifies
412 customers with outstanding balances, totaling 1,404,092,132. Of that portfolio,
503,030,602 is overdue without dispute and 18,293,595 is disputed (including both
current and overdue invoices). Overall overdue balance remains 509,356,177, matching
Caja. The disputed total is not subtracted wholesale from overdue because some
invoices in dispute have not yet reached their due date.

## Authorization and consistency

`GET /api/collections` calls `nortia_cobranza_v1()` under the verified user's session.
The SQL reuses Phase 4's reconciled invoice inputs and adds customer identity data,
all within one stable database snapshot. The Worker aggregates and ranks them and
checks that every invoice has exactly one customer.

`GET /api/collections/customer?customer=…&snapshot=…` calls
`nortia_cliente_v1(uuid,text)`. The reviewed import ID is required. If the active
import changed, the API returns 409 and the detail asks the user to refresh the list.
Unknown customers return 404. Direct SQL RPC calls check authorization through the
dashboard function, use caller permissions and RLS, and deny anonymous execution.

The Worker verifies invoice arithmetic and matches credit totals and payment
allocations to each invoice before returning details. Financial discrepancies
produce safe errors rather than partially rendered data. Both endpoints use public
credentials plus user session, not the privileged import secret. Responses are not
cached; requests are cancelled when the user leaves the view.

## Files and checks

- `src/features/collections/`: list, filters, detail tabs, virtualized tables,
  loading/error handling and request cancellation.
- `src/App.jsx`: separate lazy-loaded Cobranza navigation entry.
- `worker/collections/prepare.js`: exact aggregation, transparent ranking and
  financial detail validation.
- `worker/routes/collections.js`, `worker/index.js`: authenticated GET endpoints.
- `supabase/migrations/202610060004_collections.sql`: read-only RPC migration.
- `tests/collections*.test.js`: ranking, precise amounts, disputes, access control,
  invalid/stale selection and reconciled payment/credit details.
- `scripts/test-imports-sql.mjs`: local PostgreSQL regression extended for both RPCs.

```sh
npm run check
npm run test:sql
```

The SQL test creates and removes its own disposable local PostgreSQL cluster. Never
apply `supabase/tests/` fixtures to your hosted Supabase project. No browser is opened
by these checks. A separate server-render check validates actual table and detail
rendering without Chrome; manual interaction testing remains a useful final step.
