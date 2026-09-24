-- GPS Nexus · contratos
--
-- Cinco tipos de servicio con reglas distintas. El tipo decide que cadena de hitos
-- lleva cada renglon, que evidencia exige cada hito y que ve el cliente.
--
-- Regla que atraviesa todo el sistema: no existe ningun campo de porcentaje de avance
-- que una persona pueda escribir. El avance se calcula desde los hitos evidenciados.
-- Por eso aqui no hay columna 'avance'.

create type tipo_contrato as enum
  ('procura','servicio','reacondicionamiento','transporte','alquiler');

create type estado_contrato as enum
  ('borrador','vigente','suspendido','cerrado','liquidado');

create table contrato (
  id              uuid primary key default gen_random_uuid(),
  -- La organizacion de GPS que ejecuta. Es lo que aisla los datos entre empresas.
  organizacion_id uuid not null references organizacion(id),
  cliente_id      uuid not null references organizacion(id),
  codigo          text not null,
  tipo            tipo_contrato not null,
  titulo_es       text not null,
  titulo_en       text not null,
  estado          estado_contrato not null default 'borrador',

  firmado_el      date,
  inicio          date,
  fin_previsto    date,
  fin_real        date,

  -- Monto del contrato en su moneda de origen, con la tasa del dia de la firma.
  moneda          moneda not null,
  monto           numeric(20,2) not null check (monto > 0),
  tasa_id         uuid not null references tasa_bcv(id),

  -- Anticipo: cuanto se recibio y a que ritmo se amortiza en cada valuacion.
  anticipo_pct    numeric(5,2) not null default 0 check (anticipo_pct between 0 and 100),
  amortiza_pct    numeric(5,2) not null default 0 check (amortiza_pct between 0 and 100),
  -- Retencion de garantia que el cliente descuenta de cada valuacion.
  garantia_pct    numeric(5,2) not null default 0 check (garantia_pct between 0 and 100),

  creado_en       timestamptz not null default now(),
  creado_por      uuid not null references persona(id),

  unique (organizacion_id, codigo),
  constraint fechas_coherentes check (fin_previsto is null or inicio is null or fin_previsto >= inicio),
  constraint cliente_es_operadora check (cliente_id <> organizacion_id)
);

create index contrato_cliente_ix on contrato (cliente_id) where estado = 'vigente';
create index contrato_estado_ix  on contrato (organizacion_id, estado);

create table renglon (
  id              uuid primary key default gen_random_uuid(),
  contrato_id     uuid not null references contrato(id) on delete cascade,
  numero          int  not null,
  descripcion_es  text not null,
  descripcion_en  text not null,
  cantidad        numeric(20,4) not null check (cantidad > 0),
  unidad          text not null,
  -- Norma y especificacion: API 6A, ASME B16.34, NACE MR0175, EN 10204 3.1.
  norma           text,
  especificacion  text,

  precio_unitario numeric(20,4) not null check (precio_unitario >= 0),
  -- Precio de compra. NUNCA sale de la organizacion de GPS: ninguna vista del cliente
  -- lo lee, y la capacidad que lo expone esta marcada como interna.
  costo_unitario  numeric(20,4),

  unique (contrato_id, numero)
);

create index renglon_contrato_ix on renglon (contrato_id);
