# GPS Nexus · estado

**Última actualización:** 2026-09-27, 03:30 (España)
**Sesiones gastadas:** 141 de las 141 del plan · **el plan se acabó; el producto no**
**Fase en curso:** 5 — La contabilidad deja de vivir en Excel *(adelantada a primera por decisión del CEO)*

> **Qué mide ese 99% y qué no.** Mide las sesiones de trabajo previstas, que se han
> gastado casi todas. **No** mide el producto terminado, y conviene decirlo antes de
> que alguien lea «99%» y entienda otra cosa — este sistema entero existe para que el
> avance salga de lo que se puede demostrar, así que no voy a hacer con mi propio
> avance lo que el sistema impide hacer con el de un contrato.
>
> Lo que hay construido, contado a mano sobre el código de hoy: **30 módulos de
> pantalla** y **153 páginas** en el recorrido exportado, sobre las 119 vistas del plan
> completo (una vista del plan sale en varias páginas: con datos, vacía, y con error).
> Las cifras de antes decían «40 direcciones y 26 pantallas» y no salen de ninguna
> cuenta que sepa repetir, así que se cambian por las que sí. Lo que está **entero y probado
> de punta a punta** es la contabilidad —las 36 vistas que el CEO mandó primero— más
> el núcleo de contratos, evidencia y valuaciones que la sostiene. Lo que **no está**
> son las fases de logística y procura, calidad, el portal del cliente más allá de lo
> básico, y la venta como servicio a otras empresas.

## AVISO AL CEO: el plan de 141 sesiones se acabó

**Página publicada:** https://claude.ai/artifact/F8t5vJETMkc7R8jkp1KARc
**Recorrido navegable, al día:** https://claude.ai/artifact/613p36bPqXYLT31Tvdrck3

No dice «100% hecho», porque no lo está, y decirlo sería justo la confusión que esta
aplicación impide cometer con un contrato. Dice lo que hay —**38 vistas de 119**, con
la contabilidad entera y probada—, lo que no hay, los cuatro fallos reales que
salieron de mirarlo con cuidado (dos míos, en pruebas de seguridad), y las tres
decisiones que faltan y no son mías: dónde se despliega, si se abre la política de
seguridad para funcionar sin conexión, y las ocho preguntas de contabilidad.

## RETOMAR AQUÍ

**Lo último terminado:** **un correo que no se manda** — y el quinto barrido, del último
nivel que quedaba.

El barrido nuevo busca **valores de enum que la aplicación nunca escribe**. Es la misma
forma del agujero grande de ayer: `estado_contrato` declaraba cinco estados y se llegaba a
dos. Un valor de enum que nadie escribe es una posibilidad que el esquema promete y el
producto no tiene. De 71 valores salieron **dos**.

Y uno tapaba un fallo con consecuencia para el cliente. El circuito, tal como estaba:

1. Se presenta una valuación. Un disparador encola el aviso «hay algo esperando tu firma».
2. El bucle de avisos lo manda en la siguiente pasada, unos minutos después.
3. Si entre una cosa y otra la valuación **se anula** —una presentación equivocada que se
   corrige en el momento, que es justo cuando pasa—, se liberan sus hitos y **el aviso no se
   toca**.
4. El correo sale igual. El cliente recibe «hay algo esperando tu firma» de una valuación que
   ya no existe, y entra al portal a buscarla.

Anular ya liberaba los hitos: eso estaba pensado. Lo que no estaba era que el aviso ya
encolado dejara de tener sentido — y `estado_aviso` tenía desde el primer día un valor
`descartado` que no ponía nadie. Ahora una valuación que deja de estar presentada descarta
ese aviso, una anulada descarta todos los suyos, y queda escrito por qué.

**Lo delicado era no descartar de más:** los dos disparadores tocan la misma cola, y el
orden entre ellos lo decide su nombre. Si el de descartar corriera antes, se llevaría por
delante el aviso del estado nuevo que el otro acaba de encolar — o sea que aprobar una
valuación no avisaría a GPS. Comprobado de las dos maneras: sin el disparador (las dos
pruebas rojas) y descartando de más (roja la que vigila justo eso).

El otro valor, `estado_periodo.en_cierre`, queda **declarado y no construido**: un periodo va
de abierto a cerrado, y el paso intermedio serviría para congelar las operaciones mientras se
hacen los asientos de ajuste. Eso es una decisión sobre el proceso de cierre —quién puede
asentar durante él— no un arreglo de programación.

**Los cinco barridos permanentes, ahora:** funciones del esquema que nadie llama, términos
del diccionario que ninguna pantalla pinta, tablas que la aplicación no escribe, columnas que
nadie nombra, y valores de enum que nadie escribe. Los cinco tienen su lista declarada con
motivos y su afirmación de que **fallan cuando dejan de mirar** — al de enums le hizo falta
el primer día: contestó «0 valores» tan contento porque la base de datos se había caído.

**887 pruebas, todas pasan.**

**Lo que sigue esperando al CEO, y bloquea el despliegue:** crear el VPS en Hostinger,
añadir el registro A de `nexus` apuntando a su IP, y darme la IP. Los cinco pasos están en
`DESPLEGAR.md`.

**Antes:** **un contrato que termina ya puede terminarse**, y el barrido de columnas que
lo encontró.

`estado_contrato` declara cinco estados desde el primer día —borrador, vigente, suspendido,
cerrado, liquidado— y la aplicación sabía llegar a **dos**. `alta.ts` pasa de borrador a
vigente y ahí se acababa: nada suspendía, nada cerraba y nada liquidaba. Lo que eso
significaba en uso:

- **Un contrato terminado se quedaba vigente para siempre.** La cartera enseñaba los
  acabados junto a los que están corriendo, sin forma de distinguirlos.
- **«¿Terminamos tarde?» no tenía respuesta**, en un producto que existe para medir la
  ejecución de contratos. `fin_real` no la escribía nadie.
- Dos pantallas —equipos y caja chica— ya consultaban `estado in ('vigente','suspendido')`,
  escritas contando con una suspensión que no existía.
- Y **liquidado**, que es el finiquito, no se alcanzaba de ninguna manera.

Ahora hay `/contratos/:id/estado`, con el histórico de por dónde ha pasado, **el motivo
escrito de cada cambio y quién lo hizo**, y delante de todo **cuántos días tarde terminó**.
Reabrir un contrato cerrado **borra la fecha real de fin**, porque un contrato que vuelve a
estar en marcha no terminó; el histórico sí la conserva.

**Lo que sujeta la liquidación no es criterio de nadie, es una resta:** no se liquida un
contrato al que se le debe dinero o al que le queda obra verificada sin facturar, y el
mensaje dice la cifra. «No se puede» manda a buscar; «quedan 12.400 sin cobrar» manda a
cobrar.

### El barrido nuevo: columnas que nadie nombra

Los otros tres barridos miran funciones, términos del diccionario y tablas. Faltaba el grano
más fino, y ahí estaba escondido esto: se pregunta a la base qué columnas existen y se busca
cada nombre en el código y en el resto del esquema, quitando la propia declaración de la
tabla —nombrar una columna al crearla no es usarla—. De 470 columnas salieron cinco, y una
era `contrato.fin_real`.

Las otras cuatro: **`sesion.cerrada_por`**, que tampoco escribía nadie y ya sí. Cerrar la
sesión de alguien es echarlo del sistema en ese momento, y para la única pregunta que se hace
después de un incidente —quién la echó— quedaba el motivo y no el autor. `persona_actual()`
ya estaba ahí sin recogerse. Las tres restantes son del modelo de capacidades sin usar y
están declaradas con su motivo.

### Dos pruebas mías que pasaban en vano, cazadas apagando lo que vigilan

1. **«cerrar exige la fecha real de fin»** seguía verde con la comprobación apagada en las
   DOS capas. El motivo de siempre: un `hecho === false` no dice nada cuando hay varias
   maneras de ser falso, y aquí eran tres —sin fecha, fecha imposible y fecha anterior al
   inicio— porque una cadena vacía es menor que cualquier fecha y todas caían en la misma
   comparación. Ahora se afirma **cuál** de los tres mensajes vuelve, comparándolo con el
   del diccionario y no con un trozo escrito a mano.
2. **«el cliente no puede escribir el histórico»** seguía verde con la política de fila
   abierta del todo, porque la cerradura de verdad es otra: al cliente no se le concede
   `insert` sobre esa tabla. La prueba afirma lo que importa —que no puede— y ahora lo dice
   con precisión en vez de atribuirlo a la política.

**Y casi me llevo por delante un archivo:** escribí este módulo en `src/dominio/estados.ts`,
que ya existía y es el de los **estados contables** —balance y resultados—. Lo salvó que
`tsc` gritó en el acto y que estaba en git. El módulo se llama `ciclo.ts`.

**884 pruebas, todas pasan.** Verificado rompiendo a propósito: la comprobación del dinero
para liquidar, la de la fecha de fin (en las dos capas), la política de vista del histórico,
el barrido nuevo —añadiéndole una columna huérfana a `contrato` para verlo nombrarla—, y la
escritura de `sesion.cerrada_por`.

### Lo que queda de la lista de deudas

- **`capacidad` / `persona_capacidad`**, el modelo de permisos finos: dos tablas y tres
  columnas que nadie escribe ni lee. **No lo he construido a propósito**, y conviene que
  quede dicho por qué: `capacidad` no tiene ni una fila, así que `persona_capacidad` no
  puede tener ninguna y el disparador que dice «esta capacidad es interna y no se concede a
  un cliente» **nunca ha corrido**. Hoy el alcance lo decide ser de GPS o ser cliente, y eso
  funciona y está probado. Encenderlo es la **decisión 5** —quién más toca la contabilidad—,
  que es del CEO y no mía.
- **La decisión 14**, que es de dinero: `valuar.ts` elige el concepto de ISLR de cada
  valuación con `order by vigente_desde desc limit 1`, sin mirar de qué concepto se trata.

**Antes:** **los valores fiscales** — y con ellos, el agujero más grave que ha aparecido en
todo el proyecto.

La tasa del BCV **no se podía cargar.** Cambia todos los días, de ella cuelga cada
contrato, cada valuación y cada cobro, y no existía ninguna pantalla donde ponerla. El
sistema dejaba de servir al día siguiente de arrancar. Igual la unidad tributaria, la
alícuota de IVA, la de IGTF y los conceptos de ISLR: las cinco tablas que el propio
esquema declara en su primera línea —«ningún porcentaje se escribe dentro del código;
todos viven aquí como filas con fecha»— no las escribía nada.

**Y esto es lo importante: el barrido que existe justo para encontrar esto lo estaba
contentando el sembrador.** El barrido leía `herramientas/` entero como si fuera la
aplicación, y ahí vive `sembrar.ts`. Cuatro de las cinco tablas pasaban porque las
escribía la empresa de muestra. Tercera vez que aparece lo mismo —el fixture hace lo que
la aplicación no hace— y la primera dentro del propio barrido. Arreglado: `sembrar.ts`,
`medir.ts` y `exportar.ts` ya no cuentan como aplicación, y al quitarlos el barrido nombró
las cuatro.

Lo que hay ahora, en `/fiscales`: las cinco listas con **su fecha de vigencia y cuántos
papeles hay debajo de cada valor**, y arriba, delante de todo, **lo que falta para poder
trabajar hoy**. Corregir un valor de ayer es legítimo y es seguro —cada retención congela
el porcentaje, el sustraendo y la UT que aplicó, y cada factura guarda su alícuota—, pero
la consecuencia se ve antes de tocarlo.

**Lo que salió de tirar del hilo, que es más que la pantalla:**

1. **Rectificar la tasa del BCV ya se podía, y nadie lo había usado.** El esquema traía
   `sustituida_por` y un índice único *parcial* —un día, una sola tasa de las no
   sustituidas—, o sea el mecanismo entero para que el BCV rectifique sin reescribir lo ya
   asentado. Mi primera versión insertaba la nueva antes de marcar la vieja y chocaba con
   ese índice; y marcar primero tampoco se podía, porque la clave ajena exige que la fila
   nueva exista. De ahí el paso de en medio: la vieja se marca sustituida por sí misma,
   entra la nueva, y al final apunta a ella. Y rectificar hay que **pedirlo**: sin la
   casilla, una tasa de un día que ya tiene tasa es un error, porque lo normal es haberse
   equivocado de día.
2. **`alicuota_iva` no tenía clave natural, y el `on conflict do nothing` del sembrador no
   hacía nada** — sin restricción que arbitrar, lo único con lo que podía chocar era un
   uuid nuevo. Diecisiete filas de («general», 16 %, 2026-01-01) en la base de pruebas, y
   los lectores buscan `order by vigente_desde desc limit 1`: con dos filas del mismo día,
   **cuál rige lo decidía el orden de lectura.** Nuevo archivo `34-fiscales.sql` con el
   índice único, precedido de una limpieza que **pregunta al catálogo quién referencia la
   tabla en vez de recordarlo** —mi primera versión se olvidó de `valuacion` y se estrelló
   contra la clave ajena— y que se para si quedan duplicados en uso.
3. **`herramientas/` no se comprobaba con TypeScript.** `tsconfig.json` incluía solo `src/`
   y `pruebas/`. Ahí viven `migrar.ts` e `instalar.ts`, que son lo que corre un servidor de
   verdad. Al incluirlo salieron **catorce errores de tipos escondidos**: once en
   `avisar.ts`, que es uno de los cinco servicios del despliegue, y uno en `entrada.ts`,
   que construía la pantalla de recuperación sin el campo que necesita, así que ese paso
   salía con el enlace roto.
4. **En la base de muestra no se podía emitir una valuación, y `COMO-CORRERLO.md` decía
   que sí.** El escenario de la muestra es de marzo de 2027 —futuro— y la única tasa
   sembrada era de entonces, mientras que todo lo que se emite busca la de hoy o anterior.
   Comprobado llamando a `emitir`: «no hay tasa del BCV publicada todavía para hoy» antes,
   y una valuación con sus cuatro hitos después. **Y al IGTF no lo sembraba nadie** —ni el
   esquema ni el sembrador; la única fila de la base de pruebas la había dejado commiteada
   el fixture de alguna prueba—, así que un cobro en divisa se caía dentro de
   `calcular_igtf`. Lo encontró el repaso que **el sembrador se hace ahora a sí mismo** al
   terminar: si falta un valor fiscal, lo dice ahí, que es donde todavía no cuesta nada.
5. **El sembrador reventaba al sembrar dos veces.** Su freno decía «si ya hay 40 contratos,
   vuelve» y siembra quince, así que nunca frenaba. Y yo di por bueno un `on conflict`
   mirando una segunda pasada que en realidad se había caído, con el `2>&1` tapándolo.

**Dos veces me equivoqué al escribir estas pruebas, y las dos por lo mismo: dar por hecho
el estado del mundo en vez de construirlo.** La prueba del aviso afirmaba que en la base de
muestra no faltaba nada (faltaban dos, y eso era el fallo de verdad). La siguiente versión
borraba la tasa de hoy para provocar el aviso, y de la tasa de hoy solo cabe una: lo cazó
el comprobador de colisiones, porque `alta.test.ts` también la pone. Ahora `loQueFalta`
recibe la fecha por fuera y la prueba se monta su propio día en 1990, que no usa nadie, y
comprueba los cinco avisos en vez de dos.

**868 pruebas, todas pasan.** Verificado rompiendo a propósito: el índice único del IVA, el
aviso de lo que falta, el barrido de tablas sin puerta, y la guardia de variables de
entorno de `avisar.ts`, que ahora dice **cuál** falta y no las dos.

**Y una decisión nueva para el CEO, la 14, que es de dinero:** `valuar.ts` elige el
concepto de ISLR de cada valuación con `order by vigente_desde desc limit 1`, sin mirar de
qué concepto se trata. Con uno solo sembrado sale el bueno por casualidad; con dos, la
retención la decide un `order by`. No lo he tocado porque el concepto correcto es una
clasificación fiscal y depende de qué se factura.

**Antes:** **las plantillas de hitos, y el guardián de que sumen 100.** Era
el trozo que estaba aparcado a propósito, y con razón: el guardián solo, sin pantalla para
arreglar una plantilla, bloquearía el alta de contratos sin dar forma de desbloquearla.
Ahora van los dos juntos. `plantilla_hito` **sale de `NO_ESCRIBE_LA_APP`**: era la última
tabla de esa lista que era una pantalla mandando algo imposible (`/medidas` decía «ese tipo
de contrato todavía no tiene plantilla de hitos» y no había forma de crear una).

El fallo silencioso que esto cierra: **si una plantilla suma 90, un renglón con TODOS sus
hitos verificados se queda para siempre en el 90 %** y no sale un error en ninguna parte.
Sale un contrato que no acaba de avanzar y la explicación está en una tabla que nadie
mira. El comentario «la suma por tipo debe dar 100» llevaba ahí desde el primer día y era
un comentario, no una comprobación.

Cómo queda sujeto, en tres sitios y a propósito:

1. **La base de datos.** `suma_plantilla(tipo)` y, dentro de
   `crear_hitos_desde_plantilla`, el rechazo con su explicación. Es la que no se puede
   saltar: la comprueba cualquier camino que alguien añada mañana.
2. **El dominio**, en los DOS sitios que crean hitos —el alta de un contrato y el botón de
   `/medidas`—, para que quien pulsa lea una frase en su idioma en vez de encontrarse una
   transacción abortada.
3. **La pantalla** `/plantillas`, donde **la suma va delante**, en verde o en rojo, con el
   número de renglones que ya tienen hitos hechos con cada plantilla. Se puede guardar una
   plantilla a medias —montar una nueva empieza por dejarla en 25— pero no usarla.

**El agujero que encontró el barrido de formularios en blanco**, y que es lo más
importante de este trozo: la primera versión puso un botón «Quitar» por paso, con el tipo
y el orden ya metidos en campos escondidos. Mandar los formularios sin tocar nada **dejaba
la tabla vacía**, y con la tabla vacía no se puede dar de alta ni un contrato de ningún
tipo, porque los hitos salen de ahí. Ahora quitar un paso **exige escribir su clave**,
igual que dar de baja a una persona exige escribir el motivo. Es el mismo fallo y la
segunda vez.

**Dos pruebas que pasaban en vano, encontradas por el camino y arregladas:**

- *«un tipo de contrato sin plantilla lo DICE»* buscaba un tipo sin plantilla y, al no
  haber ninguno, afirmaba `true` y salía — lo decía en un comentario. Al construir la
  situación seguía pasando **con el borrado desactivado**, porque le pedía los hitos a un
  renglón que ya los tenía: el rechazo venía de otra cosa. Ahora el renglón nace limpio
  dentro de la prueba y se afirma **cuál** de los cinco rechazos vuelve. Un
  `hecho === false` no dice nada cuando hay cinco maneras de ser falso.
- Y eso destapó **dos términos del diccionario con la misma frase exacta**
  (`medida.error.sin_plantilla` y `plantilla.error.sin_plantilla`) y una comprobación
  muerta en `medidas.ts`: `plantillaUsable` ya llegaba a la misma conclusión con las
  mismas palabras. Fuera la rama y fuera el término duplicado. Dos maneras de llegar al
  mismo sitio no son dos cerraduras: son una cerradura y una copia que hay que acordarse
  de cambiar.

**Y una lección de pruebas que costó una vuelta entera:** las doce pruebas nuevas pasaban
solas y **tumbaban trece de otros dos archivos**. `plantilla_hito` no lleva
`organizacion_id`: es la misma tabla para todas las operadoras y para todos los archivos de
prueba, que corren **a la vez**. Rompían la plantilla, comprobaban, y la devolvían a su
sitio — y en esa ventana otro archivo daba de alta un contrato de alquiler y se la
encontraba a medias. **Restaurar después no sirve; lo que sirve es que lo roto no se
publique nunca.** Todo va dentro de una transacción que se deshace, y un `after` comprueba
que la plantilla quedó exactamente como la trajo el esquema, para que quien añada mañana
una prueba que escriba fuera de ahí lo vea fallar en su archivo y no en el de otro.

**850 pruebas, todas pasan.** Verificado rompiendo a propósito: el guardián de la suma (la
prueba que llama a la función de la base se pone roja), el barrido de tablas sin puerta (se
pone rojo si se vuelve a declarar `plantilla_hito`), el guardián del `after` (se pone rojo
si una prueba deja rastro), y la cerradura de `plantillaUsable`.

**Antes:** **todo lo que hace falta para desplegarla de verdad.** El CEO
probó `localhost:8080` y no funcionaba, con razón: ese servidor corría dentro del
contenedor de la sesión. Eligió desplegar, con `nexus.grupoprimesupply.com`, y me dejó
elegir dónde. **Elegido: un VPS de Hostinger con Docker**, con sus contras escritos en
`DESPLEGAR.md`. Está todo preparado y probado salvo las tres cosas que necesitan un demonio
de Docker, que esta máquina no tiene: construir la imagen, `docker compose up`, y que Caddy
saque el certificado.

**Lo que espera al CEO, y bloquea el despliegue:** crear el VPS en Hostinger, añadir el
registro A de `nexus` apuntando a su IP, y darme la IP. Los cinco pasos están en
`DESPLEGAR.md` y ninguno lleva más de diez minutos.

**Antes:** **registrar el régimen de IVA de la empresa.** La pantalla de
proveedores decía, con estas palabras: «Esta empresa no consta como agente de retención
de IVA en esta fecha, así que no corresponde retener. **Si lo es, hay que registrarlo en
su régimen de IVA.»** Y no había forma de registrarlo: `regimen_iva` la escribían solo
las pruebas, cada una en su fixture.

En uso real eso significaba que **la retención de IVA a proveedores no se podía hacer
nunca**, y para un contribuyente especial no es una opción, es una obligación. Una
pantalla que manda hacer algo tiene que poder hacerlo.

Tres cosas del diseño:

1. **Es un histórico con fecha, no un interruptor.** Una empresa pasa a contribuyente
   especial el día que el SENIAT la designa, y lo que se le retuvo antes se rigió por lo
   de antes.
2. **La lista dice cuántas retenciones se emitieron bajo cada tramo.** Es lo que hace
   visible la consecuencia de cambiar uno, antes de cambiarlo. No se prohíbe corregir
   —el porcentaje queda congelado en cada retención, así que el pasado se explica solo—
   pero el número está delante.
3. **La retención por factura defectuosa no puede ser menor que la normal.** Es la
   comprobación que nadie piensa en escribir: al revés significaría que al proveedor le
   sale mejor entregar la factura mal. Eso no lo dice ninguna ley; lo diría un dedo
   gordo al teclear los dos porcentajes. Verificado apagándola para ver fallar la prueba.

833 pruebas, todas pasan. `regimen_iva` sale de la lista de tablas sin puerta — quedan
tres, y la única que es una pantalla que manda algo imposible es **`plantilla_hito`**:
`/medidas` dice «ese tipo de contrato todavía no tiene plantilla de hitos» y no hay
forma de crear una. Es el trozo siguiente.

**Antes:** **el recorrido navegable, al día y con portada.** El CEO pidió
poder entrar a ver la aplicación, y el recorrido publicado era de ocho trozos atrás.

Publicado en https://claude.ai/artifact/613p36bPqXYLT31Tvdrck3 (versión 7), **138
pantallas** en vez de 61. Es **privado**: para mostrárselo a alguien hay que compartirlo
desde el menú de la propia página.

Qué faltaba, y lo dijo el propio exportador al contar sus enlaces apagados:

- **`/renglones/:id`, con 162 enlaces muertos.** La pantalla donde vive la tesis del
  producto —barra verde lo verificado con papel, rayada lo declarado sin él— era la
  menos visitable de todo el recorrido. También faltaban `/contratos/:id/valuar` (41),
  `/valuaciones/:id` (40) y `/valuaciones/:id/cobrar` (40).
- **Y todo lo de antes de entrar**, que no se había visto nunca: «Crea tu clave», la
  pantalla que enseña una sola vez el secreto del segundo factor y los diez códigos, y
  «Perdí el teléfono». El exportador ahora sabe pedir páginas por POST y sin sesión.

Quedan **4 enlaces apagados** y son a propósito: `GPS-2027-014` se deja sin hitos para
que el bloque «a qué renglones se les olvidó crear los hitos» tenga algo que señalar.

Tres cosas que salieron de prepararlo:

1. **De 162 renglones solo DOS se podían abrir.** El sembrador creaba los contratos sin
   hitos. Arreglado: ahora los crea desde la plantilla del tipo.
2. **Al sembrar hitos verificados, la base de datos me paró**: el disparador
   `hito_exige_su_evidencia` no deja verificar un hito sin su evidencia comprobada. Es
   la tesis hecha cerradura, y está bien que me parara — hay que sembrar el papel
   primero, como en la vida real.
3. **La muestra baja de 40 contratos a 15** (tres de cada uno de los cinco tipos, más
   el detallado). Cuarenta filas casi idénticas no enseñaban nada y costaban doscientas
   páginas más.

De paso, dos cosas del exportador: una hoja de cálculo vuelve en `bytes` y no en
`cuerpo`, así que las dos descargas salían como «SALTADA» con un 200 al lado; y los
161 enlaces a documentos de evidencia ya no quedan grises, van a una página que explica
que la evidencia de muestra no tiene archivo detrás.

825 pruebas, todas pasan.

**Lo siguiente** sigue siendo lo mismo, por orden: `regimen_iva` y `plantilla_hito`,
las dos pantallas que mandan hacer algo que no se puede hacer.

**Antes:** **cargar el INPC del mes. Sin él la reexpresión no podía
correr, y la reexpresión es todo ese módulo.**

La pantalla decía «No hay índice de precios (INPC) cargado a esa fecha. Sin índice no
se puede reexpresar nada» — y no había forma de cargarlo. `indice_precios` la escribía
**solo una prueba de la base de datos**. En una economía hiperinflacionaria eso no es
un adorno: un balance histórico dice que la empresa creció cuando lo único que creció
fue el índice.

Dos cosas que no son obvias y que hacen que sirva:

1. **La lista enseña la variación, no solo el número.** Un INPC escrito con un cero de
   más pasa desapercibido; un «+1.172 %» salta a la vista. Es lo que pilla un dedo
   gordo antes de que se reexprese un mes entero con él.
2. **Un índice no se toca por debajo de una reexpresión ya asentada**, y la regla mira
   la FECHA, no si la fila existía. Mi primera versión solo impedía *cambiar* uno ya
   usado y dejaba **cargar por primera vez** uno de un mes anterior — y eso rompe lo
   mismo: la reexpresión va partida por partida, cada una con el índice de su fecha,
   así que meter un índice de mayo después de reexpresar julio hace que el asiento de
   julio deje de salir de los datos que hay. El asiento no cambia, no se puede; deja
   de poder explicarse, que es peor. Lo encontró la prueba, que tenía mejor intuición
   que mi regla.

Y el barrido de tablas hizo lo suyo: al cablear la pantalla, **falló** hasta que
`indice_precios` salió de la lista de tablas sin puerta. Quedan cuatro:

| Tabla | Qué falta |
|---|---|
| `regimen_iva` | sin pantalla, y `/proveedores` **dice** que hay que registrarlo |
| `plantilla_hito` | sin pantalla, y `/medidas` **dice** «ese tipo de contrato todavía no tiene plantilla» |
| `alicuota_igtf` | hoy la pone el esquema |
| `capacidad`, `persona_capacidad` | permisos finos escritos y sin usar |

Las dos primeras son el trozo siguiente, por ese orden.

825 pruebas, todas pasan. Verificado apagando la valla para ver fallar la prueba.

**Antes:** **dar de alta un equipo. No había forma.** `/activos`
enseñaba los equipos, calculaba su valor en libros, el rendimiento de los alquilados
y corría la depreciación del mes… **sobre una tabla en la que nada, en ninguna parte,
insertaba una fila.** Un módulo entero mirando por una ventana a una tabla vacía para
siempre — y alquiler de equipos es uno de los cinco tipos de contrato de GPS.

Lo encontró un barrido nuevo: **tablas del esquema que la aplicación nunca escribe.**
Una tabla que nadie escribe es una función que no existe. Y las pruebas viejas no lo
veían porque insertan sus equipos a mano: el fixture hacía lo que la aplicación no
hacía, otra vez.

El formulario tiene trece casillas y devuelve **todos** los errores de una vez, no el
primero: de uno en uno son cuatro vueltas. Las tres cuentas vienen ya en la que casi
siempre toca, con la lista entera al lado. Un costo ilegible no entra como cero (se
pregunta `!(x > 0)`, porque `NaN <= 0` es falso). Y sin tasa del BCV del día en que
entra en servicio no se registra: el costo en la otra moneda saldría inventado.

**El barrido ya es permanente, y lo que aún no tiene puerta está DICHO, no callado.**
`pruebas/mantenimiento.test.ts` lleva un mapa con las tablas que la aplicación no
escribe y el motivo de cada una. Hoy quedan cinco, y la lista solo puede encoger:

| Tabla | Qué falta |
|---|---|
| `indice_precios` | sin pantalla para cargar el INPC del mes: **la reexpresión no puede correr** |
| `regimen_iva` | sin pantalla, y `/proveedores` **dice** que hay que registrarlo |
| `plantilla_hito` | sin pantalla, y `/medidas` **dice** «ese tipo de contrato todavía no tiene plantilla» |
| `alicuota_igtf` | hoy la pone el esquema |
| `capacidad`, `persona_capacidad` | permisos finos escritos y sin usar; hoy el alcance es interno/cliente |

Las tres primeras son pantallas que mandan hacer algo que no se puede hacer. Son el
trozo siguiente, por ese orden.

De paso, el barrido de claves del diccionario funcionó al revés y también está bien:
`activo.costo` dejó de estar sin usar, así que **falló** hasta que salió de
`i18n/sin_pantalla.txt`. La raya encoge sola o no encoge.

818 pruebas, todas pasan.

**Antes:** **el ingreso de una valuación facturada ya entra al libro.
No entraba.**

`asentar_valuacion()` existe en el esquema desde el principio, hace el asiento de la
venta —debe cuentas por cobrar y retenciones, haber ingresos e IVA débito fiscal— y
está probada. **La aplicación no la llamaba nunca.** La llamaban solo las pruebas,
que se lo montaban a mano en su fixture antes de mirar.

En uso real: se aprueba la valuación, se emite la factura, el cliente la recibe, el
libro de ventas la enseña —se construye desde `documento_fiscal`— y el diario no
tiene nada. Después el cobro **sí** se asienta, así que la cuenta por cobrar se iba a
negativo y el estado de resultados salía sin ingresos.

Por qué ninguna prueba lo vio, y esto es lo que hay que recordar: **el fixture hacía
lo que la aplicación no hacía.** Los libros cuadraban porque la prueba asentaba la
venta. Y al escribir la prueba nueva volvió a pasar en pequeño: «el libro cuadra»
seguía pasando con el asiento apagado, porque **un libro vacío cuadra**. Ahora
comprueba primero que haya partidas.

Se comprueba **antes** de emitir que el mes del periodo valuado esté abierto: un
`try/catch` no habría servido —dentro de una transacción postgres vuelve a lanzar al
cerrarla— y sobre todo la excepción llegaría después de gastar el número de factura y
el de control, que son correlativos sin huecos y no se devuelven.

**Y el barrido general ya es permanente:** toda función del esquema que no llame
nadie desde el código que se ejecuta hace fallar las pruebas. Una prueba NO cuenta
como llamada — ahí estaban escondidas las dos peores averías del proyecto. La lista
de excepciones (disparadores, y `previsualizar`) es corta y cada línea está
justificada. Verificado apagando la llamada para verlo fallar.

Queda anotada como **decisión 13** una pregunta contable que no es mía: con qué fecha
entra la venta al libro, la del periodo valuado o la de la factura.

803 pruebas, todas pasan.

**Antes:** **perder el teléfono y volver a entrar — que NO FUNCIONABA.**

La pantalla de «Perdí el teléfono» estaba escrita desde el primer día y mandaba el
formulario a `/entrar/recuperacion`. Esa ruta **solo respondía a GET**: el POST se
caía por la puerta de sesión y devolvía a la pantalla de entrada sin una palabra.
`gastar_codigo()` existía en la base de datos, probada, y no la llamaba nadie.

O sea: se generan diez códigos, se enseñan una sola vez, se pide guardarlos en papel
«para cuando pierdas el teléfono», y quien perdía el teléfono **se quedaba fuera para
siempre con los diez códigos en el bolsillo**. Novena máquina sin puerta y la peor:
las otras ocho estorbaban, ésta cerraba la puerta.

Lo que faltaba además del POST: el código de recuperación **no identifica a nadie**,
así que va contra el desafío que dejó la clave ya comprobada, igual que el código del
teléfono. El enlace de la pantalla anterior ahora lo arrastra. Y al entrar se dice
cuántos códigos quedan: quien acaba de gastar el noveno tiene que saberlo entonces,
no el día que gaste el décimo sin teléfono.

Once pruebas nuevas, verificadas apagando la ruta para verlas fallar. De paso salió
que una prueba de la pantalla de entrada llevaba la lista escrita a mano **y un `as`
encima**, que desactiva el molde: al añadir un campo obligatorio se cayó por dentro
en vez de decir qué faltaba. Ahora las dos salen de la misma lista y sin `as`.

795 pruebas, todas pasan.

**Antes:** **dos acciones que salían bien y contestaban sin decir
nada — y el barrido que las encontró, ya permanente.**

Deshacer una carga volvía a la misma pantalla con la misma caja vacía: la única señal
de que había pasado algo era que el lote cambiaba de estado en una lista de más
abajo. Instalar el plan de cuentas, igual: la pantalla volvía sin el aviso de antes y
había que **deducir de esa ausencia** que había funcionado — que es justo lo que este
sistema no deja hacer en ninguna otra parte. Y una acción que contesta sin decir nada
se vuelve a pulsar.

Los dos textos llevaban escritos en los dos idiomas sin que nada los pintara.

**El barrido del diccionario ya no es a mano: es `i18n/sin_pantalla.py` y corre en
cada pasada.** En un solo día encontró cuatro huecos —el botón de crear hitos, el
enlace al extracto del banco, y estos dos mensajes—, así que se queda.

Cómo está trazada la raya, porque importa: **no exige que no haya claves sin usar**
—174 de las 785 no las pinta nadie, y casi todas son vocabulario del sector declarado
a propósito para fases que no existen: calidad, logística, tesorería, contabilidad
general—. Exige que **no haya ninguna nueva**. La lista de las de hoy vive en
`i18n/sin_pantalla.txt`, solo puede encoger, y encogerla se ve en el diff. Se verificó
añadiendo una clave sin cablear para verlo fallar.

**Una pista que resultó no serlo:** `proveedor.comprobante` está sin usar, pero el
número del comprobante de retención **sí se enseña** en `/proveedores`, con otra
clave. Mirado y descartado.

784 pruebas, todas pasan.

**Antes:** **la conciliación bancaria decía «Todo cuadra en este
periodo» sobre un periodo del que no se había traído ningún extracto.** No cuadraba:
es que nadie había mirado. Es exactamente la confusión que este sistema entero existe
para no cometer —dar por hallazgo la ausencia de uno—, cometida en su propia pantalla
de contabilidad, y llevaba ahí desde que se escribió la pantalla.

Lo destapó el mismo barrido del diccionario: `banco.subir` («Traer el extracto» /
«Import the statement») estaba escrito en los dos idiomas y **ninguna pantalla lo
usaba**. Al ir a ponerlo salió lo de debajo: sin extracto las dos listas salen vacías
y la pantalla las leía como «cuadra».

Ahora la pantalla sabe cuántos movimientos del banco tiene en el periodo y cuántos
van conciliados. Sin ninguno, dice que no se ha traído nada, explica que eso no es
que cuadre, y **da el enlace al importador**: un aviso de que falta un paso, sin el
camino para darlo, es media pantalla. Con movimientos y todo casado, entonces sí dice
que cuadra — lo que se arregló es que diga cada cosa cuando toca, no que deje de
decir una de las dos.

781 pruebas, todas pasan. Verificado quitando el arreglo para ver fallar la prueba.

**Antes:** **crear los hitos que faltan.** `/medidas` tenía un bloque
entero —«¿a qué renglones se les olvidó crear los hitos?»— que **señalaba el problema
y no daba forma de arreglarlo**. `crear_hitos_desde_plantilla()` existía desde el
principio y la llamaba UN sitio: el alta de un contrato. Un renglón llegado por otro
camino —de una hoja de Excel, de un contrato anterior a la plantilla— se quedaba sin
hitos para siempre, con avance cero, indistinguible de uno que no ha empezado.
**Octava** vez que aparece la misma forma.

Lo destapó un barrido nuevo: **claves del diccionario que no usa ninguna pantalla**.
El texto del botón (`medida.crear_hitos`, «Crear sus hitos» / «Create its
milestones») llevaba escrito en los dos idiomas desde el primer día sin que nada lo
pintara. De las 178 claves sin usar, la mayoría es vocabulario declarado a propósito
—calidad, logística, tesorería, para fases que aún no existen—; ésta no lo era.

**Y otra vez una prueba de aislamiento falsa, la cuarta.** `crear_hitos_desde_plantilla()`
es `security definer`: **escribe saltándose las políticas de fila**, y el
identificador del renglón llega de un formulario. Escribí la comprobación de a quién
pertenece y una prueba de que funciona… que pasaba igual con la comprobación quitada,
porque preguntaba como alguien de esta GPS y la política de fila ya tapaba la fila
antes de llegar al dominio. Ahora son dos pruebas, una por cerradura: la segunda
pregunta como la persona de la otra GPS —que sí ve esa fila— y comprueba que la
comparación con la organización la para igual. Se verificó quitando la valla para
verla fallar.

776 pruebas, todas pasan.

**Antes:** **el mantenimiento que nadie llamaba.**
`caducar_sesiones()` y `limpiar_peticiones_sso()` estaban escritas, probadas y
comentadas con «se llama desde una tarea periódica». **No había ninguna tarea
periódica que las llamara.** Séptima vez que aparece la misma forma, y la más
silenciosa: no rompía nada, solo dejaba tablas creciendo para siempre.

Al ir a poner la puerta salió una tercera: `intento_acceso` guarda un correo por cada
intento de entrada y no la limpiaba nadie. El freno contra probar claves a ciegas
solo mira la última hora; lo demás, pasado un mes, es una lista de correos que crece
sola y que nadie abre. Ahora se tira a los 30 días.

Todo junto en `mantenimiento()`, llamada desde el bucle de `avisar.ts --repetir`
**una vez por hora**, no cada vuelta. Va ahí y no en un segundo servicio porque dos
cosas que instalar son dos cosas que se pueden olvidar de instalar — y este trozo
existe justamente porque se olvidaron dos.

Y, más importante que las funciones: **un barrido que lee el esquema y exige que toda
función de limpieza que exista esté llamada desde el código que se ejecuta.** La
primera versión daba por llamada a `caducar_sesiones` porque un comentario la
nombraba; ahora quita los comentarios antes de contar. Se comprobó quitando la
llamada a propósito para verlo fallar.

766 pruebas, todas pasan.

**Antes:** **se puede invitar a alguien.** Hasta hoy no se podía: la
pantalla de «Crea tu clave» existía desde el primer día y mandaba el formulario a
`/invitacion`, **una ruta que no estaba escrita**, y nada en ninguna parte creaba una
fila en `persona`. Dar de alta al ingeniero de una operadora era abrir una consola de
PostgreSQL. Un portal multiempresa en el que no se puede invitar a nadie: la sexta
vez que aparece el mismo patrón —la máquina montada y sin puerta— y la más grande.

Lo que hay ahora: `/personas` (solo GPS), `/invitacion` (pública, porque quien llega
todavía no tiene cuenta, que es justo el motivo de venir), y la pantalla que enseña
**una sola vez** el secreto del segundo factor y los diez códigos de recuperación.
El enlace de alta se guarda por su huella, caduca a los siete días, y se enseña en
pantalla en vez de mandarse por correo: una llave enviada a un buzón que nadie ha
comprobado es una cuenta regalada.

**Dos cosas que salieron de construirlo, y las dos importan más que la pantalla:**

1. **Mi propia prueba de «la baja cierra la sesión» era falsa.** Comprobaba que la
   cookie dejaba de valer, y eso sale igual con la sesión intacta, porque `quienEs`
   ya filtra por `persona.activa`. Estaba mirando la segunda cerradura y dando por
   buena la primera. Ahora mira la fila de `sesion`, y se comprobó desactivando el
   disparador a propósito para verla fallar. **Tercera vez** que escribo una prueba
   de seguridad que pasa sin comprobar nada.
2. **La baja se disparaba con un formulario vacío.** Era un botón solo, con el
   identificador de la persona ya puesto en un campo escondido. El barrido que manda
   todos los formularios en blanco lo encontró **dando de baja a la gente de otras
   pruebas** — y un navegador manda formularios en blanco igual que ese barrido. Ahora
   pide el motivo escrito, como anular una invitación, y el motivo queda guardado
   (`persona.baja_motivo`) para quien tenga que revisarlo.

Y una máquina que ya estaba debajo: `desactivar_persona` llamaba a
`cerrar_sesiones_de` **después** de la baja, cuando el disparador
`persona_baja_cierra_sesiones` ya las había cerrado. Devolvía cero siempre: decía
«no tenía ninguna sesión abierta» de alguien que estaba dentro.

758 pruebas, todas pasan, dos pasadas seguidas.

**Antes:** **deshacer una carga — y al construir el botón salió que
`revertir_lote` NO REVERSABA NADA.**

Buscaba los asientos por `origen_tipo = 'importacion_excel'` y `origen_id = <lote>`,
y esos asientos no existen: los crea el generador de la factura, que los marca con su
origen de verdad —la factura— porque es lo correcto para el libro. Así que deshacer
una carga marcaba el lote como «revertido» y **dejaba la contabilidad intacta**. Eso
es peor que no poder deshacer: la pantalla decía que la carga estaba deshecha y el
libro seguía cargado.

Llevaba ahí desde el principio, sin que nadie pudiera verlo, **porque el botón no
existía en ninguna parte** — el propio importador mandaba hacerlo («para rehacerlo,
reviértelo antes») y no había una sola pantalla desde donde hacerlo. La cuarta vez
que aparece la misma forma de fallo.

La causa de fondo era que **no había forma de saber qué documentos creó un lote**: se
adivinaba cruzando números contra las filas crudas. Ahora el documento lo dice
(`documento_fiscal.lote_id`), y de eso vive tanto el reverso como la comprobación del
mes cerrado.

Y **el plan de cuentas del día 1**: el importador decía «esta empresa todavía no tiene
plan de cuentas instalado» y **no había forma de instalarlo**. Ahora la pantalla de
meses lo ofrece, en ámbar y con su explicación: es una propuesta, nada del sistema
depende de esos códigos, y si GPS tiene el suyo se carga el suyo.

**Antes:** **el extracto del banco entra por Excel** — y con eso, **la
conciliación bancaria deja de ser una pantalla sin nada que conciliar.**

Llevaba días comparando `movimiento_banco` contra los cobros y los pagos, y **no
había una sola forma de meter un movimiento del banco**. La máquina entera, sin
puerta. Es el cuarto caso seguido del mismo patrón, y ya es un método: *antes de
construir una pantalla nueva, mirar si la máquina ya está debajo*.

Entra como tercer destino del importador que ya existía, así que hereda el mapeo de
columnas, la validación fila a fila y la detección de la hoja repetida.

**Y lo más importante es lo que NO hace: no escribe ni un asiento.** Una línea del
extracto no es un apunte contable — es un hecho del banco que hay que casar con un
cobro o un pago que ya está en el libro. Si al importar se asentara, **todo quedaría
contado dos veces** y el descuadre aparecería en el cierre, a tres semanas de su
causa. Hay una prueba que solo comprueba eso.

Dos decisiones más que se tomaron mirando el caso real:

- **Dos extractos que se solapan** —del 1 al 31 y del 15 al 15— traen quince días
  repetidos, y la huella del archivo no lo coge porque son hojas distintas. Se
  descarta por cuenta + fecha + importe + referencia, **al importar y no con una
  restricción en la tabla**: una restricción castigaría también a quien escriba
  «cheque 100» dos veces a mano, donde puede ser legítimo.
- **Revertir un lote no borra lo que alguien ya concilió.** Borrar un movimiento ya
  casado dejaría un cobro apuntando al vacío. Se quedan, y el lote lo dice.

**Antes:** **el exportador para el contador**, que estaba entre las
decisiones **ya tomadas desde el primer día** y no existía. Lo que había era la
pantalla del diario, y esa está escrita para *leerse*: importes con puntos y comas,
fechas en el idioma de quien mira. Abierto por una hoja de cálculo en inglés,
«1.234,56» se convierte en otra cosa.

`/diario/hoja` saca el mes entero línea a línea, **con el debe y el haber en columnas
distintas** —por dentro es un solo campo con signo, pero un sistema contable que
recibe «−1.000» en la columna del debe no lo entiende—, importes con punto decimal,
fechas en ISO, y los reversos marcados. Con su prueba de que **el mes exportado
cuadra**: si no cuadra, el contador lo carga y su sistema lo rechaza — o peor, lo
acepta y el descuadre aparece tres meses después.

Y lleva **una columna que ningún sistema contable trae: el contrato de cada línea.**
Es lo que permite devolver un resultado por contrato sin adivinar.

**Los barridos nuevos se estrenaron solos:** al añadir la ruta, los tres cantaron que
`/diario/hoja` no era una pantalla. Lo era de verdad —devuelve un CSV— y quedó
declarada junto a `/libros/hoja`. Es exactamente para lo que están.

**Antes:** **tres barridos que llevaban días mirando media
aplicación.** La misma lista de pantallas estaba **copiada a mano en tres sitios** —el
día 1, los formularios y el móvil— y las tres se habían quedado con diez u once
pantallas cuando la aplicación ya iba por **dieciocho**.

Es decir: el cuadro de mando, los estados, el diario, el mayor, la caja chica, lo que
toca pagar y el tablero de material **nunca se habían abierto en una empresa vacía,
ni se les había mandado un formulario en blanco o con basura dentro, ni se habían
dibujado en un teléfono de 360 px**. Los tres barridos decían que todo estaba bien.

Ahora la lista sale del código, de un solo sitio (`pruebas/pantallas.ts`), y cada uno
de los tres lleva **la afirmación que falla si deja de mirar**. Las pruebas subieron
de 693 a 726 sin añadir una pantalla: son las que faltaban.

*(Las siete pantallas aguantaron las tres pasadas a la primera. Eso no quita nada al
fallo: llevaban días sin comprobarse y nadie lo sabía.)*

**Antes:** **dónde está el material** — la primera pantalla de la fase
de logística, y la pregunta que hace un cliente de procura y que no contesta ningún
portal de seguimiento: «¿dónde está mi cabezal?».

**La máquina ya estaba entera desde el primer día** y nadie lo había mirado así: la
cadena de procura —orden, fabricado, embarcado, nacionalizado, recibido— vive en las
plantillas de hitos con el papel que exige cada paso. Lo que faltaba no era la
máquina: era la vista.

Y la vista lleva la tesis dentro, que es lo que la separa de un tablero cualquiera:

- **La posición la marca el último paso VERIFICADO**, no el último que alguien
  escribió. Si dicen que se embarcó y no hay conocimiento de embarque, aquí sigue en
  fábrica, y sale marcado **«dicho sin papel»**. Un tablero que se cree lo que le
  escriben es el tablero que ya tienen.
- **«Papel esperando revisión» se distingue de «falta el papel».** No es lo mismo, y
  confundirlos hace que se persiga al proveedor cuando el atasco está en casa.
- **Ordenado por días parado, el que más lleva primero.** Lo que lleva cuarenta días
  sin moverse es lo que está a punto de ser un problema.

De momento solo lo ve GPS, **y es una decisión escrita en la propia ruta, no un
descuido**: el cliente ya ve su obra hito a hito en su contrato, y abrir una pantalla
nueva a su lado amplía la superficie que ve alguien de fuera.

*(Al escribir la prueba choqué con la regla que sostiene todo: la base de datos no
deja marcar un paso como evidenciado sin su papel. El atajo no pasó, y la prueba
acabó creando la evidencia de verdad, que es como ocurre.)*

**Antes:** **el techo de `/medidas`, investigado y NO tocado — con dos
hallazgos que valen más que el arreglo.**

La idea era copiar la regla del contrato dentro de la política de fila de `hito`
para quitarse un nivel de subconsulta. Medido: **no sirve de nada.** Las tablas que
se nombran dentro de una política **llevan la suya puesta**: la subconsulta contra
`renglon` dispara la política de `renglon`, y esa la de `contrato`. No se quita un
nivel copiando la regla; se añade una copia que mantener. El techo se queda donde
está, y ahora se sabe por qué.

Y el segundo, que es el que importa: **escribí seis pruebas de aislamiento y tres
eran falsas.** Preguntaban por un hito uniendo con `renglon` y `contrato` — y esas
dos tablas esconden la fila **antes** de que la política del hito opine. Lo
comprobé abriendo la política a `true`: tres de las seis seguían en verde con la
puerta abierta de par en par. Reescritas: la pregunta del cliente va a `hito` a
secas, con los identificadores traídos desde dentro.

Es la segunda vez en un día que una comprobación de seguridad mía no comprobaba
nada. La regla, ya escrita abajo: **una prueba de aislamiento se valida rompiendo la
valla a propósito, no leyéndola.**

**Antes:** **ahora sí se instala en un teléfono.** El producto se
describe desde el primer día como «aplicación web instalable» y **no lo era**: no
había manifiesto ni icono. Quien abría la dirección en el móvil tenía una página
web, no un icono en su pantalla de inicio — y un ingeniero en una locación no vuelve
a escribir una dirección larga cada mañana.

Y se consigue **sin una línea de JavaScript**, que es lo que permite seguir con
`default-src 'none'`. Lo único que **no** se puede hacer sin JavaScript es funcionar
sin conexión: eso pide un *service worker*, que es un archivo de código y cambia la
política de seguridad. **Es una decisión del CEO, no un olvido**, y está aquí escrita.

El icono no es un archivo binario metido en el repositorio: es **código que produce
los píxeles** (`src/servidor/icono.ts`), con su PNG escrito a mano —firma, IHDR,
IDAT comprimido y su CRC— porque un PNG en git es un objeto que nadie puede revisar.
Y el dibujo **es la tesis del producto**: la misma barra de cada contrato, el tramo
sólido es lo verificado y el rayado lo que alguien declaró y no se puede demostrar.

**Y de aquí salió el fallo más serio del día, que era mío y estaba en una prueba de
seguridad.** El barrido de aislamiento saca la lista de rutas del código fuente con
un patrón… que solo aceptaba letras y barras. **`/manifest.webmanifest` y
`/icono.svg` eran invisibles para él.** Añadí tres rutas públicas y el barrido dijo
que todo estaba bien. Una comprobación de seguridad con un punto ciego es peor que
no tenerla: da tranquilidad sin darla. Arreglado el patrón, y comprobado quitando
una ruta de la lista de permitidas a propósito para verlo fallar.

Lo público va ahora en su propia lista, aparte de la superficie con datos: son un
dibujo y un archivo de texto iguales para todos, y hay una prueba que **los pide con
cookie y sin cookie y compara byte a byte** — si alguno cambiara según quién
pregunte, dejaría de ser inocente.

**Antes:** **se acabaron las páginas en blanco.** Eran **diez rutas**
que contestaban con el cuerpo vacío cuando la acción no se podía hacer, y **dos las
ve el cliente**: aprobar y objetar una valuación. El caso real no es raro — el
cliente tiene la hoja abierta desde ayer, GPS la mueve, él pulsa «Aprobar» y se
queda mirando una página blanca, sin una palabra y sin nadie a quien preguntar.

Ahora cada una vuelve a la página de donde se pulsó con el motivo puesto, y la
página lo pinta. Lo que llega por la dirección **no se pinta tal cual**: solo elige
una clave de una lista cerrada, porque si no bastaría con mandarle un enlace a
alguien para escribirle lo que uno quiera en su pantalla. Hay prueba de eso también.

Las diez: poner un contrato en vigor, presentar, facturar, la nota de crédito,
aprobar, objetar, responder una objeción, verificar y rechazar evidencia, y las
cuatro formas de que una subida se rechace (sin archivo, tipo no aceptado, clase
inventada, archivo vacío). Todas tenían su motivo escrito y ninguna lo enseñaba.

Y de paso salió una deriva de las de verdad: **`.mal-caja` —la caja donde se dice lo
que salió mal— estaba copiada en ocho pantallas y ya se había desviado en cuatro
versiones distintas.** Una con el color en la lista, otra en la caja. Ahora está una
vez, en `base.ts`, con el anillo del foco. *(Y al escribirlo volví a tropezar con el
acento grave dentro de una plantilla: quinta vez.)*

**Antes:** **los ochenta textos de error, repasados en conjunto.** Se
escriben de uno en uno, el día que hacen falta, y nunca se vuelven a mirar juntos.
Mirándolos juntos salieron cuatro cosas, y de una salió un fallo de verdad:

- **Poner un contrato en vigor sin hitos contestaba `409` con el cuerpo vacío**: una
  **página en blanco**. El motivo estaba escrito en el diccionario desde el primer
  día —«hay renglones sin hitos, y su avance se quedaría en cero para siempre»— y no
  llegaba a ninguna parte. Es la tercera vez esta semana que aparece la misma forma
  de fallo: **existe la regla, existe el texto, y no existe el camino.**
- **`alta.error.campo` decía «Falta algo obligatorio»** para cuatro causas distintas:
  la cabecera, el tipo, un renglón y un porcentaje. Son cuatro mensajes ahora, y el
  que no decía nada ya no existe.
- **`accion.error.estado` no lo usaba nadie** y `caja.error.generico` era un «no se
  pudo, inténtalo de nuevo». Fuera los dos.
- **`banco.error.tomado` estaba mal traducido**: en castellano decía «ese cobro o
  pago» y en inglés solo «that payment».

Y queda un barrido, `pruebas/errores.test.ts`, con las cinco reglas que salieron del
repaso: **todo texto de error se usa en alguna parte** (la que encontró la página en
blanco), los huecos `{n}` están en los dos idiomas, nada de jerga —`uuid`, `NaN`,
«base de datos»—, nada tan corto que no diga nada, y ninguno con «inválido», que es
la forma de no ayudar que se cuela al traducir. Comprobado que sabe fallar metiendo
un error malo a propósito: caen tres de las cinco.

**Antes:** **el techo de `brecha_evidencia`, derribado midiendo.**
Llamaba a `avance_declarado` y `avance_renglon` **una vez por renglón**: con 500
contratos eran 4.000 llamadas a función, cada una con su propia consulta. Ahora hace
la misma cuenta —el mismo redondeo por renglón antes de dividir entre cien— en una
sola pasada sobre los hitos.

**De 1.719 ms a 189 ms.** Y hay que decir cómo se llegó a esos números, porque la
medición anterior estaba mal: decía 536 ms, pero **`brecha_evidencia` devolvía cero
filas** porque el sembrado no creaba hitos. Medir el recorrido sin el trabajo no es
medir. Ahora existe `app/herramientas/medir.ts`, que siembra su propia organización
con **500 contratos, 2.000 renglones y 10.000 hitos** y cronometra las cuatro
consultas de las medidas. La herramienta se queda: la medición anterior se escribió
suelta y se perdió.

Las dos funciones por renglón **se quedan donde están**: las usa la ficha de un
contrato, donde se pregunta por UN renglón y llamarlas es lo correcto. Y hay una
prueba nueva que **cruza los dos caminos** —la función de la pantalla contra la
cuenta hecha con las de siempre— y falla si alguien mejora una y olvida la otra.
Comprobado rompiendo la función a propósito: fallan tres pruebas, no cero.

**El siguiente techo, ya localizado y medido:** de esos 189 ms, la mayor parte no
está en la consulta sino en **la política de fila de `hito`**, que por cada hito
comprueba si su renglón se ve, y eso mira el contrato — tres niveles de subconsulta
por fila, diez mil veces. Se puede bajar. **No se toca de paso:** una valla de
aislamiento no se reescribe para ganar milisegundos sin su barrido delante.

**Antes:** **reversar un asiento desde el diario.** Todo el sistema
dice «un asiento no se modifica ni se borra: registra su reverso» — y **no había ni
un solo sitio donde registrarlo**. La instrucción era correcta y el camino no
existía, que es la peor combinación posible: quien la seguía al pie de la letra se
quedaba encallado. Es el mismo fallo que el de «para rehacerlo, reversa su asiento»
de ayer, y por eso queda escrito como regla: **cuando una pantalla manda hacer algo,
hay que ir a comprobar que ese algo se puede hacer desde alguna parte.**

El motivo es obligatorio y va dentro de la descripción del reverso: uno sin motivo,
leído dentro de dos años, no se distingue de un error. Y el reverso se escribe **en
el mes del original**, no en el de hoy —el hecho ocurrió cuando ocurrió—, con la
consecuencia dicha antes de pulsar: si ese mes está cerrado, hay que abrirlo.

**Antes:** **pagar una factura de proveedor**, que era el agujero más
grande que quedaba: estaban la tabla `pago` y el generador `asentar_pago`, y **no
había forma de llegar a ellos desde ninguna pantalla**. Entraban facturas y no salía
nunca un pago, así que el saldo de proveedores crecía para siempre y no era el de
nadie. Ahora `/pagar` enseña lo que se debe, lo que lleva esperando cada factura, y
se paga desde la misma lista — buscar la factura otra vez en otra pantalla es como
se acaba pagando la que no era. Debajo de cada deuda van **los pagos ya hechos**:
un pago que no se ve es un pago que se hace dos veces.

Tres cosas que decide el sistema y no quien teclea:

- **El IGTF.** Pagar en divisa cuesta un 3% más y es un gasto con cuenta propia.
  Dejarlo a criterio de quien teclea garantiza que la mitad de los pagos lo lleven.
- **No se paga de más.** El saldo sale de restar —factura, menos retenciones, menos
  lo ya pagado—, nunca de una columna guardada.
- **Un pago en dólares se mide contra el saldo pasando por la tasa**, no a ojo. Sin
  la conversión, un importe pequeño en dólares parece caber siempre.

Y salió algo que hay que decir tal cual: **la prueba de aislamiento que escribí
primero era falsa**. Daba por hecho que al cliente le saltaría un «permission
denied», y no salta: `por_pagar` es una función normal y el cliente puede llamarla.
Lo que le devuelve es **cero filas**, porque la política de fila solo le enseña sus
documentos. La prueba dice ahora lo que pasa de verdad, y comprueba las tres vallas
por separado: cero filas, la tabla `pago` denegada, y la línea `if (esCliente)` en
la ruta.

Y **`colisiones.py` dejaba pasar un choque real**: el RIF de una empresa venezolana
lleva ocho cifras y el patrón exigía nueve, así que dos archivos compartían
`J-30777777-7` y el fallo salía como una clave duplicada **en medio de una prueba de
otra cosa** — justo lo que ese comprobador existe para evitar. Arreglado, y contando
solo los RIF que se insertan de verdad.

**Antes:** **la caja chica**, que llevaba semanas parada esperando
ocho respuestas del CEO. Eso fue un error mío: había que construirla con **supuestos
declarados** en vez de esperar. Así está hecha. Son seis, están escritos en el
módulo, en la pantalla (bloque «Seis supuestos, no seis decisiones») y cada uno tiene
su prueba — un supuesto sin prueba es una intención:

1. **Fondo fijo.** El gasto **no entra al libro cuando ocurre**, sino cuando se
   repone. Es lo que permite auditar la caja contando el efectivo una vez, sin mirar
   el libro. Lo comprueba la prueba «anotar un vale NO toca el libro».
2. **Sin papel no se repone.** Un vale sin soporte baja el efectivo —el dinero salió
   igual— pero no entra en la reposición. Es la tesis del sistema aplicada al
   efectivo: sin evidencia no hay avance; aquí, sin evidencia no se devuelve el
   dinero. Y **se ve en pantalla**, en ámbar, al lado del efectivo.
3. **Sin IVA:** el vale va íntegro a gasto y no genera crédito fiscal.
4. **La reposición sale del banco.**
5. **Una caja, una moneda**, elegida al abrirla.
6. **Un vale grande no es caja chica:** por encima del 10% del fondo se avisa, pero
   no se bloquea. Quien está en el pozo no puede pararse porque el sistema opine.

Al cerrar la caja, lo gastado sin papel **no desaparece**: va a su propia cuenta,
`5.2.12 Faltantes de caja`, nueva en el plan. Una caja que cuadra sola escondiendo lo
injustificado no sirve para nada.

La cifra por la que existe el módulo es **lo que se ha ido por contrato**: el margen
no se pierde en la factura grande, se pierde en cien gastos pequeños que nadie
imputó. Por eso el vale se imputa a su contrato y el asiento de la reposición lleva
el `contrato_id` pegado.

**Trampa que volvió a salir aquí:** un `try/catch` alrededor de una consulta **no
sirve dentro de una transacción**. La excepción la aborta entera y la biblioteca la
vuelve a lanzar al cerrarla, así que el `catch` devolvía un mensaje bonito y la
prueba fallaba igual con el error crudo de PostgreSQL. Se comprueba **antes** de
llamar, una condición por línea, como ya hacía `depreciarMes`. Está escrito en el
propio módulo para que no se vuelva a intentar.

**Antes:** **los equipos, en pantalla.** Cada activo con lo que
queda en libros y, si está alquilado, **lo que deja**: lo facturado del contrato menos
el desgaste del periodo, en verde si es positivo y en rojo si no. Es la única cifra que
contesta «¿alquilar esto sale a cuenta?», y no estaba en ningún sitio. Depreciar el mes
se hace desde ahí, comprobando antes las tres cosas que lo impedirían, para que el
error salga explicado y no después de pulsar.

Y salieron **dos fallos reales de la contabilidad** al usarla, los dos arreglados:

- «El mes ya está depreciado. Para rehacerlo, **reversa su asiento**» era mentira: el
  guardia no miraba si el asiento tenía reverso, así que quien seguía la instrucción al
  pie de la letra chocaba con el mismo error y sin salida. El mismo fallo estaba en la
  reexpresión por inflación. Los dos corregidos.
- Al rehacer el mes quedaban las filas de `depreciacion` del intento reversado, y la
  cuota se calculaba sobre una acumulada que no ocurrió. El asiento se queda en el
  libro para siempre — eso es la contabilidad — pero esa tabla no es el libro.

Con esto, de los tres módulos «construidos y sin pantalla» queda **uno y medio**.

Y **los avisos ya salen solos**: `avisar.ts --repetir=<segundos>` se queda dando
vueltas, con su unidad de systemd hecha en `operar/`. Era el punto 2 de esta lista y
no era un detalle de instalación: la cola se llenaba y nadie la vaciaba. El bucle va
aparte y probado con un reloj de mentira — uno que se prueba esperando de verdad es
uno que nadie vuelve a probar. Commits `632b9b0` y `ac7cb5a`.
Y **la reexpresión por inflación, en pantalla**: el resultado monetario del ejercicio
arriba y grande, y el ajuste cuenta por cuenta.

Y **el histórico de ventas entra por Excel** — el segundo destino del importador.

Y **el día 1**, que no estaba probado: una empresa recién creada, con la base vacía.
Las diez pantallas responden sin datos y ninguna enseña «undefined». Salió de ahí una
deriva real: la valuación tenía el contenedor a 780 mientras el resto iba a 760.

Y **los libros de ventas y compras**, que existían como vistas desde el principio y
no los enseñaba nada — siendo **lo único que sale de la empresa con destino al
SENIAT**. Con su hoja de cálculo para bajarlos, y con el escritor de CSV probado de
ida y vuelta. *(Corrección: ayer dije que no quedaba nada sin pantalla. Quedaba
esto.)*

Y **el mes entero por HTTP**: abrir → importar → libro → bajarlo → cerrar → y
comprobar que cerrado ya no entra nada. Encajar los tramos sacó **dos fallos reales**
(abajo).

Y **el barrido de formularios**: cada pantalla, cada formulario, mandado en blanco
como lo mandaría el navegador. Las once aguantan, las que rechazan lo dicen por
escrito, y el libro sigue cuadrado después.

Y **el mismo barrido con basura dentro**: texto donde va un número, el 31 de febrero,
importes negativos, y media hoja de cálculo pegada en una casilla. Encontró un fallo
de los que acaban en página de error: **`Number('hola')` no falla, devuelve `NaN`**, y
`NaN` llega hasta PostgreSQL, que contesta `invalid input syntax for type integer`.
Escribir mal un año en la pantalla de meses daba un error de servidor. Ahora hay un
`entero()` que exige la forma entera y un `anioMes()` que comprueba el rango.

Y **el repaso de los NaN que quedaban** (cabecera, correo, arranque), que destapó al
hermano peor: **`Number('')` no es NaN, es CERO**. En `Accept-Language` un `q=0`
significa «no quiero este idioma», así que un `q=` mal escrito se leía como un
rechazo explícito y mandaba al visitante al idioma equivocado.

Y **las pantallas dibujadas de verdad** en un Chromium a 360 × 740. Encontró a la
primera que **la cartera medía 1077 px sobre una pantalla de 360** — lo primero que
se ve al entrar, tres pantallas y media de ancho. Los diez enlaces de la cabecera se
fueron añadiendo de uno en uno y la fila nunca se partía; tres de ellos los puse yo
ese mismo día sin verlo. **Leyendo el HTML no hay anchura: la anchura la decide el
navegador.**

Y **el contraste, medido por primera vez**: tres colores que no se leían. El gris de
todas las etiquetas pequeñas daba 2,78 sobre 4,5 exigido; el botón verde de abrir el
mes llevaba texto blanco, que en tema oscuro da 1,69; y el enlace de bajar el libro
usaba un azul marino que no cambia con el tema, invisible sobre fondo oscuro — ese lo
escribí yo esa misma mañana. **Los tres son el mismo error: un color fijo que se lee
en un tema y desaparece en el otro.**

Y **el recorrido con el teclado**, que cierra este frente: casi toda la aplicación se
fiaba del anillo que pone el navegador solo —1 px casi negro, invisible sobre la
cabecera azul marino—, y **los tres campos de fecha no enseñaban ningún foco al
tabular**. Un campo de fecha se recorre **por dentro** (día, mes, año), y mientras el
foco está en una de sus partes el campo en sí no cuenta como enfocado: su anillo no
llega a pintarse. El que se ve es el de la **etiqueta** que lo envuelve.

Y **«Cómo va el mes»**, el cuadro de mando del CFO. **Corrección, y es la segunda
vez: dos módulos ENTEROS no los usaba ninguna pantalla** — `12-gerencia.sql` y
`08-estados.sql`: margen, rentabilidad por cliente y por servicio, ejecutado sin
cobrar, flujo de caja, estado de resultados, balance general. Dije dos veces que no
quedaba nada sin pantalla y las dos veces era falso. **Antes de volver a decirlo:
`grep -rn "create or replace function" db/schema/ | wc -l` contra lo que usa
`app/src/`.**

Commits `632b9b0`, `ac7cb5a`, `913314b`, `d95d68c`, `193ef5e`, `9420d12`, `17a0e0b`,
`16f9c03`, `c0aa778`, `dd3822b`, `a768a76`, `33196cc`, `587f3d0`, `20b40bc` y
`4db6418`. **843 comprobaciones** (250 de SQL y diccionario + 593 de TypeScript),
todas pasando.

Y **los estados contables** (`5b5580f`) y **el resultado abierto y la cartera contrato
por contrato** (`06e7ec9`). Con esto, **el barrido ya no devuelve ningún informe de
cara al usuario sin pantalla** — esta vez comprobado, no afirmado:

```bash
cd nexus && for f in $(grep -rhoE "create or replace function [a-z_]+" db/schema/*.sql \
  | awk '{print $NF}' | sort -u); do grep -rqE "\b${f}\s*\(" app/src/ || echo "$f"; done
```

**Ojo con ese comando: la primera versión que escribí aquí usaba `grep -F` y buscaba
el nombre suelto**, así que un nombre corto como `mayor` o `diario` casaba con
cualquier comentario en castellano y la función salía por usada sin estarlo. Así se
me escapó el mayor. Tiene que buscar el nombre **seguido de un paréntesis**.

Lo que salga ahí son disparadores, generadores y ayudantes que se llaman desde SQL:
ahí es donde tienen que estar.

Y **el libro diario** (`942c129`), que era el agujero de verdad: todas las pantallas
enseñaban algo **derivado** y no había ninguna donde terminara de abrirse un número.
Debajo de un asiento no hay nada más. Sale entero —cabecera y líneas juntas, sin
pinchar—, con el debe y el haber en columnas separadas aunque por dentro sean un solo
campo con signo, con **cuándo ocurrió y cuándo se supo**, y con el asiento anulado y
su reverso **los dos** a la vista.

Y **el mayor de una cuenta** (`d5427d4`): el diario recorre el tiempo, el mayor
recorre una cuenta. Es lo que contesta «¿por qué el banco tiene exactamente este
saldo?», que es la pregunta que se hace cuando algo no cuadra.

Y **el barrido de aislamiento por rutas** (`4f701cf`): todas las rutas recorridas como
cliente de otra operadora. **La lista sale del código fuente, no de una copia a mano**,
así que una pantalla nueva entra sola en el barrido. Las cinco de hoy tenían la valla;
lo comprobé quitando una a propósito y viendo fallar la prueba antes de creérmelo.

Y **la primera medición con datos de verdad** (`d74072e`): 500 contratos y 2.000
renglones sembrados, todas las pantallas recorridas. `/medidas` pesaba **613 KB** y
ahora pesa 22. Las otras once, por debajo de 15 ms y 10 KB.

Y **«lo que se ve al abrir»** (`d966fb0`), que salió de sacarle capturas a la
aplicación para el CEO: en el teléfono la cabecera de la cartera ocupaba el 39% de la
pantalla, y la cartera decía «Aprobada hace **−184 días**» con una fecha en el futuro.

**991 comprobaciones** (250 de SQL y diccionario + 741 de TypeScript), todas pasando.

**Regla que costó tres intentos y hay que respetar:** un umbral en una prueba **sale
de medir, no de una opinión**. El primero (50% del alto de cabecera) daba por bueno
el estado roto; el segundo (25%) daba por malas pantallas sanas, porque medía título
y explicación como si fueran menú. El tercero mide **dónde empieza lo suyo de cada
pantalla**: sanas entre 16% y 35%, rota al 48%, umbral 40%. **Y siempre comprobar que
la prueba sabe fallar rompiendo el arreglo a propósito.**

**Techo medido y NO arreglado, para que no se descubra tarde:** `/medidas` sigue
tardando **963 ms** con 500 contratos, y el coste está en las consultas, no en
pintar. `brecha_evidencia` se lleva **536 ms** ella sola porque llama a
`avance_declarado` y `avance_renglon` **una vez por renglón** — 2.000 veces — y
encima devolvió cero filas: paga el barrido entero para no encontrar nada. Se arregla
reescribiéndola sin llamadas por fila. Con las decenas de contratos que GPS tiene hoy
no es un problema; con cientos, sí.
Avisado al CEO el **90%**: https://claude.ai/artifact/KtMi19FhnUhEDL5oB4V98a

**Decisión pendiente del CEO:** las tablas de rentabilidad son **acumuladas**, no del
mes — `margen_contrato` ignora su `p_desde`. Está marcado en la pantalla, pero si se
quiere el margen DEL MES hay que cambiar esa función, y tiene pruebas que dependen de
su significado actual.

**Trampa nueva:** dentro de una plantilla de TypeScript, **`\d` se queda en `d`**.
Hay que escribir `\\d` para que al navegador le llegue `\d`. La medición del
contraste se quedó con `[d.]+`, no casaba con nada, todos los colores salían negros y
la prueba «encontró» cien fallos que no existían. **Una prueba que falla de mentira
cuesta lo mismo que una que pasa en vano.**

**Regla que sostiene los importes y se pierde en el primer refactor:** la
comprobación de un importe es **`!(x > 0)`**, nunca `x <= 0`. Las dos dicen lo mismo
en castellano y hacen lo contrario con un NaN: la segunda lo deja pasar. Está escrita
en `pruebas/nan.test.ts` para que se note si alguien la «simplifica».

**Los dos fallos, porque la lección vale más que el arreglo:**

1. **Un `<select>` deshabilitado no lo manda el navegador.** El mapeo del importador
   iba en tres listas paralelas que el servidor emparejaba **por posición**, y el
   select del formato va deshabilitado en las columnas de texto. A partir de la
   primera columna de texto, cada formato caía en la columna de al lado. Ahora cada
   casilla lleva su columna en el nombre: `campo_3`, `formato_3`.
2. **`coalesce` no atrapa la cadena vacía**, solo el null. Un formato vacío llegaba a
   `to_date` como patrón vacío y salía `0001-01-01 BC` **sin error**, metiendo una
   fecha imposible en un documento fiscal en silencio.

**Y por qué no se vieron antes:** la prueba del importador **escribía el formulario a
mano**, perfectamente alineado. Una prueba que fabrica la entrada en vez de devolver
la que salió comprueba que el servidor entiende lo que la prueba imagina, no lo que
la pantalla manda. `pruebas/formulario.ts` existe para eso: modela las reglas del
navegador —`disabled` no se manda, un `<select>` sin marcar manda **la primera**
opción y no una cadena vacía, una casilla sin marcar no se manda—. **Usarlo siempre
que se devuelva un formulario.**

**Tercera trampa, de la propia prueba y casi se cuela:** el barrido usaba UNA sesión,
y el primer formulario de la cartera es el de **salir**. Se quedó sin sesión en la
pantalla uno y las diez siguientes pasaron **en vano**, contestando 303 a todo. Ahora
cada pantalla abre su sesión y al final se comprueba que sigue viva. **Una prueba de
barrido necesita siempre una afirmación que falle si el barrido no comprobó nada** —
si no, pasa sola y nadie vuelve a mirarla.

**Trampa cara, apuntada aquí porque se va a volver a leer mal:** el signo del
resultado monetario (REME) se lee **al revés** de lo que parece. **Positivo es
pérdida** — es lo que costó tener bolívares mientras se devaluaban. La primera
versión de la pantalla lo pintaba en verde por ser positivo, diciendo exactamente lo
contrario de lo que había pasado.

Avisado al CEO el **70%**: https://claude.ai/artifact/KtMi19FhnUhEDL5oB4V98a
La pantalla del avance: https://claude.ai/artifact/NCjF1TxP2faaEAz5vHJ43K

**Lo siguiente, en este orden exacto:**

1. **Caja chica y lo que falta de contabilidad**, que depende de las ocho respuestas
   del CEO (https://claude.ai/artifact/LyvqcKwc6vevhbTHTFhyvs — **sin contestar**).
2. **Los dos destinos que el importador todavía no materializa** (`valuaciones` y
   `cobros`): `validar_lote` ya los conoce, pero `confirmar_lote` no crea nada con
   ellos. Están a la vista en el reparto de `26-importar-ventas.sql`.

**Trampa que se acaba de pagar dos veces, y que se va a volver a pagar:** dentro de una
función `plpgsql`, un alias de tabla que se llame igual que una variable declarada
(`a`, `r`) lo resuelve PostgreSQL como la variable, y el error que da es
`record "a" is not assigned yet` — que no señala a nada. Los alias dentro de funciones
van con nombre largo: `asi`, `rev`.

**Y otra:** la base de datos **no se vacía entre ejecuciones de un mismo archivo de
pruebas**. Un fixture que crea asientos tiene que dejar limpio lo suyo al empezar, y
como un asiento no se borra, la única forma correcta es **reversarlo** — que es lo que
haría una persona. Si se intenta borrar, salta `Un asiento no se modifica ni se borra`.

**Cómo continuar, literalmente:**

```bash
cd /home/user/docs/nexus/db && ./probar.sh    # tiene que decir TODAS LAS PRUEBAS PASAN
cd /home/user/docs/nexus/app && npx tsc --noEmit
```

`probar.sh` levanta un PostgreSQL desechable, carga el esquema, corre las pruebas de
base de datos, el diccionario bilingüe, el buscador de colisiones y las de la
aplicación. Si algo falla ahí, eso es lo primero, antes que cualquier cosa nueva.

Para mirar una pantalla sin desplegar nada:

```bash
NEXUS_PERSONA=<uuid> node --experimental-strip-types \
  herramientas/pintar-avance.ts <renglon> es salida.html [cliente]
```

**Nunca se añade código sin su prueba en la misma sesión.** Ese es el motivo de que
702 comprobaciones hayan encontrado veintinueve fallos reales, veintiséis de ellos míos.

### Trampas con las que ya se tropezó — no repetirlas

- **Una variable de plpgsql con el nombre de una columna hace ambiguo el `update`.**
  `nota := ...; update ... set nota = nota` no compila y el error —«column reference
  nota is ambiguous»— no dice dónde está. Nombres distintos: `texto`.
- **En un fixture, lo que apunta a otra cosa se borra ANTES que aquello a lo que
  apunta.** Ya mordió dos veces seguidas en el mismo archivo: los movimientos del
  banco y las facturas apuntan a su lote, así que el lote se borra el último.

- **Una lista de pantallas escrita a mano se queda vieja en dos días.** Estaba
  copiada en tres barridos y los tres miraban media aplicación. Sale de `rutas.ts`,
  desde `pruebas/pantallas.ts`, y cada barrido lleva su afirmación de cobertura.

- **Una prueba de aislamiento que UNE con la tabla protegida no prueba nada.** Las
  tablas que se nombran en una consulta —o dentro de una política— llevan su propia
  política puesta, y esconden la fila antes de que la de la tabla que se quería
  comprobar llegue a opinar. Se pregunta por la tabla a secas, con los
  identificadores traídos desde dentro. Y se valida **abriendo la valla a propósito**.

- **Un barrido de seguridad puede tener un punto ciego, y entonces miente.** El de
  aislamiento buscaba rutas con `[a-z/]`: cualquier ruta con un punto o un guion era
  invisible. Al añadir o tocar un barrido, comprobar **qué NO está mirando**.

- **Una medición sobre cero filas mide el recorrido, no el trabajo.** `brecha_evidencia`
  «tardaba 536 ms» con 500 contratos… y devolvía cero filas, porque el sembrado no
  creaba hitos. Con hitos de verdad eran 1.719 ms. Antes de creerse una medida, mirar
  cuántas filas salieron.
- **Dos medidas tomadas en bases distintas no se comparan.** La misma consulta da
  1.719 ms en una base recién cargada y 4.349 en una con muchas corridas encima. El
  antes y el después se miden en la misma base, y se dice en cuál.

- **Una pantalla que manda hacer algo tiene que poder hacerlo.** «Registra su
  reverso» y «para rehacerlo, reversa su asiento» eran las dos ciertas y las dos sin
  camino. Al escribir una instrucción en pantalla, ir y comprobar que existe el sitio
  donde se cumple.

- **Un `try/catch` alrededor de una consulta no sirve dentro de una transacción.** La
  excepción de PostgreSQL la aborta entera, y `postgres.js` la vuelve a lanzar al
  cerrarla: el `catch` devuelve su mensaje amable y el error crudo sale igual. Las
  condiciones se comprueban **antes** de llamar, una por línea, con su texto del
  diccionario.
- **Una prueba que suma sobre toda la organización se rompe sola el segundo día.** Un
  asiento no se borra nunca, así que la suma crece en cada corrida. Se suma sobre
  **el asiento que acaba de crear la prueba**, cuyo id devuelve la propia función.

- **Las pruebas se lanzan con `db/probar.sh`**, nunca con `node --test` a secas: sin
  eso la base de datos no está cargada y los fallos no significan nada.
- **Dentro de una función `plpgsql`, un alias de tabla que coincida con una variable
  declarada** (`a`, `r`) lo resuelve PostgreSQL como la variable, y el error es
  `record "a" is not assigned yet`, que no señala a nada. Alias largos: `asi`, `rev`.
- **La base de datos no se vacía entre ejecuciones de un mismo archivo de pruebas.** Un
  fixture que crea asientos limpia lo suyo al empezar, y como un asiento no se borra, la
  única forma correcta es **reversarlo** — lo mismo que haría una persona.
- **Las cuentas del plan tienen cuatro niveles.** `1.2.01` no es imputable; lo que se
  usa es `1.2.01.04`, y la depreciación acumulada es `1.2.02`, no `1.2.09`. Inventarse
  un código da un error de clave foránea que aparece como *todas* las pruebas del
  archivo fallando a la vez, porque revienta el `before()`.
- **Cada archivo de prueba de la aplicación necesita su propio prefijo de UUID y su
  propia fecha de tasa del BCV.** Las de TypeScript corren todas seguidas contra una
  sola base; dos archivos que compartan identificadores se pisan en silencio, porque
  el `on conflict do nothing` hace que el segundo se quede con las filas del primero.
  `db/colisiones.py` lo busca ahora antes de correr nada: prefijos de UUID, fechas de
  tasa del BCV (escritas o `current_date`), **correos y RIF**. Fechas ya usadas: 09-01
  a 09-16 y 04-01 a 04-06.
- **`avance_renglon()` es `stable`**: llamada en la MISMA instrucción que
  `recalcular_hito()` lee la foto de antes del cambio y devuelve el avance viejo. Van
  en instrucciones separadas.
- **Al cliente se le conceden columnas, no tablas.** Un `select e.*` funciona desde
  dentro y falla desde fuera. Las columnas se nombran una a una para que la misma
  consulta sirva a los dos.
- **Las fechas llegan como fechas, no como texto.** Se les da formato en el dominio,
  en el idioma de quien mira.

---

## AVISAR AL CEO: 30%

Tercer décimo. El circuito del cliente está **cerrado de punta a punta**: entra, ve
sus contratos, abre el que le espera, revisa la valuación línea por línea, aprueba u
objeta — y del otro lado GPS lo ve en su bandeja y responde ahí mismo.

**309 comprobaciones**, todas pasando. Nada se ha añadido sin su prueba.

---

## AVISAR AL CEO: 20%

Segundo décimo. Al motor contable completo se le suma ahora **la entrada entera**:
segundo factor contra los vectores oficiales del RFC, claves con scrypt, códigos de
recuperación, bloqueo por intentos sin el arma que trae de serie, el flujo completo,
las seis pantallas y el acceso con la cuenta de la empresa.

**212 comprobaciones**, todas pasando. Ninguna línea de código se ha añadido sin su
prueba en la misma sesión.

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
esquema entero, comprueba las ciento cuarenta reglas duras, el diccionario bilingüe y las ciento sesenta y ocho pruebas de la aplicación y revisa el diccionario
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
| `db/pruebas/14-sesiones.sql` | Un atacante falla veinte veces contra un correo y **el dueño entra igual**. |
| `db/pruebas/15-aprobacion.sql` · `app/pruebas/aprobacion.test.ts` | Quién puede objetar, qué no se factura, y dos aprobaciones simultáneas. |
| `app/pruebas/contrato.test.ts` | Que el cliente no llegue al margen ni pidiéndolo, y que «no existe» y «no es tuyo» den el mismo error palabra por palabra. |
| `app/pruebas/bandeja.test.ts` | Que aparezca la objeción con su motivo, que lo recién presentado **no** aparezca (eso espera al cliente), y que responder la vacíe. |
| `app/pruebas/cartera.test.ts` | Que el avance salga del libro, que el orden ponga delante lo que espera, y que el cliente de A no alcance a B ni contando. |
| `app/pruebas/rutas.test.ts` | El camino completo de la petición a la respuesta: que sin cookie todo redirija, que el testigo **solo** viaje en la cookie, y que salir cierre la sesión de verdad y no solo borre la cookie. |
| `app/pruebas/cookies.test.ts` | Que una cookie con nombre parecido no se confunda con la nuestra, y que el idioma respete el orden de preferencia del navegador. |
| `app/pruebas/empresa.test.ts` | Quince formas de presentar un testigo que parece válido y no lo es. |
| `app/pruebas/entrada.test.ts` | Que el error no diga si falló el correo o la clave, que el desafío no viaje en la dirección, y que las seis pantallas estén completas en los dos idiomas. |
| `app/pruebas/sesion.test.ts` | Nueve formas de intentar entrar sin poder: sin segundo factor, con la cuenta de baja, quemando el desafío, con un desafío inventado, midiendo el tiempo de respuesta. |
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
| `db/schema/17-sesiones.sql` | Sesiones, intentos y códigos de recuperación. **El bloqueo cuenta por pareja de cuenta y origen, no por cuenta.** Bloquear la cuenta tras N fallos suena prudente y es un arma: si basta con fallar seis veces contra un correo, cualquiera deja fuera al gerente de la operadora la mañana de una aprobación. Y al dar de baja a una persona, sus sesiones se cierran solas — sin eso, entrar con la cuenta de la empresa no serviría de nada. |
| `app/src/dominio/sesion.ts` | El flujo de entrada entero. **La clave sola nunca basta.** El mensaje es idéntico si el correo no existe, si la clave está mal o si la cuenta está de baja — distinguirlos convierte la pantalla de entrada en un buscador de correos válidos. Y cuando el correo no existe se gasta igualmente el tiempo de verificar contra una huella señuelo: responder rápido ya diría «ese correo no está», por muy igual que sea el texto. |
| `db/schema/99-permisos.sql` | Los permisos, cargados **los últimos**. `grant on all tables` solo alcanza a las tablas que ya existen, así que a media carga deja fuera todo lo que se cree después. Pasó exactamente eso con las tablas de sesiones. |
| `app/src/pantallas/entrada.ts` | Las seis pantallas de entrada. Un solo campo cada una, porque quien entra lo hace de pie y con una mano. El campo del código saca el teclado numérico y el navegador lo rellena solo desde el mensaje de texto. El correo no se autocapitaliza — un teclado de móvil poniendo mayúscula inicial en un correo es el motivo más tonto por el que alguien no entra. Y la espera dice **cuántos segundos**: sin número, la gente recarga veinte veces y empeora su propia espera. |
| `app/src/dominio/empresa.ts` | Entrar con la cuenta de la empresa. Lo que compra no es ahorrarle una clave al ingeniero: es que **cuando su empresa lo da de baja, pierde el acceso el mismo día**, sin que nadie de GPS tenga que acordarse. Cinco comprobaciones que no se pueden saltar, cada una con su prueba: emisor, destinatario, **inquilino**, caducidad y nonce. Sin la del inquilino, cualquiera con una cuenta personal de Microsoft entra en el portal del cliente — es el error clásico. |
| `app/src/servidor/rutas.ts` | Las rutas de entrada, sobre `node:http` directo y sin armazón. No es purismo: el camino de entrada es la parte más atacada, y cada dependencia ahí es código de otro que hay que entender cuando algo falla a las tres de la madrugada. Cabeceras de seguridad en **toda** respuesta, incluidas las de error. |
| `app/src/servidor/cookies.ts` | La cookie de sesión con los cuatro atributos que la hacen segura, y **sin caducidad dentro**: la caducidad de verdad vive en la base de datos, donde no se puede falsificar. |
| `app/src/servidor/arrancar.ts` | El servidor de red, la capa más fina posible. Nunca devuelve el detalle de un error al navegador: un mensaje de la base de datos lleva dentro nombres de tablas y hasta valores. |
| `app/src/dominio/cartera.ts` | La cartera de contratos. **No enseña un porcentaje suelto: enseña qué está esperando a quién.** Un 58% no contesta ninguna pregunta —ni cuándo llega lo suyo, ni si hay algo parado, ni si tiene que hacer algo—. Y el orden no es alfabético: primero lo que espera a alguien, y dentro de eso lo que lleva más tiempo esperando. **La misma función sirve para dentro y para el cliente sin una sola rama**: el aislamiento lo hacen las políticas de fila. |
| `app/src/pantallas/cartera.ts` | La pantalla de la cartera. **Lo que espera a alguien va arriba y en color; el avance va detrás y en pequeño.** Es al revés de como se suele hacer, y a propósito: el porcentaje es lo bonito de enseñar y lo que menos ayuda. Lo que espera al cliente se marca distinto de lo que espera a GPS: uno es «tienes que hacer algo», el otro es «estamos en ello». |
| `app/src/dominio/contrato.ts` · `pantallas/contrato.ts` | La ficha. **El costo no se pide cuando pregunta un cliente**, y no es que se filtre después: el rol no tiene permiso sobre esa columna, así que pedirla da un error. Un error es ruidoso; un hueco en la respuesta se cuela sin que nadie lo note. La norma y la especificación van a la vista: que un cabezal sea API 6A PSL-3 es la mitad de lo que se compró, y lo primero que se discute cuando algo llega y no encaja. |
| `db/schema/18-aprobacion.sql` | Objeciones con tabla propia. Un disparador impide que GPS objete su propia valuación, y otro impide **facturar con una objeción sin responder** — facturar algo que el cliente discutió por escrito es como se pierde una discusión antes de empezarla. El cliente recibe permiso de escritura por primera vez, y **solo sobre tres columnas**: con `update` a secas podría marcarse la valuación como cobrada. |
| `app/src/dominio/aprobacion.ts` | Aprueba **el cliente, no GPS**: un acta que se firma uno mismo no vale nada. La condición del estado va **dentro** del `update`, no en un `if` de arriba: entre la consulta y la escritura cabe otra petición, y hay una prueba que lanza dos aprobaciones a la vez y comprueba que solo una gana. |
| `app/src/servidor/csrf.ts` | Segunda cerradura contra peticiones cruzadas. `SameSite=Lax` ya basta en navegadores actuales, pero depende de que el navegador se porte bien. El testigo se deriva del de sesión con HMAC: quien no puede leer la cookie no puede calcularlo, así que no hay que guardarlo en ningún sitio. |
| `app/src/dominio/bandeja.ts` · `pantallas/bandeja.ts` | **Lo que espera a GPS**, dentro de la cartera y no en una pantalla aparte: una bandeja que hay que buscar no se mira, y una que no se mira deja al cliente escribiendo al vacío igual que antes. Ordenada por **lo que lleva más tiempo parado**, no por importe: el daño de dejar a un cliente sin respuesta no es proporcional al dinero. |
| `i18n/es.json` · `i18n/en.json` | 152 términos en los dos idiomas, incluido el vocabulario donde la palabra equivocada cambia el sentido: *valuación* → progress payment, *retención de garantía* → retention, *reacondicionamiento* → well workover, *colada* → heat number, *sustraendo* → deductible amount. |
| `i18n/comprobar.py` | Falla si una clave existe en un idioma y no en el otro, si un texto está vacío, o si los dos idiomas dicen lo mismo (casi siempre un olvido). |
| `db/schema/19-evidencia.sql` | **La tesis del proyecto.** El avance no se declara: se calcula desde los hitos que tienen su documento **y alguien lo revisó**. Un hito exige unas clases de evidencia concretas y un disparador se niega a darlo por bueno sin ellas, diciendo cuál falta. La evidencia se identifica por su **huella SHA-256**, no por su nombre de archivo: dos nombres distintos del mismo papel son el mismo papel. Rechazar exige decir por qué. Y de aquí salen las tres medidas que nadie más da: **brecha de evidencia** (lo declarado menos lo verificado, en dinero), **tiempo hasta la verdad** (mediana de lo que tarda un hecho en llegar al sistema) y **cobertura** (lo vendido arriba sin costo abajo). |
| `db/pruebas/16-evidencia.sql` | Catorce intentos de hacer trampa al avance: declarar 30% sin nada hecho, verificar sin el documento, subir una de las dos evidencias que se exigen, colar una huella que no es un SHA-256, contar una evidencia rechazada. Ninguno pasa. |
| `app/src/dominio/evidencia.ts` | El camino humano de la evidencia. **La huella se calcula aquí, sobre los bytes que llegan, y no se recibe**: si la enviara el navegador bastaría con mentir en un campo para que un archivo cualquiera pasara por el certificado de colada. El mismo archivo no entra dos veces en el mismo hito, y decirlo no es un error: se devuelve el que ya estaba, porque quien lo sube otra vez casi siempre es alguien que no sabía. Y el estado del hito no se escribe desde aquí — se le pide a la base de datos que lo derive, porque escribirlo aquí sería tener dos verdades sobre lo mismo. |
| `app/src/pantallas/evidencia.ts` | **La pantalla que justifica el proyecto.** La barra lleva dos tramos: el sólido es lo verificado, el rayado lo declarado sin respaldo. Una sola barra obligaría a elegir qué número enseñar, y cualquiera de los dos sería media verdad. Lo que falta va delante y en color, porque es la razón de que el avance no suba. El documento se nombra con su huella acortada: es lo que permite a dos personas en dos sitios comprobar que miran el mismo papel. |
| `app/src/pantallas/base.ts` | **Una sola envoltura para todas las pantallas.** Existe porque ya había dejado de haberla: los colores estaban escritos cuatro veces y las cuatro copias habían derivado. Es la misma avería que «dos plantillas, una de móvil y otra de escritorio», solo que más lenta de ver. |
| `app/pruebas/base.test.ts` | Que ninguna pantalla declare sus colores, monte su propio documento ni tenga su propio `escapar`. **Dos versiones de escapar es como se cuela sin escapar el texto de un cliente por una de las dos.** |
| `app/pruebas/evidencia.test.ts` · `pantalla-avance.test.ts` | Que el camino humano no abra ningún atajo que la base de datos ya había cerrado, y que la pantalla no se pueda leer como un porcentaje suelto. |
| `db/colisiones.py` | Busca dos archivos de prueba que compartan prefijo de UUID o fecha de tasa del BCV. **Es el fallo más caro de los encontrados aquí, porque no se ve:** el segundo archivo se queda con las filas del primero y la prueba pasa o falla según el orden en que corran. |
| `app/src/servidor/multipart.ts` | Leer un formulario con archivo, **sin armazón**. Es lo único del servidor que acepta bytes arbitrarios de fuera, y por eso está escrito aquí: son ciento y pico líneas y el día que algo falle a las tres de la madrugada conviene poder leerlo entero. Lo más fácil de estropear y lo más importante: **el CRLF que va antes de la frontera siguiente es de la frontera, no del contenido**; sin quitarlo, todo archivo saldría dos bytes más largo y con la huella cambiada. |
| `app/src/servidor/almacen.ts` | Dónde viven los bytes. **Bajo su huella, no bajo su nombre.** El mismo certificado de colada acompaña a las cuatro válvulas del mismo lote y hoy se sube cuatro veces; así ocupa una. Comprobar que un documento no se ha cambiado es volver a calcular su huella, sin confiar en nadie. Es un almacén en disco a propósito: el día que haga falta S3 cambia ese archivo y nada más, porque el resto del sistema solo conoce huellas. |
| `app/pruebas/subida.test.ts` | El circuito entero por HTTP: subir, verificar, ver el avance subir, rechazar con motivo, verlo caer, y todos los intentos de saltárselo. |
| `app/herramientas/pintar-avance.ts` | Genera la pantalla del avance desde la base de datos real, como cliente o como GPS, sin desplegar nada. |
| `db/schema/20-avisos.sql` | **Sin esto, todo lo construido se usa la primera semana y se abandona la tercera.** Un buzón de salida: el aviso se encola en la misma transacción que el hecho, no se manda desde el disparador. Si la transacción se deshace, el aviso se deshace con ella; si el correo está caído, el aviso espera en vez de perderse. El texto no se guarda — se guardan los datos y se redacta al enviar, en el idioma de quien lo recibe. Y `encolar_lo_parado()` para lo que no avisa ningún hecho: **un documento sin revisar no es un suceso, es la ausencia de uno**, y nadie encola nada cuando algo NO pasa. |
| `app/src/dominio/avisos.ts` | Redactar y vaciar la cola. **Un aviso nunca lleva cifras que no sean del destinatario:** un correo se reenvía, y en cuanto sale deja de estar bajo las políticas de fila. La plantilla solo sustituye lo que pide, así que un dato de más no acaba dentro por descuido. Y el aviso no es el contenido: es un empujón hacia la aplicación, al sitio exacto y nunca a la portada. |
| `app/src/servidor/correo.ts` | SMTP contra el protocolo, sin dependencia. **Nunca manda la contraseña en claro:** si el servidor no ofrece STARTTLS y la conexión no era ya cifrada, se corta. Un servidor de correo sin cifrado no es algo con lo que negociar, es un error de configuración. Con el transporte al registro para poder arrancar el primer día sin buzón. |
| `app/pruebas/correo.test.ts` | Levanta un servidor que **habla SMTP de verdad** y comprueba la conversación orden por orden. Encontró que el cliente leía solo la última línea de una respuesta de varias, y que lo que el servidor sabe hacer viene en las intermedias. |
| `app/herramientas/avisar.ts` | Vacía la cola, aparte del servidor web: un servidor de correo lento no tiene por qué hacer lenta la aplicación. |
| `db/schema/21-plantillas.sql` | Las cadenas de hitos de los cinco tipos de contrato. `plantilla_hito` existía desde el principio y estaba **vacía**, que es el peor estado posible: un contrato nuevo nacía sin hitos, su avance salía cero, y cero es lo que sale también cuando algo va mal. **El peso de cada hito es cuánto del trabajo está hecho, no cuánto se cobra** — mezclarlas es lo que hace que un contrato aparezca al 80% con el equipo todavía en el patio del proveedor. Y `renglones_sin_hitos()`, porque crear los hitos se puede olvidar y un renglón sin hitos se ve igual que uno que no ha empezado. |
| `app/src/dominio/medidas.ts` · `pantallas/medidas.ts` | Las tres cifras, en pantalla. Cada bloque abre con **la pregunta que contesta**, en castellano normal: un cuadro de mando que hay que aprender a leer se mira el día que se instala y nunca más. **No se suman dólares con bolívares.** Y cuando no hay nada que señalar lo dice con palabras, porque una tabla vacía parece un error del programa. |
| `app/src/dominio/perfil.ts` · `pantallas/perfil.ts` | Lo poco que cada quien decide sobre sí mismo. Las casillas vienen **marcadas**: un aviso que hay que activar es un aviso que nadie activa. Al cliente no se le ofrecen los avisos que son de dentro. |
| `db/schema/22-valuar.sql` | **De la evidencia al dinero.** La obra de una valuación no se teclea: sale de los hitos verificados que todavía no se han cobrado. Cada hito se marca con la valuación que se lo llevó, así que **no se cobra dos veces** — y no depende de que los periodos no se solapen, porque se solapan siempre. Si un hito se cae después, se ve qué valuación lo cobró, y **no se corrige solo**: lo facturado se arregla con una nota de crédito. |
| `app/src/dominio/alta.ts` · `pantallas/alta.ts` | Dar de alta un contrato. **El monto se calcula, no se teclea.** Nace en borrador. Los hitos se crean ahí mismo, en la misma transacción. Los errores salen todos juntos y lo escrito vuelve escrito. **Sin una línea de JavaScript**, porque la política de seguridad es `default-src 'none'` y relajarla para clonar una fila sería pagar con la mejor defensa que hay. |
| `app/src/dominio/valuar.ts` · `pantallas/valuar.ts` | La propuesta de valuación. **La pantalla no tiene ninguna casilla donde teclear la obra**, y esa ausencia es la decisión de diseño más importante del proyecto: ponerla «por si acaso» convertiría todo lo anterior en decoración. |
| `app/pruebas/circuito.test.ts` | **La prueba que contesta la única pregunta que importa.** Recorre el circuito entero por HTTP sin tocar la base de datos. Si pasa, el sistema sirve; si falla, da igual lo que digan las demás. |
| `app/src/servidor/csv.ts` | Leer la hoja. **No se lee .xlsx, se lee CSV, y es una decisión:** un .xlsx es un ZIP con XML dentro. «Guardar como CSV» son dos clics y deja un archivo legible dentro de diez años. Tres cosas hay que acertar y son donde falla todo lo que lee CSV a mano: **el separador** (Excel en español usa punto y coma, porque la coma es el decimal), **las comillas** (`Cabezal 11" 5M`) y **el BOM** de Excel. |
| `app/src/dominio/importar.ts` · `pantallas/importar.ts` | El camino de cuatro pasos. La aplicación **propone y enseña**; el humano corrige. El formato se propone mirando el **dato**, que es lo único que lo dice. Y la pantalla enseña la **cabecera original** y un **ejemplo de la hoja** al lado de cada columna: sin el ejemplo no hay forma de saber si «Base» es la base o el total con IVA, y esa confusión mete un 16% de error. |
| `db/schema/23-importar-facturas.sql` | Lo que hacía falta para que el importador **cree algo**: antes `confirmar_lote` ponía un sello y nada más. **Un proveedor que no existe no se crea solo** — se niega el lote entero y se dice cuál falta. El importe en dólares se calcula con la tasa del día **de la factura**, no con la de hoy. |
| `app/src/dominio/cobrar.ts` · `pantallas/cobrar.ts` | Registrar un cobro. **La cuenta por cobrar baja sola** — un saldo que alguien marca es un saldo que algún día se queda sin marcar — y el saldo no se guarda, se resta. No se cobra de más: un saldo negativo no significa nada en un libro. El cobro se asienta en la misma transacción en que se registra. |
| `app/src/dominio/periodos.ts` · `pantallas/periodos.ts` | Los meses contables. **La pantalla más aburrida y de las que más bloquean.** Lo primero que se ve es abrir el siguiente, con su nombre ya escrito — no hay ni un desplegable. Solo se cierra el abierto **más antiguo**, y **no se reabre**: corregir un mes cerrado se hace con un asiento de reverso en el siguiente, que es como tiene que quedar el rastro. |
| `db/schema/24-facturar.sql` (notas) | Notas de crédito y débito. **Una factura emitida no se modifica y no se borra:** ya estaba declarada, ya la tiene el cliente y ya lleva su número de control. Se corrige con una nota que apunta a ella y deja las dos en el libro — dentro de dos años hay que poder explicar por qué el importe cambió, y una factura reescrita no explica nada. La de crédito **resta** y la de débito **suma**: confundirlas invierte el signo de la declaración del mes. |
| `db/schema/24-facturar.sql` | Emitir la factura. **El correlativo lo pone la base de datos**, con un bloqueo sobre la organización: dos personas facturando a la vez esperan una a la otra en vez de sacar el mismo número — que es lo que pasa el día que dos personas cierran el mes. Y **no genera otro asiento**: la cuenta por cobrar ya nació con la valuación, así que un asiento aquí duplicaría el ingreso. |
| `app/src/servidor/jwks.ts` | La firma del testigo de identidad: **lo único que separa «entrar con la cuenta de la empresa» de «entrar diciendo que eres quien quieras»**. Solo RS256, decidido por quien verifica y no por quien firma — aceptar el algoritmo que venga dentro es el ataque clásico contra JWT. La clave se busca por su `kid`, y el juego de claves se guarda un rato pero **se vuelve a pedir ante un `kid` desconocido**: los proveedores rotan sin avisar. |
| `db/schema/25-sso.sql` · `app/src/dominio/sso.ts` | Entrar con la cuenta de la empresa. **El motivo entero: cuando la operadora da de baja al ingeniero, pierde el acceso el mismo día**, sin que nadie de GPS se acuerde. El estado y el nonce viven en la base de datos y **se queman al usarse** — en una cookie, quien pueda escribirla elige el nonce, y elegir el nonce es reutilizar un testigo viejo. La empresa se busca **por la persona**, no por el dominio del correo. Y no se crea la persona sola: tener cuenta en Microsoft no es tener acceso a este contrato. |
| `app/src/servidor/proveedores.ts` | Microsoft y Google configurados. **El `client_secret` sale del entorno:** escribirlo en el código es escribirlo en el historial del repositorio para siempre, y un secreto que estuvo en un repositorio está quemado aunque se borre. **Medio configurado es peor que nada**, así que un cliente sin secreto no cuenta como configurado — se ofrecería el botón y fallaría al volver. |
| `app/src/dominio/proveedores.ts` · `pantallas/proveedores.ts` | Retener el IVA y el ISLR a los proveedores. **No retener cuando toca lo paga GPS de su bolsillo, con multa.** La pantalla avisa antes de pulsar de lo que más se discute: **sin número de control la retención es del 100%, no del 75%**. Y si la empresa no consta como agente de retención en esa fecha, el botón no se ofrece y se dice por qué — un botón que aparece y revienta hace pensar que el sistema está roto. |
| `app/src/dominio/banco.ts` · `pantallas/banco.ts` | Conciliación bancaria. **La máquina propone; casar lo hace una persona** — dos movimientos del mismo importe el mismo día son más frecuentes de lo que parece, y una conciliación automática que se equivoca una vez al mes es peor que ninguna. **Lo que no casa no se esconde**, a los dos lados, y queda señalado hasta que alguien lo explique por escrito. La nota solo se ofrece en los movimientos del banco: un cobro que el banco no tiene no se arregla con una nota. |
| `app/src/dominio/activos.ts` · `pantallas/activos.ts` | Los equipos. Cada uno con lo que queda en libros y, si está alquilado, **lo que deja**: lo facturado del contrato menos el desgaste del periodo. Un equipo que deja menos de lo que se gasta no es una pérdida contable abstracta: es **una máquina que habría salido más barata parada**, y esa cifra no estaba en ningún sitio. Depreciar el mes se hace desde aquí, y las tres cosas que lo impedirían se comprueban **antes** de pulsar, no después. |
| `app/src/servidor/bucle.ts` · `herramientas/avisar.ts` · `operar/` | Los avisos saliendo solos. La espera se cuenta **desde que termina** la vuelta, no desde que empieza: contándola desde el principio, un servidor de correo lento arranca la vuelta siguiente encima de la anterior. Un fallo no mata el bucle, pero fallo tras fallo espera más cada vez. Se para con SIGTERM **terminando la vuelta**: cortar a mitad de un envío deja avisos tomados y sin mandar. Probado con un reloj de mentira — un bucle que se prueba esperando de verdad es un bucle que nadie vuelve a probar. |
| `app/src/dominio/reexpresion.ts` · `pantallas/reexpresion.ts` | Reexpresión por inflación (VEN-NIF / NIC 29). El **resultado monetario del ejercicio arriba y grande**: es lo que costó tener bolívares mientras perdían valor, y es lo que un CFO mira primero. **Positivo es pérdida** — el signo se lee al revés de lo que parece. El ajuste se ve **cuenta por cuenta**, porque un ajuste global que nadie puede abrir es un número que nadie se cree. Las monetarias, marcadas y con el ajuste **en blanco, no en cero**: cero se lee como «se calculó y dio cero». |
| `db/schema/26-importar-ventas.sql` | El histórico de ventas por Excel. Aquí el número **no** lo pone la base de datos, al revés que en `siguiente_factura`: estas facturas ya existen, ya las tiene el cliente y ya se declararon. No se asienta lo que ya tiene asiento — cargar el histórico encima de lo vivo **duplicando el ingreso** es el error clásico de esta operación. El ingreso va a la cuenta del **tipo del contrato**, no a un cajón de «ingresos». |
| `app/src/dominio/libros.ts` · `pantallas/libros.ts` | Los libros de ventas y compras. **Lo único de esta aplicación que sale con destino al SENIAT.** No son una tabla: salen de las facturas que ya existen — un libro tecleado aparte acaba discrepando del sistema, y entonces hay dos verdades. Los totales van **arriba**, que es lo que se copia en la declaración. Una compra **sin número de control** sale señalada: sin control no hay crédito fiscal y la retención pasa al 100%. |
| `app/pruebas/dia-uno.test.ts` | El día 1: empresa recién creada, base vacía, **sin cargar ni un dato a propósito**. Cada pantalla responde, no suelta «undefined», tiene salida, y el cliente recibe en la contabilidad **el mismo 404 que ante una dirección inventada** — un 403 confirmaría que existe. |
| `app/pruebas/formulario.ts` · `formularios.test.ts` | Devolver un formulario **como lo devuelve el navegador**, y mandarlos todos en blanco. Modela las reglas que no son intuitivas y que ya escondieron dos fallos. Cada pantalla abre su propia sesión y se comprueba que sigue viva al final: sin eso, el barrido pasa sin comprobar nada. |
| `app/pruebas/movil.test.ts` | Las pantallas **dibujadas** en un Chromium a 360 × 740, y también a 320. **Sin red**, cortando las fuentes: el portal se usa en el patio con mala cobertura, así que lo que hay que comprobar es cómo queda cuando las fuentes NO llegan. El código que corre en el navegador va **como texto**, no como función: escribirlo como función obligaría a meter `dom` en la configuración de tipos, y entonces el servidor podría usar `document` sin que nadie se lo impidiera. Si el navegador falta, **falla diciéndolo**; no se salta sola. |
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
| 110 | Sin nada hecho, el avance es **cero**. |
| 111 | Declarado 30%, el avance real sigue en 0%. **Declarar no es avanzar.** |
| 112 | No se puede dar por verificado un hito sin su documento, y el error dice **cuál** falta. |
| 113 | Con el documento subido, el hito pasa a *evidenciado* — pero no a verificado. |
| 114 | *Evidenciado* no es *verificado*: el avance sigue en 0%. |
| 115 | El hito no se verifica mientras su evidencia esté **sin revisar**. |
| 116 | Revisada la evidencia, el avance sube al 30% que pesa ese hito. |
| 117 | El avance a una fecha pasada **no cuenta lo ocurrido después**: la historia no se reescribe. |
| 118 | Un hito que exige acta **y** foto no se verifica con una sola. |
| 119 | Una evidencia rechazada no cuenta para nada. |
| 120 | Rechazar exige decir por qué: sin motivo, la base de datos no deja. |
| 121 | La huella tiene que ser un SHA-256 de verdad, 64 dígitos hexadecimales. |
| 122 | Brecha de evidencia: de 100.000 declarados, **40.000 sin respaldo**. |
| 123 | Tiempo hasta la verdad: mediana de 7,5 días, el peor caso 12. |
| 124 | Cobertura: 200.000 vendidos arriba **sin nada comprado debajo**. |
| 125 | Recalcular no mueve un hito que sigue estando bien. |
| 126 | Rechazada la evidencia, el hito **cae** y el avance vuelve a 0%. |
| 127 | El cliente ve sus hitos y **ninguna factura de proveedor**. |
| 128 | La huella se calcula sobre los bytes: el vector oficial de SHA-256 sale exacto. |
| 129 | El mismo archivo con otro nombre no entra dos veces: es el mismo papel. |
| 130 | Rechazar sin decir por qué no pasa. |
| 131 | Un documento ya revisado no se vuelve a revisar. |
| 132 | Un documento vacío no prueba nada. |
| 133 | Un hito que no existe y uno que no te toca dan el **mismo** error. |
| 134 | El cliente **no puede** subir ni verificar nada: eso volvería el avance a ser lo que alguien diga. |
| 135 | La cola de revisión pone delante lo que lleva más tiempo parado, no lo de más importe. |
| 136 | La barra lleva dos tramos, y sin brecha no se enseña una insignia diciendo que no hay brecha. |
| 137 | Lo que falta va **antes** que la lista de documentos, no detrás. |
| 138 | Un hito sin empezar se atenúa, no desaparece: si desapareciera, los pesos visibles no sumarían 100. |
| 139 | Ninguna pantalla declara sus propios colores, ni monta su documento, ni repite `escapar`. |
| 140 | El avance de un renglón se sirve en su ruta, y uno que no te toca devuelve 404, no 403. |
| 141 | El CRLF de la frontera no se cuela en el archivo: la huella sale exacta con bytes crudos, nulos y 0xFF. |
| 142 | Del nombre del archivo no queda ninguna ruta: de `../../etc/passwd` queda `passwd`. |
| 143 | Un cuerpo por encima del techo, y uno con demasiadas partes, se rechazan los dos. |
| 144 | El mismo documento dos veces ocupa una vez en el disco. |
| 145 | Una huella que no es una huella no llega al disco: `..`, mayúsculas, 63 y 65 caracteres. |
| 146 | Un documento cambiado por debajo **se delata**: `intacto()` lo dice. |
| 147 | El circuito entero: subir → el avance sigue en 0 → verificar → sube al 40%. |
| 148 | El documento se sirve como **descarga**, con `nosniff`, y los bytes salen exactos. |
| 149 | Un SVG no entra: la lista de formatos es cerrada, y se filtra otra vez al salir. |
| 150 | El cliente no puede subir, ni verificar, ni rechazar — y la pantalla ni le pinta los botones. |
| 151 | Rechazar exige motivo también en la ruta, no solo en la base de datos. |
| 152 | El destino de vuelta no puede sacarte del portal, tampoco al subir. |
| 153 | Presentar avisa a las **dos** personas del cliente, no solo a la que firmó la vez anterior. |
| 154 | A GPS no se le avisa de lo que acaba de hacer. |
| 155 | El aviso lleva el importe de la obra y **ningún costo ni margen**, aunque se le metan en los datos. |
| 156 | Presentar dos veces no manda el correo dos veces. |
| 157 | La objeción del cliente avisa a GPS el mismo día; la respuesta vuelve al cliente. |
| 158 | Quien dijo que no quiere ese aviso no lo recibe; quien está de baja tampoco. |
| 159 | **Si el hecho se deshace, el aviso se deshace con él.** |
| 160 | Tomar de la cola gasta un intento, aunque el envío se muera a mitad. |
| 161 | El reintento espera cada vez más, y a la sexta se da por perdido. |
| 162 | Cada quien ve sus avisos y no los de los demás — ni siquiera alguien de dentro. |
| 163 | Lo que lleva días parado avisa solo, y pasarlo dos veces el mismo día no duplica nada. |
| 164 | El aviso sale en el idioma de cada destinatario, no en el del sistema. |
| 165 | Si el correo falla, el aviso sigue pendiente y no reintenta inmediatamente. |
| 166 | Un fallo al mandar uno no deja sin avisar a los demás. |
| 167 | Sin cifrado **no se manda la contraseña**: la conversación se corta antes de autenticar. |
| 168 | Una cabecera de correo no puede llevar saltos de línea: no se cuela un destinatario oculto. |
| 169 | Una línea que sea solo un punto no termina el mensaje a mitad. |
| 170 | El registro no escribe la dirección de correo entera. |
| 171 | Las cinco plantillas suman exactamente 100: un renglón terminado del todo llega al 100%. |
| 172 | Las fechas planificadas se reparten dentro del plazo y en orden; sin plazo no se inventa ninguna. |
| 173 | Volver a crear los hitos no duplica ni borra la fecha real que alguien puso. |
| 174 | El renglón al que se le olvidaron los hitos **se ve**, con su importe, y deja de verse al crearlos. |
| 175 | La brecha se calcula en dinero, y **no se suman dólares con bolívares**. |
| 176 | Un cliente que pide las medidas choca contra un **permiso**, no contra un filtro. |
| 177 | Cuando no hay nada que señalar se dice con palabras, no con una tabla vacía. |
| 178 | El cliente no llega a `/medidas`: 404, igual que a un contrato ajeno, y la cartera ni se lo ofrece. |
| 179 | Por omisión se reciben todos los avisos; desmarcar uno lo apaga **de verdad**: deja de encolarse. |
| 180 | Desmarcarlo todo se guarda — guardar solo lo marcado dejaría imposible apagar nada. |
| 181 | Un grupo de casillas repetidas no se queda en una sola. |
| 182 | El cliente **no puede leer** la huella de la clave, el secreto del 2FA ni el sujeto del directorio. |
| 183 | El cliente ve a los suyos y a nadie más; GPS ve a todos porque administra las cuentas. |
| 184 | El monto del contrato **sale de los renglones**: 3×1.000 + 2×250,50 = 3.501,00. |
| 185 | Un contrato nuevo nace **con sus cinco hitos** y en borrador; el cliente no lo ve. |
| 186 | Un anticipo sin ritmo de amortización no pasa: quedaría cobrado dos veces. |
| 187 | Si algo falla, **no queda un contrato a medias**. |
| 188 | El formulario de alta no lleva ni un `<script>` ni un `onclick`. |
| 189 | La propuesta de valuación sale de lo **verificado**; lo declarado sin papel no aparece. |
| 190 | Emitir se lleva los hitos: **no se cobra dos veces lo mismo**, ni con periodos solapados. |
| 191 | La obra guardada es la calculada, y queda anotado que salió de `hitos_evidenciados`. |
| 192 | Los porcentajes se copian del contrato y **se congelan**. |
| 193 | Un hito facturado que después se cayó se ve, y **sigue apuntando** a la valuación que lo cobró. |
| 194 | La pantalla de valuar **no tiene casilla para teclear la obra**. |
| 195 | Un contrato sin hitos **no se puede poner en vigor**. |
| 196 | Presentar dos veces no pasa: mandaría dos correos. |
| 197 | **El circuito entero, por HTTP y sin tocar la base de datos**, de punta a punta. |
| 198 | Excel en español separa con punto y coma; un punto y coma **dentro de comillas** no decide el formato. |
| 199 | `Cabezal 11" 5M` sobrevive al viaje, y un salto de línea dentro de comillas no parte la fila. |
| 200 | Los tres bytes invisibles de Excel no se pegan a la primera cabecera. |
| 201 | Lo que no es un número devuelve **nada, nunca cero**: un cero silencioso es un importe que entra mal. |
| 202 | El 31 de febrero **no existe** aunque se escriba — `to_date` lo daba por el 3 de marzo. |
| 203 | La base de datos y la aplicación **llaman igual a los formatos**. |
| 204 | La hoja entra **tal cual**: `1.200.000,00` se guarda como texto, sin convertir. |
| 205 | La misma hoja dos veces se detecta por su huella y se avisa. |
| 206 | «Nro Control» lleva dentro «Nro»: lo específico gana a lo genérico al proponer. |
| 207 | Validar **no escribe nada**, y con una fila mala **no entra ninguna**. |
| 208 | Un proveedor sin dar de alta para el lote entero, **sin crear nada**, y se dice cuál. |
| 209 | El importe en dólares sale de la tasa del día **de la factura**. |
| 210 | El camino completo por HTTP: hoja → mapeo → comprobar → factura en la contabilidad. |
| 211 | Lo importado **llega al libro**: las facturas quedan asentadas y el libro cuadra. |
| 212 | **Sin plan de cuentas no se importa**, y se dice por qué antes de crear nada. |
| 213 | Un mes con el periodo contable cerrado se dice **antes**, con cuántas filas caen en él. |
| 214 | La cuenta por cobrar baja **sola**, y al llegar a cero la valuación pasa a cobrada. |
| 215 | **No se cobra de más**, ni cero, ni en un mes sin periodo abierto, ni una valuación sin aprobar. |
| 216 | El cobro queda **asentado**, y su asiento cuadra. |
| 217 | El cliente no ve la caja de quien le factura. |
| 218 | **El circuito hasta el final**, por HTTP: contrato → evidencia → valuación → aprobada → cobrada. |
| 219 | De diciembre se pasa a enero del año siguiente al ofrecer el mes que toca. |
| 220 | Solo se cierra el mes abierto **más antiguo**, y no se cierra uno descuadrado. |
| 221 | Un mes cerrado **no admite un asiento más**. |
| 222 | La pantalla dice que un mes cerrado no se reabre, **y qué hacer en su lugar**. |
| 223 | La serie de facturas sigue **sin huecos**, y el número de control lleva su propio formato. |
| 224 | La base y el IVA de la factura **se leen de la hoja**, no se vuelven a calcular. |
| 225 | Emitir la factura **no genera otro asiento**: no duplica el ingreso. |
| 226 | No se factura sin aprobar, ni dos veces, ni con una objeción sin responder. |
| 227 | Las facturas salen en el libro de ventas **sin transcribir nada**. |
| 228 | El cliente no factura: una factura que emite quien la recibe no es una factura. |
| 229 | La nota apunta a su factura, lleva su IVA, y **la factura original no se toca**. |
| 230 | Lo que queda facturado **se resta**, no se guarda. |
| 231 | Una nota de crédito **no devuelve más** de lo que queda facturado. |
| 232 | La de débito **suma**: confundirla con la de crédito invierte el signo del mes. |
| 233 | Una nota no corrige otra nota, y **sin motivo no entra** — ni por la puerta de atrás. |
| 234 | El motivo **se guarda**: exigirlo y no guardarlo es peor que no exigirlo. |
| 235 | La pantalla enseña **lo que queda facturado** en cuanto hay una nota, no solo el original. |
| 236 | El signo va delante y con color: la de crédito en rojo, la de débito en verde. |
| 237 | El cliente **no corrige** la factura que recibe. |
| 238 | `alg: none` **no pasa**: el algoritmo lo decide quien verifica. |
| 239 | Cambiar RS256 por HS256 firmando con la **clave pública** tampoco pasa. |
| 240 | Sin `kid` no pasa, y un `kid` desconocido tampoco. |
| 241 | Cambiar una coma del cuerpo invalida la firma; otra clave RSA tampoco vale. |
| 242 | El juego de claves se guarda, y **se vuelve a pedir ante un `kid` nuevo**. |
| 243 | El error de firma **no lleva el testigo dentro**. |
| 244 | La petición **se quema**: la misma vuelta dos veces no abre dos sesiones. |
| 245 | Una petición inexistente, una usada y una caducada **responden igual**. |
| 246 | Un testigo con otro nonce, de otro inquilino, caducado o firmado por otro **no entra**. |
| 247 | Un correo sin verificar no entra: puede ser el de otra persona. |
| 248 | Quien no tiene cuenta aquí **no se crea solo**, y **quien está de baja no entra**. |
| 249 | La huella del sujeto manda sobre el correo: cambiar de correo sigue siendo la misma persona. |
| 250 | Sin SSO configurado, entrar con la empresa responde **como un correo cualquiera**. |
| 251 | Un cliente sin secreto **no cuenta como configurado**. |
| 252 | Microsoft pone el inquilino en el emisor y Google no: confundirlos deja entrar cuentas personales. |
| 253 | La vuelta sin estado, sin código o con un estado inventado **no llega a mirar nada**. |
| 254 | La retención de IVA es del **75%** con número de control y del **100%** sin él. |
| 255 | El comprobante lleva correlativo (AAAAMM + secuencia) y **no se repite**. |
| 256 | El ISLR guarda **la regla**, no solo el resultado: porcentaje, concepto y sustraendo en UT. |
| 257 | Si la empresa no consta como agente, **no se ofrece el botón** y se dice por qué. |
| 258 | La máquina propone por importe y cercanía, **y no casa nada sola**. |
| 259 | Un movimiento no se casa dos veces, ni un cobro con dos movimientos. |
| 260 | Aceptar sin casar **exige decir por qué**, por escrito, y queda guardado. |
| 261 | Lo que no casa se ve **a los dos lados** y se distinguen entre sí. |

## Lo que sigue

*(Esta lista estaba vieja: pedía los generadores de factura de proveedor y pago
emitido, y el importador de Excel. Los tres están hechos. Esto es lo que queda de
verdad, por orden de lo que más cambia las cosas.)*

**Decisiones que no son mías:**

1. **Dónde se despliega.** No hay servidor, ni dominio, ni base de datos de verdad.
   Mientras no lo haya, esto se mira en la instantánea navegable y nada más. Es la
   decisión que separa «funciona» de «se usa».
2. **Funcionar sin conexión.** Se instala en el teléfono, pero necesita red. Sin
   conexión pide un *service worker*, que es un archivo de JavaScript y obliga a
   abrir `default-src 'none'`. Hoy no hay una sola línea de código en el navegador, y
   eso vale mucho. Es un cambio, no un arreglo.
3. **Las ocho preguntas de contabilidad.** Caja chica se construyó con seis supuestos
   declarados en vez de esperarlas, y así debió hacerse desde el principio — pero los
   supuestos siguen siendo supuestos hasta que alguien los confirme o los corrija.

**Trabajo con valor propio, sin bloqueo:**

4. **El techo de las medidas.** `/medidas` tarda 739 ms con mil contratos, y la mayor
   parte se va en la política de fila de `hito`, que por cada hito comprueba si su
   renglón se ve, y eso mira el contrato. Se puede bajar. Tocar una valla de
   aislamiento por milisegundos **no se hace de paso**: pide su sesión y su barrido.
5. **Las fases que no se han empezado:** logística y procura (embarque, aduana,
   trazabilidad), calidad (MTR, colada, puntos de inspección), y el portal del cliente
   más allá de aprobar y objetar. El diccionario ya tiene el vocabulario de las tres;
   las pantallas no existen.
6. **Un segundo par de ojos.** 927 comprobaciones automáticas no sustituyen a una
   persona usando esto una semana con datos de verdad.

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
