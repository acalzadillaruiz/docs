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

-- Aprobar y objetar son las unicas cosas que el cliente escribe, y se le concede
-- lo justo para eso: tres columnas de la valuacion, no la tabla entera. Con 'update'
-- a secas podria marcarla como cobrada.
grant update (estado, aprobada_el, aprobada_por) on valuacion to nexus_cliente;
grant insert, select on objecion to nexus_cliente;

-- Los hitos y su evidencia si se le conceden al cliente, y es deliberado: un avance
-- que el cliente no puede auditar vuelve a ser un numero que alguien escribio. Puede
-- ver el hito, su estado, y el documento que lo respalda. Lo que no ve es la factura
-- del proveedor: esa la aparta la politica de fila de 'evidencia', porque lleva
-- dentro el precio de compra.
grant select on hito, plantilla_hito to nexus_cliente;
-- Incluido el motivo del rechazo: si un papel que sostenia su avance no vale, el
-- cliente tiene derecho a saber por que, y enterarse por telefono no deja rastro.
-- Fuera quedan 'subida_por' y 'verificada_por': quien de GPS movio cada papel es
-- asunto interno y no ayuda a auditar nada.
grant select (id, hito_id, clase, huella, nombre, bytes, tipo_mime,
              ocurrido_en, subida_en, verificada_en, rechazada_en, motivo_rechazo)
  on evidencia to nexus_cliente;

-- Su propio perfil. Columna por columna, y las tres que no estan son las que
-- importan: la huella de la clave, el secreto del segundo factor y el sujeto del
-- directorio de su empresa. Ninguna de las tres hace falta para ensenar un perfil, y
-- cualquiera de las tres concedida convierte una consulta cualquiera en un robo.
grant select (id, organizacion_id, correo, nombre, idioma, activa, ultimo_acceso)
  on persona to nexus_cliente;

-- Sus preferencias de aviso: las lee y las escribe el, y solo el suyas. Que sean
-- solo las suyas lo hacen las politicas de fila, no este permiso.
grant select, insert, update, delete on preferencia_aviso to nexus_cliente;
grant select on aviso to nexus_cliente;

-- Las peticiones de entrada con la cuenta de la empresa no se conceden a nadie mas
-- que al servicio: llevan un nonce dentro, y quien lea un nonce puede reutilizar el
-- testigo que lo lleva.
revoke all on peticion_sso from nexus_cliente;

-- La contabilidad no se concede en absoluto.
revoke all on asiento, partida, cuenta, mapa_cuenta, periodo, retencion from nexus_cliente;
