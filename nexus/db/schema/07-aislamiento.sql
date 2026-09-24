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

-- Escribir es siempre de dentro.
create policy contrato_escritura  on contrato  for all using (es_interna() and organizacion_id = org_actual());
create policy valuacion_escritura on valuacion for all using (es_interna() and organizacion_id = org_actual());
create policy asiento_escritura   on asiento   for all using (es_interna() and organizacion_id = org_actual());
create policy partida_escritura   on partida   for all using (es_interna() and organizacion_id = org_actual());

-- ----------------------------------------------------------------- columnas

grant usage on schema public to nexus_interno, nexus_cliente;
grant select on all tables in schema public to nexus_interno;
grant insert, update, delete on all tables in schema public to nexus_interno;
grant execute on all functions in schema public to nexus_interno, nexus_cliente;

-- Al cliente se le concede columna por columna, y se le niega lo que no le toca.
grant select on contrato, valuacion, documento_fiscal, organizacion to nexus_cliente;

-- En renglon: todo menos el precio de compra. La columna no se concede, punto.
grant select (id, contrato_id, numero, descripcion_es, descripcion_en,
              cantidad, unidad, norma, especificacion, precio_unitario)
  on renglon to nexus_cliente;

-- Las tablas de referencia si, y no es una concesion: son informacion publica.
-- La alicuota del IVA, el valor de la unidad tributaria y la tasa del BCV los publica
-- el Estado. El cliente ademas los necesita para entender su propia factura: sin la
-- tasa del dia, el importe en bolivares de una valuacion en dolares es un numero sin
-- explicacion. Ocultarlos no protegeria nada y haria opaco lo que debe ser claro.
grant select on tasa_bcv, alicuota_iva, alicuota_igtf, concepto_islr, unidad_tributaria
  to nexus_cliente;

-- La contabilidad no se concede en absoluto.
revoke all on asiento, partida, cuenta, mapa_cuenta, periodo, retencion from nexus_cliente;
