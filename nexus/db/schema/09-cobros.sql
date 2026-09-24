-- GPS Nexus · cobros y pagos
--
-- Cierra el ciclo: valuacion -> asiento -> cobro -> asiento. Cuando el cobro entra,
-- la cuenta por cobrar de esa valuacion queda en cero sola. Nadie la marca a mano.
--
-- El IGTF se causa aqui, no al facturar: el impuesto grava el pago en divisa, no la
-- factura. Por eso un cobro parcial en bolivares no lo causa y uno en dolares si.

create type medio_pago as enum ('transferencia','divisa_efectivo','cheque','compensacion');

create table cobro (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  valuacion_id    uuid references valuacion(id),
  documento_id    uuid references documento_fiscal(id),
  fecha           date not null,

  medio           medio_pago not null,
  moneda          moneda not null,
  monto           numeric(20,2) not null check (monto > 0),
  tasa_id         uuid not null references tasa_bcv(id),
  referencia      text,

  asiento_id      uuid references asiento(id),
  registrado_en   timestamptz not null default now(),
  registrado_por  uuid not null references persona(id),

  constraint cobro_tiene_origen check (valuacion_id is not null or documento_id is not null)
);

create index cobro_valuacion_ix on cobro (valuacion_id);

-- Cuanto queda por cobrar de una valuacion. Sale de restar, no de un campo que
-- alguien actualiza: un saldo guardado es un saldo que algun dia dejara de ser cierto.
create or replace function saldo_valuacion(p_valuacion uuid) returns numeric(20,2)
language sql stable as $$
  select neto_valuacion(p_valuacion)
       - coalesce((select sum(c.monto) from cobro c where c.valuacion_id = p_valuacion), 0)
$$;

-- -----------------------------------------------------------------------------
--   Debe   Banco                    lo cobrado, menos el IGTF si lo hubo
--   Debe   IGTF (gasto)             el impuesto, si el cobro fue en divisa
--       Haber  Cuentas por cobrar              lo cobrado
create or replace function asentar_cobro(p_cobro uuid, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  c      record;
  v      record;
  a_id   uuid := gen_random_uuid();
  org    uuid;
  igtf   numeric(20,2) := 0;
  linea  int := 0;
  saldo  numeric(20,2);
begin
  select * into c from cobro where id = p_cobro;
  if c is null then raise exception 'El cobro % no existe', p_cobro; end if;
  if c.asiento_id is not null then
    raise exception 'El cobro % ya tiene asiento. Para corregir, registra su reverso.', p_cobro;
  end if;

  org := c.organizacion_id;

  if c.valuacion_id is not null then
    select * into v from valuacion where id = c.valuacion_id;
    saldo := saldo_valuacion(c.valuacion_id);
    -- El cobro ya esta insertado, asi que el saldo ya lo descuenta. Si quedo negativo,
    -- es que se cobro de mas: se avisa en vez de dejarlo pasar.
    if saldo < 0 then
      raise exception 'El cobro excede lo pendiente de la valuación en %', -saldo;
    end if;
  end if;

  if c.medio = 'divisa_efectivo' or (c.moneda = 'USD' and c.medio <> 'compensacion') then
    igtf := calcular_igtf(c.monto, c.fecha);
  end if;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, org, siguiente_asiento(org), c.fecha,
          extract(year from c.fecha)::int, extract(month from c.fecha)::int,
          'Cobro ' || coalesce(c.referencia,''), 'Collection ' || coalesce(c.referencia,''),
          'cobro', p_cobro, p_persona);

  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, org, cuenta_de(org,'banco'),
          case when c.moneda='VES' then c.monto - igtf else convertir(c.monto - igtf,'USD','VES',c.tasa_id) end,
          case when c.moneda='USD' then c.monto - igtf else convertir(c.monto - igtf,'VES','USD',c.tasa_id) end,
          c.tasa_id);

  if igtf <> 0 then
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, org, cuenta_de(org,'igtf_gasto'),
            case when c.moneda='VES' then igtf else convertir(igtf,'USD','VES',c.tasa_id) end,
            case when c.moneda='USD' then igtf else convertir(igtf,'VES','USD',c.tasa_id) end,
            c.tasa_id);
  end if;

  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id, contrato_id)
  values (a_id, linea, org, cuenta_de(org,'cxc'),
          case when c.moneda='VES' then -c.monto else convertir(-c.monto,'USD','VES',c.tasa_id) end,
          case when c.moneda='USD' then -c.monto else convertir(-c.monto,'VES','USD',c.tasa_id) end,
          c.tasa_id, v.contrato_id);

  update cobro set asiento_id = a_id where id = p_cobro;
  if c.valuacion_id is not null and saldo_valuacion(c.valuacion_id) = 0 then
    update valuacion set estado = 'cobrada' where id = c.valuacion_id;
  end if;

  return a_id;
end $$;

-- Antiguedad de saldos: quien debe que, y desde cuando. Solo lo que queda vivo.
create or replace function antiguedad(p_org uuid, p_al date)
returns table (
  cliente      text,
  contrato     text,
  valuacion    int,
  vencida_el   date,
  dias         int,
  saldo        numeric(20,2),
  moneda       moneda
)
language sql stable as $$
  select cl.nombre, ct.codigo, v.numero, v.aprobada_el,
         (p_al - v.aprobada_el)::int,
         saldo_valuacion(v.id), v.moneda
    from valuacion v
    join contrato ct on ct.id = v.contrato_id
    join organizacion cl on cl.id = ct.cliente_id
   where v.organizacion_id = p_org
     and v.estado in ('aprobada','facturada')
     and v.aprobada_el <= p_al
     and saldo_valuacion(v.id) > 0
   order by v.aprobada_el
$$;
