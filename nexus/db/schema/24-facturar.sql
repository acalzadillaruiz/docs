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

-- Por que se emitio una nota. Se exigia el motivo y NO SE GUARDABA EN NINGUN SITIO,
-- que es peor que no exigirlo: da la impresion de que queda escrito. Una nota sin
-- motivo guardado no explica nada, que es justo para lo que sirve una nota.
alter table documento_fiscal add column if not exists motivo text;

alter table documento_fiscal drop constraint if exists nota_tiene_motivo;
alter table documento_fiscal add constraint nota_tiene_motivo check (
  tipo = 'factura' or btrim(coalesce(motivo,'')) <> ''
);

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

-- -----------------------------------------------------------------------------
-- Notas de credito y debito.
--
-- Es lo unico que permite corregir una factura ya emitida, y corregir facturas pasa
-- todos los meses: el cliente rechaza una linea, se factura de mas, cambia la tasa.
--
-- Una factura emitida NO SE MODIFICA Y NO SE BORRA. Ya estaba declarada, ya la tiene
-- el cliente, y en Venezuela ya lleva su numero de control. Se corrige con una nota
-- que apunta a ella y deja las dos en el libro. Eso no es burocracia: es que dentro
-- de dos anos hay que poder explicar por que el importe cambio, y una factura
-- reescrita no explica nada.
--
-- Credito o debito, y la diferencia importa: la de credito RESTA (se facturo de mas,
-- se devuelve algo, el cliente rechazo una linea) y la de debito SUMA (se facturo de
-- menos, hay un recargo). Confundirlas invierte el signo de la declaracion del mes.

create or replace function emitir_nota(
  p_factura uuid, p_tipo tipo_documento, p_base numeric, p_motivo text, p_persona uuid
) returns uuid
language plpgsql as $$
declare
  f    record;
  pct  numeric(5,2);
  iva  numeric(20,2);
  nota uuid;
begin
  if p_tipo not in ('nota_credito','nota_debito') then
    raise exception 'Esto emite notas. Para una factura hay otra funcion.';
  end if;
  if p_base is null or p_base <= 0 then
    raise exception 'La nota tiene que llevar un importe mayor que cero.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Una nota sin motivo no explica nada, que es justo para lo que sirve.';
  end if;

  select * into f from documento_fiscal where id = p_factura;
  if f is null then raise exception 'La factura % no existe', p_factura; end if;
  if f.tipo <> 'factura' then
    raise exception 'Una nota corrige una factura, no otra nota.';
  end if;
  if f.sentido <> 'emitido' then
    raise exception 'Esto corrige facturas emitidas. Una recibida la corrige el proveedor.';
  end if;

  -- Una nota de credito no puede devolver mas de lo que se facturo, contando las que
  -- ya se emitieron antes. Devolver de mas deja la base imponible del mes en negativo,
  -- y una base negativa no significa nada en una declaracion.
  if p_tipo = 'nota_credito' then
    if p_base > f.base_ves - coalesce((
         select sum(n.base_ves) from documento_fiscal n
          where n.afecta_a = p_factura and n.tipo = 'nota_credito'), 0) + 0.005 then
      raise exception 'Esa nota devuelve mas de lo que queda facturado.';
    end if;
  end if;

  select porcentaje into pct from alicuota_iva where id = f.alicuota_iva_id;
  iva := round(p_base * coalesce(pct, 0) / 100, 2);

  nota := gen_random_uuid();
  insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                                contraparte_id, fecha, contrato_id, afecta_a,
                                base_ves, base_usd, alicuota_iva_id, iva_ves, iva_usd,
                                tasa_id, motivo, registrado_por)
  select nota, f.organizacion_id, 'emitido', p_tipo,
         siguiente_factura(f.organizacion_id),
         siguiente_control(f.organizacion_id, current_date),
         f.contraparte_id, current_date, f.contrato_id, p_factura,
         p_base, round(p_base / t.ves_por_usd, 2), f.alicuota_iva_id,
         iva, round(iva / t.ves_por_usd, 2), f.tasa_id, btrim(p_motivo), p_persona
    from tasa_bcv t where t.id = f.tasa_id;

  return nota;
end $$;

/**
 * Lo que queda vivo de una factura despues de sus notas.
 *
 * No se guarda en ningun sitio: se resta, igual que el saldo de una valuacion. Un
 * importe guardado es un importe que algun dia dejara de ser cierto.
 */
create or replace function neto_facturado(p_factura uuid)
returns table (base numeric(20,2), iva numeric(20,2), total numeric(20,2))
language sql stable as $$
  select
    f.base_ves
      - coalesce((select sum(n.base_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_credito'), 0)
      + coalesce((select sum(n.base_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_debito'), 0),
    f.iva_ves
      - coalesce((select sum(n.iva_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_credito'), 0)
      + coalesce((select sum(n.iva_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_debito'), 0),
    (f.base_ves + f.iva_ves)
      - coalesce((select sum(n.base_ves + n.iva_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_credito'), 0)
      + coalesce((select sum(n.base_ves + n.iva_ves) from documento_fiscal n
                   where n.afecta_a = f.id and n.tipo = 'nota_debito'), 0)
    from documento_fiscal f where f.id = p_factura
$$;
