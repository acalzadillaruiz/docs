-- GPS Nexus · un contrato que termina tiene que poder terminarse
--
-- `estado_contrato` declara cinco estados desde el primer dia —borrador, vigente,
-- suspendido, cerrado, liquidado— y la aplicacion solo sabia llegar a DOS. `alta.ts` pasa
-- de borrador a vigente y ahi se acaba: nada suspende, nada cierra y nada liquida. Lo
-- encontro un barrido nuevo, de columnas que ni la aplicacion ni el esquema nombran:
-- `contrato.fin_real` no lo escribia nadie.
--
-- Lo que eso significaba en uso:
--
--   · Un contrato terminado se queda VIGENTE para siempre. La cartera enseña los acabados
--     junto a los que estan corriendo y no hay forma de distinguirlos.
--   · `fin_real` nunca tiene valor, asi que «terminamos tarde?» no se puede contestar en
--     un producto que existe para medir la ejecucion de contratos.
--   · Dos pantallas —equipos y caja chica— ya consultan `estado in ('vigente','suspendido')`.
--     Estaban escritas contando con que la suspension existiera.
--   · Y liquidado, que es el finiquito, no se podia alcanzar de ninguna manera.
--
-- Lo que este archivo NO decide, porque no es mio: cuando conviene cerrar un contrato es
-- criterio de GPS. Lo que si se puede sujetar sin inventar politica es la aritmetica: no
-- se liquida un contrato al que todavia se le debe dinero o al que le queda obra
-- verificada sin facturar. Eso no es una opinion, es una resta.

-- El histórico. Un cambio de estado sin motivo escrito es un cambio que dentro de un año
-- nadie sabe explicar, y el estado de un contrato es de lo que se discute con el cliente.
create table if not exists contrato_estado (
  id          uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references contrato(id) on delete cascade,
  de          estado_contrato not null,
  a           estado_contrato not null,
  motivo      text not null,
  -- La fecha real de fin que fijó este paso, cuando lo hizo. Queda aquí además de en el
  -- contrato para que se vea qué fecha se puso cada vez, y no solo la última.
  fin_real    date,
  ocurrido_en timestamptz not null default now(),
  por         uuid not null references persona(id),
  constraint cambio_de_verdad check (de <> a),
  constraint motivo_escrito   check (length(btrim(motivo)) >= 3)
);

-- El nombre lleva `hist` porque `contrato_estado_ix` YA EXISTE: es el indice de
-- (organizacion_id, estado) sobre `contrato`, en el archivo 02. Con el nombre repetido, el
-- `if not exists` se lo saltaba sin decir nada y este indice no se creaba nunca.
create index if not exists contrato_estado_hist_ix
  on contrato_estado (contrato_id, ocurrido_en desc);

alter table contrato_estado enable row level security;

-- Se lee como se lee el contrato: el cliente ve el histórico del suyo. Que un contrato se
-- suspendió o se cerró no es información interna — es justo lo que el cliente necesita
-- saber, y se lo dijo GPS.
-- La comprobacion de organizacion va ESCRITA, y no delegada en el RLS de `contrato`.
-- Apoyarse en que la tabla de dentro ya filtra funciona, pero hace la garantia invisible:
-- una prueba de aislamiento que consulte a traves de `contrato` pasa aunque aqui no hubiera
-- nada, porque es el filtro de `contrato` el que la salva. Ya paso una vez.
drop policy if exists contrato_estado_vista on contrato_estado;
create policy contrato_estado_vista on contrato_estado for select using (
  case when es_interna()
       then exists (select 1 from contrato c
                     where c.id = contrato_estado.contrato_id
                       and c.organizacion_id = org_actual())
       else exists (select 1 from contrato c
                     where c.id = contrato_estado.contrato_id
                       and c.cliente_id = org_actual())
  end
);

-- Escribir es de GPS. Y conviene decir cual es la cerradura de verdad: al cliente no se
-- le concede `insert` sobre esta tabla en 99-permisos.sql, asi que su intento se para en el
-- permiso de tabla antes de llegar aqui. Esta politica es la SEGUNDA cerradura, la que
-- seguiria puesta si alguien concediera ese insert por descuido. Comprobado abriendola del
-- todo: las pruebas siguen verdes, porque el permiso de tabla ya lo impedia.
drop policy if exists contrato_estado_escritura on contrato_estado;
create policy contrato_estado_escritura on contrato_estado for insert with check (es_interna());

-- ---------------------------------------------------------------------------

-- Los pasos que existen. Escrito como dato y no como una cadena de `if`, porque así se
-- lee de un vistazo y porque el mensaje de error puede decir a dónde SÍ se puede ir.
create or replace function pasos_de_contrato(p_de estado_contrato)
returns estado_contrato[]
language sql immutable as $$
  select case p_de
    when 'borrador'   then array['vigente']::estado_contrato[]
    -- Un contrato vigente se suspende o se acaba.
    when 'vigente'    then array['suspendido','cerrado']::estado_contrato[]
    -- Uno suspendido vuelve, o se acaba sin volver.
    when 'suspendido' then array['vigente','cerrado']::estado_contrato[]
    -- Y uno cerrado se liquida, o se REABRE: una adenda que amplía el alcance es normal, y
    -- dejar un contrato cerrado sin salida sería otra máquina sin puerta.
    when 'cerrado'    then array['vigente','liquidado']::estado_contrato[]
    -- El finiquito es el final. De aquí no se vuelve.
    when 'liquidado'  then array[]::estado_contrato[]
  end
$$;

-- Lo que le falta a un contrato para poder liquidarse, en dinero. Cero significa que se
-- puede. Se usa para negar la liquidación y para enseñar el motivo antes de intentarlo.
create or replace function falta_para_liquidar(p_contrato uuid)
returns table (sin_cobrar numeric(20,2), sin_facturar numeric(20,2))
language sql stable as $$
  select
    coalesce((select sum(saldo_valuacion(v.id)) from valuacion v
               where v.contrato_id = p_contrato
                 and v.estado in ('presentada','objetada','aprobada','facturada')), 0)
      ::numeric(20,2),
    coalesce((select sum(f.valor) from por_facturar(p_contrato, current_date) f), 0)
      ::numeric(20,2)
$$;

-- ---------------------------------------------------------------------------

-- El cambio de estado, con su motivo y su rastro, en una sola transacción.
create or replace function cambiar_estado_contrato(
  p_contrato uuid, p_a estado_contrato, p_fin_real date, p_motivo text, p_persona uuid
) returns void
language plpgsql security definer as $$
declare
  ctr      record;
  permitidos estado_contrato[];
  f        record;
begin
  select * into ctr from contrato where id = p_contrato for update;
  if ctr is null then
    raise exception 'El contrato % no existe', p_contrato;
  end if;

  permitidos := pasos_de_contrato(ctr.estado);
  if not (p_a = any (permitidos)) then
    raise exception 'Un contrato % no puede pasar a %. Desde % solo se puede ir a: %',
      ctr.estado, p_a, ctr.estado,
      coalesce(nullif(array_to_string(permitidos, ', '), ''), 'ninguna parte');
  end if;

  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Hace falta escribir por que cambia el estado del contrato';
  end if;

  -- Cerrar exige la fecha real de fin. Es el dato por el que existe este trozo: sin el,
  -- «terminamos tarde?» no se puede contestar, y el contrato queda cerrado sin decir
  -- cuando termino de verdad.
  if p_a = 'cerrado' then
    if p_fin_real is null then
      raise exception 'Para cerrar un contrato hace falta la fecha en que termino de verdad';
    end if;
    if ctr.inicio is not null and p_fin_real < ctr.inicio then
      raise exception 'La fecha de fin (%) es anterior al inicio del contrato (%)',
        p_fin_real, ctr.inicio;
    end if;
    if p_fin_real > current_date then
      raise exception 'La fecha de fin (%) es futura: un contrato no termina manana', p_fin_real;
    end if;
  end if;

  -- Y liquidar exige que no quede dinero por medio. Esto no es criterio de nadie: es una
  -- resta, y hacerla aqui es lo que impide firmar un finiquito de un contrato al que
  -- todavia se le debe.
  if p_a = 'liquidado' then
    select * into f from falta_para_liquidar(p_contrato);
    if f.sin_cobrar <> 0 or f.sin_facturar <> 0 then
      raise exception 'Ese contrato no se puede liquidar todavia: quedan % sin cobrar y % de obra verificada sin facturar',
        f.sin_cobrar, f.sin_facturar;
    end if;
  end if;

  insert into contrato_estado (contrato_id, de, a, motivo, fin_real, por)
  values (p_contrato, ctr.estado, p_a, btrim(p_motivo),
          case when p_a = 'cerrado' then p_fin_real else null end, p_persona);

  update contrato
     set estado = p_a,
         -- Volver a vigente BORRA la fecha real de fin. Un contrato que esta corriendo
         -- otra vez no termino: dejarsela puesta seria un contrato vivo con fecha de
         -- muerte, y de ahi salen los informes que nadie entiende.
         fin_real = case when p_a = 'cerrado' then p_fin_real
                         when p_a = 'vigente' then null
                         else fin_real end
   where id = p_contrato;
end $$;
