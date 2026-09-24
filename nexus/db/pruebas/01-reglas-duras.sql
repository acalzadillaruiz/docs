-- GPS Nexus · pruebas de las reglas que no se negocian.
-- No prueban que el codigo hace algo: prueban que la base de datos SE NIEGA a hacerlo.
-- Si alguna de estas pruebas deja de fallar, la regla se rompio.

\set ON_ERROR_STOP on
\timing off

-- ----------------------------------------------------------------- semilla
insert into organizacion (id, tipo, nombre, rif, metodos)
values ('11111111-1111-1111-1111-111111111111','gps','GPS Energy','J-000000000-0','{clave_2fa}'),
       ('22222222-2222-2222-2222-222222222222','operadora','Operadora Ejemplo','J-111111111-1','{clave_2fa}');

insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',
        'interno@ejemplo.test','Persona Interna','clave_2fa','(hash)','(secreto)'),
       ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',
        'cliente@ejemplo.test','Persona Cliente','clave_2fa','(hash)','(secreto)');

insert into capacidad (clave, modulo, solo_interna) values
  ('conta.margen.ver','contabilidad', true),
  ('contrato.ver','contratos', false);

insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('55555555-5555-5555-5555-555555555555','2026-09-01', 36.50000000,'carga_manual');

insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios, persona juridica domiciliada','Services, domiciled legal entity',
        'pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into cuenta (organizacion_id, codigo, nombre_es, nombre_en, naturaleza) values
  ('11111111-1111-1111-1111-111111111111','1.1.01','Banco','Bank','activo'),
  ('11111111-1111-1111-1111-111111111111','4.1.01','Ingresos','Revenue','ingreso');

insert into periodo (organizacion_id, anio, mes) values
  ('11111111-1111-1111-1111-111111111111', 2026, 9);

-- ============================================================ PRUEBA 1
-- Un cliente no puede recibir una capacidad interna. Lo impide la base de datos.
do $$
begin
  insert into persona_capacidad (persona_id, capacidad)
  values ('44444444-4444-4444-4444-444444444444','conta.margen.ver');
  raise exception 'FALLO 1: un cliente recibio una capacidad interna';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK 1 · un cliente no puede ver el margen: %', SQLERRM;
end $$;

-- La misma capacidad, a alguien de dentro, si entra.
insert into persona_capacidad (persona_id, capacidad)
values ('33333333-3333-3333-3333-333333333333','conta.margen.ver');
\echo 'OK 1b · a alguien de dentro si se le concede'

-- ============================================================ PRUEBA 2
-- Un asiento descuadrado no puede existir.
-- El control es diferido a proposito: hay que poder insertar el asiento y luego sus
-- partidas. Por eso aqui se adelanta a inmediato para provocarlo dentro del bloque.
do $$
begin
  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',
          1,'2026-09-15',2026,9,'Descuadrado','Unbalanced','prueba',gen_random_uuid(),
          '33333333-3333-3333-3333-333333333333');
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values ('66666666-6666-6666-6666-666666666666',1,'11111111-1111-1111-1111-111111111111',
          '1.1.01', 3650.00, 100.00,'55555555-5555-5555-5555-555555555555');
  set constraints partida_cuadra immediate;   -- falta la contrapartida
  raise exception 'FALLO 2: se acepto un asiento descuadrado';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK 2 · asiento descuadrado rechazado: %', SQLERRM;
end $$;

-- ============================================================ PRUEBA 3
-- Un asiento cuadrado si entra.
begin;
insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                     descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
values ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111',
        2,'2026-09-15',2026,9,'Cobro de factura','Invoice collection',
        'factura','88888888-8888-8888-8888-888888888888',
        '33333333-3333-3333-3333-333333333333');
insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id) values
 ('77777777-7777-7777-7777-777777777777',1,'11111111-1111-1111-1111-111111111111','1.1.01', 3650.00, 100.00,'55555555-5555-5555-5555-555555555555'),
 ('77777777-7777-7777-7777-777777777777',2,'11111111-1111-1111-1111-111111111111','4.1.01',-3650.00,-100.00,'55555555-5555-5555-5555-555555555555');
commit;
\echo 'OK 3 · asiento cuadrado aceptado'

-- ============================================================ PRUEBA 4
-- Un asiento no se edita ni se borra.
do $$
begin
  update asiento set descripcion_es = 'cambiado'
   where id = '77777777-7777-7777-7777-777777777777';
  raise exception 'FALLO 4a: se pudo editar un asiento';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK 4a · editar un asiento rechazado: %', SQLERRM;
end $$;

do $$
begin
  delete from asiento where id = '77777777-7777-7777-7777-777777777777';
  raise exception 'FALLO 4b: se pudo borrar un asiento';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK 4b · borrar un asiento rechazado: %', SQLERRM;
end $$;

-- ============================================================ PRUEBA 5
-- Un periodo cerrado no admite un asiento mas.
update periodo set estado = 'cerrado', cerrado_en = now(),
       cerrado_por = '33333333-3333-3333-3333-333333333333'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and anio = 2026 and mes = 9;

do $$
begin
  insert into asiento (organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values ('11111111-1111-1111-1111-111111111111',3,'2026-09-20',2026,9,
          'Tardio','Late','prueba',gen_random_uuid(),'33333333-3333-3333-3333-333333333333');
  raise exception 'FALLO 5: entro un asiento en un mes cerrado';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK 5 · mes cerrado rechaza asientos: %', SQLERRM;
end $$;

-- ============================================================ PRUEBA 6
-- Una tasa publicada no se duplica para el mismo dia.
do $$
begin
  insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
  values ('2026-09-01', 99.00, 'carga_manual');
  raise exception 'FALLO 6: se publicaron dos tasas para el mismo dia';
exception when unique_violation then
  raise notice 'OK 6 · una sola tasa vigente por dia';
end $$;

-- ============================================================ PRUEBA 7
-- Calculo de ISLR: 5% sobre 100.000 Bs, sustraendo 5% x 83,3334 UT x 9 Bs.
-- 100000 x 0,05 = 5000,00 ; sustraendo = round(0,05 x 83,3334 x 9, 2) = 37,50
-- retencion esperada = 4962,50
select case when calcular_islr('SERV-PJ', 100000.00, '2026-09-15') = 4962.50
            then 'OK 7 · ISLR calculado: 4962,50'
            else 'FALLO 7 · ISLR dio ' || calcular_islr('SERV-PJ', 100000.00, '2026-09-15')::text
       end as resultado;

-- ============================================================ PRUEBA 8
-- IGTF: 3% sobre 10.000 pagados en divisa = 300,00
select case when calcular_igtf(10000.00, '2026-09-15') = 300.00
            then 'OK 8 · IGTF calculado: 300,00'
            else 'FALLO 8 · IGTF dio ' || calcular_igtf(10000.00, '2026-09-15')::text
       end as resultado;

-- ============================================================ PRUEBA 9
-- Conversion con tasa fechada: 100 USD a 36,50 = 3.650,00 Bs
select case when convertir(100.00,'USD','VES','55555555-5555-5555-5555-555555555555') = 3650.00
            then 'OK 9 · conversion con tasa fechada: 3.650,00'
            else 'FALLO 9'
       end as resultado;

-- ============================================================ PRUEBA 10
-- Los libros existen y consultan sin error.
select 'OK 10 · libro de ventas: ' || count(*)::text || ' filas'  as resultado from libro_ventas;
select 'OK 10b · libro de compras: ' || count(*)::text || ' filas' as resultado from libro_compras;
