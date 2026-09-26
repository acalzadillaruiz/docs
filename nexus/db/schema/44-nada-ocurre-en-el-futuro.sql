-- GPS Nexus · un hito no ocurre mañana
--
-- El avance de un renglon sale de los hitos verificados. Es la tesis del producto, esta
-- escrita en la pantalla —«no hay ninguna casilla donde escribirlo»— y se contestaba en dos
-- sitios con **dos cifras distintas**:
--
--   * La pantalla del RENGLON suma los pesos de sus propios hitos, sin mirar fechas. Lo hace
--     asi a proposito, y su comentario lo explica: si pidiera el total por otro lado podria
--     contradecir a la lista que esta ensenando.
--   * La pantalla del CONTRATO llama a `avance_renglon`, que solo cuenta los hitos con
--     `ocurrido_en <= hoy` — porque un hito que no ha ocurrido no es avance.
--
-- Las dos reglas son correctas. Se separan solo cuando hay un hito **verificado con fecha de
-- manana**, que es una contradiccion: verificado quiere decir que hay un papel que prueba que
-- paso, y no puede haber pasado un dia que no ha llegado.
--
-- Y existia. La empresa de muestra vivia en marzo de 2027 —ano y medio en el futuro—, asi que
-- TODOS sus hitos estaban «verificados» sin haber ocurrido. Resultado: la pantalla del
-- contrato ensenaba **0 %** en los cuatro renglones de cada contrato, al lado de un enlace
-- que llevaba a una pantalla que decia 10 % verificado y 55 % declarado. La cifra de la que
-- va el producto entero, en blanco, en la instantanea publicada.
--
-- El calendario de la muestra ya vive en el presente. Esto es lo que impide que vuelva: la
-- fecha en que algo ocurrio no puede ser posterior a hoy. Las fechas de PREVISION —
-- `planificada`, `pronosticada`— no se tocan: esas existen justamente para hablar del futuro.
--
-- Va en un disparador y no en un `check`: una restriccion de columna no puede llamar a
-- `current_date`, porque no es inmutable. Y se comprueba tambien al actualizar, que es por
-- donde entraba en la muestra —los hitos se creaban sin fecha y se les ponia despues.

create or replace function hito_no_ocurre_manana() returns trigger
language plpgsql as $$
begin
  if new.ocurrido_en is not null and new.ocurrido_en > current_date then
    raise exception 'El hito "%" dice haber ocurrido el %, que todavía no ha llegado. Para '
      'una fecha prevista está «planificada»; «ocurrió» es para lo que ya pasó.',
      new.nombre_es, new.ocurrido_en;
  end if;
  return new;
end $$;

drop trigger if exists hito_sin_futuro on hito;
create trigger hito_sin_futuro
  before insert or update of ocurrido_en on hito
  for each row execute function hito_no_ocurre_manana();
