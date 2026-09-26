-- GPS Nexus · deshacer una carga, de verdad
--
-- 'revertir_lote' existia desde el principio y NO REVERSABA NADA. Buscaba los
-- asientos por 'origen_tipo = importacion_excel' y 'origen_id = <lote>', y esos
-- asientos no existen: los crea 'asentar_factura_proveedor', que los marca con su
-- origen de verdad —la factura— porque es lo correcto para el libro.
--
-- Asi que deshacer una carga marcaba el lote como «revertido» y dejaba la
-- contabilidad intacta. Eso es peor que no poder deshacer: la pantalla decia que la
-- carga estaba deshecha y el libro seguia cargado. Se descubrio al construir el
-- boton, que hasta ahora no existia en ninguna parte.
--
-- La causa de fondo: no habia forma de saber que documentos creo un lote. Se
-- adivinaba cruzando numeros contra las filas crudas. Ahora el documento lo dice.

alter table documento_fiscal add column if not exists lote_id uuid references lote_importacion(id);
create index if not exists documento_lote_ix on documento_fiscal (lote_id) where lote_id is not null;

-- Sella los documentos de un lote. Se llama justo despues de materializarlos, y
-- cruza por numero contra las filas crudas —que es lo mismo que ya hacia 'asentar_lote'
-- para encontrarlos— pero UNA sola vez y dejandolo escrito.
create or replace function sellar_lote(p_lote uuid) returns int
language plpgsql as $$
declare
  l   record;
  col int;
  n   int;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;

  select columna into col from mapeo_columna
   where lote_id = p_lote and campo = 'numero';
  if col is null then return 0; end if;

  update documento_fiscal df
     set lote_id = p_lote
   where df.organizacion_id = l.organizacion_id
     and df.lote_id is null
     and df.sentido = (case when l.destino = 'facturas_emitidas' then 'emitido'
                            else 'recibido' end)::sentido
     and exists (select 1 from fila_cruda fc
                  where fc.lote_id = p_lote
                    and btrim(fc.celdas[col]) = df.numero);
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 'revertir_lote', ahora buscando los asientos por donde de verdad estan.
--
-- Un asiento no se borra: se reversa. Los movimientos del banco si se borran, pero
-- solo los que nadie ha conciliado — borrar uno ya casado dejaria un cobro apuntando
-- al vacio, y eso no se arregla solo.
create or replace function revertir_lote(p_lote uuid, p_persona uuid, p_motivo text)
returns int
language plpgsql as $$
declare
  a      record;
  n      int := 0;
  quedan int;
  texto  text;
begin
  for a in
    select asi.id from asiento asi
     where asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
       and (
         -- Los que el propio lote genero con su id como origen, si alguna vez los hay.
         (asi.origen_tipo = 'importacion_excel' and asi.origen_id = p_lote)
         -- Y los de las facturas que creo este lote, que son los de verdad.
         or asi.origen_id in (select df.id from documento_fiscal df where df.lote_id = p_lote)
       )
     order by asi.numero
  loop
    perform reversar_asiento(a.id, p_persona, p_motivo);
    n := n + 1;
  end loop;

  select count(*) into quedan from movimiento_banco
   where lote_id = p_lote and conciliado_en is not null;
  delete from movimiento_banco where lote_id = p_lote and conciliado_en is null;

  -- La variable NO se llama 'nota': una variable con el mismo nombre que una columna
  -- hace que PostgreSQL no sepa a cual se refiere dentro del update, y el error
  -- —«column reference nota is ambiguous»— no dice donde esta.
  texto := p_motivo;
  if quedan > 0 then
    texto := texto || ' · ' || quedan || ' movimiento(s) ya conciliado(s) NO se borraron';
  end if;

  update lote_importacion
     set estado = 'revertido', revertido_en = now(), nota = texto
   where id = p_lote;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 'confirmar_lote' otra vez, sellando los documentos antes de asentarlos.
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
    perform sellar_lote(p_lote);
    perform asentar_lote(p_lote, p_persona);
  elsif l.destino = 'facturas_emitidas' then
    n := materializar_facturas_emitidas(p_lote, p_persona);
    perform sellar_lote(p_lote);
    perform asentar_lote_ventas(p_lote, p_persona);
  elsif l.destino = 'movimientos_banco' then
    -- El extracto no se asienta: no es el libro, es lo que hay que casar con el libro.
    n := materializar_movimientos_banco(p_lote, p_persona);
  else
    n := 0;
  end if;

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return greatest(n, (select count(*)::int from fila_cruda where lote_id = p_lote));
end $$;
