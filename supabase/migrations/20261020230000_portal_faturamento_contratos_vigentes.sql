-- Portal de Faturamento · CA-04 (empresa errada): os contratos vigentes das emissoras do grupo entram no aviso de
-- "contrato em outra empresa" (RF-P03) (20/10/2026).
--
-- Auditoria do Jev: CA-04 "não atende". O aviso só lia ops.omie_contratos_servico, que tem os contratos das unidades
-- (franquias e Partners), não os das emissoras. "Dado um tomador com contrato vigente na PAC, quando alguém pede um
-- pontual pela PRJ, o portal avisa" não acontecia.
-- Plano: e1/PLANO-E1.md. Spec §5.3 RF-P03, §12 CA-04. E0: e0/E0-levantamento.md §3.1 (só a vigência em dia conta).
-- Depende de 20261020220000 (revisão), aplicada antes.
-- Ensaio (begin … rollback): supabase/gates/20261020_portal_faturamento_contratos_vigentes.sql
-- Rollback: supabase/rollback/20261020230000_portal_faturamento_contratos_vigentes_rollback.sql
--
-- O que faz:
--   1. integracoes.omie_contratos_vigentes: os contratos ativos (cCodSit 10) e de vigência em dia de cada emissora,
--      lidos do Omie dela (servicos/contrato ListarContratos), com o documento do cliente casado pelo cadastro
--      (geral/clientes). Unique (emissora, contrato). O navegador não lê.
--   2. integracoes.fat_contratos_aplicar(p_emissora, p_contratos) e a passagem ops.fat_conector_contratos_aplicar:
--      substituem o conjunto da emissora pelo que o conector leu. Só o service_role.
--   3. receita.fat_contratos_vigentes(_doc) passa a juntar essa tabela. É a fonte de
--      receita.fat_contratos_outra_emissora, então ops.fat_tomador, ops.fat_pedido_salvar, ops.fat_pedido e a trava do
--      envio (confirmou_emissora) passam a ver o contrato da emissora, com o mesmo retorno da revisão (só a empresa,
--      sem número nem valor). A regra continua: contrato ativo, vigência final nula ou a partir de hoje, de outra
--      emissora que não a do pedido.
--   4. Fila do Omie: operação nova sincronizar_contratos (origem fat_emissora, só leitura, vale em simular e em
--      gravar). integracoes.fat_contratos_enfileirar() põe uma por emissora ativa com Omie, reaproveitando a linha, e o
--      pg_cron a chama todo dia às 6h de São Paulo (9h UTC). A fila de 2 em 2 minutos processa.

begin;

-- =================================================================================================================
-- 1. Tabela
-- =================================================================================================================
create table integracoes.omie_contratos_vigentes (
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  codigo_contrato bigint not null check (codigo_contrato > 0),
  numero text,
  documento text not null check (documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  codigo_cliente_omie bigint,
  situacao text not null check (btrim(situacao) <> ''),
  vigencia_inicial date,
  vigencia_final date,
  valor_mensal numeric(14,2),
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omie_contratos_vigentes_pk primary key (emissora_id, codigo_contrato)
);
comment on table integracoes.omie_contratos_vigentes is
  'Domínio Integrações. Dono: Portal de Faturamento (CA-04). Contratos de serviço ativos (cCodSit 10) e de vigência em '
  'dia de cada emissora do grupo, lidos do Omie dela pela edge faturamento-omie (operação sincronizar_contratos, todo '
  'dia às 6h). O documento do cliente vem do cadastro do Omie (nCodCli → cnpj_cpf), normalizado como '
  'receita.fat_documento_normalizar. Alimenta o aviso de contrato em outra empresa (RF-P03) por '
  'receita.fat_contratos_vigentes. O navegador não lê.';
comment on column integracoes.omie_contratos_vigentes.codigo_contrato is 'nCodCtr do contrato no Omie da emissora.';
comment on column integracoes.omie_contratos_vigentes.numero is 'cNumCtr (número do contrato visto na tela do Omie).';
comment on column integracoes.omie_contratos_vigentes.situacao is 'cCodSit: 10 = ativo (só os ativos entram).';
comment on column integracoes.omie_contratos_vigentes.valor_mensal is 'nValTotMes. Não sai para a tela (revisão, achado 2).';
create index omie_contratos_vigentes_documento_idx on integracoes.omie_contratos_vigentes (documento);
create trigger omie_contratos_vigentes_updated_at before update on integracoes.omie_contratos_vigentes
  for each row execute function integracoes.tocar_updated_at();

alter table integracoes.omie_contratos_vigentes enable row level security;
revoke all on integracoes.omie_contratos_vigentes from public, anon, authenticated, service_role;
grant select on integracoes.omie_contratos_vigentes to service_role;

-- =================================================================================================================
-- 2. O conector substitui o conjunto da emissora
-- =================================================================================================================
create or replace function integracoes.fat_contratos_aplicar(p_emissora uuid, p_contratos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _item jsonb;
  _doc text;
  _cod bigint;
  _validos jsonb := '[]'::jsonb;
  _ignorados int := 0;
  _antes int;
  _removidos int;
  _gravados int;
begin
  perform integracoes.fat_exigir_conector();
  if not exists (select 1 from organizacao.empresas_grupo g where g.id = p_emissora) then
    raise exception 'Emissora desconhecida.' using errcode = 'P0002';
  end if;
  if p_contratos is null or jsonb_typeof(p_contratos) <> 'array' then
    raise exception 'p_contratos precisa ser uma lista (vazia quando a emissora não tem contrato vigente).'
      using errcode = '22023';
  end if;
  for _item in select * from jsonb_array_elements(p_contratos) loop
    _cod := nullif(_item ->> 'codigo_contrato', '')::bigint;
    _doc := receita.fat_documento_normalizar(_item ->> 'documento');
    if _cod is null or _cod <= 0 or _doc is null or not receita.fat_documento_valido(_doc)
       or nullif(btrim(_item ->> 'situacao'), '') is null then
      _ignorados := _ignorados + 1;
      continue;
    end if;
    _validos := _validos || jsonb_build_object(
      'c', _cod, 'n', nullif(btrim(_item ->> 'numero'), ''), 'd', _doc,
      'cli', nullif(_item ->> 'codigo_cliente_omie', '')::bigint, 's', btrim(_item ->> 'situacao'),
      'vi', nullif(_item ->> 'vigencia_inicial', '')::date, 'vf', nullif(_item ->> 'vigencia_final', '')::date,
      'v', nullif(_item ->> 'valor_mensal', '')::numeric(14,2));
  end loop;

  select count(*) into _antes from integracoes.omie_contratos_vigentes where emissora_id = p_emissora;
  delete from integracoes.omie_contratos_vigentes x
   where x.emissora_id = p_emissora
     and not exists (select 1 from jsonb_array_elements(_validos) v where (v ->> 'c')::bigint = x.codigo_contrato);
  get diagnostics _removidos = row_count;
  insert into integracoes.omie_contratos_vigentes as x
    (emissora_id, codigo_contrato, numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final,
     valor_mensal, sincronizado_em)
  select distinct on ((v ->> 'c')::bigint)
         p_emissora, (v ->> 'c')::bigint, v ->> 'n', v ->> 'd', (v ->> 'cli')::bigint, v ->> 's', (v ->> 'vi')::date,
         (v ->> 'vf')::date, (v ->> 'v')::numeric(14,2), now()
    from jsonb_array_elements(_validos) v
  on conflict (emissora_id, codigo_contrato) do update
     set numero = excluded.numero, documento = excluded.documento, codigo_cliente_omie = excluded.codigo_cliente_omie,
         situacao = excluded.situacao, vigencia_inicial = excluded.vigencia_inicial,
         vigencia_final = excluded.vigencia_final, valor_mensal = excluded.valor_mensal, sincronizado_em = now();
  get diagnostics _gravados = row_count;
  return jsonb_build_object('antes', _antes, 'gravados', _gravados, 'removidos', _removidos, 'ignorados', _ignorados,
                            'total', (select count(*) from integracoes.omie_contratos_vigentes where emissora_id = p_emissora));
end $$;
comment on function integracoes.fat_contratos_aplicar(uuid, jsonb) is
  'Substitui os contratos vigentes da emissora pelo que o conector leu do Omie (lista vazia = nenhum vigente). Item: '
  'codigo_contrato, numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final, valor_mensal. '
  'Documento inválido é ignorado e contado. Só o service_role.';

create or replace function ops.fat_conector_contratos_aplicar(p_emissora uuid, p_contratos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_contratos_aplicar(p_emissora, p_contratos);
end $$;
comment on function ops.fat_conector_contratos_aplicar(uuid, jsonb) is
  'Passagem do conector (service_role) para integracoes.fat_contratos_aplicar: integracoes não é exposto no PostgREST.';

-- =================================================================================================================
-- 3. O aviso de contrato em outra empresa lê também os contratos das emissoras
-- =================================================================================================================
create or replace function receita.fat_contratos_vigentes(_doc text)
returns table (emissora_id uuid, apelido text, unidade text, numero text, valor_mensal numeric, vigencia_inicial date,
               vigencia_final date, sincronizado_em timestamptz)
language sql stable set search_path = '' as $$
  with mapa as (
    select distinct c.unidade, g.id as emissora_id, g.apelido
      from ops.omie_credentials c
      left join ops.unidades u on u.id = c.unidade_id
      join organizacao.empresas_grupo g
        on g.cnpj = any (array(select receita.fat_documento_normalizar(x)
                                 from regexp_split_to_table(coalesce(u.cnpj, ''), E'[\\n,;]+') x))
        or (c.unidade = 'Planning Partners (Matriz)' and g.id = '769854a7-0b0b-48e2-ace8-9b0636e19a56')
  ), k as (
    -- Documento só com dígitos: pelo índice de cnpj_digitos. Alfanumérico (cnpj_digitos tira as letras): pelo
    -- documento normalizado, numa varredura que só roda quando o documento tem letra.
    select x.* from ops.omie_contratos_servico x where _doc ~ '^[0-9]+$' and x.cnpj_digitos = _doc
    union all
    select x.* from ops.omie_contratos_servico x
     where _doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc
  )
  -- Contratos das unidades (franquias e Partners), pela unidade do Omie.
  select m.emissora_id, m.apelido, k.unidade, k.numero, k.valor_mensal, k.vigencia_inicial, k.vigencia_final,
         k.sincronizado_em
    from k join mapa m on m.unidade = k.unidade
   where _doc is not null and k.situacao = '10'
     and (k.vigencia_final is null or k.vigencia_final >= receita.fat_hoje())
  union all
  -- Contratos das emissoras do grupo (CA-04), lidos do Omie de cada uma pelo conector.
  select c.emissora_id, g.apelido, null::text, c.numero, c.valor_mensal, c.vigencia_inicial, c.vigencia_final,
         c.sincronizado_em
    from integracoes.omie_contratos_vigentes c
    join organizacao.empresas_grupo g on g.id = c.emissora_id
   where _doc is not null and c.documento = _doc and c.situacao = '10'
     and (c.vigencia_final is null or c.vigencia_final >= receita.fat_hoje())
$$;
comment on function receita.fat_contratos_vigentes(text) is
  'Contratos vigentes do documento (situação 10 e vigência final nula ou a partir de hoje, em São Paulo): os das '
  'unidades (ops.omie_contratos_servico) e os das emissoras do grupo (integracoes.omie_contratos_vigentes). Fonte do '
  'aviso de contrato em outra empresa (receita.fat_contratos_outra_emissora, RF-P03, CA-04).';

-- =================================================================================================================
-- 4. Fila: sincronizar_contratos, uma por emissora ativa, todo dia às 6h
-- =================================================================================================================
alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
  'garantir_cliente', 'incluir_os', 'alterar_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os',
  'sincronizar_servicos', 'sincronizar_contratos'));

create or replace function integracoes.fat_contratos_enfileirar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _n int;
begin
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel)
  select g.id, 'fat_emissora', g.id, 'sincronizar_contratos', 'CONTRATOS-' || g.id::text,
         jsonb_build_object('versao', 1, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido, 'cnpj', g.cnpj)),
         g.modo_omie, 'pendente', 0, now(), null, null
    from organizacao.empresas_grupo g
   where g.ativa and g.omie_credencial_ref is not null
  on conflict (operacao, codigo_integracao) do update
     set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
         proxima_tentativa_em = now(), resposta = null, erro_legivel = null, reserva = null, reservado_ate = null
   where x.status not in ('pendente', 'processando');
  get diagnostics _n = row_count;
  return jsonb_build_object('enfileirados', _n);
end $$;
comment on function integracoes.fat_contratos_enfileirar() is
  'Põe na fila do Omie uma leitura de contratos (sincronizar_contratos) por emissora ativa com Omie, reaproveitando a '
  'linha (não duplica a que já está na fila). Chamada pelo pg_cron todo dia às 6h de São Paulo.';

revoke all on function integracoes.fat_contratos_aplicar(uuid, jsonb), ops.fat_conector_contratos_aplicar(uuid, jsonb),
                       integracoes.fat_contratos_enfileirar()
  from public, anon, authenticated;
grant execute on function integracoes.fat_contratos_aplicar(uuid, jsonb), ops.fat_conector_contratos_aplicar(uuid, jsonb),
                          integracoes.fat_contratos_enfileirar()
  to service_role;

select cron.unschedule('faturamento-omie-contratos')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos');
select cron.schedule('faturamento-omie-contratos', '0 9 * * *', $cron$ select integracoes.fat_contratos_enfileirar(); $cron$);

do $conferencia$
declare n int;
begin
  if to_regclass('integracoes.omie_contratos_vigentes') is null then raise exception 'CA-04: tabela ausente'; end if;
  if has_table_privilege('authenticated', 'integracoes.omie_contratos_vigentes', 'select') then
    raise exception 'CA-04: authenticated lê os contratos';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where (s.nspname, p.proname) in (('ops', 'fat_conector_contratos_aplicar'), ('integracoes', 'fat_contratos_aplicar'))
     and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
  if n <> 2 then raise exception 'CA-04: % das 2 funções de aplicar com o acesso certo', n; end if;
  if not exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos' and schedule = '0 9 * * *' and active) then
    raise exception 'CA-04: job diário dos contratos ausente';
  end if;
end $conferencia$;

commit;
