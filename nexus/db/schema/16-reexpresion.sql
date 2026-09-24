-- GPS Nexus · reexpresion por inflacion (VEN-NIF / NIC 29)
--
-- En una economia hiperinflacionaria, comparar el resultado de enero con el de
-- diciembre sin reexpresar no es una aproximacion: es una cifra falsa. Un balance
-- historico dice que la empresa crecio cuando lo unico que crecio fue el indice.
--
-- Como se hace aqui, y en que se diferencia de lo habitual:
--
--   Casi todos los programas reexpresan por saldos mensuales promedio, porque es lo
--   que permite una hoja de calculo. Aqui se reexpresa PARTIDA POR PARTIDA, cada una
--   con el indice del dia en que ocurrio, porque el libro guarda esa fecha. Es mas
--   exacto y no cuesta mas: la informacion ya estaba ahi.
--
--   Las cuentas monetarias NO se reexpresan: un bolivar en el banco sigue siendo un
--   bolivar, aunque valga menos. Precisamente por eso tenerlos cuesta dinero, y esa
--   perdida es el resultado monetario del ejercicio (REME), que sale como la cifra
--   que hace cuadrar el balance reexpresado. No es un ajuste de cuadre inventado:
--   es exactamente lo que costo tener bolivares mientras se devaluaban.

alter table cuenta add column if not exists monetaria boolean not null default false;

comment on column cuenta.monetaria is
  'Verdadero para partidas monetarias (efectivo, cuentas por cobrar y por pagar en '
  'moneda nacional). No se reexpresan: generan resultado monetario.';

create table indice_precios (
  vigente_desde date primary key,
  -- INPC publicado por el BCV.
  valor         numeric(20,6) not null check (valor > 0),
  fuente        text not null default 'bcv',
  registrado_en timestamptz not null default now()
);

create or replace function indice_del_dia(p_fecha date) returns numeric
language sql stable as $$
  select valor from indice_precios
   where vigente_desde <= p_fecha order by vigente_desde desc limit 1
$$;

-- Cuanto hay que multiplicar un importe de una fecha para expresarlo en moneda de otra.
create or replace function factor_reexpresion(p_desde date, p_hasta date)
returns numeric
language plpgsql stable as $$
declare i_d numeric; i_h numeric;
begin
  i_d := indice_del_dia(p_desde);
  i_h := indice_del_dia(p_hasta);
  if i_d is null then raise exception 'No hay índice de precios vigente al %', p_desde; end if;
  if i_h is null then raise exception 'No hay índice de precios vigente al %', p_hasta; end if;
  return round(i_h / i_d, 8);
end $$;

-- Marca como monetarias las cuentas del plan propuesto que lo son.
create or replace function marcar_monetarias(p_org uuid) returns int
language plpgsql as $$
declare n int;
begin
  update cuenta set monetaria = true
   where organizacion_id = p_org
     and codigo in (
       '1.1.01.01','1.1.01.02','1.1.01.03',              -- caja y bancos
       '1.1.02.01','1.1.02.02','1.1.02.03','1.1.02.04',  -- cuentas por cobrar
       '1.1.03',                                          -- anticipos a proveedores
       '1.1.04.01','1.1.04.02','1.1.04.03','1.1.04.04',  -- impuestos por recuperar
       '2.1.01.01','2.1.01.02','2.1.02',                  -- por pagar y anticipos recibidos
       '2.1.03.01','2.1.03.02','2.1.03.03','2.1.03.04','2.1.03.05',
       '2.1.04.01','2.1.04.02','2.1.04.03','2.1.04.04','2.1.05','2.2'
     );
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- La reexpresion, cuenta por cuenta, a una fecha.
create or replace function reexpresar(p_org uuid, p_al date)
returns table (
  codigo        text,
  cuenta_es     text,
  cuenta_en     text,
  naturaleza    naturaleza_cuenta,
  monetaria     boolean,
  historico     numeric(20,2),
  reexpresado   numeric(20,2),
  ajuste        numeric(20,2)
)
language sql stable as $$
  select c.codigo, c.nombre_es, c.nombre_en, c.naturaleza, c.monetaria,
         round(sum(p.monto_ves), 2),
         round(sum(case when c.monetaria then p.monto_ves
                        else p.monto_ves * factor_reexpresion(a.ocurrido_en, p_al) end), 2),
         round(sum(case when c.monetaria then 0
                        else p.monto_ves * (factor_reexpresion(a.ocurrido_en, p_al) - 1) end), 2)
    from partida p
    join asiento a on a.id = p.asiento_id
    join cuenta  c on c.organizacion_id = p.organizacion_id and c.codigo = p.cuenta
   where p.organizacion_id = p_org and a.ocurrido_en <= p_al
   group by c.codigo, c.nombre_es, c.nombre_en, c.naturaleza, c.monetaria
  having round(sum(p.monto_ves), 2) <> 0 or round(sum(case when c.monetaria then 0
                        else p.monto_ves * (factor_reexpresion(a.ocurrido_en, p_al) - 1) end), 2) <> 0
   order by c.codigo
$$;

-- El resultado monetario del ejercicio: lo que costo tener partidas monetarias
-- mientras la moneda perdia valor. Es la cifra que hace cuadrar el balance
-- reexpresado, y no es un ajuste de cuadre: es una perdida real.
create or replace function resultado_monetario(p_org uuid, p_al date)
returns numeric(20,2)
language sql stable as $$
  select -coalesce(round(sum(ajuste), 2), 0) from reexpresar(p_org, p_al)
$$;

-- Genera el asiento de reexpresion: ajusta cada cuenta no monetaria y lleva la
-- diferencia al resultado monetario. Como todo lo demas, es un asiento normal
-- que se puede reversar.
create or replace function asentar_reexpresion(p_org uuid, p_anio int, p_mes int, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  r      record;
  a_id   uuid := gen_random_uuid();
  fin    date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  linea  int := 0;
  reme   numeric(20,2);
  fx     uuid;
begin
  if exists (select 1 from asiento
              where organizacion_id = p_org and origen_tipo = 'reexpresion'
                and anio = p_anio and mes = p_mes and reversa_a is null) then
    raise exception 'El mes %-% ya está reexpresado. Para rehacerlo, reversa su asiento.', p_anio, p_mes;
  end if;

  fx := tasa_del_dia(fin);
  if fx is null then raise exception 'No hay tasa BCV vigente al %', fin; end if;

  reme := resultado_monetario(p_org, fin);
  if reme = 0 then return null; end if;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, p_org, siguiente_asiento(p_org), fin, p_anio, p_mes,
          'Reexpresión por inflación', 'Inflation restatement',
          'reexpresion', a_id, p_persona);

  for r in select * from reexpresar(p_org, fin) where not monetaria and ajuste <> 0
  loop
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta,
                         monto_ves, monto_usd, tasa_id)
    values (a_id, linea, p_org, r.codigo, r.ajuste,
            convertir(r.ajuste,'VES','USD',fx), fx);
  end loop;

  -- La contrapartida: el resultado monetario, en patrimonio.
  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta,
                       monto_ves, monto_usd, tasa_id)
  values (a_id, linea, p_org, cuenta_de(p_org,'reexpresion'), reme,
          convertir(reme,'VES','USD',fx), fx);

  return a_id;
end $$;
