-- GPS Nexus · prueba aritmetica de la hoja de valuacion.
-- El caso esta calculado a mano aparte. Si el codigo da otra cosa, es el codigo.
--
--   Obra del periodo                     1.000.000,00
--   IVA 16%                              +  160.000,00
--   Total facturado                       1.160.000,00
--   Amortizacion de anticipo 20%         -  200.000,00
--   Retencion de garantia 5%             -   50.000,00
--   Retencion de IVA 75% de 160.000      -  120.000,00
--   Retencion de ISLR 5% menos 37,50     -   49.962,50
--                                        --------------
--   Neto a cobrar                           740.037,50

\set ON_ERROR_STOP on

insert into organizacion (id, tipo, nombre, rif) values
 ('aaaaaaaa-0000-0000-0000-000000000001','gps','GPS Energy','J-000000000-0'),
 ('aaaaaaaa-0000-0000-0000-000000000002','operadora','Operadora Ejemplo','J-111111111-1');

insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values ('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001',
        'interno@ejemplo.test','Persona Interna','clave_2fa','(hash)','(secreto)');

insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('aaaaaaaa-0000-0000-0000-000000000004','2026-09-01', 36.50000000,'carga_manual');

insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);

insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('aaaaaaaa-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');

insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios, persona juridica domiciliada','Services, domiciled legal entity',
        'pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, anticipo_pct, amortiza_pct, garantia_pct, creado_por)
values ('aaaaaaaa-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000002','GPS-2026-001','servicio',
        'Servicio de prueba','Test service','vigente','VES', 20000000.00,
        'aaaaaaaa-0000-0000-0000-000000000004', 20.00, 20.00, 5.00,
        'aaaaaaaa-0000-0000-0000-000000000003');

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                       alicuota_iva_id, concepto_islr, ret_iva_pct, creada_por)
values ('aaaaaaaa-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000006', 1, '2026-09-01','2026-09-30',
        1000000.00,'VES','aaaaaaaa-0000-0000-0000-000000000004', 20.00, 5.00,
        'aaaaaaaa-0000-0000-0000-000000000005','SERV-PJ', 75.00,
        'aaaaaaaa-0000-0000-0000-000000000003');

\echo ''
\echo '--- hoja de valuacion ---'
select orden, concepto_es, porcentaje, to_char(monto,'FM999G999G999D00') as monto
  from hoja_valuacion('aaaaaaaa-0000-0000-0000-000000000007') order by orden;
\echo ''

-- Cada linea contra su valor calculado a mano.
with esperado(orden, monto) as (values
  (1, 1000000.00), (2, 160000.00), (3, 1160000.00), (4, -200000.00),
  (5, -50000.00),  (6, -120000.00), (7, -49962.50), (8, 0.00), (9, 740037.50))
select case when count(*) = 0
            then 'OK · las nueve lineas de la hoja cuadran'
            else 'FALLO · ' || count(*)::text || ' linea(s) no cuadran'
       end as resultado
  from hoja_valuacion('aaaaaaaa-0000-0000-0000-000000000007') h
  join esperado e on e.orden = h.orden
 where h.monto <> e.monto;

-- El mismo caso pagado en divisa: IGTF del 3% sobre el neto.
-- 740.037,50 x 3% = 22.201,13 ; neto = 740.037,50 - 22.201,13 = 717.836,37
update valuacion set paga_en_divisa = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000007';

select case when neto_valuacion('aaaaaaaa-0000-0000-0000-000000000007') = 717836.37
            then 'OK · con IGTF el neto es 717.836,37'
            else 'FALLO · con IGTF dio ' || neto_valuacion('aaaaaaaa-0000-0000-0000-000000000007')::text
       end as resultado;

-- Una valuacion aprobada exige constar quien la aprobo.
do $$
begin
  update valuacion set estado = 'aprobada'
   where id = 'aaaaaaaa-0000-0000-0000-000000000007';
  raise exception 'FALLO · se aprobo una valuacion sin firma';
exception when check_violation then
  raise notice 'OK · no se puede aprobar una valuacion sin constar quien la aprobo';
end $$;
