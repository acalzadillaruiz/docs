A: TERMINADO

# GPS Nexus · Estado

## SESIÓN 001 · 2026-09-22 · sesión interactiva (adelantada a petición del CEO)

## URL DEL ARTEFACTO
https://claude.ai/artifact/1foCUmkCPtF8Q8rzUDfiBP

## PANTALLAS TERMINADAS — 6 de 6
1. Puente de mando — las tres métricas con desglose y tabla por contrato
2. Elegibilidad — semáforo Chevron / PDVSA / Petroindependencia + expediente
3. Contratos — portafolio bidireccional upstream / downstream
4. Cabina de contrato — 5 pestañas (resumen, líneas y cobertura, gates y evidencia, cronología, auditoría)
5. Expediting — cola de artefactos que faltan, ordenada por impacto
6. Panel de procedencia — se abre desde cualquier cifra, en todas las pantallas

## PANTALLAS PENDIENTES
Ninguna.

## COHERENCIA — SÍ
Verificado ejecutando la lógica fuera del navegador:
- Curva `fab` suma 100. Curva `cat` suma 100.
- GPS-UP-24011: 60% declarado − 35% evidenciado = 25 pts × $840.000 = $210.000
- GPS-UP-24014: 70% − 50% = 20 pts × $315.000 = $63.000
- GPS-UP-24019: 83% − 68% = 15 pts × $186.000 = $27.900
- Evidence Gap  = $300.900
- Cola Expediting = $300.900  ← cuadra exactamente
- Coverage Gap = $180.000 + $64.000 = $244.000
- Portafolio   = $1.341.000
El HTML lleva un `console.assert` que falla si la cola deja de cuadrar con el gap.

## DECIDÍ SIN PREGUNTAR
- **Pesos de las curvas de avance.** Inventados para el prototipo. Van a DECISIONES-PENDIENTES.md: son tuyos.
- **Nombres de proveedores ficticios** (Wellhead Systems Intl., Nordsteel Forgings, Valvetec Houston). Deliberado: no se nombra a ningún fabricante real para no insinuar relaciones que no existen.
- **Sin framework, sin build.** HTML+CSS+JS en un archivo. El prototipo es desechable; añadir cadena de compilación no aporta nada.
- **Barra de dos tonos** (verde evidenciado / rayado rojo el gap) como componente firma. Reversible.

## DEUDA QUE DEJO
- La cronología bitemporal solo tiene eventos para GPS-UP-24011; los otros dos contratos muestran estado vacío.
- Las pestañas MDR, calidad, logística y comercial de la cabina no están: se plegaron en «líneas y cobertura» y «gates». Son F3/F4 del plan.
- Sin persistencia: nada se guarda. Correcto para un prototipo, inaceptable para producción.

## SIGUIENTE
Esperar la revisión del CEO. **B está congelada** hasta que apruebe A.

## BLOQUEADO POR EL CEO
Sí — ver DECISIONES-PENDIENTES.md
