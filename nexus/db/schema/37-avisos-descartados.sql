-- GPS Nexus · un aviso sobre algo que ya no pasa no se manda
--
-- `estado_aviso` declara cuatro estados —pendiente, enviado, fallido, descartado— y
-- `descartado` no lo ponia nadie. Lo encontro un barrido nuevo: valores de enum que la
-- aplicacion nunca escribe. Es la misma forma del agujero de la semana: `estado_contrato`
-- declaraba cinco estados y se llegaba a dos.
--
-- Y aqui el valor que faltaba tapaba un fallo concreto. El circuito:
--
--   1. Se presenta una valuacion. Un disparador encola el aviso «hay algo esperando tu
--      firma» para el cliente. Queda PENDIENTE.
--   2. El bucle de avisos lo manda en la siguiente pasada, unos minutos despues.
--   3. Si entre una cosa y otra la valuacion se anula —una presentacion equivocada que se
--      corrige en el momento, que es justo cuando pasa—, se liberan sus hitos y no se
--      toca el aviso.
--   4. El correo sale igual. El cliente recibe «hay algo esperando tu firma» de una
--      valuacion que ya no existe, y entra al portal a buscarla.
--
-- Anular ya liberaba los hitos: eso estaba pensado. Lo que no estaba era que el aviso ya
-- encolado dejara de tener sentido.

create or replace function descartar_avisos_sin_asunto() returns trigger
language plpgsql security definer as $$
begin
  -- Dejo de estar presentada: no hay nada esperando firma, diga lo que diga la cola. Se
  -- descarta solo ese tipo de aviso, porque el que el disparador de al lado acaba de
  -- encolar para el estado NUEVO si hay que mandarlo.
  if old.estado = 'presentada' and new.estado <> 'presentada' then
    update aviso
       set estado = 'descartado',
           -- `ultimo_error` es donde vive el por que de no haberse mandado. Aqui no es un
           -- error: es una decision, y decirlo importa para quien mire esta tabla despues.
           ultimo_error = 'descartado: la valuacion paso a ' || new.estado
     where tipo = 'valuacion_presentada' and sobre_id = new.id and estado = 'pendiente';
  end if;

  -- Y una valuacion anulada no tiene ningun aviso que merezca la pena mandar.
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update aviso
       set estado = 'descartado',
           ultimo_error = 'descartado: la valuacion se anulo'
     where sobre_id = new.id and estado = 'pendiente';
  end if;

  return new;
end $$;

-- El nombre importa: PostgreSQL dispara los de fila en orden alfabetico, y este tiene que
-- ir DESPUES de `valuacion_avisa`. Al contrario, se descartaria el aviso del estado nuevo
-- que aquel acaba de encolar.
drop trigger if exists valuacion_descarta_avisos on valuacion;
create trigger valuacion_descarta_avisos
  after update of estado on valuacion
  for each row execute function descartar_avisos_sin_asunto();
