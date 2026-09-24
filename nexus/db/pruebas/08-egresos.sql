-- GPS Nexus · GPS como agente de retencion, y el costo imputado al contrato.
--
-- Factura de proveedor: base 500.000, IVA 16% = 80.000, total 580.000
--   Retencion de IVA 75% de 80.000          = 60.000,00
--   Retencion de ISLR 5% menos 37,50        = 24.962,50
--   Queda por pagar: 580.000 - 60.000 - 24.962,50 = 495.037,50

\set ON_ERROR_STOP on
\set org '''0a0a0a0a-0000-0000-0000-00000000000a'''
\set pro '''0a0a0a0a-0000-0000-0000-00000000000b'''
\set yo  '''0a0a0a0a-0000-0000-0000-00000000000d'''
\set doc '''0a0a0a0a-0000-0000-0000-0000000000cc'''
\set ctr '''0a0a0a0a-0000-0000-0000-0000000000c1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 (:pro,'proveedor','Proveedor Ejemplo','J-333333333-3'),
 ('0a0a0a0a-0000-0000-0000-00000000000e','operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('0a0a0a0a-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('0a0a0a0a-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

select instalar_plan_cuentas(:org);
insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 9);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org,'0a0a0a0a-0000-0000-0000-00000000000e','GPS-2026-001','servicio',
        'Servicio','Service','vigente','VES', 20000000.00,
        '0a0a0a0a-0000-0000-0000-00000000000f', :yo);

insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                              contraparte_id, fecha, contrato_id, base_ves, base_usd,
                              alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
values (:doc, :org,'recibido','factura','F-00123','00-00456', :pro,'2026-09-15', :ctr,
        500000.00, 13698.63,'0a0a0a0a-0000-0000-0000-000000000005', 80000.00, 2191.78,
        '0a0a0a0a-0000-0000-0000-00000000000f', :yo);

-- ============================================================ sin ser especial
do $$
begin
  perform retener_iva_proveedor('0a0a0a0a-0000-0000-0000-0000000000cc',
                                '0a0a0a0a-0000-0000-0000-00000000000d');
  raise exception 'FALLO · retuvo IVA sin ser agente de retención';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no retiene si no es agente de retención: %', SQLERRM;
end $$;

-- ============================================================ ya especial
insert into regimen_iva (organizacion_id, vigente_desde, es_especial)
values (:org, '2026-01-01', true);

select retener_iva_proveedor(:doc, :yo) \gset i_
select retener_islr_proveedor(:doc, 'SERV-PJ', :yo) \gset s_

select case when monto_ves = 60000.00 and porcentaje = 75.00
            then 'OK · retención de IVA al 75%: 60.000,00'
            else 'FALLO · retuvo ' || monto_ves::text end as resultado
  from retencion where clase = 'iva' and documento_id = :doc;

select case when monto_ves = 24962.50
            then 'OK · retención de ISLR: 24.962,50'
            else 'FALLO · retuvo ' || monto_ves::text end as resultado
  from retencion where clase = 'islr' and documento_id = :doc;

-- El comprobante lleva correlativo con el periodo delante.
select case when comprobante = '20260900000001'
            then 'OK · comprobante con correlativo del período: ' || comprobante
            else 'FALLO · comprobante ' || comprobante end as resultado
  from retencion where clase = 'iva' and documento_id = :doc;

-- No se retiene dos veces la misma factura.
do $$
begin
  perform retener_iva_proveedor('0a0a0a0a-0000-0000-0000-0000000000cc',
                                '0a0a0a0a-0000-0000-0000-00000000000d');
  raise exception 'FALLO · retuvo dos veces';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no retiene dos veces la misma factura';
end $$;

-- ============================================================ asiento
select asentar_factura_proveedor(:doc, '5.1.03', :yo) \gset a_

select case when count(*) = 0 then 'OK · el asiento de la factura de proveedor cuadra'
            else 'FALLO · ' || count(*)::text || ' línea(s) mal' end as resultado
  from (values ('5.1.03', 500000.00), ('1.1.04.01', 80000.00),
               ('2.1.03.02', -60000.00), ('2.1.03.03', -24962.50),
               ('2.1.01.01', -495037.50)) as e(cuenta, monto)
  full join (select cuenta, monto_ves from partida where asiento_id = :'a_asentar_factura_proveedor') p
    on p.cuenta = e.cuenta
 where p.monto_ves is distinct from e.monto;

-- El costo queda imputado al contrato, visible mientras corre.
select case when costo_ves = 500000.00
            then 'OK · el costo queda imputado al contrato: 500.000,00'
            else 'FALLO · imputó ' || costo_ves::text end as resultado
  from costo_contrato(:ctr, '2026-09-30') where cuenta = '5.1.03';

-- El libro sigue cuadrando.
select case when ves = 0 then 'OK · el libro cuadra con los egresos dentro'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org, '2026-09-30');

-- Aparece en el libro de compras, sin que nadie lo transcriba.
select case when count(*) = 1 and max(credito_fiscal_ves) = 80000.00
                              and max(iva_retenido_ves) = 60000.00
            then 'OK · aparece en el libro de compras con su retención, sin transcribir'
            else 'FALLO · el libro de compras no lo refleja' end as resultado
  from libro_compras where organizacion_id = :org;

-- ============================================================ factura sin control
-- El reglamento manda retener el 100% cuando la factura del proveedor no cumple los
-- requisitos. Aqui se detecta por la ausencia de numero de control.
insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, contraparte_id,
                              fecha, contrato_id, base_ves, base_usd, alicuota_iva_id,
                              iva_ves, iva_usd, tasa_id, registrado_por)
values ('0a0a0a0a-0000-0000-0000-0000000000dd', :org,'recibido','factura','F-00124', :pro,
        '2026-09-18', :ctr, 200000.00, 5479.45,'0a0a0a0a-0000-0000-0000-000000000005',
        32000.00, 876.71,'0a0a0a0a-0000-0000-0000-00000000000f', :yo);

select retener_iva_proveedor('0a0a0a0a-0000-0000-0000-0000000000dd', :yo);

select case when porcentaje = 100.00 and monto_ves = 32000.00
            then 'OK · sin número de control retiene el 100%: 32.000,00'
            else 'FALLO · retuvo ' || porcentaje::text || '%' end as resultado
  from retencion where clase = 'iva' and documento_id = '0a0a0a0a-0000-0000-0000-0000000000dd';

-- Y el correlativo sigue la secuencia, sin huecos ni repeticiones.
select case when count(distinct comprobante) = 2
                 and max(comprobante) = '20260900000002'
            then 'OK · el correlativo sigue la secuencia: 000001 y 000002'
            else 'FALLO · correlativos ' || string_agg(comprobante, ', ') end as resultado
  from retencion where clase = 'iva' and organizacion_id = :org;
