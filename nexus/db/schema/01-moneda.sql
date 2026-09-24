-- GPS Nexus · moneda. El problema venezolano que Excel nunca resuelve bien.
--
-- Regla unica: ningun importe existe como numero suelto. Todo importe es
-- (monto, moneda, tasa con la que se convirtio, fecha de esa tasa). Los cuatro o ninguno.
-- Una tasa publicada no se corrige nunca: si el BCV rectifica, se publica otra fila.

create type moneda as enum ('VES','USD');

create table tasa_bcv (
  id            uuid primary key default gen_random_uuid(),
  -- Fecha a la que aplica la tasa, no la fecha en que la cargamos.
  vigente_el    date not null,
  ves_por_usd   numeric(20,8) not null check (ves_por_usd > 0),
  -- 'bcv_api', 'carga_manual', 'importacion_excel'. Para poder auditar de donde salio.
  fuente        text not null,
  registrada_en timestamptz not null default now(),
  registrada_por uuid references persona(id),
  -- Si el BCV rectifica, esta fila se marca sustituida y se inserta la nueva.
  -- Los asientos ya hechos siguen apuntando a la que se uso ese dia. No se reescribe el pasado.
  sustituida_por uuid references tasa_bcv(id)
);

create unique index tasa_vigente_uq on tasa_bcv (vigente_el) where sustituida_por is null;
create index        tasa_fecha_ix   on tasa_bcv (vigente_el desc);

-- La tasa que aplica a una fecha: la de ese dia, o la ultima publicada antes.
-- Se usa en el momento de registrar, y su id queda congelado en la partida.
create or replace function tasa_del_dia(p_fecha date) returns uuid
language sql stable as $$
  select id from tasa_bcv
   where vigente_el <= p_fecha and sustituida_por is null
   order by vigente_el desc limit 1
$$;

-- Convertir siempre pasando por aqui, nunca multiplicando a mano en una consulta.
create or replace function convertir(
  p_monto numeric, p_de moneda, p_a moneda, p_tasa uuid
) returns numeric
language plpgsql stable as $$
declare t numeric(20,8);
begin
  if p_de = p_a then return round(p_monto, 2); end if;
  select ves_por_usd into t from tasa_bcv where id = p_tasa;
  if t is null then raise exception 'Tasa % no existe', p_tasa; end if;
  if p_de = 'USD' and p_a = 'VES' then return round(p_monto * t, 2); end if;
  return round(p_monto / t, 2);
end $$;
