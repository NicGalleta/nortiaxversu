-- Synthetic source schema for the disposable local-cluster test runner only.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (bucket_id text, name text, primary key(bucket_id,name));
grant usage on schema storage to service_role;
grant select on storage.objects, storage.buckets to service_role;
create table public.usuarios_autorizados (user_id uuid primary key references auth.users, created_at timestamptz default now());
create table public.importaciones (
  id uuid primary key default gen_random_uuid(), fecha_corte date not null, saldo_banco bigint not null,
  estado text not null check (estado in ('cargando','validada','fallida')), activa boolean not null default false,
  huella_archivos text unique not null, resumen_validacion jsonb, created_at timestamptz default now(), activated_at timestamptz,
  created_by uuid references auth.users, check (not activa or estado = 'validada')
);
create table public.clientes (
  importacion_id uuid references public.importaciones, id_cliente text, razon_social text not null, id_tributario text,
  segmento text, ciudad text, contacto_nombre text, contacto_email text, contacto_telefono text,
  dias_credito integer check (dias_credito>=0), ejecutivo_comercial text, fecha_alta date, limite_credito bigint check(limite_credito>=0),
  primary key(importacion_id,id_cliente)
);
create table public.documentos (
  importacion_id uuid references public.importaciones, id_documento text, tipo text not null check(tipo in ('factura','nota_credito')),
  id_cliente text not null, fecha_emision date not null, fecha_vencimiento date not null,
  monto_neto bigint not null, impuesto bigint not null, monto_total bigint not null, documento_referencia text,
  en_disputa boolean not null, observacion text, primary key(importacion_id,id_documento),
  unique(importacion_id,id_documento,id_cliente),
  foreign key(importacion_id,id_cliente) references public.clientes,
  foreign key(importacion_id,documento_referencia) references public.documentos,
  check(monto_neto+impuesto=monto_total)
);
create table public.pagos (
  importacion_id uuid references public.importaciones, id_pago text, id_cliente text not null, fecha_pago date not null,
  monto bigint not null check(monto>0), medio_pago text, facturas_referencia text not null,
  primary key(importacion_id,id_pago), unique(importacion_id,id_pago,id_cliente),
  foreign key(importacion_id,id_cliente) references public.clientes
);
create table public.aplicaciones_pago (
  importacion_id uuid, id_pago text, id_documento text, id_cliente text not null, monto_aplicado bigint check(monto_aplicado>0),
  primary key(importacion_id,id_pago,id_documento),
  foreign key(importacion_id,id_pago,id_cliente) references public.pagos(importacion_id,id_pago,id_cliente),
  foreign key(importacion_id,id_documento,id_cliente) references public.documentos(importacion_id,id_documento,id_cliente)
);
create table public.obligaciones (
  importacion_id uuid references public.importaciones, id_obligacion text, tipo text, acreedor text, descripcion text,
  fecha_vencimiento date not null, monto bigint not null check(monto>0), estado text check(estado in ('pagada','pendiente')), fecha_pago date,
  primary key(importacion_id,id_obligacion)
);
alter table public.usuarios_autorizados enable row level security;
create policy own_user on public.usuarios_autorizados for select to authenticated using(user_id=auth.uid());
do $$ declare t text; begin
  foreach t in array array['importaciones','clientes','documentos','pagos','aplicaciones_pago','obligaciones'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy authorized_read on public.%I for select to authenticated using(exists(select 1 from public.usuarios_autorizados where user_id=auth.uid()))',t);
  end loop;
end $$;
grant select on all tables in schema public to authenticated;
