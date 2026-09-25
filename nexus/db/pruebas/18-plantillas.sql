-- GPS Nexus · las plantillas de hitos.
--
-- Lo que se comprueba aqui es que un contrato nuevo NO pueda nacer sin hitos sin que
-- se note. Un renglon sin hitos tiene avance cero, que es el mismo cero que un
-- renglon que no ha empezado — y que las dos cosas se vean igual es lo que hace que
-- nadie se entere.

\set ON_ERROR_STOP on
\set org '''8c9d0e1f-0000-0000-0000-00000000000a'''
\set cli '''8c9d0e1f-0000-0000-0000-00000000000b'''
\set yo  '''8c9d0e1f-0000-0000-0000-00000000000d'''
\set tasa '''8c9d0e1f-1111-0000-0000-00000000000a'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Plantillas','J-950000000-0'),
 (:cli,'operadora','Operadora','J-951111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'pla@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values (:tasa,'2026-09-11', 36.50,'carga_manual');

-- ============================================================ los cinco tipos suman 100
select case when count(*) = 5
            then 'OK · los cinco tipos de contrato tienen su cadena de hitos'
            else 'FALLO · solo hay ' || count(*)::text || ' tipos con plantilla' end as resultado
  from (select tipo from plantilla_hito group by tipo) t;

select case when count(*) = 0
            then 'OK · todas las plantillas suman exactamente 100'
            else 'FALLO · ' || string_agg(tipo::text || '=' || total::text, ', ') end as resultado
  from (select tipo, sum(peso) total from plantilla_hito group by tipo having sum(peso) <> 100) t;

-- ============================================================ todas en los dos idiomas
select case when count(*) = 0
            then 'OK · cada hito de plantilla está en español e inglés, y no repetido'
            else 'FALLO · ' || count(*)::text || ' sin traducir' end as resultado
  from plantilla_hito
 where btrim(nombre_es) = '' or btrim(nombre_en) = '' or nombre_es = nombre_en;

-- ============================================================ crear los hitos de un renglón
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por, inicio, fin_previsto)
values ('8c9d0e1f-2222-0000-0000-00000000000a', :org, :cli,'PLA-001','procura',
        'Cabezales','Wellheads','vigente','USD', 400000.00, :tasa, :yo,
        '2026-01-01','2026-12-31');
insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, precio_unitario, costo_unitario)
values ('8c9d0e1f-3333-0000-0000-00000000000a','8c9d0e1f-2222-0000-0000-00000000000a',
        1,'Cabezal','Wellhead', 4,'unidad', 100000.0000, 62000.0000);

select case when crear_hitos_desde_plantilla('8c9d0e1f-3333-0000-0000-00000000000a') = 5
            then 'OK · un renglón de procura nace con sus cinco hitos'
            else 'FALLO' end as resultado;

select case when sum(peso) = 100.00
            then 'OK · los hitos creados suman 100: un renglón terminado llega al 100%'
            else 'FALLO · suman ' || sum(peso)::text end as resultado
  from hito where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a';

-- ============================================================ las fechas se reparten
select case when count(*) = 5 and min(planificada) > '2026-01-01'::date
                              and max(planificada) <= '2026-12-31'::date
            then 'OK · las fechas planificadas se reparten dentro del plazo del contrato'
            else 'FALLO · de ' || min(planificada)::text || ' a ' || max(planificada)::text end as resultado
  from hito where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a'
    and planificada is not null;

-- El hito que pesa más llega más tarde: las fechas siguen el peso acumulado.
select case when (select planificada from hito
                   where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a' and clave = 'orden')
                 < (select planificada from hito
                     where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a' and clave = 'recibido')
            then 'OK · las fechas van en orden, no todas el mismo día'
            else 'FALLO' end as resultado;

-- ============================================================ llamarlo dos veces no pisa nada
update hito set estado = 'declarado', ocurrido_en = '2026-03-15'
 where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a' and clave = 'orden';

select case when crear_hitos_desde_plantilla('8c9d0e1f-3333-0000-0000-00000000000a') = 0
            then 'OK · volver a crearlos no duplica ni borra la historia que ya hay'
            else 'FALLO · duplicó' end as resultado;

select case when (select ocurrido_en from hito
                   where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000a' and clave = 'orden')
                 = '2026-03-15'::date
            then 'OK · la fecha real que alguien puso sigue ahí'
            else 'FALLO · se perdió la fecha real' end as resultado;

-- ============================================================ un contrato sin plazo no inventa fechas
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values ('8c9d0e1f-2222-0000-0000-00000000000b', :org, :cli,'PLA-002','alquiler',
        'Equipos','Equipment','vigente','USD', 100000.00, :tasa, :yo);
insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, precio_unitario, costo_unitario)
values ('8c9d0e1f-3333-0000-0000-00000000000b','8c9d0e1f-2222-0000-0000-00000000000b',
        1,'Bomba','Pump', 1,'mes', 100000.0000, 60000.0000);

select case when crear_hitos_desde_plantilla('8c9d0e1f-3333-0000-0000-00000000000b') = 3
            then 'OK · un renglón de alquiler nace con sus tres hitos'
            else 'FALLO' end as resultado;

select case when count(*) = 3
            then 'OK · sin plazo en el contrato no se inventa ninguna fecha'
            else 'FALLO · inventó ' || count(*)::text || ' fechas' end as resultado
  from hito where renglon_id = '8c9d0e1f-3333-0000-0000-00000000000b' and planificada is null;

-- ============================================================ el que se olvidó se ve
insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, precio_unitario, costo_unitario)
values ('8c9d0e1f-3333-0000-0000-00000000000c','8c9d0e1f-2222-0000-0000-00000000000a',
        2,'Válvula','Valve', 10,'unidad', 5000.0000, 3000.0000);

select case when count(*) = 1 and max(valor) = 50000.00
            then 'OK · el renglón al que se le olvidaron los hitos se ve, y con su importe'
            else 'FALLO · salieron ' || count(*)::text end as resultado
  from renglones_sin_hitos(:org);

-- Y en cuanto se le crean, desaparece de esa lista.
select crear_hitos_desde_plantilla('8c9d0e1f-3333-0000-0000-00000000000c') as _;

select case when count(*) = 0
            then 'OK · creados los hitos, deja de estar en la lista de olvidados'
            else 'FALLO · sigue ahí' end as resultado
  from renglones_sin_hitos(:org);

-- ============================================================ cada tipo su cadena
select case when count(*) = 4
            then 'OK · un servicio lleva otra cadena que una procura, no la misma'
            else 'FALLO · ' || count(*)::text end as resultado
  from plantilla_hito where tipo = 'servicio';

select case when exists (select 1 from plantilla_hito
                          where tipo = 'reacondicionamiento' and clave = 'programa')
            then 'OK · el workover empieza cuando se aprueba el programa, no cuando llega el equipo'
            else 'FALLO' end as resultado;

select case when exists (select 1 from plantilla_hito
                          where tipo = 'alquiler' and clave = 'devolucion' and 'foto' = any(exige))
            then 'OK · la devolución del equipo alquilado exige foto: ahí aparece el daño'
            else 'FALLO' end as resultado;
