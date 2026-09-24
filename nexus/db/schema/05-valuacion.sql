-- GPS Nexus · valuaciones
--
-- Es el documento que mas discusiones causa y el unico de contabilidad que el cliente
-- llega a ver entero. Por eso aqui no se guarda un "neto a cobrar" que alguien tecleo:
-- se guardan las piezas y el neto se calcula. Si el cliente objeta, se abre el calculo
-- linea por linea en vez de discutir sobre un numero.
--
-- La obra del periodo tampoco se escribe a mano: entra desde los hitos evidenciados.
-- Mientras el modulo de evidencia no exista, se carga explicitamente y queda constancia
-- de que fue carga manual, en 'origen_obra'.

create type estado_valuacion as enum
  ('borrador','presentada','objetada','aprobada','facturada','cobrada','anulada');

create table valuacion (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id),
  contrato_id     uuid not null references contrato(id),
  numero          int  not null,
  periodo_desde   date not null,
  periodo_hasta   date not null,
  estado          estado_valuacion not null default 'borrador',

  -- Obra ejecutada en el periodo, en la moneda del contrato.
  obra            numeric(20,2) not null check (obra >= 0),
  -- 'hitos_evidenciados' o 'carga_manual'. Nunca se pierde de donde salio la cifra.
  origen_obra     text not null default 'carga_manual',

  moneda          moneda not null,
  tasa_id         uuid not null references tasa_bcv(id),

  -- Los porcentajes se copian del contrato al crear la valuacion y se congelan.
  -- Si el contrato cambia manana, las valuaciones ya emitidas no se mueven.
  amortiza_pct    numeric(5,2) not null,
  garantia_pct    numeric(5,2) not null,
  alicuota_iva_id uuid not null references alicuota_iva(id),
  concepto_islr   text not null references concepto_islr(codigo),
  -- 75% si el cliente es agente de retencion; 0 si no retiene.
  ret_iva_pct     numeric(5,2) not null default 0,
  -- Se paga en divisa, luego causa IGTF.
  paga_en_divisa  boolean not null default false,

  presentada_el   date,
  aprobada_el     date,
  aprobada_por    uuid references persona(id),
  documento_id    uuid references documento_fiscal(id),

  creada_en       timestamptz not null default now(),
  creada_por      uuid not null references persona(id),

  unique (contrato_id, numero),
  constraint periodo_coherente check (periodo_hasta >= periodo_desde),
  constraint aprobada_tiene_firma check (
    estado not in ('aprobada','facturada','cobrada') or aprobada_por is not null)
);

create index valuacion_contrato_ix on valuacion (contrato_id);
create index valuacion_estado_ix   on valuacion (organizacion_id, estado);

-- La hoja de valuacion. Cada linea es una pieza del calculo, en orden, con su signo.
-- Es literalmente lo que ve el cliente en pantalla y lo que se imprime.
-- Devuelve la CLAVE de cada concepto, no su texto. Si aquí hubiera texto, el mismo
-- término viviría en dos sitios —la base de datos y el diccionario— y acabarían
-- diciendo cosas distintas. De hecho ya pasó: la base decía "Retainage" donde el
-- diccionario decía "Retention". Con una sola fuente eso no puede volver a ocurrir.
create or replace function hoja_valuacion(p_valuacion uuid)
returns table (
  orden       int,
  clave       text,
  base        numeric(20,2),
  porcentaje  numeric(5,2),
  monto       numeric(20,2),
  -- false = pieza interna que el cliente no necesita ver desglosada
  visible_cliente boolean
)
language plpgsql stable as $$
declare
  v record;
  iva_pct   numeric(5,2);
  iva       numeric(20,2);
  amort     numeric(20,2);
  garantia  numeric(20,2);
  ret_iva   numeric(20,2);
  ret_islr  numeric(20,2);
  igtf      numeric(20,2);
  base_ves  numeric(20,2);
  neto      numeric(20,2);
  fecha     date;
begin
  -- Si no aparece, NO se lanza excepcion: se devuelve vacio.
  --
  -- El motivo es de seguridad, no de estilo. Las politicas de fila hacen que esta
  -- consulta no vea las valuaciones de otro cliente. Si aqui se lanzara 'no existe',
  -- el mensaje distinguiria entre una valuacion que no existe y una que existe pero
  -- es de otro — y eso ya es contar algo sobre el contrato ajeno. Ademas el mensaje
  -- llevaria el identificador dentro, que es justo lo que no debe salir.
  --
  -- Quien llama convierte el vacio en el error que corresponda, igual en los dos casos.
  select * into v from valuacion where id = p_valuacion;
  if v is null then return; end if;

  fecha := v.periodo_hasta;
  select a.porcentaje into iva_pct from alicuota_iva a where a.id = v.alicuota_iva_id;

  iva      := round(v.obra * iva_pct / 100, 2);
  amort    := round(v.obra * v.amortiza_pct / 100, 2);
  garantia := round(v.obra * v.garantia_pct / 100, 2);
  ret_iva  := round(iva * v.ret_iva_pct / 100, 2);

  -- El ISLR se retiene sobre la base imponible, y la tabla esta en bolivares.
  base_ves := case when v.moneda = 'VES' then v.obra
                   else convertir(v.obra, 'USD', 'VES', v.tasa_id) end;
  ret_islr := calcular_islr(v.concepto_islr, base_ves, fecha);
  if v.moneda = 'USD' then
    ret_islr := convertir(ret_islr, 'VES', 'USD', v.tasa_id);
  end if;

  neto := v.obra + iva - amort - garantia - ret_iva - ret_islr;

  -- El IGTF se causa sobre lo que efectivamente se paga en divisa: el neto.
  if v.paga_en_divisa then
    igtf := calcular_igtf(neto, fecha);
    neto := neto - igtf;
  else
    igtf := 0;
  end if;

  return query values
    (1, 'valuacion.obra',            v.obra,              null::numeric(5,2), v.obra,       true),
    (2, 'valuacion.iva',             v.obra,              iva_pct,            iva,          true),
    (3, 'valuacion.total_facturado', null::numeric(20,2), null::numeric(5,2), v.obra + iva, true),
    (4, 'valuacion.amortizacion',    v.obra,              v.amortiza_pct,     -amort,       true),
    (5, 'valuacion.garantia',        v.obra,              v.garantia_pct,     -garantia,    true),
    (6, 'valuacion.ret_iva',         iva,                 v.ret_iva_pct,      -ret_iva,     true),
    (7, 'valuacion.ret_islr',        v.obra,              null::numeric(5,2), -ret_islr,    true),
    (8, 'valuacion.igtf',            null::numeric(20,2), null::numeric(5,2), -igtf,        true),
    (9, 'valuacion.neto',            null::numeric(20,2), null::numeric(5,2), neto,         true);
end $$;

-- El neto solo, para cuando no hace falta la hoja entera.
create or replace function neto_valuacion(p_valuacion uuid) returns numeric(20,2)
language sql stable as $$
  select monto from hoja_valuacion(p_valuacion) where orden = 9
$$;
