-- GPS Nexus · el estado de cuenta del cliente
--
-- «Cuanto me han facturado y cuanto debo» es la segunda pregunta de cualquiera que paga, y
-- no habia ninguna pantalla que la contestara desde el lado del cliente. La base de datos
-- estaba preparada para contestarla: la politica de fila de `documento_fiscal` le concede al
-- cliente las facturas EMITIDAS a su nombre, y el permiso de tabla tambien. Un permiso
-- concedido a proposito que ninguna pantalla usaba.
--
-- Lo que faltaba de verdad, y por lo que esto es una funcion y no una consulta suelta: **el
-- cliente NO puede ver la tabla de cobros.** No se le concede, y con razon — ahi vive el
-- medio de pago y la referencia bancaria de GPS. Sin eso, «cuanto he pagado» no se puede
-- contestar desde su sesion: la consulta se pararia con un error de permisos, o —peor, si
-- algun dia se le concediera a medias— le diria que debe el total de una valuacion que ya
-- pago.
--
-- De ahi `security definer`: la funcion lee los cobros por el, y le devuelve la SUMA, que es
-- lo que necesita saber, sin abrirle la tabla donde estan los datos del banco.
--
-- Y de ahi, tambien, que lo primero del cuerpo sea la comprobacion de quien pregunta.
-- `security definer` se salta las politicas de fila: sin esa condicion, cualquier cliente
-- podria pedir el estado de cuenta de otro pasando su identificador. Es la unica cosa que
-- sujeta el aislamiento aqui, y por eso hay una prueba que la mide pidiendo el de otro.

create or replace function estado_de_cuenta(p_org uuid)
returns table (
  contrato_id   uuid,
  contrato      text,
  titulo_es     text,
  titulo_en     text,
  valuacion_id  uuid,
  numero        int,
  periodo_hasta date,
  estado        text,
  moneda        text,
  neto          numeric(20,2),
  cobrado       numeric(20,2),
  saldo         numeric(20,2),
  factura       text,
  control       text,
  factura_el    date
)
language sql stable security definer as $$
  select c.id, c.codigo, c.titulo_es, c.titulo_en,
         v.id, v.numero, v.periodo_hasta, v.estado::text, v.moneda::text,
         neto_valuacion(v.id),
         coalesce((select sum(co.monto) from cobro co where co.valuacion_id = v.id), 0)
           ::numeric(20,2),
         saldo_valuacion(v.id),
         d.numero, d.numero_control, d.fecha
    from valuacion v
    join contrato c on c.id = v.contrato_id
    left join documento_fiscal d on d.id = v.documento_id
   -- QUIEN pregunta. Esto es lo que hace seguro el `security definer` de arriba: o eres esa
   -- operadora, o eres la GPS que ejecuta el contrato. Cualquier otro caso devuelve vacio.
   where c.cliente_id = p_org
     and (p_org = org_actual()
          or (es_interna() and c.organizacion_id = org_actual()))
   -- Y solo lo que el cliente ya ha visto. Un borrador de GPS no es una deuda suya, y
   -- ensenarselo seria contarle una cifra que todavia puede cambiar.
     and v.estado in ('presentada','objetada','aprobada','facturada','cobrada')
   order by v.periodo_hasta desc, c.codigo
$$;
