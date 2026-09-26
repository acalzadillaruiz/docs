-- GPS Nexus · las dos cifras mal del libro que se declara
--
-- Los libros de ventas y de compras son lo unico de esta aplicacion que sale de la empresa
-- con destino al SENIAT, y su propio archivo lo dice: «lo que importa no es que se vea
-- bonito: es que los totales sean exactamente los de la declaracion». La pantalla lo repite
-- encima de los totales: «estas son las cifras que se declaran. No hay otra version en
-- ningun sitio.» Dos de esas cifras estaban mal.
--
-- **Una: la columna «Total» no incluia el IVA.** Se calculaba `base + exento`. En el libro
-- de ventas la columna de total es el valor total de la operacion CON el impuesto incluido
-- (Reglamento de la LIVA, art. 76), que es lo que tiene que cuadrar con lo que el cliente
-- pago. Con las catorce facturas de la muestra: base 46.977.000, debito fiscal 7.516.320,
-- y «Total» 46.977.000 — el IVA no aparecia en ninguna suma de esa columna.
--
-- **Dos, y es la grave: una nota de credito SUMABA.** Una nota de credito devuelve parte de
-- una factura ya emitida: baja la venta del mes y baja el debito fiscal. La vista la
-- listaba con su importe en positivo, como una factura mas, asi que una nota de credito de
-- 100.000 subia la base declarada de 46.977.000 a 47.077.000 y el debito fiscal de
-- 7.516.320 a 7.532.320. En vez de bajarlos. **Se declaraba de mas por el importe de cada
-- nota de credito, al doble.**
--
-- Por que no lo vio ninguna prueba: las que hay cuentan FILAS —que las dos facturas salgan,
-- que las notas salgan junto a ellas, que el libro diga a que factura afecta cada una— y
-- ninguna suma una columna con una nota dentro. Contar filas comprueba que la nota aparece;
-- no comprueba en que direccion. `neto_facturado`, que si resta bien, vive en otro sitio y
-- contesta otra pregunta: lo que queda vivo de UNA factura, no lo que se declara del mes.
--
-- El signo va en la vista y no en la pantalla, porque la pantalla no es el unico que lee
-- esto: tambien lo lee la hoja de calculo que se baja, y el dia que alguien escriba la
-- declaracion la leera tambien. Una regla de signos repetida en tres sitios se cae por el
-- tercero.
--
-- Se rehacen las dos vistas y no se «reemplazan»: `create or replace view` no admite cambiar
-- el tipo de una columna, y multiplicar un numeric(20,2) por el signo deja un numeric sin
-- precision declarada.

drop view if exists libro_ventas;
drop view if exists libro_compras;

/**
 * En que direccion mueve la declaracion cada documento.
 *
 * La nota de debito suma, igual que la factura: cobra mas de lo facturado. La de credito
 * resta. Esta escrito una vez y las dos vistas lo usan, porque el libro de compras tiene
 * exactamente el mismo problema: una nota de credito de un proveedor baja el credito fiscal
 * del mes, y sumarla habria dado un credito fiscal inflado — que es un problema PEOR, porque
 * lo que se declara de menos se paga con multa.
 */
create or replace function signo_fiscal(p_tipo tipo_documento) returns int
language sql immutable as $$
  select case p_tipo when 'nota_credito' then -1 else 1 end
$$;

create view libro_ventas as
select d.organizacion_id,
       date_trunc('month', d.fecha)::date as periodo,
       d.fecha,
       c.rif                              as rif_cliente,
       c.nombre                           as cliente,
       d.tipo,
       d.numero                           as numero_factura,
       d.numero_control,
       af.numero                          as afecta_numero,
       -- El total de la operacion, con el IVA dentro, que es la columna que se declara.
       ((d.base_ves + d.exento_ves + d.iva_ves) * signo_fiscal(d.tipo))::numeric(20,2)
                                          as total_ves,
       (d.exento_ves * signo_fiscal(d.tipo))::numeric(20,2)    as exento_ves,
       (d.base_ves   * signo_fiscal(d.tipo))::numeric(20,2)    as base_imponible_ves,
       -- La alicuota NO lleva signo: el 16% de una nota de credito sigue siendo el 16%.
       a.porcentaje                       as alicuota,
       (d.iva_ves    * signo_fiscal(d.tipo))::numeric(20,2)    as debito_fiscal_ves,
       (r.monto_ves  * signo_fiscal(d.tipo))::numeric(20,2)    as iva_retenido_ves,
       r.comprobante                      as comprobante_retencion
  from documento_fiscal d
  join organizacion c        on c.id = d.contraparte_id
  left join alicuota_iva a   on a.id = d.alicuota_iva_id
  left join documento_fiscal af on af.id = d.afecta_a
  left join retencion r      on r.documento_id = d.id and r.clase = 'iva'
 where d.sentido = 'emitido';

create view libro_compras as
select d.organizacion_id,
       date_trunc('month', d.fecha)::date as periodo,
       d.fecha,
       p.rif                              as rif_proveedor,
       p.nombre                           as proveedor,
       d.tipo,
       d.numero                           as numero_factura,
       d.numero_control,
       af.numero                          as afecta_numero,
       ((d.base_ves + d.exento_ves + d.iva_ves) * signo_fiscal(d.tipo))::numeric(20,2)
                                          as total_ves,
       (d.exento_ves * signo_fiscal(d.tipo))::numeric(20,2)    as exento_ves,
       (d.base_ves   * signo_fiscal(d.tipo))::numeric(20,2)    as base_imponible_ves,
       a.porcentaje                       as alicuota,
       (d.iva_ves    * signo_fiscal(d.tipo))::numeric(20,2)    as credito_fiscal_ves,
       (r.monto_ves  * signo_fiscal(d.tipo))::numeric(20,2)    as iva_retenido_ves,
       r.comprobante                      as comprobante_retencion
  from documento_fiscal d
  join organizacion p        on p.id = d.contraparte_id
  left join alicuota_iva a   on a.id = d.alicuota_iva_id
  left join documento_fiscal af on af.id = d.afecta_a
  left join retencion r      on r.documento_id = d.id and r.clase = 'iva'
 where d.sentido = 'recibido';

grant select on libro_ventas, libro_compras to nexus_interno;
