-- GPS Nexus · pagos emitidos y conciliacion bancaria.
-- Lo importante aqui no es que case: es que lo que NO casa quede senalado.

\set ON_ERROR_STOP on
\set org '''0d0d0d0d-0000-0000-0000-00000000000a'''
\set pro '''0d0d0d0d-0000-0000-0000-00000000000b'''
\set cli '''0d0d0d0d-0000-0000-0000-00000000000e'''
\set yo  '''0d0d0d0d-0000-0000-0000-00000000000d'''
\set doc '''0d0d0d0d-0000-0000-0000-0000000000cc'''
\set ctr '''0d0d0d0d-0000-0000-0000-0000000000c1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 (:pro,'proveedor','Proveedor','J-333333333-3'),
 (:cli,'operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('0d0d0d0d-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('0d0d0d0d-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');
insert into regimen_iva (organizacion_id, vigente_desde, es_especial) values (:org,'2026-01-01', true);

select instalar_plan_cuentas(:org);
insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 9), (:org, 2026, 10);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'GPS-2026-001','servicio','Servicio','Service','vigente','VES',
        20000000.00,'0d0d0d0d-0000-0000-0000-00000000000f', :yo);

-- Factura de proveedor: base 500.000 + IVA 80.000 = 580.000
-- menos retencion IVA 75% (60.000) y ISLR (24.962,50) -> por pagar 495.037,50
insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                              contraparte_id, fecha, contrato_id, base_ves, base_usd,
                              alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
values (:doc, :org,'recibido','factura','F-001','00-001', :pro,'2026-09-20', :ctr,
        500000.00, 13698.63,'0d0d0d0d-0000-0000-0000-000000000005', 80000.00, 2191.78,
        '0d0d0d0d-0000-0000-0000-00000000000f', :yo);
select retener_iva_proveedor(:doc, :yo);
select retener_islr_proveedor(:doc,'SERV-PJ', :yo);
select asentar_factura_proveedor(:doc,'5.1.03', :yo);

select case when saldo_documento(:doc) = 495037.50
            then 'OK · por pagar al proveedor: 495.037,50'
            else 'FALLO · dio ' || saldo_documento(:doc)::text end as resultado;

select case when count(*) = 1 and max(saldo) = 495037.50
            then 'OK · aparece en lo que toca pagar'
            else 'FALLO' end as resultado from por_pagar(:org,'2026-10-15');

-- ============================================================ pago parcial
insert into pago (id, organizacion_id, documento_id, beneficiario_id, fecha, medio,
                  moneda, monto, tasa_id, referencia, registrado_por)
values ('0d0d0d0d-1111-0000-0000-000000000001', :org, :doc, :pro,'2026-10-05',
        'transferencia','VES', 300000.00,'0d0d0d0d-0000-0000-0000-00000000000f','OP-001', :yo);
select asentar_pago('0d0d0d0d-1111-0000-0000-000000000001', :yo);

select case when saldo_documento(:doc) = 195037.50
            then 'OK · tras pagar 300.000 quedan 195.037,50'
            else 'FALLO · quedan ' || saldo_documento(:doc)::text end as resultado;

-- No se paga de mas.
do $$
begin
  insert into pago (id, organizacion_id, documento_id, beneficiario_id, fecha, medio,
                    moneda, monto, tasa_id, registrado_por)
  values ('0d0d0d0d-1111-0000-0000-000000000009','0d0d0d0d-0000-0000-0000-00000000000a',
          '0d0d0d0d-0000-0000-0000-0000000000cc','0d0d0d0d-0000-0000-0000-00000000000b',
          '2026-10-06','transferencia','VES', 900000.00,
          '0d0d0d0d-0000-0000-0000-00000000000f','0d0d0d0d-0000-0000-0000-00000000000d');
  perform asentar_pago('0d0d0d0d-1111-0000-0000-000000000009',
                       '0d0d0d0d-0000-0000-0000-00000000000d');
  raise exception 'FALLO · pagó de más sin avisar';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · avisa si se paga de más: %', SQLERRM;
end $$;

-- ============================================================ el banco
-- Tres movimientos: uno que casa con el pago, uno que no casa con nada, y una
-- comision que la contabilidad todavia no conoce.
insert into movimiento_banco (id, organizacion_id, cuenta, fecha, monto, moneda, descripcion, referencia)
values ('0d0d0d0d-2222-0000-0000-000000000001', :org,'1.1.01.02','2026-10-05', -300000.00,'VES',
        'TRANSF PROVEEDOR','OP-001'),
       ('0d0d0d0d-2222-0000-0000-000000000002', :org,'1.1.01.02','2026-10-07', -12500.00,'VES',
        'COMISION MANTENIMIENTO', null),
       ('0d0d0d0d-2222-0000-0000-000000000003', :org,'1.1.01.02','2026-10-09', 88000.00,'VES',
        'DEPOSITO SIN IDENTIFICAR', null);

select case when count(*) = 1 and max(casa_con) = 'pago' and max(dias_de_diferencia) = 0
            then 'OK · propone el casamiento del pago, mismo día y mismo importe'
            else 'FALLO · propuso ' || count(*)::text || ' casamiento(s)' end as resultado
  from proponer_conciliacion(:org,'2026-10-01','2026-10-31');

-- Conciliar es un acto humano: la propuesta no casa nada sola.
update movimiento_banco
   set pago_id = '0d0d0d0d-1111-0000-0000-000000000001',
       conciliado_en = now(), conciliado_por = :yo
 where id = '0d0d0d0d-2222-0000-0000-000000000001';

-- Lo que no casa queda señalado, a los dos lados.
select case when count(*) = 2
            then 'OK · los dos movimientos sin explicar quedan señalados'
            else 'FALLO · señaló ' || count(*)::text end as resultado
  from descuadres_banco(:org,'2026-10-01','2026-10-31')
 where lado = 'solo en el banco';

-- Un movimiento no se da por conciliado sin casarlo ni explicarlo por escrito.
do $$
begin
  update movimiento_banco set conciliado_en = now()
   where id = '0d0d0d0d-2222-0000-0000-000000000002';
  raise exception 'FALLO · se dio por conciliado sin casar ni explicar';
exception when check_violation then
  raise notice 'OK · no se concilia sin casarlo con algo o explicarlo por escrito';
end $$;

-- Con la explicación por escrito, sí.
update movimiento_banco
   set nota = 'Comisión del banco, se contabiliza aparte en gastos bancarios',
       conciliado_en = now(), conciliado_por = :yo
 where id = '0d0d0d0d-2222-0000-0000-000000000002';

select case when count(*) = 1
            then 'OK · explicada por escrito, queda conciliada; sigue señalado el depósito sin identificar'
            else 'FALLO · quedan ' || count(*)::text end as resultado
  from descuadres_banco(:org,'2026-10-01','2026-10-31') where lado = 'solo en el banco';

-- Un mismo pago no se puede casar con dos movimientos del banco.
do $$
begin
  update movimiento_banco set pago_id = '0d0d0d0d-1111-0000-0000-000000000001'
   where id = '0d0d0d0d-2222-0000-0000-000000000003';
  raise exception 'FALLO · el mismo pago se casó dos veces';
exception when unique_violation then
  raise notice 'OK · un pago no se puede casar con dos movimientos del banco';
end $$;

-- Y el libro sigue cuadrando.
select case when ves = 0 then 'OK · el libro cuadra con los pagos dentro'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org,'2026-10-31');
