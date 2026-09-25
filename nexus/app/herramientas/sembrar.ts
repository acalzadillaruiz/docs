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

import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cifrarClave } from '../src/dominio/clave.ts'

export const MUESTRA = {
  org: 'c8d9e0f1-0000-0000-0000-00000000000a',
  cliente: 'c8d9e0f1-0000-0000-0000-00000000000b',
  persona: 'c8d9e0f1-0000-0000-0000-00000000000d',
  correo: 'muestra@prueba.test',
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

    // La tasa lleva un índice PARCIAL (solo las no sustituidas), así que la cláusula
    // de conflicto no puede deducirlo: se inserta solo si no hay ninguna ese día.
    await q.unsafe(`
      insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
      select '2027-03-01'::date, 70.00,'carga_manual'
       where not exists (select 1 from tasa_bcv
                          where vigente_el = '2027-03-01' and sustituida_por is null);
      insert into alicuota_iva (clase, porcentaje, vigente_desde)
        values ('general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
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
    if (Number(n.n) >= 40) return

    await q.unsafe(`
      insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
      select '${G}'::uuid,'${C}'::uuid,'GPS-2027-'||lpad(i::text,3,'0'),
             (array['procura','servicio','transporte','alquiler','reacondicionamiento'])[1+(i%5)]::tipo_contrato,
             (array['Suministro de cabezales','Cuadrilla de mantenimiento','Transporte de crudo',
                    'Alquiler de bomba de lodo','Reacondicionamiento de pozo'])[1+(i%5)]||' · Pozo '||i,
             'Contract '||i,'vigente','VES', 3000000 + i*450000,'${TASA}'::uuid,'${YO}'::uuid
        from generate_series(1,40) i;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en, cantidad,
                           unidad, precio_unitario, costo_unitario)
      select c.id, r,
             (array['Cabezal 11 pulgadas 5M','Válvula de compuerta','Brida ciega',
                    'Movilización y desmovilización'])[r],
             'Item '||r, 12,'ud', 62500, 41000
        from contrato c cross join generate_series(1,4) r
       where c.organizacion_id = '${G}';

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

      insert into asiento (organizacion_id, numero, ocurrido_en, anio, mes, descripcion_es,
                           descripcion_en, origen_tipo, origen_id, creado_por)
      select '${G}'::uuid, siguiente_asiento('${G}') + i, make_date(2027, 3, 1 + (i % 28)), 2027, 3,
             'Valuación aprobada · GPS-2027-'||lpad((i+1)::text,3,'0'),'Progress payment',
             'valuacion', gen_random_uuid(),'${YO}'::uuid
        from generate_series(0, 39) i;`)

    await q.unsafe(`
      with v as (
        select a.id aid, vl.obra, c.tipo
          from asiento a
          join contrato c on c.organizacion_id = '${G}'
                         and a.descripcion_es = 'Valuación aprobada · '||c.codigo
          join valuacion vl on vl.contrato_id = c.id
         where a.organizacion_id = '${G}' and a.origen_tipo = 'valuacion'
      )
      insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves, monto_usd, tasa_id)
      select aid, 1,'${G}'::uuid,'1.1.02.01', obra, round(obra/70, 2),'${TASA}'::uuid from v
      union all
      select aid, 2,'${G}'::uuid, cuenta_ingreso_de('${G}', tipo), -obra, -round(obra/70, 2),'${TASA}'::uuid from v;`)

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
  })
}

// Ejecutada directamente, siembra y se va.
if (import.meta.url === `file://${process.argv[1]}`) {
  conectar(process.env['NEXUS_BD']
    ?? { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
  await sembrar()
  await cerrar()
  console.log('sembrada la empresa de muestra')
}
