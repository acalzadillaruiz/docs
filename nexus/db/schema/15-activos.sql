-- GPS Nexus · activos fijos, depreciacion y equipos en alquiler
--
-- Para GPS esto no es contabilidad de adorno: alquiler de equipos es uno de los cinco
-- tipos de contrato. Un equipo alquilado genera ingreso y se gasta al mismo tiempo, y
-- si solo se mira el ingreso, el negocio parece mejor de lo que es.
--
-- La depreciacion se calcula, no se teclea. Y genera su asiento como todo lo demas.

create type metodo_depreciacion as enum ('linea_recta','unidades_produccion');

create table activo (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  codigo          text not null,
  descripcion_es  text not null,
  descripcion_en  text not null,
  cuenta          text not null,
  cuenta_depre    text not null,
  cuenta_gasto    text not null,

  -- Fecha en que entra en servicio, no la de compra: se deprecia desde que trabaja.
  en_servicio_el  date not null,
  costo_ves       numeric(20,2) not null check (costo_ves > 0),
  costo_usd       numeric(20,2) not null,
  tasa_id         uuid not null references tasa_bcv(id),
  valor_residual  numeric(20,2) not null default 0 check (valor_residual >= 0),

  metodo          metodo_depreciacion not null default 'linea_recta',
  vida_meses      int check (vida_meses > 0),
  -- Para el metodo por unidades: horas de operacion totales estimadas.
  unidades_vida   numeric(20,2) check (unidades_vida > 0),

  -- Si esta alquilado, a que contrato. Asi el desgaste se imputa donde se gana.
  contrato_id     uuid references contrato(id),
  baja_el         date,
  motivo_baja     text,

  unique (organizacion_id, codigo),
  foreign key (organizacion_id, cuenta)       references cuenta (organizacion_id, codigo),
  foreign key (organizacion_id, cuenta_depre) references cuenta (organizacion_id, codigo),
  foreign key (organizacion_id, cuenta_gasto) references cuenta (organizacion_id, codigo),
  constraint residual_menor_que_costo check (valor_residual < costo_ves),
  constraint metodo_tiene_su_dato check (
    (metodo = 'linea_recta'         and vida_meses    is not null) or
    (metodo = 'unidades_produccion' and unidades_vida is not null)
  )
);

create index activo_contrato_ix on activo (contrato_id) where contrato_id is not null;

-- Lo depreciado de cada mes. Una fila por activo y mes: asi un mes no se deprecia
-- dos veces aunque alguien lance el proceso dos veces.
create table depreciacion (
  activo_id   uuid not null references activo(id),
  anio        int  not null,
  mes         int  not null check (mes between 1 and 12),
  -- Para el metodo por unidades: cuantas horas trabajo ese mes.
  unidades    numeric(20,2),
  monto_ves   numeric(20,2) not null,
  monto_usd   numeric(20,2) not null,
  asiento_id  uuid references asiento(id),
  primary key (activo_id, anio, mes)
);

-- Cuanto toca depreciar un activo en un mes. Devuelve cero si todavia no entro en
-- servicio, si ya se dio de baja, o si ya llego al valor residual: un activo
-- completamente depreciado no sigue generando gasto, por mucho que siga trabajando.
create or replace function cuota_depreciacion(
  p_activo uuid, p_anio int, p_mes int, p_unidades numeric default null)
returns numeric(20,2)
language plpgsql stable as $$
declare
  a         record;
  fin_mes   date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  acumulada numeric(20,2);
  base      numeric(20,2);
  cuota     numeric(20,2);
begin
  select * into a from activo where id = p_activo;
  if a is null then raise exception 'El activo % no existe', p_activo; end if;

  if a.en_servicio_el > fin_mes then return 0; end if;
  if a.baja_el is not null and a.baja_el < make_date(p_anio, p_mes, 1) then return 0; end if;

  select coalesce(sum(monto_ves), 0) into acumulada
    from depreciacion where activo_id = p_activo
     and make_date(anio, mes, 1) < make_date(p_anio, p_mes, 1);

  base := a.costo_ves - a.valor_residual;
  if acumulada >= base then return 0; end if;

  if a.metodo = 'linea_recta' then
    cuota := round(base / a.vida_meses, 2);
  else
    if p_unidades is null then
      raise exception 'El activo % se deprecia por unidades: hace falta decir cuántas trabajó', a.codigo;
    end if;
    cuota := round(base * p_unidades / a.unidades_vida, 2);
  end if;

  -- Nunca pasarse del valor depreciable. El ultimo mes ajusta.
  return least(cuota, base - acumulada);
end $$;

-- Deprecia todos los activos de un mes y genera UN asiento con todas las cuotas.
-- Un asiento por mes, no uno por activo: el libro diario tiene que poder leerse.
create or replace function depreciar_mes(p_org uuid, p_anio int, p_mes int, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  a      record;
  a_id   uuid := gen_random_uuid();
  fin    date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  linea  int := 0;
  cuota  numeric(20,2);
  total  numeric(20,2) := 0;
  fx     uuid;
begin
  if exists (select 1 from asiento
              where organizacion_id = p_org and origen_tipo = 'depreciacion'
                and anio = p_anio and mes = p_mes and reversa_a is null) then
    raise exception 'El mes %-% ya está depreciado. Para rehacerlo, reversa su asiento.', p_anio, p_mes;
  end if;

  fx := tasa_del_dia(fin);
  if fx is null then raise exception 'No hay tasa BCV vigente al %', fin; end if;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, p_org, siguiente_asiento(p_org), fin, p_anio, p_mes,
          'Depreciación del mes', 'Monthly depreciation',
          'depreciacion', a_id, p_persona);

  for a in select * from activo
            where organizacion_id = p_org
              and (baja_el is null or baja_el >= make_date(p_anio, p_mes, 1))
              and metodo = 'linea_recta'
            order by codigo
  loop
    cuota := cuota_depreciacion(a.id, p_anio, p_mes);
    continue when cuota = 0;

    insert into depreciacion (activo_id, anio, mes, monto_ves, monto_usd, asiento_id)
    values (a.id, p_anio, p_mes, cuota, convertir(cuota,'VES','USD',fx), a_id);

    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta,
                         monto_ves, monto_usd, tasa_id, contrato_id)
    values (a_id, linea, p_org, a.cuenta_gasto, cuota,
            convertir(cuota,'VES','USD',fx), fx, a.contrato_id);

    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta,
                         monto_ves, monto_usd, tasa_id)
    values (a_id, linea, p_org, a.cuenta_depre, -cuota,
            convertir(-cuota,'VES','USD',fx), fx);

    total := total + cuota;
  end loop;

  if total = 0 then
    -- Nada que depreciar: el asiento vacio se elimina antes de que exista de verdad.
    delete from asiento where id = a_id;
    return null;
  end if;

  return a_id;
end $$;

-- Valor en libros de un activo a una fecha.
create or replace function valor_en_libros(p_activo uuid, p_al date)
returns numeric(20,2)
language sql stable as $$
  select a.costo_ves - coalesce((
      select sum(d.monto_ves) from depreciacion d
       where d.activo_id = a.id
         and (make_date(d.anio, d.mes, 1) + interval '1 month - 1 day')::date <= p_al), 0)
    from activo a where a.id = p_activo
$$;

-- Lo que deja un equipo alquilado: lo que se facturo por el, menos lo que se gasto.
-- Si solo se mira el ingreso, el negocio parece mejor de lo que es.
create or replace function rendimiento_alquiler(p_activo uuid, p_hasta date)
returns table (activo text, contrato text, ingreso numeric(20,2),
               desgaste numeric(20,2), deja numeric(20,2), en_libros numeric(20,2))
language sql stable as $$
  select a.codigo, c.codigo,
         coalesce((select sum(v.obra) from valuacion v
                    where v.contrato_id = a.contrato_id
                      and v.estado in ('aprobada','facturada','cobrada')
                      and v.periodo_hasta <= p_hasta), 0),
         coalesce((select sum(d.monto_ves) from depreciacion d
                    where d.activo_id = a.id
                      and (make_date(d.anio,d.mes,1) + interval '1 month - 1 day')::date <= p_hasta), 0),
         coalesce((select sum(v.obra) from valuacion v
                    where v.contrato_id = a.contrato_id
                      and v.estado in ('aprobada','facturada','cobrada')
                      and v.periodo_hasta <= p_hasta), 0)
       - coalesce((select sum(d.monto_ves) from depreciacion d
                    where d.activo_id = a.id
                      and (make_date(d.anio,d.mes,1) + interval '1 month - 1 day')::date <= p_hasta), 0),
         valor_en_libros(a.id, p_hasta)
    from activo a
    join contrato c on c.id = a.contrato_id
   where a.id = p_activo
$$;
