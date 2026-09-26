/**
 * Sembrar una empresa de muestra, con contabilidad completa.
 *
 * Existe porque hacía falta tres veces en un día: para medir cuánto tardan las
 * pantallas con datos de verdad, para sacarles capturas, y para exportar la
 * instantánea navegable. Las tres veces la escribí suelta y las tres veces se la
 * llevó por delante la recarga del esquema.
 *
 * NO es para producción. Crea una organización con un identificador fijo y datos
 * inventados, y lo dice en el nombre: si aparece «Muestra» en un sistema de verdad,
 * alguien ejecutó esto donde no debía.
 *
 *   node --experimental-strip-types herramientas/sembrar.ts
 */

import { conectar, cerrar, comoPersona, type Consulta } from '../src/db/conexion.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { loQueFalta } from '../src/dominio/fiscales.ts'
import { facturar } from '../src/dominio/valuar.ts'
import { registrarCobro } from '../src/dominio/cobrar.ts'
import {
  cargar, guardarMapeo, validar, confirmar, proponerMapeo,
} from '../src/dominio/importar.ts'

const PROV = 'c8d9e0f1-0000-0000-0000-00000000000f'

export const MUESTRA = {
  org: 'c8d9e0f1-0000-0000-0000-00000000000a',
  cliente: 'c8d9e0f1-0000-0000-0000-00000000000b',
  persona: 'c8d9e0f1-0000-0000-0000-00000000000d',
  correo: 'muestra@prueba.test',
  /**
   * Y una persona de la OPERADORA, con la misma clave y el mismo segundo factor.
   *
   * Sin ella, la mitad del producto no se podia ni ver: el portal del cliente —lo que ve
   * alguien de la operadora cuando entra— no salia en el recorrido navegable porque no habia
   * con quien entrar. Lleva las mismas credenciales de muestra a proposito: son las que estan
   * escritas en el repositorio a la vista, y eso es correcto para una cuenta de muestra y
   * seria un agujero para una de verdad.
   */
  correoCliente: 'muestra-cliente@prueba.test',
  personaCliente: 'c8d9e0f1-0000-0000-0000-00000000000e',
  clave: 'una clave razonable',
  secreto: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  anio: 2027,
  mes: 3,
} as const

export async function sembrar(): Promise<void> {
  const { org: G, cliente: C, persona: YO } = MUESTRA
  const hash = await cifrarClave(MUESTRA.clave)

  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Supply · Muestra','J-904100000-0'),
        ('${C}','operadora','Petrolera del Lago · Muestra','J-904200000-0')
        on conflict (id) do update set nombre = excluded.nombre;`)

    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G}, ${MUESTRA.correo},'Dirección','clave_2fa',
                    ${hash}, ${MUESTRA.secreto})
            on conflict (id) do update set clave_hash = excluded.clave_hash,
              totp_secreto = excluded.totp_secreto`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${MUESTRA.personaCliente}, ${C}, ${MUESTRA.correoCliente},
                    'Ing. de la operadora','clave_2fa', ${hash}, ${MUESTRA.secreto})
            on conflict (id) do update set clave_hash = excluded.clave_hash,
              totp_secreto = excluded.totp_secreto, activa = true`

    // La tasa lleva un índice PARCIAL (solo las no sustituidas), así que la cláusula
    // de conflicto no puede deducirlo: se inserta solo si no hay ninguna ese día.
    await q.unsafe(`
      insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
      select '2027-03-01'::date, 70.00,'carga_manual'
       where not exists (select 1 from tasa_bcv
                          where vigente_el = '2027-03-01' and sustituida_por is null);
      -- Y una de enero, para el balance de apertura: el asiento de apertura lleva su
      -- columna en divisas y la convierte a la tasa vigente en la fecha de corte. Sin una
      -- tasa de enero o anterior, la apertura de la muestra no se podía cargar.
      insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
      select '2027-01-01'::date, 38.00,'carga_manual'
       where not exists (select 1 from tasa_bcv
                          where vigente_el = '2027-01-01' and sustituida_por is null);
      -- Y una para HOY. El escenario de la muestra es de marzo de 2027, que es FUTURO, y
      -- todo lo que se emite busca la tasa con vigente_el <= current_date: sin esta
      -- fila, en la base de muestra no se podia emitir ni una valuacion —«no hay tasa del
      -- BCV publicada todavia para hoy»— mientras COMO-CORRERLO.md decia que si se podia.
      -- Comprobado llamando a emitir antes y despues.
      insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
      select current_date, 70.00,'carga_manual'
       where not exists (select 1 from tasa_bcv
                          where vigente_el = current_date and sustituida_por is null);
      insert into alicuota_iva (clase, porcentaje, vigente_desde)
        values ('general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      -- El IGTF. No lo sembraba NADIE: ni el esquema ni este archivo, y la unica fila que
      -- habia en la base de pruebas la habia dejado commiteada el fixture de alguna
      -- prueba. Sin ella, calcular_igtf levanta excepcion y un cobro en divisa se cae
      -- con un error de base de datos. Lo encontro el repaso que el propio sembrador se
      -- hace ahora al terminar.
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00)
        on conflict (vigente_desde) do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      select marcar_monetarias('${G}');
      insert into periodo (organizacion_id, anio, mes)
        select '${G}', 2027, m from generate_series(1,12) m on conflict do nothing;`)

    const [t] = (await q`
      select id from tasa_bcv where vigente_el = '2027-03-01' and sustituida_por is null
    `) as unknown as Array<{ id: string }>
    const TASA = t!.id

    const [n] = (await q`
      select count(*)::int as n from contrato where organizacion_id = ${G}::uuid
    `) as unknown as Array<{ n: number }>
    // Si ya hay contratos de la muestra, el resto ya esta hecho y no se repite.
    //
    // Este freno decia `>= 40` y este archivo siembra QUINCE, asi que nunca frenaba:
    // sembrar dos veces reventaba con «duplicate key ... GPS-2027-001». Pasaba
    // desapercibido porque quien siembra dos veces suele hacerlo con la salida
    // redirigida — yo mismo dí por bueno un `on conflict` mirando una segunda pasada que
    // en realidad se habia caido, con el `2>&1` tapandolo.
    if (Number(n?.n ?? 0) > 0) return

    await q.unsafe(`
      insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
      select '${G}'::uuid,'${C}'::uuid,'GPS-2027-'||lpad(i::text,3,'0'),
             (array['procura','servicio','transporte','alquiler','reacondicionamiento'])[1+(i%5)]::tipo_contrato,
             (array['Suministro de cabezales','Cuadrilla de mantenimiento','Transporte de crudo',
                    'Alquiler de bomba de lodo','Reacondicionamiento de pozo'])[1+(i%5)]||' · Pozo '||i,
             'Contract '||i,'vigente','VES', 3000000 + i*450000,'${TASA}'::uuid,'${YO}'::uuid
        -- Catorce, no cuarenta: tres de cada uno de los cinco tipos de contrato mas
        -- el detallado de abajo. Cuarenta filas casi identicas no ensenaban nada que
        -- no ensenen catorce, y cada una arrastra su valuacion, su cobro y sus cuatro
        -- renglones — doscientas paginas mas en la instantanea navegable.
        from generate_series(1,14) i;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en, cantidad,
                           unidad, precio_unitario, costo_unitario)
      select c.id, r,
             (array['Cabezal 11 pulgadas 5M','Válvula de compuerta','Brida ciega',
                    'Movilización y desmovilización'])[r],
             'Item '||r, 12,'ud', 62500, 41000
        from contrato c cross join generate_series(1,4) r
       where c.organizacion_id = '${G}';

      -- Y sus hitos, desde la plantilla del tipo de contrato.
      --
      -- Sin esto, de los 162 renglones de la muestra solo DOS se podian abrir: la
      -- pantalla donde vive la tesis del producto —el avance sale de los hitos
      -- verificados, no de una casilla— era la menos visitable de todas.
      --
      -- Se dejan a proposito los del ultimo contrato sin hitos, porque es lo que el
      -- bloque «a que renglones se les olvido crear los hitos» de /medidas existe para
      -- senalar, y un cuadro de mando que nunca tiene nada que decir no se mira.
      select crear_hitos_desde_plantilla(rg.id)
        from renglon rg join contrato c on c.id = rg.contrato_id
       where c.organizacion_id = '${G}'
         and c.codigo <> 'GPS-2027-014';

      -- Los dos primeros hitos de cada renglon, ya ocurridos: el primero CON su papel
      -- verificado y el segundo declarado SIN papel. Es la diferencia que el producto
      -- entero existe para ensenar —la barra verde y la rayada— y con todo pendiente
      -- no se ve en ninguna pantalla.
      update hito h set estado = 'declarado',
                        ocurrido_en = '2027-03-01'::date + (h.orden * 3)
        from renglon rg join contrato c on c.id = rg.contrato_id
       where h.renglon_id = rg.id and c.organizacion_id = '${G}'
         and c.codigo <> 'GPS-2027-014' and h.orden <= 2;

      -- El papel PRIMERO, y verificado. Poner el hito en 'verificado' sin su evidencia
      -- no se puede: lo impide el disparador 'hito_exige_su_evidencia', y eso es la
      -- tesis del producto hecha cerradura. Me paro aqui la primera vez que sembre
      -- esto, y esta bien que me parara.
      insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime,
                             subida_por, ocurrido_en, verificada_en, verificada_por)
      select h.id, c, encode(sha256((h.id::text || c::text)::bytea),'hex'),
             'muestra-'||c::text||'.pdf', 24000,'application/pdf','${YO}'::uuid,
             h.ocurrido_en, now(),'${YO}'::uuid
        from hito h
        join renglon rg on rg.id = h.renglon_id
        join contrato ct on ct.id = rg.contrato_id
        cross join unnest(h.exige) c
       where ct.organizacion_id = '${G}' and ct.codigo <> 'GPS-2027-040'
         and h.orden = 1
      on conflict do nothing;

      update hito h set estado = 'verificado'
        from renglon rg join contrato c on c.id = rg.contrato_id
       where h.renglon_id = rg.id and c.organizacion_id = '${G}'
         and c.codigo <> 'GPS-2027-014' and h.orden = 1;

      insert into valuacion (organizacion_id, contrato_id, numero, periodo_desde,
                             periodo_hasta, obra, moneda, tasa_id, amortiza_pct,
                             garantia_pct, alicuota_iva_id, concepto_islr, ret_iva_pct,
                             estado, aprobada_el, aprobada_por, creada_por)
      select '${G}'::uuid, c.id, 1,'2027-03-01'::date,'2027-03-31'::date,
             round((c.monto * (0.25 + (row_number() over (order by c.codigo) % 7) * 0.09))::numeric, 2),
             'VES','${TASA}'::uuid, 0, 5,
             (select id from alicuota_iva where clase = 'general' limit 1),
             'SERV-PJ', 75,'aprobada', current_date - 12,'${YO}'::uuid,'${YO}'::uuid
        from contrato c where c.organizacion_id = '${G}';

      -- Una SEGUNDA valuacion para tres contratos, en los tres estados que le esperan al
      -- cliente. Sin esto su bandeja salia vacia en la instantanea y lo que se ve del portal
      -- del cliente es una lista de contratos y nada mas — que es justo lo que hace que un
      -- portal no se use. Y catorce valuaciones todas aprobadas no se parecen a ninguna
      -- cartera de verdad: en una de verdad siempre hay una esperando firma y otra discutida.
      -- No llevan asiento a proposito: una valuacion que el cliente no ha aprobado todavia no
      -- es un ingreso, y asentarla seria contar por ganado lo que aun se discute.
      insert into valuacion (organizacion_id, contrato_id, numero, periodo_desde,
                             periodo_hasta, obra, moneda, tasa_id, amortiza_pct,
                             garantia_pct, alicuota_iva_id, concepto_islr, ret_iva_pct,
                             estado, presentada_el, creada_por)
      select '${G}'::uuid, c.id, 2,'2027-04-01'::date,'2027-04-30'::date,
             round((c.monto * 0.18)::numeric, 2),
             'VES','${TASA}'::uuid, 0, 5,
             (select id from alicuota_iva where clase = 'general' limit 1),
             'SERV-PJ', 75,
             (case c.codigo when 'GPS-2027-002' then 'presentada'
                            else 'objetada' end)::estado_valuacion,
             current_date - (case c.codigo when 'GPS-2027-002' then 3
                                           when 'GPS-2027-005' then 18
                                           else 26 end),
             '${YO}'::uuid
        from contrato c
       where c.organizacion_id = '${G}'
         and c.codigo in ('GPS-2027-002','GPS-2027-005','GPS-2027-009');

      -- La del 005 lleva una objecion SIN contestar: es lo que GPS le debe al cliente.
      insert into objecion (valuacion_id, persona_id, motivo, objetada_en)
      select v.id, '${MUESTRA.personaCliente}'::uuid,
             'El renglon 2 incluye 14 horas de grua que no vimos en locacion el dia 12.',
             now() - interval '16 days'
        from valuacion v join contrato c on c.id = v.contrato_id
       where c.codigo = 'GPS-2027-005' and v.numero = 2
         and not exists (select 1 from objecion o where o.valuacion_id = v.id);

      -- Y la del 009 la tiene contestada: la pelota vuelve al campo del cliente.
      insert into objecion (valuacion_id, persona_id, motivo, objetada_en,
                            respuesta, respondida_en, respondida_por)
      select v.id, '${MUESTRA.personaCliente}'::uuid,
             'Falta el acta de recepcion del tramo 3.', now() - interval '24 days',
             'Adjuntada el acta firmada por el supervisor de campo el dia 19.',
             now() - interval '6 days', '${YO}'::uuid
        from valuacion v join contrato c on c.id = v.contrato_id
       where c.codigo = 'GPS-2027-009' and v.numero = 2
         and not exists (select 1 from objecion o where o.valuacion_id = v.id);

      insert into asiento (organizacion_id, numero, ocurrido_en, anio, mes, descripcion_es,
                           descripcion_en, origen_tipo, origen_id, creado_por)
      select '${G}'::uuid, siguiente_asiento('${G}') + (row_number() over (order by c.codigo)) - 1,
             make_date(2027, 3, 1 + ((row_number() over (order by c.codigo))::int % 27)),
             2027, 3,'Costo de obra · '||c.codigo,'Job cost','factura_proveedor',
             gen_random_uuid(),'${YO}'::uuid
        from contrato c where c.organizacion_id = '${G}';`)

    await q.unsafe(`
      with pares as (
        select a.id aid, c.id cid, round((c.monto * 0.17)::numeric, 2) importe
          from asiento a
          join contrato c on c.organizacion_id = '${G}'
                         and a.descripcion_es = 'Costo de obra · '||c.codigo
         where a.organizacion_id = '${G}'
      )
      insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd,
                           tasa_id, contrato_id)
      select aid, 1,'${G}'::uuid,'5.2.01', importe, round(importe/70, 2),'${TASA}'::uuid, cid from pares
      union all
      select aid, 2,'${G}'::uuid,'2.1.01.01', -importe, -round(importe/70, 2),'${TASA}'::uuid, null::uuid from pares;

      -- AQUÍ ESTABAN CUARENTA ASIENTOS ESCRITOS A MANO, y veintiséis de ellos vacíos.
      --
      -- Se llamaban «Valuación aprobada · GPS-2027-020» y siguientes: nombres de
      -- contratos que no existen, porque este archivo pasó de sembrar cuarenta contratos
      -- a sembrar catorce y el generate_series(0, 39) se quedó. Las partidas se metían
      -- aparte, cruzando por el nombre, así que solo catorce las recibieron. Los otros
      -- veintiséis quedaron con su número correlativo, su fecha y ninguna línea dentro,
      -- **en la pantalla del libro diario** — la pantalla con la que se enseña la fase que
      -- va primera.
      --
      -- Y la contabilidad no los rechazó, porque el cuadre es un disparador sobre la
      -- tabla de partidas: sin ninguna partida no se ejecuta nunca. Eso ya está cerrado
      -- en db/schema/39-asiento-sin-lineas.sql, y ese archivo existe por esto.
      --
      -- Los catorce que quedan arriba son los de COSTO, porque representan facturas de
      -- proveedor que en la muestra no se cargan por el importador. Los de la venta no:
      -- los escribe la aplicación, abajo, al facturar. Un sembrador que escribe el asiento
      -- de una venta a mano está haciendo lo que la aplicación no hace, y lo que se mira
      -- después en el libro ya no prueba que la aplicación sepa hacerlo.`)

  })

  // FACTURAR Y COBRAR, por el camino de la aplicación.
  //
  // La muestra se paraba en «aprobada». Todo lo que viene después existe, está probado y
  // no se había visto nunca: el libro de ventas salía vacío —«no hay ninguna factura de
  // ese mes»—, el estado de cuenta del cliente enseñaba su columna de número de control
  // en blanco en las diecisiete líneas, y las pantallas de cobrar no tenían nunca nada
  // que cobrar. Media contabilidad sin una sola pantalla que la enseñara.
  //
  // Se hace llamando a `facturar()` y a `registrarCobro()`, que son las mismas funciones
  // que llaman los botones. No a mano: si el sembrador emitiera la factura por su cuenta,
  // la muestra enseñaría números que la aplicación no sabe producir, y es exactamente el
  // error que acaba de costar veintiséis asientos vacíos.
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    const pendientes = (await q`
      select v.id, c.codigo, neto_valuacion(v.id)::text as neto
        from valuacion v join contrato c on c.id = v.contrato_id
       where v.organizacion_id = ${G}::uuid and v.numero = 1 and v.estado = 'aprobada'
       order by c.codigo
    `) as unknown as Array<{ id: string; codigo: string; neto: string }>

    for (const [i, v] of pendientes.entries()) {
      const f = await facturar(q, v.id, YO, false, 'es')
      if (!f.hecho) {
        console.log(`  no se pudo facturar ${v.codigo}: ${f.motivo}`)
        continue
      }

      // Y el cobro. No todas, y a propósito: una cartera donde todo está cobrado no se
      // parece a ninguna. Cinco cobradas del todo, dos a medias —que es el caso que hace
      // falta para que «saldo» signifique algo— y el resto facturadas y esperando.
      //
      // La fecha va en abril de 2027 porque el cobro se asienta en el mes de su fecha y
      // ese mes tiene que estar ABIERTO. Con la fecha de hoy, `registrarCobro` se niega
      // —bien— porque el escenario de la muestra vive en 2027 y solo esos meses se abren.
      const cuanto = i < 5 ? Number(v.neto) : i < 7 ? Math.round(Number(v.neto) * 0.4) : 0
      if (cuanto <= 0) continue
      const r = await registrarCobro(q, {
        valuacionId: v.id,
        fecha: `2027-04-${String(6 + i).padStart(2, '0')}`,
        medio: i % 3 === 0 ? 'transferencia' : i % 3 === 1 ? 'cheque' : 'compensacion',
        monto: cuanto,
        referencia: `REF-${v.codigo.slice(-3)}-${i}`,
      }, YO, G, 'es')
      if (!r.hecho) console.log(`  no se pudo cobrar ${v.codigo}: ${r.errores.join(' · ')}`)
    }
  })

  // EL BALANCE DE APERTURA, por la misma puerta que lo haría una empresa de verdad.
  //
  // La muestra empezaba de cero: sin capital, y con el banco en NEGATIVO en cuanto se abría
  // la caja chica. Se veía en la instantánea: «Capital social» no aparecía en ninguna parte
  // del balance, y el banco salía en −400.000. Una empresa así no existe, y un balance así
  // no se le enseña a nadie.
  //
  // Se carga con `cargar`/`validar`/`confirmar`, que es lo que llama la pantalla, y no
  // insertando el asiento a mano. Dos razones: la primera es que escribirlo a mano volvería
  // a ser el sembrador haciendo lo que la aplicación no hace —y esta noche eso ha costado
  // veintiséis asientos vacíos y un botón de facturar que no funcionaba—; la segunda es que
  // así la muestra PRUEBA que el camino del importador funciona de punta a punta.
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    const [ya] = (await q`
      select count(*)::int as n from lote_importacion
       where organizacion_id = ${G}::uuid and destino = 'saldos_iniciales'
         and estado = 'confirmado'
    `) as unknown as Array<{ n: number }>
    if (Number(ya?.n ?? 0) > 0) return

    // Una hoja como la que da cualquier sistema contable: cuenta, debe, haber. Cuadra
    // —30.000.000 en el banco contra 30.000.000 de capital—, y si no cuadrara el propio
    // importador se negaría diciendo por cuánto.
    const filas = [
      'Codigo;Debe;Haber',
      '1.1.01.02;30000000,00;',
      '3.1.01;;30000000,00',
    ].join('\n')
    const r = await cargar(q, G, YO, 'apertura-muestra.csv',
      new TextEncoder().encode(filas), 'saldos_iniciales', '2027-01-31')
    await guardarMapeo(q, r.loteId, proponerMapeo(r.cabeceras, r.muestras, 'saldos_iniciales'))
    const v = await validar(q, r.loteId)
    if (v.malas > 0) {
      console.log(`  la apertura de la muestra no validó: ${JSON.stringify(v.errores)}`)
      return
    }
    const c = await confirmar(q, r.loteId, YO, 'es')
    if (!c.hecho) console.log(`  no se pudo cargar la apertura: ${c.motivo}`)
  })

  // Material en ruta: un contrato de procura con sus hitos a medio camino. Sin esto
  // el tablero de «dónde está el material» sale vacío, y una pantalla vacía no
  // enseña lo único que tiene que enseñar.
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe(`
      do $ruta$
      declare
        ctr uuid;
        rg  uuid;
        tsa uuid;
      begin
        if exists (select 1 from contrato
                    where organizacion_id = '${G}' and codigo = 'GPS-2027-PROC') then
          return;
        end if;
        select id into tsa from tasa_bcv
         where vigente_el = '2027-03-01' and sustituida_por is null;

        insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es,
                              titulo_en, estado, moneda, monto, tasa_id, inicio,
                              fin_previsto, creado_por)
        values ('${G}','${C}','GPS-2027-PROC','procura',
                'Cabezales de pozo 11" 5M','11" 5M wellheads','vigente','USD',
                420000, tsa,'2027-01-15','2027-06-30','${YO}')
        returning id into ctr;

        insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                             cantidad, unidad, norma, precio_unitario, costo_unitario)
        values (ctr, 1,'Cabezal 11" 5M','11" 5M wellhead', 4,'unidad','API 6A PSL-3',
                80000, 51000),
               (ctr, 2,'Árbol de navidad 5M','5M christmas tree', 2,'unidad',
                'API 6A PSL-3', 50000, 33000)
        ;

        insert into hito (renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                          planificada)
        select r.id, p.orden, p.clave, p.nombre_es, p.nombre_en, p.peso, p.exige,
               date '2027-01-15' + (p.orden * 30)
          from renglon r join plantilla_hito p on p.tipo = 'procura'
         where r.contrato_id = ctr;

        -- El primer renglón: pedido y fabricado con su certificado, esperando el
        -- barco desde hace semanas. El segundo, solo pedido.
        select id into rg from renglon where contrato_id = ctr and numero = 1;

        insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime,
                               subida_por, verificada_en, verificada_por)
        select h.id, c, md5(h.id::text || c) || md5(c || h.id::text),
               c || '.pdf', 24000,'application/pdf','${YO}', now(),'${YO}'
          from hito h, unnest(h.exige) c
         where h.renglon_id = rg and h.clave in ('orden','fabricado');

        update hito set estado = 'verificado', ocurrido_en = '2027-02-02'
         where renglon_id = rg and clave = 'orden';
        update hito set estado = 'verificado', ocurrido_en = '2027-02-24'
         where renglon_id = rg and clave = 'fabricado';

        update hito set estado = 'verificado', ocurrido_en = '2027-02-10'
         where renglon_id in (select id from renglon where contrato_id = ctr and numero = 2)
           and clave = 'orden'
           and exists (select 1 from hito h2 where h2.renglon_id = hito.renglon_id
                        and h2.clave = 'orden' and cardinality(h2.exige) = 0);
      end
      $ruta$;`)
  })

  // La caja chica va en su propia transacción y no dentro de la anterior: la de
  // arriba se corta en seco cuando los cuarenta contratos ya están sembrados, y
  // cualquier cosa escrita detrás de ese corte no se siembra nunca. Costó una
  // instantánea con la pantalla de caja vacía darse cuenta.
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    // La caja chica, con sus vales: uno de cada clase. Sin esto la pantalla sale
    // vacía y no se ve lo único que enseña de verdad —lo gastado sin papel— que es
    // la cifra incómoda por la que existe el módulo.
    await q.unsafe(`
      do $sembrar$
      declare
        cja uuid;
        ctr uuid;
      begin
        if exists (select 1 from caja_chica where organizacion_id = '${G}') then return; end if;
        select id into ctr from contrato where organizacion_id = '${G}' order by codigo limit 1;
        cja := abrir_caja('${G}','Caja de campo · Anaco','VES', 400000,
                          '${YO}','2027-03-01','${YO}');
        perform anotar_vale(cja,'2027-03-03','Taxi a la locación', 28000,
                            '5.1.04', ctr,'Transporte Díaz','h-recibo-0031','${YO}');
        perform anotar_vale(cja,'2027-03-06','Soldadura de urgencia en cabezal', 65000,
                            '5.1.01', ctr,'Taller Mendoza','h-recibo-0032','${YO}');
        perform anotar_vale(cja,'2027-03-09','Almuerzo de la cuadrilla', 41000,
                            '5.1.02', ctr,'Doña Rosa', null,'${YO}');
        perform anotar_vale(cja,'2027-03-12','Fletes menores del taller', 33000,
                            '5.1.04', null,'Cooperativa Guanipa','h-recibo-0033','${YO}');
      end
      $sembrar$;`)

    // Dos facturas de proveedor con saldo, para que «lo que toca pagar» no salga
    // vacío: una pantalla de deudas sin deudas no enseña nada de lo que hace.
    await q.unsafe(`
      do $prov$
      declare
        pr  uuid := '${PROV}';
        tsa uuid;
        alq uuid;
      begin
        if exists (select 1 from documento_fiscal
                    where organizacion_id = '${G}' and sentido = 'recibido') then return; end if;
        select id into tsa from tasa_bcv where vigente_el = '2027-03-01' and sustituida_por is null;
        select id into alq from alicuota_iva where clase = 'general'
         order by vigente_desde desc limit 1;
        insert into organizacion (id, tipo, nombre, rif)
          values (pr,'proveedor','Suministros Oriente · Muestra','J-31212121-2')
          on conflict (id) do nothing;
        insert into documento_fiscal (organizacion_id, sentido, tipo, numero, numero_control,
                                      contraparte_id, fecha, base_ves, base_usd,
                                      alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
        values ('${G}','recibido','factura','00004412','01-00044120', pr,'2027-03-05',
                2400000.00, 34285.71, alq, 384000.00, 5485.71, tsa,'${YO}'),
               ('${G}','recibido','factura','00004419','01-00044190', pr,'2027-03-21',
                860000.00, 12285.71, alq, 137600.00, 1965.71, tsa,'${YO}');
      end
      $prov$;`)
  })
}

/**
 * Lo que la muestra NO llega a enseñar.
 *
 * El repaso de valores fiscales de arriba existe porque la muestra no podía emitir nada y
 * nadie se enteraba hasta que lo intentaba. Esto es el mismo repaso un paso más allá: la
 * muestra llegaba hasta «aprobada» y se paraba, así que el libro de ventas salía vacío, el
 * estado de cuenta del cliente no tenía ni un número de control, y las pantallas de cobrar
 * no tenían nada que cobrar — **y nada se ponía rojo.** Una muestra que se para antes de
 * tiempo no avisa: deja pantallas en blanco que se leen como que el producto no las tiene.
 */
async function loQueNoLlega(q: Consulta): Promise<readonly string[]> {
  const [n] = (await q`
    select
      (select count(*)::int from asiento a
        where a.organizacion_id = ${MUESTRA.org}::uuid
          and not exists (select 1 from partida p where p.asiento_id = a.id)) as vacios,
      (select count(*)::int from valuacion
        where organizacion_id = ${MUESTRA.org}::uuid
          and estado in ('facturada','cobrada')) as facturadas,
      (select count(*)::int from valuacion
        where organizacion_id = ${MUESTRA.org}::uuid and estado = 'cobrada') as cobradas,
      (select count(*)::int from valuacion v
        where v.organizacion_id = ${MUESTRA.org}::uuid
          and exists (select 1 from cobro co where co.valuacion_id = v.id)
          and saldo_valuacion(v.id) > 0) as a_medias,
      (select count(*)::int from libro_ventas
        where organizacion_id = ${MUESTRA.org}::uuid) as ventas
  `) as unknown as Array<{
    vacios: number; facturadas: number; cobradas: number; a_medias: number; ventas: number
  }>
  const falta: string[] = []
  // Este primero ya no debería poder pasar —lo prohíbe la base desde
  // db/schema/39-asiento-sin-lineas.sql—, y se comprueba igual: la muestra tuvo
  // veintiséis, y las filas que ya estaban dentro cuando se puso la cerradura siguen
  // dentro. Una cerradura nueva no limpia lo que entró antes de ponerla.
  if (n!.vacios > 0) falta.push(`${n!.vacios} asiento(s) sin ninguna línea en el libro`)
  if (n!.facturadas === 0) falta.push('ninguna valuación facturada: el libro de ventas sale vacío')
  if (n!.ventas === 0) falta.push('el libro de ventas no tiene ni una factura emitida')
  if (n!.cobradas === 0) falta.push('ninguna valuación cobrada: no hay nada en el libro de cobros')
  if (n!.a_medias === 0) {
    falta.push('ningún cobro parcial: sin uno a medias, «saldo» no significa nada en ninguna pantalla')
  }
  return falta
}

// Ejecutada directamente, siembra y se va.
if (import.meta.url === `file://${process.argv[1]}`) {
  conectar(process.env['NEXUS_BD']
    ?? { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
  await sembrar()
  // El sembrador se revisa a si mismo, y no es adorno: la empresa de muestra existia sin
  // tasa del BCV para hoy, y eso no se veia hasta que alguien intentaba emitir una
  // valuacion y leia un error que no decia donde se arreglaba. Si falta algo, se dice
  // aqui, que es donde todavia no cuesta nada.
  const falta = await comoPersona<readonly string[]>(
    { id: MUESTRA.persona }, 'nexus_interno', (q) => loQueFalta(q, 'es'))
  const corto = await comoPersona<readonly string[]>(
    { id: MUESTRA.persona }, 'nexus_interno', (q) => loQueNoLlega(q))
  await cerrar()
  console.log('sembrada la empresa de muestra')
  if (falta.length > 0) {
    console.log('\nPERO FALTAN VALORES FISCALES, y sin ellos no se puede emitir nada:')
    for (const f of falta) console.log(`  · ${f}`)
    console.log('\nSe ponen en /fiscales.')
    process.exitCode = 1
  }
  if (corto.length > 0) {
    console.log('\nY LA MUESTRA SE QUEDA CORTA, así que hay pantallas que saldrán en blanco:')
    for (const f of corto) console.log(`  · ${f}`)
    process.exitCode = 1
  }
}
