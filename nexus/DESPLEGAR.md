# Poner GPS Nexus en un servidor

Destino: **https://nexus.grupoprimesupply.com**

## Lo que elegí, y por qué

**Un VPS de Hostinger**, con Docker. Tres razones, en orden de peso:

1. **Los documentos van a disco.** El acta de recepción que respalda un hito es un
   archivo, y sin él el avance de un contrato deja de poder demostrarse — que es de lo
   que va todo este producto. Las plataformas tipo Render borran el disco en cada
   despliegue en su plan de entrada, y en Fly.io hay que montar un volumen y entender
   sus reglas. Un VPS tiene un disco y punto.
2. **El dominio ya está en Hostinger.** Añadir el subdominio es un registro DNS en el
   panel donde ya entras, no una delegación entre dos proveedores.
3. **Ya le pagas a Hostinger.** Pagar a una plataforma de EE. UU. con tarjeta desde
   Venezuela es un problema recurrente, y no es un problema que convenga tener entre tú
   y tu propio sistema.

Lo que cuesta a cambio: el VPS lo mantienes tú. Es poco —Docker se encarga de casi
todo y el certificado se renueva solo— pero no es cero. El plan más pequeño de Hostinger
(1 vCPU, 4 GB) sobra para quince personas y una operadora.

> **No toco nada del sitio actual.** `grupoprimesupply.com`, su `public_html` y el portal
> `/track/` se quedan donde están. Esto es una máquina nueva y un subdominio nuevo.

## Lo que tienes que hacer tú

Cinco cosas. Ninguna lleva más de diez minutos.

### 1. El VPS

En el panel de Hostinger, **VPS → crear**. Plan KVM 1 o 2, **Ubuntu 24.04 con Docker**
si lo ofrecen (si no, Ubuntu 24.04 limpio y luego un comando). Apunta la **IP** que te dé
y la **clave de root** que te pida.

### 2. El DNS

En Hostinger, **Dominios → grupoprimesupply.com → DNS**. Añade:

| Tipo | Nombre  | Apunta a        | TTL  |
|------|---------|-----------------|------|
| A    | `nexus` | la IP del VPS   | 300  |

Tarda entre un minuto y media hora. Para comprobarlo: `ping nexus.grupoprimesupply.com`
tiene que contestar con esa IP. **Hasta que el DNS funcione, Caddy no puede sacar el
certificado**, así que esto va antes de arrancar.

### 3. Entrar al servidor y traer el código

```
ssh root@LA-IP-DEL-VPS

# Si el VPS no venía con Docker:
curl -fsSL https://get.docker.com | sh

apt update && apt install -y git
git clone -b claude/gps-web-tracking-contracts-z715gi \
  https://github.com/acalzadillaruiz/docs /opt/nexus
cd /opt/nexus/nexus/despliegue
```

### 4. La configuración

```
cp env.ejemplo .env
openssl rand -base64 32        # copia el resultado
nano .env
```

Rellena dos cosas y deja el resto como está:

- `DOMINIO=nexus.grupoprimesupply.com`
- `BD_CLAVE=` el resultado de `openssl rand`

`PERSONA_SERVICIO` se queda vacío por ahora: lo da el paso siguiente.

### 5. Arrancar, y crear tu cuenta

Primero la base de datos y el esquema, que es lo único que no necesita esa variable:

```
docker compose up -d bd
docker compose run --rm esquema
```

Eso carga las 35 piezas del esquema. Después, tu cuenta:

```
docker compose run --rm --entrypoint sh app -c \
  'NEXUS_BASE=https://nexus.grupoprimesupply.com node --experimental-strip-types \
   herramientas/instalar.ts "GPS Supply" J-30123456-7 tu.correo@grupoprimesupply.com "Tu Nombre"'
```

Con **tu RIF de verdad**, tu correo y tu nombre. Imprime dos cosas:

- Un `NEXUS_PERSONA_SERVICIO=…` → **pégalo en `.env`**, en `PERSONA_SERVICIO=`.
- Un **enlace de alta** → guárdalo, es con lo que entras la primera vez.

Y ya:

```
docker compose up -d
```

Abre el enlace de alta. Eliges tu clave, y te da tu segundo factor y tus diez códigos de
recuperación **una sola vez**: apúntalos en papel entonces. Desde dentro, en *Personas y
accesos*, invitas a los demás.

## Los respaldos, el mismo día

No después. Un sistema con datos de verdad y sin respaldo es una avería esperando fecha.

```
crontab -e
```

Y añade:

```
17 3 * * * cd /opt/nexus/nexus/despliegue && ./respaldar.sh >> respaldos/log 2>&1
```

Guarda la base y los documentos, y tira lo que pase de catorce días. **Restaura uno a
mano el primer día**, en una base de prueba: el script imprime la orden exacta al
terminar. Un respaldo que nadie ha restaurado nunca no es un respaldo.

## Actualizar, cuando haya cosas nuevas

```
cd /opt/nexus && git pull && cd nexus/despliegue && docker compose up -d --build
```

El esquema se pone al día él solo: el migrador aplica lo nuevo y no repite lo aplicado.
Si algún archivo de esquema ya aplicado hubiera cambiado, se **para y lo dice** en vez de
dejar el servidor con un esquema distinto del que dice el repositorio.

## Lo que está probado y lo que no

Conviene que quede claro, porque la diferencia es donde aparecen los problemas.

**Probado de verdad, en esta sesión:**

- El migrador, contra un PostgreSQL con datos: aplica los 35 archivos, la segunda pasada
  no hace nada, y si un archivo aplicado cambia se para con su explicación.
- `instalar.ts` sobre una base recién creada, y después el circuito entero por HTTP:
  abrir el enlace de alta sin sesión, crear la cuenta, recibir el secreto del segundo
  factor y los diez códigos, entrar con clave y código, abrir la cartera y llegar a
  *Personas y accesos*. Y que **la cuenta de servicio no puede entrar**.
- Que las rutas del diccionario y del esquema resuelven con la disposición de archivos
  que usa la imagen — recreada en un directorio aparte y ejecutada ahí.
- Que `compose.yml` es YAML válido y que exige `DOMINIO`, `BD_CLAVE` y
  `PERSONA_SERVICIO` con un mensaje que dice cuál falta.

**Escrito con cuidado y NO ejecutado**, porque en esta máquina hay cliente de Docker pero
no demonio: construir la imagen, `docker compose up`, y que Caddy saque el certificado.
Ahí es donde puede aparecer algo, y son las tres cosas que miraremos juntos cuando
arranques. Si algo falla, `docker compose logs -f` lo dice y lo arreglo.

## Lo que queda pendiente y no es de programación

- **El correo.** Sin `SMTP` en `.env`, los avisos se escriben en el registro en vez de
  enviarse y todo lo demás funciona. Para que salgan de verdad hace falta una cuenta de
  envío; la de Hostinger sirve.
- **La entrada con la cuenta de Microsoft o Google.** Sin configurar, esa opción no se
  ofrece y se entra con clave y código. Requiere registrar la aplicación en el panel de
  Microsoft o Google, con la dirección de vuelta
  `https://nexus.grupoprimesupply.com/entrar/empresa/vuelta`.
- **Quién entra.** Hoy solo GPS. Cuando quieras dar acceso a la gente de una operadora,
  se crea su empresa y se la invita desde *Personas y accesos*: ve lo suyo y nada más, y
  eso está sujeto por la base de datos, no por las pantallas.
