-- GPS Nexus · permisos
--
-- Este archivo se carga el ULTIMO, y ese es todo su motivo de existir.
--
-- 'grant on all tables in schema public' solo alcanza a las tablas que existen en el
-- momento de ejecutarlo. Cuando estos permisos estaban a media carga, cada tabla
-- nueva que se anadia despues quedaba sin permisos y fallaba al usarse. Aqui, al
-- final, cubren todo lo que exista, se anada lo que se anada.

-- ----------------------------------------------------------------- columnas

grant usage on schema public to nexus_interno, nexus_cliente;
grant select on all tables in schema public to nexus_interno;
grant insert, update, delete on all tables in schema public to nexus_interno;
grant execute on all functions in schema public to nexus_interno, nexus_cliente;

-- Las secuencias hacen falta aparte. Una tabla con 'bigserial' no se puede escribir
-- con permiso sobre la tabla y nada mas: el contador es otro objeto, y sin permiso
-- sobre el, el insert falla aunque el de la tabla este concedido.
grant usage on all sequences in schema public to nexus_interno;

-- Al cliente se le concede columna por columna, y se le niega lo que no le toca.
grant select on contrato, valuacion, documento_fiscal, organizacion to nexus_cliente;

-- En renglon: todo menos el precio de compra. La columna no se concede, punto.
grant select (id, contrato_id, numero, descripcion_es, descripcion_en,
              cantidad, unidad, norma, especificacion, precio_unitario)
  on renglon to nexus_cliente;

-- Las tablas de referencia si, y no es una concesion: son informacion publica.
-- La alicuota del IVA, el valor de la unidad tributaria y la tasa del BCV los publica
-- el Estado. El cliente ademas los necesita para entender su propia factura: sin la
-- tasa del dia, el importe en bolivares de una valuacion en dolares es un numero sin
-- explicacion. Ocultarlos no protegeria nada y haria opaco lo que debe ser claro.
grant select on tasa_bcv, alicuota_iva, alicuota_igtf, concepto_islr, unidad_tributaria
  to nexus_cliente;

-- La contabilidad no se concede en absoluto.
revoke all on asiento, partida, cuenta, mapa_cuenta, periodo, retencion from nexus_cliente;
