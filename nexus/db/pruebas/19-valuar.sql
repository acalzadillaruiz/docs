-- GPS Nexus · de la evidencia al dinero.
--
-- Sin evidencia no hay avance, y sin avance no se factura. Lo que se comprueba aqui
-- es que no haya forma de cobrar lo que no se puede demostrar, ni de cobrar dos
-- veces lo mismo.

\set ON_ERROR_STOP on
\set org '''9d0e1f2a-0000-0000-0000-00000000000a'''
\set cli '''9d0e1f2a-0000-0000-0000-00000000000b'''
\set yo  '''9d0e1f2a-0000-0000-0000-00000000000d'''
\set tasa '''9d0e1f2a-1111-0000-0000-00000000000a'''
\set iva '''9d0e1f2a-1111-0000-0000-00000000000b'''
\set ctr '''9d0e1f2a-2222-0000-0000-00000000000a'''
\set rg  '''9d0e1f2a-3333-0000-0000-00000000000a'''
\set v1  '''9d0e1f2a-4444-0000-0000-000000000001'''
\set v2  '''9d0e1f2a-4444-0000-0000-000000000002'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Valuar','J-990000000-0'),
 (:cli,'operadora','Operadora','J-991111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'val@ejemplo.test','Interno','clave_2fa','(h)','(s)');
insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
values (:tasa,'2026-09-13', 36.50,'carga_manual');
insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
values (:iva,'general', 16.00,'2026-01-01') on conflict do nothing;
insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;

-- Renglón de 200.000: 2 unidades a 100.000.
insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                      estado, moneda, monto, tasa_id, creado_por)
values (:ctr, :org, :cli,'VAL-001','procura','Cabezales','Wellheads','vigente','USD',
        200000.00, :tasa, :yo);
insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                     cantidad, unidad, precio_unitario, costo_unitario)
values (:rg, :ctr, 1,'Cabezal','Wellhead', 2,'unidad', 100000.0000, 62000.0000);

insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                  estado, ocurrido_en) values
 ('9d0e1f2a-5555-0000-0000-000000000001', :rg, 1,'orden','Orden','PO', 10.00,'{}',
  'verificado','2026-08-01'),
 ('9d0e1f2a-5555-0000-0000-000000000002', :rg, 2,'fabricado','Fabricado','Made', 30.00,'{}',
  'verificado','2026-08-20'),
 ('9d0e1f2a-5555-0000-0000-000000000003', :rg, 3,'embarcado','Embarcado','Shipped', 25.00,'{}',
  'declarado','2026-09-05'),
 ('9d0e1f2a-5555-0000-0000-000000000004', :rg, 4,'recibido','Recibido','Received', 35.00,'{}',
  'pendiente', null);

select set_config('app.persona_id', :yo, false);

-- ============================================================ solo sale lo verificado
select case when peso = 40.00 and valor = 80000.00
            then 'OK · por facturar salen los 40 puntos verificados: 80.000,00'
            else 'FALLO · peso ' || peso::text || ' valor ' || valor::text end as resultado
  from por_facturar(:ctr);

-- Lo declarado sin evidencia NO aparece, ni como aviso: un número que sale en una
-- propuesta acaba facturándose.
select case when not ('embarcado' = any(hitos))
            then 'OK · lo declarado sin verificar no sale en la propuesta'
            else 'FALLO · salió embarcado' end as resultado
  from por_facturar(:ctr);

-- ============================================================ facturar marca lo cobrado
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, origen_obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                       alicuota_iva_id, concepto_islr, ret_iva_pct, estado, creada_por)
values (:v1, :org, :ctr, 1,'2026-08-01','2026-08-31', 80000.00,'hitos_evidenciados','USD',
        :tasa, 0, 0, :iva,'SERV-PJ', 0,'borrador', :yo);

select case when marcar_facturados(:v1, :ctr,'2026-08-31') = 2
            then 'OK · la valuación se lleva los dos hitos verificados'
            else 'FALLO' end as resultado;

-- ============================================================ no se cobra dos veces
select case when count(*) = 0
            then 'OK · ya no queda nada por facturar: no se cobra dos veces lo mismo'
            else 'FALLO · quedaron ' || count(*)::text || ' renglones' end as resultado
  from por_facturar(:ctr);

-- Y no depende de que los periodos no se solapen, porque se solapan siempre.
select case when count(*) = 0
            then 'OK · tampoco pidiendo un periodo que se solapa con el anterior'
            else 'FALLO' end as resultado
  from por_facturar(:ctr, '2026-12-31');

-- ============================================================ lo nuevo verificado sí sale
update evidencia set verificada_en = now() where hito_id = '9d0e1f2a-5555-0000-0000-000000000003';
update hito set estado = 'verificado' where id = '9d0e1f2a-5555-0000-0000-000000000003';

select case when peso = 25.00 and valor = 50000.00
            then 'OK · lo que se verifica después sí entra en la siguiente valuación'
            else 'FALLO · peso ' || peso::text end as resultado
  from por_facturar(:ctr);

-- ============================================================ anular devuelve la obra
insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                       obra, origen_obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                       alicuota_iva_id, concepto_islr, ret_iva_pct, estado, creada_por)
values (:v2, :org, :ctr, 2,'2026-09-01','2026-09-30', 50000.00,'hitos_evidenciados','USD',
        :tasa, 0, 0, :iva,'SERV-PJ', 0,'borrador', :yo);
select marcar_facturados(:v2, :ctr,'2026-09-30') as _;

select case when count(*) = 0
            then 'OK · tras la segunda valuación tampoco queda nada'
            else 'FALLO' end as resultado
  from por_facturar(:ctr);

update valuacion set estado = 'anulada' where id = :v2;

select case when peso = 25.00
            then 'OK · anular una valuación devuelve su obra a por facturar'
            else 'FALLO · quedó ' || coalesce(peso::text,'nada') end as resultado
  from por_facturar(:ctr);

-- ============================================================ lo cobrado que se cayó se ve
update valuacion set estado = 'borrador' where id = :v2;
select marcar_facturados(:v2, :ctr,'2026-09-30') as _;

-- Se rechaza la evidencia de un hito YA facturado.
update hito set estado = 'declarado' where id = '9d0e1f2a-5555-0000-0000-000000000002';

select case when count(*) = 1 and max(valor) = 60000.00
            then 'OK · un hito facturado que se cayó después se ve, con su importe'
            else 'FALLO · salieron ' || count(*)::text end as resultado
  from facturado_sin_respaldo(:org);

-- Y NO se corrige solo: lo facturado se arregla con una nota de crédito, no borrando.
select case when (select valuacion_id from hito
                   where id = '9d0e1f2a-5555-0000-0000-000000000002') is not null
            then 'OK · el hito caído sigue apuntando a la valuación que lo cobró'
            else 'FALLO · se borró el rastro' end as resultado;

-- ============================================================ facturar es de dentro
do $$
begin
  set local role nexus_cliente;
  perform set_config('app.persona_id','9d0e1f2a-0000-0000-0000-00000000000b', true);
  begin
    perform marcar_facturados('9d0e1f2a-4444-0000-0000-000000000001',
                              '9d0e1f2a-2222-0000-0000-00000000000a', current_date);
    reset role;
    raise exception 'FALLO · un cliente pudo marcar hitos como facturados';
  exception when sqlstate 'P0001' then
    reset role;
    if SQLERRM like 'FALLO%' then raise; end if;
    raise notice 'OK · marcar lo facturado es de dentro, no del cliente';
  end;
end $$;
