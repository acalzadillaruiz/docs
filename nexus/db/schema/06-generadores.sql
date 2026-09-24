-- GPS Nexus · generadores de asiento
--
-- Aqui la regla "ningun asiento se escribe a mano" deja de ser una frase.
-- Nadie teclea un asiento: se le pide a un hecho que produzca el suyo. El asiento
-- queda apuntando al hecho que lo causo (origen_tipo, origen_id), y por eso desde
-- cualquier linea del libro mayor se puede saltar al documento.
--
-- Las cuentas no estan escritas dentro del codigo. Viven en 'mapa_cuenta', una por
-- concepto y por organizacion, de modo que cada empresa use su propio plan de cuentas
-- sin tocar una linea de esto.

create table mapa_cuenta (
  organizacion_id uuid not null references organizacion(id),
  -- 'cxc', 'ingreso_obra', 'iva_debito', 'iva_credito', 'anticipo_recibido',
  -- 'garantia_retenida', 'ret_iva_sufrida', 'ret_islr_sufrida', 'igtf_gasto',
  -- 'banco', 'cxp', 'gasto'
  concepto        text not null,
  cuenta          text not null,
  primary key (organizacion_id, concepto),
  foreign key (organizacion_id, cuenta) references cuenta (organizacion_id, codigo)
);

create or replace function cuenta_de(p_org uuid, p_concepto text) returns text
language plpgsql stable as $$
declare c text;
begin
  select cuenta into c from mapa_cuenta
   where organizacion_id = p_org and concepto = p_concepto;
  if c is null then
    raise exception 'Falta configurar la cuenta para "%". Se define una vez en mapa_cuenta.', p_concepto;
  end if;
  return c;
end $$;

-- Numero de asiento siguiente para la organizacion. Correlativo, sin huecos.
create or replace function siguiente_asiento(p_org uuid) returns bigint
language sql stable as $$
  select coalesce(max(numero), 0) + 1 from asiento where organizacion_id = p_org
$$;

-- -----------------------------------------------------------------------------
-- Asiento de una valuacion aprobada.
--
--   Debe   Cuentas por cobrar                 neto a cobrar
--   Debe   Anticipo recibido                  amortizacion del periodo
--   Debe   Retencion de garantia por cobrar   garantia del periodo
--   Debe   IVA retenido por el cliente        retencion de IVA
--   Debe   ISLR retenido por el cliente       retencion de ISLR
--   Debe   IGTF (gasto)                       igtf, si se paga en divisa
--       Haber  Ingresos por obra                              obra del periodo
--       Haber  IVA debito fiscal                              IVA
--
-- Cuadra por construccion: la suma de los debes es obra + IVA, igual que los haberes.
-- Aun asi, la base de datos lo comprueba al confirmar. No hay forma de colar uno malo.
create or replace function asentar_valuacion(p_valuacion uuid, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  v        record;
  h        record;
  a_id     uuid;
  org      uuid;
  linea    int := 0;
  fx       uuid;
  m        numeric(20,2);
  pieza    record;
begin
  select * into v from valuacion where id = p_valuacion;
  if v is null then raise exception 'La valuacion % no existe', p_valuacion; end if;
  if v.estado not in ('aprobada','facturada') then
    raise exception 'Solo se asienta una valuacion aprobada. Esta esta en "%".', v.estado;
  end if;
  if exists (select 1 from asiento
              where origen_tipo = 'valuacion' and origen_id = p_valuacion) then
    raise exception 'La valuacion % ya tiene asiento. Para corregir, registra su reverso.', p_valuacion;
  end if;

  org := v.organizacion_id;
  fx  := v.tasa_id;
  a_id := gen_random_uuid();

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, org, siguiente_asiento(org), v.periodo_hasta,
          extract(year from v.periodo_hasta)::int,
          extract(month from v.periodo_hasta)::int,
          'Valuación ' || v.numero::text, 'Progress payment ' || v.numero::text,
          'valuacion', p_valuacion, p_persona);

  -- Cada linea de la hoja va a su cuenta. El signo de la hoja ya es el contable:
  -- lo que resta al cliente es un debe para nosotros.
  for pieza in
    select * from (values
      (9, 'cxc',               1),   -- neto a cobrar
      (4, 'anticipo_recibido', -1),  -- amortizacion: la hoja la trae negativa
      (5, 'garantia_retenida', -1),
      (6, 'ret_iva_sufrida',   -1),
      (7, 'ret_islr_sufrida',  -1),
      (8, 'igtf_gasto',        -1),
      (1, 'ingreso_obra',      -1),  -- ingreso: haber
      (2, 'iva_debito',        -1)
    ) as t(orden, concepto, signo)
  loop
    select hv.monto into m from hoja_valuacion(p_valuacion) hv where hv.orden = pieza.orden;
    m := m * pieza.signo;
    continue when m = 0;
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta,
                         monto_ves, monto_usd, tasa_id, contrato_id)
    values (a_id, linea, org, cuenta_de(org, pieza.concepto),
            case when v.moneda = 'VES' then m else convertir(m,'USD','VES',fx) end,
            case when v.moneda = 'USD' then m else convertir(m,'VES','USD',fx) end,
            fx, v.contrato_id);
  end loop;

  return a_id;
end $$;

-- -----------------------------------------------------------------------------
-- Reverso. Un asiento no se edita ni se borra: se contrapone otro igual y contrario,
-- que queda apuntando al original. Los dos se quedan en el libro, y eso es lo correcto:
-- el error tambien es un hecho que ocurrio.
create or replace function reversar_asiento(p_asiento uuid, p_persona uuid, p_motivo text)
returns uuid
language plpgsql as $$
declare
  o      record;
  nuevo  uuid := gen_random_uuid();
begin
  select * into o from asiento where id = p_asiento;
  if o is null then raise exception 'El asiento % no existe', p_asiento; end if;
  if exists (select 1 from asiento where reversa_a = p_asiento) then
    raise exception 'El asiento % ya fue reversado', p_asiento;
  end if;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id,
                       reversa_a, creado_por)
  values (nuevo, o.organizacion_id, siguiente_asiento(o.organizacion_id),
          o.ocurrido_en, o.anio, o.mes,
          'Reverso: ' || p_motivo, 'Reversal: ' || p_motivo,
          o.origen_tipo, o.origen_id, p_asiento, p_persona);

  insert into partida (asiento_id, linea, organizacion_id, cuenta,
                       monto_ves, monto_usd, tasa_id, contrato_id)
  select nuevo, linea, organizacion_id, cuenta,
         -monto_ves, -monto_usd, tasa_id, contrato_id
    from partida where asiento_id = p_asiento;

  return nuevo;
end $$;

-- -----------------------------------------------------------------------------
-- El libro mayor de una cuenta, con el enlace al hecho que genero cada linea.
create or replace function mayor(p_org uuid, p_cuenta text, p_desde date, p_hasta date)
returns table (
  fecha       date,
  asiento_num bigint,
  concepto    text,
  origen_tipo text,
  origen_id   uuid,
  debe_ves    numeric(20,2),
  haber_ves   numeric(20,2),
  saldo_ves   numeric(20,2)
)
language sql stable as $$
  select a.ocurrido_en,
         a.numero,
         a.descripcion_es,
         a.origen_tipo,
         a.origen_id,
         greatest(p.monto_ves, 0),
         greatest(-p.monto_ves, 0),
         sum(p.monto_ves) over (order by a.ocurrido_en, a.numero, p.linea
                                rows between unbounded preceding and current row)
    from partida p
    join asiento a on a.id = p.asiento_id
   where p.organizacion_id = p_org
     and p.cuenta = p_cuenta
     and a.ocurrido_en between p_desde and p_hasta
   order by a.ocurrido_en, a.numero, p.linea
$$;
