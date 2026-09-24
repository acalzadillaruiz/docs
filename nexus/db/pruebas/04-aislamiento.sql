-- GPS Nexus · prueba de que la base de datos se niega a filtrar mal.
-- No comprueba que la aplicacion filtre bien: comprueba que aunque la aplicacion
-- se equivoque, la base de datos no devuelve lo que no toca.

\set ON_ERROR_STOP on
\set gps  '''cccccccc-0000-0000-0000-00000000000a'''
\set opA  '''cccccccc-0000-0000-0000-00000000000b'''
\set opB  '''cccccccc-0000-0000-0000-00000000000c'''
\set yo   '''cccccccc-0000-0000-0000-00000000000d'''
\set claA '''cccccccc-0000-0000-0000-00000000000e'''

insert into organizacion (id, tipo, nombre, rif) values
 (:gps,'gps','GPS Energy','J-000000000-0'),
 (:opA,'operadora','Operadora A','J-111111111-1'),
 (:opB,'operadora','Operadora B','J-222222222-2');

insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
 (:yo,  :gps,'interno@ejemplo.test','Interno GPS','clave_2fa','(hash)','(secreto)'),
 (:claA,:opA,'ing@operadora-a.test','Ingeniero de A','clave_2fa','(hash)','(secreto)');

insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('cccccccc-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');

-- Un contrato de cada operadora, y uno en borrador que nadie de fuera debe ver.
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por) values
 ('cccccccc-1111-0000-0000-000000000001', :gps, :opA,'GPS-A-001','procura','De A','Of A',
  'vigente','USD', 500000.00,'cccccccc-0000-0000-0000-00000000000f', :yo),
 ('cccccccc-1111-0000-0000-000000000002', :gps, :opB,'GPS-B-001','servicio','De B','Of B',
  'vigente','USD', 800000.00,'cccccccc-0000-0000-0000-00000000000f', :yo),
 ('cccccccc-1111-0000-0000-000000000003', :gps, :opA,'GPS-A-002','alquiler','Borrador de A','Draft of A',
  'borrador','USD', 90000.00,'cccccccc-0000-0000-0000-00000000000f', :yo);

insert into renglon (contrato_id, numero, descripcion_es, descripcion_en, cantidad, unidad,
                     norma, precio_unitario, costo_unitario)
values ('cccccccc-1111-0000-0000-000000000001',1,'Cabezal de pozo','Wellhead', 2,'unidad',
        'API 6A', 120000.0000, 74000.0000);

-- ============================================================ como interno
set role nexus_interno;
select set_config('app.persona_id', 'cccccccc-0000-0000-0000-00000000000d', false);

select case when count(*) = 3 then 'OK · de dentro se ven los tres contratos'
            else 'FALLO · de dentro se ven ' || count(*)::text end as resultado from contrato;

select case when count(*) = 1 then 'OK · de dentro se ve el precio de compra'
            else 'FALLO' end as resultado from renglon where costo_unitario is not null;

reset role;

-- ============================================================ como cliente de A
set role nexus_cliente;
select set_config('app.persona_id', 'cccccccc-0000-0000-0000-00000000000e', false);

-- Solo su contrato vigente. Ni el de B, ni su propio borrador.
select case when count(*) = 1 and bool_and(codigo = 'GPS-A-001')
            then 'OK · el cliente de A solo ve su contrato vigente'
            else 'FALLO · el cliente de A ve ' || count(*)::text || ' contratos' end as resultado
  from contrato;

-- Aunque pregunte por el de B por su nombre, no existe para el.
select case when count(*) = 0
            then 'OK · el contrato de B no existe para el cliente de A, ni nombrandolo'
            else 'FALLO · el cliente de A alcanzo el contrato de B' end as resultado
  from contrato where codigo = 'GPS-B-001';

-- El precio de compra no esta oculto: no tiene permiso de leerlo.
do $$
begin
  perform costo_unitario from renglon limit 1;
  raise exception 'FALLO · el cliente leyo el precio de compra';
exception when insufficient_privilege then
  raise notice 'OK · el cliente no tiene permiso sobre el precio de compra';
end $$;

-- El precio de venta si, que es lo que le facturan.
select case when count(*) = 1 then 'OK · el cliente si ve el precio de venta de su renglon'
            else 'FALLO' end as resultado from renglon where precio_unitario is not null;

-- La contabilidad no existe para el.
do $$
begin
  perform 1 from asiento limit 1;
  raise exception 'FALLO · el cliente alcanzo el libro de asientos';
exception when insufficient_privilege then
  raise notice 'OK · el cliente no tiene permiso sobre los asientos';
end $$;

do $$
begin
  perform 1 from partida limit 1;
  raise exception 'FALLO · el cliente alcanzo las partidas';
exception when insufficient_privilege then
  raise notice 'OK · el cliente no tiene permiso sobre las partidas';
end $$;

reset role;
\echo 'OK · aislamiento comprobado'
