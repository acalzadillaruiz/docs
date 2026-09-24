-- GPS Nexus · identidad y aislamiento entre empresas
-- Decisiones que esta capa hace cumplir:
--   1. Una persona pertenece a una organizacion y se autentica por el metodo que esa
--      organizacion declare: clave propia con doble factor, Microsoft, o Google.
--   2. El aislamiento entre organizaciones vive aqui, en la base de datos, no en un
--      filtro de la aplicacion que alguien pueda olvidar en una consulta.

create extension if not exists pgcrypto;

create type tipo_organizacion as enum ('operadora','gps','proveedor');
create type metodo_entrada    as enum ('clave_2fa','microsoft','google');

create table organizacion (
  id              uuid primary key default gen_random_uuid(),
  tipo            tipo_organizacion not null,
  nombre          text not null,
  rif             text,
  -- Metodos de entrada que esta organizacion permite a su gente.
  -- Una operadora puede exigir que los suyos entren solo por su Microsoft.
  metodos         metodo_entrada[] not null default '{clave_2fa}',
  -- Dominio de correo corporativo con el que se reconoce a los suyos (chevron.com).
  dominio         text,
  -- Identificador del directorio de la empresa en Microsoft o Google.
  idp_tenant      text,
  activa          boolean not null default true,
  creada_en       timestamptz not null default now(),
  constraint metodos_no_vacio check (cardinality(metodos) > 0),
  constraint idp_exige_tenant check (
    not (metodos && '{microsoft,google}'::metodo_entrada[]) or idp_tenant is not null
  )
);

create unique index organizacion_rif_uq     on organizacion (rif) where rif is not null;
create unique index organizacion_dominio_uq on organizacion (lower(dominio)) where dominio is not null;

create table persona (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  correo          text not null,
  nombre          text not null,
  -- Idioma en que esta persona ve la aplicacion. Se decide una vez y se recuerda.
  idioma          text not null default 'es' check (idioma in ('es','en')),
  metodo          metodo_entrada not null,
  -- Solo para metodo 'clave_2fa'. Con Microsoft o Google, GPS nunca guarda una clave.
  clave_hash      text,
  totp_secreto    text,
  -- Sujeto devuelto por el directorio de la empresa. Es lo que permite que, cuando
  -- esa empresa da de baja al empleado, pierda el acceso a este portal el mismo dia.
  idp_sujeto      text,
  activa          boolean not null default true,
  ultimo_acceso   timestamptz,
  creada_en       timestamptz not null default now(),
  constraint clave_solo_si_clave_2fa check (
    (metodo = 'clave_2fa' and clave_hash is not null and totp_secreto is not null)
    or
    (metodo <> 'clave_2fa' and clave_hash is null and totp_secreto is null and idp_sujeto is not null)
  )
);

create unique index persona_correo_uq  on persona (lower(correo));
create unique index persona_idp_uq     on persona (organizacion_id, idp_sujeto) where idp_sujeto is not null;
create index        persona_org_ix     on persona (organizacion_id) where activa;

-- Capacidades: se encienden y se apagan una a una, persona a persona.
-- No hay roles con permisos escondidos dentro.
create table capacidad (
  clave           text primary key,
  modulo          text not null,
  -- Una capacidad marcada interna jamas se concede a una organizacion de tipo operadora.
  -- Aqui es donde vive la regla de que el cliente nunca ve la contabilidad.
  solo_interna    boolean not null default false
);

create table persona_capacidad (
  persona_id      uuid not null references persona(id) on delete cascade,
  capacidad       text not null references capacidad(clave),
  concedida_en    timestamptz not null default now(),
  concedida_por   uuid references persona(id),
  primary key (persona_id, capacidad)
);

-- La regla anterior, hecha cumplir por la base de datos y no por la pantalla.
create or replace function verificar_capacidad_interna() returns trigger
language plpgsql as $$
declare
  es_operadora boolean;
  es_interna   boolean;
begin
  select o.tipo = 'operadora' into es_operadora
    from persona p join organizacion o on o.id = p.organizacion_id
   where p.id = new.persona_id;
  select solo_interna into es_interna from capacidad where clave = new.capacidad;
  if es_operadora and es_interna then
    raise exception 'La capacidad % es interna de GPS y no puede concederse a un cliente', new.capacidad;
  end if;
  return new;
end $$;

create trigger persona_capacidad_interna
  before insert or update on persona_capacidad
  for each row execute function verificar_capacidad_interna();
