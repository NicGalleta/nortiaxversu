-- Phase 4: read-only forecast inputs from one consistent, authorized snapshot.
begin;
create or replace function public.nortia_forecast_v1()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare
  dashboard jsonb;
  result jsonb;
begin
  -- This checks membership, RLS and negative balances, and shares this stable
  -- function's MVCC snapshot with the following reads (including activation).
  dashboard := public.nortia_dashboard_v1();
  if dashboard->'snapshot' = 'null'::jsonb then
    return jsonb_build_object('dashboard',dashboard,'invoices','[]'::jsonb,'profiles','[]'::jsonb);
  end if;
  with active as (
    select (dashboard->'snapshot'->>'id')::uuid as id,
      (dashboard->'snapshot'->>'fecha_corte')::date as cutoff
  ), credits as (
    select d.documento_referencia, sum(d.monto_total) amount
    from public.documentos d join active i on d.importacion_id=i.id
    where d.tipo='nota_credito' and d.fecha_emision<=i.cutoff
    group by d.documento_referencia
  ), payments as (
    select a.id_documento, sum(a.monto_aplicado) amount, max(p.fecha_pago) last_payment
    from public.aplicaciones_pago a join active i on a.importacion_id=i.id
    join public.pagos p on p.importacion_id=a.importacion_id and p.id_pago=a.id_pago
    where p.fecha_pago<=i.cutoff
    group by a.id_documento
  ), balances as materialized (
    select d.id_documento, d.id_cliente, c.segmento, d.fecha_vencimiento,
      d.en_disputa, d.monto_total::numeric+coalesce(n.amount,0)-coalesce(p.amount,0) amount,
      n.documento_referencia is not null as has_credit, p.last_payment
    from public.documentos d join active i on d.importacion_id=i.id
    join public.clientes c on c.importacion_id=d.importacion_id and c.id_cliente=d.id_cliente
    left join credits n on n.documento_referencia=d.id_documento
    left join payments p on p.id_documento=d.id_documento
    where d.tipo='factura' and d.fecha_emision<=i.cutoff
  ), history as (
    -- One observation per invoice, measured at final cash settlement. Exclude
    -- disputes and credit-adjusted/cancelled invoices from timing training.
    select id_cliente, segmento, greatest(0,last_payment-fecha_vencimiento) delay
    from balances where amount=0 and not en_disputa and not has_credit and last_payment is not null
  ), profiles as (
    select 'customer'::text scope, id_cliente key, count(*) samples,
      percentile_disc(0.5) within group(order by delay) p50,
      percentile_disc(0.8) within group(order by delay) p80
    from history group by id_cliente
    union all
    select 'segment',segmento,count(*),percentile_disc(0.5) within group(order by delay),
      percentile_disc(0.8) within group(order by delay)
    from history where segmento is not null group by segmento
    union all
    select 'global',null,count(*),percentile_disc(0.5) within group(order by delay),
      percentile_disc(0.8) within group(order by delay) from history having count(*)>0
  )
  select jsonb_build_object(
    'dashboard',dashboard,
    'invoices',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id_documento,'customer',id_cliente,'segment',segmento,
      'due',fecha_vencimiento,'disputed',en_disputa,'amount',amount::text
    ) order by id_documento) from balances where amount>0),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by scope,key) from profiles p),'[]'::jsonb)
  ) into result;
  return result;
end
$function$;
revoke all on function public.nortia_forecast_v1() from public,anon,authenticated;
grant execute on function public.nortia_forecast_v1() to authenticated;
comment on function public.nortia_forecast_v1() is
  'Read-only authorized forecast inputs, exact receivables and paid-invoice timing statistics; no forecast writes or privileged keys.';
commit;
