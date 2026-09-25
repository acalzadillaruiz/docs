-- GPS Nexus · caja chica
--
-- Es el dinero que se gasta sin pedir permiso: el taxi al pozo, la soldadura de
-- urgencia, el almuerzo de la cuadrilla. En casi todas las empresas venezolanas vive
-- en una libreta y aparece en la contabilidad tres meses despues, ya sin acordarse
-- nadie de a que contrato iba. Ahi es donde se pierde el margen de un contrato: no
-- en una factura grande, sino en cien gastos pequenos que nadie imputo.
--
-- ---------------------------------------------------------------------------------
-- SUPUESTOS. Esto se construyo SIN esperar a que el CEO contestara las ocho
-- preguntas, porque esperar ya costo semanas. Cada supuesto esta escrito aqui Y en
-- la pantalla, para que se corrija cuando se quiera. Ninguno esta enterrado en el
-- codigo: los seis se cambian en un sitio.
--
--   1. FONDO FIJO. La caja se abre con un importe y ese importe no cambia. El gasto
--      NO entra al libro cuando ocurre: entra cuando se repone. Es el sistema que
--      permite auditar la caja contando el efectivo una sola vez — fondo = efectivo
--      + vales pendientes, siempre, sin mirar el libro.
--   2. SIN SOPORTE NO SE REPONE. Un vale sin su papel fotografiado baja el efectivo
--      (el dinero salio igual) pero no entra en la reposicion. Es la misma tesis que
--      el resto del sistema: sin evidencia no hay avance, y aqui, sin evidencia no
--      se devuelve el dinero.
--   3. SIN IVA. Un vale de caja chica va integro a gasto y no genera credito fiscal.
--      Lo que se compra con caja chica casi nunca trae factura con RIF, y desglosar
--      un IVA que el SENIAT no va a reconocer infla el credito fiscal.
--   4. LA REPOSICION SALE DEL BANCO, no de otra caja ni de efectivo del dueno.
--   5. UNA CAJA, UNA MONEDA. Se elige al abrirla. Una caja mixta obliga a decidir a
--      que tasa se conto el efectivo el dia del arqueo, y ese es el agujero por
--      donde se cuelan los descuadres en Venezuela.
--   6. UN VALE GRANDE NO ES CAJA CHICA. Por encima del 10% del fondo se avisa en
--      pantalla, pero no se bloquea: quien esta en el pozo no puede quedarse parado
--      porque el sistema opine. Se avisa, se registra, y se ve.
-- ---------------------------------------------------------------------------------

create table caja_chica (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  nombre          text not null,
  moneda          moneda not null,
  fondo_fijo      numeric(20,2) not null check (fondo_fijo > 0),
  -- Supuesto 6: por encima de este porcentaje del fondo, el vale se senala.
  vale_grande_pct numeric(5,2) not null default 10 check (vale_grande_pct > 0 and vale_grande_pct <= 100),
  -- Por debajo de este porcentaje de efectivo, toca reponer. Se avisa, no se obliga.
  reponer_bajo_pct numeric(5,2) not null default 30 check (reponer_bajo_pct > 0 and reponer_bajo_pct < 100),
  responsable_id  uuid not null references persona(id),
  cuenta          text not null,
  abierta_el      date not null,
  cerrada_el      date,
  asiento_apertura uuid references asiento(id),
  asiento_cierre   uuid references asiento(id),
  unique (organizacion_id, nombre),
  foreign key (organizacion_id, cuenta) references cuenta (organizacion_id, codigo)
);

create table reposicion (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  caja_id         uuid not null references caja_chica(id),
  fecha           date not null,
  monto           numeric(20,2) not null check (monto > 0),
  asiento_id      uuid references asiento(id),
  registrado_en   timestamptz not null default now(),
  registrado_por  uuid not null references persona(id)
);

create index reposicion_caja_ix on reposicion (caja_id, fecha desc);

create table vale (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  caja_id         uuid not null references caja_chica(id),
  numero          int not null,
  -- Bitemporal, como todo lo demas: cuando se gasto y cuando se supo. El segundo no
  -- se toca nunca. En caja chica la diferencia entre los dos es el problema entero:
  -- el gasto del martes que aparece el viernes de la semana siguiente.
  ocurrido_en     date not null,
  registrado_en   timestamptz not null default now(),
  registrado_por  uuid not null references persona(id),

  concepto        text not null,
  beneficiario    text,
  monto           numeric(20,2) not null check (monto > 0),
  cuenta_gasto    text not null,
  -- A que contrato se imputa. Es la razon de ser de esta tabla: cien gastos pequenos
  -- sin contrato son margen que desaparece sin que nadie sepa de donde.
  contrato_id     uuid references contrato(id),

  -- Supuesto 2: la huella del papel fotografiado. Sin esto no entra en reposicion.
  soporte_huella  text,
  anulado_el      date,
  motivo_anulacion text,
  reposicion_id   uuid references reposicion(id),

  unique (caja_id, numero),
  foreign key (organizacion_id, cuenta_gasto) references cuenta (organizacion_id, codigo),
  constraint anulado_tiene_motivo check (
    (anulado_el is null and motivo_anulacion is null) or
    (anulado_el is not null and motivo_anulacion is not null)),
  -- Un vale anulado no puede estar repuesto: seria dinero devuelto por un gasto que
  -- se declaro inexistente.
  constraint anulado_no_repuesto check (anulado_el is null or reposicion_id is null)
);

create index vale_caja_ix     on vale (caja_id, ocurrido_en desc);
create index vale_pendiente_ix on vale (caja_id) where reposicion_id is null and anulado_el is null;
create index vale_contrato_ix on vale (contrato_id) where contrato_id is not null;

-- -----------------------------------------------------------------------------
-- El efectivo que deberia haber en la caja AHORA MISMO.
--
-- Supuesto 1 en una linea: fondo fijo menos los vales pendientes. No se consulta el
-- libro, porque el libro todavia no sabe nada de esos vales — y esa es justamente la
-- propiedad que hace que la caja se pueda arquear contando billetes.
create or replace function efectivo_caja(p_caja uuid) returns numeric(20,2)
language sql stable as $$
  select c.fondo_fijo - coalesce((
           select sum(v.monto) from vale v
            where v.caja_id = c.id and v.reposicion_id is null and v.anulado_el is null), 0)
    from caja_chica c where c.id = p_caja
$$;

-- Lo que se va a devolver en la proxima reposicion: solo los vales CON soporte.
-- La diferencia entre esto y (fondo - efectivo) es exactamente el dinero gastado que
-- nadie ha justificado todavia. Esa diferencia es la cifra que importa.
create or replace function por_reponer(p_caja uuid) returns numeric(20,2)
language sql stable as $$
  select coalesce(sum(v.monto), 0)::numeric(20,2) from vale v
   where v.caja_id = p_caja and v.reposicion_id is null and v.anulado_el is null
     and v.soporte_huella is not null
$$;

-- Lo gastado sin papel. Supuesto 2: no se repone, pero se VE.
create or replace function sin_soporte(p_caja uuid) returns numeric(20,2)
language sql stable as $$
  select coalesce(sum(v.monto), 0)::numeric(20,2) from vale v
   where v.caja_id = p_caja and v.reposicion_id is null and v.anulado_el is null
     and v.soporte_huella is null
$$;

-- -----------------------------------------------------------------------------
-- Abrir la caja.
--
--   Debe   Caja chica     el fondo
--       Haber  Banco                  el fondo
create or replace function abrir_caja(
  p_org uuid, p_nombre text, p_moneda moneda, p_fondo numeric,
  p_responsable uuid, p_fecha date, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  id_c  uuid := gen_random_uuid();
  a_id  uuid := gen_random_uuid();
  tasa  uuid := tasa_del_dia(p_fecha);
  ves   numeric(20,2);
  usd   numeric(20,2);
begin
  if tasa is null then
    raise exception 'No hay tasa del BCV publicada para el %', p_fecha;
  end if;

  insert into caja_chica (id, organizacion_id, nombre, moneda, fondo_fijo,
                          responsable_id, cuenta, abierta_el)
  values (id_c, p_org, p_nombre, p_moneda, round(p_fondo, 2), p_responsable,
          cuenta_de(p_org, 'caja_chica'), p_fecha);

  ves := case when p_moneda = 'VES' then round(p_fondo,2) else convertir(p_fondo,'USD','VES',tasa) end;
  usd := case when p_moneda = 'USD' then round(p_fondo,2) else convertir(p_fondo,'VES','USD',tasa) end;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, p_org, siguiente_asiento(p_org), p_fecha,
          extract(year from p_fecha)::int, extract(month from p_fecha)::int,
          'Apertura de caja chica ' || p_nombre, 'Petty cash opening ' || p_nombre,
          'caja_apertura', id_c, p_persona);

  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, 1, p_org, cuenta_de(p_org,'caja_chica'),  ves,  usd, tasa),
         (a_id, 2, p_org, cuenta_de(p_org,'banco'),      -ves, -usd, tasa);

  update caja_chica set asiento_apertura = a_id where id = id_c;
  return id_c;
end $$;

-- -----------------------------------------------------------------------------
-- Anotar un vale. No genera asiento: supuesto 1.
create or replace function anotar_vale(
  p_caja uuid, p_fecha date, p_concepto text, p_monto numeric,
  p_cuenta_gasto text, p_contrato uuid, p_beneficiario text,
  p_soporte text, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  c    record;
  id_v uuid := gen_random_uuid();
  n    int;
begin
  select * into c from caja_chica where id = p_caja;
  if c is null then raise exception 'La caja % no existe', p_caja; end if;
  if c.cerrada_el is not null then
    raise exception 'La caja % está cerrada desde el %', c.nombre, c.cerrada_el;
  end if;
  if p_fecha < c.abierta_el then
    raise exception 'El vale es anterior a la apertura de la caja (%)', c.abierta_el;
  end if;
  -- El efectivo no puede quedar en negativo: si el vale no cabe, es que falta una
  -- reposicion o que el vale no salio de esta caja. Las dos cosas hay que mirarlas
  -- antes de anotarlo, no despues.
  if efectivo_caja(p_caja) - round(p_monto, 2) < 0 then
    raise exception 'No hay tanto efectivo en la caja: quedan %', efectivo_caja(p_caja);
  end if;

  select coalesce(max(numero), 0) + 1 into n from vale where caja_id = p_caja;

  insert into vale (id, organizacion_id, caja_id, numero, ocurrido_en, registrado_por,
                    concepto, beneficiario, monto, cuenta_gasto, contrato_id, soporte_huella)
  values (id_v, c.organizacion_id, p_caja, n, p_fecha, p_persona,
          p_concepto, p_beneficiario, round(p_monto, 2), p_cuenta_gasto, p_contrato, p_soporte);
  return id_v;
end $$;

-- -----------------------------------------------------------------------------
-- Reponer la caja.
--
-- Aqui es donde el gasto entra al libro, agrupado por cuenta y por contrato — no un
-- asiento por vale. Treinta asientos de dos lineas hacen ilegible el mayor.
--
--   Debe   Cada cuenta de gasto     lo gastado, imputado a su contrato
--       Haber  Banco                            el total repuesto
create or replace function reponer_caja(p_caja uuid, p_fecha date, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  c     record;
  id_r  uuid := gen_random_uuid();
  a_id  uuid := gen_random_uuid();
  tasa  uuid := tasa_del_dia(p_fecha);
  total numeric(20,2);
  linea int := 0;
  s_ves numeric(20,2) := 0;
  s_usd numeric(20,2) := 0;
  g     record;
  m_ves numeric(20,2);
  m_usd numeric(20,2);
begin
  select * into c from caja_chica where id = p_caja;
  if c is null then raise exception 'La caja % no existe', p_caja; end if;
  if c.cerrada_el is not null then
    raise exception 'La caja % está cerrada desde el %', c.nombre, c.cerrada_el;
  end if;
  if tasa is null then
    raise exception 'No hay tasa del BCV publicada para el %', p_fecha;
  end if;

  total := por_reponer(p_caja);
  if total = 0 then
    raise exception 'No hay vales con soporte que reponer. Los que no tienen papel no cuentan.';
  end if;

  insert into reposicion (id, organizacion_id, caja_id, fecha, monto, registrado_por)
  values (id_r, c.organizacion_id, p_caja, p_fecha, total, p_persona);

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, c.organizacion_id, siguiente_asiento(c.organizacion_id), p_fecha,
          extract(year from p_fecha)::int, extract(month from p_fecha)::int,
          'Reposición de caja chica ' || c.nombre, 'Petty cash replenishment ' || c.nombre,
          'caja_reposicion', id_r, p_persona);

  for g in
    select v.cuenta_gasto, v.contrato_id, sum(v.monto) as monto
      from vale v
     where v.caja_id = p_caja and v.reposicion_id is null and v.anulado_el is null
       and v.soporte_huella is not null
     group by v.cuenta_gasto, v.contrato_id
     order by v.cuenta_gasto, v.contrato_id
  loop
    m_ves := case when c.moneda = 'VES' then g.monto else convertir(g.monto,'USD','VES',tasa) end;
    m_usd := case when c.moneda = 'USD' then g.monto else convertir(g.monto,'VES','USD',tasa) end;
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                         tasa_id, contrato_id)
    values (a_id, linea, c.organizacion_id, g.cuenta_gasto, m_ves, m_usd, tasa, g.contrato_id);
    s_ves := s_ves + m_ves;
    s_usd := s_usd + m_usd;
  end loop;

  -- La contrapartida se calcula SUMANDO las lineas, no convirtiendo el total otra
  -- vez: convertir dos veces redondea dos veces y deja el asiento descuadrado por
  -- centimos. Eso es un asiento rechazado y una tarde perdida buscando el porque.
  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, c.organizacion_id, cuenta_de(c.organizacion_id,'banco'), -s_ves, -s_usd, tasa);

  update reposicion set asiento_id = a_id where id = id_r;
  update vale set reposicion_id = id_r
   where caja_id = p_caja and reposicion_id is null and anulado_el is null
     and soporte_huella is not null;
  return id_r;
end $$;

-- -----------------------------------------------------------------------------
-- Cerrar la caja: vuelve el efectivo al banco.
--
--   Debe   Banco          el efectivo que queda
--       Haber  Caja chica             el fondo entero
--   Debe   Gasto                      lo gastado sin papel, si quedaba algo
--
-- Lo gastado sin soporte NO desaparece al cerrar: se lleva a 'Faltantes de caja' —
-- su propia cuenta, no diluido en otro gasto— y se ve en el libro. Una caja que cuadra sola escondiendo lo injustificado no sirve de nada.
create or replace function cerrar_caja(p_caja uuid, p_fecha date, p_persona uuid)
returns uuid
language plpgsql as $$
declare
  c      record;
  a_id   uuid := gen_random_uuid();
  tasa   uuid := tasa_del_dia(p_fecha);
  efvo   numeric(20,2);
  falta  numeric(20,2);
  linea  int := 0;
  f_ves  numeric(20,2) := 0;
  f_usd  numeric(20,2) := 0;
  e_ves  numeric(20,2);
  e_usd  numeric(20,2);
begin
  select * into c from caja_chica where id = p_caja;
  if c is null then raise exception 'La caja % no existe', p_caja; end if;
  if c.cerrada_el is not null then
    raise exception 'La caja % ya está cerrada', c.nombre;
  end if;
  if tasa is null then
    raise exception 'No hay tasa del BCV publicada para el %', p_fecha;
  end if;
  if por_reponer(p_caja) > 0 then
    raise exception 'Quedan vales con soporte sin reponer. Repone la caja antes de cerrarla.';
  end if;

  efvo  := efectivo_caja(p_caja);
  falta := sin_soporte(p_caja);

  e_ves := case when c.moneda = 'VES' then efvo else convertir(efvo,'USD','VES',tasa) end;
  e_usd := case when c.moneda = 'USD' then efvo else convertir(efvo,'VES','USD',tasa) end;

  insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                       descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
  values (a_id, c.organizacion_id, siguiente_asiento(c.organizacion_id), p_fecha,
          extract(year from p_fecha)::int, extract(month from p_fecha)::int,
          'Cierre de caja chica ' || c.nombre, 'Petty cash closing ' || c.nombre,
          'caja_cierre', p_caja, p_persona);

  linea := 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, c.organizacion_id, cuenta_de(c.organizacion_id,'banco'), e_ves, e_usd, tasa);

  if falta > 0 then
    f_ves := case when c.moneda = 'VES' then falta else convertir(falta,'USD','VES',tasa) end;
    f_usd := case when c.moneda = 'USD' then falta else convertir(falta,'VES','USD',tasa) end;
    linea := linea + 1;
    insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
    values (a_id, linea, c.organizacion_id, cuenta_de(c.organizacion_id,'caja_faltante'),
            f_ves, f_usd, tasa);
  end if;

  linea := linea + 1;
  insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
  values (a_id, linea, c.organizacion_id, c.cuenta, -(e_ves + f_ves), -(e_usd + f_usd), tasa);

  update vale set anulado_el = p_fecha, motivo_anulacion = 'Llevado a gasto al cerrar la caja'
   where caja_id = p_caja and reposicion_id is null and anulado_el is null;
  update caja_chica set cerrada_el = p_fecha, asiento_cierre = a_id where id = p_caja;
  return a_id;
end $$;

-- -----------------------------------------------------------------------------
-- Lo que se ha ido en caja chica por contrato. La cifra por la que existe el modulo.
--
-- Sale la moneda de la caja, y se agrupa por ella: dos cajas en monedas distintas no
-- se suman. Sumar bolivares con dolares y ensenar el resultado sin decir cual es, es
-- exactamente el error que hace que nadie se fie de una cifra.
create or replace function caja_por_contrato(p_org uuid, p_desde date, p_hasta date)
returns table (contrato text, cliente text, moneda moneda, gastado numeric(20,2),
               vales int, sin_papel numeric(20,2))
language sql stable as $$
  select coalesce(ct.codigo, '—') as contrato,
         coalesce(o.nombre, '—')  as cliente,
         c.moneda,
         sum(v.monto)::numeric(20,2) as gastado,
         count(*)::int as vales,
         coalesce(sum(v.monto) filter (where v.soporte_huella is null), 0)::numeric(20,2) as sin_papel
    from vale v
    join caja_chica c on c.id = v.caja_id
    left join contrato ct on ct.id = v.contrato_id
    left join organizacion o on o.id = ct.cliente_id
   where c.organizacion_id = p_org and v.anulado_el is null
     and v.ocurrido_en between p_desde and p_hasta
   group by ct.codigo, o.nombre, c.moneda
   order by sum(v.monto) desc
$$;

alter table caja_chica enable row level security;
alter table vale       enable row level security;
alter table reposicion enable row level security;

-- Caja chica es contabilidad: el cliente no la ve, ni de lejos. La politica esta
-- ademas de la negacion de permisos, no en su lugar: son dos vallas distintas y la
-- de permisos se puede conceder por error en un 'grant' amplio.
create policy caja_interna on caja_chica for all
  using (es_interna() and organizacion_id = org_actual());
create policy vale_interno on vale for all
  using (es_interna() and organizacion_id = org_actual());
create policy reposicion_interna on reposicion for all
  using (es_interna() and organizacion_id = org_actual());
