-- GPS Nexus · el buzon de salida de los avisos.
--
-- Lo que se comprueba aqui es que el aviso viva y muera con el hecho que lo provoca:
-- que se encole en la misma transaccion, que no se encole dos veces, que se deshaga
-- si el hecho se deshace, y que un fallo no reintente en bucle.

\set ON_ERROR_STOP on
\set org '''7b8c9d0e-0000-0000-0000-00000000000a'''
\set cli '''7b8c9d0e-0000-0000-0000-00000000000b'''
\set yo  '''7b8c9d0e-0000-0000-0000-00000000000d'''
\set ing '''7b8c9d0e-0000-0000-0000-00000000000e'''
\set ing2 '''7b8c9d0e-0000-0000-0000-00000000000f'''
\set ctr '''7b8c9d0e-2222-0000-0000-0000000000c1'''
\set rg  '''7b8c9d0e-3333-0000-0000-0000000000e1'''
\set val '''7b8c9d0e-4444-0000-0000-0000000000a1'''
\set tasa '''7b8c9d0e-1111-0000-0000-00000000000f'''
\set iva '''7b8c9d0e-1111-0000-0000-00000000000e'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Avisos','J-940000000-0'),
 (:cli,'operadora','Operadora Avisos','J-941111111-1');
insert into persona (id, organizacion_id, correo, nombre, idioma, metodo, clave_hash, totp_secreto)
values (:yo, :org,'avi@ejemplo.test','Interno','es','clave_2fa','(h)','(s)'),
       (:ing, :cli,'ing1@ejemplo.test','Ingeniero Uno','es','clave_2fa','(h)','(s)'),
       (:ing2, :cli,'ing2@ejemplo.test','Ingeniero Dos','en','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values (:tasa,'2026-09-09', 36.50,'carga_manual');
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values (:iva,'general', 16.00,'2026-01-01') on conflict do nothing;
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;

insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'AVI-001','servicio','Servicio','Service','vigente','VES',
        5000000.00, :tasa, :yo);
insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, precio_unitario, costo_unitario)
values (:rg, :ctr, 1,'Cuadrilla','Crew', 1,'mes', 1000000.0000, 600000.0000);
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                       concepto_islr, ret_iva_pct, estado, creada_por)
values (:val, :org, :ctr, 1,'2026-09-01','2026-09-30', 1000000.00,'VES', :tasa,
        0, 0, :iva,'SERV-PJ', 0,'borrador', :yo);

select set_config('app.persona_id', :yo, false);

-- ============================================================ presentar avisa al cliente
update valuacion set estado = 'presentada', presentada_el = current_date where id = :val;

select case when count(*) = 2
            then 'OK · presentar avisa a las DOS personas del cliente, no solo a una'
            else 'FALLO · avisó a ' || count(*)::text end as resultado
  from aviso where tipo = 'valuacion_presentada' and sobre_id = :val;

-- Y no avisa a GPS: GPS es quien la presentó.
select case when count(*) = 0
            then 'OK · a GPS no se le avisa de lo que acaba de hacer'
            else 'FALLO · se avisó a sí mismo' end as resultado
  from aviso a join persona p on p.id = a.persona_id
 where a.tipo = 'valuacion_presentada' and p.organizacion_id = :org;

-- ============================================================ el importe sí, el costo NUNCA
select case when datos ? 'obra' and not (datos ? 'costo') and not (datos ? 'margen')
            then 'OK · el aviso lleva el importe de la obra y ningún costo'
            else 'FALLO · el aviso lleva ' || datos::text end as resultado
  from aviso where tipo = 'valuacion_presentada' and sobre_id = :val limit 1;

-- ============================================================ no se avisa dos veces
update valuacion set estado = 'objetada' where id = :val;
update valuacion set estado = 'presentada' where id = :val;

select case when count(*) = 2
            then 'OK · presentar dos veces no manda el correo dos veces'
            else 'FALLO · ahora hay ' || count(*)::text end as resultado
  from aviso where tipo = 'valuacion_presentada' and sobre_id = :val;

-- ============================================================ la objeción avisa a GPS
insert into objecion (id, valuacion_id, motivo, persona_id)
values ('7b8c9d0e-5555-0000-0000-0000000000b1', :val,
        'La cuadrilla trabajó 18 días, no 22', :ing);

select case when count(*) = 1
            then 'OK · la objeción del cliente avisa a GPS el mismo día'
            else 'FALLO · avisos ' || count(*)::text end as resultado
  from aviso a join persona p on p.id = a.persona_id
 where a.tipo = 'objecion_nueva' and p.organizacion_id = :org;

-- ============================================================ responder avisa al cliente
update objecion set respondida_en = now(), respuesta = 'Revisado: 18 días',
       respondida_por = :yo
 where id = '7b8c9d0e-5555-0000-0000-0000000000b1';

select case when count(*) = 2
            then 'OK · la respuesta de GPS vuelve al cliente'
            else 'FALLO · avisos ' || count(*)::text end as resultado
  from aviso where tipo = 'objecion_respondida';

-- ============================================================ quien no quiere, no recibe
insert into preferencia_aviso (persona_id, tipo, quiere)
values (:ing2,'valuacion_aprobada', false);

update valuacion set estado = 'aprobada', aprobada_el = current_date, aprobada_por = :ing
 where id = :val;

-- La aprobación avisa a GPS, no al cliente; la preferencia se comprueba con el tipo
-- que sí le toca al cliente.
select case when count(*) = 1
            then 'OK · aprobar avisa a GPS, que es quien esperaba'
            else 'FALLO · avisos ' || count(*)::text end as resultado
  from aviso where tipo = 'valuacion_aprobada';

do $$
declare n int;
begin
  insert into preferencia_aviso (persona_id, tipo, quiere)
  values ('7b8c9d0e-0000-0000-0000-00000000000f','objecion_respondida', false)
  on conflict (persona_id, tipo) do update set quiere = false;

  select encolar_aviso('objecion_respondida','7b8c9d0e-0000-0000-0000-00000000000b',
                       '7b8c9d0e-5555-0000-0000-0000000000b2') into n;
  if n <> 1 then
    raise exception 'FALLO · se encolaron % avisos, debería ser solo 1', n;
  end if;
  raise notice 'OK · quien dijo que no quiere ese aviso no lo recibe';
end $$;

-- ============================================================ una baja no recibe nada
update persona set activa = false where id = :ing2;
do $$
declare n int;
begin
  select encolar_aviso('valuacion_presentada','7b8c9d0e-0000-0000-0000-00000000000b',
                       '7b8c9d0e-4444-0000-0000-0000000000a9') into n;
  if n <> 1 then raise exception 'FALLO · se encolaron % avisos', n; end if;
  raise notice 'OK · a quien está de baja no se le manda nada';
end $$;
update persona set activa = true where id = :ing2;

-- ============================================================ si el hecho se deshace, el aviso también
do $$
declare antes int; despues int;
begin
  select count(*) into antes from aviso;
  begin
    insert into objecion (id, valuacion_id, motivo, persona_id)
    values ('7b8c9d0e-5555-0000-0000-0000000000c9', '7b8c9d0e-4444-0000-0000-0000000000a1',
            'esta objeción no va a existir', '7b8c9d0e-0000-0000-0000-00000000000e');
    raise exception 'deshacer';
  exception when others then
    if SQLERRM <> 'deshacer' then raise; end if;
  end;
  select count(*) into despues from aviso;
  if antes <> despues then
    raise exception 'FALLO · quedó un aviso de un hecho que no se guardó';
  end if;
  raise notice 'OK · si el hecho se deshace, el aviso se deshace con él';
end $$;

-- ============================================================ tomar de la cola
do $$
declare cuantos int; uno record;
begin
  select count(*) into cuantos from tomar_avisos(3);
  if cuantos <> 3 then raise exception 'FALLO · tomó % avisos', cuantos; end if;

  -- Los intentos suben al TOMARLO, no al fallar: si el proceso se muere a mitad,
  -- el aviso vuelve a la cola con un intento gastado, no reintentando para siempre.
  select * into uno from aviso where intentos > 0 limit 1;
  if uno.intentos <> 1 then raise exception 'FALLO · intentos %', uno.intentos; end if;
  raise notice 'OK · tomar de la cola gasta un intento, aunque el envío se muera';
end $$;

-- ============================================================ el reintento espera, y cada vez más
do $$
declare a uuid; e1 timestamptz; e2 timestamptz; n int;
begin
  select id into a from aviso where estado = 'pendiente' limit 1;
  perform aviso_fallido(a, 'el servidor de correo no contesta');
  select intentar_en into e1 from aviso where id = a;
  if e1 <= now() then raise exception 'FALLO · reintenta inmediatamente'; end if;

  update aviso set intentos = 4 where id = a;
  perform aviso_fallido(a, 'otra vez');
  select intentar_en into e2 from aviso where id = a;
  if e2 <= e1 then raise exception 'FALLO · la espera no crece'; end if;

  update aviso set intentos = 6 where id = a;
  perform aviso_fallido(a, 'y van seis');
  select count(*) into n from aviso where id = a and estado = 'fallido';
  if n <> 1 then raise exception 'FALLO · a la sexta sigue reintentando'; end if;
  raise notice 'OK · el reintento espera cada vez más, y a la sexta se da por perdido';
end $$;

-- ============================================================ un aviso es de quien lo recibe
do $$
declare mios int;
begin
  set local role nexus_interno;
  perform set_config('app.persona_id','7b8c9d0e-0000-0000-0000-00000000000e', true);
  select count(*) into mios from aviso;
  reset role;
  if mios = 0 then raise exception 'FALLO · el ingeniero no ve ni sus propios avisos'; end if;
  if exists (select 1 from aviso) and mios = (select count(*) from aviso) then
    raise exception 'FALLO · ve todos los avisos, también los de los demás';
  end if;
  raise notice 'OK · cada quien ve sus avisos y no los de los demás';
end $$;

-- ============================================================ lo que lleva parado avisa solo
insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                  estado, planificada)
values ('7b8c9d0e-6666-0000-0000-000000000001', :rg, 1,'arranque','Arranque','Kickoff',
        50.00,'{acta}','pendiente', current_date - 9);
insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por, subida_en)
values ('7b8c9d0e-6666-0000-0000-000000000001','acta', repeat('a', 64),'acta.pdf',
        1234,'application/pdf', :yo, now() - interval '11 days');

select case when encolar_lo_parado(3) >= 2
            then 'OK · lo que lleva días parado avisa solo, aunque no pase nada'
            else 'FALLO · no encoló lo parado' end as resultado;

select case when count(*) = 1
            then 'OK · el aviso de lo parado dice cuántos días lleva'
            else 'FALLO' end as resultado
  from aviso where tipo = 'evidencia_sin_revisar' and (datos->>'dias')::int >= 11;

-- Y llamarlo dos veces el mismo día no duplica nada.
select case when encolar_lo_parado(3) = 0
            then 'OK · pasarlo dos veces el mismo día no duplica ningún aviso'
            else 'FALLO · duplicó' end as resultado;
