-- GPS Nexus · reexpresion por inflacion.
--
-- Caso: indice 100 en enero, 200 en diciembre. La moneda perdio la mitad de su valor.
--   Un equipo comprado en enero por 1.000.000 vale, en moneda de diciembre, 2.000.000.
--   Un millon de bolivares en el banco desde enero sigue siendo un millon: eso es
--   exactamente lo que se perdio por tenerlos, y es el resultado monetario.

\set ON_ERROR_STOP on
\set org '''0f0f0f0f-0000-0000-0000-00000000000a'''
\set yo  '''0f0f0f0f-0000-0000-0000-00000000000d'''

insert into organizacion (id, tipo, nombre, rif) values (:org,'gps','GPS Energy','J-000000000-0');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('0f0f0f0f-0000-0000-0000-00000000000f','2026-01-01', 36.50,'carga_manual');

insert into indice_precios (vigente_desde, valor) values
 ('2026-01-01', 100.000000),
 ('2026-12-01', 200.000000);

select instalar_plan_cuentas(:org);
select marcar_monetarias(:org) as monetarias \gset

select case when :monetarias >= 20 then 'OK · marcadas ' || :monetarias || ' cuentas monetarias'
            else 'FALLO · solo ' || :monetarias end as resultado;

insert into periodo (organizacion_id, anio, mes)
select :org, 2026, g from generate_series(1,12) g;

-- ============================================================ el factor
select case when factor_reexpresion('2026-01-01','2026-12-31') = 2.00000000
            then 'OK · factor de enero a diciembre: 2,0 (el índice se duplicó)'
            else 'FALLO · dio ' || factor_reexpresion('2026-01-01','2026-12-31')::text end as resultado;

-- ============================================================ aporte en enero
-- Capital de 2.000.000 en efectivo. La mitad se gasta en un equipo el mismo dia.
-- El asiento y sus partidas van en UNA transaccion, y no es cosmetica: psql confirma
-- cada sentencia por su cuenta, asi que sin el `begin` el asiento se confirmaria solo,
-- sin lineas, y la base lo rechaza —db/schema/39-asiento-sin-lineas.sql. La aplicacion
-- nunca hace eso: todo generador mete el asiento y sus lineas en la misma transaccion.
begin;
insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                     descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
values ('0f0f0f0f-1111-0000-0000-000000000001', :org, 1,'2026-01-15', 2026, 1,
        'Aporte de capital','Capital contribution','prueba', gen_random_uuid(), :yo);
insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id) values
 ('0f0f0f0f-1111-0000-0000-000000000001',1, :org,'1.1.01.02', 2000000.00, 54794.52,'0f0f0f0f-0000-0000-0000-00000000000f'),
 ('0f0f0f0f-1111-0000-0000-000000000001',2, :org,'3.1.01',   -2000000.00,-54794.52,'0f0f0f0f-0000-0000-0000-00000000000f');
commit;

begin;
insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                     descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
values ('0f0f0f0f-1111-0000-0000-000000000002', :org, 2,'2026-01-15', 2026, 1,
        'Compra de equipo','Equipment purchase','prueba', gen_random_uuid(), :yo);
insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id) values
 ('0f0f0f0f-1111-0000-0000-000000000002',1, :org,'1.2.01.03', 1000000.00, 27397.26,'0f0f0f0f-0000-0000-0000-00000000000f'),
 ('0f0f0f0f-1111-0000-0000-000000000002',2, :org,'1.1.01.02',-1000000.00,-27397.26,'0f0f0f0f-0000-0000-0000-00000000000f');
commit;

\echo ''
\echo '--- reexpresión al 31 de diciembre ---'
select codigo, cuenta_es, monetaria,
       to_char(historico,'FM999G999G999D00')   as historico,
       to_char(reexpresado,'FM999G999G999D00') as reexpresado,
       to_char(ajuste,'FM999G999G999D00')      as ajuste
  from reexpresar(:org,'2026-12-31');
\echo ''

-- El banco es monetario: no se toca.
select case when reexpresado = 1000000.00 and ajuste = 0
            then 'OK · el banco no se reexpresa: un bolívar sigue siendo un bolívar'
            else 'FALLO · el banco quedó en ' || reexpresado::text end as resultado
  from reexpresar(:org,'2026-12-31') where codigo = '1.1.01.02';

-- El equipo sí: vale el doble en moneda de diciembre.
select case when reexpresado = 2000000.00 and ajuste = 1000000.00
            then 'OK · el equipo, en moneda de diciembre: 2.000.000,00'
            else 'FALLO · el equipo quedó en ' || reexpresado::text end as resultado
  from reexpresar(:org,'2026-12-31') where codigo = '1.2.01.03';

-- El capital también: aportar 2.000.000 en enero equivale a 4.000.000 de diciembre.
select case when reexpresado = -4000000.00
            then 'OK · el capital aportado en enero equivale a 4.000.000,00 de diciembre'
            else 'FALLO · el capital quedó en ' || reexpresado::text end as resultado
  from reexpresar(:org,'2026-12-31') where codigo = '3.1.01';

-- ============================================================ el resultado monetario
-- Ajustes: equipo +1.000.000 ; capital -2.000.000. Suma -1.000.000.
-- REME = +1.000.000: una PÉRDIDA por haber tenido un millón en bolívares todo el año.
select case when resultado_monetario(:org,'2026-12-31') = 1000000.00
            then 'OK · resultado monetario: 1.000.000,00 de pérdida por tener bolívares'
            else 'FALLO · dio ' || resultado_monetario(:org,'2026-12-31')::text end as resultado;

-- ============================================================ el asiento
select asentar_reexpresion(:org, 2026, 12, :yo) \gset r_

select case when ves = 0
            then 'OK · tras el asiento de reexpresión, el libro vuelve a cuadrar'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org,'2026-12-31');

-- Y el balance reexpresado cuadra: activo = pasivo + patrimonio.
with b as (select seccion, sum(monto_ves) m from balance_general(:org,'2026-12-31') group by 1)
select case when coalesce((select m from b where seccion='activo'),0)
              - coalesce((select m from b where seccion='pasivo'),0)
              - coalesce((select m from b where seccion='patrimonio'),0) = 0
            then 'OK · el balance reexpresado cuadra: activo = pasivo + patrimonio'
            else 'FALLO · el balance no cuadra tras reexpresar' end as resultado;

-- No se reexpresa dos veces el mismo mes.
do $$
begin
  perform asentar_reexpresion('0f0f0f0f-0000-0000-0000-00000000000a', 2026, 12,
                              '0f0f0f0f-0000-0000-0000-00000000000d');
  raise exception 'FALLO · reexpresó el mismo mes dos veces';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no se reexpresa dos veces el mismo mes: %', SQLERRM;
end $$;

-- Sin índice publicado, se niega en vez de inventarse un factor.
do $$
begin
  perform factor_reexpresion('2020-01-01','2026-12-31');
  raise exception 'FALLO · inventó un factor sin índice';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · sin índice publicado se niega, en vez de inventarse un factor';
end $$;
