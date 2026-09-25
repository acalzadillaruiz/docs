-- GPS Nexus · emitir la factura
--
-- Hasta aqui se cobraba contra la valuacion. Falta el documento que el cliente
-- necesita para pagar y que la ley exige que exista: la factura, con su numero y su
-- numero de control.
--
-- El correlativo lo pone la BASE DE DATOS, no una persona. Un correlativo llevado a
-- mano acaba con huecos o repetido, y las dos cosas son un problema con el SENIAT —
-- un hueco hay que justificarlo y un repetido invalida las dos facturas. Aqui se
-- calcula dentro de la misma transaccion que crea la factura, asi que dos personas
-- facturando a la vez no pueden sacar el mismo numero.
--
-- Lo que NO hace: no genera un asiento nuevo. La cuenta por cobrar ya nacio con el
-- asiento de la valuacion. Emitir la factura no mueve dinero: le pone nombre fiscal
-- a lo que ya estaba. Generar otro asiento aqui duplicaria el ingreso, que es el
-- error clasico de quien ata la factura a la contabilidad por el sitio equivocado.

/**
 * El siguiente numero de factura emitida de la organizacion.
 *
 * Una sola serie, correlativa y sin huecos, que es lo que se declara. El numero de
 * control va aparte y con su propio formato: son dos cosas distintas y la ley pide
 * las dos.
 */
create or replace function siguiente_factura(p_org uuid) returns text
language plpgsql as $$
declare n int;
begin
  -- 'for update' sobre la organizacion: dos personas facturando a la vez esperan una
  -- a la otra en vez de sacar el mismo numero. Sin esto, el correlativo se repite el
  -- dia que dos personas cierran el mes a la vez, que es justo cuando pasa.
  perform 1 from organizacion where id = p_org for update;

  select coalesce(max(numero::bigint), 0) + 1 into n
    from documento_fiscal
   where organizacion_id = p_org and sentido = 'emitido' and tipo = 'factura'
     and numero ~ '^[0-9]+$';
  return lpad(n::text, 8, '0');
end $$;

create or replace function siguiente_control(p_org uuid, p_fecha date) returns text
language plpgsql as $$
declare
  serie text := '00-' || to_char(p_fecha, 'YY');
  n     int;
begin
  select coalesce(max(substring(numero_control from 7)::int), 0) + 1 into n
    from documento_fiscal
   where organizacion_id = p_org and sentido = 'emitido'
     and numero_control like serie || '%';
  return serie || lpad(n::text, 8, '0');
end $$;

/**
 * Emite la factura de una valuacion aprobada.
 *
 * Se niega si la valuacion no esta aprobada, si ya tiene factura, o si tiene alguna
 * objecion sin responder. Esa ultima no es formalismo: facturar algo que el cliente
 * discutio por escrito es como se pierde una discusion antes de empezarla, y ya lo
 * impedia un disparador. Aqui se dice antes y con nombre.
 */
create or replace function emitir_factura(p_valuacion uuid, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  v    record;
  ct   record;
  hoja record;
  doc  uuid;
  sin  int;
begin
  select * into v from valuacion where id = p_valuacion;
  if v is null then raise exception 'La valuacion % no existe', p_valuacion; end if;
  if v.estado <> 'aprobada' then
    raise exception 'Solo se factura una valuacion aprobada. Esta en "%".', v.estado;
  end if;
  if v.documento_id is not null then
    raise exception 'Esa valuacion ya tiene factura. Para corregirla, emite una nota de credito.';
  end if;

  select count(*) into sin from objecion
   where valuacion_id = p_valuacion and respondida_en is null;
  if sin > 0 then
    raise exception 'Esa valuacion tiene % objecion(es) sin responder. Facturar algo que '
      'el cliente discutio por escrito es como se pierde una discusion antes de empezarla.', sin;
  end if;

  select * into ct from contrato where id = v.contrato_id;

  -- La base y el IVA salen de la hoja de la valuacion, que ya esta calculada y
  -- probada. Volver a calcularlos aqui seria tener dos verdades sobre el mismo
  -- importe, y la que se equivocara seria siempre la de la factura.
  -- La hoja devuelve una fila por concepto; se sacan las dos que hacen la factura.
  select
    max(monto) filter (where clave = 'valuacion.obra') as obra,
    max(monto) filter (where clave = 'valuacion.iva')  as iva
    into hoja
    from hoja_valuacion(p_valuacion);
  if hoja.obra is null then
    raise exception 'La hoja de la valuacion % no devuelve la obra', p_valuacion;
  end if;

  doc := gen_random_uuid();
  insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                                contraparte_id, fecha, contrato_id,
                                base_ves, base_usd, alicuota_iva_id, iva_ves, iva_usd,
                                tasa_id, registrado_por)
  select doc, v.organizacion_id, 'emitido', 'factura',
         siguiente_factura(v.organizacion_id),
         siguiente_control(v.organizacion_id, current_date),
         ct.cliente_id, current_date, v.contrato_id,
         case when v.moneda = 'VES' then hoja.obra else round(hoja.obra * t.ves_por_usd, 2) end,
         case when v.moneda = 'USD' then hoja.obra else round(hoja.obra / t.ves_por_usd, 2) end,
         v.alicuota_iva_id,
         case when v.moneda = 'VES' then hoja.iva else round(hoja.iva * t.ves_por_usd, 2) end,
         case when v.moneda = 'USD' then hoja.iva else round(hoja.iva / t.ves_por_usd, 2) end,
         v.tasa_id, p_persona
    from tasa_bcv t where t.id = v.tasa_id;

  update valuacion set documento_id = doc, estado = 'facturada' where id = p_valuacion;
  return doc;
end $$;
