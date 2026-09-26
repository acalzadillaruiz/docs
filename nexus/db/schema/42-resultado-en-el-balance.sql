-- GPS Nexus · el balance decia que no balanceaba, y balanceaba
--
-- La pantalla de estados contables llevaba, arriba y en ambar, el aviso mas grave que hay
-- en este producto: «el balance no balancea por Bs.S 31.804.500,00 — el activo tiene que ser
-- igual al pasivo mas el patrimonio. Si no lo es, hay un asiento a medias y ninguna cifra de
-- esta pantalla se sostiene.» Y el libro cuadraba exacto: `descuadre()` devolvia cero y cero.
--
-- Lo que faltaba es el **resultado del ejercicio**. `balance_general` solo mira las cuentas
-- de activo, pasivo y patrimonio; las de ingreso y gasto se quedan fuera, y su saldo neto
-- —la ganancia— no esta asentado en ninguna cuenta de patrimonio porque no hay cierre de
-- ejercicio que lo mueva. Asi que el activo salia mayor que el pasivo mas el patrimonio por
-- exactamente la ganancia del periodo: 31.804.500, que es lo que la pantalla de gerencia
-- enseñaba al lado como «resultado del mes». El descuadre era la ganancia, con otro nombre.
--
-- **Un aviso que salta sin que pase nada es peor que no tener aviso.** Este salia en la
-- instantanea publicada, en la pantalla con la que se enseña la fase que va primera, y
-- acusaba de un asiento a medias a un libro impecable. El dia que hubiera un asiento a medias
-- de verdad, ese aviso ya no lo habria leido nadie.
--
-- Asi que el balance incluye el resultado en el patrimonio, que es como se presenta un
-- balance antes del cierre. Con eso el activo iguala al pasivo mas el patrimonio por
-- construccion, y no por casualidad: la suma de TODAS las partidas es cero —lo garantiza el
-- control del cuadre—, y esa igualdad es justo esa suma reordenada.
--
-- La linea es CALCULADA, no asentada, y eso hay que decirlo en la pantalla: si no, alguien
-- abre el mayor de esa cuenta, lo encuentra vacio, y a partir de ahi no se cree ninguna de
-- las dos cosas. Se dice debajo del balance, en las dos lenguas.

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
  with saldos as (
    select c.codigo, c.nombre_es, c.nombre_en, c.naturaleza,
           sum(p.monto_ves) as ves, sum(p.monto_usd) as usd
      from cuenta c
      join partida p on p.organizacion_id = c.organizacion_id and p.cuenta = c.codigo
      join asiento a on a.id = p.asiento_id
     where c.organizacion_id = p_org
       and a.ocurrido_en <= p_hasta
     group by c.codigo, c.nombre_es, c.nombre_en, c.naturaleza
  ),
  -- Lo que llevan las cuentas de resultado, que es lo que se vuelca al patrimonio. Va en
  -- crudo, con su signo del libro: un ingreso vive en el haber, asi que una ganancia es
  -- negativa aqui y sale positiva abajo, con el mismo giro de signo que el pasivo.
  ganancia as (
    select coalesce(sum(ves), 0) as ves, coalesce(sum(usd), 0) as usd
      from saldos where naturaleza in ('ingreso','gasto')
  ),
  -- La cuenta donde vive el resultado del ejercicio en el plan. Si la empresa trajo un plan
  -- propio y no la tiene, la linea sale igual con su nombre puesto aqui: el balance tiene
  -- que cuadrar tambien para quien no use este plan de cuentas.
  cta as (
    select coalesce(max(c.codigo), '3.1.04')                        as codigo,
           coalesce(max(c.nombre_es), 'Resultado del ejercicio')    as nombre_es,
           coalesce(max(c.nombre_en), 'Result for the period')      as nombre_en
      from cuenta c
     where c.organizacion_id = p_org and c.codigo = '3.1.04'
  ),
  filas as (
    select s.codigo, s.nombre_es, s.nombre_en, s.naturaleza, s.ves, s.usd
      from saldos s
     where s.naturaleza in ('activo','pasivo','patrimonio')
       and s.codigo <> (select codigo from cta)
    union all
    -- La del resultado, una sola: lo que alguien haya asentado en esa cuenta mas lo que
    -- llevan las de ingreso y gasto sin cerrar. Dos lineas con el mismo codigo se leerian
    -- como un error de la pantalla.
    select cta.codigo, cta.nombre_es, cta.nombre_en, 'patrimonio'::naturaleza_cuenta,
           coalesce((select ves from saldos where codigo = cta.codigo), 0) + g.ves,
           coalesce((select usd from saldos where codigo = cta.codigo), 0) + g.usd
      from cta cross join ganancia g
  )
  select case naturaleza
           when 'activo'     then 'activo'
           when 'pasivo'     then 'pasivo'
           else 'patrimonio' end,
         codigo, nombre_es, nombre_en,
         (case naturaleza when 'activo' then ves else -ves end)::numeric(20,2),
         (case naturaleza when 'activo' then usd else -usd end)::numeric(20,2)
    from filas
   where ves <> 0
   order by 2
$$;
