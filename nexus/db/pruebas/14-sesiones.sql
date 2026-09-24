-- GPS Nexus · bloqueo por intentos, codigos de recuperacion y sesiones.
--
-- Lo que de verdad se comprueba aqui: que nadie pueda dejar fuera al gerente de la
-- operadora fallando seis veces contra su correo. Ese es el ataque que vuelve el
-- bloqueo por cuenta en un arma, y el motivo de que aqui se cuente por pareja.

\set ON_ERROR_STOP on
\set org '''0a0b0c0d-0000-0000-0000-00000000000a'''
\set yo  '''0a0b0c0d-0000-0000-0000-00000000000d'''

insert into organizacion (id, tipo, nombre, rif) values (:org,'gps','GPS Energy','J-000000000-0');
insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
values (:yo, :org,'gerente@ejemplo.test','Gerente','clave_2fa','(h)','(s)');

-- ============================================================ sin intentos, se pasa
select case when espera_requerida('gerente@ejemplo.test','origen-A') = 0
            then 'OK · sin intentos previos no hay espera'
            else 'FALLO' end as resultado;

-- ============================================================ el atacante se frena
select anotar_intento('gerente@ejemplo.test','atacante', false,'clave')
  from generate_series(1,3);

select case when espera_requerida('gerente@ejemplo.test','atacante') > 0
            then 'OK · tras tres fallos, ese origen espera ' ||
                 espera_requerida('gerente@ejemplo.test','atacante')::text || ' s'
            else 'FALLO · no frenó al atacante' end as resultado;

-- ============================================================ y el dueño NO
-- Esta es la prueba que importa. El atacante lleva tres fallos contra este correo;
-- el dueño, desde su propio sitio, tiene que poder entrar igual.
select case when espera_requerida('gerente@ejemplo.test','el-movil-del-gerente') = 0
            then 'OK · el dueño entra igual: el atacante se bloqueó a sí mismo'
            else 'FALLO · un tercero dejó fuera al dueño de la cuenta' end as resultado;

-- La espera crece con cada fallo, pero tiene techo.
select anotar_intento('gerente@ejemplo.test','atacante', false,'clave')
  from generate_series(1,20);
select case when espera_requerida('gerente@ejemplo.test','atacante') = 300
            then 'OK · la espera crece pero tiene techo: 300 s'
            else 'FALLO · espera ' || espera_requerida('gerente@ejemplo.test','atacante')::text end as resultado;

-- Un acierto borra la cuenta de fallos de esa pareja.
select anotar_intento('gerente@ejemplo.test','atacante', true,'clave');
select case when espera_requerida('gerente@ejemplo.test','atacante') = 0
            then 'OK · un acierto pone el contador a cero'
            else 'FALLO' end as resultado;

-- ============================================================ ataque repartido
-- Diez orígenes distintos fallando contra la misma cuenta ya no es alguien
-- molestando: se frena la cuenta, pero con espera, no con un cierre.
select anotar_intento('gerente@ejemplo.test','red-' || g, false,'clave')
  from generate_series(1,10) g;
select case when espera_requerida('gerente@ejemplo.test','uno-nuevo') = 60
            then 'OK · diez orígenes a la vez frenan la cuenta, con espera y no con cierre'
            else 'FALLO · dio ' || espera_requerida('gerente@ejemplo.test','uno-nuevo')::text end as resultado;

-- ============================================================ códigos de recuperación
insert into codigo_recuperacion (persona_id, huella) values
 (:yo,'huella-1'), (:yo,'huella-2'), (:yo,'huella-3');

select case when codigos_vivos(:yo) = 3 then 'OK · tres códigos vivos'
            else 'FALLO' end as resultado;

select case when gastar_codigo(:yo,'huella-2','el-movil') then 'OK · el código se gasta'
            else 'FALLO' end as resultado;

select case when not gastar_codigo(:yo,'huella-2','otro-sitio')
            then 'OK · el mismo código no se puede gastar dos veces'
            else 'FALLO · se gastó dos veces' end as resultado;

select case when codigos_vivos(:yo) = 2 then 'OK · quedan dos vivos'
            else 'FALLO' end as resultado;

-- El código gastado se queda, con constancia de cuándo y desde dónde.
select case when gastado_en is not null and gastado_desde = 'el-movil'
            then 'OK · el código gastado no se borra: queda cuándo y desde dónde'
            else 'FALLO' end as resultado
  from codigo_recuperacion where persona_id = :yo and huella = 'huella-2';

select case when not gastar_codigo(:yo,'huella-inventada','x')
            then 'OK · un código que no existe no vale'
            else 'FALLO' end as resultado;

-- ============================================================ sesiones
insert into sesion (id, persona_id, huella, dispositivo, expira_en) values
 ('0a0b0c0d-1111-0000-0000-000000000001', :yo,'testigo-1','iPhone', now() + interval '8 hours'),
 ('0a0b0c0d-1111-0000-0000-000000000002', :yo,'testigo-2','Portátil', now() - interval '1 hour');

select case when caducar_sesiones() = 1 then 'OK · se cierra la sesión caducada y solo esa'
            else 'FALLO' end as resultado;

select case when count(*) = 1 then 'OK · queda una sesión abierta'
            else 'FALLO · quedan ' || count(*)::text end as resultado
  from sesion where persona_id = :yo and cerrada_en is null;

-- ============================================================ la baja cierra la sesión
-- Es la mitad que hace útil entrar con la cuenta de la empresa: sin esto, el
-- empleado dado de baja seguiría dentro con la sesión que ya tenía abierta.
update persona set activa = false where id = :yo;

select case when count(*) = 0
            then 'OK · al dar de baja a la persona, sus sesiones se cierran solas'
            else 'FALLO · le quedan ' || count(*)::text || ' sesiones abiertas' end as resultado
  from sesion where persona_id = :yo and cerrada_en is null;

select case when motivo_cierre = 'persona desactivada'
            then 'OK · y queda escrito por qué se cerró'
            else 'FALLO' end as resultado
  from sesion where id = '0a0b0c0d-1111-0000-0000-000000000001';
