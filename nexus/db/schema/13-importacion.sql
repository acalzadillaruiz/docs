-- GPS Nexus · importacion desde Excel
--
-- Es la pantalla que decide si esto se usa o se abandona. Hay anios de historico en
-- hojas de calculo y ninguna aplicacion sirve si hay que volver a teclearlo.
--
-- Como funciona, y por que asi:
--
--   1. La hoja entra TAL CUAL, fila por fila, en 'fila_cruda'. No se interpreta nada
--      todavia. Si algo sale mal despues, la hoja original sigue ahi, intacta.
--   2. La aplicacion propone un mapeo de columnas y lo ENSENA: "la columna 3 la
--      entendi como fecha". El humano corrige lo que este mal.
--   3. Se valida sin escribir nada. El resultado es una lista de lo que entraria y
--      de lo que no, con el motivo, fila por fila.
--   4. Solo entonces se confirma. Y todo lo que entra queda marcado con el lote,
--      de modo que un lote entero se puede revertir si se descubre que estaba mal.
--
-- Nunca se confirma una importacion que tenga filas con error. O entra limpia, o no
-- entra: una carga a medias es peor que no haber cargado, porque nadie sabe donde
-- se quedo.

create type estado_lote as enum ('cargado','mapeado','validado','confirmado','revertido');

create table lote_importacion (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  archivo         text not null,
  hoja            text,
  -- 'valuaciones', 'facturas_emitidas', 'facturas_recibidas', 'cobros', 'asientos'
  destino         text not null,
  estado          estado_lote not null default 'cargado',
  filas           int not null default 0,
  -- Huella del archivo. Subir dos veces la misma hoja se detecta y se avisa.
  huella          text,
  cargado_en      timestamptz not null default now(),
  cargado_por     uuid not null references persona(id),
  confirmado_en   timestamptz,
  revertido_en    timestamptz,
  nota            text
);

create index lote_org_ix on lote_importacion (organizacion_id, cargado_en desc);

-- La hoja tal cual. Las celdas se guardan como texto: convertir demasiado pronto
-- es como se pierde informacion sin enterarse.
create table fila_cruda (
  lote_id   uuid not null references lote_importacion(id) on delete cascade,
  fila      int  not null,
  celdas    text[] not null,
  primary key (lote_id, fila)
);

-- Que columna de la hoja es que campo. Esto es lo que se le ensena al humano para
-- que lo corrija: "columna 3 -> fecha", "columna 7 -> monto".
create table mapeo_columna (
  lote_id   uuid not null references lote_importacion(id) on delete cascade,
  columna   int  not null,
  campo     text not null,
  -- 'texto', 'fecha', 'numero', 'moneda'
  tipo      text not null default 'texto',
  -- Como venia escrita la fecha o el numero en la hoja. Sin esto, 03/04 es ambiguo.
  formato   text,
  primary key (lote_id, columna)
);

-- El resultado de validar: una fila por fila de la hoja, diciendo si entra y por que no.
create table validacion_fila (
  lote_id   uuid not null references lote_importacion(id) on delete cascade,
  fila      int  not null,
  ok        boolean not null,
  motivo    text,
  primary key (lote_id, fila)
);

-- -----------------------------------------------------------------------------
-- Interpretar una celda segun el mapeo. Devuelve null si no se puede, y el motivo
-- se recoge aparte: aqui no se adivina nunca.

create or replace function leer_fecha(p_texto text, p_formato text)
returns date
language plpgsql immutable as $$
declare
  patron text;
  d      date;
  dia    int;
  mes    int;
begin
  if p_texto is null or btrim(p_texto) = '' then return null; end if;

  -- El vocabulario es el MISMO que usa la aplicacion al leer la hoja: 'dmy', 'mdy',
  -- 'iso'. Tener dos nombres para lo mismo en dos capas es como se acaba mandando
  -- 'dmy' a una funcion que esperaba 'DD/MM/YYYY' y recibiendo null sin saber por
  -- que. Se siguen aceptando los patrones de PostgreSQL por si alguien los usa.
  patron := case lower(coalesce(p_formato, 'dmy'))
              when 'dmy' then 'DD/MM/YYYY'
              when 'mdy' then 'MM/DD/YYYY'
              when 'iso' then 'YYYY-MM-DD'
              else p_formato
            end;

  -- Los separadores se unifican: la gente escribe 03/04/2026, 03-04-2026 y 03.04.2026.
  d := to_date(regexp_replace(btrim(p_texto), '[.\-]', '/', 'g'),
               replace(patron, '-', '/'));

  -- to_date es indulgente: '31/02/2026' le devuelve el 3 de marzo sin quejarse, y
  -- eso es un dia equivocado que entra en la contabilidad en silencio. Se comprueba
  -- que lo que salio es lo que estaba escrito.
  if lower(coalesce(p_formato,'dmy')) in ('dmy','mdy') then
    dia := (regexp_match(regexp_replace(btrim(p_texto), '[.\-]', '/', 'g'),
            '^(\d{1,2})/(\d{1,2})/'))[case when lower(p_formato) = 'mdy' then 2 else 1 end]::int;
    mes := (regexp_match(regexp_replace(btrim(p_texto), '[.\-]', '/', 'g'),
            '^(\d{1,2})/(\d{1,2})/'))[case when lower(p_formato) = 'mdy' then 1 else 2 end]::int;
    if extract(day from d)::int <> dia or extract(month from d)::int <> mes then
      return null;
    end if;
  end if;
  return d;
exception when others then
  return null;
end $$;

-- Acepta 1.234.567,89 (venezolano) y 1,234,567.89 (anglosajon). El formato se
-- declara en el mapeo: adivinarlo es como se cuelan errores de tres ordenes de
-- magnitud sin que nadie los vea.
create or replace function leer_numero(p_texto text, p_formato text)
returns numeric
language plpgsql immutable as $$
declare t text;
begin
  if p_texto is null or btrim(p_texto) = '' then return null; end if;
  t := btrim(p_texto);
  t := regexp_replace(t, '[^0-9.,\-]', '', 'g');
  -- Mismo vocabulario que la aplicacion: 've' y 'ven' son lo mismo.
  if lower(coalesce(p_formato, 've')) in ('ve', 'ven') then
    t := replace(t, '.', '');
    t := replace(t, ',', '.');
  else
    t := replace(t, ',', '');
  end if;
  return t::numeric;
exception when others then
  return null;
end $$;

-- Lo que la aplicacion le ensena al humano antes de confirmar: como entendio cada
-- celda de las primeras filas. Si algo esta mal, se ve aqui y no despues.
create or replace function previsualizar(p_lote uuid, p_filas int default 10)
returns table (fila int, campo text, en_la_hoja text, entendido text)
language sql stable as $$
  select f.fila, m.campo, f.celdas[m.columna],
         case m.tipo
           when 'fecha'  then coalesce(leer_fecha(f.celdas[m.columna], m.formato)::text,
                                       '‹no se entiende como fecha›')
           when 'numero' then coalesce(leer_numero(f.celdas[m.columna], m.formato)::text,
                                       '‹no se entiende como número›')
           else f.celdas[m.columna]
         end
    from fila_cruda f
    join mapeo_columna m on m.lote_id = f.lote_id
   where f.lote_id = p_lote and f.fila <= p_filas
   order by f.fila, m.columna
$$;

-- Validar sin escribir nada. Deja el veredicto en validacion_fila.
create or replace function validar_lote(p_lote uuid)
returns table (filas int, buenas int, malas int)
language plpgsql as $$
declare
  l   record;
  obl text[];
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.estado = 'confirmado' then
    raise exception 'El lote % ya está confirmado. Para rehacerlo, revíertelo antes.', p_lote;
  end if;

  delete from validacion_fila where lote_id = p_lote;

  -- Campos que no pueden faltar, segun a donde vaya la hoja.
  obl := case l.destino
           when 'valuaciones'        then array['contrato','numero','periodo_hasta','obra']
           when 'facturas_emitidas'  then array['numero','fecha','cliente','base']
           when 'facturas_recibidas' then array['numero','fecha','proveedor','base']
           when 'cobros'             then array['fecha','monto']
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
  if exists (select 1 from unnest(obl) c
              where c not in (select campo from mapeo_columna where lote_id = p_lote)) then
    raise exception 'Faltan columnas obligatorias por mapear: %',
      (select string_agg(c, ', ') from unnest(obl) c
        where c not in (select campo from mapeo_columna where lote_id = p_lote));
  end if;

  update lote_importacion set estado = 'validado' where id = p_lote;

  return query
    select count(*)::int,
           count(*) filter (where ok)::int,
           count(*) filter (where not ok)::int
      from validacion_fila where lote_id = p_lote;
end $$;

-- Confirmar. Se niega si queda una sola fila con error: o entra limpia, o no entra.
create or replace function confirmar_lote(p_lote uuid, p_persona uuid)
returns int
language plpgsql as $$
declare
  l     record;
  malas int;
begin
  select * into l from lote_importacion where id = p_lote;
  if l is null then raise exception 'El lote % no existe', p_lote; end if;
  if l.estado <> 'validado' then
    raise exception 'Hay que validar el lote antes de confirmarlo. Está en "%".', l.estado;
  end if;

  select count(*) into malas from validacion_fila where lote_id = p_lote and not ok;
  if malas > 0 then
    raise exception 'El lote tiene % fila(s) con error. Corrígelas: una carga a medias es peor que ninguna.', malas;
  end if;

  update lote_importacion
     set estado = 'confirmado', confirmado_en = now()
   where id = p_lote;

  return (select count(*)::int from fila_cruda where lote_id = p_lote);
end $$;

-- Revertir un lote entero. Se reversa cada asiento que genero; los asientos no se
-- borran, se contraponen, igual que todo lo demas.
create or replace function revertir_lote(p_lote uuid, p_persona uuid, p_motivo text)
returns int
language plpgsql as $$
declare
  a   record;
  n   int := 0;
begin
  for a in select id from asiento
            where origen_tipo = 'importacion_excel' and origen_id = p_lote
              and reversa_a is null
              and not exists (select 1 from asiento r where r.reversa_a = asiento.id)
  loop
    perform reversar_asiento(a.id, p_persona, p_motivo);
    n := n + 1;
  end loop;

  update lote_importacion
     set estado = 'revertido', revertido_en = now(), nota = p_motivo
   where id = p_lote;
  return n;
end $$;
