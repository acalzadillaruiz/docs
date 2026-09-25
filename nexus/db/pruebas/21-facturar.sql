-- GPS Nexus · emitir la factura.
--
-- El correlativo lo pone la base de datos, no una persona: uno llevado a mano acaba
-- con huecos o repetido, y las dos cosas son un problema con el SENIAT.

\set ON_ERROR_STOP on
\set org '''1f2a3b4c-1000-0000-0000-00000000000a'''
\set cli '''1f2a3b4c-1000-0000-0000-00000000000b'''
\set yo  '''1f2a3b4c-1000-0000-0000-00000000000d'''
\set ing '''1f2a3b4c-1000-0000-0000-00000000000e'''
\set tasa '''1f2a3b4c-1100-0000-0000-00000000000a'''
\set iva '''1f2a3b4c-1100-0000-0000-00000000000b'''
\set ctr '''1f2a3b4c-2200-0000-0000-00000000000a'''
\set v1  '''1f2a3b4c-4400-0000-0000-000000000001'''
\set v2  '''1f2a3b4c-4400-0000-0000-000000000002'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Facturar','J-901000000-0'),
 (:cli,'operadora','Operadora','J-901100000-0');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'fac@ejemplo.test','Interno','clave_2fa','(h)','(s)'),
       (:ing, :cli,'fac-cli@ejemplo.test','Ingeniero','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values (:tasa,'2026-09-16', 40.00,'carga_manual');
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values (:iva,'general', 16.00,'2026-01-01') on conflict do nothing;
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'FAC-001','servicio','Servicio','Service','vigente','VES',
        5000000.00, :tasa, :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values (:v1, :org, :ctr, 1,'2026-09-01','2026-09-30', 100000.00,'VES', :tasa, 0, 0, :iva,
        'SERV-PJ', 0,'aprobada','2026-09-30', :ing, :yo),
       (:v2, :org, :ctr, 2,'2026-10-01','2026-10-31', 200000.00,'VES', :tasa, 0, 0, :iva,
        'SERV-PJ', 0,'aprobada','2026-10-31', :ing, :yo);

select set_config('app.persona_id', :yo, false);

-- ============================================================ la factura se emite
select case when emitir_factura(:v1, :yo) is not null
            then 'OK · se emite la factura de una valuación aprobada'
            else 'FALLO' end as resultado;

select case when numero = '00000001' and numero_control like '00-__00000001'
            then 'OK · el correlativo y el número de control los pone la base de datos'
            else 'FALLO · ' || numero || ' / ' || coalesce(numero_control,'(nada)') end as resultado
  from documento_fiscal where organizacion_id = :org and sentido = 'emitido';

-- ============================================================ la segunda sigue la serie
select emitir_factura(:v2, :yo) as _;

select case when count(*) = 2 and max(numero) = '00000002'
            then 'OK · la serie sigue sin huecos: 00000001 y 00000002'
            else 'FALLO' end as resultado
  from documento_fiscal where organizacion_id = :org and sentido = 'emitido';

-- ============================================================ la valuación queda facturada
select case when estado = 'facturada' and documento_id is not null
            then 'OK · la valuación queda facturada y apuntando a su factura'
            else 'FALLO · ' || estado::text end as resultado
  from valuacion where id = :v1;

-- ============================================================ los importes salen de la hoja
-- 100.000 de obra, 16.000 de IVA. No se recalculan aquí: se leen de la hoja.
select case when base_ves = 100000.00 and iva_ves = 16000.00
            then 'OK · la base y el IVA salen de la hoja, no se vuelven a calcular'
            else 'FALLO · ' || base_ves::text || ' / ' || iva_ves::text end as resultado
  from documento_fiscal where organizacion_id = :org and numero = '00000001';

-- ============================================================ NO se genera otro asiento
-- La cuenta por cobrar ya nació con el asiento de la valuación. Otro asiento aquí
-- duplicaría el ingreso, que es el error clásico.
select case when asiento_id is null
            then 'OK · emitir la factura no genera otro asiento: no duplica el ingreso'
            else 'FALLO · generó un asiento' end as resultado
  from documento_fiscal where organizacion_id = :org and numero = '00000001';

-- ============================================================ no se factura dos veces
do $$
begin
  perform emitir_factura('1f2a3b4c-4400-0000-0000-000000000001',
                         '1f2a3b4c-1000-0000-0000-00000000000d');
  raise exception 'FALLO · se facturó dos veces la misma valuación';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · una valuación ya facturada no se vuelve a facturar';
end $$;

-- ============================================================ sin aprobar no se factura
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, creada_por)
values ('1f2a3b4c-4400-0000-0000-000000000003', :org, :ctr, 3,'2026-11-01','2026-11-30',
        50000.00,'VES', :tasa, 0, 0, :iva,'SERV-PJ', 0,'presentada', :yo);
do $$
begin
  perform emitir_factura('1f2a3b4c-4400-0000-0000-000000000003',
                         '1f2a3b4c-1000-0000-0000-00000000000d');
  raise exception 'FALLO · se facturó una valuación sin aprobar';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · sin aprobar no se factura';
end $$;

-- ============================================================ con una objeción abierta tampoco
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values ('1f2a3b4c-4400-0000-0000-000000000004', :org, :ctr, 4,'2026-12-01','2026-12-31',
        50000.00,'VES', :tasa, 0, 0, :iva,'SERV-PJ', 0,'aprobada','2026-12-31', :ing, :yo);
insert into objecion (valuacion_id, persona_id, motivo)
values ('1f2a3b4c-4400-0000-0000-000000000004', :ing,'La cuadrilla trabajó 18 días');

do $$
begin
  perform emitir_factura('1f2a3b4c-4400-0000-0000-000000000004',
                         '1f2a3b4c-1000-0000-0000-00000000000d');
  raise exception 'FALLO · se facturó con una objeción sin responder';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no se factura con una objeción sin responder';
end $$;

-- ============================================================ sale en el libro de ventas
select case when count(*) = 2
            then 'OK · las dos facturas salen en el libro de ventas sin transcribir nada'
            else 'FALLO · salieron ' || count(*)::text end as resultado
  from libro_ventas where organizacion_id = :org;
