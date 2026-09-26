-- GPS Nexus · un asiento sin una sola linea
--
-- La regla 1 de la contabilidad de este producto dice, desde el primer archivo: «un
-- asiento no cuadra -> la base de datos lo rechaza. No existe asiento descuadrado.» Y es
-- verdad. Lo que la comprobacion NO dice es nada sobre un asiento que no tiene ninguna
-- linea, y por dos razones que se suman:
--
--   1. `verificar_cuadre` es un disparador sobre `partida`. Si no entra ninguna partida,
--      no se ejecuta NUNCA. No es que devuelva que cuadra: es que no se le pregunta.
--   2. Y si se le preguntara, diria que cuadra: la suma de cero filas es cero, y cero es
--      igual a cero.
--
-- **Cuadrar no prueba nada cuando hay varias formas de cuadrar**, y la de no tener nada
-- dentro es la peor de todas. Un asiento vacio es peor que uno descuadrado: uno
-- descuadrado se ve y se arregla; uno vacio se cuela con su numero correlativo, y en un
-- libro donde nada se edita y nada se borra queda para siempre. La unica forma de
-- quitarlo es reversarlo, y reversar la nada deja DOS asientos que no dicen nada.
--
-- Lo encontro la base de muestra, que tenia VEINTISEIS, con el nombre de contratos que
-- no existen. Estaban en la pantalla del libro diario, que es la pantalla con la que se
-- ensena la fase que va primera.
--
-- Se pide UNA linea, no dos, porque una es la condicion que faltaba: en cuanto hay una,
-- la regla del cuadre obliga a la segunda —una sola linea no puede sumar cero, porque
-- `monto_no_cero` prohibe la partida de importe cero. Pedir dos aqui seria decir la
-- misma cosa en dos sitios, y el dia que cambie una se quedaria la otra.
--
-- Va diferido al final de la transaccion a proposito: el asiento se inserta ANTES que
-- sus partidas —tiene que existir para que apunten a el—, asi que durante un instante
-- todo asiento esta vacio. Lo que no puede es seguir vacio cuando se confirma.

create or replace function exigir_lineas() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from partida where asiento_id = new.id) then
    raise exception 'El asiento % no tiene ninguna línea. Un asiento vacío cuadra por no '
      'tener nada dentro, y queda en el libro para siempre con su número.', new.numero;
  end if;
  return null;
end $$;

drop trigger if exists asiento_tiene_lineas on asiento;
create constraint trigger asiento_tiene_lineas
  after insert on asiento
  deferrable initially deferred
  for each row execute function exigir_lineas();
