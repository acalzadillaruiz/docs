-- GPS Nexus · con que saldos empieza una empresa que ya existe
--
-- El importador dice de si mismo que es «la pantalla que decide si esto se usa o se
-- abandona: hay anios de historico en hojas de calculo y ninguna aplicacion sirve si hay que
-- volver a teclearlo». Traia tres cosas: facturas recibidas, facturas emitidas y movimientos
-- del banco. **No traia con que saldos empieza la empresa.** Y no habia ninguna otra puerta:
-- este producto no tiene —a proposito— una pantalla para teclear un asiento a mano, asi que
-- el capital, el banco, lo que ya te deben y lo que ya debes no tenian por donde entrar.
--
-- Lo que eso significa: **una empresa que ya existe no podia empezar a usar esto.** Cargaba
-- su historico de facturas y el balance le salia como si hubiera nacido ese dia — sin
-- capital, con el banco en negativo en cuanto abriera una caja chica, y con un patrimonio
-- que era solo la ganancia del mes. Es exactamente lo que le pasaba a la propia empresa de
-- muestra, y se veia en la instantanea: «3.1.01 Capital social» no aparecia por ningun lado.
--
-- Se hace por donde ya estaba hecho: un destino mas del importador, con sus cuatro pasos —la
-- hoja entra tal cual, la aplicacion propone como entendio cada columna, se valida sin
-- escribir nada, y solo entonces se confirma. Lo que entra es UN asiento de apertura, con
-- una linea por cuenta.
--
-- Tres reglas que no se negocian, y las tres se comprueban ANTES de escribir:
--
--   1. **El balance de apertura cuadra o no entra.** Un balance de comprobacion que no suma
--      cero no es un balance: es una hoja a medias. Y si se cargara, el aviso de «el balance
--      no balancea» saldria para siempre sin que nadie sepa de donde viene.
--   2. **Las cuentas tienen que existir en el plan, y ser imputables.** Una cuenta que no
--      existe no se crea sola: el plan de cuentas es una decision, no un efecto secundario
--      de una importacion. Se dicen TODAS las que faltan, no la primera — quien corrige una
--      hoja quiere la lista entera, no una vuelta por cada linea.
--   3. **Una sola apertura por empresa.** Dos balances de apertura duplican todo lo que hay
--      debajo, y la segunda vez nadie se acuerda de la primera. Si de verdad estaba mal, se
--      deshace el lote —que reversa su asiento, porque un asiento no se borra— y se carga otra
--      vez.
--
-- La fecha NO va en la hoja. Un balance de apertura tiene una sola fecha para todas sus
-- lineas, y pedirla repetida en cada fila es pedirle a quien exporta del sistema viejo que
-- anada una columna que su sistema no tiene. Va en el lote, y se pregunta al subir la hoja.

alter table lote_importacion add column if not exists fecha_corte date;

-- -----------------------------------------------------------------------------
-- Validar. Se rehace entera porque el destino nuevo necesita su lista de campos
-- obligatorios, y encima dos reglas que los otros destinos no tienen.
create or replace function validar_lote(p_lote uuid)
returns table (filas int, buenas int, malas int)
language plpgsql as $$
declare
  l      record;
  obl    text[];
  faltan text;
  suma   numeric(20,2);
  cta_d  int;
  cta_h  int;
  col_c  int;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.estado = 'confirmado' then
    raise exception 'El lote % ya está confirmado. Para rehacerlo, revíertelo antes.', p_lote;
  end if;

  delete from validacion_fila where lote_id = p_lote;

  obl := case l.destino
           when 'valuaciones'        then array['contrato','numero','periodo_hasta','obra']
           when 'facturas_emitidas'  then array['numero','fecha','cliente','base']
           when 'facturas_recibidas' then array['numero','fecha','proveedor','base']
           when 'cobros'             then array['fecha','monto']
           -- El importe NO va aqui: en un balance de comprobacion cada linea trae debe O
           -- haber, y la otra casilla viene vacia. Exigir las dos daria por mala cada fila.
           when 'saldos_iniciales'   then array['cuenta']
           else array[]::text[]
         end;

  insert into validacion_fila (lote_id, fila, ok, motivo)
  select p_lote,
         f.fila,
         bool_and(v.bien),
         nullif(string_agg(v.motivo, '; ') filter (where not v.bien), '')
    from fila_cruda f
    cross join lateral (
      select m.campo,
             case m.tipo
               when 'fecha'  then leer_fecha(f.celdas[m.columna], m.formato) is not null
               when 'numero' then leer_numero(f.celdas[m.columna], m.formato) is not null
               else coalesce(btrim(f.celdas[m.columna]), '') <> ''
             end
               or not (m.campo = any(obl)) as bien,
             m.campo || ': ' ||
             case m.tipo when 'fecha'  then 'no se entiende como fecha'
                         when 'numero' then 'no se entiende como número'
                         else 'está vacío' end as motivo
        from mapeo_columna m where m.lote_id = f.lote_id
    ) v
   where f.lote_id = p_lote
   group by f.fila;

  -- Un campo obligatorio que ni siquiera esta mapeado es un fallo del lote entero.
  select string_agg(c, ', ') into faltan from unnest(obl) c
   where c not in (select campo from mapeo_columna where lote_id = p_lote);
  if faltan is not null then
    raise exception 'Faltan columnas obligatorias por mapear: %', faltan;
  end if;

  if l.destino = 'saldos_iniciales' then
    if l.fecha_corte is null then
      raise exception 'Un balance de apertura necesita su fecha de corte: es el día hasta el '
        'que valen esos saldos, y de él sale la fecha del asiento.';
    end if;

    -- El mes del asiento de apertura tiene que EXISTIR como mes contable. No es una
    -- formalidad: `asiento` tiene clave ajena contra `periodo`, asi que sin esa fila el
    -- insert se cae con un error de clave ajena que no dice nada de meses. Y no se crea
    -- aqui a la callada: abrir un mes es una decision de quien lleva la contabilidad, la
    -- pantalla para hacerlo existe, y el mensaje dice cual y donde.
    if not exists (select 1 from periodo
                    where organizacion_id = l.organizacion_id
                      and anio = extract(year from l.fecha_corte)::int
                      and mes = extract(month from l.fecha_corte)::int) then
      raise exception 'El mes contable %-% no existe, y el asiento de apertura va en él. '
        'Ábrelo en «Meses contables» antes de cargar la hoja.',
        extract(year from l.fecha_corte)::int, extract(month from l.fecha_corte)::int;
    end if;
    if exists (select 1 from periodo
                where organizacion_id = l.organizacion_id
                  and anio = extract(year from l.fecha_corte)::int
                  and mes = extract(month from l.fecha_corte)::int
                  and estado = 'cerrado') then
      raise exception 'El mes contable %-% está cerrado. Ningún asiento entra ya, tampoco '
        'el de apertura.',
        extract(year from l.fecha_corte)::int, extract(month from l.fecha_corte)::int;
    end if;

    select max(columna) filter (where campo = 'debe'),
           max(columna) filter (where campo = 'haber')
      into cta_d, cta_h
      from mapeo_columna where lote_id = p_lote;
    if cta_d is null and cta_h is null then
      raise exception 'Falta el importe: hay que mapear la columna del debe, la del haber, o '
        'las dos.';
    end if;

    select columna into col_c from mapeo_columna
     where lote_id = p_lote and campo = 'cuenta';

    -- Las cuentas que no estan en el plan, TODAS. Una cuenta que no existe no se crea
    -- sola: el plan es una decision, no un efecto de una importacion.
    select string_agg(distinct btrim(fc.celdas[col_c]), ', ') into faltan
      from fila_cruda fc
     where fc.lote_id = p_lote
       and not exists (select 1 from cuenta c
                        where c.organizacion_id = l.organizacion_id
                          and c.codigo = btrim(fc.celdas[col_c])
                          and c.imputable);
    if faltan is not null then
      raise exception 'Estas cuentas no están en el plan, o no son imputables: %. El plan de '
        'cuentas es una decisión, no un efecto de una importación.', faltan;
    end if;

    -- Y que cuadre. Si no cuadra, el aviso de «el balance no balancea» saldria para
    -- siempre y nadie sabria de donde viene.
    select coalesce(sum(coalesce(leer_numero(fc.celdas[cta_d], m_d.formato), 0)
                      - coalesce(leer_numero(fc.celdas[cta_h], m_h.formato), 0)), 0)
      into suma
      from fila_cruda fc
      left join mapeo_columna m_d on m_d.lote_id = p_lote and m_d.campo = 'debe'
      left join mapeo_columna m_h on m_h.lote_id = p_lote and m_h.campo = 'haber'
     where fc.lote_id = p_lote;
    if suma <> 0 then
      raise exception 'El balance de apertura no cuadra: el debe menos el haber da %. Un '
        'balance que no suma cero no es un balance.', suma;
    end if;
  end if;

  update lote_importacion set estado = 'validado' where id = p_lote;

  return query
    select count(*)::int,
           count(*) filter (where ok)::int,
           count(*) filter (where not ok)::int
      from validacion_fila where lote_id = p_lote;
end $$;

-- -----------------------------------------------------------------------------
/**
 * El asiento de apertura.
 *
 * Uno solo, con una linea por cuenta, con la fecha de corte del lote y marcado con
 * 'importacion_excel' + el id del lote — que es justo lo que 'revertir_lote' ya sabe buscar
 * para reversarlo. No hace falta tocar nada de deshacer: la puerta de atras ya estaba.
 *
 * Los dolares se convierten a la tasa vigente en la fecha de corte, linea a linea. El
 * centimo que deja redondear cada linea por separado lo absorbe el control del cuadre
 * —db/schema/40-centimos-de-conversion.sql—, y sin eso un balance de apertura de veinte
 * cuentas seria casi imposible de cargar.
 */
create or replace function materializar_saldos_iniciales(p_lote uuid, p_persona uuid)
returns int
language plpgsql as $$
declare
  l     record;
  a_id  uuid := gen_random_uuid();
  fx    uuid;
  col_c int;
  col_d int;
  col_h int;
  fmt_d text;
  fmt_h text;
  n     int;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;

  if exists (select 1 from lote_importacion o
              where o.organizacion_id = l.organizacion_id
                and o.destino = 'saldos_iniciales'
                and o.estado = 'confirmado'
                and o.id <> p_lote) then
    raise exception 'Esta empresa ya tiene un balance de apertura cargado. Dos aperturas '
      'duplican todo lo que hay debajo. Si el primero estaba mal, deshaz ese lote y vuelve '
      'a cargar.';
  end if;

  select id into fx from tasa_bcv
   where vigente_el <= l.fecha_corte and sustituida_por is null
   order by vigente_el desc limit 1;
  if fx is null then
    raise exception 'No hay tasa del BCV publicada para el % ni antes, y sin ella no se '
      'puede poner la columna en divisas.', l.fecha_corte;
  end if;

  select max(columna) filter (where campo = 'cuenta'),
         max(columna) filter (where campo = 'debe'),
         max(columna) filter (where campo = 'haber'),
         max(formato) filter (where campo = 'debe'),
         max(formato) filter (where campo = 'haber')
    into col_c, col_d, col_h, fmt_d, fmt_h
    from mapeo_columna where lote_id = p_lote;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, l.organizacion_id, siguiente_asiento(l.organizacion_id), l.fecha_corte,
          extract(year from l.fecha_corte)::int, extract(month from l.fecha_corte)::int,
          'Balance de apertura', 'Opening balances', 'importacion_excel', p_lote, p_persona);

  -- Una linea por fila, en el orden de la hoja. Las de importe cero no entran: una
  -- partida de cero no dice nada y la base no la admite.
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                       tasa_id)
  select a_id, row_number() over (order by fc.fila), l.organizacion_id,
         btrim(fc.celdas[col_c]), s.ves, convertir(s.ves, 'VES', 'USD', fx), fx
    from fila_cruda fc
    cross join lateral (
      select (coalesce(leer_numero(fc.celdas[col_d], fmt_d), 0)
            - coalesce(leer_numero(fc.celdas[col_h], fmt_h), 0))::numeric(20,2) as ves
    ) s
   where fc.lote_id = p_lote and s.ves <> 0;

  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Confirmar, con el destino nuevo dentro.
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
  elsif l.destino = 'saldos_iniciales' then
    -- Este SÍ se asienta, y es lo único que hace: el balance de apertura no crea
    -- documentos, crea el punto de partida del libro.
    n := materializar_saldos_iniciales(p_lote, p_persona);
  else
    n := 0;
  end if;

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return greatest(n, (select count(*)::int from fila_cruda where lote_id = p_lote));
end $$;
