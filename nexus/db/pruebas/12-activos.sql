-- GPS Nexus · activos fijos y equipos en alquiler.
--
-- Equipo de 3.600.000, residual 600.000, vida 60 meses.
--   Base depreciable = 3.000.000 ; cuota mensual = 50.000,00
--   A los 60 meses queda exactamente el residual, ni un bolivar mas ni menos.

\set ON_ERROR_STOP on
\set org '''0e0e0e0e-0000-0000-0000-00000000000a'''
\set cli '''0e0e0e0e-0000-0000-0000-00000000000e'''
\set yo  '''0e0e0e0e-0000-0000-0000-00000000000d'''
\set ctr '''0e0e0e0e-0000-0000-0000-0000000000c1'''
\set act '''0e0e0e0e-0000-0000-0000-0000000000a1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 (:cli,'operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('0e0e0e0e-0000-0000-0000-00000000000f','2026-01-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('0e0e0e0e-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

select instalar_plan_cuentas(:org);
insert into periodo (organizacion_id, anio, mes)
select :org, 2026, g from generate_series(1,12) g;

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'GPS-ALQ-001','alquiler','Alquiler de equipo','Equipment rental',
        'vigente','VES', 5000000.00,'0e0e0e0e-0000-0000-0000-00000000000f', :yo);

insert into activo (id, organizacion_id, codigo, descripcion_es, descripcion_en,
                    cuenta, cuenta_depre, cuenta_gasto, en_servicio_el,
                    costo_ves, costo_usd, tasa_id, valor_residual,
                    metodo, vida_meses, contrato_id)
values (:act, :org,'EQ-001','Unidad de bombeo','Pumping unit',
        '1.2.01.04','1.2.02','5.2.05','2026-01-01',
        3600000.00, 98630.14,'0e0e0e0e-0000-0000-0000-00000000000f', 600000.00,
        'linea_recta', 60, :ctr);

-- ============================================================ la cuota
select case when cuota_depreciacion(:act, 2026, 1) = 50000.00
            then 'OK · cuota mensual: 50.000,00'
            else 'FALLO · dio ' || cuota_depreciacion(:act, 2026, 1)::text end as resultado;

-- Antes de entrar en servicio no se deprecia nada.
select case when cuota_depreciacion(:act, 2025, 12) = 0
            then 'OK · antes de entrar en servicio no se deprecia'
            else 'FALLO' end as resultado;

-- ============================================================ doce meses
select depreciar_mes(:org, 2026, g, :yo) from generate_series(1,12) g;

select case when count(*) = 12 and sum(monto_ves) = 600000.00
            then 'OK · doce meses depreciados: 600.000,00 acumulados'
            else 'FALLO · ' || count(*)::text || ' meses, ' || sum(monto_ves)::text end as resultado
  from depreciacion where activo_id = :act;

select case when valor_en_libros(:act,'2026-12-31') = 3000000.00
            then 'OK · valor en libros tras un año: 3.000.000,00'
            else 'FALLO · dio ' || valor_en_libros(:act,'2026-12-31')::text end as resultado;

-- Un mes no se deprecia dos veces.
do $$
begin
  perform depreciar_mes('0e0e0e0e-0000-0000-0000-00000000000a', 2026, 6,
                        '0e0e0e0e-0000-0000-0000-00000000000d');
  raise exception 'FALLO · depreció el mismo mes dos veces';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · un mes no se deprecia dos veces: %', SQLERRM;
end $$;

-- El gasto queda imputado al contrato de alquiler, no a un saco general.
select case when costo_ves = 600000.00
            then 'OK · el desgaste se imputa al contrato donde se gana'
            else 'FALLO · imputó ' || coalesce(costo_ves::text,'nada') end as resultado
  from costo_contrato(:ctr,'2026-12-31') where cuenta = '5.2.05';

-- ============================================================ lo que deja de verdad
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values ('0e0e0e0e-0000-0000-0000-0000000000b1'::uuid, :org, :ctr, 1,'2026-01-01','2026-12-31',
        1500000.00,'VES','0e0e0e0e-0000-0000-0000-00000000000f', 0, 0,
        '0e0e0e0e-0000-0000-0000-000000000005','SERV-PJ', 0,'aprobada','2026-12-31', :yo, :yo);

select case when ingreso = 1500000.00 and desgaste = 600000.00 and deja = 900000.00
            then 'OK · el alquiler deja 900.000,00: ingreso 1.500.000 menos desgaste 600.000'
            else 'FALLO · ingreso ' || ingreso::text || ' desgaste ' || desgaste::text end as resultado
  from rendimiento_alquiler(:act,'2026-12-31');

-- ============================================================ el tope
-- A los 60 meses llega al residual y no sigue generando gasto por mucho que trabaje.
insert into periodo (organizacion_id, anio, mes)
select :org, a, m from generate_series(2027,2031) a, generate_series(1,12) m;
insert into tasa_bcv (vigente_el, ves_por_usd, fuente) values ('2027-01-01', 40.00,'carga_manual');

select depreciar_mes(:org, a, m, :yo) from generate_series(2027,2030) a, generate_series(1,12) m;

select case when sum(monto_ves) = 3000000.00
            then 'OK · al final deprecia exactamente lo depreciable: 3.000.000,00'
            else 'FALLO · acumuló ' || sum(monto_ves)::text end as resultado
  from depreciacion where activo_id = :act;

select case when valor_en_libros(:act,'2030-12-31') = 600000.00
            then 'OK · queda exactamente el valor residual: 600.000,00'
            else 'FALLO · quedó ' || valor_en_libros(:act,'2030-12-31')::text end as resultado;

select case when cuota_depreciacion(:act, 2031, 1) = 0
            then 'OK · agotado, ya no genera más gasto aunque siga trabajando'
            else 'FALLO · sigue depreciando' end as resultado;

-- El libro cuadra con todo eso dentro.
select case when ves = 0 then 'OK · el libro cuadra con cinco años de depreciación dentro'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org,'2031-12-31');

-- ============================================================ rehacer un mes
-- El error de «mes ya depreciado» dice «reversa su asiento». Si reversarlo no sirve de
-- nada, la instruccion es una burla: quien la sigue al pie de la letra choca con el
-- mismo error y sin salida. Aqui se comprueba que si sirve.

-- Repetir un mes ya depreciado no pasa.
do $$
begin
  perform depreciar_mes('0e0e0e0e-0000-0000-0000-00000000000a', 2026, 3,
                        '0e0e0e0e-0000-0000-0000-00000000000d');
  raise exception 'FALLO · dejo depreciar dos veces el mismo mes';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · el mismo mes no se deprecia dos veces: %', SQLERRM;
end $$;

-- Se reversa el de marzo, como dice el mensaje.
select reversar_asiento(id,'0e0e0e0e-0000-0000-0000-00000000000d','cuota mal calculada')
  from asiento
 where organizacion_id = :org and origen_tipo = 'depreciacion'
   and anio = 2026 and mes = 3 and reversa_a is null;

-- Y ahora si se puede rehacer. El asiento viejo y su reverso se quedan en el libro:
-- el error tambien es un hecho que ocurrio.
select case when depreciar_mes(:org, 2026, 3,'0e0e0e0e-0000-0000-0000-00000000000d') is not null
            then 'OK · reversado el asiento, el mes se puede rehacer'
            else 'FALLO · no rehizo nada' end as resultado;

-- Lo importante: no se duplico la cuota. La depreciacion de marzo sigue siendo una.
select case when count(*) = 1 and sum(monto_ves) = 50000.00
            then 'OK · rehacer no duplica la cuota del mes: sigue siendo 50.000,00'
            else 'FALLO · quedaron ' || count(*)::text || ' cuotas por '
                 || coalesce(sum(monto_ves),0)::text end as resultado
  from depreciacion where activo_id = :act and anio = 2026 and mes = 3;

-- Y el libro sigue cuadrando con el asiento viejo, su reverso y el nuevo dentro.
select case when ves = 0 then 'OK · el libro cuadra con el mes rehecho dentro'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org,'2031-12-31');
