-- GPS Nexus · el importador, atado a algo de verdad
--
-- 'confirmar_lote' marcaba el lote como confirmado y no creaba nada. Es decir: todo
-- el trabajo de leer la hoja, mapear las columnas y validar fila por fila terminaba
-- en un sello y en ningun asiento. Esto lo ata.
--
-- Se empieza por las FACTURAS DE PROVEEDOR, y no es una eleccion al azar: son la
-- mitad que hoy no esta en ninguna pantalla. Sin ellas no hay costo, sin costo no
-- hay margen, y sin margen las tres medidas del proyecto miden media realidad.
--
-- Dos reglas que valen mas que la comodidad:
--
--   1. UN PROVEEDOR QUE NO EXISTE NO SE CREA SOLO. La hoja dice el RIF; si ese RIF
--      no esta dado de alta, el lote entero se niega y dice cuales faltan. Crear
--      organizaciones desde una hoja de calculo es como se acaba con cuarenta
--      proveedores duplicados que en realidad son ocho.
--
--   2. O ENTRA TODO O NO ENTRA NADA. Ya estaba asi en 'confirmar_lote' y aqui se
--      mantiene: una carga a medias es peor que no haber cargado, porque nadie sabe
--      por donde se quedo.

/**
 * Lo que la hoja dice y todavia no existe aqui.
 *
 * Se devuelve antes de escribir nada, para que la pantalla pueda ensenarlo y que
 * alguien de de alta a esos proveedores en vez de descubrirlo a mitad de la carga.
 */
create or replace function proveedores_desconocidos(p_lote uuid)
returns table (rif text, nombre text, filas int)
language sql stable as $$
  with celdas as (
    select f.fila,
           btrim(f.celdas[(select columna from mapeo_columna m
                            where m.lote_id = p_lote and m.campo = 'proveedor')]) as rif,
           btrim(coalesce(f.celdas[(select columna from mapeo_columna m
                            where m.lote_id = p_lote and m.campo = 'proveedor_nombre')], '')) as nombre
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
 * Crea los documentos de una hoja de facturas recibidas.
 *
 * El importe en dolares NO se teclea ni se pide en la hoja: se calcula con la tasa
 * del dia de la factura. Pedirlo seria invitar a que alguien ponga la tasa de hoy
 * en una factura de hace tres meses, y entonces el costo en divisas de ese contrato
 * deja de significar nada.
 */
create or replace function materializar_facturas_recibidas(p_lote uuid, p_persona uuid)
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
  v_prov  uuid;
  v_fecha date;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.destino <> 'facturas_recibidas' then return 0; end if;

  select string_agg(rif, ', ') into faltan from proveedores_desconocidos(p_lote);
  if faltan is not null then
    raise exception 'Estos proveedores no están dados de alta: %. Créalos antes: '
      'crear empresas desde una hoja es como se acaba con proveedores duplicados.', faltan;
  end if;

  -- Que columna es cada campo, en un solo objeto para no consultar por fila.
  select jsonb_object_agg(campo, jsonb_build_array(columna, coalesce(formato,'')))
    into col from mapeo_columna where lote_id = p_lote;

  for r in select * from fila_cruda where lote_id = p_lote order by fila loop
    v_fecha := leer_fecha(r.celdas[(col->'fecha'->>0)::int], col->'fecha'->>1);
    v_ves   := leer_numero(r.celdas[(col->'base'->>0)::int], col->'base'->>1);
    v_iva   := case when col ? 'iva'
                    then coalesce(leer_numero(r.celdas[(col->'iva'->>0)::int], col->'iva'->>1), 0)
                    else 0 end;

    select id into v_tasa from tasa_bcv
     where vigente_el <= v_fecha order by vigente_el desc limit 1;
    if v_tasa is null then
      raise exception 'No hay tasa del BCV para el %, que es la fecha de la factura %',
        v_fecha, r.celdas[(col->'numero'->>0)::int];
    end if;

    select id into v_prov from organizacion
     where rif = btrim(r.celdas[(col->'proveedor'->>0)::int]);

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
    select l.organizacion_id, 'recibido', 'factura',
           btrim(r.celdas[(col->'numero'->>0)::int]),
           case when col ? 'control' then nullif(btrim(r.celdas[(col->'control'->>0)::int]), '') end,
           v_prov, v_fecha, v_ctr,
           v_ves, round(v_ves / t.ves_por_usd, 2),
           v_iva, round(v_iva / t.ves_por_usd, 2),
           v_tasa, p_persona
      from tasa_bcv t where t.id = v_tasa
    -- La misma factura del mismo proveedor dos veces no entra dos veces. Reimportar
    -- una hoja corregida es lo normal, no un error.
    on conflict (organizacion_id, sentido, tipo, numero) do nothing;

    n := n + 1;
  end loop;
  return n;
end $$;

-- 'confirmar_lote' se reemplaza para que ademas CREE. Antes marcaba el lote y no
-- creaba nada: todo el trabajo de leer, mapear y validar terminaba en un sello.
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
  -- 'validado' y se puede volver a intentar. Marcarlo primero dejaria un lote que
  -- dice estar confirmado sin haber creado nada.
  n := materializar_facturas_recibidas(p_lote, p_persona);

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return greatest(n, (select count(*)::int from fila_cruda where lote_id = p_lote));
end $$;

-- La fila de cabecera de la hoja. No es un dato —no se valida ni se importa— pero
-- sin ella la pantalla de mapeo no puede ensenar como se llamaba cada columna en el
-- Excel original, que es justo lo que el humano necesita para reconocerla.
alter table lote_importacion add column if not exists cabeceras text[];
