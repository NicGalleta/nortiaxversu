# Supabase setup — Phase 2

This phase assumes you already created the tables from the earlier schema prompt.
The application uses `public.documentos`, not a table named `facturas`.
No service-role key, Edge Function, Storage bucket, or SMTP setup is needed for this
password-login/read-only phase. CSV imports additionally require the
[Phase 3 setup](IMPORTS.md).

## 1. Configure authentication

In Supabase Authentication configuration:

- Keep the **Email** provider enabled.
- Disable **Allow new users to sign up**. Hiding a signup form alone does not disable
  the public signup API.
- Under **Authentication → Users → Add user → Create new user**, create a test account
  with an email and password. Mark this admin-created account as confirmed (the UI may
  call this **Auto Confirm User**).
- Use **Create new user**, not an email invitation: invitation and password-recovery
  callback screens are not implemented in this phase.

Password login does not require an OAuth callback or redirect route. Accounts and
password recovery are managed by the administrator for now.

Official references: [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration),
[password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

## 2. Check your existing schema and add the dashboard query

In **SQL Editor**, run these files in order:

1. [`supabase/verify-phase2.sql`](../supabase/verify-phase2.sql): read-only inspection of
   columns, RLS, grants, policies, and authorized-user count.
2. [`supabase/migrations/202610060001_dashboard.sql`](../supabase/migrations/202610060001_dashboard.sql):
   creates `public.nortia_dashboard_v1()` and grants execution to authenticated users.

The migration preserves existing tables, data, and RLS policies. It stops with a clear
error if expected tables/columns, RLS, or SELECT privileges are missing. If your generated
schema differs, keep the error and the inspection output so we can adapt the migration;
**do not recreate the source tables or disable RLS to make it pass**.

Expected access policy from the original schema:

- `usuarios_autorizados`: authenticated users may SELECT their own row only.
- Financial source tables: SELECT requires membership in `usuarios_autorizados`.
- Anonymous users have no financial-data access.
- Browser users cannot insert, update, or delete source data or grant themselves access.

The RPC runs with the caller's permissions, checks authorization itself, and reads the
snapshot, totals, and obligations consistently. Anonymous execution is revoked.
Rerun the inspection afterward: `security_invoker` and `authenticated_can_execute`
should be true, and `anon_can_execute` false.

Do not run `supabase/tests/dashboard.test.sql` in Supabase; it is a fixture for a fresh,
disposable local PostgreSQL cluster only.

## 3. Authorize your test user

Copy the user's UUID from **Authentication → Users**, then run in SQL Editor as admin:

```sql
insert into public.usuarios_autorizados (user_id)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid)
on conflict (user_id) do nothing;
```

An Auth account proves identity; this separate row grants access to Nortia. If the row
is missing, login succeeds but the app shows **Acceso pendiente de autorización**.

## 4. Run the application

The four variables in `.env.local` must use the same project URL and publishable key:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Restart the development server after environment changes:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** and sign in with your test account. Use this hostname
consistently because session cookies are host-specific.

- With an active, validated import: the dashboard shows that snapshot's financial data.
- Without an active import: **Aún no hay datos activos** is the correct result. CSV
  ingestion is available after the [Phase 3 setup](IMPORTS.md). Do not insert fabricated balances or manually activate
  unvalidated data to fill the screen.
- A missing RPC/schema produces a setup error; a provider failure produces a retryable
  error. Invalid reconciled balances stop the dashboard rather than displaying totals.

## 5. Verify access and behavior

- Wrong password: generic login error, no dashboard.
- Confirmed user without an authorization row: access denied, no financial query.
- Authorized user: actual snapshot or explicit empty state.
- Sign out: returns to login and removes financial content from the page.
- Search/filter/sort the obligations table; values use integer local-currency units.

The reference cutoff is the active import's `fecha_corte`, not today's system date.
Seven-day obligations include overdue payments and those due through cutoff + 7 days.
The cash signal subtracts those known obligations from bank balance; it assumes no new
collections and is not a prediction of actual collections.

After deployment, set the two unprefixed Supabase variables on the Cloudflare Worker
and supply `VITE_*` variables at build time. Public Supabase configuration is all that
this phase requires; never substitute a secret/service-role key.
