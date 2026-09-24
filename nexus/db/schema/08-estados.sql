-- GPS Nexus · balance de comprobacion y estados financieros
--
-- No son tablas ni informes que alguien arma: son consultas sobre los asientos.
-- Por eso no pueden descuadrar respecto al libro: son el libro, mirado de otra forma.
--
-- Todo sale en las dos monedas. En Venezuela mirar solo una de las dos es enganarse:
-- en bolivares porque la inflacion deforma la comparacion entre meses, y en dolares
-- porque el SENIAT no acepta esa columna.

create or replace function balance_comprobacion(p_org uuid, p_hasta date)
returns table (
  codigo      text,
  cuenta_es   text,
  cuenta_en   text,
  naturaleza  naturaleza_cuenta,
  debe_ves    numeric(20,2),
  haber_ves   numeric(20,2),
  saldo_ves   numeric(20,2),
  saldo_usd   numeric(20,2)
)
language sql stable as $$
  select c.codigo, c.nombre_es, c.nombre_en, c.naturaleza,
         coalesce(sum(greatest(p.monto_ves, 0)), 0),
         coalesce(sum(greatest(-p.monto_ves, 0)), 0),
         coalesce(sum(p.monto_ves), 0),
         coalesce(sum(p.monto_usd), 0)
    from cuenta c
    left join partida p on p.organizacion_id = c.organizacion_id and p.cuenta = c.codigo
    left join asiento a on a.id = p.asiento_id and a.ocurrido_en <= p_hasta
   where c.organizacion_id = p_org
     and c.imputable
     and (p.asiento_id is null or a.id is not null)
   group by c.codigo, c.nombre_es, c.nombre_en, c.naturaleza
   having coalesce(sum(p.monto_ves), 0) <> 0
   order by c.codigo
$$;

-- Que el libro entero cuadre. Si esto devuelve algo distinto de cero, hay un problema
-- grave y hay que verlo antes que nada: significa que existe un asiento descuadrado,
-- cosa que la base de datos no deberia permitir.
create or replace function descuadre(p_org uuid, p_hasta date)
returns table (ves numeric(20,2), usd numeric(20,2))
language sql stable as $$
  select coalesce(sum(p.monto_ves), 0), coalesce(sum(p.monto_usd), 0)
    from partida p join asiento a on a.id = p.asiento_id
   where p.organizacion_id = p_org and a.ocurrido_en <= p_hasta
$$;

-- El resultado del ejercicio: ingresos menos gastos.
-- Los ingresos viven con signo negativo (haber), asi que se invierte el signo al mostrar.
create or replace function estado_resultados(p_org uuid, p_desde date, p_hasta date)
returns table (
  seccion    text,
  codigo     text,
  cuenta_es  text,
  cuenta_en  text,
  monto_ves  numeric(20,2),
  monto_usd  numeric(20,2)
)
language sql stable as $$
  select case c.naturaleza when 'ingreso' then 'ingresos' else 'gastos' end,
         c.codigo, c.nombre_es, c.nombre_en,
         case c.naturaleza when 'ingreso' then -sum(p.monto_ves) else sum(p.monto_ves) end,
         case c.naturaleza when 'ingreso' then -sum(p.monto_usd) else sum(p.monto_usd) end
    from cuenta c
    join partida p on p.organizacion_id = c.organizacion_id and p.cuenta = c.codigo
    join asiento a on a.id = p.asiento_id
   where c.organizacion_id = p_org
     and c.naturaleza in ('ingreso','gasto')
     and a.ocurrido_en between p_desde and p_hasta
   group by c.naturaleza, c.codigo, c.nombre_es, c.nombre_en
   order by 1 desc, 2
$$;

create or replace function resultado_neto(p_org uuid, p_desde date, p_hasta date)
returns table (ingresos_ves numeric(20,2), gastos_ves numeric(20,2),
               resultado_ves numeric(20,2), resultado_usd numeric(20,2))
language sql stable as $$
  select coalesce(sum(monto_ves) filter (where seccion = 'ingresos'), 0),
         coalesce(sum(monto_ves) filter (where seccion = 'gastos'), 0),
         coalesce(sum(monto_ves) filter (where seccion = 'ingresos'), 0)
       - coalesce(sum(monto_ves) filter (where seccion = 'gastos'), 0),
         coalesce(sum(monto_usd) filter (where seccion = 'ingresos'), 0)
       - coalesce(sum(monto_usd) filter (where seccion = 'gastos'), 0)
    from estado_resultados(p_org, p_desde, p_hasta)
$$;

create or replace function balance_general(p_org uuid, p_hasta date)
returns table (
  seccion    text,
  codigo     text,
  cuenta_es  text,
  cuenta_en  text,
  monto_ves  numeric(20,2),
  monto_usd  numeric(20,2)
)
language sql stable as $$
  select case c.naturaleza
           when 'activo'     then 'activo'
           when 'pasivo'     then 'pasivo'
           else 'patrimonio' end,
         c.codigo, c.nombre_es, c.nombre_en,
         case c.naturaleza when 'activo' then sum(p.monto_ves) else -sum(p.monto_ves) end,
         case c.naturaleza when 'activo' then sum(p.monto_usd) else -sum(p.monto_usd) end
    from cuenta c
    join partida p on p.organizacion_id = c.organizacion_id and p.cuenta = c.codigo
    join asiento a on a.id = p.asiento_id
   where c.organizacion_id = p_org
     and c.naturaleza in ('activo','pasivo','patrimonio')
     and a.ocurrido_en <= p_hasta
   group by c.naturaleza, c.codigo, c.nombre_es, c.nombre_en
  having sum(p.monto_ves) <> 0
   order by 2
$$;

-- -----------------------------------------------------------------------------
-- Cierre de periodo. Deja el mes bloqueado, y no lo deja bloquear si algo no cuadra.
create or replace function cerrar_periodo(p_org uuid, p_anio int, p_mes int, p_persona uuid)
returns void
language plpgsql as $$
declare
  d      record;
  hasta  date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  est    estado_periodo;
begin
  select estado into est from periodo
   where organizacion_id = p_org and anio = p_anio and mes = p_mes;
  if est is null then raise exception 'El período %-% no existe', p_anio, p_mes; end if;
  if est = 'cerrado' then raise exception 'El período %-% ya está cerrado', p_anio, p_mes; end if;

  select * into d from descuadre(p_org, hasta);
  if d.ves <> 0 or d.usd <> 0 then
    raise exception 'No se cierra un período descuadrado (VES %, USD %)', d.ves, d.usd;
  end if;

  -- Un mes no se cierra si el anterior sigue abierto: el orden importa.
  if exists (select 1 from periodo
              where organizacion_id = p_org
                and make_date(anio, mes, 1) < make_date(p_anio, p_mes, 1)
                and estado <> 'cerrado') then
    raise exception 'Hay un período anterior sin cerrar. Se cierran en orden.';
  end if;

  update periodo set estado = 'cerrado', cerrado_en = now(), cerrado_por = p_persona
   where organizacion_id = p_org and anio = p_anio and mes = p_mes;
end $$;
