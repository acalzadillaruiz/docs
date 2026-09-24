-- GPS Nexus · el plan de cuentas propuesto se instala y sostiene el ciclo completo.
\set ON_ERROR_STOP on
\set org '''ffffffff-0000-0000-0000-00000000000a'''
\set yo  '''ffffffff-0000-0000-0000-00000000000d'''

insert into organizacion (id, tipo, nombre, rif) values
 (:org,'gps','GPS Energy','J-000000000-0'),
 ('ffffffff-0000-0000-0000-00000000000b','operadora','Operadora','J-111111111-1');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'interno@ejemplo.test','Interno','clave_2fa','(h)','(s)');

select instalar_plan_cuentas(:org) as cuentas \gset

select case when :cuentas >= 80 then 'OK · plan de cuentas instalado: ' || :cuentas || ' cuentas'
            else 'FALLO · solo ' || :cuentas || ' cuentas' end as resultado;

-- La jerarquia es coherente: toda cuenta con padre apunta a uno que existe.
select case when count(*) = 0 then 'OK · la jerarquía de cuentas es coherente'
            else 'FALLO · ' || count(*)::text || ' cuenta(s) con padre inexistente' end as resultado
  from cuenta h where h.organizacion_id = :org and h.padre is not null
   and not exists (select 1 from cuenta p
                    where p.organizacion_id = h.organizacion_id and p.codigo = h.padre);

-- Solo las hojas reciben movimiento.
select case when count(*) = 0 then 'OK · ninguna cuenta con hijos es imputable'
            else 'FALLO · ' || count(*)::text || ' cuenta(s) con hijos son imputables' end as resultado
  from cuenta p where p.organizacion_id = :org and p.imputable
   and exists (select 1 from cuenta h
                where h.organizacion_id = p.organizacion_id and h.padre = p.codigo);

-- Todas las cuentas tienen nombre en los dos idiomas, y distintos.
select case when count(*) = 0 then 'OK · todas las cuentas están en los dos idiomas'
            else 'FALLO · ' || count(*)::text || ' cuenta(s) sin traducir' end as resultado
  from cuenta where organizacion_id = :org
   and (nombre_en is null or btrim(nombre_en) = '' or nombre_es = nombre_en);

-- Cada tipo de contrato tiene su cuenta de ingreso, y existe.
select case when count(*) = 5 then 'OK · los cinco tipos de servicio tienen cuenta de ingreso propia'
            else 'FALLO · solo ' || count(*)::text || ' tipos tienen cuenta' end as resultado
  from unnest(enum_range(null::tipo_contrato)) t
  join cuenta c on c.organizacion_id = :org and c.codigo = cuenta_ingreso_de(:org, t);

-- Los conceptos que usan los generadores estan todos mapeados a cuentas reales.
select case when count(*) = 0 then 'OK · todos los conceptos apuntan a cuentas imputables'
            else 'FALLO · ' || count(*)::text || ' concepto(s) mal mapeados' end as resultado
  from mapa_cuenta m
  left join cuenta c on c.organizacion_id = m.organizacion_id and c.codigo = m.cuenta
 where m.organizacion_id = :org and (c.codigo is null or not c.imputable);

-- Instalarlo dos veces no rompe nada.
select instalar_plan_cuentas(:org);
select case when count(*) = 1 then 'OK · instalarlo dos veces no duplica nada'
            else 'FALLO · hay ' || count(*)::text || ' cuentas 1.1.01.01' end as resultado
  from cuenta where organizacion_id = :org and codigo = '1.1.01.01';
