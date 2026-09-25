-- GPS Nexus · importar el historico de facturas EMITIDAS
--
-- Por que existe, y por que es distinto de emitir una factura:
--
--   El dia que esto se enciende, la empresa no empieza de cero. Lleva anos
--   facturando, y ese historico esta en una hoja. Sin el, el libro de ventas empieza
--   vacio, el IVA declarado no cuadra con nada de lo que hay dentro, y comparar este
--   mes con el mismo mes del ano pasado es imposible — que es justo la comparacion
--   que se quiere hacer.
--
--   Por eso el numero NO lo pone la base de datos aqui, al reves que en
--   `siguiente_factura`. Estas facturas YA existen, ya las tiene el cliente y ya se
--   declararon: inventarles un correlativo nuevo seria crear una segunda version de
--   un documento que ya esta en la calle.
--
-- Lo que si se comprueba, y es lo que hace que esto no ensucie la contabilidad:
--
--   - El cliente tiene que estar dado de alta. Crear empresas desde una hoja es como
--     se acaba con el mismo cliente tres veces escrito de tres maneras.
--   - Una factura que ya esta dentro no entra dos veces. Reimportar una hoja
--     corregida es lo normal, no un error.
--   - Y NO se importa una factura que ya nacio de una valuacion de este sistema: esa
--     ya tiene su cuenta por cobrar en el libro, y meterla otra vez duplicaria el
--     ingreso. Es el error clasico de cargar el historico encima de lo vivo.

/**
 * Los clientes de la hoja que no estan dados de alta.
 *
 * Se pregunta ANTES de importar nada, por lo mismo que con los proveedores: a mitad
 * de la carga ya hay media hoja dentro.
 */
create or replace function clientes_desconocidos(p_lote uuid)
returns table (rif text, nombre text, filas int)
language sql stable as $$
  with celdas as (
    select f.fila,
           btrim(f.celdas[(select columna from mapeo_columna m
                            where m.lote_id = p_lote and m.campo = 'cliente')]) as rif,
           btrim(coalesce(f.celdas[(select columna from mapeo_columna m
                            where m.lote_id = p_lote and m.campo = 'cliente_nombre')], '')) as nombre
      from fila_cruda f where f.lote_id = p_lote
  )
  select c.rif, max(c.nombre), count(*)::int
    from celdas c
   where c.rif <> ''
     and not exists (select 1 from organizacion o where o.rif = c.rif)
   group by c.rif
   order by 3 desc
$$;

/**
 * Crea los documentos de una hoja de facturas emitidas.
 *
 * El importe en dolares no se pide en la hoja: se calcula con la tasa del dia de la
 * factura. Pedirlo seria invitar a que alguien ponga la tasa de hoy en una factura
 * de hace tres anos, y entonces el ingreso en divisas de ese ano deja de significar
 * nada — que es exactamente para lo que se carga el historico.
 */
create or replace function materializar_facturas_emitidas(p_lote uuid, p_persona uuid)
returns int
language plpgsql as $$
declare
  l       record;
  r       record;
  col     jsonb;
  faltan  text;
  n       int := 0;
  v_tasa  uuid;
  v_ves   numeric(20,2);
  v_iva   numeric(20,2);
  v_ctr   uuid;
  v_cli   uuid;
  v_num   text;
  v_fecha date;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.destino <> 'facturas_emitidas' then return 0; end if;

  select string_agg(rif, ', ') into faltan from clientes_desconocidos(p_lote);
  if faltan is not null then
    raise exception 'Estos clientes no están dados de alta: %. Créalos antes: crear '
      'empresas desde una hoja es como se acaba con el mismo cliente tres veces.', faltan;
  end if;

  select jsonb_object_agg(campo, jsonb_build_array(columna, coalesce(formato,'')))
    into col from mapeo_columna where lote_id = p_lote;

  for r in select * from fila_cruda where lote_id = p_lote order by fila loop
    v_fecha := leer_fecha(r.celdas[(col->'fecha'->>0)::int], col->'fecha'->>1);
    v_ves   := leer_numero(r.celdas[(col->'base'->>0)::int], col->'base'->>1);
    v_iva   := case when col ? 'iva'
                    then coalesce(leer_numero(r.celdas[(col->'iva'->>0)::int], col->'iva'->>1), 0)
                    else 0 end;
    v_num   := btrim(r.celdas[(col->'numero'->>0)::int]);

    -- Una fecha que no se entiende no entra «como se pueda»: se para. Dejarla pasar
    -- pone un documento fiscal con fecha imposible en el libro, y eso no se ve hasta
    -- que hay que declarar.
    if v_fecha is null then
      raise exception 'La fecha de la factura % no se entiende. Revisa el formato de '
        'esa columna en el mapeo.', coalesce(nullif(btrim(
          r.celdas[(col->'numero'->>0)::int]), ''), '(sin número)');
    end if;

    select id into v_tasa from tasa_bcv
     where vigente_el <= v_fecha order by vigente_el desc limit 1;
    if v_tasa is null then
      raise exception 'No hay tasa del BCV para el %, que es la fecha de la factura %',
        v_fecha, v_num;
    end if;

    select id into v_cli from organizacion
     where rif = btrim(r.celdas[(col->'cliente'->>0)::int]);

    v_ctr := null;
    if col ? 'contrato' then
      select id into v_ctr from contrato
       where organizacion_id = l.organizacion_id
         and codigo = btrim(r.celdas[(col->'contrato'->>0)::int]);
    end if;

    insert into documento_fiscal (organizacion_id, sentido, tipo, numero, numero_control,
                                  contraparte_id, fecha, contrato_id,
                                  base_ves, base_usd, iva_ves, iva_usd, tasa_id,
                                  registrado_por)
    select l.organizacion_id, 'emitido', 'factura', v_num,
           case when col ? 'control' then nullif(btrim(r.celdas[(col->'control'->>0)::int]), '') end,
           v_cli, v_fecha, v_ctr,
           v_ves, round(v_ves / t.ves_por_usd, 2),
           v_iva, round(v_iva / t.ves_por_usd, 2),
           v_tasa, p_persona
      from tasa_bcv t where t.id = v_tasa
    on conflict (organizacion_id, sentido, tipo, numero) do nothing;

    n := n + 1;
  end loop;
  return n;
end $$;

/**
 * Asienta el historico importado: cuenta por cobrar contra ingreso y IVA debito.
 *
 * La cuenta de ingreso sale del TIPO del contrato cuando la fila lo trae, no de una
 * sola cuenta de "ingresos": saber cual de los cinco tipos de contrato deja dinero
 * es media decision, y meterlo todo en una cuenta la borra.
 *
 * Y no se asienta lo que ya tiene asiento. Una factura que nacio de una valuacion de
 * este sistema ya puso su cuenta por cobrar en el libro; volver a asentarla
 * duplicaria el ingreso, que es el error clasico de cargar el historico encima de lo
 * que ya esta vivo.
 */
create or replace function asentar_lote_ventas(p_lote uuid, p_persona uuid) returns int
language plpgsql as $$
declare
  l     record;
  d     record;
  a_id  uuid;
  org   uuid;
  cta   text;
  linea int;
  n     int := 0;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.destino <> 'facturas_emitidas' then return 0; end if;
  org := l.organizacion_id;

  for d in
    select df.* from documento_fiscal df
     where df.organizacion_id = org
       and df.sentido = 'emitido' and df.tipo = 'factura'
       and df.asiento_id is null
       and exists (select 1 from fila_cruda fc
                    where fc.lote_id = p_lote
                      and btrim(fc.celdas[(select columna from mapeo_columna
                                            where lote_id = p_lote and campo = 'numero')])
                          = df.numero)
     order by df.fecha, df.numero
  loop
    a_id := gen_random_uuid();

    cta := null;
    if d.contrato_id is not null then
      select cuenta_ingreso_de(org, c.tipo) into cta from contrato c where c.id = d.contrato_id;
    end if;
    if cta is null then cta := cuenta_de(org, 'ingreso_obra'); end if;

    insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                         descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
    values (a_id, org, siguiente_asiento(org), d.fecha,
            extract(year from d.fecha)::int, extract(month from d.fecha)::int,
            'Factura emitida ' || d.numero, 'Issued invoice ' || d.numero,
            'factura_emitida', d.id, p_persona);

    linea := 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                         tasa_id, contrato_id)
    values (a_id, linea, org, cuenta_de(org,'cxc'),
            d.base_ves + d.iva_ves, d.base_usd + d.iva_usd, d.tasa_id, d.contrato_id);

    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                         tasa_id, contrato_id)
    values (a_id, linea, org, cta, -d.base_ves, -d.base_usd, d.tasa_id, d.contrato_id);

    if d.iva_ves <> 0 then
      linea := linea + 1;
      insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                           tasa_id)
      values (a_id, linea, org, cuenta_de(org,'iva_debito'), -d.iva_ves, -d.iva_usd, d.tasa_id);
    end if;

    update documento_fiscal set asiento_id = a_id where id = d.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 'confirmar_lote' otra vez, ahora repartiendo segun a donde vaya la hoja. Se
-- reemplaza entera en vez de anadir un if suelto para que el reparto se lea de un
-- vistazo: cuando entre el tercer destino, se vera aqui y no escondido.
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

  -- Lo que crea va ANTES de marcar el lote: si algo revienta, el lote sigue en
  -- 'validado' y se puede volver a intentar.
  if l.destino = 'facturas_recibidas' then
    n := materializar_facturas_recibidas(p_lote, p_persona);
    perform asentar_lote(p_lote, p_persona);
  elsif l.destino = 'facturas_emitidas' then
    n := materializar_facturas_emitidas(p_lote, p_persona);
    perform asentar_lote_ventas(p_lote, p_persona);
  else
    n := 0;
  end if;

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return greatest(n, (select count(*)::int from fila_cruda where lote_id = p_lote));
end $$;
