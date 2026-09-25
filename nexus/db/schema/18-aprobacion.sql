-- GPS Nexus · aprobaciones y objeciones
--
-- Una objecion no es un dato suelto: es la mitad del expediente el dia que hay que
-- demostrar que se discutio, cuando, y que se respondio. Por eso tiene tabla propia
-- y se guarda entera, no resumida.
--
-- No se mete en ninguna tabla de registro tecnico. Un hecho de negocio en un registro
-- de seguridad se pierde el dia que alguien purga los registros por tamano, y nadie
-- lo echa de menos hasta que hace falta.

create table objecion (
  id            uuid primary key default gen_random_uuid(),
  valuacion_id  uuid not null references valuacion(id),
  -- Quien objeta es siempre alguien del cliente. Lo comprueba un disparador abajo:
  -- una objecion de GPS a su propia valuacion no significa nada.
  persona_id    uuid not null references persona(id),
  motivo        text not null check (btrim(motivo) <> ''),
  objetada_en   timestamptz not null default now(),
  -- La respuesta de GPS, cuando llega. Nula mientras no se haya contestado.
  respuesta     text,
  respondida_en timestamptz,
  respondida_por uuid references persona(id),
  constraint respuesta_completa check (
    (respuesta is null and respondida_en is null and respondida_por is null) or
    (respuesta is not null and respondida_en is not null and respondida_por is not null)
  )
);

create index objecion_valuacion_ix on objecion (valuacion_id, objetada_en desc);
create index objecion_abierta_ix   on objecion (valuacion_id) where respondida_en is null;

-- 'security definer': el disparador valida con los privilegios del sistema, no con
-- los de quien escribe. Tiene que leer 'persona' y 'contrato' para comprobar que
-- quien objeta es del cliente, y el rol del cliente no alcanza esas tablas. Sin
-- esto, la comprobacion falla por falta de permiso en vez de por su propio criterio,
-- que es un error confuso y ademas deja la regla sin aplicar de verdad.
create or replace function verificar_quien_objeta() returns trigger
language plpgsql security definer as $$
declare es_del_cliente boolean;
begin
  select o.id = ct.cliente_id into es_del_cliente
    from persona p
    join organizacion o on o.id = p.organizacion_id
    join valuacion v on v.id = new.valuacion_id
    join contrato ct on ct.id = v.contrato_id
   where p.id = new.persona_id;

  if not coalesce(es_del_cliente, false) then
    raise exception 'Solo el cliente del contrato puede objetar su valuación';
  end if;
  return new;
end $$;

create trigger objecion_la_hace_el_cliente
  before insert on objecion
  for each row execute function verificar_quien_objeta();

-- Una valuacion objetada no se puede facturar mientras la objecion siga abierta.
-- Facturar algo que el cliente discutio por escrito es como se pierde una discusion
-- antes de empezarla.
create or replace function verificar_objecion_abierta() returns trigger
language plpgsql security definer as $$
begin
  if new.estado in ('facturada','cobrada') and old.estado <> new.estado then
    if exists (select 1 from objecion
                where valuacion_id = new.id and respondida_en is null) then
      raise exception 'La valuación tiene una objeción sin responder. Respóndela antes de facturar.';
    end if;
  end if;
  return new;
end $$;

create trigger valuacion_no_factura_con_objecion
  before update of estado on valuacion
  for each row execute function verificar_objecion_abierta();

-- -----------------------------------------------------------------------------
-- Lo que el cliente puede escribir.
--
-- Hasta aqui el cliente solo leia. Aprobar es la primera cosa que escribe, y se le
-- abre la puerta lo justo: tres columnas de una tabla, en las filas de sus propios
-- contratos, y solo hacia dos estados. No se le concede 'update' a secas sobre la
-- valuacion, porque eso le dejaria marcarla como cobrada.

alter table objecion enable row level security;

create policy valuacion_aprueba_cliente on valuacion for update
  using (
    not es_interna()
    and exists (select 1 from contrato c
                 where c.id = valuacion.contrato_id and c.cliente_id = org_actual())
    and estado in ('presentada','objetada')
  )
  with check (estado in ('aprobada','objetada'));

create policy objecion_vista on objecion for select using (
  case when es_interna()
       then exists (select 1 from valuacion v join contrato c on c.id = v.contrato_id
                     where v.id = objecion.valuacion_id and c.organizacion_id = org_actual())
       else exists (select 1 from valuacion v join contrato c on c.id = v.contrato_id
                     where v.id = objecion.valuacion_id and c.cliente_id = org_actual())
  end
);

create policy objecion_la_pone_el_cliente on objecion for insert
  with check (
    not es_interna()
    and persona_id = persona_actual()
    and exists (select 1 from valuacion v join contrato c on c.id = v.contrato_id
                 where v.id = objecion.valuacion_id and c.cliente_id = org_actual())
  );

-- Responder una objecion es de dentro.
create policy objecion_responde_gps on objecion for update
  using (es_interna()
         and exists (select 1 from valuacion v join contrato c on c.id = v.contrato_id
                      where v.id = objecion.valuacion_id and c.organizacion_id = org_actual()));
