-- GPS Nexus · prueba de que el asiento lo genera el hecho, no una persona.
-- Mismo caso de la prueba 02: obra 1.000.000, neto 740.037,50.
--
-- Asiento esperado:
--   Debe   Cuentas por cobrar                740.037,50
--   Debe   Anticipo recibido                 200.000,00
--   Debe   Retencion de garantia              50.000,00
--   Debe   IVA retenido por el cliente       120.000,00
--   Debe   ISLR retenido por el cliente       49.962,50
--                                          -------------
--                                          1.160.000,00
--       Haber  Ingresos por obra                     1.000.000,00
--       Haber  IVA debito fiscal                       160.000,00
--                                                   -------------
--                                                   1.160.000,00

\set ON_ERROR_STOP on
\set org   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set yo    '''bbbbbbbb-0000-0000-0000-000000000003'''
\set val   '''bbbbbbbb-0000-0000-0000-000000000007'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 ('bbbbbbbb-0000-0000-0000-000000000002','operadora','Operadora Ejemplo','J-111111111-1');

insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org, 'interno@ejemplo.test','Persona Interna','clave_2fa','(hash)','(secreto)');

insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('bbbbbbbb-0000-0000-0000-000000000004','2026-09-01', 36.50000000,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('bbbbbbbb-0000-0000-0000-000000000005','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into cuenta (organizacion_id, codigo, nombre_es, nombre_en, naturaleza) values
 (:org,'1.1.02','Cuentas por cobrar','Accounts receivable','activo'),
 (:org,'1.1.05','IVA retenido por clientes','VAT withheld by customers','activo'),
 (:org,'1.1.06','ISLR retenido por clientes','Income tax withheld','activo'),
 (:org,'1.1.07','Retención de garantía por cobrar','Retainage receivable','activo'),
 (:org,'2.1.03','Anticipos recibidos','Advances received','pasivo'),
 (:org,'2.1.05','IVA débito fiscal','VAT payable','pasivo'),
 (:org,'4.1.01','Ingresos por obra','Work revenue','ingreso'),
 (:org,'5.2.09','IGTF','FX transaction tax','gasto');

insert into mapa_cuenta (organizacion_id, concepto, cuenta) values
 (:org,'cxc','1.1.02'), (:org,'ret_iva_sufrida','1.1.05'), (:org,'ret_islr_sufrida','1.1.06'),
 (:org,'garantia_retenida','1.1.07'), (:org,'anticipo_recibido','2.1.03'),
 (:org,'iva_debito','2.1.05'), (:org,'ingreso_obra','4.1.01'), (:org,'igtf_gasto','5.2.09');

insert into periodo (organizacion_id, anio, mes) values (:org, 2026, 9);

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, anticipo_pct, amortiza_pct, garantia_pct, creado_por)
values ('bbbbbbbb-0000-0000-0000-000000000006', :org,'bbbbbbbb-0000-0000-0000-000000000002',
        'GPS-2026-001','servicio','Servicio de prueba','Test service','vigente','VES',
        20000000.00,'bbbbbbbb-0000-0000-0000-000000000004', 20.00, 20.00, 5.00, :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                       alicuota_iva_id, concepto_islr, ret_iva_pct, estado, aprobada_el,
                       aprobada_por, creada_por)
values (:val, :org,'bbbbbbbb-0000-0000-0000-000000000006', 1,'2026-09-01','2026-09-30',
        1000000.00,'VES','bbbbbbbb-0000-0000-0000-000000000004', 20.00, 5.00,
        'bbbbbbbb-0000-0000-0000-000000000005','SERV-PJ', 75.00,'aprobada','2026-09-30', :yo, :yo);

-- ============================================================ genera el asiento
select asentar_valuacion(:val, :yo) as asiento_generado \gset a_

\echo ''
\echo '--- asiento generado ---'
select p.linea, c.nombre_es as cuenta,
       to_char(greatest(p.monto_ves,0),'FM999G999G999D00')  as debe,
       to_char(greatest(-p.monto_ves,0),'FM999G999G999D00') as haber
  from partida p join cuenta c
    on c.organizacion_id = p.organizacion_id and c.codigo = p.cuenta
 where p.asiento_id = :'a_asiento_generado' order by p.linea;
\echo ''

-- Cada linea contra lo calculado a mano.
with esperado(cuenta, monto) as (values
  ('1.1.02',  740037.50), ('2.1.03',  200000.00), ('1.1.07',   50000.00),
  ('1.1.05',  120000.00), ('1.1.06',   49962.50),
  ('4.1.01',-1000000.00), ('2.1.05', -160000.00))
select case when count(*) = 0 then 'OK · el asiento generado cuadra linea por linea'
            else 'FALLO · ' || count(*)::text || ' linea(s) no cuadran' end as resultado
  from esperado e
  full join (select cuenta, monto_ves from partida where asiento_id = :'a_asiento_generado') p
    on p.cuenta = e.cuenta
 where p.monto_ves is distinct from e.monto;

-- El asiento apunta al hecho que lo genero.
select case when origen_tipo = 'valuacion' and origen_id = :val
            then 'OK · el asiento apunta a la valuacion que lo genero'
            else 'FALLO · el asiento no apunta a su origen' end as resultado
  from asiento where id = :'a_asiento_generado';

-- No se puede asentar dos veces la misma valuacion.
do $$
begin
  perform asentar_valuacion('bbbbbbbb-0000-0000-0000-000000000007',
                            'bbbbbbbb-0000-0000-0000-000000000003');
  raise exception 'FALLO · se asento dos veces la misma valuacion';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no se puede asentar dos veces: %', SQLERRM;
end $$;

-- Falta una cuenta en el mapa: el error dice cual, no falla en silencio.
do $$
begin
  delete from mapa_cuenta
   where organizacion_id = 'bbbbbbbb-0000-0000-0000-000000000001' and concepto = 'cxc';
  perform cuenta_de('bbbbbbbb-0000-0000-0000-000000000001','cxc');
  raise exception 'FALLO · no aviso de la cuenta que falta';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · avisa de la cuenta que falta: %', SQLERRM;
end $$;

-- El reverso: igual y contrario, apuntando al original.
select reversar_asiento(:'a_asiento_generado', :yo, 'valuación mal presentada') as rev \gset r_

select case when (select sum(monto_ves) from partida
                   where asiento_id in (:'a_asiento_generado', :'r_rev')) = 0
            then 'OK · el reverso deja el saldo en cero, y los dos asientos se quedan'
            else 'FALLO · el reverso no anula' end as resultado;

select case when reversa_a = :'a_asiento_generado'
            then 'OK · el reverso apunta al asiento que corrige'
            else 'FALLO' end as resultado from asiento where id = :'r_rev';

-- El mayor de cuentas por cobrar enlaza con el documento de origen.
select case when count(*) = 2 and bool_and(origen_tipo = 'valuacion')
            then 'OK · el mayor enlaza cada linea con su documento'
            else 'FALLO · el mayor no enlaza' end as resultado
  from mayor(:org, '1.1.02', '2026-09-01', '2026-09-30');
