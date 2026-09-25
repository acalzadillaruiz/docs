-- GPS Nexus · quien puede objetar, y que no se factura con una objecion abierta.

\set ON_ERROR_STOP on
\set gps '''3c4d5e6f-0000-0000-0000-00000000000a'''
\set cli '''3c4d5e6f-0000-0000-0000-00000000000b'''
\set yo  '''3c4d5e6f-0000-0000-0000-00000000000d'''
\set ing '''3c4d5e6f-0000-0000-0000-00000000000e'''
\set ctr '''3c4d5e6f-0000-0000-0000-0000000000c1'''
\set val '''3c4d5e6f-0000-0000-0000-0000000000f1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:gps,'gps','GPS Energy','J-000000000-0'),
 (:cli,'operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
 (:yo, :gps,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)'),
 (:ing, :cli,'ing@ejemplo.test','Ingeniero','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('3c4d5e6f-1111-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00);
insert into alicuota_igtf (vigente_desde, porcentaje)  values ('2026-01-01', 3.00);
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values ('3c4d5e6f-1111-0000-0000-00000000000e','general', 16.00, '2026-01-01');
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0, '2026-01-01');

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :gps, :cli,'APR-001','servicio','Servicio','Service','vigente','VES',
        20000000.00,'3c4d5e6f-1111-0000-0000-00000000000f', :yo);

insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, presentada_el, creada_por)
values (:val, :gps, :ctr, 1,'2026-09-01','2026-09-30', 500000.00,'VES',
        '3c4d5e6f-1111-0000-0000-00000000000f', 0, 0,'3c4d5e6f-1111-0000-0000-00000000000e',
        'SERV-PJ', 0,'presentada','2026-10-01', :yo);

-- ============================================================ quién objeta
-- GPS no puede objetar su propia valuación: no significaría nada.
do $$
begin
  insert into objecion (valuacion_id, persona_id, motivo)
  values ('3c4d5e6f-0000-0000-0000-0000000000f1','3c4d5e6f-0000-0000-0000-00000000000d',
          'me objeto a mí mismo');
  raise exception 'FALLO · GPS objetó su propia valuación';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · GPS no puede objetar su propia valuación: %', SQLERRM;
end $$;

-- El cliente sí.
insert into objecion (id, valuacion_id, persona_id, motivo)
values ('3c4d5e6f-2222-0000-0000-000000000001', :val, :ing,
        'El renglón 3 incluye 12 horas de grúa que no se ejecutaron el 14 de septiembre.');
\echo 'OK · el cliente sí puede objetar'

-- Una objeción sin motivo no entra.
do $$
begin
  insert into objecion (valuacion_id, persona_id, motivo)
  values ('3c4d5e6f-0000-0000-0000-0000000000f1','3c4d5e6f-0000-0000-0000-00000000000e','   ');
  raise exception 'FALLO · entró una objeción vacía';
exception when check_violation then
  raise notice 'OK · una objeción sin motivo no entra';
end $$;

-- El motivo se guarda entero, no resumido.
select case when length(motivo) > 60 and motivo like '%14 de septiembre%'
            then 'OK · el motivo se guarda entero, con su detalle'
            else 'FALLO · el motivo se recortó' end as resultado
  from objecion where id = '3c4d5e6f-2222-0000-0000-000000000001';

-- ============================================================ no se factura con objeción abierta
update valuacion set estado = 'aprobada', aprobada_el = current_date, aprobada_por = :ing
 where id = :val;

do $$
begin
  update valuacion set estado = 'facturada' where id = '3c4d5e6f-0000-0000-0000-0000000000f1';
  raise exception 'FALLO · se facturó con una objeción sin responder';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no se factura con una objeción sin responder: %', SQLERRM;
end $$;

-- Respondida, sí se puede.
update objecion
   set respuesta = 'Se retiran las 12 horas de grúa. La valuación se corrige a la baja.',
       respondida_en = now(), respondida_por = :yo
 where id = '3c4d5e6f-2222-0000-0000-000000000001';

update valuacion set estado = 'facturada' where id = :val;
select case when estado = 'facturada'
            then 'OK · respondida la objeción, la valuación ya se puede facturar'
            else 'FALLO' end as resultado from valuacion where id = :val;

-- Una respuesta a medias no entra: o está completa o no está.
-- Se prueba sobre una objeción NUEVA, no sobre la ya respondida: en esa los tres
-- campos ya estaban puestos, así que cambiar solo el texto no violaba nada y la
-- prueba pasaba sin comprobar lo que decía comprobar.
insert into objecion (id, valuacion_id, persona_id, motivo)
values ('3c4d5e6f-2222-0000-0000-000000000002', :val, :ing,
        'Falta el acta de recepción del renglón 5.');

do $$
begin
  update objecion set respuesta = 'a medias'
   where id = '3c4d5e6f-2222-0000-0000-000000000002';
  raise exception 'FALLO · entró una respuesta sin quién ni cuándo';
exception when check_violation then
  raise notice 'OK · una respuesta sin quién ni cuándo no entra';
end $$;

-- Y con los tres campos, sí.
update objecion
   set respuesta = 'Se adjunta el acta firmada el 30 de septiembre.',
       respondida_en = now(), respondida_por = :yo
 where id = '3c4d5e6f-2222-0000-0000-000000000002';
select case when respondida_en is not null
            then 'OK · con quién, cuándo y qué, la respuesta entra'
            else 'FALLO' end as resultado
  from objecion where id = '3c4d5e6f-2222-0000-0000-000000000002';
