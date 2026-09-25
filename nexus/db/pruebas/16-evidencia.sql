-- GPS Nexus · sin evidencia no hay avance.
--
-- Es la tesis del proyecto. Lo que se comprueba aqui es que NO se puede hacer
-- trampa: que no hay forma de subir el avance sin traer el documento.

\set ON_ERROR_STOP on
\set org '''6f7a8b9c-0000-0000-0000-00000000000a'''
\set cli '''6f7a8b9c-0000-0000-0000-00000000000b'''
\set yo  '''6f7a8b9c-0000-0000-0000-00000000000d'''
\set ctr '''6f7a8b9c-0000-0000-0000-0000000000c1'''
\set rg  '''6f7a8b9c-0000-0000-0000-0000000000e1'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 (:cli,'operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values ('6f7a8b9c-1111-0000-0000-00000000000f','2026-09-01', 36.50,'carga_manual');

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'EVI-001','procura','Cabezales','Wellheads','vigente','USD',
        500000.00,'6f7a8b9c-1111-0000-0000-00000000000f', :yo);

insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, norma, precio_unitario, costo_unitario)
values (:rg, :ctr, 1,'Cabezal de pozo','Wellhead', 2,'unidad','API 6A', 100000.0000, 62000.0000);

-- La cadena de hitos de un contrato de procura.
insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige) values
 ('6f7a8b9c-2222-0000-0000-000000000001', :rg, 1,'orden','Orden de compra colocada','PO placed', 10.00,'{}'),
 ('6f7a8b9c-2222-0000-0000-000000000002', :rg, 2,'fabricado','Fabricado','Manufactured', 30.00,'{certificado}'),
 ('6f7a8b9c-2222-0000-0000-000000000003', :rg, 3,'embarcado','Embarcado','Shipped', 25.00,'{conocimiento}'),
 ('6f7a8b9c-2222-0000-0000-000000000004', :rg, 4,'nacionalizado','Nacionalizado','Cleared', 15.00,'{aduana}'),
 ('6f7a8b9c-2222-0000-0000-000000000005', :rg, 5,'recibido','Recibido en sitio','Received on site', 20.00,'{acta,foto}');

-- ============================================================ el avance arranca en cero
select case when avance_renglon(:rg) = 0 and avance_declarado(:rg) = 0
            then 'OK · sin nada hecho, el avance es cero'
            else 'FALLO' end as resultado;

-- ============================================================ declarar no es avanzar
update hito set estado = 'declarado', ocurrido_en = current_date - 12,
       registrado_en = now(), registrado_por = :yo
 where id = '6f7a8b9c-2222-0000-0000-000000000002';

select case when avance_declarado(:rg) = 30.00 and avance_renglon(:rg) = 0
            then 'OK · declarado 30%, avance real 0%. Declarar no es avanzar.'
            else 'FALLO · declarado ' || avance_declarado(:rg)::text
                 || ' avance ' || avance_renglon(:rg)::text end as resultado;

-- ============================================================ NO se puede hacer trampa
do $$
begin
  update hito set estado = 'verificado'
   where id = '6f7a8b9c-2222-0000-0000-000000000002';
  raise exception 'FALLO · se marcó verificado sin evidencia';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no se puede verificar sin el documento: %', SQLERRM;
end $$;

-- ============================================================ con el documento, sí
insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime,
                       ocurrido_en, subida_por)
values ('6f7a8b9c-2222-0000-0000-000000000002','certificado',
        repeat('a', 64),'MTR-EN10204-3.1.pdf', 284512,'application/pdf',
        current_date - 12, :yo);

update hito set estado = 'evidenciado' where id = '6f7a8b9c-2222-0000-0000-000000000002';
\echo 'OK · con el documento subido, el hito pasa a evidenciado'

-- Pero evidenciado todavía no cuenta como avance: falta que alguien lo revise.
select case when avance_renglon(:rg) = 0
            then 'OK · evidenciado no es verificado: el avance sigue en 0%'
            else 'FALLO' end as resultado;

do $$
begin
  update hito set estado = 'verificado'
   where id = '6f7a8b9c-2222-0000-0000-000000000002';
  raise exception 'FALLO · se verificó el hito con la evidencia sin revisar';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · el hito no se verifica mientras la evidencia esté sin revisar';
end $$;

-- ============================================================ revisada, ahora sí
update evidencia set verificada_en = now(), verificada_por = :yo
 where hito_id = '6f7a8b9c-2222-0000-0000-000000000002';
update hito set estado = 'verificado' where id = '6f7a8b9c-2222-0000-0000-000000000002';

select case when avance_renglon(:rg) = 30.00
            then 'OK · revisada la evidencia, el avance sube a 30%'
            else 'FALLO · avance ' || avance_renglon(:rg)::text end as resultado;

-- ============================================================ el avance a una fecha pasada
-- El hito ocurrió hace 12 dias. Preguntado a hace 20, todavia no habia ocurrido.
-- La historia no se reescribe: lo verificado despues no cuenta hacia atras.
select case when avance_renglon(:rg, current_date - 20) = 0
             and avance_renglon(:rg, current_date - 12) = 30.00
            then 'OK · el avance a una fecha pasada no cuenta lo ocurrido después'
            else 'FALLO · a -20 dias ' || avance_renglon(:rg, current_date - 20)::text
                 || ', a -12 dias ' || avance_renglon(:rg, current_date - 12)::text
            end as resultado;

-- ============================================================ evidencia parcial no basta
update hito set estado = 'declarado', ocurrido_en = current_date - 3,
       registrado_en = now(), registrado_por = :yo
 where id = '6f7a8b9c-2222-0000-0000-000000000005';
insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por,
                       verificada_en, verificada_por)
values ('6f7a8b9c-2222-0000-0000-000000000005','acta', repeat('b', 64),
        'acta-recepcion.pdf', 91233,'application/pdf', :yo, now(), :yo);

do $$
begin
  update hito set estado = 'verificado'
   where id = '6f7a8b9c-2222-0000-0000-000000000005';
  raise exception 'FALLO · bastó con el acta, faltando la foto';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · el hito exige acta Y foto: con una sola no basta (%)', SQLERRM;
end $$;

-- ============================================================ una evidencia rechazada no cuenta
insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por,
                       rechazada_en, motivo_rechazo)
values ('6f7a8b9c-2222-0000-0000-000000000005','foto', repeat('c', 64),
        'foto-borrosa.jpg', 44100,'image/jpeg', :yo, now(),
        'La foto no permite leer la placa del equipo');

do $$
begin
  update hito set estado = 'verificado'
   where id = '6f7a8b9c-2222-0000-0000-000000000005';
  raise exception 'FALLO · una foto rechazada contó como evidencia';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · una evidencia rechazada no cuenta';
end $$;

-- Un rechazo sin motivo no entra.
do $$
begin
  insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por,
                         rechazada_en)
  values ('6f7a8b9c-2222-0000-0000-000000000005','foto', repeat('d', 64),
          'otra.jpg', 1000,'image/jpeg','6f7a8b9c-0000-0000-0000-00000000000d', now());
  raise exception 'FALLO · se rechazó sin decir por qué';
exception when check_violation then
  raise notice 'OK · rechazar exige decir por qué';
end $$;

-- ============================================================ la huella es la identidad
do $$
begin
  insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por)
  values ('6f7a8b9c-2222-0000-0000-000000000005','foto','no-es-una-huella',
          'x.jpg', 100,'image/jpeg','6f7a8b9c-0000-0000-0000-00000000000d');
  raise exception 'FALLO · entró algo que no es una huella SHA-256';
exception when check_violation then
  raise notice 'OK · la huella tiene que ser un SHA-256 de verdad';
end $$;

-- ============================================================ la brecha de evidencia
-- Renglón de 200.000 (2 × 100.000). Declarado 50% (30 fabricado + 20 recibido),
-- verificado 30%. Brecha = 200.000 × 0,20 = 40.000,00
select case when declarado = 100000.00 and evidenciado = 60000.00 and brecha = 40000.00
            then 'OK · brecha de evidencia: 40.000,00 de 100.000 declarados'
            else 'FALLO · declarado ' || declarado::text || ' evidenciado '
                 || evidenciado::text || ' brecha ' || brecha::text end as resultado
  from brecha_evidencia(:org);

-- ============================================================ tiempo hasta la verdad
select case when mediana is not null and peor >= 12
            then 'OK · tiempo hasta la verdad: mediana ' || mediana::text
                 || ' días, el peor ' || peor::text
            else 'FALLO' end as resultado
  from tiempo_hasta_la_verdad(:org);

-- ============================================================ cobertura
-- Vendido 200.000 sin ningún costo imputado todavía: todo sin respaldo.
select case when sin_respaldo = 200000.00
            then 'OK · cobertura: 200.000,00 vendidos sin nada comprado debajo'
            else 'FALLO · sin respaldo ' || sin_respaldo::text end as resultado
  from cobertura(:org);
