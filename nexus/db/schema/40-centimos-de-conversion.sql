-- GPS Nexus · el centimo que hacia imposible facturar
--
-- `asentar_valuacion` no podia asentar la primera valuacion de la muestra. Ni la
-- primera ni casi ninguna: la transaccion se caia al confirmar con «El asiento no cuadra
-- (VES 0.00, USD 0.01)». Un centimo de dolar. Con eso, el boton de facturar no funciona:
-- el cliente ve un error de base de datos y esa valuacion no se puede facturar nunca.
--
-- El motivo no es un fallo de cuentas. La hoja de la valuacion cuadra exacta en bolivares
-- —el neto ES la suma de las otras lineas, y ahi no sobra nada—, y la columna en dolares
-- es una CONVERSION: cada linea se convierte y se redondea a dos decimales por separado.
-- Redondear seis lineas por separado y sumarlas no da lo mismo que sumar y redondear una
-- vez. La diferencia es de centimos, siempre, y aparece o no segun los importes: por eso
-- pasaba las pruebas —sus cifras salen redondas— y reventaba con las de la muestra.
--
-- Lo tapaba, ademas, que la muestra escribia el asiento de la venta a mano, con dos
-- lineas. Dos lineas iguales y de signo contrario cuadran siempre. **El fixture hacia lo
-- que la aplicacion no hacia**, y lo que se miraba despues en el libro diario no probaba
-- que la aplicacion supiera asentar una venta. No la sabia asentar.
--
-- No es solo de las valuaciones. `asentar_cobro` convierte por separado el banco, el IGTF
-- y la cuenta por cobrar: un cobro en divisa con IGTF tiene el mismo centimo esperando. Y
-- lo mismo cualquier generador con mas de dos lineas de importes distintos. La unica parte
-- del producto que ya lo tenia resuelto es la caja chica, que calcula su contrapartida
-- SUMANDO las lineas en vez de convertir el total otra vez, y lo dice en un comentario
-- —alguien ya se dio de frente con esto y lo arreglo solo en su sitio.
--
-- Asi que se arregla en el sitio donde la regla vive, que es UNO: el control del cuadre.
-- Antes de rechazar, se pregunta si lo que sobra es el residuo de haber redondeado cada
-- linea. Si lo es, se absorbe; si no, se rechaza igual que siempre y con el mismo texto.
--
-- **Y la pregunta es estrecha a proposito, porque un control que perdona se convierte en
-- un control que no controla.** Solo se absorbe cuando:
--
--   1. UNA de las dos columnas cuadra EXACTA y la otra no. Un error de cuentas de verdad
--      descuadra las dos; redondear la conversion descuadra solo la convertida, porque la
--      otra es la que se escribio a mano y esa suma cero de verdad.
--   2. Lo que sobra no pasa de un centimo por linea, que es el maximo que puede aportar
--      redondear cada una. Un centimo mas que eso no es redondeo.
--   3. Y hay al menos dos lineas. Con una sola no hay conversion que cuadrar: hay un
--      asiento a medias.
--
-- Fuera de esas tres condiciones no se toca nada. Un descuadre tapado deja el libro
-- cuadrado y la cifra mal, que es peor que el libro descuadrado: el descuadrado se ve.
--
-- El centimo se pone sobre la linea MAS GRANDE, y sobre una sola. Sobre la mas grande
-- porque es donde un centimo es lo que menos significa. Sobre una sola porque repartirlo
-- entre varias cambia varias cifras para arreglar una, y luego no se sabe cual se movio.

create or replace function verificar_cuadre() returns trigger
language plpgsql as $$
declare
  a_id  uuid := coalesce(new.asiento_id, old.asiento_id);
  n     int;
  d_ves numeric(20,2);
  d_usd numeric(20,2);
  techo numeric(20,2);
  l     int;
begin
  select count(*), coalesce(sum(monto_ves),0), coalesce(sum(monto_usd),0)
    into n, d_ves, d_usd from partida where asiento_id = a_id;
  if d_ves = 0 and d_usd = 0 then return null; end if;

  techo := n * 0.01;
  if n >= 2 and (d_ves = 0) <> (d_usd = 0)
     and abs(d_ves) <= techo and abs(d_usd) <= techo then
    -- El desempate por numero de linea no es un detalle: sin el, dos lineas del mismo
    -- importe harian que el centimo cayera en una o en otra segun como le viniera al
    -- planificador, y el mismo asiento saldria distinto en dos bases iguales.
    select linea into l from partida
     where asiento_id = a_id
     order by abs(monto_ves) + abs(monto_usd) desc, linea
     limit 1;
    update partida set monto_ves = monto_ves - d_ves, monto_usd = monto_usd - d_usd
     where asiento_id = a_id and linea = l;
    return null;
  end if;

  -- El texto es el de siempre, palabra por palabra: hay pruebas que lo leen, y sobre todo
  -- es el que alguien va a buscar en el repositorio cuando le salga.
  raise exception 'El asiento % no cuadra (VES %, USD %)', a_id, d_ves, d_usd;
end $$;
