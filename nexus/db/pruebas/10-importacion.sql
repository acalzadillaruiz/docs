-- GPS Nexus · salir de Excel.
-- La hoja entra tal cual, la aplicacion ensena como la entendio, el humano corrige,
-- se valida sin escribir nada, y solo entonces se confirma.

\set ON_ERROR_STOP on
\set org  '''0c0c0c0c-0000-0000-0000-00000000000a'''
\set yo   '''0c0c0c0c-0000-0000-0000-00000000000d'''
\set lote '''0c0c0c0c-0000-0000-0000-000000000100'''

insert into organizacion (id, tipo, nombre, rif) values (:org,'gps','GPS Energy','J-000000000-0');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');

-- ============================================================ lectura de celdas
-- El formato venezolano y el anglosajon dan numeros distintos para el mismo texto.
-- Por eso el formato se declara y no se adivina: adivinarlo es como se cuelan
-- errores de tres ordenes de magnitud sin que nadie los vea.
select case when leer_numero('1.234.567,89','ve') = 1234567.89
             and leer_numero('1,234,567.89','en') = 1234567.89
             and leer_numero('1.234','ve') = 1234
             and leer_numero('1.234','en') = 1.234
            then 'OK · lee números en los dos formatos, y 1.234 significa cosas distintas en cada uno'
            else 'FALLO · ve=' || coalesce(leer_numero('1.234','ve')::text,'null')
                 || ' en=' || coalesce(leer_numero('1.234','en')::text,'null') end as resultado;

select case when leer_fecha('15/09/2026','DD/MM/YYYY') = '2026-09-15'
             and leer_fecha('no es fecha','DD/MM/YYYY') is null
            then 'OK · lee fechas, y devuelve nulo en vez de inventarse una'
            else 'FALLO' end as resultado;

-- ============================================================ la hoja entra tal cual
insert into lote_importacion (id, organizacion_id, archivo, hoja, destino, filas, cargado_por)
values (:lote, :org,'valuaciones-2026.xlsx','Hoja1','valuaciones', 4, :yo);

insert into fila_cruda (lote_id, fila, celdas) values
 (:lote, 1, array['GPS-2026-001','1','30/09/2026','1.000.000,00']),
 (:lote, 2, array['GPS-2026-001','2','31/10/2026','850.000,00']),
 (:lote, 3, array['GPS-2026-002','1','30/09/2026','no es un número']),
 (:lote, 4, array['GPS-2026-002','2','','420.000,00']);

insert into mapeo_columna (lote_id, columna, campo, tipo, formato) values
 (:lote, 1,'contrato','texto', null),
 (:lote, 2,'numero','texto', null),
 (:lote, 3,'periodo_hasta','fecha','DD/MM/YYYY'),
 (:lote, 4,'obra','numero','ve');

-- ============================================================ se enseña como se entendió
\echo ''
\echo '--- así entendí tu hoja ---'
select fila, campo, en_la_hoja, entendido from previsualizar(:lote, 4);
\echo ''

select case when entendido = '1000000.00'
            then 'OK · la previsualización enseña cómo entendió cada celda'
            else 'FALLO · entendió ' || entendido end as resultado
  from previsualizar(:lote, 1) where campo = 'obra';

select case when entendido like '%no se entiende%'
            then 'OK · y dice claramente cuál no entiende, en vez de callarse'
            else 'FALLO' end as resultado
  from previsualizar(:lote, 3) where campo = 'obra' and fila = 3;

-- ============================================================ validar sin escribir
select * from validar_lote(:lote) \gset v_

select case when :v_filas = 4 and :v_buenas = 2 and :v_malas = 2
            then 'OK · valida sin escribir nada: 4 filas, 2 buenas, 2 malas'
            else 'FALLO · ' || :v_filas || '/' || :v_buenas || '/' || :v_malas end as resultado;

select case when motivo like '%obra%número%'
            then 'OK · el motivo dice qué columna y por qué: ' || motivo
            else 'FALLO · motivo: ' || coalesce(motivo,'ninguno') end as resultado
  from validacion_fila where lote_id = :lote and fila = 3;

select case when motivo like '%periodo_hasta%'
            then 'OK · detecta también la fecha vacía de la fila 4'
            else 'FALLO · motivo: ' || coalesce(motivo,'ninguno') end as resultado
  from validacion_fila where lote_id = :lote and fila = 4;

-- ============================================================ no se confirma a medias
do $$
begin
  perform confirmar_lote('0c0c0c0c-0000-0000-0000-000000000100',
                         '0c0c0c0c-0000-0000-0000-00000000000d');
  raise exception 'FALLO · confirmó un lote con filas malas';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · no confirma con filas malas: %', SQLERRM;
end $$;

-- ============================================================ corregidas, sí entra
update fila_cruda set celdas = array['GPS-2026-002','1','30/09/2026','610.000,00']
 where lote_id = :lote and fila = 3;
update fila_cruda set celdas = array['GPS-2026-002','2','31/10/2026','420.000,00']
 where lote_id = :lote and fila = 4;

select * from validar_lote(:lote) \gset w_
select case when :w_malas = 0 then 'OK · corregidas las dos filas, el lote queda limpio'
            else 'FALLO · quedan ' || :w_malas || ' malas' end as resultado;

select case when confirmar_lote(:lote, :yo) = 4
            then 'OK · confirmado: entran las cuatro filas'
            else 'FALLO' end as resultado;

-- ============================================================ falta una columna
insert into lote_importacion (id, organizacion_id, archivo, destino, filas, cargado_por)
values ('0c0c0c0c-0000-0000-0000-000000000200', :org,'incompleta.xlsx','valuaciones', 1, :yo);
insert into fila_cruda (lote_id, fila, celdas)
values ('0c0c0c0c-0000-0000-0000-000000000200', 1, array['GPS-2026-003','1']);
insert into mapeo_columna (lote_id, columna, campo, tipo) values
 ('0c0c0c0c-0000-0000-0000-000000000200', 1,'contrato','texto'),
 ('0c0c0c0c-0000-0000-0000-000000000200', 2,'numero','texto');

do $$
begin
  perform validar_lote('0c0c0c0c-0000-0000-0000-000000000200');
  raise exception 'FALLO · validó sin las columnas obligatorias';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · avisa de las columnas obligatorias que faltan: %', SQLERRM;
end $$;

-- ============================================================ la hoja original sigue ahí
select case when count(*) = 4 then 'OK · la hoja original sigue guardada, fila por fila'
            else 'FALLO' end as resultado from fila_cruda where lote_id = :lote;

-- ============================================================ formato vacio
-- Un formato VACIO no es «dmy por defecto»: es que nadie dijo como se lee esa
-- columna. `coalesce` no lo atrapaba —solo mira el null—, asi que la cadena vacia
-- llegaba a to_date como patron vacio y to_date devolvia '0001-01-01 BC' sin
-- quejarse. Esa fecha imposible entraba en un documento fiscal en silencio.
select case when leer_fecha('05/11/2026','') = '2026-11-05'
            then 'OK · un formato vacio se lee como dmy, no como basura'
            else 'FALLO · dio ' || coalesce(leer_fecha('05/11/2026','')::text,'null') end as resultado;

select case when leer_fecha('05/11/2026', null) = '2026-11-05'
            then 'OK · un formato nulo tambien'
            else 'FALLO' end as resultado;

-- Y la red de seguridad para cualquier patron que no sea ninguno de los tres: una
-- factura del ano 1 o del 3000 no es una fecha mal escrita, es basura.
select case when leer_fecha('05/11/2026','vaya usted a saber') is null
            then 'OK · un patron que no se entiende devuelve nada, NUNCA una fecha rara'
            else 'FALLO · dio ' || leer_fecha('05/11/2026','vaya usted a saber')::text end as resultado;

select case when leer_fecha('05/11/1850','dmy') is null
            then 'OK · el ano 1850 no es una factura'
            else 'FALLO' end as resultado;
