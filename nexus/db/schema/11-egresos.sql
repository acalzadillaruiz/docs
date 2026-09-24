-- GPS Nexus · egresos: facturas de proveedor, retenciones emitidas y pagos
--
-- Es la mitad que hoy no esta en ninguna pantalla, y la que permite saber lo que
-- cuesta un contrato MIENTRAS corre, no cuando ya cerro y ya no se puede hacer nada.
--
-- Si GPS es contribuyente especial, aqui es donde actua como agente de retencion:
-- le retiene el IVA a su proveedor y le emite el comprobante con su correlativo.
-- El correlativo es AAAAMM + secuencia, y lo genera la base de datos: un correlativo
-- que se lleva a mano acaba con huecos o repetido, y las dos cosas son un problema.

create or replace function correlativo_retencion(p_org uuid, p_clase text, p_fecha date)
returns text
language plpgsql as $$
declare
  periodo text := to_char(p_fecha, 'YYYYMM');
  n       int;
begin
  select coalesce(max(substring(comprobante from 7)::int), 0) + 1 into n
    from retencion
   where organizacion_id = p_org
     and clase = p_clase
     and comprobante like periodo || '%';
  return periodo || lpad(n::text, 8, '0');
end $$;

-- Retiene el IVA a un proveedor y emite su comprobante.
-- Solo si GPS es contribuyente especial en la fecha de la factura.
create or replace function retener_iva_proveedor(p_documento uuid, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  d    record;
  r    record;
  pct  numeric(5,2);
  id_r uuid := gen_random_uuid();
begin
  select * into d from documento_fiscal where id = p_documento;
  if d is null then raise exception 'El documento % no existe', p_documento; end if;
  if d.sentido <> 'recibido' then
    raise exception 'Solo se retiene sobre una factura recibida de un proveedor';
  end if;
  if d.iva_ves = 0 then
    raise exception 'La factura % no tiene IVA que retener', p_documento;
  end if;
  if exists (select 1 from retencion
              where documento_id = p_documento and clase = 'iva') then
    raise exception 'La factura % ya tiene retención de IVA', p_documento;
  end if;

  select * into r from regimen_iva
   where organizacion_id = d.organizacion_id and vigente_desde <= d.fecha
   order by vigente_desde desc limit 1;
  if r is null or not r.es_especial then
    raise exception 'GPS no es agente de retención de IVA en la fecha %. No corresponde retener.', d.fecha;
  end if;

  -- Si la factura del proveedor no cumple los requisitos reglamentarios, se retiene
  -- el 100% en vez del 75%. Esa falta se marca en el numero de control ausente.
  pct := case when d.numero_control is null then r.retencion_falla else r.retencion_normal end;

  insert into retencion (id, organizacion_id, documento_id, clase, sentido, comprobante,
                         fecha, base_ves, porcentaje, monto_ves, monto_usd, tasa_id)
  values (id_r, d.organizacion_id, p_documento, 'iva', 'emitido',
          correlativo_retencion(d.organizacion_id, 'iva', d.fecha),
          d.fecha, d.iva_ves, pct,
          round(d.iva_ves * pct / 100, 2),
          round(d.iva_usd * pct / 100, 2),
          d.tasa_id);
  return id_r;
end $$;

-- Retiene el ISLR a un proveedor, por el concepto que corresponda.
create or replace function retener_islr_proveedor(p_documento uuid, p_concepto text, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  d      record;
  monto  numeric(20,2);
  c      record;
  id_r   uuid := gen_random_uuid();
begin
  select * into d from documento_fiscal where id = p_documento;
  if d is null then raise exception 'El documento % no existe', p_documento; end if;
  if d.sentido <> 'recibido' then
    raise exception 'Solo se retiene sobre una factura recibida de un proveedor';
  end if;
  if exists (select 1 from retencion where documento_id = p_documento and clase = 'islr') then
    raise exception 'La factura % ya tiene retención de ISLR', p_documento;
  end if;

  monto := calcular_islr(p_concepto, d.base_ves, d.fecha);
  if monto = 0 then
    raise exception 'La base no alcanza el mínimo del concepto %. No corresponde retener.', p_concepto;
  end if;

  select * into c from concepto_islr
   where codigo = p_concepto and vigente_desde <= d.fecha
     and (vigente_hasta is null or vigente_hasta >= d.fecha)
   order by vigente_desde desc limit 1;

  insert into retencion (id, organizacion_id, documento_id, clase, sentido, comprobante,
                         fecha, base_ves, porcentaje, sustraendo_ves, monto_ves, monto_usd,
                         tasa_id, concepto_islr, ut_aplicada)
  values (id_r, d.organizacion_id, p_documento, 'islr', 'emitido',
          correlativo_retencion(d.organizacion_id, 'islr', d.fecha),
          d.fecha, d.base_ves, c.porcentaje,
          round(c.porcentaje / 100 * c.factor_ut * ut_del_dia(d.fecha), 2),
          monto,
          convertir(monto, 'VES', 'USD', d.tasa_id),
          d.tasa_id, p_concepto, ut_del_dia(d.fecha));
  return id_r;
end $$;

-- -----------------------------------------------------------------------------
-- Asiento de una factura de proveedor, con sus retenciones ya calculadas.
--
--   Debe   Gasto o costo (imputado al contrato)   base imponible
--   Debe   IVA credito fiscal                     IVA de la factura
--       Haber  IVA retenido a proveedores                    retencion de IVA
--       Haber  ISLR retenido a terceros                      retencion de ISLR
--       Haber  Cuentas por pagar                             lo que queda por pagar
create or replace function asentar_factura_proveedor(
  p_documento uuid, p_cuenta_gasto text, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  d       record;
  a_id    uuid := gen_random_uuid();
  org     uuid;
  ret_iva numeric(20,2) := 0;
  ret_isl numeric(20,2) := 0;
  neto    numeric(20,2);
  linea   int := 0;
begin
  select * into d from documento_fiscal where id = p_documento;
  if d is null then raise exception 'El documento % no existe', p_documento; end if;
  if d.sentido <> 'recibido' then
    raise exception 'Esto asienta facturas recibidas. Para las emitidas hay otro generador.';
  end if;
  if d.asiento_id is not null then
    raise exception 'El documento % ya tiene asiento. Para corregir, registra su reverso.', p_documento;
  end if;

  org := d.organizacion_id;
  select coalesce(sum(monto_ves),0) into ret_iva
    from retencion where documento_id = p_documento and clase = 'iva';
  select coalesce(sum(monto_ves),0) into ret_isl
    from retencion where documento_id = p_documento and clase = 'islr';
  neto := d.base_ves + d.iva_ves - ret_iva - ret_isl;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, org, siguiente_asiento(org), d.fecha,
          extract(year from d.fecha)::int, extract(month from d.fecha)::int,
          'Factura de proveedor ' || d.numero, 'Supplier invoice ' || d.numero,
          'factura_proveedor', p_documento, p_persona);

  linea := 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id, contrato_id)
  values (a_id, linea, org, p_cuenta_gasto, d.base_ves, d.base_usd, d.tasa_id, d.contrato_id);

  if d.iva_ves <> 0 then
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, org, cuenta_de(org,'iva_credito'), d.iva_ves, d.iva_usd, d.tasa_id);
  end if;

  if ret_iva <> 0 then
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, org, cuenta_de(org,'ret_iva_hecha'), -ret_iva,
            convertir(-ret_iva,'VES','USD',d.tasa_id), d.tasa_id);
  end if;

  if ret_isl <> 0 then
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, org, cuenta_de(org,'ret_islr_hecha'), -ret_isl,
            convertir(-ret_isl,'VES','USD',d.tasa_id), d.tasa_id);
  end if;

  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id, contrato_id)
  values (a_id, linea, org, cuenta_de(org,'cxp'), -neto,
          convertir(-neto,'VES','USD',d.tasa_id), d.tasa_id, d.contrato_id);

  update documento_fiscal set asiento_id = a_id where id = p_documento;
  return a_id;
end $$;

-- Lo que cuesta un contrato hasta hoy, por tipo de costo. Sale del libro, imputado
-- al contrato. Es lo que permite ver el margen mientras el contrato corre.
create or replace function costo_contrato(p_contrato uuid, p_hasta date)
returns table (cuenta text, concepto_es text, concepto_en text,
               costo_ves numeric(20,2), costo_usd numeric(20,2))
language sql stable as $$
  select c.codigo, c.nombre_es, c.nombre_en, sum(p.monto_ves), sum(p.monto_usd)
    from partida p
    join asiento a on a.id = p.asiento_id
    join cuenta  c on c.organizacion_id = p.organizacion_id and c.codigo = p.cuenta
   where p.contrato_id = p_contrato
     and c.naturaleza = 'gasto'
     and a.ocurrido_en <= p_hasta
   group by c.codigo, c.nombre_es, c.nombre_en
   order by c.codigo
$$;
