-- GPS Nexus · las plantillas de hitos, y que sumen 100
--
-- `plantilla_hito` dice, por cada tipo de contrato, en qué pasos se divide un renglón y
-- cuánto pesa cada uno. De ahí salen los hitos de todos los renglones, y de los hitos
-- verificados sale el avance. Es la pieza de la que cuelga la tesis entera del producto.
--
-- Y la escribía SOLO el archivo de esquema que la sembró el primer día. `/medidas` decía
-- «ese tipo de contrato todavía no tiene plantilla de hitos, así que no hay de dónde
-- sacarlos» y no había forma de hacer una. Una pantalla que manda hacer algo tiene que
-- poder hacerlo.
--
-- ---------------------------------------------------------------------------
-- Y de paso, el fallo silencioso que llevaba ahí desde el principio.
--
-- El comentario de la tabla dice «La suma por tipo debe dar 100». Era un comentario, no
-- una comprobación, y nada lo verificaba. Lo que pasa si suma 90 es lo peor que le puede
-- pasar a este sistema: **un renglón con TODOS sus hitos verificados se queda para
-- siempre en el 90 %.** Nadie ve un error. Se ve un contrato que no acaba de avanzar y
-- la explicación está en una tabla que nadie mira. Es exactamente la clase de cifra
-- falsa silenciosa que este producto existe para no producir.
--
-- No se pone como restricción de tabla a propósito: montar una plantilla pasa por
-- estados intermedios —el primer paso de un tipo nuevo pesa 25 y la suma es 25— y una
-- restricción que impida guardar eso hace imposible empezar. Se comprueba donde
-- importa: al USARLA para crear los hitos de un renglón.

create or replace function suma_plantilla(p_tipo tipo_contrato)
returns numeric(6,2)
language sql stable as $$
  select coalesce(sum(peso), 0)::numeric(6,2) from plantilla_hito where tipo = p_tipo
$$;

create or replace function crear_hitos_desde_plantilla(p_renglon uuid) returns int
language plpgsql security definer as $$
declare
  ctr       record;
  p         record;
  n         int := 0;
  acumulado numeric(6,2) := 0;
  dias      int;
  suma      numeric(6,2);
begin
  select ct.tipo, ct.inicio, ct.fin_previsto into ctr
    from renglon rg join contrato ct on ct.id = rg.contrato_id
   where rg.id = p_renglon;
  if not found then raise exception 'el renglón % no existe', p_renglon; end if;

  if exists (select 1 from hito where renglon_id = p_renglon) then
    -- Volver a llamarlo no duplica ni pisa lo que ya hay. Un renglón con hitos ya tiene
    -- su historia, y rehacerla borraría las fechas reales.
    return 0;
  end if;

  suma := suma_plantilla(ctr.tipo);
  if suma = 0 then
    raise exception 'El tipo de contrato "%" no tiene plantilla de hitos', ctr.tipo;
  end if;
  if suma <> 100 then
    raise exception 'La plantilla de "%" suma % y tiene que sumar 100: con % el renglón no podría pasar de ese porcentaje ni con todo verificado',
      ctr.tipo, suma, suma;
  end if;

  dias := case when ctr.inicio is null or ctr.fin_previsto is null then null
               else greatest(ctr.fin_previsto - ctr.inicio, 1) end;

  for p in select * from plantilla_hito where tipo = ctr.tipo order by orden loop
    acumulado := acumulado + p.peso;
    insert into hito (renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                      planificada)
    values (p_renglon, p.orden, p.clave, p.nombre_es, p.nombre_en, p.peso, p.exige,
            case when dias is null then null
                 else ctr.inicio + (dias * acumulado / 100)::int end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Nadie fuera de GPS toca las plantillas.
--
-- Y hay un motivo más fuerte del habitual: `plantilla_hito` NO lleva organizacion_id.
-- Es una sola para todo el sistema, así que quien la edita la edita para todas las
-- operadoras a la vez. El cliente ya podía LEERLA —está en los permisos desde el primer
-- día, y hace falta para entender los hitos de su contrato—, pero escribirla es de GPS:
-- es su metodología, no datos de un cliente.
alter table plantilla_hito enable row level security;

create policy plantilla_vista on plantilla_hito for select using (true);
create policy plantilla_escritura on plantilla_hito for all
  using (es_interna()) with check (es_interna());
