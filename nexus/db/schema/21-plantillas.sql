-- GPS Nexus · las plantillas de hitos
--
-- 'plantilla_hito' existia desde el principio y estaba VACIA, que es el peor estado
-- posible: un contrato nuevo nacia sin hitos, su avance salia cero, y cero es lo que
-- sale tambien cuando algo va mal. Un numero que significa dos cosas no significa
-- ninguna.
--
-- Aqui se siembran las cadenas de los cinco tipos de contrato de GPS. No son una
-- ocurrencia: son como se trabaja de verdad en cada uno, y el peso de cada hito es
-- cuanto del trabajo esta hecho cuando ese hito se cumple — no cuanto se cobra.
-- Mezclar las dos cosas es lo que hace que un contrato aparezca al 80% con el equipo
-- todavia en el patio del proveedor.
--
-- Los pesos de cada tipo suman 100. Lo comprueba una restriccion, porque una
-- plantilla que suma 95 hace que un renglon terminado del todo se quede en 95% para
-- siempre, y nadie sabria por que.

insert into plantilla_hito (tipo, orden, clave, nombre_es, nombre_en, peso, exige) values

-- PROCURA. El material no esta hecho hasta que hay certificado, y no esta aqui
-- hasta que hay acta de recepcion. Entre medias hay dos aduanas y un barco.
 ('procura', 1,'orden',        'Orden de compra colocada','Purchase order placed', 10.00,'{}'),
 ('procura', 2,'fabricado',    'Fabricado en planta',     'Manufactured',          30.00,'{certificado}'),
 ('procura', 3,'embarcado',    'Embarcado',               'Shipped',               25.00,'{conocimiento}'),
 ('procura', 4,'nacionalizado','Nacionalizado',           'Cleared through customs',15.00,'{aduana}'),
 ('procura', 5,'recibido',     'Recibido en sitio',       'Received on site',      20.00,'{acta,foto}'),

-- SERVICIO. Lo que pesa es la ejecucion; movilizar y desmovilizar son necesarios y
-- no son el trabajo. La aceptacion del cliente pesa 20 porque sin ella no se cobra.
 ('servicio', 1,'movilizacion',  'Movilización',            'Mobilisation',       10.00,'{acta}'),
 ('servicio', 2,'ejecucion',     'Ejecución del servicio',  'Service execution',  55.00,'{informe,foto}'),
 ('servicio', 3,'desmovilizacion','Desmovilización',        'Demobilisation',     10.00,'{acta}'),
 ('servicio', 4,'aceptacion',    'Aceptación del cliente',  'Client acceptance',  25.00,'{firma}'),

-- REACONDICIONAMIENTO. Un workover no empieza cuando llega el equipo: empieza
-- cuando la operadora aprueba el programa. Y no termina al sacar el equipo, sino al
-- entregar el pozo y el informe final — que es el papel que se discute dos anos
-- despues.
 ('reacondicionamiento', 1,'programa',   'Programa aprobado',      'Programme approved',   10.00,'{acta}'),
 ('reacondicionamiento', 2,'movilizacion','Equipo en locación',    'Rig on location',      15.00,'{foto,acta}'),
 ('reacondicionamiento', 3,'operacion',  'Operación ejecutada',    'Operation executed',   45.00,'{informe}'),
 ('reacondicionamiento', 4,'entrega',    'Pozo entregado',         'Well handed over',     20.00,'{acta}'),
 ('reacondicionamiento', 5,'informe',    'Informe final',          'Final report',         10.00,'{informe}'),

-- TRANSPORTE. Lo que se paga es que llegue, asi que la entrega pesa mas que todo lo
-- anterior junto. La conformidad de quien recibe va aparte: recibir y dar por bueno
-- no son lo mismo, y la diferencia es donde aparecen los danos.
 ('transporte', 1,'despacho',   'Despachado',              'Dispatched',          20.00,'{acta}'),
 ('transporte', 2,'transito',   'En tránsito',             'In transit',          15.00,'{foto}'),
 ('transporte', 3,'entrega',    'Entregado en destino',    'Delivered',           45.00,'{acta}'),
 ('transporte', 4,'conformidad','Conformidad de recibo',   'Receipt signed off',  20.00,'{firma}'),

-- ALQUILER. El grueso es el tiempo en que el equipo esta trabajando. La devolucion
-- pesa 20 porque es cuando aparece el dano que se va a discutir, y sin foto de
-- devolucion esa discusion se pierde siempre.
 ('alquiler', 1,'entrega',   'Equipo entregado',      'Equipment delivered',   20.00,'{acta,foto}'),
 ('alquiler', 2,'operacion', 'En operación',          'In operation',          60.00,'{informe}'),
 ('alquiler', 3,'devolucion','Equipo devuelto',       'Equipment returned',    20.00,'{acta,foto}')

on conflict (tipo, orden) do update
   set clave = excluded.clave, nombre_es = excluded.nombre_es,
       nombre_en = excluded.nombre_en, peso = excluded.peso, exige = excluded.exige;

-- Una plantilla que suma 95 deja un renglon terminado del todo en 95% para siempre,
-- y nadie sabria por que. Se comprueba al cargar, no cuando ya duela.
do $$
declare t record;
begin
  for t in select tipo, sum(peso) total from plantilla_hito group by tipo loop
    if t.total <> 100.00 then
      raise exception 'la plantilla de % suma %, y tiene que sumar 100', t.tipo, t.total;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------

/**
 * Crea los hitos de un renglon desde la plantilla de su tipo de contrato.
 *
 * Se llama expresamente y NO desde un disparador sobre 'renglon'. La diferencia
 * importa: al importar un contrato que ya viene empezado hay que poder poner los
 * hitos con sus fechas y estados reales, y un disparador los crearia antes y
 * chocaria con ellos. Lo que no se puede es OLVIDARLO en silencio, y para eso esta
 * 'renglones_sin_hitos()' abajo.
 *
 * Las fechas planificadas se reparten proporcionalmente al peso entre el inicio y el
 * fin previsto del contrato. Es una estimacion y se nota que lo es: en cuanto alguien
 * ponga la fecha pronosticada de verdad, manda esa. Pero una fecha estimada avisa de
 * un retraso, y una fecha vacia no avisa de nada.
 */
create or replace function crear_hitos_desde_plantilla(p_renglon uuid) returns int
language plpgsql security definer as $$
declare
  ctr record;
  p   record;
  n   int := 0;
  acumulado numeric(6,2) := 0;
  dias int;
begin
  select ct.tipo, ct.inicio, ct.fin_previsto into ctr
    from renglon rg join contrato ct on ct.id = rg.contrato_id
   where rg.id = p_renglon;
  if not found then raise exception 'el renglón % no existe', p_renglon; end if;

  if exists (select 1 from hito where renglon_id = p_renglon) then
    -- Volver a llamarlo no duplica ni pisa lo que ya hay. Un renglon con hitos ya
    -- tiene su historia, y rehacerla borraria las fechas reales.
    return 0;
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

/**
 * Los renglones que se quedaron sin hitos.
 *
 * Existe porque crear los hitos es un paso que se puede olvidar, y un renglon sin
 * hitos tiene avance cero — el mismo cero que un renglon que no ha empezado. Que las
 * dos cosas se vean igual es lo que hace que nadie se entere. Esto las separa, y la
 * pantalla de medidas lo ensena.
 */
create or replace function renglones_sin_hitos(p_org uuid)
returns table (
  renglon_id  uuid,
  contrato_id uuid,
  contrato    text,
  renglon     text,
  valor       numeric(20,2),
  moneda      moneda
)
language sql stable as $$
  select rg.id, ct.id, ct.codigo, rg.descripcion_es,
         round(rg.cantidad * rg.precio_unitario, 2), ct.moneda
    from renglon rg
    join contrato ct on ct.id = rg.contrato_id
   where ct.organizacion_id = p_org
     and ct.estado = 'vigente'
     and not exists (select 1 from hito h where h.renglon_id = rg.id)
   order by 5 desc
$$;
