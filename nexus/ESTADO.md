# GPS Nexus · estado

**Última actualización:** 2026-09-24, 22:00 (España)
**Avance:** 10 de 141 sesiones · **7%**
**Fase en curso:** 5 — La contabilidad deja de vivir en Excel *(adelantada a primera por decisión del CEO)*

**Las pruebas pasan.** `nexus/db/probar.sh` levanta un PostgreSQL desechable, carga el
esquema entero, comprueba las cincuenta y cinco reglas duras y revisa el diccionario
bilingüe en la misma pasada. Ejecútalo antes de cada commit
que toque el esquema. Si algo deja de fallar cuando debería fallar, la regla se rompió.

---

## Lo que existe hoy

| Archivo | Qué hace |
|---|---|
| `db/schema/00-identidad.sql` | Organizaciones, personas, método de entrada (clave+2FA, Microsoft, Google), capacidades una a una. La base de datos impide conceder una capacidad interna a un cliente. |
| `db/schema/01-moneda.sql` | Tasa BCV fechada e inmutable. `tasa_del_dia()` y `convertir()`. Una tasa publicada no se reescribe nunca. |
| `db/schema/02-contrato.sql` | Contratos de los cinco tipos, renglones con norma y especificación, anticipo, amortización y retención de garantía. **No existe columna de avance:** el avance se calcula desde los hitos evidenciados. |
| `db/schema/03-contable.sql` | Plan de cuentas, períodos, asientos y partidas. Un asiento descuadrado no puede existir; no se edita, no se borra, no entra en un mes cerrado. |
| `db/schema/04-fiscal.sql` | IVA con alícuotas fechadas, retención del 75%, ISLR por concepto con sustraendo en UT, IGTF del 3%. Libros de ventas y compras **como vistas**: no se transcriben, se consultan. |
| `db/schema/05-valuacion.sql` | Valuaciones. **No se guarda el neto a cobrar:** se guardan las piezas y el neto se calcula. Si el cliente objeta, se abre el cálculo línea por línea. Los porcentajes se congelan al crear la valuación: si el contrato cambia mañana, lo ya emitido no se mueve. |
| `db/schema/06-generadores.sql` | **Nadie teclea un asiento.** Se le pide a un hecho que produzca el suyo, y el asiento queda apuntando a ese hecho. Incluye el reverso (un asiento no se corrige, se contrapone) y el libro mayor con enlace al documento de origen. Las cuentas no están escritas dentro del código: viven en `mapa_cuenta`, una por concepto. |
| `db/schema/07-aislamiento.sql` | Dos cercas. **Qué filas:** un cliente solo ve sus contratos, y no porque la aplicación filtre, sino porque la base de datos no le devuelve las demás escriba la consulta que escriba. **Qué columnas:** el precio de compra no está oculto en la pantalla — el rol del cliente no tiene permiso de leer esa columna. La contabilidad entera queda fuera de su alcance. |
| `db/pruebas/01-reglas-duras.sql` | Trece comprobaciones de que la base de datos **se niega** a lo que debe negarse. |
| `db/pruebas/02-valuacion.sql` | La hoja de valuación contra un caso calculado a mano aparte, línea por línea. |
| `db/pruebas/03-generadores.sql` | El asiento que sale de esa valuación, contra el asiento escrito a mano aparte. |
| `db/pruebas/04-aislamiento.sql` | Se conecta **como un cliente de verdad** e intenta alcanzar lo que no le toca. |
| `db/pruebas/05-estados.sql` | Que los estados cuadren con el libro y entre sí, y que el cierre respete el orden. |
| `db/pruebas/06-cobros.sql` | El ciclo entero, de la valuación al cobro final, con cobro parcial por medio. |
| `db/pruebas/07-plan-cuentas.sql` | Que el plan se instale, que la jerarquía sea coherente, que esté en los dos idiomas, y que instalarlo dos veces no duplique nada. |
| `db/schema/08-estados.sql` | Balance de comprobación, estado de resultados y balance general. **No son informes que alguien arma: son el libro mirado de otra forma**, así que no pueden descuadrar respecto a él. Más el cierre de período, que se niega a cerrar un mes descuadrado o con el anterior abierto. |
| `db/schema/09-cobros.sql` | Cierra el ciclo: valuación → asiento → cobro → asiento. Cuando el cobro entra, la cuenta por cobrar queda en cero **sola**. El saldo no se guarda: se resta, porque un saldo guardado es un saldo que algún día dejará de ser cierto. El IGTF se causa aquí y no al facturar, porque grava el pago en divisa, no la factura. |
| `db/schema/10-plan-cuentas.sql` | Plan de cuentas **propuesto** para servicios petroleros en Venezuela: 86 cuentas en los dos idiomas. Es una propuesta, no una imposición: nada del sistema depende de estos códigos, porque las cuentas se referencian por concepto. Los ingresos van separados por tipo de servicio, porque saber cuál de los cinco deja dinero es media decisión de negocio. |
| `i18n/es.json` · `i18n/en.json` | 152 términos en los dos idiomas, incluido el vocabulario donde la palabra equivocada cambia el sentido: *valuación* → progress payment, *retención de garantía* → retention, *reacondicionamiento* → well workover, *colada* → heat number, *sustraendo* → deductible amount. |
| `i18n/comprobar.py` | Falla si una clave existe en un idioma y no en el otro, si un texto está vacío, o si los dos idiomas dicen lo mismo (casi siempre un olvido). |
| `db/probar.sh` | Lanza todo lo anterior contra un PostgreSQL desechable, y el diccionario en la misma pasada. |

### Lo que las pruebas demuestran hoy

| | Comprobado |
|---|---|
| 1 | Un cliente no puede recibir una capacidad interna; alguien de dentro sí. |
| 2 | Un asiento descuadrado se rechaza, en las dos monedas. |
| 3 | Un asiento cuadrado se acepta. |
| 4 | Un asiento no se puede editar ni borrar. |
| 5 | Un mes cerrado no admite un asiento más. |
| 6 | No puede haber dos tasas BCV vigentes para el mismo día. |
| 7 | ISLR: 5% sobre 100.000 Bs con sustraendo de 37,50 → 4.962,50. |
| 8 | IGTF: 3% sobre 10.000 en divisa → 300,00. |
| 9 | Conversión con tasa fechada: 100 USD a 36,50 → 3.650,00. |
| 10 | Los libros de ventas y compras consultan sin error. |
| 11 | La hoja de valuación cuadra en sus nueve líneas contra un caso hecho a mano: obra 1.000.000, IVA 160.000, amortización −200.000, garantía −50.000, retención de IVA −120.000, ISLR −49.962,50, **neto 740.037,50**. |
| 12 | Pagada en divisa, el IGTF baja el neto a **717.836,37**. |
| 13 | No se puede aprobar una valuación sin que conste quién la aprobó. |
| 14 | El asiento generado desde la valuación cuadra línea por línea contra el asiento escrito a mano: 740.037,50 a cobrar, 200.000 de anticipo, 50.000 de garantía, 120.000 de IVA retenido, 49.962,50 de ISLR, contra 1.000.000 de ingreso y 160.000 de IVA. |
| 15 | El asiento apunta a la valuación que lo generó. |
| 16 | La misma valuación no se puede asentar dos veces. |
| 17 | Si falta una cuenta en el mapa, el error dice cuál. No falla en silencio. |
| 18 | El reverso deja el saldo en cero **y los dos asientos se quedan en el libro**. |
| 19 | El libro mayor enlaza cada línea con el documento que la originó. |
| 20 | Desde dentro se ven los tres contratos y el precio de compra. |
| 21 | El cliente de A ve **un** contrato: el suyo vigente. Ni el de B, ni su propio borrador. |
| 22 | Nombrando el contrato de B expresamente, para el cliente de A no existe. |
| 23 | El cliente **no tiene permiso** sobre el precio de compra. Sí sobre el de venta. |
| 24 | El cliente no tiene permiso sobre los asientos ni sobre las partidas. |
| 25 | El libro entero cuadra: descuadre cero en las dos monedas. |
| 26 | El resultado del período es 1.000.000,00, la obra ejecutada. |
| 27 | Activo menos pasivo es igual al resultado: el balance cuadra con el estado. |
| 28 | No se cierra un mes con el anterior abierto. |
| 29 | Cerrados en orden, los dos meses quedan cerrados. |
| 31 | Pendiente de cobro 740.037,50, y aparece en la antigüedad de saldos. |
| 32 | Tras cobrar 400.000 quedan 340.037,50, y la valuación sigue aprobada. |
| 33 | Cobrada del todo, pasa a *cobrada* **sola**, sin que nadie la marque. |
| 34 | Cuentas por cobrar queda en cero **en el libro**, no solo en una consulta. |
| 35 | Ya no aparece en la antigüedad de saldos. |
| 36 | Avisa si se cobra de más, en vez de dejarlo pasar. |
| 37 | El libro sigue cuadrando tras el ciclo completo. |
| 38 | El plan de cuentas instala 86 cuentas con la jerarquía coherente. |
| 39 | Ninguna cuenta con hijos recibe movimiento: solo las hojas. |
| 40 | Las 86 cuentas están en los dos idiomas, y con nombres distintos. |
| 41 | Los cinco tipos de servicio tienen cuenta de ingreso propia. |
| 42 | Todos los conceptos apuntan a cuentas imputables que existen. |
| 43 | Instalarlo dos veces no duplica nada. |
| 30 | Un mes cerrado no admite un asiento nuevo — y la prueba comprueba que lo rechaza **por estar cerrado**, no por otro motivo. |

## Lo que sigue

1. **Los generadores que faltan:** factura de proveedor y pago emitido. Los de
   valuación y cobro ya están y sirven de molde.
2. **Aislamiento entre empresas** con políticas de fila (RLS), y su prueba: que una
   consulta hecha como cliente A no pueda devolver ni una fila de B.
3. **Importador de Excel.** La pantalla que decide si esto se usa o se abandona.

## Bloqueado

**El push a GitHub devuelve 403.** El Claude GitHub App no está instalado en `acalzadillaruiz/docs`.
Hasta que se resuelva, ninguna sesión nocturna puede conservar su trabajo.
Se arregla en https://claude.ai/connect-github

## Reglas que no se negocian

- Ningún importe es un número suelto: siempre moneda + tasa fechada + id de esa tasa.
- Ningún asiento se escribe a mano: lo genera el hecho que lo causa.
- La contabilidad nunca la ve un cliente. Excepción única: la hoja de valuación y la factura que debe aprobar o recibir.
- El cliente jamás ve el precio de compra ni el margen.
- Sin evidencia no hay avance. No existe campo de porcentaje editable a mano.
- Nunca se reproduce una contraseña ni una credencial en ningún archivo.
- La permisología está fuera de alcance.

## Límites de cada sesión automatizada

- NO desplegar en ningún servidor.
- NO tocar grupoprimesupply.com, public_html, Hostinger, ni el portal /track/ actual.
- NO usar ni contratar servicios de pago.
- NO abrir pull requests.
- NO tomar decisiones que le corresponden al CEO. Si una decisión de negocio bloquea,
  se anota en `DECISIONES-PENDIENTES.md` y se sigue con otra cosa.

## Cómo trabaja cada sesión

1. Comprobar que el push funciona: `git push --dry-run origin HEAD`. Si da 403, **no trabajar**:
   nada sobrevive al cierre del contenedor. Decirlo en una línea y terminar.
2. Leer este archivo. Dice dónde se quedó la sesión anterior.
3. Leer las respuestas del CEO con `ArtifactData` en
   https://claude.ai/artifact/LyvqcKwc6vevhbTHTFhyvs, documento `contabilidad/v1`.
   Si respondió algo nuevo, eso manda sobre lo que diga este archivo.
4. Hacer un trozo pequeño de trabajo, con su commit y su mensaje en español.
5. Actualizar este archivo: qué se hizo, cuántas sesiones de 141, el porcentaje, qué sigue.
6. Push a `claude/gps-web-tracking-contracts-z715gi`, reintentando a 2, 4, 8 y 16 segundos.
7. Si el porcentaje cruza un múltiplo de 10 no avisado, escribirlo arriba del todo
   bajo el título **AVISAR AL CEO: xx%**.
8. **No parar al terminar un trozo.** Instrucción expresa del CEO: si la sesión
   acaba su trozo y todavía le quedan recursos, vuelve al punto 4 y hace el
   siguiente. Se para cuando se agota la sesión, no cuando se acaba una tarea.
   Cada trozo terminado se commitea y se empuja antes de empezar el siguiente,
   para que nada se pierda si la sesión se corta a media faena.
