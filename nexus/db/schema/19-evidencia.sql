-- GPS Nexus · hitos y evidencia
--
-- Esta es la tesis del proyecto, y el motivo de que valga la pena construirlo:
--
--                    SIN EVIDENCIA NO HAY AVANCE.
--
-- En el sistema de hoy el avance es un numero que alguien escribe. Eso no es un
-- fallo del programa: es que nadie puede defender ese numero seis meses despues.
-- Cuando el cliente pregunta por que dice 58%, la respuesta honesta es 'porque
-- alguien lo escribio', y ahi se pierde la discusion.
--
-- Aqui no existe ninguna columna de avance en ninguna tabla. El avance se CALCULA
-- desde los hitos que tienen su evidencia verificada. Si se quiere subir el avance
-- hay exactamente una forma: traer el documento.
--
-- La evidencia se guarda por su huella SHA-256, no por su nombre. Tres consecuencias
-- que importan:
--   - El mismo archivo subido dos veces es un solo registro, y se sabe.
--   - Si alguien cambia el archivo por otro, la huella deja de cuadrar y se ve.
--   - Se puede demostrar que el documento que respalda el hito es exactamente el
--     mismo que se subio ese dia, sin confiar en nadie.

create type clase_evidencia as enum (
  'foto',            -- del patio
  'acta',            -- de recepcion, de inicio, de entrega
  'certificado',     -- MTR, FAT, calibracion
  'conocimiento',    -- de embarque
  'aduana',          -- DUA, planilla
  'factura',         -- del proveedor
  'informe',         -- de inspeccion, de ensayo
  'firma'            -- del cliente
);

create type estado_hito as enum (
  'pendiente',       -- ni empezado
  'declarado',       -- alguien dice que se hizo, pero no hay papel
  'evidenciado',     -- hay documento, sin verificar
  'verificado'       -- documento revisado y aceptado
);

-- El molde: que hitos lleva cada tipo de contrato, en que orden, y que evidencia
-- exige cada uno. Se configura una vez por tipo de servicio.
create table plantilla_hito (
  tipo            tipo_contrato not null,
  orden           int  not null,
  clave           text not null,
  nombre_es       text not null,
  nombre_en       text not null,
  -- Que peso tiene este hito dentro del renglon. La suma por tipo debe dar 100.
  peso            numeric(5,2) not null check (peso > 0),
  -- Que clases de evidencia hacen falta. Vacio significa que basta con declararlo,
  -- y eso se usa solo para hitos administrativos.
  exige           clase_evidencia[] not null default '{}',
  primary key (tipo, orden)
);

create unique index plantilla_clave_uq on plantilla_hito (tipo, clave);

-- Los hitos de un renglon concreto. Se crean al alta del contrato desde la plantilla.
create table hito (
  id              uuid primary key default gen_random_uuid(),
  renglon_id      uuid not null references renglon(id) on delete cascade,
  orden           int  not null,
  clave           text not null,
  nombre_es       text not null,
  nombre_en       text not null,
  peso            numeric(5,2) not null,
  exige           clase_evidencia[] not null default '{}',

  estado          estado_hito not null default 'pendiente',

  -- Las tres fechas. Planificada al firmar, pronosticada cuando cambia la realidad,
  -- real cuando ocurrio. Tener las tres es lo que permite avisar ANTES.
  planificada     date,
  pronosticada    date,
  -- 'ocurrido_en': cuando paso de verdad. 'registrado_en': cuando se supo aqui.
  -- La diferencia entre las dos es el tiempo hasta la verdad, y se mide.
  ocurrido_en     date,
  registrado_en   timestamptz,
  registrado_por  uuid references persona(id),

  unique (renglon_id, orden)
);

create index hito_renglon_ix on hito (renglon_id, orden);
create index hito_estado_ix  on hito (estado);

create table evidencia (
  id              uuid primary key default gen_random_uuid(),
  hito_id         uuid not null references hito(id) on delete cascade,
  clase           clase_evidencia not null,
  -- La huella del contenido. Es la identidad del documento: dos archivos con la
  -- misma huella son el mismo archivo, se llamen como se llamen.
  huella          text not null check (huella ~ '^[0-9a-f]{64}$'),
  nombre          text not null,
  bytes           bigint not null check (bytes > 0),
  tipo_mime       text not null,

  -- Cuando se tomo la foto o se firmo el acta, que no es cuando se subio.
  ocurrido_en     date,
  subida_en       timestamptz not null default now(),
  subida_por      uuid not null references persona(id),

  -- Verificada por alguien de GPS. Hasta entonces el hito esta 'evidenciado',
  -- no 'verificado', y esa diferencia es la brecha de evidencia.
  verificada_en   timestamptz,
  verificada_por  uuid references persona(id),
  rechazada_en    timestamptz,
  rechazada_por   uuid references persona(id),
  motivo_rechazo  text,

  constraint verificada_o_rechazada check (
    verificada_en is null or rechazada_en is null
  ),
  constraint rechazo_tiene_motivo check (
    rechazada_en is null or btrim(coalesce(motivo_rechazo,'')) <> ''
  ),
  constraint rechazo_tiene_quien check (
    rechazada_en is null or rechazada_por is not null
  )
);

create index evidencia_hito_ix on evidencia (hito_id);
create index evidencia_huella_ix on evidencia (huella);
create index evidencia_sin_verificar_ix on evidencia (hito_id)
  where verificada_en is null and rechazada_en is null;

-- -----------------------------------------------------------------------------
-- La regla, hecha cumplir por la base de datos.
--
-- Un hito NO puede ponerse en 'evidenciado' ni en 'verificado' si le falta alguna
-- de las clases de evidencia que exige. Esto es lo que convierte la tesis en algo
-- que no se puede saltar escribiendo en otra pantalla.
create or replace function verificar_evidencia_del_hito() returns trigger
language plpgsql security definer as $$
declare
  falta clase_evidencia[];
begin
  if new.estado not in ('evidenciado','verificado') then return new; end if;
  if cardinality(new.exige) = 0 then return new; end if;

  select array_agg(c) into falta
    from unnest(new.exige) c
   where not exists (
     select 1 from evidencia e
      where e.hito_id = new.id
        and e.clase = c
        and e.rechazada_en is null
        and (new.estado = 'evidenciado' or e.verificada_en is not null)
   );

  if falta is not null then
    raise exception 'Al hito "%" le falta evidencia: %', new.clave,
      array_to_string(falta, ', ');
  end if;
  return new;
end $$;

create trigger hito_exige_su_evidencia
  before update of estado on hito
  for each row execute function verificar_evidencia_del_hito();

-- El avance de un renglon: la suma de los pesos de sus hitos verificados.
-- No hay otra forma de calcularlo, y no hay ninguna columna que lo guarde.
create or replace function avance_renglon(p_renglon uuid, p_hasta date default current_date)
returns numeric(5,2)
language sql stable as $$
  select coalesce(round(sum(peso) filter (
           where estado = 'verificado' and (ocurrido_en is null or ocurrido_en <= p_hasta)
         ), 2), 0)
    from hito where renglon_id = p_renglon
$$;

-- Lo que alguien declaro pero todavia no se puede probar.
create or replace function avance_declarado(p_renglon uuid, p_hasta date default current_date)
returns numeric(5,2)
language sql stable as $$
  select coalesce(round(sum(peso) filter (
           where estado in ('declarado','evidenciado','verificado')
             and (ocurrido_en is null or ocurrido_en <= p_hasta)
         ), 2), 0)
    from hito where renglon_id = p_renglon
$$;

-- -----------------------------------------------------------------------------
-- Las tres cifras del proyecto. Ninguna existe en el sistema de hoy.

/**
 * BRECHA DE EVIDENCIA: cuanto de lo que se declara hecho no se podria probar.
 *
 * Es la diferencia entre lo declarado y lo verificado, valorada en dinero. Es la
 * cifra que nadie quiere ver y que todos necesitan: mide exactamente cuanto de lo
 * que se le esta contando al cliente se derrumbaria si lo pidiera por escrito.
 */
create or replace function brecha_evidencia(p_org uuid, p_hasta date default current_date)
returns table (
  contrato      text,
  cliente       text,
  declarado     numeric(20,2),
  evidenciado   numeric(20,2),
  brecha        numeric(20,2),
  brecha_pct    numeric(6,2),
  moneda        moneda
)
language sql stable as $$
  with r as (
    select ct.id ctr, ct.codigo, o.nombre cliente, ct.moneda,
           rg.cantidad * rg.precio_unitario valor,
           avance_declarado(rg.id, p_hasta) / 100 pd,
           avance_renglon(rg.id, p_hasta)  / 100 pv
      from renglon rg
      join contrato ct on ct.id = rg.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.organizacion_id = p_org and ct.estado <> 'borrador'
  )
  select codigo, cliente,
         round(sum(valor * pd), 2),
         round(sum(valor * pv), 2),
         round(sum(valor * (pd - pv)), 2),
         case when sum(valor * pd) = 0 then 0
              else round(sum(valor * (pd - pv)) / sum(valor * pd) * 100, 2) end,
         moneda
    from r
   group by ctr, codigo, cliente, moneda
  having round(sum(valor * (pd - pv)), 2) <> 0
   order by 5 desc
$$;

/**
 * TIEMPO HASTA LA VERDAD: cuanto tarda un hecho del patio en llegar al sistema.
 *
 * La mediana de (registrado_en - ocurrido_en). No es una metrica de vanidad: si
 * un hecho tarda doce dias en llegar, entonces cualquier decision que se tome hoy
 * se esta tomando con una foto de hace doce dias, y eso explica por que las cosas
 * 'se descubren tarde'.
 */
create or replace function tiempo_hasta_la_verdad(
  p_org uuid, p_desde date default current_date - 90, p_hasta date default current_date)
returns table (
  contrato   text,
  hechos     int,
  mediana    numeric(6,1),
  peor       int
)
language sql stable as $$
  select ct.codigo, count(*)::int,
         round(percentile_cont(0.5) within group (
           order by (h.registrado_en::date - h.ocurrido_en))::numeric, 1),
         max(h.registrado_en::date - h.ocurrido_en)::int
    from hito h
    join renglon rg on rg.id = h.renglon_id
    join contrato ct on ct.id = rg.contrato_id
   where ct.organizacion_id = p_org
     and h.ocurrido_en is not null and h.registrado_en is not null
     and h.ocurrido_en between p_desde and p_hasta
   group by ct.codigo
   order by 3 desc
$$;

/**
 * COBERTURA: cuanto se ha vendido arriba sin haber comprado abajo.
 *
 * Por cada contrato, el valor de los renglones que todavia no tienen ninguna orden
 * de compra ni ningun costo imputado. Es el riesgo que no aparece en ningun informe
 * hasta que llega la fecha y no hay con que cumplir.
 */
create or replace function cobertura(p_org uuid)
returns table (
  contrato     text,
  cliente      text,
  vendido      numeric(20,2),
  con_respaldo numeric(20,2),
  sin_respaldo numeric(20,2),
  moneda       moneda
)
language sql stable as $$
  with r as (
    select ct.id ctr, ct.codigo, o.nombre cliente, ct.moneda,
           rg.cantidad * rg.precio_unitario valor,
           exists (select 1 from partida p
                     join cuenta c on c.organizacion_id = p.organizacion_id and c.codigo = p.cuenta
                    where p.contrato_id = ct.id and c.naturaleza = 'gasto') respaldado
      from renglon rg
      join contrato ct on ct.id = rg.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.organizacion_id = p_org and ct.estado = 'vigente'
  )
  select codigo, cliente,
         round(sum(valor), 2),
         round(sum(valor) filter (where respaldado), 2),
         round(coalesce(sum(valor) filter (where not respaldado), 0), 2),
         moneda
    from r
   group by ctr, codigo, cliente, moneda
  having coalesce(sum(valor) filter (where not respaldado), 0) > 0
   order by 5 desc
$$;

-- -----------------------------------------------------------------------------
-- El estado del hito se DERIVA de su evidencia. No se teclea.
--
-- Dejar que alguien escriba 'verificado' a mano y que el disparador de arriba solo
-- diga que no cuando falta algo, deja un hueco al reves: una evidencia rechazada
-- despues de verificar el hito lo dejaria verificado para siempre. Aqui el estado
-- se vuelve a calcular entero desde lo que hay, y puede BAJAR.
create or replace function recalcular_hito(p_hito uuid) returns estado_hito
language plpgsql security definer as $$
declare
  h        hito%rowtype;
  completas int;
  algunas   int;
  nuevo    estado_hito;
begin
  if not es_interna() then
    raise exception 'recalcular el estado de un hito es cosa de dentro';
  end if;

  select * into h from hito where id = p_hito;
  if not found then raise exception 'el hito % no existe', p_hito; end if;

  -- Un hito sin evidencia exigida es administrativo: lo marca una persona y no hay
  -- nada que derivar.
  if cardinality(h.exige) = 0 then return h.estado; end if;

  select count(*) filter (where verificada), count(*) filter (where presente)
    into completas, algunas
    from (
      select exists (select 1 from evidencia e
                      where e.hito_id = h.id and e.clase = c
                        and e.rechazada_en is null and e.verificada_en is not null) verificada,
             exists (select 1 from evidencia e
                      where e.hito_id = h.id and e.clase = c
                        and e.rechazada_en is null) presente
        from unnest(h.exige) c
    ) t;

  nuevo := case
    when completas = cardinality(h.exige) then 'verificado'
    when algunas   = cardinality(h.exige) then 'evidenciado'
    when h.ocurrido_en is not null        then 'declarado'
    else 'pendiente'
  end;

  if nuevo is distinct from h.estado then
    update hito set estado = nuevo where id = h.id;
  end if;
  return nuevo;
end $$;

-- Que documento le FALTA a un hito, dicho en una linea. La pantalla no tiene que
-- averiguarlo: lo pregunta.
--
-- 'Falta' significa que no hay ningun documento de esa clase, no que lo haya y este
-- sin revisar. Son dos cosas distintas y llevan a dos acciones distintas: una es ir
-- a buscar el papel al patio, la otra es que alguien de aqui lo mire. Mezclarlas en
-- una sola lista hace que se busque otra vez un papel que ya estaba.
create or replace function falta_al_hito(p_hito uuid) returns clase_evidencia[]
language sql stable as $$
  select array_agg(c order by c)
    from hito h, unnest(h.exige) c
   where h.id = p_hito
     and not exists (select 1 from evidencia e
                      where e.hito_id = h.id and e.clase = c
                        and e.rechazada_en is null)
$$;

-- -----------------------------------------------------------------------------
-- Aislamiento. Los hitos y su evidencia siguen al contrato del que cuelgan.
--
-- El cliente SI ve los hitos y los documentos que los respaldan: ese es el sentido
-- entero de esto. Un avance que el cliente no puede auditar vuelve a ser un numero
-- que alguien escribio.
--
-- Con una excepcion que no se negocia: la FACTURA DEL PROVEEDOR. Es evidencia
-- legitima de que el material se compro, y lleva dentro el precio de compra. El
-- cliente no tiene por que ver el margen, asi que esa clase no sale de GPS.

alter table hito      enable row level security;
alter table evidencia enable row level security;

create policy hito_vista on hito for select using (
  exists (select 1 from renglon r where r.id = hito.renglon_id)
);

create policy hito_escritura on hito for all
  using  (es_interna() and exists (select 1 from renglon r where r.id = hito.renglon_id))
  with check (es_interna() and exists (select 1 from renglon r where r.id = hito.renglon_id));

create policy evidencia_vista on evidencia for select using (
  exists (select 1 from hito h where h.id = evidencia.hito_id)
  and (es_interna() or clase <> 'factura')
);

create policy evidencia_escritura on evidencia for all
  using  (es_interna() and exists (select 1 from hito h where h.id = evidencia.hito_id))
  with check (es_interna() and exists (select 1 from hito h where h.id = evidencia.hito_id));
