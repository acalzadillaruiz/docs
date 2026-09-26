-- GPS Nexus · invitar a una persona
--
-- La pantalla de «Crea tu clave» existia desde el primer dia. Manda el formulario a
-- '/invitacion'... y esa ruta NO EXISTE. Y nada, en ninguna parte, crea una fila en
-- 'persona': la unica forma de dar de alta a alguien era escribir SQL a mano.
--
-- O sea: un portal multiempresa en el que **no se puede invitar a nadie**. La puerta
-- de entrada del producto entero, sin construir. Es la sexta vez que aparece el mismo
-- patron y la mas grande de todas.
--
-- Dos reglas, las mismas que el resto del sistema:
--
--   1. Se guarda la HUELLA del testigo, nunca el testigo. Quien lea esta tabla no
--      puede entrar con lo que encuentre dentro, igual que con las sesiones.
--   2. Una invitacion CADUCA. Un enlace de alta que vale para siempre es una llave
--      que se queda en el correo de alguien durante anos.

create table invitacion (
  id              uuid primary key default gen_random_uuid(),
  -- A que empresa entra: GPS o una operadora. Lo decide quien invita.
  organizacion_id uuid not null references organizacion(id),
  correo          text not null,
  nombre          text not null,
  idioma          text not null default 'es' check (idioma in ('es','en')),

  huella          text not null unique,
  caduca_en       timestamptz not null,

  invitada_por    uuid not null references persona(id),
  creada_en       timestamptz not null default now(),

  aceptada_en     timestamptz,
  persona_id      uuid references persona(id),
  revocada_en     timestamptz,
  motivo_revocacion text,

  constraint revocada_tiene_motivo check (
    (revocada_en is null and motivo_revocacion is null) or
    (revocada_en is not null and motivo_revocacion is not null)),
  -- Una invitacion aceptada no se revoca: lo que se hace entonces es dar de baja a
  -- la persona, que es otra cosa y deja otro rastro.
  constraint aceptada_o_revocada check (aceptada_en is null or revocada_en is null)
);

create index invitacion_pendiente_ix on invitacion (organizacion_id)
  where aceptada_en is null and revocada_en is null;

-- Nadie fuera de GPS ve ni toca las invitaciones: son la administracion de las
-- cuentas, y esa la lleva GPS. Un cliente no invita a su propia gente — si pudiera,
-- decidiria el quien ve los contratos de su empresa.
alter table invitacion enable row level security;
create policy invitacion_interna on invitacion for all
  using (es_interna()) with check (es_interna());

-- -----------------------------------------------------------------------------
-- Aceptar una invitacion: crea la persona.
--
-- Todo en una transaccion. A medias quedaria una persona sin su segundo factor o una
-- invitacion gastada sin persona detras, y las dos cosas dejan a alguien fuera sin
-- forma de volver a entrar.
create or replace function aceptar_invitacion(
  p_huella text, p_clave_hash text, p_totp text)
returns uuid
language plpgsql as $$
declare
  i    record;
  id_p uuid := gen_random_uuid();
begin
  select * into i from invitacion where huella = p_huella;
  if i is null then raise exception 'Esa invitación no existe'; end if;
  if i.aceptada_en is not null then raise exception 'Esa invitación ya se usó'; end if;
  if i.revocada_en is not null then raise exception 'Esa invitación fue anulada'; end if;
  if i.caduca_en < now() then raise exception 'Esa invitación ya caducó'; end if;
  if exists (select 1 from persona where lower(correo) = lower(i.correo)) then
    raise exception 'Ya hay una cuenta con ese correo';
  end if;

  insert into persona (id, organizacion_id, correo, nombre, idioma, metodo,
                       clave_hash, totp_secreto)
  values (id_p, i.organizacion_id, i.correo, i.nombre, i.idioma, 'clave_2fa',
          p_clave_hash, p_totp);

  update invitacion set aceptada_en = now(), persona_id = id_p where id = i.id;
  return id_p;
end $$;

-- -----------------------------------------------------------------------------
-- Por que se dio de baja a alguien.
--
-- Las mismas tres columnas que lleva una invitacion anulada, y por el mismo motivo:
-- una cuenta cerrada sin nadie que responda de ello y sin una linea diciendo por que
-- es un agujero en la lista de quien entra a este portal, que es justo lo que esta
-- pantalla existe para no tener.
--
-- Y hay un motivo mas concreto. La baja se pedia con un boton solo, con el
-- identificador de la persona ya metido en un campo escondido: un formulario que se
-- manda vacio y desactiva a alguien. El barrido que manda todos los formularios en
-- blanco lo encontro dando de baja a la gente de otras pruebas. Un navegador tambien
-- manda formularios en blanco, y un dedo tambien. Pedir el motivo escrito convierte
-- un boton que se dispara solo en una decision.
alter table persona
  add column baja_en     timestamptz,
  add column baja_por    uuid references persona(id),
  add column baja_motivo text;

alter table persona add constraint baja_tiene_motivo check (
  (baja_en is null and baja_por is null and baja_motivo is null) or
  (baja_en is not null and baja_por is not null and baja_motivo is not null));

-- -----------------------------------------------------------------------------
-- Dar de baja a una persona.
--
-- La sesion se le cierra en el acto, pero **no la cierra esta funcion**: ya lo hacia
-- el disparador 'persona_baja_cierra_sesiones', puesto el dia que se escribieron las
-- sesiones. Aqui habia una llamada a cerrar_sesiones_de() que no cerraba nada —el
-- disparador va ANTES de que vuelva el control— y devolvia cero siempre, haciendo
-- creer que la persona no tenia ninguna sesion abierta. La maquina ya estaba debajo;
-- lo que faltaba era la puerta, no otro motor.
--
-- Asi que aqui solo quedan las dos cosas que el disparador no puede hacer: impedir
-- que alguien se deje a si mismo fuera, y decir cuantas sesiones se cortaron.
create or replace function desactivar_persona(
  p_persona uuid, p_quien uuid, p_motivo text)
returns int
language plpgsql as $$
declare n int;
begin
  if p_persona = p_quien then
    raise exception 'No puedes darte de baja a ti mismo: te quedarías fuera sin nadie dentro';
  end if;
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Dar de baja a alguien necesita un motivo escrito';
  end if;
  -- Se cuentan ANTES de la baja. Contarlas despues da cero, porque para entonces el
  -- disparador ya las cerro.
  select count(*) into n from sesion
   where persona_id = p_persona and cerrada_en is null;
  update persona
     set activa = false, baja_en = now(), baja_por = p_quien,
         baja_motivo = btrim(p_motivo)
   where id = p_persona;
  if not found then raise exception 'Esa persona no existe'; end if;
  return n;
end $$;

-- Volver a dar de alta borra el rastro de la baja, porque ya no la describe: lo que
-- queda escrito de una persona activa tiene que ser verdad de una persona activa.
create or replace function reactivar_persona(p_persona uuid)
returns boolean
language plpgsql as $$
begin
  update persona
     set activa = true, baja_en = null, baja_por = null, baja_motivo = null
   where id = p_persona and not activa;
  return found;
end $$;
