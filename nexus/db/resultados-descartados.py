#!/usr/bin/env python3
"""
Funciones del esquema cuyo resultado la aplicacion tira. NO es un barrido permanente.

Se lanza a mano:  cd nexus && python3 db/resultados-descartados.py

Por que no esta en probar.sh, que es lo que importa de este archivo: lo escribi buscando la
forma de un fallo real —`desactivar_persona` devolvia cuantas sesiones cortaba, devolvia cero
siempre por un error, y nadie lo vio porque nadie mira lo que devuelve— y de los 14 sitios que
senala sobre 147 funciones, la mayoria son falsos positivos. El resultado SI se recoge, pero
la asignacion cruza varias lineas o va dentro de un ternario y este reconocedor de texto no lo
ve. Un barrido con ese ruido se convierte en uno que la gente aprende a ignorar, y entonces es
peor que no tenerlo.

Lo que si encontro, y ya esta arreglado: dar de baja a alguien no decia cuantas sesiones le
cortaba, e instalar el plan de cuentas no decia de cuantas cuentas.

Sirve para volver a pasarlo cuando se anadan funciones nuevas, leyendo la salida con criterio
en vez de creyendola.
"""

import re, subprocess, glob, os

# Las funciones que DEVUELVEN algo, preguntadas al catalogo.
sql = """select p.proname, pg_get_function_result(p.oid)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and pg_get_function_result(p.oid) <> 'void'
          order by p.proname"""
out = subprocess.run(['psql','-h','/var/tmp','-p','55432','-U','nexus','-d','nexus','-tAF','|','-c',sql],
                     capture_output=True, text=True)
funciones = {}
for l in out.stdout.splitlines():
    if '|' in l:
        n, r = l.split('|', 1)
        funciones[n.strip()] = r.strip()
assert len(funciones) > 50, f'solo {len(funciones)} funciones: no se leyo el catalogo'

def sin_comentarios(t):
    t = re.sub(r'/\*[\s\S]*?\*/', ' ', t)
    return '\n'.join(re.sub(r'(--|//).*$', '', l) for l in t.split('\n'))

NO_ES_LA_APP = {'sembrar.ts','medir.ts','exportar.ts'}
fuentes = []
for p in ('app/src/**/*.ts','app/herramientas/**/*.ts'):
    for f in glob.glob(p, recursive=True):
        if os.path.basename(f) in NO_ES_LA_APP: continue
        fuentes.append((f, sin_comentarios(open(f, encoding='utf-8').read())))

print(f'{len(funciones)} funciones que devuelven algo · {len(fuentes)} archivos\n')
print('LLAMADAS DESDE LA APLICACION CUYO RESULTADO NO SE RECOGE:\n')
hallados = 0
for nombre, devuelve in sorted(funciones.items()):
    for archivo, texto in fuentes:
        # Cada `await q\`...\`` con su prefijo: si no hay asignacion delante, se descarta.
        for m in re.finditer(r'(?:(const|let|var)\s+[^=\n]{1,60}=\s*)?\(?await\s+(?:comoQuien\(\(q\)\s*=>\s*)?q`([^`]*)`',
                             texto, re.S):
            cuerpo = m.group(2)
            if not re.search(r'\b%s\s*\(' % re.escape(nombre), cuerpo):
                continue
            if m.group(1) is None:   # nada a la izquierda del await: el resultado se tira
                linea = texto[:m.start()].count('\n') + 1
                print(f'  {nombre}() -> {devuelve}')
                print(f'      {archivo}:{linea}')
                hallados += 1
if hallados == 0:
    print('  (ninguna)')
