-- GPS Nexus · lo que se guarda mientras el usuario esta en el proveedor
--
-- Entre que alguien pulsa «entrar con la cuenta de la empresa» y vuelve, pasan dos
-- peticiones distintas. Lo que hay que recordar entre las dos —el estado y el
-- nonce— tiene que vivir en algun sitio, y ese sitio no puede ser una cookie
-- cualquiera: quien pueda escribir la cookie puede elegir el nonce, y elegir el
-- nonce es poder reutilizar un testigo viejo.
--
-- Va en la base de datos y SE QUEMA AL USARSE, igual que el desafio del segundo
-- factor. Una peticion que se puede usar dos veces es un testigo que se puede
-- reutilizar dos veces.

create table peticion_sso (
  id              uuid primary key default gen_random_uuid(),
  -- El estado viaja a la vista en la direccion; el nonce va dentro del testigo. Se
  -- guardan los dos: el estado ata la vuelta a la ida, el nonce ata el testigo a
  -- esta peticion concreta.
  estado          text not null unique,
  nonce           text not null,
  metodo          metodo_entrada not null,
  organizacion_id uuid not null references organizacion(id),
  -- Adonde volver despues de entrar. Se sanea al usarlo, igual que en todas partes.
  destino         text,
  creada_en       timestamptz not null default now(),
  usada_en        timestamptz,
  origen          text not null,
  constraint metodo_es_de_empresa check (metodo in ('microsoft','google'))
);

create index peticion_sso_viva_ix on peticion_sso (creada_en)
  where usada_en is null;

/**
 * Toma una peticion y la quema, en la misma instruccion.
 *
 * El 'usada_en is null' va DENTRO del update, no en un if de arriba: entre la
 * consulta y la escritura cabe otra peticion, y dos vueltas simultaneas con el mismo
 * estado abririan dos sesiones.
 */
create or replace function tomar_peticion_sso(p_estado text, p_minutos int default 10)
returns table (
  id uuid, nonce text, metodo metodo_entrada, organizacion_id uuid, destino text, origen text
)
language sql as $$
  update peticion_sso
     set usada_en = now()
   where estado = p_estado
     and usada_en is null
     and creada_en > now() - (interval '1 minute' * p_minutos)
  returning id, nonce, metodo, organizacion_id, destino, origen
$$;

-- Las peticiones viejas no se guardan para siempre: son basura con un nonce dentro.
create or replace function limpiar_peticiones_sso(p_dias int default 2) returns int
language plpgsql as $$
declare n int;
begin
  delete from peticion_sso where creada_en < now() - (interval '1 day' * p_dias);
  get diagnostics n = row_count;
  return n;
end $$;
