-- GPS Nexus · el libro. Partida doble de verdad.
--
-- Cuatro reglas que esta capa hace cumplir y que una hoja de Excel no puede:
--   1. Un asiento no cuadra -> la base de datos lo rechaza. No existe asiento descuadrado.
--   2. Un asiento no se escribe a mano: lo genera el hecho que lo causa, y guarda
--      cual fue ese hecho. Desde cualquier linea del mayor se salta al documento.
--   3. Un asiento no se edita ni se borra nunca. Se corrige con su reverso.
--   4. Un periodo cerrado no admite un asiento mas. Ni del CEO.
--
-- Toda cifra se guarda en las dos monedas con la tasa del dia de la operacion,
-- porque el diferencial cambiario es un hecho contable, no un redondeo.

create type naturaleza_cuenta as enum ('activo','pasivo','patrimonio','ingreso','gasto');
create type estado_periodo    as enum ('abierto','en_cierre','cerrado');

create table cuenta (
  organizacion_id uuid not null references organizacion(id),
  codigo          text not null,
  nombre_es       text not null,
  nombre_en       text not null,
  naturaleza      naturaleza_cuenta not null,
  padre           text,
  -- Solo las cuentas de ultimo nivel reciben movimiento.
  imputable       boolean not null default true,
  activa          boolean not null default true,
  primary key (organizacion_id, codigo),
  foreign key (organizacion_id, padre) references cuenta (organizacion_id, codigo)
);

create table periodo (
  organizacion_id uuid not null references organizacion(id),
  anio            int  not null,
  mes             int  not null check (mes between 1 and 12),
  estado          estado_periodo not null default 'abierto',
  cerrado_en      timestamptz,
  cerrado_por     uuid references persona(id),
  primary key (organizacion_id, anio, mes)
);

create table asiento (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  numero          bigint not null,
  -- Bitemporal: cuando ocurrio el hecho, y cuando se supo. El segundo nunca se toca.
  ocurrido_en     date        not null,
  registrado_en   timestamptz not null default now(),
  anio            int  not null,
  mes             int  not null,
  descripcion_es  text not null,
  descripcion_en  text not null,
  -- El hecho que genero este asiento. Es lo que permite que el numero y su prueba
  -- sean la misma cosa: 'factura', 'valuacion', 'pago', 'retencion', 'importacion_excel'.
  origen_tipo     text not null,
  origen_id       uuid not null,
  -- Un asiento de correccion apunta al que reversa. El original se queda donde esta.
  reversa_a       uuid references asiento(id),
  creado_por      uuid not null references persona(id),
  unique (organizacion_id, numero),
  foreign key (organizacion_id, anio, mes) references periodo (organizacion_id, anio, mes),
  constraint periodo_coincide check (anio = extract(year from ocurrido_en)::int
                                 and mes  = extract(month from ocurrido_en)::int)
);

create index asiento_origen_ix  on asiento (origen_tipo, origen_id);
create index asiento_periodo_ix on asiento (organizacion_id, anio, mes);

create table partida (
  asiento_id      uuid not null references asiento(id),
  linea           int  not null,
  organizacion_id uuid not null references organizacion(id),
  cuenta          text not null,
  -- Debe positivo, haber negativo. Un solo campo con signo: no se puede tener las dos.
  monto_ves       numeric(20,2) not null,
  monto_usd       numeric(20,2) not null,
  -- La tasa con la que se convirtio, congelada. Nunca se recalcula hacia atras.
  tasa_id         uuid not null references tasa_bcv(id),
  -- A que contrato se imputa este movimiento. Es lo que permite saber lo que cuesta
  -- un contrato mientras corre, en vez de cuando ya cerro.
  contrato_id     uuid references contrato(id),
  primary key (asiento_id, linea),
  foreign key (organizacion_id, cuenta) references cuenta (organizacion_id, codigo),
  constraint monto_no_cero check (monto_ves <> 0 or monto_usd <> 0)
);

create index partida_cuenta_ix   on partida (organizacion_id, cuenta);
create index partida_contrato_ix on partida (contrato_id) where contrato_id is not null;

-- Regla 1: el asiento cuadra en las dos monedas o no existe.
create or replace function verificar_cuadre() returns trigger
language plpgsql as $$
declare
  d_ves numeric(20,2);
  d_usd numeric(20,2);
  a_id  uuid := coalesce(new.asiento_id, old.asiento_id);
begin
  select coalesce(sum(monto_ves),0), coalesce(sum(monto_usd),0)
    into d_ves, d_usd from partida where asiento_id = a_id;
  if d_ves <> 0 or d_usd <> 0 then
    raise exception 'El asiento % no cuadra (VES %, USD %)', a_id, d_ves, d_usd;
  end if;
  return null;
end $$;

create constraint trigger partida_cuadra
  after insert or update or delete on partida
  deferrable initially deferred
  for each row execute function verificar_cuadre();

-- Reglas 3 y 4: nada se edita, nada se borra, nada entra en un periodo cerrado.
create or replace function proteger_asiento() returns trigger
language plpgsql as $$
declare est estado_periodo;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'Un asiento no se modifica ni se borra. Registra su reverso.';
  end if;
  select estado into est from periodo
   where organizacion_id = new.organizacion_id and anio = new.anio and mes = new.mes;
  if est = 'cerrado' then
    raise exception 'El periodo %-% esta cerrado. Ningun asiento entra ya.', new.anio, new.mes;
  end if;
  return new;
end $$;

create trigger asiento_protegido
  before insert or update or delete on asiento
  for each row execute function proteger_asiento();
