-- Local regression test only. Never run this fixture against Supabase.
-- In a fresh, disposable PostgreSQL database named nortia_dashboard_test:
-- psql -X -v ON_ERROR_STOP=1 -d nortia_dashboard_test -f supabase/tests/dashboard.test.sql
-- This creates synthetic auth/source tables, tests the real migration, then rolls
-- back fixture data. Dispose of the entire test database afterward.

\set ON_ERROR_STOP on

do $$ begin
  if current_database() <> 'nortia_dashboard_test' then
    raise exception 'This fixture requires a disposable database named nortia_dashboard_test.';
  end if;
  if to_regnamespace('auth') is not null or to_regclass('public.importaciones') is not null then
    raise exception 'This fixture requires an empty database.';
  end if;
end $$;

create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

create table public.usuarios_autorizados (user_id uuid primary key);
create table public.importaciones (id uuid primary key, fecha_corte date, saldo_banco bigint, estado text, activa boolean);
create table public.documentos (
  importacion_id uuid, id_documento text, tipo text, fecha_emision date,
  fecha_vencimiento date, monto_total bigint, documento_referencia text, en_disputa boolean
);
create table public.pagos (importacion_id uuid, id_pago text, fecha_pago date);
create table public.aplicaciones_pago (importacion_id uuid, id_pago text, id_documento text, monto_aplicado bigint);
create table public.obligaciones (
  importacion_id uuid, id_obligacion text, tipo text, acreedor text, descripcion text,
  fecha_vencimiento date, monto bigint, estado text
);

alter table public.usuarios_autorizados enable row level security;
create policy own_authorization on public.usuarios_autorizados for select to authenticated using (user_id = auth.uid());
do $$ declare source_table text; begin
  foreach source_table in array array['importaciones', 'documentos', 'pagos', 'aplicaciones_pago', 'obligaciones'] loop
    execute format('alter table public.%I enable row level security', source_table);
    execute format('create policy allowed_read on public.%I for select to authenticated using (exists (select 1 from public.usuarios_autorizados where user_id = auth.uid()))', source_table);
  end loop;
end $$;
grant select on all tables in schema public to authenticated;

\ir ../migrations/202610060001_dashboard.sql

begin;
insert into public.usuarios_autorizados values ('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ begin
  assert public.nortia_dashboard_v1() = '{"snapshot":null,"summary":null,"obligations":[]}'::jsonb, 'Missing snapshot must be empty, not zero totals';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.nortia_dashboard_v1();
    raise exception 'An unauthorized user reached the dashboard';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform public.nortia_dashboard_v1();
    raise exception 'A user without an identity reached the dashboard';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.nortia_dashboard_v1()', 'execute'), 'Anon must not execute the RPC';
end $$;

insert into public.importaciones values
 ('00000000-0000-4000-8000-000000000010', '2026-09-27', 1000, 'validada', true),
 ('00000000-0000-4000-8000-000000000020', '2026-09-26', 500000, 'validada', false);

insert into public.documentos
select '00000000-0000-4000-8000-000000000010'::uuid, fixture.* from (values
 ('F1', 'factura', date '2026-09-01', date '2026-09-26', 1000::bigint, null::text, true),
 ('F2', 'factura', date '2026-09-02', date '2026-09-27', 2000, 'F1', false),
 ('F3', 'factura', date '2026-09-28', date '2026-09-28', 999, null, false),
 ('F4', 'factura', date '2026-09-03', date '2026-09-28', 400, null, false),
 ('F5', 'factura', date '2026-09-03', date '2026-09-26', 500, null, false),
 ('F6', 'factura', date '2026-09-03', date '2026-10-20', 9007199254740993, null, false),
 ('NC1', 'nota_credito', date '2026-09-20', date '2026-09-20', -100, 'F1', false),
 ('NC2', 'nota_credito', date '2026-09-21', date '2026-09-21', -50, 'F1', false),
 ('NC3', 'nota_credito', date '2026-09-28', date '2026-09-28', -999, 'F1', false),
 ('NC4', 'nota_credito', date '2026-09-22', date '2026-09-22', -500, 'F5', false)
) as fixture;

insert into public.pagos values
 ('00000000-0000-4000-8000-000000000010', 'P1', '2026-09-20'),
 ('00000000-0000-4000-8000-000000000010', 'P2', '2026-09-21'),
 ('00000000-0000-4000-8000-000000000010', 'P3', '2026-09-28');
insert into public.aplicaciones_pago values
 ('00000000-0000-4000-8000-000000000010', 'P1', 'F1', 200),
 ('00000000-0000-4000-8000-000000000010', 'P1', 'F2', 50),
 ('00000000-0000-4000-8000-000000000010', 'P2', 'F1', 150),
 ('00000000-0000-4000-8000-000000000010', 'P3', 'F1', 1000),
 ('00000000-0000-4000-8000-000000000010', 'P3', 'F4', 500);

insert into public.obligaciones
select '00000000-0000-4000-8000-000000000010'::uuid, id, 'proveedor', 'Synthetic', 'Fixture', due, amount, state
from (values
 ('O1', date '2026-09-27', 20, 'pendiente'),
 ('O2', date '2026-09-26', 10, 'pendiente'),
 ('O3', date '2026-10-04', 30, 'pendiente'),
 ('O4', date '2026-10-05', 40, 'pendiente'),
 ('O5', date '2026-09-26', 50, 'pagada')
) as fixture(id, due, amount, state);

-- Reuse identifiers under an inactive import: no cross-import contamination.
insert into public.documentos select '00000000-0000-4000-8000-000000000020', id_documento, tipo, fecha_emision, fecha_vencimiento, monto_total * 10, documento_referencia, en_disputa from public.documentos;
insert into public.pagos select '00000000-0000-4000-8000-000000000020', id_pago, fecha_pago from public.pagos;
insert into public.aplicaciones_pago select '00000000-0000-4000-8000-000000000020', id_pago, id_documento, monto_aplicado * 10 from public.aplicaciones_pago;
insert into public.obligaciones select '00000000-0000-4000-8000-000000000020', id_obligacion, tipo, acreedor, descripcion, fecha_vencimiento, monto * 10, estado from public.obligaciones;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare result jsonb; begin
  result := public.nortia_dashboard_v1();
  assert result->'summary' = '{"por_cobrar":"9007199254743843","vencido":"500","en_disputa":"500","facturas_pendientes":4,"facturas_vencidas":1,"obligaciones_7_dias":"60","saldo_sin_cobros_7_dias":"940"}'::jsonb, 'Exact aggregation, cutoff dates, or replacement treatment failed';
  assert result->'snapshot' = '{"id":"00000000-0000-4000-8000-000000000010","fecha_corte":"2026-09-27","saldo_banco":"1000"}'::jsonb, 'Snapshot contract mismatch';
  assert jsonb_array_length(result->'obligations') = 4, 'Paid or inactive obligations leaked';
  assert result#>>'{obligations,0,id_obligacion}' = 'O2', 'Obligations must sort by due date';
  assert result#>'{obligations,0,monto}' = '"10"'::jsonb, 'Money must be a JSON string';
end $$;

reset role;
update public.aplicaciones_pago set monto_aplicado = 1200 where importacion_id = '00000000-0000-4000-8000-000000000010' and id_pago = 'P1' and id_documento = 'F1';
set local role authenticated;
do $$ begin
  begin
    perform public.nortia_dashboard_v1();
    raise exception 'Negative balances were silently accepted';
  exception when data_exception then null;
  end;
end $$;

rollback;
\echo 'Dashboard SQL regression checks passed.'
