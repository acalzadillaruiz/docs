-- GPS Nexus · pagos emitidos y conciliacion bancaria
--
-- El otro lado del cobro. Y la conciliacion, que es la pantalla donde se descubre
-- que la contabilidad y el banco llevaban tres meses diciendo cosas distintas.
--
-- Principio: lo que no casa NO se esconde. Un movimiento del banco sin su documento,
-- o un documento sin su movimiento, se queda senalado hasta que alguien lo explique.
-- El descuadre que nadie ve es el que acaba costando dinero.

create table pago (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  documento_id    uuid references documento_fiscal(id),
  beneficiario_id uuid not null references organizacion(id),
  fecha           date not null,

  medio           medio_pago not null,
  moneda          moneda not null,
  monto           numeric(20,2) not null check (monto > 0),
  tasa_id         uuid not null references tasa_bcv(id),
  referencia      text,
  -- Caja chica: el soporte fotografiado desde el telefono. Se guarda la huella del
  -- archivo, no el archivo: el contenido vive en el almacen de documentos.
  soporte_huella  text,

  asiento_id      uuid references asiento(id),
  registrado_en   timestamptz not null default now(),
  registrado_por  uuid not null references persona(id)
);

create index pago_documento_ix on pago (documento_id);
create index pago_fecha_ix     on pago (organizacion_id, fecha);

-- Lo que queda por pagar de una factura de proveedor: el total menos lo retenido
-- menos lo ya pagado. Igual que el cobro, se resta, no se guarda.
create or replace function saldo_documento(p_documento uuid) returns numeric(20,2)
language sql stable as $$
  select d.base_ves + d.iva_ves
       - coalesce((select sum(r.monto_ves) from retencion r where r.documento_id = d.id), 0)
       - coalesce((select sum(case when p.moneda = 'VES' then p.monto
                                   else convertir(p.monto,'USD','VES',p.tasa_id) end)
                     from pago p where p.documento_id = d.id), 0)
    from documento_fiscal d where d.id = p_documento
$$;

-- -----------------------------------------------------------------------------
--   Debe   Cuentas por pagar        lo pagado
--   Debe   IGTF (gasto)             si el pago fue en divisa
--       Haber  Banco                            lo que sale de la cuenta
create or replace function asentar_pago(p_pago uuid, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  p      record;
  a_id   uuid := gen_random_uuid();
  org    uuid;
  igtf   numeric(20,2) := 0;
  linea  int := 0;
  saldo  numeric(20,2);
begin
  select * into p from pago where id = p_pago;
  if p is null then raise exception 'El pago % no existe', p_pago; end if;
  if p.asiento_id is not null then
    raise exception 'El pago % ya tiene asiento. Para corregir, registra su reverso.', p_pago;
  end if;

  org := p.organizacion_id;

  if p.documento_id is not null then
    saldo := saldo_documento(p.documento_id);
    if saldo < 0 then
      raise exception 'El pago excede lo que se debe de esa factura en %', -saldo;
    end if;
  end if;

  if p.medio = 'divisa_efectivo' or (p.moneda = 'USD' and p.medio <> 'compensacion') then
    igtf := calcular_igtf(p.monto, p.fecha);
  end if;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, org, siguiente_asiento(org), p.fecha,
          extract(year from p.fecha)::int, extract(month from p.fecha)::int,
          'Pago ' || coalesce(p.referencia,''), 'Payment ' || coalesce(p.referencia,''),
          'pago', p_pago, p_persona);

  linea := 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, org, cuenta_de(org,'cxp'),
          case when p.moneda='VES' then p.monto else convertir(p.monto,'USD','VES',p.tasa_id) end,
          case when p.moneda='USD' then p.monto else convertir(p.monto,'VES','USD',p.tasa_id) end,
          p.tasa_id);

  if igtf <> 0 then
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, org, cuenta_de(org,'igtf_gasto'),
            case when p.moneda='VES' then igtf else convertir(igtf,'USD','VES',p.tasa_id) end,
            case when p.moneda='USD' then igtf else convertir(igtf,'VES','USD',p.tasa_id) end,
            p.tasa_id);
  end if;

  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, org, cuenta_de(org,'banco'),
          case when p.moneda='VES' then -(p.monto + igtf)
               else convertir(-(p.monto + igtf),'USD','VES',p.tasa_id) end,
          case when p.moneda='USD' then -(p.monto + igtf)
               else convertir(-(p.monto + igtf),'VES','USD',p.tasa_id) end,
          p.tasa_id);

  update pago set asiento_id = a_id where id = p_pago;
  return a_id;
end $$;

-- Lo que toca pagar, ordenado por vencimiento y por lo que bloquea.
--
-- Devuelve tambien el id del documento, porque desde esta misma lista se paga: una lista de deudas de la que no se puede pagar obliga a buscar la factura
-- otra vez en otra pantalla, y ahi es donde se paga la que no era.
--
-- Cambiar las columnas que devuelve una funcion 'returns table' no lo admite
-- 'create or replace': hay que tirarla antes. El esquema se carga entero y en orden,
-- asi que esto es inofensivo aqui y no lo seria en una base ya viva.
drop function if exists por_pagar(uuid, date);
create or replace function por_pagar(p_org uuid, p_al date)
returns table (proveedor text, factura text, fecha date, dias int,
               saldo numeric(20,2), contrato text, documento uuid)
language sql stable as $$
  select o.nombre, d.numero, d.fecha, (p_al - d.fecha)::int,
         saldo_documento(d.id), c.codigo, d.id
    from documento_fiscal d
    join organizacion o on o.id = d.contraparte_id
    left join contrato c on c.id = d.contrato_id
   where d.organizacion_id = p_org
     and d.sentido = 'recibido'
     and d.fecha <= p_al
     and saldo_documento(d.id) > 0
   order by d.fecha
$$;

-- -----------------------------------------------------------------------------
-- Pagar una factura de proveedor: la fila del pago y su asiento, en un solo acto.
--
-- Estaban las dos mitades —la tabla 'pago' y 'asentar_pago'— y no habia forma de
-- llegar a ellas desde ninguna pantalla. Una contabilidad donde entran facturas y no
-- sale nunca un pago da un saldo de proveedores que crece para siempre y no es el de
-- nadie.
create or replace function registrar_pago(
  p_documento uuid, p_fecha date, p_medio medio_pago, p_moneda moneda,
  p_monto numeric, p_referencia text, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  d    record;
  tasa uuid := tasa_del_dia(p_fecha);
  id_p uuid := gen_random_uuid();
begin
  select * into d from documento_fiscal where id = p_documento;
  if d is null then raise exception 'El documento % no existe', p_documento; end if;
  if d.sentido <> 'recibido' then
    raise exception 'Esto paga facturas recibidas. Un cobro se registra por otro sitio.';
  end if;
  if tasa is null then
    raise exception 'No hay tasa del BCV publicada para el %', p_fecha;
  end if;

  insert into pago (id, organizacion_id, documento_id, beneficiario_id, fecha, medio,
                    moneda, monto, tasa_id, referencia, registrado_por)
  values (id_p, d.organizacion_id, p_documento, d.contraparte_id, p_fecha, p_medio,
          p_moneda, round(p_monto, 2), tasa, p_referencia, p_persona);

  perform asentar_pago(id_p, p_persona);
  return id_p;
end $$;

-- Los pagos ya hechos de una factura. Se enseñan debajo de la deuda: un pago que no
-- se ve es un pago que se hace dos veces.
create or replace function pagos_de(p_documento uuid)
returns table (id uuid, fecha date, medio text, moneda moneda, monto numeric(20,2),
               referencia text, asiento bigint)
language sql stable as $$
  select p.id, p.fecha, p.medio::text, p.moneda, p.monto, p.referencia, a.numero
    from pago p
    left join asiento a on a.id = p.asiento_id
   where p.documento_id = p_documento
   order by p.fecha, p.registrado_en
$$;

-- -----------------------------------------------------------------------------
-- Conciliacion bancaria.

create table movimiento_banco (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  cuenta          text not null,
  fecha           date not null,
  -- Positivo entra, negativo sale. Tal como viene del extracto.
  monto           numeric(20,2) not null check (monto <> 0),
  moneda          moneda not null,
  descripcion     text,
  referencia      text,
  -- A que lo casamos. Nulo mientras nadie lo explique, y eso se ve.
  cobro_id        uuid references cobro(id),
  pago_id         uuid references pago(id),
  conciliado_en   timestamptz,
  conciliado_por  uuid references persona(id),
  -- Si no casa con nada pero se acepta igual, hay que decir por que. Por escrito.
  nota            text,
  constraint casa_con_uno check (num_nonnulls(cobro_id, pago_id) <= 1),
  constraint conciliado_tiene_motivo check (
    conciliado_en is null
    or cobro_id is not null or pago_id is not null or nota is not null)
);

create index mov_banco_ix on movimiento_banco (organizacion_id, fecha);
create unique index mov_cobro_uq on movimiento_banco (cobro_id) where cobro_id is not null;
create unique index mov_pago_uq  on movimiento_banco (pago_id)  where pago_id  is not null;

-- Propone casamientos: mismo importe, misma direccion, y a menos de cinco dias.
-- PROPONE. No casa nada: el que casa es un humano, porque dos movimientos del mismo
-- importe el mismo dia son mas frecuentes de lo que parece.
create or replace function proponer_conciliacion(p_org uuid, p_desde date, p_hasta date)
returns table (movimiento uuid, fecha date, monto numeric(20,2), descripcion text,
               casa_con text, candidato uuid, dias_de_diferencia int)
language sql stable as $$
  select m.id, m.fecha, m.monto, m.descripcion, 'cobro', c.id, abs(m.fecha - c.fecha)::int
    from movimiento_banco m
    join cobro c on c.organizacion_id = m.organizacion_id
                and c.monto = m.monto
                and c.moneda = m.moneda
                and abs(m.fecha - c.fecha) <= 5
   where m.organizacion_id = p_org and m.conciliado_en is null and m.monto > 0
     and m.fecha between p_desde and p_hasta
     and not exists (select 1 from movimiento_banco x where x.cobro_id = c.id)
  union all
  select m.id, m.fecha, m.monto, m.descripcion, 'pago', p.id, abs(m.fecha - p.fecha)::int
    from movimiento_banco m
    join pago p on p.organizacion_id = m.organizacion_id
               and p.monto = -m.monto
               and p.moneda = m.moneda
               and abs(m.fecha - p.fecha) <= 5
   where m.organizacion_id = p_org and m.conciliado_en is null and m.monto < 0
     and m.fecha between p_desde and p_hasta
     and not exists (select 1 from movimiento_banco x where x.pago_id = p.id)
   order by 2, 7
$$;

-- Lo que NO casa, a los dos lados. Es la parte de la pantalla que nadie quiere mirar
-- y la unica que de verdad hace falta.
create or replace function descuadres_banco(p_org uuid, p_desde date, p_hasta date)
returns table (lado text, id uuid, fecha date, monto numeric(20,2), detalle text)
language sql stable as $$
  select 'solo en el banco', m.id, m.fecha, m.monto, coalesce(m.descripcion,'(sin descripción)')
    from movimiento_banco m
   where m.organizacion_id = p_org and m.conciliado_en is null
     and m.fecha between p_desde and p_hasta
  union all
  select 'solo en la contabilidad', c.id, c.fecha, c.monto, 'Cobro ' || coalesce(c.referencia,'')
    from cobro c
   where c.organizacion_id = p_org and c.fecha between p_desde and p_hasta
     and not exists (select 1 from movimiento_banco m where m.cobro_id = c.id)
  union all
  select 'solo en la contabilidad', p.id, p.fecha, -p.monto, 'Pago ' || coalesce(p.referencia,'')
    from pago p
   where p.organizacion_id = p_org and p.fecha between p_desde and p_hasta
     and not exists (select 1 from movimiento_banco m where m.pago_id = p.id)
   order by 3
$$;
