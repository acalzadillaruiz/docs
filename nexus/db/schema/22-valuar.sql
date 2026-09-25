-- GPS Nexus · de la evidencia al dinero
--
-- Aqui es donde la tesis del proyecto deja de ser una idea bonita y toca la caja:
--
--              SIN EVIDENCIA NO HAY AVANCE, Y SIN AVANCE NO SE FACTURA.
--
-- La obra de una valuacion no se teclea. Sale de los hitos VERIFICADOS que todavia
-- no se han facturado. Tres consecuencias, y las tres son el negocio:
--
--   - No se puede facturar lo que no se puede demostrar. El que quiera cobrar un
--     hito, que traiga el papel.
--   - No se puede facturar dos veces lo mismo. Cada hito se marca con la valuacion
--     que se lo llevo, asi que no depende de que los periodos no se solapen — y se
--     solapan siempre, porque una valuacion se corrige y se vuelve a emitir.
--   - Si un hito se cae despues (se rechaza su evidencia), se ve exactamente que
--     valuacion lo cobro. Hoy eso es una discusion; aqui es una consulta.
--
-- 'origen_obra' ya existia en la tabla con el valor 'hitos_evidenciados' previsto.
-- Hasta ahora ninguna valuacion lo usaba: todas nacian 'carga_manual'.

alter table hito add column if not exists valuacion_id uuid references valuacion(id);

create index if not exists hito_sin_facturar_ix on hito (renglon_id)
  where valuacion_id is null;

/**
 * Que hay por facturar en un contrato a una fecha.
 *
 * Devuelve renglon por renglon: que hitos verificados quedan sin cobrar, cuanto
 * pesan, y cuanto dinero es eso. Lo que no esta verificado NO sale — ni siquiera
 * como aviso, porque un numero que aparece en una propuesta acaba facturandose.
 */
create or replace function por_facturar(
  p_contrato uuid, p_hasta date default current_date
) returns table (
  renglon_id   uuid,
  numero       int,
  descripcion  text,
  peso         numeric(6,2),
  hitos        text[],
  valor        numeric(20,2)
)
language sql stable as $$
  select rg.id, rg.numero, rg.descripcion_es,
         round(sum(h.peso), 2),
         array_agg(h.clave order by h.orden),
         round(sum(h.peso) / 100 * rg.cantidad * rg.precio_unitario, 2)
    from hito h
    join renglon rg on rg.id = h.renglon_id
   where rg.contrato_id = p_contrato
     and h.estado = 'verificado'
     and h.valuacion_id is null
     and (h.ocurrido_en is null or h.ocurrido_en <= p_hasta)
   group by rg.id, rg.numero, rg.descripcion_es, rg.cantidad, rg.precio_unitario
   order by rg.numero
$$;

/**
 * Marca los hitos que se lleva una valuacion.
 *
 * Se llama DESPUES de crear la valuacion y en la misma transaccion. Si se llamara
 * antes no habria a que apuntar, y si se llamara en otra transaccion podria quedar
 * una valuacion cobrando hitos que siguen marcados como pendientes — y entonces la
 * siguiente valuacion los cobraria otra vez.
 */
create or replace function marcar_facturados(
  p_valuacion uuid, p_contrato uuid, p_hasta date
) returns int
language plpgsql security definer as $$
declare n int;
begin
  if not es_interna() then
    raise exception 'facturar es cosa de dentro';
  end if;

  update hito h
     set valuacion_id = p_valuacion
    from renglon rg
   where rg.id = h.renglon_id
     and rg.contrato_id = p_contrato
     and h.estado = 'verificado'
     and h.valuacion_id is null
     and (h.ocurrido_en is null or h.ocurrido_en <= p_hasta);
  get diagnostics n = row_count;
  return n;
end $$;

/**
 * Que valuacion cobro cada hito, y si ese hito sigue en pie.
 *
 * Es la consulta que hoy es una discusion: un hito que se facturo y despues se cayo
 * —porque se rechazo su evidencia— esta cobrado sin respaldo. No se corrige solo, a
 * proposito: lo que ya se facturo se arregla con una nota de credito, no borrando.
 */
create or replace function facturado_sin_respaldo(p_org uuid)
returns table (
  contrato    text,
  valuacion   int,
  hito        text,
  estado      estado_hito,
  valor       numeric(20,2),
  moneda      moneda
)
language sql stable as $$
  select ct.codigo, va.numero, h.clave, h.estado,
         round(h.peso / 100 * rg.cantidad * rg.precio_unitario, 2), ct.moneda
    from hito h
    join renglon rg on rg.id = h.renglon_id
    join contrato ct on ct.id = rg.contrato_id
    join valuacion va on va.id = h.valuacion_id
   where ct.organizacion_id = p_org
     and h.valuacion_id is not null
     and h.estado <> 'verificado'
   order by 5 desc
$$;

-- Si una valuacion se anula, sus hitos vuelven a estar por facturar. Sin esto, anular
-- dejaria la obra bloqueada para siempre: ni cobrada ni cobrable.
create or replace function liberar_hitos_de_valuacion_anulada() returns trigger
language plpgsql security definer as $$
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update hito set valuacion_id = null where valuacion_id = new.id;
  end if;
  return new;
end $$;

create trigger valuacion_anulada_libera
  after update of estado on valuacion
  for each row execute function liberar_hitos_de_valuacion_anulada();
