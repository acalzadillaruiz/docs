-- GPS Nexus · el mantenimiento que nadie llamaba
--
-- Habia dos funciones escritas, probadas y comentadas con «se llama desde una tarea
-- periodica»... y no habia ninguna tarea periodica que las llamara:
--
--   * caducar_sesiones()        — cierra las sesiones vencidas
--   * limpiar_peticiones_sso()  — borra las peticiones de entrada por SSO sin usar
--
-- Septima vez que aparece la misma forma: la maquina montada y sin puerta. Y la mas
-- silenciosa de todas, porque no rompe nada — solo deja tres tablas creciendo para
-- siempre en un sistema pensado para correr anos sin que nadie lo mire.
--
-- La tercera tabla la encontre al ir a poner la puerta: 'intento_acceso' guarda un
-- correo por cada intento de entrada, con exito o sin el, y no la limpia nadie. El
-- freno solo mira la ultima hora; lo demas es un historial que sirve para investigar
-- un incidente reciente y, pasado un mes, es una lista de correos que crece sola. No
-- se guarda «por si acaso» lo que no se va a mirar.
--
-- Por que una sola funcion y no tres tareas: tres cosas que instalar son tres cosas
-- que se pueden olvidar de instalar, y este archivo existe precisamente porque se
-- olvidaron dos. Una llamada, un numero por tabla, y se ve de un vistazo si esta
-- corriendo.

create or replace function limpiar_intentos_acceso(p_dias int default 30)
returns int
language plpgsql as $$
declare n int;
begin
  delete from intento_acceso where ocurrido_en < now() - (interval '1 day' * p_dias);
  get diagnostics n = row_count;
  return n;
end $$;

-- Una pasada de mantenimiento. Devuelve que hizo, para que el registro pueda decir
-- algo distinto de «ok».
create or replace function mantenimiento(
  p_dias_sso int default 2, p_dias_intentos int default 30)
returns table (sesiones int, peticiones int, intentos int)
language plpgsql as $$
begin
  sesiones   := caducar_sesiones();
  peticiones := limpiar_peticiones_sso(p_dias_sso);
  intentos   := limpiar_intentos_acceso(p_dias_intentos);
  return next;
end $$;
