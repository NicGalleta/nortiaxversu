-- Phase 5: read-only collections list and customer detail. Requires Phases 2–4.
begin;
create or replace function public.nortia_cobranza_v1()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare source jsonb;
begin
  source := public.nortia_forecast_v1(); -- Same reconciliation, cutoff and authorization.
  return source || jsonb_build_object('customers',coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id_cliente,'name',c.razon_social,
      'taxId',c.id_tributario,'segment',c.segmento) order by c.id_cliente)
    from public.clientes c
    where c.importacion_id=(source->'dashboard'->'snapshot'->>'id')::uuid
      and c.id_cliente in (select i->>'customer' from jsonb_array_elements(source->'invoices') i)
  ),'[]'::jsonb));
end $$;

create or replace function public.nortia_cliente_v1(p_importacion uuid,p_cliente text)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare dashboard jsonb; snapshot jsonb; customer jsonb; cutoff date; result jsonb;
begin
  dashboard := public.nortia_dashboard_v1();
  snapshot := dashboard->'snapshot';
  if p_importacion is null or (snapshot->>'id')::uuid is distinct from p_importacion then
    raise exception using errcode='40001',message='La importación activa cambió. Actualiza la lista.';
  end if;
  cutoff := (snapshot->>'fecha_corte')::date;
  select to_jsonb(c)-'importacion_id' || jsonb_build_object('limite_credito',c.limite_credito::text)
    into customer from public.clientes c where c.importacion_id=p_importacion and c.id_cliente=p_cliente;
  if customer is null then
    raise exception using errcode='P0002',message='Cliente no encontrado en la importación activa.';
  end if;
  with credits as materialized (
    select d.* from public.documentos d where d.importacion_id=p_importacion
      and d.id_cliente=p_cliente and d.tipo='nota_credito' and d.fecha_emision<=cutoff
  ), payments as materialized (
    select p.* from public.pagos p where p.importacion_id=p_importacion
      and p.id_cliente=p_cliente and p.fecha_pago<=cutoff
  ), credit_totals as (
    select documento_referencia, sum(monto_total) amount from credits group by documento_referencia
  ), payment_totals as (
    select a.id_documento,sum(a.monto_aplicado) amount
    from public.aplicaciones_pago a join payments p on a.importacion_id=p.importacion_id and a.id_pago=p.id_pago
    group by a.id_documento
  ), invoices as (
    select d.id_documento as id,d.fecha_emision as issued,d.fecha_vencimiento as due,
      d.monto_total::text as total,coalesce(c.amount,0)::text as credits,coalesce(p.amount,0)::text as paid,
      (d.monto_total::numeric+coalesce(c.amount,0)-coalesce(p.amount,0))::text as remaining,
      d.en_disputa as disputed,d.documento_referencia as reference,d.observacion as observation
    from public.documentos d
    left join credit_totals c on c.documento_referencia=d.id_documento
    left join payment_totals p on p.id_documento=d.id_documento
    where d.importacion_id=p_importacion and d.id_cliente=p_cliente and d.tipo='factura' and d.fecha_emision<=cutoff
  )
  select jsonb_build_object('snapshot',snapshot,'customer',customer,
    'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by due,id) from invoices i),'[]'::jsonb),
    'credits',coalesce((select jsonb_agg(jsonb_build_object('id',id_documento,'invoice',documento_referencia,
      'date',fecha_emision,'amount',monto_total::text,'observation',observacion) order by fecha_emision,id_documento) from credits),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id_pago,'date',p.fecha_pago,
      'amount',p.monto::text,'method',p.medio_pago,'allocations',coalesce((select jsonb_agg(
        jsonb_build_object('invoice',a.id_documento,'amount',a.monto_aplicado::text) order by a.id_documento)
        from public.aplicaciones_pago a where a.importacion_id=p.importacion_id and a.id_pago=p.id_pago),'[]'::jsonb)
    ) order by p.fecha_pago desc,p.id_pago) from payments p),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.nortia_cobranza_v1() from public,anon,authenticated;
revoke all on function public.nortia_cliente_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.nortia_cobranza_v1() to authenticated;
grant execute on function public.nortia_cliente_v1(uuid,text) to authenticated;
commit;
