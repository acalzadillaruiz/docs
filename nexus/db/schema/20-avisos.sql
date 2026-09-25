-- GPS Nexus · avisos
--
-- Sin esto, todo lo construido se usa la primera semana y se abandona la tercera.
-- El cliente objeta una valuacion, nadie de GPS se entera hasta que a alguien se le
-- ocurre entrar a mirar, y el cliente vuelve al correo y al telefono. Es exactamente
-- el agujero por el que se desangra el portal que ya existe.
--
-- El patron es un BUZON DE SALIDA, y la eleccion importa:
--
-- Un aviso NO se manda desde el disparador. Se ENCOLA, en la misma transaccion que
-- el hecho que lo provoca. Dos cosas se siguen de ahi, y las dos hacen falta:
--
--   - Si la transaccion se deshace, el aviso se deshace con ella. Mandar dentro del
--     disparador avisaria de una objecion que al final no se guardo.
--   - Si el servidor de correo esta caido, el aviso espera en la cola en vez de
--     perderse. La objecion ya esta guardada; el aviso sale cuando se pueda.
--
-- El texto NO se guarda. Se guardan los datos y se redacta al enviar, en el idioma
-- de quien lo recibe. Congelar el texto obligaria a saber el idioma del destinatario
-- en el momento del disparador, y ademas dejaria correos viejos con una redaccion
-- que ya se corrigio.

create type tipo_aviso as enum (
  'objecion_nueva',        -- el cliente discutio una valuacion. Urge.
  'objecion_respondida',   -- GPS contesto. Va al cliente.
  'valuacion_presentada',  -- hay algo esperando la firma del cliente.
  'valuacion_aprobada',    -- el cliente aprobo. Va a GPS.
  'evidencia_sin_revisar', -- un documento lleva dias en la cola.
  'hito_atrasado'          -- la fecha planificada paso y el hito sigue sin evidencia.
);

create type estado_aviso as enum ('pendiente','enviado','fallido','descartado');

create table aviso (
  id              uuid primary key default gen_random_uuid(),
  tipo            tipo_aviso not null,
  -- A quien va. Se guarda la persona y no el correo: si manana cambia de correo,
  -- lo que quedo en la cola tiene que ir al nuevo.
  persona_id      uuid not null references persona(id) on delete cascade,
  -- De que hecho se avisa. Sirve para no avisar dos veces de lo mismo y para poner
  -- el enlace que lleva justo ahi.
  sobre_id        uuid not null,
  -- Lo minimo para poder redactar sin volver a consultar media base de datos. No
  -- lleva dinero de compra ni margen: un correo se reenvia, y lo que sale por correo
  -- deja de estar bajo las politicas de fila.
  datos           jsonb not null default '{}',

  estado          estado_aviso not null default 'pendiente',
  creado_en       timestamptz not null default now(),
  -- Cuando toca intentarlo. Un fallo no reintenta en bucle: espera, y cada vez mas.
  intentar_en     timestamptz not null default now(),
  intentos        int not null default 0,
  enviado_en      timestamptz,
  ultimo_error    text,

  -- El mismo aviso, al mismo destinatario, sobre el mismo hecho, una sola vez. Es lo
  -- que impide que un reintento a medias acabe mandando el mismo correo tres veces.
  unique (tipo, sobre_id, persona_id)
);

create index aviso_por_enviar_ix on aviso (intentar_en)
  where estado = 'pendiente';

-- Quien no quiere recibir que. Por omision se recibe todo: un aviso que hay que
-- activar es un aviso que nadie activa.
create table preferencia_aviso (
  persona_id      uuid not null references persona(id) on delete cascade,
  tipo            tipo_aviso not null,
  quiere          boolean not null default true,
  primary key (persona_id, tipo)
);

-- -----------------------------------------------------------------------------

/**
 * Encola un aviso para todas las personas activas de una organizacion.
 *
 * Se avisa a la organizacion entera y no a una persona concreta a proposito: en una
 * operadora el que aprueba no es siempre el mismo, y mandarselo solo al que firmo la
 * vez anterior es como se pierde una valuacion cuando esa persona esta de vacaciones.
 */
create or replace function encolar_aviso(
  p_tipo tipo_aviso, p_org uuid, p_sobre uuid, p_datos jsonb default '{}'
) returns int
language plpgsql security definer as $$
declare n int;
begin
  insert into aviso (tipo, persona_id, sobre_id, datos)
  select p_tipo, pe.id, p_sobre, p_datos
    from persona pe
   where pe.organizacion_id = p_org
     and pe.activa
     and coalesce((select pr.quiere from preferencia_aviso pr
                    where pr.persona_id = pe.id and pr.tipo = p_tipo), true)
  on conflict (tipo, sobre_id, persona_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Los hechos que avisan.

create or replace function avisar_objecion_nueva() returns trigger
language plpgsql security definer as $$
declare v record;
begin
  select ct.organizacion_id as gps, ct.codigo, va.numero
    into v
    from valuacion va join contrato ct on ct.id = va.contrato_id
   where va.id = new.valuacion_id;

  perform encolar_aviso('objecion_nueva', v.gps, new.id,
    jsonb_build_object('contrato', v.codigo, 'valuacion', v.numero,
                       'valuacion_id', new.valuacion_id));
  return new;
end $$;

create trigger objecion_avisa
  after insert on objecion
  for each row execute function avisar_objecion_nueva();

create or replace function avisar_objecion_respondida() returns trigger
language plpgsql security definer as $$
declare v record;
begin
  if new.respondida_en is null or old.respondida_en is not null then return new; end if;

  select ct.cliente_id as cli, ct.codigo, va.numero
    into v
    from valuacion va join contrato ct on ct.id = va.contrato_id
   where va.id = new.valuacion_id;

  perform encolar_aviso('objecion_respondida', v.cli, new.id,
    jsonb_build_object('contrato', v.codigo, 'valuacion', v.numero,
                       'valuacion_id', new.valuacion_id));
  return new;
end $$;

create trigger objecion_respondida_avisa
  after update of respondida_en on objecion
  for each row execute function avisar_objecion_respondida();

/**
 * Presentada y aprobada. Los dos lados del mismo movimiento.
 *
 * El aviso al cliente lleva el importe de la obra, que es suyo y ya lo ve en el
 * portal. No lleva el costo ni el margen: un correo se reenvia, y lo que sale por
 * correo deja de estar bajo las politicas de fila que protegen esas columnas.
 */
create or replace function avisar_cambio_valuacion() returns trigger
language plpgsql security definer as $$
declare ct record;
begin
  if new.estado = old.estado then return new; end if;

  select c.organizacion_id as gps, c.cliente_id as cli, c.codigo
    into ct from contrato c where c.id = new.contrato_id;

  if new.estado = 'presentada' then
    perform encolar_aviso('valuacion_presentada', ct.cli, new.id,
      jsonb_build_object('contrato', ct.codigo, 'valuacion', new.numero,
                         'obra', new.obra::text, 'moneda', new.moneda::text));
  elsif new.estado = 'aprobada' then
    perform encolar_aviso('valuacion_aprobada', ct.gps, new.id,
      jsonb_build_object('contrato', ct.codigo, 'valuacion', new.numero,
                         'obra', new.obra::text, 'moneda', new.moneda::text));
  end if;
  return new;
end $$;

create trigger valuacion_avisa
  after update of estado on valuacion
  for each row execute function avisar_cambio_valuacion();

-- -----------------------------------------------------------------------------

/**
 * Lo que no avisa ningun hecho: lo que lleva demasiado tiempo quieto.
 *
 * Un documento sin revisar y un hito que paso su fecha no son sucesos — son la
 * ausencia de un suceso, y nadie encola nada cuando algo NO pasa. Esto se llama una
 * vez al dia y encola lo que lleva parado mas de lo tolerable.
 *
 * El limite de dias es un argumento y no un numero escrito dentro: tres dias en
 * procura y tres dias en un reacondicionamiento no son lo mismo, y el dia que haya
 * que afinarlo se afina sin tocar esto.
 */
create or replace function encolar_lo_parado(p_dias int default 3) returns int
language plpgsql security definer as $$
declare n int := 0;
  r record;
begin
  for r in
    select e.id, ct.organizacion_id as gps, ct.codigo,
           (current_date - e.subida_en::date) as dias, e.nombre
      from evidencia e
      join hito h on h.id = e.hito_id
      join renglon rg on rg.id = h.renglon_id
      join contrato ct on ct.id = rg.contrato_id
     where e.verificada_en is null and e.rechazada_en is null
       and (current_date - e.subida_en::date) >= p_dias
  loop
    n := n + encolar_aviso('evidencia_sin_revisar', r.gps, r.id,
      jsonb_build_object('contrato', r.codigo, 'dias', r.dias, 'documento', r.nombre));
  end loop;

  for r in
    select h.id, ct.organizacion_id as gps, ct.codigo,
           (current_date - coalesce(h.pronosticada, h.planificada)) as dias,
           h.clave, rg.id as renglon_id
      from hito h
      join renglon rg on rg.id = h.renglon_id
      join contrato ct on ct.id = rg.contrato_id
     where h.estado in ('pendiente','declarado')
       and coalesce(h.pronosticada, h.planificada) is not null
       and coalesce(h.pronosticada, h.planificada) < current_date
       and ct.estado = 'vigente'
  loop
    n := n + encolar_aviso('hito_atrasado', r.gps, r.id,
      jsonb_build_object('contrato', r.codigo, 'dias', r.dias,
                         'hito', r.clave, 'renglon_id', r.renglon_id));
  end loop;

  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Sacar de la cola. Lo usa el proceso que envia, y nadie mas.

/**
 * Toma hasta `p_cuantos` avisos por enviar y los deja marcados como intentados.
 *
 * El 'for update skip locked' es lo que permite que manana haya dos procesos
 * enviando sin mandar nada dos veces: el segundo salta las filas que el primero ya
 * tiene cogidas en vez de esperar a que las suelte. Con un solo proceso no hace
 * falta, pero ponerlo despues, cuando ya duela, significa haber mandado correos
 * repetidos a un cliente.
 *
 * Los intentos se suben AQUI, al tomarlo, no al fallar. Si el proceso se muere a
 * mitad de enviar, el aviso vuelve a la cola con un intento gastado en vez de
 * quedarse reintentando para siempre.
 */
create or replace function tomar_avisos(p_cuantos int default 50)
returns table (
  id          uuid,
  tipo        tipo_aviso,
  correo      text,
  nombre      text,
  idioma      text,
  sobre_id    uuid,
  datos       jsonb,
  intentos    int
)
language plpgsql security definer as $$
begin
  if not es_interna() then
    raise exception 'la cola de avisos es del proceso que envia';
  end if;

  return query
  with tomados as (
    select a.id from aviso a
     where a.estado = 'pendiente' and a.intentar_en <= now()
     order by a.creado_en
     limit p_cuantos
     for update skip locked
  )
  update aviso a
     set intentos = a.intentos + 1
    from tomados t, persona pe
   where a.id = t.id and pe.id = a.persona_id
  returning a.id, a.tipo, pe.correo, pe.nombre, pe.idioma, a.sobre_id, a.datos, a.intentos;
end $$;

create or replace function aviso_enviado(p_aviso uuid) returns void
language plpgsql security definer as $$
begin
  if not es_interna() then raise exception 'la cola de avisos es del proceso que envia'; end if;
  update aviso set estado = 'enviado', enviado_en = now(), ultimo_error = null
   where id = p_aviso;
end $$;

/**
 * Un fallo no reintenta en bucle: espera, y cada vez mas.
 *
 * A la sexta se da por perdido. Seguir reintentando un correo que lleva seis fallos
 * no lo arregla — o la direccion esta mal escrita o el buzon no existe — y mientras
 * tanto tapa en el registro los fallos que si son de verdad.
 */
create or replace function aviso_fallido(p_aviso uuid, p_error text) returns void
language plpgsql security definer as $$
declare n int;
begin
  if not es_interna() then raise exception 'la cola de avisos es del proceso que envia'; end if;
  select intentos into n from aviso where id = p_aviso;
  update aviso
     set estado = (case when n >= 6 then 'fallido' else 'pendiente' end)::estado_aviso,
         intentar_en = now() + (interval '1 minute' * power(4, least(n, 5))),
         ultimo_error = left(p_error, 500)
   where id = p_aviso;
end $$;

-- -----------------------------------------------------------------------------
-- Aislamiento: un aviso es de quien lo recibe. Ni siquiera de su organizacion.

alter table aviso enable row level security;
alter table preferencia_aviso enable row level security;

create policy aviso_mio on aviso for all
  using (persona_id = persona_actual())
  with check (persona_id = persona_actual());

create policy preferencia_mia on preferencia_aviso for all
  using (persona_id = persona_actual())
  with check (persona_id = persona_actual());
