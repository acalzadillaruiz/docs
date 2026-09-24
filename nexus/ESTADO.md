# GPS Nexus · estado

**Última actualización:** 2026-09-24
**Avance:** 1 de 141 sesiones · **1%**
**Fase en curso:** 5 — La contabilidad deja de vivir en Excel *(adelantada a primera por decisión del CEO)*

---

## Lo que existe hoy

| Archivo | Qué hace |
|---|---|
| `db/schema/00-identidad.sql` | Organizaciones, personas, método de entrada (clave+2FA, Microsoft, Google), capacidades una a una. La base de datos impide que una capacidad interna se conceda a un cliente. |
| `db/schema/01-moneda.sql` | Tasa BCV fechada e inmutable. `tasa_del_dia()` y `convertir()`. Una tasa publicada no se reescribe nunca. |
| `db/schema/02-contable.sql` | Plan de cuentas, períodos, asientos y partidas. Un asiento descuadrado no puede existir; no se edita, no se borra, no entra en un mes cerrado. |

## Lo que sigue

1. `03-fiscal.sql` — IVA (retención 75%), ISLR, IGTF, libros de ventas y compras.
2. `04-contrato.sql` — contratos, renglones, hitos. Lo referencia `partida.contrato_id`.
3. Generadores de asiento: factura, valuación, pago, retención. **Ningún asiento se escribe a mano.**
4. Importador de Excel — la pantalla que decide si esto se usa o se abandona.

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
