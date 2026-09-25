/**
 * El servidor de red. Es la capa más fina posible a propósito: todo lo que decide
 * algo vive en `rutas.ts`, que se prueba sin abrir un puerto.
 */

import { createServer } from 'node:http'
import { conectar, type Destino } from '../db/conexion.ts'
import { resolver, desdeHttp, escribir, CuerpoDemasiadoGrande, CABECERAS_BASE } from './rutas.ts'
import { configurarAlmacen } from './almacen.ts'
import { MultipartMalFormado, DemasiadoGrande } from './multipart.ts'

const PUERTO = Number(process.env.NEXUS_PUERTO ?? 8080)
const SERVICIO = process.env.NEXUS_PERSONA_SERVICIO
/**
 * La base de datos se puede dar de dos formas, y las dos hacen falta:
 *
 *   NEXUS_BD           una URL postgres://…, para un servidor remoto.
 *   NEXUS_BD_SOCKET    la carpeta del socket de Unix, para una base en la misma
 *                      máquina. Hace falta aparte porque un socket no cabe en una
 *                      URL: no tiene anfitrión ni puerto que poner.
 */
const BD: Destino | undefined = process.env.NEXUS_BD_SOCKET
  ? {
      host: process.env.NEXUS_BD_SOCKET,
      port: Number(process.env.NEXUS_BD_PUERTO ?? 5432),
      database: process.env.NEXUS_BD_NOMBRE ?? 'nexus',
      username: process.env.NEXUS_BD_USUARIO ?? 'nexus',
    }
  : process.env.NEXUS_BD
/**
 * Donde viven los documentos. Se exige expresamente y no se inventa un valor por
 * defecto: un almacen en una carpeta temporal funcionaria en las pruebas y perderia
 * las actas de recepcion el dia que se reinicie la maquina.
 */
const ALMACEN = process.env.NEXUS_ALMACEN

// Solo se sirve sin TLS cuando alguien lo pide expresamente, para desarrollo.
const SEGURO = process.env.NEXUS_INSEGURO !== '1'

if (!SERVICIO || !BD || !ALMACEN) {
  console.error('faltan NEXUS_PERSONA_SERVICIO, NEXUS_ALMACEN y (NEXUS_BD o NEXUS_BD_SOCKET)')
  process.exit(1)
}

conectar(BD)
configurarAlmacen(ALMACEN)

const servidor = createServer(async (req, res) => {
  try {
    const p = await desdeHttp(req)
    escribir(res, await resolver(p, SERVICIO, SEGURO))
  } catch (e) {
    if (e instanceof CuerpoDemasiadoGrande || e instanceof DemasiadoGrande) {
      escribir(res, { codigo: 413, cabeceras: CABECERAS_BASE, cuerpo: '' })
      return
    }
    // Un formulario que no se entiende es culpa de quien lo manda, no del servidor.
    // Devolver 500 lo haria parecer una averia nuestra y llenaria el registro de
    // errores que no lo son.
    if (e instanceof MultipartMalFormado) {
      escribir(res, { codigo: 400, cabeceras: CABECERAS_BASE, cuerpo: '' })
      return
    }
    // Nunca se devuelve el detalle del error al navegador: un mensaje de la base de
    // datos puede llevar dentro nombres de tablas, columnas y hasta valores.
    console.error('error resolviendo la petición:', e)
    escribir(res, { codigo: 500, cabeceras: CABECERAS_BASE, cuerpo: '' })
  }
})

servidor.listen(PUERTO, () => {
  console.log(`GPS Nexus escuchando en el puerto ${PUERTO}${SEGURO ? '' : ' (sin TLS)'}`)
})
