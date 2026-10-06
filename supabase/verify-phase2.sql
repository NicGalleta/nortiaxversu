-- Read-only inspection for the Supabase SQL Editor (administrator role).
-- This prints schema/security metadata and counts, never customer or user data.
-- Run before the dashboard migration to inspect prerequisites, then after it.

select expected.table_name,
  c.oid is not null as table_exists,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  case when c.oid is not null then has_table_privilege('authenticated', c.oid, 'SELECT') end as authenticated_select_grant,
  case when c.oid is not null then has_table_privilege('anon', c.oid, 'SELECT') end as anon_select_grant
from (values
  ('usuarios_autorizados'), ('importaciones'), ('clientes'), ('documentos'),
  ('pagos'), ('aplicaciones_pago'), ('obligaciones')
) as expected(table_name)
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.table_name
order by expected.table_name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('usuarios_autorizados', 'importaciones', 'clientes', 'documentos', 'pagos', 'aplicaciones_pago', 'obligaciones')
order by table_name, ordinal_position;

-- A SELECT grant alone does not permit access when RLS is enabled.
-- Review policy expressions as well: authorization must gate financial reads,
-- usuarios_autorizados must permit only the current user's row, and no anon
-- read policies or client write policies should expose these source tables.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('usuarios_autorizados', 'importaciones', 'clientes', 'documentos', 'pagos', 'aplicaciones_pago', 'obligaciones')
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('usuarios_autorizados', 'importaciones', 'clientes', 'documentos', 'pagos', 'aplicaciones_pago', 'obligaciones')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;

select p.oid::regprocedure::text as function_name,
  not p.prosecdef as security_invoker,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'nortia_dashboard_v1';

-- Run after the original schema exists. Zero users means login can succeed
-- but nobody has application access until an administrator provisions access.
select count(*) as authorized_user_count from public.usuarios_autorizados;
