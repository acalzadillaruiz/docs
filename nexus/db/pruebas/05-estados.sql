-- GPS Nexus · prueba de que los estados salen del libro y cuadran con el.
-- Mismo caso de siempre: una valuacion de 1.000.000 de obra, asentada.
--
--   Activo:   cuentas por cobrar 740.037,50 + IVA ret. 120.000 + ISLR ret. 49.962,50
--             + garantia por cobrar 50.000            = 960.000,00
--   Pasivo:   anticipos recibidos -200.000 (se amortizo, baja el pasivo)
--             + IVA debito fiscal 160.000             =  -40.000,00
--   Ingresos: 1.000.000,00
--   Comprobacion: activo - pasivo = 1.000.000 = resultado. El balance cuadra.

\set ON_ERROR_STOP on
\set org '''dddddddd-0000-0000-0000-00000000000a'''
\set yo  '''dddddddd-0000-0000-0000-00000000000d'''
\set val '''dddddddd-0000-0000-0000-0000000000ef'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 ('dddddddd-0000-0000-0000-00000000000b','operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('dddddddd-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('dddddddd-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into cuenta (organizacion_id, codigo, nombre_es, nombre_en, naturaleza) values
 (:org,'1.1.02','Cuentas por cobrar','Accounts receivable','activo'),
 (:org,'1.1.05','IVA retenido por clientes','VAT withheld','activo'),
 (:org,'1.1.06','ISLR retenido por clientes','Income tax withheld','activo'),
 (:org,'1.1.07','Retención de garantía por cobrar','Retention receivable','activo'),
 (:org,'2.1.03','Anticipos recibidos','Advances received','pasivo'),
 (:org,'2.1.05','IVA débito fiscal','Output VAT','pasivo'),
 (:org,'4.1.01','Ingresos por obra','Work revenue','ingreso'),
 (:org,'5.2.09','IGTF','FX transaction tax','gasto');
insert into mapa_cuenta (organizacion_id, concepto, cuenta) values
 (:org,'cxc','1.1.02'), (:org,'ret_iva_sufrida','1.1.05'), (:org,'ret_islr_sufrida','1.1.06'),
 (:org,'garantia_retenida','1.1.07'), (:org,'anticipo_recibido','2.1.03'),
 (:org,'iva_debito','2.1.05'), (:org,'ingreso_obra','4.1.01'), (:org,'igtf_gasto','5.2.09');

insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 8), (:org, 2026, 9);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, amortiza_pct, garantia_pct, creado_por)
values ('dddddddd-0000-0000-0000-00000000000c', :org,'dddddddd-0000-0000-0000-00000000000b',
        'GPS-2026-001','servicio','Servicio','Service','vigente','VES', 20000000.00,
        'dddddddd-0000-0000-0000-00000000000f', 20.00, 5.00, :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values (:val, :org,'dddddddd-0000-0000-0000-00000000000c', 1,'2026-09-01','2026-09-30',
        1000000.00,'VES','dddddddd-0000-0000-0000-00000000000f', 20.00, 5.00,
        'dddddddd-0000-0000-0000-000000000005','SERV-PJ', 75.00,'aprobada','2026-09-30', :yo, :yo);

select asentar_valuacion(:val, :yo) \gset

\echo ''
\echo '--- balance de comprobación ---'
select codigo, cuenta_es, to_char(saldo_ves,'FM999G999G999D00') as saldo
  from balance_comprobacion(:org, '2026-09-30');
\echo ''

-- El libro entero cuadra.
select case when ves = 0 and usd = 0 then 'OK · el libro cuadra: descuadre cero'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org, '2026-09-30');

-- El resultado del periodo es la obra ejecutada.
select case when resultado_ves = 1000000.00
            then 'OK · resultado del período: 1.000.000,00'
            else 'FALLO · resultado dio ' || resultado_ves::text end as resultado
  from resultado_neto(:org, '2026-09-01','2026-09-30');

-- Activo menos pasivo es igual al resultado. El balance cuadra con el estado.
with b as (select seccion, sum(monto_ves) m from balance_general(:org,'2026-09-30') group by 1)
select case when coalesce((select m from b where seccion='activo'),0)
              - coalesce((select m from b where seccion='pasivo'),0) = 1000000.00
            then 'OK · activo menos pasivo es igual al resultado: cuadra'
            else 'FALLO · activo menos pasivo no da el resultado' end as resultado;

-- No se cierra un mes si el anterior sigue abierto.
do $$
begin
  perform cerrar_periodo('dddddddd-0000-0000-0000-00000000000a', 2026, 9,
                         'dddddddd-0000-0000-0000-00000000000d');
  raise exception 'FALLO · cerro septiembre con agosto abierto';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no cierra un mes con el anterior abierto: %', SQLERRM;
end $$;

-- En orden si cierra.
select cerrar_periodo(:org, 2026, 8, :yo);
select cerrar_periodo(:org, 2026, 9, :yo);
select case when count(*) = 2 then 'OK · los dos meses quedan cerrados, en orden'
            else 'FALLO' end as resultado
  from periodo where organizacion_id = :org and estado = 'cerrado';

-- Y cerrado, no entra nada mas. Se prueba con un asiento nuevo, no con la valuacion
-- ya asentada: si no, la prueba pasaria por chocar con "ya tiene asiento" y no con
-- el mes cerrado, que es lo que aqui se quiere comprobar.
do $$
begin
  insert into asiento (organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values ('dddddddd-0000-0000-0000-00000000000a',
          siguiente_asiento('dddddddd-0000-0000-0000-00000000000a'),
          '2026-09-28', 2026, 9, 'Tardío','Late','prueba', gen_random_uuid(),
          'dddddddd-0000-0000-0000-00000000000d');
  raise exception 'FALLO · entro un asiento en un mes cerrado';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  if SQLERRM not like '%cerrado%' then
    raise exception 'FALLO · fue rechazado, pero no por estar el mes cerrado: %', SQLERRM;
  end if;
  raise notice 'OK · el mes cerrado no admite un asiento nuevo: %', SQLERRM;
end $$;
