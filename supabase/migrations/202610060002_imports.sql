-- Phase 3. Apply after the original Nortia schema and Phase 2 migration.
-- Source tables are preserved. All write RPCs are service-role-only.
begin;

-- Real ERP credit notes have no due date. Invoices still require one.
alter table public.documentos alter column fecha_vencimiento drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.documentos'::regclass and conname = 'nortia_invoice_due_required') then
    alter table public.documentos add constraint nortia_invoice_due_required
      check (tipo <> 'factura' or fecha_vencimiento is not null);
  end if;
end $$;
create unique index if not exists nortia_one_active_import on public.importaciones ((true)) where activa;

create table if not exists public.cargas_importacion (
  importacion_id uuid primary key references public.importaciones(id),
  intento_id uuid not null,
  iniciado_en timestamptz not null default now()
);
create table if not exists public.archivos_importacion (
  importacion_id uuid not null references public.importaciones(id),
  nombre text not null check (nombre in ('clientes.csv','facturas.csv','pagos.csv','obligaciones.csv')),
  nombre_original text not null,
  ruta text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check (bytes > 0 and bytes <= 4194304),
  filas integer not null check (filas >= 0 and filas <= 25000),
  primary key (importacion_id, nombre)
);
alter table public.cargas_importacion enable row level security;
alter table public.archivos_importacion enable row level security;
revoke all on public.cargas_importacion, public.archivos_importacion from public, anon, authenticated;
grant all on public.cargas_importacion, public.archivos_importacion to service_role;
grant usage on schema public to service_role;
grant select, insert, update on public.importaciones to service_role;
grant select, insert on public.clientes, public.documentos, public.pagos, public.aplicaciones_pago, public.obligaciones to service_role;
grant select on public.usuarios_autorizados to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nortia-importaciones', 'nortia-importaciones', false, 4194304, array['text/csv'])
on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from storage.buckets where id = 'nortia-importaciones' and public) then
    raise exception 'nortia-importaciones must be a private Storage bucket';
  end if;
end $$;

create or replace function public.nortia_iniciar_carga_v1(p_actor uuid, p_huella text, p_fecha date, p_saldo bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.importaciones%rowtype;
  token uuid := gen_random_uuid();
  started timestamptz;
begin
  if not exists (select 1 from public.usuarios_autorizados where user_id = p_actor) then
    raise insufficient_privilege using message = 'Unauthorized import';
  end if;
  if p_huella is null or p_huella !~ '^[a-f0-9]{64}$' or p_fecha is null or p_saldo is null then
    raise exception using errcode = '22023', message = 'Invalid import metadata';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_huella, 0));
  select * into item from public.importaciones where huella_archivos = p_huella for update;
  if found then
    if item.estado = 'validada' then
      return jsonb_build_object('id', item.id, 'reutilizada', true);
    end if;
    select iniciado_en into started from public.cargas_importacion where importacion_id = item.id;
    if item.estado = 'cargando' and (started is null or started > now() - interval '15 minutes') then
      raise exception using errcode = '55P03', message = 'This import is already processing';
    end if;
    -- A successful stage is committed atomically; only empty failed stages can retry.
    if exists (select 1 from public.clientes where importacion_id = item.id)
      or exists (select 1 from public.documentos where importacion_id = item.id)
      or exists (select 1 from public.pagos where importacion_id = item.id)
      or exists (select 1 from public.obligaciones where importacion_id = item.id) then
      raise exception using errcode = '22000', message = 'Failed import contains partial data; administrator review required';
    end if;
    update public.importaciones set estado = 'cargando', resumen_validacion = null, created_by = p_actor where id = item.id;
  else
    insert into public.importaciones (fecha_corte, saldo_banco, estado, activa, huella_archivos, created_by)
    values (p_fecha, p_saldo, 'cargando', false, p_huella, p_actor) returning * into item;
  end if;
  insert into public.cargas_importacion (importacion_id, intento_id, iniciado_en) values (item.id, token, now())
  on conflict (importacion_id) do update set intento_id = excluded.intento_id, iniciado_en = excluded.iniciado_en;
  return jsonb_build_object('id', item.id, 'intento_id', token, 'reutilizada', false);
end $$;

-- Shared validation is repeated immediately before activation. This is not public.
create or replace function public.nortia_validar_carga_v1(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.importaciones%rowtype;
  result jsonb;
  negative_count bigint;
begin
  select * into strict item from public.importaciones where id = p_id;
  if exists (select 1 from public.clientes where importacion_id = p_id and (dias_credito < 0 or limite_credito < 0 or fecha_alta > item.fecha_corte))
    or exists (select 1 from public.documentos d where d.importacion_id = p_id and (
      d.fecha_emision > item.fecha_corte or d.monto_neto + d.impuesto <> d.monto_total
      or d.fecha_vencimiento < d.fecha_emision
      or (d.tipo = 'factura' and (d.fecha_vencimiento is null or d.monto_total <= 0))
      or (d.tipo = 'nota_credito' and (d.monto_total >= 0 or d.documento_referencia is null))
      or d.tipo not in ('factura','nota_credito')
      or (d.documento_referencia is not null and not exists (
        select 1 from public.documentos r where r.importacion_id = p_id and r.id_documento = d.documento_referencia
          and r.tipo = 'factura' and r.id_cliente = d.id_cliente and r.id_documento <> d.id_documento and r.fecha_emision <= d.fecha_emision
      ))
    )) then
    raise exception using errcode = '22000', message = 'Invalid customer/document data';
  end if;
  if exists (select 1 from public.pagos p where p.importacion_id = p_id and (
    p.fecha_pago > item.fecha_corte or p.monto <= 0
    or p.monto <> coalesce((select sum(a.monto_aplicado) from public.aplicaciones_pago a where a.importacion_id = p_id and a.id_pago = p.id_pago), 0)
    or cardinality(regexp_split_to_array(trim(p.facturas_referencia), '\s*,\s*')) <>
      (select count(*) from public.aplicaciones_pago a where a.importacion_id = p_id and a.id_pago = p.id_pago)
  )) or exists (
    select 1 from public.aplicaciones_pago a
    left join public.documentos d on d.importacion_id = a.importacion_id and d.id_documento = a.id_documento
    left join public.pagos p on p.importacion_id = a.importacion_id and p.id_pago = a.id_pago
    where a.importacion_id = p_id and (d.id_documento is null or p.id_pago is null or d.tipo <> 'factura'
      or a.id_cliente <> d.id_cliente or a.id_cliente <> p.id_cliente or a.monto_aplicado <= 0
      or p.fecha_pago < d.fecha_emision
      or not (a.id_documento = any(regexp_split_to_array(trim(p.facturas_referencia), '\s*,\s*'))))
  ) then
    raise exception using errcode = '22000', message = 'Payments do not reconcile';
  end if;
  if exists (select 1 from public.obligaciones where importacion_id = p_id and (
    monto <= 0 or estado not in ('pagada','pendiente')
    or (estado = 'pagada' and (fecha_pago is null or fecha_pago > item.fecha_corte))
    or (estado = 'pendiente' and fecha_pago is not null)
  )) then
    raise exception using errcode = '22000', message = 'Invalid obligations';
  end if;
  if (select count(*) from public.archivos_importacion where importacion_id = p_id) <> 4
    or exists (select 1 from public.archivos_importacion a where a.importacion_id = p_id
      and not exists (select 1 from storage.objects o where o.bucket_id = 'nortia-importaciones' and o.name = a.ruta)) then
    raise exception using errcode = '22000', message = 'Four archived originals are required';
  end if;
  with credits as (
    select documento_referencia as id, sum(monto_total) as amount from public.documentos
    where importacion_id = p_id and tipo = 'nota_credito' group by documento_referencia
  ), payments as (
    select id_documento as id, sum(monto_aplicado) as amount from public.aplicaciones_pago
    where importacion_id = p_id group by id_documento
  ), balances as (
    select d.fecha_vencimiento, d.en_disputa, d.monto_total::numeric + coalesce(c.amount, 0) - coalesce(p.amount, 0) as amount
    from public.documentos d left join credits c on c.id = d.id_documento left join payments p on p.id = d.id_documento
    where d.importacion_id = p_id and d.tipo = 'factura'
  ), obligations as (
    select coalesce(sum(monto), 0) as amount from public.obligaciones
    where importacion_id = p_id and estado = 'pendiente' and fecha_vencimiento <= item.fecha_corte + 7
  )
  select jsonb_build_object(
    'por_cobrar', coalesce(sum(amount) filter (where amount > 0), 0)::text,
    'vencido', coalesce(sum(amount) filter (where amount > 0 and fecha_vencimiento < item.fecha_corte), 0)::text,
    'en_disputa', coalesce(sum(amount) filter (where amount > 0 and en_disputa), 0)::text,
    'facturas_pendientes', count(*) filter (where amount > 0),
    'facturas_vencidas', count(*) filter (where amount > 0 and fecha_vencimiento < item.fecha_corte),
    'obligaciones_7_dias', (select amount::text from obligations),
    'saldo_sin_cobros_7_dias', (item.saldo_banco::numeric - (select amount from obligations))::text
  ), count(*) filter (where amount < 0) into result, negative_count from balances;
  if negative_count > 0 then raise exception using errcode = '22000', message = 'Negative invoice balance'; end if;
  return jsonb_build_object('version', 1, 'summary', result, 'counts', jsonb_build_object(
    'clientes', (select count(*) from public.clientes where importacion_id = p_id),
    'documentos', (select count(*) from public.documentos where importacion_id = p_id),
    'pagos', (select count(*) from public.pagos where importacion_id = p_id),
    'obligaciones', (select count(*) from public.obligaciones where importacion_id = p_id),
    'aplicaciones_pago', (select count(*) from public.aplicaciones_pago where importacion_id = p_id)
  ));
end $$;

create or replace function public.nortia_preparar_carga_v1(p_actor uuid, p_id uuid, p_intento uuid, p_datos jsonb, p_archivos jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.importaciones%rowtype;
  result jsonb;
begin
  if not exists (select 1 from public.usuarios_autorizados where user_id = p_actor) then
    raise insufficient_privilege using message = 'Unauthorized import';
  end if;
  select i.* into item from public.importaciones i join public.cargas_importacion c on c.importacion_id = i.id
    where i.id = p_id and c.intento_id = p_intento and i.created_by = p_actor for update of i, c;
  if not found or item.estado <> 'cargando' then
    raise exception using errcode = '40001', message = 'Import attempt is no longer current';
  end if;
  if jsonb_typeof(p_archivos) <> 'array' or jsonb_array_length(p_archivos) <> 4 then
    raise exception using errcode = '22023', message = 'Four original files are required';
  end if;
  if jsonb_typeof(p_datos->'clientes') is distinct from 'array' then raise exception using errcode = '22023', message = 'Missing clientes array'; end if;
  insert into public.clientes (importacion_id, id_cliente, razon_social, id_tributario, segmento, ciudad, contacto_nombre, contacto_email, contacto_telefono, dias_credito, ejecutivo_comercial, fecha_alta, limite_credito)
    select p_id, r.id_cliente, r.razon_social, r.id_tributario, r.segmento, r.ciudad, r.contacto_nombre, r.contacto_email, r.contacto_telefono, r.dias_credito, r.ejecutivo_comercial, r.fecha_alta, r.limite_credito
    from jsonb_populate_recordset(null::public.clientes, p_datos->'clientes') r;
  if jsonb_typeof(p_datos->'documentos') is distinct from 'array' then raise exception using errcode = '22023', message = 'Missing documentos array'; end if;
  insert into public.documentos (importacion_id, id_documento, tipo, id_cliente, fecha_emision, fecha_vencimiento, monto_neto, impuesto, monto_total, documento_referencia, en_disputa, observacion)
    select p_id, r.id_documento, r.tipo, r.id_cliente, r.fecha_emision, r.fecha_vencimiento, r.monto_neto, r.impuesto, r.monto_total, r.documento_referencia, r.en_disputa, r.observacion
    from jsonb_populate_recordset(null::public.documentos, p_datos->'documentos') r;
  if jsonb_typeof(p_datos->'pagos') is distinct from 'array' then raise exception using errcode = '22023', message = 'Missing pagos array'; end if;
  insert into public.pagos (importacion_id, id_pago, id_cliente, fecha_pago, monto, medio_pago, facturas_referencia)
    select p_id, r.id_pago, r.id_cliente, r.fecha_pago, r.monto, r.medio_pago, r.facturas_referencia
    from jsonb_populate_recordset(null::public.pagos, p_datos->'pagos') r;
  if jsonb_typeof(p_datos->'obligaciones') is distinct from 'array' then raise exception using errcode = '22023', message = 'Missing obligaciones array'; end if;
  insert into public.obligaciones (importacion_id, id_obligacion, tipo, acreedor, descripcion, fecha_vencimiento, monto, estado, fecha_pago)
    select p_id, r.id_obligacion, r.tipo, r.acreedor, r.descripcion, r.fecha_vencimiento, r.monto, r.estado, r.fecha_pago
    from jsonb_populate_recordset(null::public.obligaciones, p_datos->'obligaciones') r;
  if jsonb_typeof(p_datos->'aplicaciones_pago') is distinct from 'array' then raise exception using errcode = '22023', message = 'Missing aplicaciones_pago array'; end if;
  insert into public.aplicaciones_pago (importacion_id, id_pago, id_documento, id_cliente, monto_aplicado)
    select p_id, r.id_pago, r.id_documento, r.id_cliente, r.monto_aplicado
    from jsonb_populate_recordset(null::public.aplicaciones_pago, p_datos->'aplicaciones_pago') r;
  if exists (select 1 from jsonb_to_recordset(p_archivos) as a(nombre text, ruta text)
    where a.ruta is distinct from p_id::text || '/' || p_intento::text || '/' || a.nombre) then
    raise exception using errcode = '22023', message = 'Invalid archive path';
  end if;
  insert into public.archivos_importacion (importacion_id, nombre, nombre_original, ruta, sha256, bytes, filas)
    select p_id, a.nombre, a.nombre_original, a.ruta, a.sha256, a.bytes, a.filas
    from jsonb_to_recordset(p_archivos) as a(nombre text, nombre_original text, ruta text, sha256 text, bytes bigint, filas integer);
  result := public.nortia_validar_carga_v1(p_id);
  if exists (select 1 from public.archivos_importacion a where a.importacion_id = p_id and a.filas <>
    (result->'counts'->>(case a.nombre when 'facturas.csv' then 'documentos' else replace(a.nombre, '.csv', '') end))::bigint)
    or (select sum(bytes) from public.archivos_importacion where importacion_id = p_id) > 8388608
    or (select sum(filas) from public.archivos_importacion where importacion_id = p_id) > 50000 then
    raise exception using errcode = '22000', message = 'File counts or limits do not match';
  end if;
  update public.importaciones set estado = 'validada', resumen_validacion = result where id = p_id;
  return jsonb_build_object('id', p_id, 'reutilizada', false);
end $$;

create or replace function public.nortia_fallar_carga_v1(p_id uuid, p_intento uuid, p_codigo text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  perform 1 from public.importaciones i join public.cargas_importacion c on c.importacion_id = i.id
    where i.id = p_id and c.intento_id = p_intento for update of i, c;
  if not found then return false; end if;
  update public.importaciones i set estado = 'fallida', resumen_validacion = jsonb_build_object('version', 1, 'error_code', left(p_codigo, 80))
  from public.cargas_importacion c
  where i.id = p_id and i.estado = 'cargando' and c.importacion_id = i.id and c.intento_id = p_intento;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

create or replace function public.nortia_activar_carga_v1(p_actor uuid, p_id uuid, p_activa_esperada uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  previous public.importaciones%rowtype;
  target public.importaciones%rowtype;
  result jsonb;
begin
  if not exists (select 1 from public.usuarios_autorizados where user_id = p_actor) then
    raise insufficient_privilege using message = 'Unauthorized activation';
  end if;
  perform pg_advisory_xact_lock(7391, 1);
  select * into previous from public.importaciones where activa for update;
  select * into target from public.importaciones where id = p_id for update;
  if not found or target.estado <> 'validada' then
    raise exception using errcode = '22023', message = 'Only validated imports can activate';
  end if;
  if target.activa then return jsonb_build_object('id', target.id, 'activa', true); end if;
  if previous.id is distinct from p_activa_esperada then
    raise exception using errcode = '40001', message = 'Active snapshot changed; review the current preview';
  end if;
  if previous.fecha_corte > target.fecha_corte then
    raise exception using errcode = '22023', message = 'Cannot activate an older cutoff';
  end if;
  result := public.nortia_validar_carga_v1(p_id);
  update public.importaciones set activa = false where activa;
  update public.importaciones set activa = true, activated_at = now(), resumen_validacion = result where id = p_id;
  return jsonb_build_object('id', p_id, 'activa', true);
end $$;

-- User-scoped read RPC. Exact amounts and active identity share one SQL snapshot.
create or replace function public.nortia_listar_cargas_v1(p_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios_autorizados where user_id = auth.uid()) then
    raise insufficient_privilege using message = 'Unauthorized import history';
  end if;
  select jsonb_build_object(
    'active', (select jsonb_build_object('id', id, 'fecha_corte', fecha_corte, 'saldo_banco', saldo_banco::text, 'resumen_validacion', resumen_validacion) from public.importaciones where activa),
    'selected', (select jsonb_build_object('id', id, 'fecha_corte', fecha_corte, 'saldo_banco', saldo_banco::text, 'estado', estado, 'activa', activa, 'created_at', created_at, 'resumen_validacion', resumen_validacion) from public.importaciones where id = p_id),
    'imports', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'fecha_corte', i.fecha_corte, 'saldo_banco', i.saldo_banco::text,
      'estado', i.estado, 'activa', i.activa, 'created_at', i.created_at, 'resumen_validacion', i.resumen_validacion
    ) order by i.created_at desc, i.id) from (select * from public.importaciones order by created_at desc, id limit 20) i), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.nortia_iniciar_carga_v1(uuid,text,date,bigint), public.nortia_validar_carga_v1(uuid),
  public.nortia_preparar_carga_v1(uuid,uuid,uuid,jsonb,jsonb), public.nortia_fallar_carga_v1(uuid,uuid,text),
  public.nortia_activar_carga_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.nortia_iniciar_carga_v1(uuid,text,date,bigint), public.nortia_validar_carga_v1(uuid),
  public.nortia_preparar_carga_v1(uuid,uuid,uuid,jsonb,jsonb), public.nortia_fallar_carga_v1(uuid,uuid,text),
  public.nortia_activar_carga_v1(uuid,uuid,uuid) to service_role;
revoke all on function public.nortia_listar_cargas_v1(uuid) from public, anon;
grant execute on function public.nortia_listar_cargas_v1(uuid) to authenticated;
commit;
