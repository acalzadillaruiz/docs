-- GPS Nexus · sesiones, intentos de acceso y codigos de recuperacion
--
-- La trampa que casi todos pisan: bloquear la cuenta tras N intentos fallidos.
-- Suena prudente y es un arma. Si basta con fallar seis veces contra un correo para
-- dejar fuera a su dueno, cualquiera puede bloquear al gerente de la operadora la
-- manana de una aprobacion, sin saber ni una letra de su clave.
--
-- Aqui el bloqueo cuenta por PAREJA de cuenta y origen. Quien lo intenta desde su
-- sitio se bloquea a si mismo y no al dueno de la cuenta. La cuenta entera solo se
-- frena cuando falla desde muchos origenes a la vez, que ya no es alguien molestando
-- sino un ataque repartido, y aun asi se frena con espera creciente, no con un cierre.

create table intento_acceso (
  id          bigserial primary key,
  correo      text not null,
  -- De donde vino. Se guarda la huella, no la direccion: para contar intentos basta,
  -- y asi el registro no acumula direcciones de gente por si acaso.
  origen      text not null,
  exito       boolean not null,
  -- 'clave', 'segundo_factor', 'codigo_recuperacion', 'empresa'
  fase        text not null,
  ocurrido_en timestamptz not null default now()
);

create index intento_correo_ix on intento_acceso (lower(correo), ocurrido_en desc);
create index intento_pareja_ix on intento_acceso (lower(correo), origen, ocurrido_en desc);

create table codigo_recuperacion (
  persona_id  uuid not null references persona(id) on delete cascade,
  huella      text not null,
  creado_en   timestamptz not null default now(),
  -- Un codigo usado NO se borra: se marca. Asi queda constancia de cual se uso y
  -- cuando, que es justo lo que hace falta saber si mas tarde algo huele mal.
  gastado_en  timestamptz,
  gastado_desde text,
  primary key (persona_id, huella)
);

create index codigo_vivo_ix on codigo_recuperacion (persona_id) where gastado_en is null;

create table sesion (
  id            uuid primary key default gen_random_uuid(),
  persona_id    uuid not null references persona(id) on delete cascade,
  -- La huella del testigo, nunca el testigo. Quien lea esta tabla no puede suplantar
  -- a nadie con lo que encuentre dentro.
  huella        text not null unique,
  dispositivo   text,
  origen        text,
  iniciada_en   timestamptz not null default now(),
  ultima_en     timestamptz not null default now(),
  expira_en     timestamptz not null,
  cerrada_en    timestamptz,
  cerrada_por   uuid references persona(id),
  motivo_cierre text
);

create index sesion_persona_ix on sesion (persona_id) where cerrada_en is null;
create index sesion_expira_ix  on sesion (expira_en)  where cerrada_en is null;

-- -----------------------------------------------------------------------------
-- Cuanto hay que esperar antes del siguiente intento.
--
-- Devuelve segundos. Cero significa que se puede intentar ya.
create or replace function espera_requerida(p_correo text, p_origen text)
returns int
language plpgsql stable as $$
declare
  fallos_pareja int;
  origenes      int;
begin
  -- Fallos de esta pareja en la ultima hora, desde el ultimo acierto.
  select count(*) into fallos_pareja
    from intento_acceso
   where lower(correo) = lower(p_correo)
     and origen = p_origen
     and not exito
     and ocurrido_en > now() - interval '1 hour'
     and ocurrido_en > coalesce((
       select max(ocurrido_en) from intento_acceso
        where lower(correo) = lower(p_correo) and origen = p_origen and exito
     ), '-infinity'::timestamptz);

  if fallos_pareja >= 3 then
    -- Espera creciente: 2, 4, 8, 16... hasta cinco minutos. Suficiente para que
    -- probar claves a ciegas deje de tener sentido, y poco para quien se equivoco.
    return least(power(2, fallos_pareja - 2)::int, 300);
  end if;

  -- Ataque repartido: la misma cuenta fallando desde muchos sitios a la vez.
  select count(distinct origen) into origenes
    from intento_acceso
   where lower(correo) = lower(p_correo)
     and not exito
     and ocurrido_en > now() - interval '15 minutes';

  if origenes >= 10 then return 60; end if;

  return 0;
end $$;

create or replace function anotar_intento(
  p_correo text, p_origen text, p_exito boolean, p_fase text)
returns void
language sql as $$
  insert into intento_acceso (correo, origen, exito, fase)
  values (p_correo, p_origen, p_exito, p_fase)
$$;

-- Gasta un codigo de recuperacion. Devuelve verdadero si el codigo era valido y
-- estaba sin usar. La operacion es atomica: dos peticiones con el mismo codigo a la
-- vez no pueden gastarlo las dos.
create or replace function gastar_codigo(p_persona uuid, p_huella text, p_origen text)
returns boolean
language plpgsql as $$
declare n int;
begin
  update codigo_recuperacion
     set gastado_en = now(), gastado_desde = p_origen
   where persona_id = p_persona and huella = p_huella and gastado_en is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Cuantos codigos le quedan vivos a una persona. Por debajo de tres conviene avisar:
-- quedarse sin codigos y sin telefono a la vez es como se pierde una cuenta.
create or replace function codigos_vivos(p_persona uuid) returns int
language sql stable as $$
  select count(*)::int from codigo_recuperacion
   where persona_id = p_persona and gastado_en is null
$$;

-- Cierra las sesiones caducadas. Se llama desde una tarea periodica.
create or replace function caducar_sesiones() returns int
language plpgsql as $$
declare n int;
begin
  update sesion set cerrada_en = now(), motivo_cierre = 'caducada'
   where cerrada_en is null and expira_en < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Cuando una persona se da de baja, sus sesiones se cierran solas. Es la mitad que
-- hace util el inicio de sesion con la cuenta de la empresa: sin esto, el empleado
-- dado de baja seguiria dentro con la sesion que ya tenia abierta.
create or replace function cerrar_sesiones_de(p_persona uuid, p_motivo text) returns int
language plpgsql as $$
declare n int;
begin
  update sesion set cerrada_en = now(), motivo_cierre = p_motivo
   where persona_id = p_persona and cerrada_en is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function persona_desactivada() returns trigger
language plpgsql as $$
begin
  if old.activa and not new.activa then
    perform cerrar_sesiones_de(new.id, 'persona desactivada');
  end if;
  return new;
end $$;

create trigger persona_baja_cierra_sesiones
  after update of activa on persona
  for each row execute function persona_desactivada();
