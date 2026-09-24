-- GPS Nexus · impuestos y libros fiscales de Venezuela
--
-- Principio: ningun porcentaje se escribe dentro del codigo. Todos viven aqui como
-- filas con fecha de vigencia. Cuando el SENIAT cambia una alicuota se inserta una fila
-- nueva; las operaciones ya registradas siguen apuntando a la que se les aplico.
-- Reescribir el pasado no es una opcion.
--
-- Los libros de ventas y de compras NO se transcriben: son una consulta sobre las
-- facturas que ya existen. Si el libro y la factura difieren, es que alguien toco algo,
-- y eso aqui no se puede.

create type tipo_documento as enum ('factura','nota_credito','nota_debito');
create type sentido        as enum ('emitido','recibido');

-- ---------------------------------------------------------------- IVA

create table alicuota_iva (
  id            uuid primary key default gen_random_uuid(),
  -- 'general', 'reducida', 'adicional', 'exento'
  clase         text not null,
  porcentaje    numeric(5,2) not null check (porcentaje >= 0),
  vigente_desde date not null,
  vigente_hasta date,
  constraint vigencia_coherente check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

create index alicuota_iva_vig_ix on alicuota_iva (clase, vigente_desde desc);

-- Si GPS es contribuyente especial, retiene a sus proveedores. El porcentaje es 75%,
-- o 100% cuando la factura del proveedor no cumple los requisitos reglamentarios.
create table regimen_iva (
  organizacion_id  uuid not null references organizacion(id),
  vigente_desde    date not null,
  es_especial      boolean not null,
  -- Porcentaje de IVA que se retiene al proveedor cuando se es agente de retencion.
  retencion_normal numeric(5,2) not null default 75.00,
  retencion_falla  numeric(5,2) not null default 100.00,
  primary key (organizacion_id, vigente_desde)
);

-- ---------------------------------------------------------------- ISLR

-- Retencion de ISLR: porcentaje y sustraendo por concepto, en unidades tributarias.
-- El sustraendo se calcula sobre la UT vigente el dia de la operacion, no la de hoy.
create table concepto_islr (
  codigo         text primary key,
  nombre_es      text not null,
  nombre_en      text not null,
  -- 'pj_domiciliada', 'pn_residente', 'pj_no_domiciliada', 'pn_no_residente'
  sujeto         text not null,
  porcentaje     numeric(5,2) not null,
  -- Factor del sustraendo en UT. Sustraendo = porcentaje x factor_ut x valor_ut.
  factor_ut      numeric(10,4) not null default 0,
  -- Por debajo de esta base no se retiene.
  minimo_ut      numeric(10,4) not null default 0,
  vigente_desde  date not null,
  vigente_hasta  date
);

create table unidad_tributaria (
  vigente_desde date primary key,
  valor_ves     numeric(20,2) not null check (valor_ves > 0),
  gaceta        text
);

create or replace function ut_del_dia(p_fecha date) returns numeric
language sql stable as $$
  select valor_ves from unidad_tributaria
   where vigente_desde <= p_fecha order by vigente_desde desc limit 1
$$;

-- ---------------------------------------------------------------- IGTF

-- 3% sobre los pagos hechos en divisa. Se calcula sobre el monto efectivamente pagado
-- en moneda extranjera, no sobre el total de la factura.
create table alicuota_igtf (
  vigente_desde date primary key,
  porcentaje    numeric(5,2) not null check (porcentaje >= 0)
);

-- ---------------------------------------------------------------- documentos fiscales

create table documento_fiscal (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  sentido         sentido not null,
  tipo            tipo_documento not null,
  -- Numero de control y numero de factura: son distintos y los dos son obligatorios.
  numero          text not null,
  numero_control  text,
  -- La contraparte: cliente si es emitido, proveedor si es recibido.
  contraparte_id  uuid not null references organizacion(id),
  fecha           date not null,
  contrato_id     uuid references contrato(id),

  base_ves        numeric(20,2) not null,
  base_usd        numeric(20,2) not null,
  exento_ves      numeric(20,2) not null default 0,
  alicuota_iva_id uuid references alicuota_iva(id),
  iva_ves         numeric(20,2) not null default 0,
  iva_usd         numeric(20,2) not null default 0,
  tasa_id         uuid not null references tasa_bcv(id),

  -- Una nota de credito o debito siempre afecta a un documento anterior.
  afecta_a        uuid references documento_fiscal(id),
  asiento_id      uuid references asiento(id),
  registrado_en   timestamptz not null default now(),
  registrado_por  uuid not null references persona(id),

  unique (organizacion_id, sentido, tipo, numero),
  constraint nota_referencia check (tipo = 'factura' or afecta_a is not null),
  constraint control_si_emitido check (sentido = 'recibido' or numero_control is not null)
);

create index doc_fiscal_periodo_ix on documento_fiscal (organizacion_id, fecha);
create index doc_fiscal_contraparte_ix on documento_fiscal (contraparte_id);

-- ---------------------------------------------------------------- retenciones

-- Comprobante de retencion. Lleva correlativo propio por ejercicio y periodo,
-- y es el papel que se le entrega a la contraparte.
create table retencion (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  documento_id    uuid not null references documento_fiscal(id),
  -- 'iva', 'islr', 'igtf'
  clase           text not null check (clase in ('iva','islr','igtf')),
  sentido         sentido not null,
  -- Correlativo del comprobante: AAAAMM + secuencia. Solo para las que emite GPS.
  comprobante     text,
  fecha           date not null,

  -- Sobre que se calculo y con que regla. Guardar la regla, no solo el resultado,
  -- es lo que permite reproducir el calculo dentro de tres anios.
  base_ves        numeric(20,2) not null,
  porcentaje      numeric(5,2)  not null,
  sustraendo_ves  numeric(20,2) not null default 0,
  monto_ves       numeric(20,2) not null,
  monto_usd       numeric(20,2) not null,
  tasa_id         uuid not null references tasa_bcv(id),

  concepto_islr   text references concepto_islr(codigo),
  ut_aplicada     numeric(20,2),
  asiento_id      uuid references asiento(id),

  unique (organizacion_id, clase, comprobante),
  constraint islr_lleva_concepto check (clase <> 'islr' or concepto_islr is not null),
  constraint emitida_lleva_comprobante check (sentido = 'recibido' or comprobante is not null)
);

create index retencion_doc_ix on retencion (documento_id);

-- ---------------------------------------------------------------- libros

-- El libro de ventas no es una tabla: es lo que ya paso, ordenado.
-- Nadie lo escribe, nadie lo corrige, nadie lo cuadra a mano.
create view libro_ventas as
select d.organizacion_id,
       date_trunc('month', d.fecha)::date as periodo,
       d.fecha,
       c.rif                              as rif_cliente,
       c.nombre                           as cliente,
       d.tipo,
       d.numero                           as numero_factura,
       d.numero_control,
       af.numero                          as afecta_numero,
       d.base_ves + d.exento_ves          as total_ves,
       d.exento_ves,
       d.base_ves                         as base_imponible_ves,
       a.porcentaje                       as alicuota,
       d.iva_ves                          as debito_fiscal_ves,
       r.monto_ves                        as iva_retenido_ves,
       r.comprobante                      as comprobante_retencion
  from documento_fiscal d
  join organizacion c        on c.id = d.contraparte_id
  left join alicuota_iva a   on a.id = d.alicuota_iva_id
  left join documento_fiscal af on af.id = d.afecta_a
  left join retencion r      on r.documento_id = d.id and r.clase = 'iva'
 where d.sentido = 'emitido';

create view libro_compras as
select d.organizacion_id,
       date_trunc('month', d.fecha)::date as periodo,
       d.fecha,
       p.rif                              as rif_proveedor,
       p.nombre                           as proveedor,
       d.tipo,
       d.numero                           as numero_factura,
       d.numero_control,
       af.numero                          as afecta_numero,
       d.base_ves + d.exento_ves          as total_ves,
       d.exento_ves,
       d.base_ves                         as base_imponible_ves,
       a.porcentaje                       as alicuota,
       d.iva_ves                          as credito_fiscal_ves,
       r.monto_ves                        as iva_retenido_ves,
       r.comprobante                      as comprobante_retencion
  from documento_fiscal d
  join organizacion p        on p.id = d.contraparte_id
  left join alicuota_iva a   on a.id = d.alicuota_iva_id
  left join documento_fiscal af on af.id = d.afecta_a
  left join retencion r      on r.documento_id = d.id and r.clase = 'iva'
 where d.sentido = 'recibido';

-- ---------------------------------------------------------------- calculo

-- Retencion de ISLR de un concepto, a la fecha dada. Devuelve el monto a retener.
-- Se apoya en la UT vigente ese dia, no en la de hoy.
create or replace function calcular_islr(p_concepto text, p_base numeric, p_fecha date)
returns numeric
language plpgsql stable as $$
declare
  c record;
  ut numeric;
  sustraendo numeric;
begin
  select * into c from concepto_islr
   where codigo = p_concepto
     and vigente_desde <= p_fecha
     and (vigente_hasta is null or vigente_hasta >= p_fecha)
   order by vigente_desde desc limit 1;
  if c is null then
    raise exception 'No hay concepto ISLR % vigente el %', p_concepto, p_fecha;
  end if;

  ut := ut_del_dia(p_fecha);
  if ut is null then
    raise exception 'No hay unidad tributaria vigente el %', p_fecha;
  end if;

  if p_base < c.minimo_ut * ut then
    return 0;
  end if;

  sustraendo := round(c.porcentaje / 100 * c.factor_ut * ut, 2);
  return greatest(round(p_base * c.porcentaje / 100 - sustraendo, 2), 0);
end $$;

-- IGTF: 3% sobre lo efectivamente pagado en divisa, no sobre el total facturado.
create or replace function calcular_igtf(p_pagado_divisa numeric, p_fecha date)
returns numeric
language plpgsql stable as $$
declare pct numeric;
begin
  select porcentaje into pct from alicuota_igtf
   where vigente_desde <= p_fecha order by vigente_desde desc limit 1;
  if pct is null then
    raise exception 'No hay alicuota de IGTF vigente el %', p_fecha;
  end if;
  return round(p_pagado_divisa * pct / 100, 2);
end $$;
