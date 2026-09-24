-- GPS Nexus · el ciclo completo: valuacion -> asiento -> cobro -> asiento.
-- Cuando el cobro entra, la cuenta por cobrar queda en cero sola.
-- Nadie marca nada a mano.

\set ON_ERROR_STOP on
\set org '''eeeeeeee-0000-0000-0000-00000000000a'''
\set yo  '''eeeeeeee-0000-0000-0000-00000000000d'''
\set val '''eeeeeeee-0000-0000-0000-0000000000ef'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 ('eeeeeeee-0000-0000-0000-00000000000b','operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('eeeeeeee-0000-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('eeeeeeee-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into cuenta (organizacion_id, codigo, nombre_es, nombre_en, naturaleza) values
 (:org,'1.1.01','Banco','Bank','activo'),
 (:org,'1.1.02','Cuentas por cobrar','Accounts receivable','activo'),
 (:org,'1.1.05','IVA retenido por clientes','VAT withheld','activo'),
 (:org,'1.1.06','ISLR retenido por clientes','Income tax withheld','activo'),
 (:org,'1.1.07','Retención de garantía por cobrar','Retention receivable','activo'),
 (:org,'2.1.03','Anticipos recibidos','Advances received','pasivo'),
 (:org,'2.1.05','IVA débito fiscal','Output VAT','pasivo'),
 (:org,'4.1.01','Ingresos por obra','Work revenue','ingreso'),
 (:org,'5.2.09','IGTF','FX transaction tax','gasto');
insert into mapa_cuenta (organizacion_id, concepto, cuenta) values
 (:org,'banco','1.1.01'), (:org,'cxc','1.1.02'), (:org,'ret_iva_sufrida','1.1.05'),
 (:org,'ret_islr_sufrida','1.1.06'), (:org,'garantia_retenida','1.1.07'),
 (:org,'anticipo_recibido','2.1.03'), (:org,'iva_debito','2.1.05'),
 (:org,'ingreso_obra','4.1.01'), (:org,'igtf_gasto','5.2.09');

insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 9), (:org, 2026, 10);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, amortiza_pct, garantia_pct, creado_por)
values ('eeeeeeee-0000-0000-0000-00000000000c', :org,'eeeeeeee-0000-0000-0000-00000000000b',
        'GPS-2026-001','servicio','Servicio','Service','vigente','VES', 20000000.00,
        'eeeeeeee-0000-0000-0000-00000000000f', 20.00, 5.00, :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
values (:val, :org,'eeeeeeee-0000-0000-0000-00000000000c', 1,'2026-09-01','2026-09-30',
        1000000.00,'VES','eeeeeeee-0000-0000-0000-00000000000f', 20.00, 5.00,
        'eeeeeeee-0000-0000-0000-000000000005','SERV-PJ', 75.00,'aprobada','2026-09-30', :yo, :yo);

select asentar_valuacion(:val, :yo) \gset

-- Lo pendiente es el neto: 740.037,50
select case when saldo_valuacion(:val) = 740037.50
            then 'OK · pendiente de cobro: 740.037,50'
            else 'FALLO · pendiente dio ' || saldo_valuacion(:val)::text end as resultado;

-- Aparece en la antiguedad de saldos.
select case when count(*) = 1 and max(saldo) = 740037.50
            then 'OK · aparece en la antigüedad de saldos'
            else 'FALLO · no aparece en la antigüedad' end as resultado
  from antiguedad(:org, '2026-10-15');

-- ============================================================ cobro parcial
insert into cobro (id, organizacion_id, valuacion_id, fecha, medio, moneda, monto, tasa_id,
                   referencia, registrado_por)
values ('eeeeeeee-1111-0000-0000-000000000001', :org, :val,'2026-10-05','transferencia',
        'VES', 400000.00,'eeeeeeee-0000-0000-0000-00000000000f','Transf 001', :yo);
select asentar_cobro('eeeeeeee-1111-0000-0000-000000000001', :yo) \gset

select case when saldo_valuacion(:val) = 340037.50
            then 'OK · tras cobrar 400.000 quedan 340.037,50'
            else 'FALLO · quedan ' || saldo_valuacion(:val)::text end as resultado;

select case when estado = 'aprobada' then 'OK · con saldo vivo la valuación sigue aprobada'
            else 'FALLO · cambió de estado antes de tiempo' end as resultado
  from valuacion where id = :val;

-- ============================================================ cobro final
insert into cobro (id, organizacion_id, valuacion_id, fecha, medio, moneda, monto, tasa_id,
                   referencia, registrado_por)
values ('eeeeeeee-1111-0000-0000-000000000002', :org, :val,'2026-10-20','transferencia',
        'VES', 340037.50,'eeeeeeee-0000-0000-0000-00000000000f','Transf 002', :yo);
select asentar_cobro('eeeeeeee-1111-0000-0000-000000000002', :yo) \gset

select case when saldo_valuacion(:val) = 0
            then 'OK · cobrada del todo: saldo cero'
            else 'FALLO · saldo ' || saldo_valuacion(:val)::text end as resultado;

select case when estado = 'cobrada'
            then 'OK · la valuación pasó a cobrada sola, sin que nadie la marcara'
            else 'FALLO · quedó en ' || estado::text end as resultado
  from valuacion where id = :val;

-- La cuenta por cobrar queda en cero en el libro, no solo en una consulta.
select case when coalesce(saldo_ves, 0) = 0
            then 'OK · cuentas por cobrar queda en cero en el libro'
            else 'FALLO · cuentas por cobrar tiene ' || saldo_ves::text end as resultado
  from (select saldo_ves from balance_comprobacion(:org,'2026-10-31') where codigo = '1.1.02'
        union all select 0 limit 1) t;

-- Y ya no aparece en la antiguedad.
select case when count(*) = 0 then 'OK · ya no aparece en la antigüedad de saldos'
            else 'FALLO · sigue apareciendo' end as resultado
  from antiguedad(:org, '2026-10-31');

-- No se puede cobrar de mas.
do $$
begin
  insert into cobro (id, organizacion_id, valuacion_id, fecha, medio, moneda, monto, tasa_id,
                     registrado_por)
  values ('eeeeeeee-1111-0000-0000-000000000003','eeeeeeee-0000-0000-0000-00000000000a',
          'eeeeeeee-0000-0000-0000-0000000000ef','2026-10-25','transferencia','VES', 1000.00,
          'eeeeeeee-0000-0000-0000-00000000000f','eeeeeeee-0000-0000-0000-00000000000d');
  perform asentar_cobro('eeeeeeee-1111-0000-0000-000000000003',
                        'eeeeeeee-0000-0000-0000-00000000000d');
  raise exception 'FALLO · se cobró de más sin avisar';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · avisa si se cobra de más: %', SQLERRM;
end $$;

-- El libro sigue cuadrando despues de todo el ciclo.
select case when ves = 0 and usd = 0 then 'OK · el libro cuadra tras el ciclo completo'
            else 'FALLO · descuadre de ' || ves::text end as resultado
  from descuadre(:org, '2026-10-31');
