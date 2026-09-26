-- GPS Nexus · el extracto del banco entra por Excel
--
-- La conciliacion bancaria existia desde hacia dias y NO TENIA PUERTA: comparaba
-- 'movimiento_banco' contra los cobros y los pagos, y no habia una sola forma de
-- meter un movimiento del banco. Una pantalla que no tiene nada que conciliar.
--
-- Es el mismo fallo de siempre, con otra cara: la maquina estaba entera y le faltaba
-- por donde entrar.
--
-- ---------------------------------------------------------------------------------
-- LO QUE ESTO NO HACE, Y ES LO MAS IMPORTANTE: no escribe ni un asiento.
--
-- Una linea del extracto NO es un apunte contable: es un hecho del banco que hay que
-- casar con un cobro o un pago que YA esta en el libro. Si al importar el extracto se
-- asentara, todo quedaria contado dos veces — una por la factura y otra por el
-- banco— y el descuadre apareceria en el cierre, a tres semanas de distancia de su
-- causa.
-- ---------------------------------------------------------------------------------

-- De que lote salio cada movimiento, para poder revertirlo entero.
alter table movimiento_banco add column if not exists lote_id uuid references lote_importacion(id);

-- El mismo movimiento no entra dos veces.
--
-- El lote ya detecta la MISMA hoja por su huella, pero eso no cubre el caso de
-- verdad: dos extractos que se solapan —del 1 al 31 y del 15 al 15— traen quince
-- dias repetidos.
--
-- Se comprueba AL IMPORTAR y no con una restriccion en la tabla, y la diferencia
-- importa: una restriccion de unicidad sobre la referencia castigaria tambien a
-- quien escriba «cheque 100» dos veces a mano, y ahi eso puede ser legitimo. El que
-- duplica es el importador, asi que el que se protege es el importador.
--
-- Repetido es: misma cuenta, misma fecha, mismo importe y misma referencia. Sin
-- referencia no hay forma de distinguir un movimiento repetido de dos movimientos
-- iguales el mismo dia —que tambien ocurre—, asi que sin ella no se descarta nada.

-- -----------------------------------------------------------------------------
-- Materializa las filas de un lote como movimientos del banco.
--
-- Devuelve cuantos entraron. Los repetidos NO son un error: se saltan y se cuentan,
-- porque solapar dos extractos es lo normal y fallar entero por eso obligaria a
-- recortar la hoja a mano.
create or replace function materializar_movimientos_banco(p_lote uuid, p_persona uuid)
returns int
language plpgsql as $$
declare
  l    record;
  f    record;
  cta  text;
  mon  moneda;
  n    int := 0;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;

  -- La cuenta y la moneda pueden venir columna a columna; si no vienen, son las del
  -- banco en bolivares, que es la cuenta que tiene toda empresa. Un extracto es de
  -- UNA cuenta, asi que lo normal es que no vengan.
  for f in
    select fc.fila,
           leer_fecha(fc.celdas[(select columna from mapeo_columna m
                                  where m.lote_id = p_lote and m.campo = 'fecha')],
                      (select formato from mapeo_columna m
                        where m.lote_id = p_lote and m.campo = 'fecha')) as fecha,
           leer_numero(fc.celdas[(select columna from mapeo_columna m
                                   where m.lote_id = p_lote and m.campo = 'monto')],
                       (select formato from mapeo_columna m
                         where m.lote_id = p_lote and m.campo = 'monto')) as monto,
           btrim(coalesce(fc.celdas[(select columna from mapeo_columna m
                                      where m.lote_id = p_lote and m.campo = 'descripcion')], '')) as descripcion,
           nullif(btrim(coalesce(fc.celdas[(select columna from mapeo_columna m
                                             where m.lote_id = p_lote and m.campo = 'referencia')], '')), '') as referencia,
           nullif(btrim(coalesce(fc.celdas[(select columna from mapeo_columna m
                                             where m.lote_id = p_lote and m.campo = 'cuenta')], '')), '') as cuenta,
           nullif(btrim(coalesce(fc.celdas[(select columna from mapeo_columna m
                                             where m.lote_id = p_lote and m.campo = 'moneda')], '')), '') as moneda
      from fila_cruda fc
     where fc.lote_id = p_lote
     order by fc.fila
  loop
    -- Un movimiento de cero no es un movimiento: la tabla lo rechaza, y con razon.
    continue when f.monto is null or f.monto = 0 or f.fecha is null;

    cta := coalesce(f.cuenta, cuenta_de(l.organizacion_id, 'banco'));
    mon := case when upper(coalesce(f.moneda, 'VES')) = 'USD' then 'USD' else 'VES' end::moneda;

    if f.referencia is not null and exists (
         select 1 from movimiento_banco mb
          where mb.organizacion_id = l.organizacion_id
            and mb.cuenta = cta and mb.fecha = f.fecha
            and mb.monto = round(f.monto, 2)
            and mb.referencia = f.referencia) then
      continue;
    end if;

    insert into movimiento_banco (organizacion_id, cuenta, fecha, monto, moneda,
                                  descripcion, referencia, lote_id)
    values (l.organizacion_id, cta, f.fecha, round(f.monto, 2), mon,
            nullif(f.descripcion, ''), f.referencia, p_lote);
    n := n + 1;
  end loop;

  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 'confirmar_lote' otra vez, con el tercer destino. Se reemplaza entera para que el
-- reparto siga leyendose de un vistazo.
create or replace function confirmar_lote(p_lote uuid, p_persona uuid)
returns int
language plpgsql as $$
declare
  l     record;
  malas int;
  n     int;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.estado <> 'validado' then
    raise exception 'Hay que validar el lote antes de confirmarlo. Está en "%".', l.estado;
  end if;

  select count(*) into malas from validacion_fila where lote_id = p_lote and not ok;
  if malas > 0 then
    raise exception 'El lote tiene % fila(s) con error. Corrígelas: una carga a medias '
      'es peor que ninguna.', malas;
  end if;

  if l.destino = 'facturas_recibidas' then
    n := materializar_facturas_recibidas(p_lote, p_persona);
    perform asentar_lote(p_lote, p_persona);
  elsif l.destino = 'facturas_emitidas' then
    n := materializar_facturas_emitidas(p_lote, p_persona);
    perform asentar_lote_ventas(p_lote, p_persona);
  elsif l.destino = 'movimientos_banco' then
    -- Y aqui NO se asienta. Ver la explicacion de arriba: el extracto no es el libro.
    n := materializar_movimientos_banco(p_lote, p_persona);
  else
    n := 0;
  end if;

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return greatest(n, (select count(*)::int from fila_cruda where lote_id = p_lote));
end $$;

-- -----------------------------------------------------------------------------
-- Revertir un lote del banco: se borran los movimientos que NADIE ha conciliado.
--
-- Los conciliados no se tocan y se dice cuantos quedaron: borrar un movimiento ya
-- casado dejaria un cobro apuntando al vacio, y eso no se arregla solo.
create or replace function revertir_lote(p_lote uuid, p_persona uuid, p_motivo text)
returns int
language plpgsql as $$
declare
  a      record;
  n      int := 0;
  quedan int;
begin
  for a in select id from asiento
            where origen_tipo = 'importacion_excel' and origen_id = p_lote
              and reversa_a is null
              and not exists (select 1 from asiento r where r.reversa_a = asiento.id)
  loop
    perform reversar_asiento(a.id, p_persona, p_motivo);
    n := n + 1;
  end loop;

  select count(*) into quedan from movimiento_banco
   where lote_id = p_lote and conciliado_en is not null;
  delete from movimiento_banco where lote_id = p_lote and conciliado_en is null;
  if quedan > 0 then
    update lote_importacion
       set nota = p_motivo || ' · ' || quedan || ' movimiento(s) ya conciliado(s) NO se borraron'
     where id = p_lote;
  end if;

  update lote_importacion
     set estado = 'revertido', revertido_en = now(),
         nota = coalesce(nota, p_motivo)
   where id = p_lote;
  return n;
end $$;
