-- GPS Nexus · la alicuota de IVA no puede estar dos veces el mismo dia
--
-- `alicuota_iva` lleva un `id` propio, porque cada factura guarda a que alicuota se
-- acogio y esa referencia no se puede mover. Pero no tenia ninguna clave natural, y de
-- ahi salieron dos cosas:
--
--   1. El sembrador decia `on conflict do nothing` y NO hacia nada, porque sin una
--      restriccion unica que arbitre, lo unico con lo que puede chocar es la clave
--      primaria, que es un uuid nuevo cada vez. Diecisiete filas de
--      ('general', 16 %, 2026-01-01) en la base de pruebas.
--   2. Y lo que de verdad importa: los lectores buscan la alicuota con
--      `where clase = ... and vigente_desde <= fecha order by vigente_desde desc limit 1`.
--      Con dos filas del mismo dia, CUAL rige lo decide el orden en que el motor las
--      devuelve. Dos filas con porcentajes distintos harian que la misma factura, emitida
--      dos veces, llevara dos IVA diferentes sin que nada avisara.
--
-- Primero se limpian los duplicados que sobren y despues se pone el indice, en este
-- orden porque crear el indice sobre una tabla con duplicados falla y el migrador se
-- pararia dejando el esquema a medias.

-- Quien referencia a `alicuota_iva`, preguntado al catalogo y no recordado de memoria.
-- La primera version de este archivo miraba `documento_fiscal` y se olvido de
-- `valuacion`, y el borrado se estrello contra la clave ajena. Asi que ahora la lista se
-- comprueba: si alguien anade manana una tercera tabla que apunte aqui, esto se para y
-- lo dice, en vez de borrar una fila que alguien seguia usando.
do $$
declare
  quienes text;
begin
  select string_agg(c.conrelid::regclass::text, ', ' order by c.conrelid::regclass::text)
    into quienes
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'alicuota_iva'::regclass;

  if quienes is distinct from 'documento_fiscal, valuacion' then
    raise exception
      'Apuntan a alicuota_iva estas tablas: %. Este archivo se escribio para (documento_fiscal, valuacion): revisa el borrado de duplicados antes de seguir',
      quienes;
  end if;
end $$;

-- Se queda la fila mas usada de cada (clase, fecha) —y entre iguales, la de id menor,
-- para que el resultado no dependa del orden de lectura— y se borran las demas, pero
-- SOLO si no las usa nadie. Una alicuota referenciada no se borra nunca: la factura que
-- la apunta declara con que IVA se emitio.
with usos as (
  select a.id, a.clase, a.vigente_desde,
         (select count(*) from documento_fiscal d where d.alicuota_iva_id = a.id)
         + (select count(*) from valuacion v where v.alicuota_iva_id = a.id) as n
    from alicuota_iva a
), ordenadas as (
  select id, n, row_number() over (
           partition by clase, vigente_desde order by n desc, id) as puesto
    from usos
)
delete from alicuota_iva
 where id in (select id from ordenadas where puesto > 1 and n = 0);

-- Y si despues de limpiar sigue habiendo duplicados, es que dos filas del mismo dia
-- estan las dos en uso: eso no lo arregla un borrado y hay que mirarlo a mano.
do $$
declare
  cuantos int;
begin
  select count(*) into cuantos from (
    select 1 from alicuota_iva group by clase, vigente_desde having count(*) > 1) x;
  if cuantos > 0 then
    raise exception 'Quedan % (clase, fecha) de IVA con mas de una fila EN USO. Hay que decidir a mano cual rige antes de poner el indice unico', cuantos;
  end if;
end $$;

create unique index if not exists alicuota_iva_clase_desde_uq
  on alicuota_iva (clase, vigente_desde);
