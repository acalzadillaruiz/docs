-- GPS Nexus · margen y rentabilidad, y que el cliente no los alcance.
--
-- Contrato de 20.000.000. Valuado 1.000.000. Costo imputado 500.000.
--   Margen  = 500.000,00  ->  50,00%
--   Avance  = 1.000.000 / 20.000.000 = 5,00%

\set ON_ERROR_STOP on
\set org '''0b0b0b0b-0000-0000-0000-00000000000a'''
\set cli '''0b0b0b0b-0000-0000-0000-00000000000e'''
\set pro '''0b0b0b0b-0000-0000-0000-00000000000b'''
\set yo  '''0b0b0b0b-0000-0000-0000-00000000000d'''
\set su  '''0b0b0b0b-0000-0000-0000-00000000000c'''
\set ctr '''0b0b0b0b-0000-0000-0000-0000000000c1'''
\set val '''0b0b0b0b-0000-0000-0000-0000000000f1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 (:cli,'operadora','Operadora Ejemplo','J-111111111-1'),
 (:pro,'proveedor','Proveedor','J-333333333-3');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
 (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)'),
 (:su, :cli,'ing@operadora.test','Ingeniero','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('0b0b0b0b-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('0b0b0b0b-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

select instalar_plan_cuentas(:org);
insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 9);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, amortiza_pct, garantia_pct, creado_por)
values (:ctr, :org, :cli,'GPS-2026-001','servicio','Servicio','Service','vigente','VES',
        20000000.00,'0b0b0b0b-0000-0000-0000-00000000000f', 20.00, 5.00, :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values (:val, :org, :ctr, 1,'2026-09-01','2026-09-30', 1000000.00,'VES',
        '0b0b0b0b-0000-0000-0000-00000000000f', 20.00, 5.00,
        '0b0b0b0b-0000-0000-0000-000000000005','SERV-PJ', 75.00,'aprobada','2026-09-30', :yo, :yo);
select asentar_valuacion(:val, :yo);

-- Un costo de 500.000 imputado al contrato.
insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                              contraparte_id, fecha, contrato_id, base_ves, base_usd,
                              alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
values ('0b0b0b0b-0000-0000-0000-0000000000cc', :org,'recibido','factura','F-001','00-00456', :pro,
        '2026-09-20', :ctr, 500000.00, 13698.63,'0b0b0b0b-0000-0000-0000-000000000005',
        80000.00, 2191.78,'0b0b0b0b-0000-0000-0000-00000000000f', :yo);
-- GPS es contribuyente especial, asi que retiene a su proveedor. Sin esto, lo que
-- se le debe es la factura entera; con esto, la factura menos lo retenido. El flujo
-- de caja tiene que reflejar lo segundo.
insert into regimen_iva (organizacion_id, vigente_desde, es_especial)
values (:org, '2026-01-01', true);
select retener_iva_proveedor('0b0b0b0b-0000-0000-0000-0000000000cc', :yo);
select retener_islr_proveedor('0b0b0b0b-0000-0000-0000-0000000000cc','SERV-PJ', :yo);
select asentar_factura_proveedor('0b0b0b0b-0000-0000-0000-0000000000cc','5.1.03', :yo);

\echo ''
\echo '--- margen del contrato ---'
select contrato, to_char(valuado,'FM999G999G999D00') valuado,
       to_char(costo,'FM999G999G999D00') costo,
       to_char(margen,'FM999G999G999D00') margen, margen_pct, avance_pct
  from margen_contrato(:ctr, '2026-09-30');
\echo ''

select case when margen = 500000.00 and margen_pct = 50.00 and avance_pct = 5.00
            then 'OK · margen 500.000,00 (50,00%), avance 5,00%'
            else 'FALLO · margen ' || margen::text || ' pct ' || margen_pct::text end as resultado
  from margen_contrato(:ctr, '2026-09-30');

select case when count(*) = 1 and max(margen) = 500000.00
            then 'OK · la cartera muestra el contrato con su margen'
            else 'FALLO' end as resultado from margen_cartera(:org, '2026-09-30');

select case when margen_pct = 50.00 then 'OK · rentabilidad por cliente: 50,00%'
            else 'FALLO' end as resultado
  from rentabilidad_por_cliente(:org,'2026-01-01','2026-09-30');

select case when tipo = 'servicio' and margen = 500000.00
            then 'OK · rentabilidad por tipo de servicio'
            else 'FALLO' end as resultado
  from rentabilidad_por_servicio(:org,'2026-01-01','2026-09-30');

-- Ejecutado sin cobrar: el neto de la valuacion, que nadie ha pagado todavia.
select case when ejecutado_sin_cobrar(:org,'2026-09-30') = 740037.50
            then 'OK · ejecutado sin cobrar: 740.037,50'
            else 'FALLO · dio ' || ejecutado_sin_cobrar(:org,'2026-09-30')::text end as resultado;

-- El flujo de caja proyecta el cobro y el pago, cada uno en su semana.
select case when sum(entra) = 740037.50 and sum(sale) = 495037.50
            then 'OK · el flujo de caja proyecta cobro 740.037,50 y pago 495.037,50 (la factura menos lo retenido)'
            else 'FALLO · entra ' || sum(entra)::text || ' sale ' || sum(sale)::text end as resultado
  from flujo_caja(:org,'2026-10-01', 12);

-- ============================================================ el cliente no llega
set role nexus_cliente;
select set_config('app.persona_id', '0b0b0b0b-0000-0000-0000-00000000000c', false);

do $$
begin
  perform * from margen_contrato('0b0b0b0b-0000-0000-0000-0000000000c1','2026-09-30');
  -- Si llega hasta aqui, comprobamos que al menos no traiga costo.
  if exists (select 1 from margen_contrato('0b0b0b0b-0000-0000-0000-0000000000c1','2026-09-30')
              where costo <> 0) then
    raise exception 'FALLO · el cliente vio el costo del contrato';
  end if;
  raise notice 'OK · el cliente no obtiene costo: el aislamiento le vacía la consulta';
exception when insufficient_privilege then
  raise notice 'OK · el cliente no tiene permiso ni para preguntar por el margen';
end $$;

reset role;
