# Cómo correr GPS Nexus

Dos formas, y hacen cosas distintas.

## 1. Mirarla, sin instalar nada

El recorrido navegable: **https://claude.ai/artifact/613p36bPqXYLT31Tvdrck3**

Las 138 pantallas tal como las genera el servidor, con los enlaces reescritos para que
lleven de una a otra. Los enlaces funcionan; **los formularios no envían nada**. Sirve
para verla y para mostrarla; no sirve para comprobar que guarda.

## 2. Correrla de verdad, en tu máquina

```
git clone -b claude/gps-web-tracking-contracts-z715gi https://github.com/acalzadillaruiz/docs
cd docs/nexus
./arrancar.sh
```

Y abrir **http://localhost:8080**. El propio script imprime con qué entrar:

```
  correo    muestra@prueba.test
  clave     una clave razonable
  código    457291      (válido 24 s más)
```

Ese código de seis dígitos es el segundo factor. Cambia cada treinta segundos; si se te
pasa, en otra terminal:

```
cd docs/nexus/app && node --experimental-strip-types herramientas/codigo.ts
```

Aquí **los formularios sí guardan**: puedes subir un documento, verificar un hito y ver
subir el avance, emitir una valuación, facturarla y encontrar su asiento en el diario.

### Qué hace falta tener puesto

- **Node.js 22 o más nuevo.** El código es TypeScript que se ejecuta sin compilar, y eso
  entró en la 22. El script comprueba la versión y lo dice si no llega.
- **PostgreSQL 16.** En Debian o Ubuntu, `sudo apt install postgresql-16`; en macOS,
  `brew install postgresql@16`. No hace falta configurarlo: el script levanta uno
  desechable en `/var/tmp`, aparte de cualquier base que ya tengas.

El script, en orden: comprueba las dos cosas de arriba, instala las dependencias si
faltan, crea la base, carga las 32 piezas del esquema, siembra la empresa de muestra
—quince contratos, tres de cada uno de los cinco tipos— y enciende el servidor.

Para empezar de cero otra vez: `rm -rf /var/tmp/nexuspg` y volver a arrancar.

### Esto NO es un despliegue

Conviene que quede dicho, porque la diferencia es lo que separa «funciona» de «se usa»:

- La base de datos vive en `/var/tmp`. Un reinicio de la máquina se la lleva.
- Va **sin TLS**, y solo escucha en tu máquina. La cookie de sesión se marca `Secure`
  cuando hay TLS, y `Secure` sobre `http` hace que el navegador la tire y entonces no se
  puede entrar nunca — de ahí que el script ponga `NEXUS_INSEGURO=1`.
- Los datos son inventados: ningún importe, RIF ni correo es real. La empresa se llama
  «Muestra» a propósito, para que se note si alguien siembra esto donde no debía.
- **El secreto del segundo factor de la cuenta de muestra está escrito en el
  repositorio**, a la vista. Eso es correcto para una cuenta de muestra y sería un
  agujero para una de verdad: una cuenta real tiene el suyo, se enseña una sola vez al
  crearla, y después no se puede sacar de ninguna parte.

Lo que falta para que esto sea un sistema en uso está en `DECISIONES-PENDIENTES.md`, y la
primera es la número 9: **dónde se despliega**. No hay servidor, ni dominio, ni base de
datos de verdad, y esa decisión no es de programación.

## Comprobar que todo está bien

```
cd docs/nexus/db && ./probar.sh
```

833 comprobaciones contra un PostgreSQL desechable. Tarda unos siete minutos y termina
diciendo `TODAS LAS PRUEBAS PASAN` o qué archivo falló. Es lo que sí ejercita los
formularios de punta a punta: subir un documento, verificar un hito, cerrar un mes.
