-- GPS Nexus · aislamiento entre empresas
--
-- Dos cercas distintas, porque protegen cosas distintas:
--
--   QUE FILAS  -> politicas de fila. Un cliente solo ve los contratos donde el es el
--                 cliente. No porque la aplicacion filtre: porque la base de datos no
--                 le devuelve las demas, escriba la consulta que escriba.
--
--   QUE COLUMNAS -> permisos por columna. El precio de compra y el margen no estan
--                 "ocultos en la pantalla": el rol del cliente no tiene permiso de
--                 leer esa columna. Si alguien lo intenta, la base de datos se niega.
--
-- La contabilidad entera queda fuera del alcance del cliente. Unica excepcion: la
-- valuacion y la factura que tiene que aprobar o recibir.

-- Los roles viven en el servidor, no en la base de datos, asi que se crean solo si
-- no estan. Sus permisos si son de esta base y desaparecen con ella.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nexus_interno') then
    create role nexus_interno;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'nexus_cliente') then
    create role nexus_cliente;
  end if;
end $$;

-- Quien esta preguntando. La aplicacion lo fija en cada peticion.
create or replace function persona_actual() returns uuid
language sql stable as $$
  select nullif(current_setting('app.persona_id', true), '')::uuid
$$;

create or replace function org_actual() returns uuid
language sql stable security definer as $$
  select organizacion_id from persona where id = persona_actual()
$$;

create or replace function es_interna() returns boolean
language sql stable security definer as $$
  select coalesce((select o.tipo = 'gps'
                     from persona p join organizacion o on o.id = p.organizacion_id
                    where p.id = persona_actual()), false)
$$;

-- ----------------------------------------------------------------- filas

alter table contrato        enable row level security;
alter table renglon         enable row level security;
alter table valuacion       enable row level security;
alter table documento_fiscal enable row level security;
alter table asiento         enable row level security;
alter table partida         enable row level security;

create policy contrato_vista on contrato for select using (
  case when es_interna() then organizacion_id = org_actual()
       else cliente_id = org_actual() and estado <> 'borrador' end
);

create policy renglon_vista on renglon for select using (
  exists (select 1 from contrato c where c.id = renglon.contrato_id)
);

create policy valuacion_vista on valuacion for select using (
  case when es_interna() then organizacion_id = org_actual()
       else exists (select 1 from contrato c
                     where c.id = valuacion.contrato_id
                       and c.cliente_id = org_actual())
            and estado in ('presentada','objetada','aprobada','facturada','cobrada') end
);

create policy documento_vista on documento_fiscal for select using (
  case when es_interna() then organizacion_id = org_actual()
       else sentido = 'emitido' and contraparte_id = org_actual() end
);

-- La contabilidad no tiene politica para el cliente: no hay ninguna fila que le toque.
create policy asiento_vista on asiento for select using (
  es_interna() and organizacion_id = org_actual()
);
create policy partida_vista on partida for select using (
  es_interna() and organizacion_id = org_actual()
);

-- Las personas. No estaba puesto y hacia falta en cuanto el cliente pudiera leer su
-- propio perfil: sin esto, concederle 'persona' le daria la lista entera de personas
-- del sistema, con los correos de todo el mundo dentro.
--
-- GPS ve a todos porque GPS administra las cuentas. Un cliente ve a los suyos y a
-- nadie mas — a los suyos si, porque en el portal aparece quien firmo y quien objeto,
-- y un nombre sin poder resolverlo deja la pantalla llena de identificadores.
alter table persona enable row level security;

create policy persona_vista on persona for select using (
  es_interna() or organizacion_id = org_actual()
);

create policy persona_escritura on persona for all
  using (es_interna()) with check (es_interna());

-- Escribir es siempre de dentro.
create policy contrato_escritura  on contrato  for all using (es_interna() and organizacion_id = org_actual());
create policy valuacion_escritura on valuacion for all using (es_interna() and organizacion_id = org_actual());
create policy asiento_escritura   on asiento   for all using (es_interna() and organizacion_id = org_actual());
create policy partida_escritura   on partida   for all using (es_interna() and organizacion_id = org_actual());

-- Los permisos por columna viven en 99-permisos.sql, que se carga el ultimo.
-- Tienen que ir alli y no aqui: 'grant on all tables' solo alcanza a las tablas que
-- existen en ese momento, asi que puesto a media carga se deja fuera todo lo que se
-- cree despues. Ya paso una vez con las tablas de sesiones.
