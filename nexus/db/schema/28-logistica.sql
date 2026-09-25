-- GPS Nexus · donde esta el material
--
-- La pregunta que hace un cliente de procura y no contesta ningun portal de
-- seguimiento: «¿donde esta mi cabezal?». Hoy se contesta llamando al que sabe, y el
-- que sabe se acuerda de lo que mira mas a menudo.
--
-- La maquina ya estaba entera: la cadena de procura —orden, fabricado, embarcado,
-- nacionalizado, recibido— vive en las plantillas de hitos desde el primer dia, con
-- el papel que exige cada paso. Lo que faltaba no era la maquina: era LA VISTA.
--
-- Dos decisiones que llevan toda la tesis del sistema dentro:
--
--   1. La posicion la marca el ultimo hito VERIFICADO, no el ultimo declarado. Si
--      alguien dice que se embarco y no hay conocimiento de embarque, el material
--      sigue en fabrica a efectos de esta pantalla — y se senala aparte. Un tablero
--      que se cree lo que le escriben es el tablero que ya tienen.
--   2. El orden es por DIAS PARADO, el que mas lleva primero. Lo que lleva cuarenta
--      dias sin moverse es lo que esta a punto de ser un problema; lo que se movio
--      ayer no necesita a nadie. Ordenar por codigo obliga a leerlo entero.

create or replace function en_ruta(p_org uuid)
returns table (
  contrato_id    uuid,
  contrato       text,
  cliente        text,
  renglon        text,
  renglon_en     text,
  tipo           tipo_contrato,
  -- Donde esta: el ultimo paso con su papel detras. Nulo si no ha empezado.
  paso_es        text,
  paso_en        text,
  desde          date,
  dias           int,
  -- Que falta: el siguiente paso y el papel que exige.
  siguiente_es   text,
  siguiente_en   text,
  exige          clase_evidencia[],
  -- Alguien dijo que este paso ya ocurrio y no hay papel que lo sostenga.
  dicho_sin_papel boolean,
  -- El papel ya esta subido y esperando que alguien lo mire. No es lo mismo que
  -- faltar: aqui el material ya se movio y lo que falta es una revision de GPS.
  papel_esperando boolean
)
language sql stable as $$
  with r as (
    select rg.id rid, ct.id cid, ct.codigo, o.nombre cliente, ct.tipo,
           rg.descripcion_es, rg.descripcion_en, ct.inicio
      from renglon rg
      join contrato ct on ct.id = rg.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.organizacion_id = p_org
       and ct.estado = 'vigente'
       and ct.tipo in ('procura','transporte')
  ),
  hecho as (
    select r.rid,
           (select h.orden from hito h
             where h.renglon_id = r.rid and h.estado = 'verificado'
             order by h.orden desc limit 1) as orden
      from r
  ),
  ultimo as (
    select h.rid, hi.nombre_es, hi.nombre_en, hi.ocurrido_en
      from hecho h
      join hito hi on hi.renglon_id = h.rid and hi.orden = h.orden
  ),
  siguiente as (
    select r.rid, hi.nombre_es, hi.nombre_en, hi.exige, hi.estado, hi.id
      from r
      join hecho h on h.rid = r.rid
      join lateral (
        select * from hito x
         where x.renglon_id = r.rid and x.orden > coalesce(h.orden, 0)
         order by x.orden limit 1
      ) hi on true
  )
  select r.cid, r.codigo, r.cliente, r.descripcion_es, r.descripcion_en, r.tipo,
         u.nombre_es, u.nombre_en,
         coalesce(u.ocurrido_en, r.inicio) as desde,
         greatest(0, current_date - coalesce(u.ocurrido_en, r.inicio))::int as dias,
         s.nombre_es, s.nombre_en, s.exige,
         (s.estado = 'declarado') as dicho_sin_papel,
         (s.estado = 'evidenciado') as papel_esperando
    from r
    join siguiente s on s.rid = r.rid
    left join ultimo u on u.rid = r.rid
   -- Sin siguiente paso no hay nada que esperar: ese renglon llego. La union con
   -- 'siguiente' ya lo deja fuera, y eso es deliberado — un tablero de material en
   -- ruta con el material que ya llego dentro no es un tablero, es un listado.
   order by 10 desc, r.codigo
$$;

-- Lo mismo, resumido por paso: cuantos renglones hay parados en cada sitio de la
-- cadena. Es lo que se mira primero, antes de bajar a la lista.
create or replace function en_ruta_por_paso(p_org uuid)
returns table (paso_es text, paso_en text, cuantos int, peor_dias int)
language sql stable as $$
  select siguiente_es, siguiente_en, count(*)::int, max(dias)::int
    from en_ruta(p_org)
   group by siguiente_es, siguiente_en
   order by max(dias) desc
$$;
