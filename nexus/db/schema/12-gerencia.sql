-- GPS Nexus · gerencia. Ninguna de estas consultas la alcanza un cliente jamas.
--
-- Todo lo de aqui sale del libro, no de una hoja aparte. Por eso el margen que
-- muestra esta pantalla y el resultado del estado financiero son el mismo numero:
-- si difieren, es que uno de los dos esta mal, y aqui no pueden diferir.
--
-- El aislamiento de 07-aislamiento.sql ya impide que un cliente llegue a asiento o
-- partida, de modo que estas funciones no le devuelven nada aunque las llame.

-- Margen de un contrato a una fecha: lo valuado contra lo que ha costado.
-- 'valuado' es obra reconocida, no dinero cobrado: el margen no depende de si el
-- cliente ya pago, porque el trabajo ya se hizo y ya costo lo que costo.
create or replace function margen_contrato(p_contrato uuid, p_hasta date)
returns table (
  contrato        text,
  cliente         text,
  tipo            tipo_contrato,
  monto_contrato  numeric(20,2),
  valuado         numeric(20,2),
  costo           numeric(20,2),
  margen          numeric(20,2),
  margen_pct      numeric(6,2),
  avance_pct      numeric(6,2)
)
language sql stable as $$
  with v as (
    select coalesce(sum(obra), 0) obra
      from valuacion
     where contrato_id = p_contrato
       and estado in ('aprobada','facturada','cobrada')
       and periodo_hasta <= p_hasta
  ), c as (
    select coalesce(sum(costo_ves), 0) costo from costo_contrato(p_contrato, p_hasta)
  )
  select ct.codigo, cl.nombre, ct.tipo, ct.monto,
         v.obra, c.costo, v.obra - c.costo,
         case when v.obra = 0 then 0 else round((v.obra - c.costo) / v.obra * 100, 2) end,
         case when ct.monto = 0 then 0 else round(v.obra / ct.monto * 100, 2) end
    from contrato ct
    join organizacion cl on cl.id = ct.cliente_id
    cross join v cross join c
   where ct.id = p_contrato
$$;

-- La cartera entera, ordenada por lo que mas duele o mas alegra.
create or replace function margen_cartera(p_org uuid, p_hasta date)
returns table (
  contrato        text,
  cliente         text,
  tipo            tipo_contrato,
  estado          estado_contrato,
  valuado         numeric(20,2),
  costo           numeric(20,2),
  margen          numeric(20,2),
  margen_pct      numeric(6,2)
)
language sql stable as $$
  select m.contrato, m.cliente, m.tipo, ct.estado,
         m.valuado, m.costo, m.margen, m.margen_pct
    from contrato ct
    cross join lateral margen_contrato(ct.id, p_hasta) m
   where ct.organizacion_id = p_org
     and ct.estado <> 'borrador'
   order by m.margen
$$;

-- Que cliente y que tipo de servicio dan dinero, y cual lo quita.
create or replace function rentabilidad_por_cliente(p_org uuid, p_desde date, p_hasta date)
returns table (cliente text, contratos int, valuado numeric(20,2),
               costo numeric(20,2), margen numeric(20,2), margen_pct numeric(6,2))
language sql stable as $$
  select m.cliente, count(*)::int, sum(m.valuado), sum(m.costo), sum(m.margen),
         case when sum(m.valuado) = 0 then 0
              else round(sum(m.margen) / sum(m.valuado) * 100, 2) end
    from contrato ct
    cross join lateral margen_contrato(ct.id, p_hasta) m
   where ct.organizacion_id = p_org and ct.estado <> 'borrador'
   group by m.cliente
   order by 5 desc
$$;

create or replace function rentabilidad_por_servicio(p_org uuid, p_desde date, p_hasta date)
returns table (tipo tipo_contrato, contratos int, valuado numeric(20,2),
               costo numeric(20,2), margen numeric(20,2), margen_pct numeric(6,2))
language sql stable as $$
  select m.tipo, count(*)::int, sum(m.valuado), sum(m.costo), sum(m.margen),
         case when sum(m.valuado) = 0 then 0
              else round(sum(m.margen) / sum(m.valuado) * 100, 2) end
    from contrato ct
    cross join lateral margen_contrato(ct.id, p_hasta) m
   where ct.organizacion_id = p_org and ct.estado <> 'borrador'
   group by m.tipo
   order by 5 desc
$$;

-- -----------------------------------------------------------------------------
-- Ejecutado sin cobrar: obra ya reconocida que todavia no ha entrado en caja.
-- Es la cifra que explica por que un mes bueno puede no tener dinero.
create or replace function ejecutado_sin_cobrar(p_org uuid, p_al date)
returns numeric(20,2)
language sql stable as $$
  select coalesce(sum(saldo_valuacion(v.id)), 0)
    from valuacion v
   where v.organizacion_id = p_org
     and v.estado in ('aprobada','facturada')
     and v.periodo_hasta <= p_al
$$;

-- Flujo de caja proyectado por semana: lo que se espera cobrar contra lo que hay
-- que pagar. No adivina nada: usa lo que ya esta aprobado y lo que ya se debe.
create or replace function flujo_caja(p_org uuid, p_desde date, p_semanas int)
returns table (semana date, entra numeric(20,2), sale numeric(20,2), neto numeric(20,2))
language sql stable as $$
  with semanas as (
    select (p_desde + (n * interval '7 days'))::date sem
      from generate_series(0, p_semanas - 1) n
  ), cobros as (
    -- Se espera cobrar treinta dias despues de aprobada. Es un supuesto, y se dice.
    select (v.aprobada_el + interval '30 days')::date f, saldo_valuacion(v.id) m
      from valuacion v
     where v.organizacion_id = p_org
       and v.estado in ('aprobada','facturada')
       and saldo_valuacion(v.id) > 0
  ), pagos as (
    select d.fecha + interval '30 days' f,
           d.base_ves + d.iva_ves
         - coalesce((select sum(r.monto_ves) from retencion r where r.documento_id = d.id), 0) m
      from documento_fiscal d
     where d.organizacion_id = p_org and d.sentido = 'recibido'
  )
  select s.sem,
         coalesce((select sum(m) from cobros where f >= s.sem and f < s.sem + 7), 0),
         coalesce((select sum(m) from pagos  where f >= s.sem and f < s.sem + 7), 0),
         coalesce((select sum(m) from cobros where f >= s.sem and f < s.sem + 7), 0)
       - coalesce((select sum(m) from pagos  where f >= s.sem and f < s.sem + 7), 0)
    from semanas s order by s.sem
$$;
