-- Phase 2: run after the original Nortia schema migration.
-- Additive only: existing source tables, data, grants, and RLS policies are unchanged.
-- Execute as the project administrator in the Supabase SQL Editor.

begin;

do $preflight$
declare
  required record;
  missing_columns text;
begin
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Missing auth.uid(): run this migration in the Supabase database.';
  end if;

  for required in
    select * from (values
      ('usuarios_autorizados', array['user_id']),
      ('importaciones', array['id', 'fecha_corte', 'saldo_banco', 'estado', 'activa']),
      ('documentos', array['importacion_id', 'id_documento', 'tipo', 'fecha_emision', 'fecha_vencimiento', 'monto_total', 'documento_referencia', 'en_disputa']),
      ('pagos', array['importacion_id', 'id_pago', 'fecha_pago']),
      ('aplicaciones_pago', array['importacion_id', 'id_pago', 'id_documento', 'monto_aplicado']),
      ('obligaciones', array['importacion_id', 'id_obligacion', 'tipo', 'acreedor', 'descripcion', 'fecha_vencimiento', 'monto', 'estado'])
    ) as prerequisites(table_name, columns)
  loop
    if to_regclass(format('public.%I', required.table_name)) is null then
      raise exception 'Missing public.%: apply the original schema first.', required.table_name;
    end if;

    select string_agg(expected.column_name, ', ' order by expected.column_name)
      into missing_columns
      from unnest(required.columns) as expected(column_name)
      where not exists (
        select 1 from information_schema.columns actual
        where actual.table_schema = 'public'
          and actual.table_name = required.table_name
          and actual.column_name = expected.column_name
      );

    if missing_columns is not null then
      raise exception 'Missing columns on public.%: %', required.table_name, missing_columns;
    end if;

    if not (select c.relrowsecurity from pg_class c
      where c.oid = to_regclass(format('public.%I', required.table_name))) then
      raise exception 'RLS must be enabled on public.% before exposing the dashboard.', required.table_name;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', required.table_name), 'SELECT') then
      raise exception 'The authenticated role needs SELECT on public.% with the original authorization RLS policies.', required.table_name;
    end if;
  end loop;
end
$preflight$;

create or replace function public.nortia_dashboard_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  dashboard jsonb;
  negative_balances bigint;
begin
  -- Also protect direct PostgREST RPC calls, outside the Cloudflare API.
  -- Invoker privileges and the existing source-table RLS remain in force.
  if auth.uid() is null or not exists (
    select 1 from public.usuarios_autorizados u where u.user_id = auth.uid()
  ) then
    raise insufficient_privilege using message = 'No tienes acceso a los datos de Nortia.';
  end if;

  with active_import as materialized (
    select i.id, i.fecha_corte, i.saldo_banco
    from public.importaciones i
    where i.activa = true and i.estado = 'validada'
  ), credits as (
    -- Aggregate before joining: multiple credits and payment installments
    -- must never multiply one another. Replacement invoices are not credits.
    select d.importacion_id, d.documento_referencia, sum(d.monto_total) as amount
    from public.documentos d
    join active_import i on i.id = d.importacion_id
    where d.tipo = 'nota_credito' and d.fecha_emision <= i.fecha_corte
    group by d.importacion_id, d.documento_referencia
  ), payments as (
    select a.importacion_id, a.id_documento, sum(a.monto_aplicado) as amount
    from public.aplicaciones_pago a
    join active_import i on i.id = a.importacion_id
    join public.pagos p on p.importacion_id = a.importacion_id and p.id_pago = a.id_pago
    where p.fecha_pago <= i.fecha_corte
    group by a.importacion_id, a.id_documento
  ), balances as (
    select d.id_documento, d.fecha_vencimiento, d.en_disputa, i.fecha_corte,
      d.monto_total::numeric + coalesce(c.amount, 0) - coalesce(p.amount, 0) as amount
    from public.documentos d
    join active_import i on i.id = d.importacion_id
    left join credits c on c.importacion_id = d.importacion_id and c.documento_referencia = d.id_documento
    left join payments p on p.importacion_id = d.importacion_id and p.id_documento = d.id_documento
    where d.tipo = 'factura' and d.fecha_emision <= i.fecha_corte
  ), pending_obligations as (
    select o.id_obligacion, o.tipo, o.acreedor, o.descripcion,
      o.fecha_vencimiento, o.monto, i.fecha_corte
    from public.obligaciones o
    join active_import i on i.id = o.importacion_id
    where o.estado = 'pendiente'
  ), receivables as (
    select
      coalesce(sum(b.amount) filter (where b.amount > 0), 0) as por_cobrar,
      coalesce(sum(b.amount) filter (where b.amount > 0 and b.fecha_vencimiento < b.fecha_corte), 0) as vencido,
      coalesce(sum(b.amount) filter (where b.amount > 0 and b.en_disputa), 0) as en_disputa,
      count(*) filter (where b.amount > 0)::integer as facturas_pendientes,
      count(*) filter (where b.amount > 0 and b.fecha_vencimiento < b.fecha_corte)::integer as facturas_vencidas
    from balances b
  ), near_term_obligations as (
    -- Includes previously overdue obligations and those due through cut + 7.
    select coalesce(sum(o.monto) filter (where o.fecha_vencimiento <= o.fecha_corte + 7), 0) as amount
    from pending_obligations o
  )
  select jsonb_build_object(
    'snapshot', (select jsonb_build_object(
      'id', i.id, 'fecha_corte', i.fecha_corte, 'saldo_banco', i.saldo_banco::text
    ) from active_import i),
    'summary', (select jsonb_build_object(
      'por_cobrar', r.por_cobrar::text,
      'vencido', r.vencido::text,
      'en_disputa', r.en_disputa::text,
      'facturas_pendientes', r.facturas_pendientes,
      'facturas_vencidas', r.facturas_vencidas,
      'obligaciones_7_dias', o.amount::text,
      'saldo_sin_cobros_7_dias', (i.saldo_banco::numeric - o.amount)::text
    ) from active_import i cross join receivables r cross join near_term_obligations o),
    'obligations', coalesce((select jsonb_agg(jsonb_build_object(
      'id_obligacion', o.id_obligacion,
      'tipo', o.tipo,
      'acreedor', o.acreedor,
      'descripcion', o.descripcion,
      'fecha_vencimiento', o.fecha_vencimiento,
      'monto', o.monto::text
    ) order by o.fecha_vencimiento, o.id_obligacion) from pending_obligations o), '[]'::jsonb)
  ), (select count(*) from balances b where b.amount < 0)
  into dashboard, negative_balances;

  if negative_balances > 0 then
    raise exception using
      errcode = '22000',
      message = 'La importación activa contiene facturas con saldo negativo.',
      detail = format('Facturas afectadas: %s. Revisa la conciliación de la importación.', negative_balances);
  end if;

  return dashboard;
end
$function$;

comment on function public.nortia_dashboard_v1() is
  'Authorized, RLS-protected dashboard for the active validated snapshot; exact money strings and no forecast assumptions.';

revoke all on function public.nortia_dashboard_v1() from public, anon, authenticated;
grant execute on function public.nortia_dashboard_v1() to authenticated;

commit;
