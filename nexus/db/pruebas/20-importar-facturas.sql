-- GPS Nexus · el importador, atado a algo de verdad.
--
-- 'confirmar_lote' marcaba el lote y no creaba nada: todo el trabajo de leer la
-- hoja, mapear y validar terminaba en un sello. Lo que se comprueba aqui es que
-- ahora cree documentos de verdad, y que se niegue antes de crear medio lote.

\set ON_ERROR_STOP on
\set org '''0e1f2a3b-1000-0000-0000-00000000000a'''
\set cli '''0e1f2a3b-1000-0000-0000-00000000000b'''
\set pr1 '''0e1f2a3b-1000-0000-0000-00000000000c'''
\set yo  '''0e1f2a3b-1000-0000-0000-00000000000d'''
\set tasa '''0e1f2a3b-1100-0000-0000-00000000000a'''
\set ctr '''0e1f2a3b-2200-0000-0000-00000000000a'''
\set lote '''0e1f2a3b-7700-0000-0000-00000000000a'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Importar','J-900100000-0'),
 (:cli,'operadora','Operadora','J-900200000-0'),
 (:pr1,'proveedor','Suministros Zulia','J-30111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'imp@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values (:tasa,'2026-04-01', 40.00,'carga_manual');
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'IMP-001','procura','Cabezales','Wellheads','vigente','USD',
        100000.00, :tasa, :yo);

insert into lote_importacion (id, organizacion_id, archivo, destino, estado, filas, cargado_por)
values (:lote, :org,'facturas-abril.csv','facturas_recibidas','cargado', 2, :yo);

-- Fecha | Proveedor(RIF) | Factura | Control | Base | IVA | Contrato
insert into fila_cruda (lote_id, fila, celdas) values
 (:lote, 1, array['03/04/2026','J-30111111-1','00012345','01-00098765','1.200.000,00','192.000,00','IMP-001']),
 (:lote, 2, array['15/04/2026','J-30111111-1','00000987','01-00012345','350.000,00','56.000,00','']);

insert into mapeo_columna (lote_id, columna, campo, tipo, formato) values
 (:lote, 1,'fecha','fecha','dmy'),
 (:lote, 2,'proveedor','texto', null),
 (:lote, 3,'numero','texto', null),
 (:lote, 4,'control','texto', null),
 (:lote, 5,'base','numero','ven'),
 (:lote, 6,'iva','numero','ven'),
 (:lote, 7,'contrato','texto', null);

select set_config('app.persona_id', :yo, false);

-- ============================================================ validar primero
select case when filas = 2 and buenas = 2 and malas = 0
            then 'OK · la hoja valida: dos filas buenas'
            else 'FALLO · ' || filas::text || '/' || buenas::text || '/' || malas::text end as resultado
  from validar_lote(:lote);

-- ============================================================ confirmar CREA
select case when confirmar_lote(:lote, :yo) = 2
            then 'OK · confirmar el lote crea las dos facturas, no solo pone un sello'
            else 'FALLO' end as resultado;

select case when count(*) = 2
            then 'OK · las dos facturas de proveedor existen de verdad'
            else 'FALLO · hay ' || count(*)::text end as resultado
  from documento_fiscal where organizacion_id = :org and sentido = 'recibido';

-- ============================================================ el dólar se calcula, no se pide
-- 1.200.000,00 Bs a 40,00 = 30.000,00 USD, con la tasa del día DE LA FACTURA.
select case when base_ves = 1200000.00 and base_usd = 30000.00
                 and iva_ves = 192000.00 and iva_usd = 4800.00
            then 'OK · el importe en dólares sale de la tasa del día de la factura'
            else 'FALLO · ' || base_ves::text || ' / ' || base_usd::text end as resultado
  from documento_fiscal where numero = '00012345' and organizacion_id = :org;

-- ============================================================ el contrato se ata si viene
select case when contrato_id = :ctr
            then 'OK · la factura queda imputada al contrato que dice la hoja'
            else 'FALLO' end as resultado
  from documento_fiscal where numero = '00012345' and organizacion_id = :org;

select case when contrato_id is null
            then 'OK · una factura sin contrato en la hoja no se ata a ninguno inventado'
            else 'FALLO' end as resultado
  from documento_fiscal where numero = '00000987' and organizacion_id = :org;

-- ============================================================ el número de control entra
select case when numero_control = '01-00098765'
            then 'OK · el número de control entra: sin él la retención de IVA es del 100%'
            else 'FALLO' end as resultado
  from documento_fiscal where numero = '00012345' and organizacion_id = :org;

-- ============================================================ reimportar no duplica
update lote_importacion set estado = 'validado', confirmado_en = null where id = :lote;
select confirmar_lote(:lote, :yo) as _;

select case when count(*) = 2
            then 'OK · reimportar la misma hoja corregida no duplica las facturas'
            else 'FALLO · ahora hay ' || count(*)::text end as resultado
  from documento_fiscal where organizacion_id = :org and sentido = 'recibido';

-- ============================================================ un proveedor que no existe para el lote
insert into lote_importacion (id, organizacion_id, archivo, destino, estado, filas, cargado_por)
values ('0e1f2a3b-7700-0000-0000-00000000000b', :org,'mayo.csv','facturas_recibidas','cargado', 1, :yo);
insert into fila_cruda (lote_id, fila, celdas) values
 ('0e1f2a3b-7700-0000-0000-00000000000b', 1,
  array['02/05/2026','J-30999999-9','00005555','01-00005555','100.000,00','16.000,00','']);
insert into mapeo_columna (lote_id, columna, campo, tipo, formato) values
 ('0e1f2a3b-7700-0000-0000-00000000000b', 1,'fecha','fecha','dmy'),
 ('0e1f2a3b-7700-0000-0000-00000000000b', 2,'proveedor','texto', null),
 ('0e1f2a3b-7700-0000-0000-00000000000b', 3,'numero','texto', null),
 ('0e1f2a3b-7700-0000-0000-00000000000b', 4,'control','texto', null),
 ('0e1f2a3b-7700-0000-0000-00000000000b', 5,'base','numero','ven'),
 ('0e1f2a3b-7700-0000-0000-00000000000b', 6,'iva','numero','ven');

select case when count(*) = 1 and max(rif) = 'J-30999999-9'
            then 'OK · se dice QUÉ proveedor falta antes de tocar nada'
            else 'FALLO' end as resultado
  from proveedores_desconocidos('0e1f2a3b-7700-0000-0000-00000000000b');

select validar_lote('0e1f2a3b-7700-0000-0000-00000000000b') as _;

do $$
declare antes int; despues int;
begin
  select count(*) into antes from documento_fiscal
   where organizacion_id = '0e1f2a3b-1000-0000-0000-00000000000a';
  begin
    perform confirmar_lote('0e1f2a3b-7700-0000-0000-00000000000b',
                           '0e1f2a3b-1000-0000-0000-00000000000d');
    raise exception 'FALLO · entró una factura de un proveedor que no existe';
  exception when sqlstate 'P0001' then
    if SQLERRM like 'FALLO%' then raise; end if;
    select count(*) into despues from documento_fiscal
     where organizacion_id = '0e1f2a3b-1000-0000-0000-00000000000a';
    if antes <> despues then
      raise exception 'FALLO · quedó algo creado a medias';
    end if;
    raise notice 'OK · un proveedor sin dar de alta para el lote entero, sin crear nada';
  end;
end $$;

-- Y el lote sigue en 'validado', para poder reintentarlo tras crear el proveedor.
select case when estado = 'validado'
            then 'OK · el lote que falló se puede reintentar: no quedó marcado como hecho'
            else 'FALLO · quedó en ' || estado::text end as resultado
  from lote_importacion where id = '0e1f2a3b-7700-0000-0000-00000000000b';

-- ============================================================ sin validar no se confirma
insert into lote_importacion (id, organizacion_id, archivo, destino, estado, filas, cargado_por)
values ('0e1f2a3b-7700-0000-0000-00000000000c', :org,'sin-validar.csv','facturas_recibidas',
        'cargado', 0, :yo);
do $$
begin
  perform confirmar_lote('0e1f2a3b-7700-0000-0000-00000000000c',
                         '0e1f2a3b-1000-0000-0000-00000000000d');
  raise exception 'FALLO · se confirmó un lote sin validar';
exception when sqlstate 'P0001' then
  if SQLERRM like 'FALLO%' then raise; end if;
  raise notice 'OK · sin validar no se confirma';
end $$;

-- ============================================================ el 31 de febrero no se cuela
-- to_date es indulgente: '31/02/2026' le devuelve el 3 de marzo sin quejarse, y eso
-- es un día equivocado que entra en la contabilidad en silencio.
select case when leer_fecha('31/02/2026','dmy') is null
            then 'OK · una fecha que no existe se rechaza, no se corre tres días'
            else 'FALLO · devolvió ' || leer_fecha('31/02/2026','dmy')::text end as resultado;

select case when leer_fecha('03/04/2026','dmy') = '2026-04-03'::date
             and leer_fecha('03/04/2026','mdy') = '2026-03-04'::date
             and leer_fecha('2026-04-03','iso') = '2026-04-03'::date
            then 'OK · el mismo texto es dos días distintos según quién escribió la hoja'
            else 'FALLO' end as resultado;

select case when leer_fecha('03.04.2026','dmy') = '2026-04-03'::date
             and leer_fecha('03-04-2026','dmy') = '2026-04-03'::date
            then 'OK · el punto y el guion separan una fecha igual que la barra'
            else 'FALLO' end as resultado;

-- ============================================================ mismo vocabulario en las dos capas
select case when leer_numero('1.234,56','ven') = 1234.56
             and leer_numero('1.234,56','ve') = 1234.56
             and leer_numero('1,234.56','ang') = 1234.56
            then 'OK · la base de datos y la aplicación llaman igual a los formatos'
            else 'FALLO' end as resultado;
