# Decisiones pendientes del CEO

Preguntas abiertas en https://claude.ai/artifact/LyvqcKwc6vevhbTHTFhyvs
(se guardan solas; se leen desde la sesión con `ArtifactData`, colección `contabilidad/v1`)

| # | Decisión | Qué bloquea |
|---|---|---|
| 1 | ¿Nexus es el sistema contable o alimenta al del contador? | Estados financieros, cierre, reexpresión: 7 vistas |
| 2 | Moneda funcional del negocio | Qué columna manda en cada cálculo de margen |
| 3 | ¿Contribuyente especial? | Módulo de retención de IVA al 75% como agente |
| 4 | Desde cuándo se importa el Excel | Alcance del importador y de los saldos de apertura |
| 5 | Quién más toca la contabilidad | Permisos y registro de auditoría |
| 6 | ¿Hay plan de cuentas? | Si no, se crea uno estándar de servicios petroleros |
| 7 | Errores del Track GPS actual a no repetir | Prioridades de diseño |
| 8 | Qué parte de la contabilidad va primero si hay que trocear | Orden de las 28 sesiones de la fase |

## Nuevas, salidas de construir

| # | Decisión | Qué bloquea |
|---|---|---|
| 9 | **¿Dónde se despliega?** No hay servidor, ni dominio, ni base de datos de verdad. | Todo. Es lo que separa «funciona» de «se usa». |
| 10 | **¿Tiene que funcionar sin conexión?** Hoy no hay una sola línea de JavaScript en el navegador, y por eso la política de seguridad puede estar cerrada del todo (`default-src 'none'`). Trabajar sin señal obliga a abrirla para un *service worker*. | Uso en locación sin cobertura. Es un cambio, no un arreglo. |
| 11 | **¿El cliente ve el tablero de «dónde está el material»?** Hoy solo lo ve GPS. Los datos son suyos y ya los ve hito a hito dentro de su contrato; lo que cambiaría es darle una pantalla propia que los junta de todos sus contratos. | Amplía la superficie que ve alguien de fuera de GPS. Se puede abrir en una tarde, con su barrido de aislamiento. |
| 13 | **¿Con qué fecha entra al libro la venta de una valuación: el último día del periodo valuado, o la fecha de la factura?** Hoy es lo primero, que es como está escrito `asentar_valuacion()`. Fiscalmente en Venezuela el IVA débito nace con la factura, así que las dos fechas pueden caer en meses distintos y el libro de ventas (que usa la fecha de la factura) y el diario (que usa el periodo) dirían meses distintos de la misma venta. | El cierre mensual y la declaración de IVA. No lo he tocado: es una decisión contable, no de programación. Hoy se comprueba antes de facturar que el mes del periodo esté abierto, y si está cerrado se avisa en vez de emitir la factura. |
| 14 | **¿Qué concepto de ISLR le corresponde a lo que GPS le factura a una operadora, y lo deciden el contrato o el renglón?** Hoy `valuar.ts` elige el concepto así: `select codigo from concepto_islr where vigente_desde <= fecha order by vigente_desde desc limit 1` — es decir, **el que tenga la fecha de vigencia más reciente, sin mirar de qué concepto se trata ni a qué sujeto se le retiene.** Con un solo concepto sembrado sale el bueno por casualidad; en cuanto haya dos, la retención de ISLR de cada valuación la decide un `order by`. | El importe de la retención de ISLR de cada valuación, o sea dinero. No lo he tocado porque el concepto correcto es una clasificación fiscal —servicios, honorarios profesionales, arrendamiento de bienes muebles— y depende de qué se está facturando: es una decisión de contabilidad, y probablemente haya que elegirlo por tipo de contrato o por renglón, no uno para todo. Lo que sí está hecho: la pantalla de **Valores fiscales** ya deja crear y corregir conceptos, y dice cuántas retenciones se emitieron con cada uno. |
| 12 | **¿Una no conformidad (NCR) bloquea algo?** El vocabulario está en el diccionario y la mecánica de objeciones ya existe para las valuaciones. Una NCR que no bloquea nada es un cuaderno de notas. | El módulo de calidad entero. |

## Ya decidido

- Bilingüe español/inglés **desde el primer día**, no después.
- SSO empresarial (Microsoft y Google) **entra en la fase 1**.
- Multiempresa: aislamiento real entre clientes **desde el primer día**. Vender la aplicación a terceros queda para una tercera fase, con las bases puestas.
- Integración con ERP: tercera fase. El exportador para el contador, desde el primer día.
- La contabilidad va **primera**, por delante del móvil.
