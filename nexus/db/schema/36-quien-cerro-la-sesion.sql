-- GPS Nexus · quien echo a alguien del sistema queda escrito
--
-- `sesion.cerrada_por` estaba declarada desde el primer dia y no la escribia nadie. Lo
-- encontro el mismo barrido de columnas que nadie nombra que destapo `contrato.fin_real`.
--
-- Y no es una columna de adorno. Cuando se da de baja a una persona, el disparador
-- `persona_desactivada` le cierra las sesiones abiertas: eso echa a alguien del sistema en
-- el momento, quiza en mitad de algo. Quedaba escrito el motivo —«persona desactivada»— y
-- no quien lo habia ordenado. Para la unica pregunta que se hace despues de un incidente,
-- «quien la echo y cuando», la respuesta estaba a medias.
--
-- `persona_actual()` ya existe y ya la pone la aplicacion en cada transaccion, asi que el
-- dato estaba ahi sin recogerse. Cuando no hay nadie —una tarea de mantenimiento, o una
-- carga con `set local role none`— se queda nulo, y eso tambien es la verdad: no lo ordeno
-- ninguna persona.

create or replace function cerrar_sesiones_de(p_persona uuid, p_motivo text) returns int
language plpgsql as $$
declare n int;
begin
  update sesion
     set cerrada_en = now(),
         motivo_cierre = p_motivo,
         -- Quien lo pidio. Nulo cuando no lo pidio nadie, y eso es un dato, no un hueco.
         cerrada_por = persona_actual()
   where persona_id = p_persona and cerrada_en is null;
  get diagnostics n = row_count;
  return n;
end $$;
