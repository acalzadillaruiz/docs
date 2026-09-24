# GPS Nexus · estado

**Última actualización:** 2026-09-24, 22:00 (España)
**Avance:** 22 de 141 sesiones · **16%**
**Fase en curso:** 5 — La contabilidad deja de vivir en Excel *(adelantada a primera por decisión del CEO)*

## RETOMAR AQUÍ

**Lo último terminado:** las dos piezas criptográficas de la entrada. `totp.ts`
(segundo factor, comprobado contra los vectores oficiales del RFC 6238) y `clave.ts`
(scrypt y códigos de recuperación). Veintidós pruebas entre las dos.

**Lo siguiente, en este orden exacto:**

1. `app/src/dominio/sesion.ts` — juntar las piezas: buscar la persona por correo,
   verificar clave, exigir segundo factor, y el bloqueo por intentos fallidos. El
   bloqueo cuenta por cuenta **y por origen**: solo por cuenta, cualquiera bloquea a
   quien quiera con seis intentos malos a propósito.
2. Tabla `intento_acceso` y tabla `codigo_recuperacion` en un nuevo
   `db/schema/17-sesiones.sql`. Un código gastado **no se borra**: se marca, para que
   quede constancia de cuál se usó y cuándo.
3. `app/src/pantallas/entrada.ts` — las cuatro pantallas: ingreso, segundo factor,
   recuperación e invitación aceptada.
4. `app/src/dominio/sso.ts` — entrar con la cuenta de la empresa. Lo importante no es
   el botón: es que cuando la operadora da de baja al empleado, pierda el acceso.
   `organizacion.metodos` e `idp_tenant` ya están en el esquema.

**Cómo continuar, literalmente:**

```bash
cd /home/user/docs/nexus/db && ./probar.sh    # tiene que decir TODAS LAS PRUEBAS PASAN
cd /home/user/docs/nexus/app && npx tsc --noEmit
```

`probar.sh` levanta un PostgreSQL desechable, carga el esquema, corre las pruebas de
base de datos, el diccionario bilingüe y las de la aplicación. Si algo falla ahí, eso
es lo primero, antes que cualquier cosa nueva.

**Nunca se añade código sin su prueba en la misma sesión.** Ese es el motivo de que
137 comprobaciones hayan encontrado seis fallos reales, cuatro de ellos míos.

---

## AVISAR AL CEO: 10%

Primer décimo del proyecto. Lo que hay es el **motor contable completo y probado**:
del contrato a la valuación, de la valuación al asiento, del asiento al cobro, y de
todo ello a los estados financieros y al margen. Más el aislamiento entre empresas,
el diccionario bilingüe y la importación desde Excel.

Todavía **no hay ni una pantalla**. Eso empieza después: lo de abajo es el motor, y
construir las pantallas sobre un motor que ya se sabe correcto es mucho más rápido
que al revés.

---

**Las pruebas pasan.** `nexus/db/probar.sh` levanta un PostgreSQL desechable, carga el
esquema entero, comprueba las ciento dieciséis reglas duras, el diccionario bilingüe y las cuarenta y dos pruebas de la aplicación y revisa el diccionario
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
| `db/pruebas/08-egresos.sql` | Las retenciones emitidas, su asiento, y que el libro de compras las refleje sin transcribir. |
| `db/pruebas/09-gerencia.sql` | Margen, rentabilidad, flujo de caja, y que el cliente ni siquiera pueda preguntar. |
| `db/pruebas/10-importacion.sql` | Una hoja con dos filas buenas y dos malas: que las detecte, que diga por qué, que se niegue a confirmar, y que tras corregirlas entre limpia. |
| `db/pruebas/11-pagos.sql` | El pago parcial, el intento de pagar de más, y un extracto con tres movimientos de los que solo uno casa. |
| `db/pruebas/12-activos.sql` | Cinco años de depreciación mes a mes, hasta agotar exactamente lo depreciable. |
| `db/pruebas/13-reexpresion.sql` | Índice que se duplica en el año: qué se reexpresa, qué no, y que el balance vuelva a cuadrar. |
| `app/pruebas/totp.test.ts` | Los cuatro vectores oficiales del RFC 6238, la tolerancia de reloj, y que un código de ayer no valga hoy. |
| `app/pruebas/clave.test.ts` | Que la huella no contenga la clave, que dos iguales den huellas distintas, y que los acentos se normalicen. |
| `app/pruebas/pantalla.test.ts` | Que el neto vaya aparte, que el texto se escape, que la página declare su idioma, y que sea una sola pantalla para las dos superficies. |
| `app/pruebas/aislamiento.test.ts` | Se conecta como cliente de A y **pide la valuación de B por su identificador**. |
| `db/pruebas/07-plan-cuentas.sql` | Que el plan se instale, que la jerarquía sea coherente, que esté en los dos idiomas, y que instalarlo dos veces no duplique nada. |
| `db/schema/08-estados.sql` | Balance de comprobación, estado de resultados y balance general. **No son informes que alguien arma: son el libro mirado de otra forma**, así que no pueden descuadrar respecto a él. Más el cierre de período, que se niega a cerrar un mes descuadrado o con el anterior abierto. |
| `db/schema/09-cobros.sql` | Cierra el ciclo: valuación → asiento → cobro → asiento. Cuando el cobro entra, la cuenta por cobrar queda en cero **sola**. El saldo no se guarda: se resta, porque un saldo guardado es un saldo que algún día dejará de ser cierto. El IGTF se causa aquí y no al facturar, porque grava el pago en divisa, no la factura. |
| `db/schema/10-plan-cuentas.sql` | Plan de cuentas **propuesto** para servicios petroleros en Venezuela: 86 cuentas en los dos idiomas. Es una propuesta, no una imposición: nada del sistema depende de estos códigos, porque las cuentas se referencian por concepto. Los ingresos van separados por tipo de servicio, porque saber cuál de los cinco deja dinero es media decisión de negocio. |
| `db/schema/11-egresos.sql` | **La mitad que hoy no está en ninguna pantalla.** GPS como agente de retención: retiene el IVA al 75% a sus proveedores y emite el comprobante con correlativo generado por la base de datos, no a mano — un correlativo llevado a mano acaba con huecos o repetido, y las dos cosas son un problema. Más el costo imputado al contrato, que es lo que permite ver el margen **mientras el contrato corre**. |
| `db/schema/12-gerencia.sql` | **Nada de aquí lo alcanza un cliente jamás.** Margen por contrato (lo valuado contra lo que ha costado), rentabilidad por cliente y por tipo de servicio, ejecutado sin cobrar, y flujo de caja proyectado por semana. Todo sale del libro, así que el margen de esta pantalla y el resultado del estado financiero son el mismo número. |
| `db/schema/13-importacion.sql` | **Salir de Excel.** La hoja entra tal cual, fila por fila. La aplicación propone cómo entendió cada columna y **lo enseña**; el humano corrige. Se valida sin escribir nada. Solo entonces se confirma — y nunca a medias: si queda una fila con error, no entra ninguna, porque una carga a medias es peor que no haber cargado. El formato numérico se declara, no se adivina: `1.234` son mil doscientos treinta y cuatro en venezolano y uno coma dos en anglosajón. |
| `db/schema/14-pagos.sql` | Pagos emitidos y **conciliación bancaria**. Lo que no casa **no se esconde**: un movimiento del banco sin documento, o un documento sin movimiento, queda señalado hasta que alguien lo explique por escrito. La propuesta de casamiento la hace la máquina; casar lo hace un humano, porque dos movimientos del mismo importe el mismo día son más frecuentes de lo que parece. |
| `db/schema/15-activos.sql` | Activos fijos y depreciación. Para GPS no es contabilidad de adorno: **alquiler de equipos es uno de los cinco tipos de contrato**, y un equipo alquilado genera ingreso y se gasta al mismo tiempo. Si solo se mira el ingreso, el negocio parece mejor de lo que es. El desgaste se imputa al contrato donde se gana. |
| `db/schema/16-reexpresion.sql` | Reexpresión por inflación (VEN-NIF / NIC 29). **Partida por partida**, cada una con el índice del día en que ocurrió — casi todos los programas lo hacen por saldos mensuales promedio porque es lo que permite una hoja de cálculo; aquí la fecha ya estaba en el libro, así que no cuesta más y es exacto. El resultado monetario no es un ajuste de cuadre: es lo que costó tener bolívares mientras se devaluaban. |
| `app/src/db/conexion.ts` | **No se puede consultar sin declarar quién pregunta.** No se exporta el cliente de base de datos: solo `comoPersona()`, que fija la identidad dentro de una transacción y la suelta al salir. Olvidarlo no es un descuido posible: no hay otra puerta. |
| `app/src/i18n/t.ts` | Traducción con la clave comprobada por el tipo, y formato de número, moneda y fecha según el idioma. |
| `app/src/dominio/valuacion.ts` | La hoja lista para pintar. **El cálculo no se repite aquí**: vive en la base de datos y ya tiene su prueba. Repetirlo sería tener dos verdades. |
| `app/src/pantallas/valuacion.ts` | **La primera pantalla.** Una sola función para las dos superficies: en escritorio las líneas son una tabla, en el móvil tarjetas apiladas. No son dos pantallas, es la misma reacomodada por la hoja de estilos. No enseña un total: enseña el camino hasta el total. |
| `app/herramientas/pintar.ts` | Genera una pantalla desde la base de datos real, sin desplegar nada. Para revisar diseño y para enseñar avance. |
| `app/src/dominio/totp.ts` | Segundo factor, los códigos de seis dígitos del Authenticator. Escrito con la criptografía que trae Node, sin dependencias: son cuarenta líneas y el algoritmo está congelado desde 2011. Acepta el código del paso anterior y el siguiente, porque sin esa tolerancia quien tenga el reloj desfasado no entra nunca — y acaba pidiendo que le quiten el doble factor. |
| `app/src/dominio/clave.ts` | scrypt con N=32.768, y códigos de recuperación de un solo uso. **GPS nunca ve una clave**: guarda la huella y la sal. Con Microsoft o Google, ni eso. Los códigos no llevan `0 O 1 I L`: se apuntan en papel, y un código mal transcrito en el peor momento es lo que hace que la gente desactive el doble factor. |
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
| 44 | No retiene IVA si GPS no es agente de retención en esa fecha. |
| 45 | Siendo especial, retiene el 75%: 60.000,00 sobre un IVA de 80.000. |
| 46 | Retención de ISLR a proveedor: 24.962,50. |
| 47 | El comprobante lleva correlativo con el período delante: `20260900000001`. |
| 48 | No retiene dos veces la misma factura. |
| 49 | El asiento de la factura de proveedor cuadra línea por línea. |
| 50 | El costo queda imputado al contrato: visible mientras corre. |
| 51 | Aparece en el libro de compras con su retención, **sin que nadie lo transcriba**. |
| 52 | Sin número de control retiene el **100%**, no el 75%, como manda el reglamento. |
| 53 | El correlativo sigue la secuencia: `...000001`, `...000002`. Sin huecos ni repeticiones. |
| 54 | Margen del contrato: 500.000,00 (50,00%), avance 5,00%. |
| 55 | La cartera, la rentabilidad por cliente y la rentabilidad por tipo de servicio cuadran. |
| 56 | Ejecutado sin cobrar: 740.037,50. |
| 57 | El flujo de caja proyecta cobro 740.037,50 y pago 495.037,50 (la factura menos lo retenido). |
| 58 | **El cliente no tiene permiso ni para preguntar por el margen.** |
| 59 | Lee números en los dos formatos, y `1.234` significa cosas distintas en cada uno. |
| 60 | Lee fechas, y devuelve nulo en vez de inventarse una. |
| 61 | La previsualización enseña cómo entendió cada celda. |
| 62 | Y dice claramente cuál no entiende, en vez de callarse. |
| 63 | Valida **sin escribir nada**: 4 filas, 2 buenas, 2 malas. |
| 64 | El motivo dice qué columna y por qué. |
| 65 | No confirma con filas malas. |
| 66 | Corregidas, entra limpia: las cuatro filas. |
| 67 | Avisa de las columnas obligatorias que falten por mapear. |
| 68 | La hoja original sigue guardada, fila por fila, por si algo sale mal después. |
| 69 | Por pagar al proveedor: 495.037,50, y aparece en lo que toca pagar. |
| 70 | Tras pagar 300.000 quedan 195.037,50. |
| 71 | Avisa si se paga de más, en vez de dejarlo pasar. |
| 72 | Propone el casamiento del pago: mismo día, mismo importe. |
| 73 | Los dos movimientos sin explicar **quedan señalados**. |
| 74 | No se da por conciliado un movimiento sin casarlo o explicarlo **por escrito**. |
| 75 | Explicado, queda conciliado; el depósito sin identificar sigue señalado. |
| 76 | Un mismo pago no se puede casar con dos movimientos del banco. |
| 77 | El libro sigue cuadrando con los pagos dentro. |
| 78 | Cuota mensual 50.000,00, y antes de entrar en servicio no se deprecia nada. |
| 79 | Doce meses: 600.000,00 acumulados, valor en libros 3.000.000,00. |
| 80 | Un mes no se deprecia dos veces. |
| 81 | El desgaste se imputa **al contrato donde se gana**. |
| 82 | El alquiler deja 900.000,00: ingreso 1.500.000 menos desgaste 600.000. |
| 83 | A los sesenta meses deprecia **exactamente** lo depreciable y queda el residual. |
| 84 | Agotado, ya no genera más gasto aunque el equipo siga trabajando. |
| 85 | El libro cuadra con cinco años de depreciación dentro. |
| 86 | Marca 26 cuentas monetarias del plan propuesto. |
| 87 | Factor de enero a diciembre: 2,0 cuando el índice se duplica. |
| 88 | El banco **no** se reexpresa: un bolívar sigue siendo un bolívar. |
| 89 | El equipo sí: 1.000.000 de enero son 2.000.000 en moneda de diciembre. |
| 90 | El capital aportado en enero equivale a 4.000.000 de diciembre. |
| 91 | Resultado monetario: 1.000.000 de **pérdida** por haber tenido bolívares el año. |
| 92 | Tras el asiento de reexpresión, el libro vuelve a cuadrar. |
| 93 | Y el balance reexpresado cuadra: activo = pasivo + patrimonio. |
| 94 | No se reexpresa dos veces el mismo mes. |
| 95 | Sin índice publicado **se niega**, en vez de inventarse un factor. |
| 96 | La hoja llega a la aplicación con el neto calculado en la base de datos. |
| 97 | La misma hoja en inglés usa el vocabulario correcto y el formato anglosajón. |
| 98 | Lo que resta viene marcado: la pantalla no interpreta signos. |
| 99 | El cliente de A ve su propia valuación. |
| 100 | El cliente de A pide la de B **por su identificador** y no la recibe. |
| 101 | El error **no distingue** entre «no existe» y «no es tuya». |
| 102 | La identidad **no se queda pegada** a la conexión entre peticiones. |
| 103 | El neto va en su propio bloque, no como una línea más. |
| 104 | Lo que resta se marca con una clase, no con el signo. |
| 105 | Un nombre de cliente con `<` o `&` no rompe la página. |
| 106 | La página declara su idioma, para el lector de pantalla y el traductor del navegador. |
| 107 | Es **una sola pantalla** para escritorio y móvil, no dos plantillas. |
| 108 | Funciona en modo oscuro sin que el usuario elija nada. |
| 109 | El título de la pestaña dice de qué valuación se trata, en los dos idiomas. |
| 30 | Un mes cerrado no admite un asiento nuevo — y la prueba comprueba que lo rechaza **por estar cerrado**, no por otro motivo. |

## Lo que sigue

1. **Los generadores que faltan:** factura de proveedor y pago emitido. Los de
   valuación y cobro ya están y sirven de molde.
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
9. **Dejar el relevo antes de terminar.** Lo último que hace cualquier sesión es
   reescribir la sección **RETOMAR AQUÍ** de arriba: qué quedó hecho, con qué
   commit, y cuál es el siguiente paso concreto. Si una sesión se corta sin
   hacerlo, la siguiente pierde tiempo averiguando dónde estaba. Por eso se
   actualiza **al terminar cada trozo**, no solo al final.

## Relevo automático

Doce sesiones al día, de **22:00 a 09:00 hora de España**, una por hora. Cada una
arranca de cero, lee este archivo y sigue donde quedó la anterior. El 25 de octubre
una Routine las corre una hora sola, cuando España cambie a horario de invierno, y
programa el ajuste de vuelta para marzo.
