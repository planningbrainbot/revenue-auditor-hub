-- Portal de Faturamento · E2, recorrente (29/10/2026): Contratos do mês (dono) e Lista do corte (tesouraria).
--
-- Decisões do Pedro de 29/10 (DECISIONS.md, spec §13.4): a automação de contrato do Omie só é desligada em 11/11, e o
-- portal assume no corte de 13/11; cada contrato nasce com os donos da empresa e pode ser repassado; o dono responde
-- só o que mudou e o resto fatura sozinho; no primeiro ciclo a tesouraria fatura no Omie pela lista do corte.
-- Contratos de tela aprovados: docs/design/contratos/faturamento-contratos.md e faturamento-corte.md.
-- Ensaio (begin … rollback): supabase/gates/20261029_portal_faturamento_recorrente.sql
-- Rollback: supabase/rollback/20261029180000_portal_faturamento_recorrente_rollback.sql
--
-- O que faz:
--   1. integracoes.omie_contratos_vigentes ganha dia de faturamento, tipo, vencimento, projeto, categoria, nome do
--      cliente e itens. O conector passa a mandar também os contratos que venceram desde o 1º dia do mês anterior
--      (para o "faturou e sumiu"); o aviso de contrato em outra empresa (receita.fat_contratos_vigentes) já filtra
--      situação 10 e vigência a partir de hoje, então não muda.
--   2. integracoes.omie_notas_contrato: NFS-e e recibos ligados a contrato, lidos do Omie de cada emissora (operação
--      nova sincronizar_notas, do 1º dia do mês anterior até hoje), todo dia às 6h30 e às 12h e 16h em dia útil.
--   3. Calendário: receita.fat_feriados (nacionais de 2026 e 2027) e o dia útil anterior.
--   4. receita.fat_contrato_donos: repasse do contrato a outro sócio (vale para os meses seguintes).
--   5. receita.fat_competencias: uma linha por contrato e mês, com o valor do contrato, o faturado no mês anterior,
--      os motivos (novo, valor, vence, sumiu, encerrado_omie), o corte, o prazo e a resposta do dono. Gerada pelo
--      receita.fat_competencias_gerar (pg_cron de hora em hora); a situação, o valor a faturar e o depois do corte
--      saem de receita.fat_comp_linhas na leitura.
--   6. API das telas: ops.fat_contratos_mes, ops.fat_contrato_detalhe, ops.fat_contrato_responder,
--      ops.fat_contratos_confirmar, ops.fat_contrato_pessoas, ops.fat_contrato_repassar, ops.fat_corte e
--      ops.fat_corte_feito.

begin;

-- =================================================================================================================
-- 1. Espelho dos contratos: o que o recorrente precisa
-- =================================================================================================================
alter table integracoes.omie_contratos_vigentes
  add column dia_faturamento smallint check (dia_faturamento between 1 and 31),
  add column tipo_faturamento text,
  add column dia_vencimento smallint,
  add column codigo_projeto bigint,
  add column projeto text,
  add column categoria text,
  add column cliente_nome text,
  add column itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array');
comment on table integracoes.omie_contratos_vigentes is
  'Domínio Integrações. Dono: Portal de Faturamento. Contratos de serviço de cada emissora do grupo, lidos do Omie dela '
  'pela edge faturamento-omie (sincronizar_contratos, todo dia às 6h): os de vigência final nula ou a partir do 1º dia '
  'do mês anterior, em qualquer situação (desde 29/10/2026; antes, só os vigentes). O aviso de contrato em outra '
  'empresa (RF-P03) filtra situação 10 e vigência a partir de hoje em receita.fat_contratos_vigentes; o recorrente lê '
  'tudo por receita.fat_competencias_gerar. O navegador não lê.';
comment on column integracoes.omie_contratos_vigentes.dia_faturamento is 'nDiaFat: dia do mês em que o Omie fatura o contrato.';
comment on column integracoes.omie_contratos_vigentes.tipo_faturamento is 'cTipoFat (01 = mensal; 2.077 dos 2.080 ativos em 15/10).';
comment on column integracoes.omie_contratos_vigentes.dia_vencimento is 'vencTextos.nDiaFixo: dia do vencimento da cobrança.';
comment on column integracoes.omie_contratos_vigentes.codigo_projeto is 'infAdic.nCodProj.';
comment on column integracoes.omie_contratos_vigentes.projeto is 'Nome do projeto (geral/projetos), o "grupo" do cliente.';
comment on column integracoes.omie_contratos_vigentes.itens is
  'Itens do contrato: [{servico, codigo_servico, quantidade, valor_unitario, valor_total}].';

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
      'v', nullif(_item ->> 'valor_mensal', '')::numeric(14,2),
      'df', case when (_item ->> 'dia_faturamento') ~ '^[0-9]{1,2}$'
                  and (_item ->> 'dia_faturamento')::int between 1 and 31
                 then (_item ->> 'dia_faturamento')::smallint end,
      'tf', nullif(btrim(_item ->> 'tipo_faturamento'), ''),
      'dv', case when (_item ->> 'dia_vencimento') ~ '^[0-9]{1,2}$' then (_item ->> 'dia_vencimento')::smallint end,
      'cp', nullif(nullif(_item ->> 'codigo_projeto', ''), '0')::bigint,
      'p', nullif(btrim(_item ->> 'projeto'), ''),
      'cat', nullif(btrim(_item ->> 'categoria'), ''),
      'cn', nullif(btrim(_item ->> 'cliente_nome'), ''),
      'it', case when jsonb_typeof(_item -> 'itens') = 'array' then _item -> 'itens' else '[]'::jsonb end);
  end loop;

  select count(*) into _antes from integracoes.omie_contratos_vigentes where emissora_id = p_emissora;
  delete from integracoes.omie_contratos_vigentes x
   where x.emissora_id = p_emissora
     and not exists (select 1 from jsonb_array_elements(_validos) v where (v ->> 'c')::bigint = x.codigo_contrato);
  get diagnostics _removidos = row_count;
  insert into integracoes.omie_contratos_vigentes as x
    (emissora_id, codigo_contrato, numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final,
     valor_mensal, dia_faturamento, tipo_faturamento, dia_vencimento, codigo_projeto, projeto, categoria, cliente_nome,
     itens, sincronizado_em)
  select distinct on ((v ->> 'c')::bigint)
         p_emissora, (v ->> 'c')::bigint, v ->> 'n', v ->> 'd', (v ->> 'cli')::bigint, v ->> 's', (v ->> 'vi')::date,
         (v ->> 'vf')::date, (v ->> 'v')::numeric(14,2), (v ->> 'df')::smallint, v ->> 'tf', (v ->> 'dv')::smallint,
         (v ->> 'cp')::bigint, v ->> 'p', v ->> 'cat', v ->> 'cn', v -> 'it', now()
    from jsonb_array_elements(_validos) v
  on conflict (emissora_id, codigo_contrato) do update
     set numero = excluded.numero, documento = excluded.documento, codigo_cliente_omie = excluded.codigo_cliente_omie,
         situacao = excluded.situacao, vigencia_inicial = excluded.vigencia_inicial,
         vigencia_final = excluded.vigencia_final, valor_mensal = excluded.valor_mensal,
         dia_faturamento = excluded.dia_faturamento, tipo_faturamento = excluded.tipo_faturamento,
         dia_vencimento = excluded.dia_vencimento, codigo_projeto = excluded.codigo_projeto,
         projeto = excluded.projeto, categoria = excluded.categoria, cliente_nome = excluded.cliente_nome,
         itens = excluded.itens, sincronizado_em = now();
  get diagnostics _gravados = row_count;
  return jsonb_build_object('antes', _antes, 'gravados', _gravados, 'removidos', _removidos, 'ignorados', _ignorados,
                            'total', (select count(*) from integracoes.omie_contratos_vigentes where emissora_id = p_emissora));
end $$;
comment on function integracoes.fat_contratos_aplicar(uuid, jsonb) is
  'Substitui os contratos da emissora pelo que o conector leu do Omie (lista vazia = nenhum). Item: codigo_contrato, '
  'numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final, valor_mensal, dia_faturamento, '
  'tipo_faturamento, dia_vencimento, codigo_projeto, projeto, categoria, cliente_nome, itens. Documento inválido é '
  'ignorado e contado. Só o service_role.';

-- =================================================================================================================
-- 2. Notas e recibos de contrato
-- =================================================================================================================
create table integracoes.omie_notas_contrato (
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  chave text not null check (chave ~ '^(nfse|recibo):[0-9]+$'),
  tipo text not null check (tipo in ('nfse', 'recibo')),
  codigo_contrato bigint,
  numero_contrato text,
  codigo_cliente_omie bigint,
  codigo_os bigint,
  numero text,
  emitida_em date not null,
  valor numeric(14,2) not null,
  cancelada boolean not null default false,
  sincronizado_em timestamptz not null default now(),
  constraint omie_notas_contrato_pk primary key (emissora_id, chave)
);
comment on table integracoes.omie_notas_contrato is
  'Domínio Integrações. Dono: Portal de Faturamento (recorrente). NFS-e (ListarNFSEs, ligadas ao contrato por '
  'OrdemServico.nCodigoContrato) e recibos (ListarOS com cTipoFat REC, ligados por Cabecalho.nCodCtr ou pelo número '
  'do contrato do mesmo cliente) de cada emissora, do 1º dia do mês anterior até hoje. Base do "mês anterior" e da '
  'conferência depois do corte. Método do E0 (e0/E0-vencidos.md). O navegador não lê.';
create index omie_notas_contrato_contrato_idx on integracoes.omie_notas_contrato (emissora_id, codigo_contrato, emitida_em);
alter table integracoes.omie_notas_contrato enable row level security;
revoke all on integracoes.omie_notas_contrato from public, anon, authenticated, service_role;
grant select on integracoes.omie_notas_contrato to service_role;

create or replace function integracoes.fat_notas_aplicar(p_emissora uuid, p_de date, p_ate date, p_notas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _validos jsonb := '[]'::jsonb;
  _item jsonb;
  _ignorados int := 0;
  _removidos int;
  _gravados int;
  _ctr bigint;
begin
  perform integracoes.fat_exigir_conector();
  if not exists (select 1 from organizacao.empresas_grupo g where g.id = p_emissora) then
    raise exception 'Emissora desconhecida.' using errcode = 'P0002';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_notas is null or jsonb_typeof(p_notas) <> 'array' then
    raise exception 'Período ou lista de notas inválidos.' using errcode = '22023';
  end if;
  for _item in select * from jsonb_array_elements(p_notas) loop
    if (_item ->> 'chave') !~ '^(nfse|recibo):[0-9]+$' or nullif(_item ->> 'emitida_em', '') is null
       or nullif(_item ->> 'valor', '') is null then
      _ignorados := _ignorados + 1;
      continue;
    end if;
    _ctr := nullif(nullif(_item ->> 'codigo_contrato', ''), '0')::bigint;
    -- Recibo sem o código: o número do contrato, só quando o cliente é o mesmo (E0: há recibo com o número de outro).
    if _ctr is null and nullif(btrim(_item ->> 'numero_contrato'), '') is not null then
      select c.codigo_contrato into _ctr from integracoes.omie_contratos_vigentes c
       where c.emissora_id = p_emissora and c.numero = btrim(_item ->> 'numero_contrato')
         and c.codigo_cliente_omie = nullif(_item ->> 'codigo_cliente_omie', '')::bigint
       limit 1;
    end if;
    if _ctr is null then
      _ignorados := _ignorados + 1;
      continue;
    end if;
    _validos := _validos || (_item || jsonb_build_object('codigo_contrato', _ctr));
  end loop;

  delete from integracoes.omie_notas_contrato x
   where x.emissora_id = p_emissora and x.emitida_em between p_de and p_ate
     and not exists (select 1 from jsonb_array_elements(_validos) v where v ->> 'chave' = x.chave);
  get diagnostics _removidos = row_count;
  insert into integracoes.omie_notas_contrato as x
    (emissora_id, chave, tipo, codigo_contrato, numero_contrato, codigo_cliente_omie, codigo_os, numero, emitida_em,
     valor, cancelada, sincronizado_em)
  select distinct on (v ->> 'chave')
         p_emissora, v ->> 'chave', split_part(v ->> 'chave', ':', 1), (v ->> 'codigo_contrato')::bigint,
         nullif(btrim(v ->> 'numero_contrato'), ''), nullif(v ->> 'codigo_cliente_omie', '')::bigint,
         nullif(nullif(v ->> 'codigo_os', ''), '0')::bigint, nullif(btrim(v ->> 'numero'), ''),
         (v ->> 'emitida_em')::date, (v ->> 'valor')::numeric(14,2), coalesce((v ->> 'cancelada')::boolean, false), now()
    from jsonb_array_elements(_validos) v
  on conflict (emissora_id, chave) do update
     set codigo_contrato = excluded.codigo_contrato, numero_contrato = excluded.numero_contrato,
         codigo_cliente_omie = excluded.codigo_cliente_omie, codigo_os = excluded.codigo_os, numero = excluded.numero,
         emitida_em = excluded.emitida_em, valor = excluded.valor, cancelada = excluded.cancelada, sincronizado_em = now();
  get diagnostics _gravados = row_count;
  return jsonb_build_object('gravadas', _gravados, 'removidas', _removidos, 'ignoradas', _ignorados);
end $$;
comment on function integracoes.fat_notas_aplicar(uuid, date, date, jsonb) is
  'Substitui as notas e recibos de contrato da emissora no período [p_de, p_ate] pelo que o conector leu. Item: chave '
  '(nfse:<nCodNF> ou recibo:<nCodOS>), codigo_contrato, numero_contrato, codigo_cliente_omie, codigo_os, numero, '
  'emitida_em, valor, cancelada. Sem contrato ligado, a nota é ignorada e contada. Só o service_role.';

create or replace function ops.fat_conector_notas_aplicar(p_emissora uuid, p_de date, p_ate date, p_notas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_notas_aplicar(p_emissora, p_de, p_ate, p_notas);
end $$;
comment on function ops.fat_conector_notas_aplicar(uuid, date, date, jsonb) is
  'Passagem do conector (service_role) para integracoes.fat_notas_aplicar: integracoes não é exposto no PostgREST.';

alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
  'garantir_cliente', 'incluir_os', 'alterar_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os',
  'sincronizar_servicos', 'sincronizar_contratos', 'sincronizar_notas'));

create or replace function integracoes.fat_notas_enfileirar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _n int;
  _de date := (date_trunc('month', receita.fat_hoje()) - interval '1 month')::date;
  _ate date := receita.fat_hoje();
begin
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel)
  select g.id, 'fat_emissora', g.id, 'sincronizar_notas', 'NOTAS-' || g.id::text,
         jsonb_build_object('versao', 1, 'de', _de, 'ate', _ate,
                            'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido, 'cnpj', g.cnpj)),
         g.modo_omie, 'pendente', 0, now(), null, null
    from organizacao.empresas_grupo g
   where g.ativa and g.omie_credencial_ref is not null
  on conflict (operacao, codigo_integracao) do update
     set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
         proxima_tentativa_em = now(), resposta = null, erro_legivel = null, reserva = null, reservado_ate = null
   where x.status not in ('pendente', 'processando');
  get diagnostics _n = row_count;
  return jsonb_build_object('enfileirados', _n, 'de', _de, 'ate', _ate);
end $$;
comment on function integracoes.fat_notas_enfileirar() is
  'Põe na fila do Omie uma leitura de notas de contrato (sincronizar_notas) por emissora ativa com Omie, do 1º dia do '
  'mês anterior até hoje, reaproveitando a linha. pg_cron: todo dia às 6h30 e, em dia útil, às 12h e às 16h (São Paulo).';

-- =================================================================================================================
-- 3. Calendário
-- =================================================================================================================
create table receita.fat_feriados (
  data date primary key,
  nome text not null check (btrim(nome) <> '')
);
comment on table receita.fat_feriados is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento (controladoria). Feriados nacionais que empurram o corte do '
  'recorrente para o dia útil anterior (spec §6.2). O navegador não lê.';
alter table receita.fat_feriados enable row level security;
revoke all on receita.fat_feriados from public, anon, authenticated;
insert into receita.fat_feriados (data, nome) values
  ('2026-01-01', 'Confraternização Universal'), ('2026-04-03', 'Sexta-feira Santa'), ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'), ('2026-09-07', 'Independência'), ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'), ('2027-03-26', 'Sexta-feira Santa'), ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'), ('2027-09-07', 'Independência'), ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'), ('2027-11-20', 'Consciência Negra'),
  ('2027-12-25', 'Natal');

create or replace function receita.fat_dia_util_ate(_d date)
returns date language sql stable set search_path = '' as $$
  select max(d)::date from generate_series(_d - 10, _d, interval '1 day') d
   where extract(isodow from d) < 6 and not exists (select 1 from receita.fat_feriados f where f.data = d::date)
$$;
comment on function receita.fat_dia_util_ate(date) is 'O próprio dia, se for útil; senão o dia útil anterior (fim de semana e receita.fat_feriados).';

create or replace function receita.fat_dia_util_antes(_d date)
returns date language sql stable set search_path = '' as $$
  select receita.fat_dia_util_ate(_d - 1)
$$;
comment on function receita.fat_dia_util_antes(date) is 'O dia útil anterior a _d (estritamente antes).';

create or replace function receita.fat_recorrente_inicio()
returns date language sql immutable set search_path = '' as $$ select date '2026-11-11' $$;
comment on function receita.fat_recorrente_inicio() is
  'Dia em que a automação de faturamento de contrato do Omie é desligada (decisão do Pedro, 29/10/2026). Contrato '
  'vigente com faturamento antes dele, em nov/2026, sai pela automação: a linha nasce com automacao = true.';

-- =================================================================================================================
-- 4. Repasse do contrato
-- =================================================================================================================
create table receita.fat_contrato_donos (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  codigo_contrato bigint not null check (codigo_contrato > 0),
  dono_id uuid not null references auth.users (id) on delete cascade,
  repassado_por uuid references auth.users (id) on delete set null,
  repassado_em timestamptz not null default now(),
  constraint fat_contrato_donos_contrato_key unique (emissora_id, codigo_contrato)
);
comment on table receita.fat_contrato_donos is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento. Sócio que responde por um contrato recorrente quando o dono '
  'da empresa o repassa (decisão 2 de 29/10/2026). Sem linha, respondem os donos e gestores da empresa (fat_donos). '
  'Vale para os meses seguintes. Escrita só por ops.fat_contrato_repassar.';
alter table receita.fat_contrato_donos enable row level security;
revoke all on receita.fat_contrato_donos from public, anon, authenticated;

-- =================================================================================================================
-- 5. Competências
-- =================================================================================================================
create table receita.fat_competencias (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  codigo_contrato bigint not null check (codigo_contrato > 0),
  competencia date not null check (extract(day from competencia) = 1),
  numero_contrato text,
  documento text,
  codigo_cliente_omie bigint,
  cliente_nome text,
  projeto text,
  servico text,
  itens jsonb not null default '[]'::jsonb,
  situacao_omie text,
  tipo_faturamento text,
  vigencia_inicial date,
  vigencia_final date,
  dia_faturamento smallint,
  dia_vencimento smallint,
  data_faturamento date not null,
  data_corte date not null,
  responder_ate timestamptz not null,
  valor_contrato numeric(14,2),
  valor_mes_anterior numeric(14,2),
  motivos text[] not null default '{}' check (motivos <@ array['novo', 'valor', 'vence', 'sumiu', 'encerrado_omie']),
  automacao boolean not null default false,
  resposta text check (resposta in ('confirmar', 'ajustar', 'nao_faturar', 'renovar', 'encerrar', 'faturar_mes',
                                    'cliente_saiu')),
  valor_resposta numeric(14,2) check (valor_resposta is null or valor_resposta > 0),
  valor_permanente boolean not null default false,
  vigencia_resposta date,
  motivo_resposta text,
  respondido_por uuid references auth.users (id) on delete set null,
  respondido_em timestamptz,
  feito_omie_por uuid references auth.users (id) on delete set null,
  feito_omie_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fat_competencias_contrato_mes_key unique (emissora_id, codigo_contrato, competencia),
  constraint fat_competencias_respondido_check check (
    (resposta is null and respondido_em is null)
    or (resposta is not null and respondido_em is not null and respondido_por is not null))
);
comment on table receita.fat_competencias is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento (recorrente, E2). Uma linha por contrato e mês: o retrato '
  'do contrato do Omie (valor, itens, vigência, dia de faturamento), o faturado no mês anterior (notas e recibos do '
  'contrato), os motivos que pedem resposta do dono, o corte, o prazo e a resposta. Gerada e atualizada por '
  'receita.fat_competencias_gerar enquanto a linha está aberta e sem resposta; depois do prazo ela congela. Situação, '
  'valor a faturar e o depois do corte saem de receita.fat_comp_linhas. O navegador não lê: só as RPCs ops.fat_*.';
comment on column receita.fat_competencias.motivos is
  'novo: sem nota no mês anterior; valor: valor do contrato diferente do faturado no mês anterior; vence: vigência '
  'final no mês; sumiu: teve nota no mês anterior e não está vigente (situação 10); encerrado_omie: teve nota e o '
  'contrato não está mais ativo no Omie (só informa).';
comment on column receita.fat_competencias.automacao is
  'Primeiro ciclo (nov/2026): contrato vigente com faturamento antes de receita.fat_recorrente_inicio() sai pela '
  'automação do Omie, sem resposta do dono e fora da lista do corte.';
comment on column receita.fat_competencias.data_corte is
  'Dia em que a tesouraria fatura: o dia de faturamento ou o dia útil anterior.';
comment on column receita.fat_competencias.responder_ate is 'Fim (23:59:59 de São Paulo) do dia útil anterior ao corte.';
comment on column receita.fat_competencias.valor_permanente is
  'Ajuste vale também para os meses seguintes: a tesouraria muda o valor do contrato no Omie.';
create index fat_competencias_corte_idx on receita.fat_competencias (data_corte, emissora_id);
create trigger fat_competencias_updated_at before update on receita.fat_competencias
  for each row execute function receita.tocar_updated_at();
alter table receita.fat_competencias enable row level security;
revoke all on receita.fat_competencias from public, anon, authenticated;

create or replace function receita.fat_competencias_gerar(_comp date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _c date := date_trunc('month', _comp)::date;
  _p date := (date_trunc('month', _comp) - interval '1 month')::date;
  _fim date := (date_trunc('month', _comp) + interval '1 month' - interval '1 day')::date;
  _inicio date := receita.fat_recorrente_inicio();
  _gravadas int;
  _removidas int;
begin
  if _comp is null then raise exception 'Competência obrigatória.' using errcode = '22023'; end if;
  -- A mesma transação pode gerar dois meses (receita.fat_competencias_atualizar).
  drop table if exists pg_temp._cand;
  create temporary table _cand on commit drop as
  with ant as (
    select n.emissora_id, n.codigo_contrato, sum(n.valor) as v
      from integracoes.omie_notas_contrato n
     where not n.cancelada and n.emitida_em >= _p and n.emitida_em < _c
     group by 1, 2
  ), k as (
    select m.*,
           make_date(extract(year from _c)::int, extract(month from _c)::int,
                     least(coalesce(m.dia_faturamento, 1)::int, extract(day from _fim)::int)) as data_fat
      from integracoes.omie_contratos_vigentes m
      join organizacao.empresas_grupo g on g.id = m.emissora_id and g.ativa
  ), e as (
    select k.*, a.v as mes_anterior,
           (k.situacao = '10' and k.dia_faturamento is not null
            and (k.vigencia_final is null or k.vigencia_final >= k.data_fat)
            and (k.vigencia_inicial is null or k.vigencia_inicial <= k.data_fat)) as elegivel
      from k left join ant a on (a.emissora_id, a.codigo_contrato) = (k.emissora_id, k.codigo_contrato)
  )
  select e.emissora_id, e.codigo_contrato, e.numero, e.documento, e.codigo_cliente_omie, e.cliente_nome, e.projeto,
         nullif(btrim(e.itens -> 0 ->> 'servico'), '') as servico, e.itens, e.situacao, e.tipo_faturamento,
         e.vigencia_inicial, e.vigencia_final, e.dia_faturamento, e.dia_vencimento, e.data_fat, e.valor_mensal,
         e.mes_anterior,
         case when e.elegivel then
                array_remove(array[
                  case when coalesce(e.mes_anterior, 0) = 0 then 'novo' end,
                  case when coalesce(e.mes_anterior, 0) > 0 and abs(coalesce(e.valor_mensal, 0) - e.mes_anterior) > 0.01
                       then 'valor' end,
                  case when e.vigencia_final between _c and _fim then 'vence' end], null)
              when e.situacao = '10' then array['sumiu']
              else array['encerrado_omie'] end as motivos,
         (e.elegivel and _c = date_trunc('month', _inicio)::date and e.data_fat < _inicio) as automacao,
         -- Primeiro ciclo: o que sumiu com faturamento antes do início vai ao primeiro corte do portal.
         case when not e.elegivel and _c = date_trunc('month', _inicio)::date and e.data_fat < _inicio
              then receita.fat_dia_util_ate(_inicio)
              else receita.fat_dia_util_ate(e.data_fat) end as corte
    from e
   where e.elegivel or coalesce(e.mes_anterior, 0) > 0;

  insert into receita.fat_competencias as x
    (emissora_id, codigo_contrato, competencia, numero_contrato, documento, codigo_cliente_omie, cliente_nome, projeto,
     servico, itens, situacao_omie, tipo_faturamento, vigencia_inicial, vigencia_final, dia_faturamento, dia_vencimento,
     data_faturamento, data_corte, responder_ate, valor_contrato, valor_mes_anterior, motivos, automacao)
  select c.emissora_id, c.codigo_contrato, _c, c.numero, c.documento, c.codigo_cliente_omie, c.cliente_nome, c.projeto,
         c.servico, c.itens, c.situacao, c.tipo_faturamento, c.vigencia_inicial, c.vigencia_final, c.dia_faturamento,
         c.dia_vencimento, c.data_fat, c.corte,
         ((receita.fat_dia_util_antes(c.corte) + 1)::timestamp at time zone 'America/Sao_Paulo') - interval '1 second',
         c.valor_mensal, c.mes_anterior, c.motivos, c.automacao
    from _cand c
  on conflict (emissora_id, codigo_contrato, competencia) do update
     set numero_contrato = excluded.numero_contrato, documento = excluded.documento,
         codigo_cliente_omie = excluded.codigo_cliente_omie, cliente_nome = excluded.cliente_nome,
         projeto = excluded.projeto, servico = excluded.servico, itens = excluded.itens,
         situacao_omie = excluded.situacao_omie, tipo_faturamento = excluded.tipo_faturamento,
         vigencia_inicial = excluded.vigencia_inicial, vigencia_final = excluded.vigencia_final,
         dia_faturamento = excluded.dia_faturamento, dia_vencimento = excluded.dia_vencimento,
         data_faturamento = excluded.data_faturamento, data_corte = excluded.data_corte,
         responder_ate = excluded.responder_ate, valor_contrato = excluded.valor_contrato,
         valor_mes_anterior = excluded.valor_mes_anterior, motivos = excluded.motivos, automacao = excluded.automacao
   -- Só a linha aberta e sem resposta acompanha o Omie; respondida ou vencida, congela.
   where x.resposta is null and now() <= x.responder_ate;
  get diagnostics _gravadas = row_count;

  -- A linha que deixou de existir no Omie e ninguém respondeu sai enquanto está aberta.
  delete from receita.fat_competencias x
   where x.competencia = _c and x.resposta is null and now() <= x.responder_ate
     and not exists (select 1 from _cand c where (c.emissora_id, c.codigo_contrato) = (x.emissora_id, x.codigo_contrato));
  get diagnostics _removidas = row_count;
  drop table pg_temp._cand;

  return jsonb_build_object('competencia', _c, 'gravadas_ou_atualizadas', _gravadas, 'removidas', _removidas,
                            'total', (select count(*) from receita.fat_competencias where competencia = _c));
end $$;
comment on function receita.fat_competencias_gerar(date) is
  'Gera ou atualiza as linhas do mês: contratos vigentes no dia de faturamento (situação 10) e os que tiveram nota no '
  'mês anterior. Só mexe na linha aberta e sem resposta. Idempotente. Chamada por receita.fat_competencias_atualizar.';

create or replace function receita.fat_competencias_atualizar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _hoje date := receita.fat_hoje();
  _r jsonb := jsonb_build_object('atual', receita.fat_competencias_gerar(_hoje));
begin
  -- O mês seguinte abre no dia 16, para o dono ter tempo antes dos cortes do começo do mês.
  if extract(day from _hoje) >= 16 then
    _r := _r || jsonb_build_object('seguinte', receita.fat_competencias_gerar((date_trunc('month', _hoje) + interval '1 month')::date));
  end if;
  return _r;
end $$;
comment on function receita.fat_competencias_atualizar() is
  'Gera o mês corrente e, a partir do dia 16, o seguinte. pg_cron de hora em hora (minuto 45).';

-- Situação, valor a faturar e depois do corte, calculados na leitura.
create type receita.fat_comp_linha_t as (
  id uuid, emissora_id uuid, apelido text, codigo_contrato bigint, competencia date, numero_contrato text,
  documento text, cliente_nome text, projeto text, servico text, itens jsonb, vigencia_inicial date,
  vigencia_final date, dia_faturamento smallint, dia_vencimento smallint, data_faturamento date, data_corte date,
  responder_ate timestamptz, valor_contrato numeric, valor_mes_anterior numeric, motivos text[], automacao boolean,
  resposta text, valor_resposta numeric, valor_permanente boolean, vigencia_resposta date, motivo_resposta text,
  respondido_por uuid, respondido_em timestamptz, feito_omie_por uuid, feito_omie_em timestamptz, dono_id uuid,
  situacao text, valor_faturar numeric, instrucao text, acao_contrato text, notas_valor numeric, notas_numeros text,
  pos_corte text, aberta boolean);
comment on type receita.fat_comp_linha_t is 'Linha do mês com a situação calculada (receita.fat_comp_linhas).';

create or replace function receita.fat_comp_linhas(_comp date)
returns setof receita.fat_comp_linha_t
language sql stable security definer set search_path = '' as $$
  select c.id, c.emissora_id, g.apelido, c.codigo_contrato, c.competencia, c.numero_contrato, c.documento,
         c.cliente_nome, c.projeto, c.servico, c.itens, c.vigencia_inicial, c.vigencia_final, c.dia_faturamento,
         c.dia_vencimento, c.data_faturamento, c.data_corte, c.responder_ate, c.valor_contrato, c.valor_mes_anterior,
         c.motivos, c.automacao, c.resposta, c.valor_resposta, c.valor_permanente, c.vigencia_resposta,
         c.motivo_resposta, c.respondido_por, c.respondido_em, c.feito_omie_por, c.feito_omie_em, d.dono_id,
         s.situacao, f.valor_faturar,
         case when f.valor_faturar is null then 'nao_faturar'
              when f.valor_faturar is distinct from c.valor_contrato then 'outro_valor'
              else 'como_esta' end,
         case when c.resposta = 'renovar' or (c.resposta = 'faturar_mes' and c.vigencia_resposta is not null) then 'renovar'
              when c.resposta in ('encerrar', 'cliente_saiu') then 'encerrar'
              when c.resposta = 'ajustar' and c.valor_permanente then 'mudar_valor' end,
         n.v, n.nums,
         case when n.v is not null then
                case when f.valor_faturar is null then 'faturado_fora'
                     when abs(n.v - f.valor_faturar) > 0.01 then 'faturado_diferente'
                     else 'faturado' end
              when f.valor_faturar > 0 and receita.fat_hoje() > c.data_corte then 'falta_faturar' end,
         (not c.automacao and now() <= c.responder_ate)
    from receita.fat_competencias c
    join organizacao.empresas_grupo g on g.id = c.emissora_id
    left join receita.fat_contrato_donos d on (d.emissora_id, d.codigo_contrato) = (c.emissora_id, c.codigo_contrato)
    cross join lateral (select case
        when c.automacao then 'automacao_omie'
        when c.resposta in ('confirmar', 'renovar', 'encerrar') then 'confirmado'
        when c.resposta in ('ajustar', 'faturar_mes') then 'ajustado'
        when c.resposta = 'nao_faturar' then 'nao_fatura'
        when c.resposta = 'cliente_saiu' then 'encerrado'
        when c.motivos && array['novo', 'valor', 'vence', 'sumiu'] then
          case when now() > c.responder_ate then 'sem_resposta' else 'precisa_resposta' end
        when 'encerrado_omie' = any (c.motivos) then 'encerrado'
        else 'fatura_sozinho' end as situacao) s
    cross join lateral (select case
        when s.situacao in ('confirmado', 'fatura_sozinho', 'automacao_omie') then c.valor_contrato
        when s.situacao = 'ajustado' then c.valor_resposta end as valor_faturar) f
    left join lateral (
      select sum(x.valor) as v, string_agg(coalesce(x.numero, x.chave), ', ' order by x.emitida_em) as nums
        from integracoes.omie_notas_contrato x
       where x.emissora_id = c.emissora_id and x.codigo_contrato = c.codigo_contrato and not x.cancelada
         and x.emitida_em >= c.competencia and x.emitida_em < (c.competencia + interval '1 month')) n on true
   where c.competencia = _comp
$$;
comment on function receita.fat_comp_linhas(date) is
  'Linhas do mês com o que se calcula na leitura: situação (contrato faturamento-contratos.md), valor a faturar, '
  'instrução do corte, ação no contrato do Omie e o depois do corte (notas do mês). Sem recorte de acesso: quem chama '
  'recorta (ops.fat_contratos_mes, ops.fat_corte).';

-- Quem responde por uma linha: dono, gestor ou substituto da empresa, ou quem recebeu o repasse.
create or replace function receita.fat_comp_pode_responder(_e receita.fat_escopo_t, _emissora uuid, _dono uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(_e.uid is not null and coalesce(_e.porta, false) and (
    _emissora = any (_e.dono) or _emissora = any (_e.gestor) or (_dono is not null and _dono = _e.uid)
    or exists (select 1 from receita.fat_donos d
                where d.emissora_id = _emissora and d.ativo and d.papel = 'dono' and d.substituto_id = _e.uid)), false)
$$;

create or replace function receita.fat_comp_ve(_e receita.fat_escopo_t, _emissora uuid, _dono uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(receita.fat_comp_pode_responder(_e, _emissora, _dono)
      or _emissora = any (_e.tesouraria) or _emissora = any (_e.controladoria), false)
$$;

create or replace function receita.fat_comp_json(_l receita.fat_comp_linha_t, _pode boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', _l.id, 'emissora', jsonb_build_object('id', _l.emissora_id, 'apelido', _l.apelido),
    'codigo_contrato', _l.codigo_contrato, 'numero_contrato', _l.numero_contrato, 'documento', _l.documento,
    'cliente_nome', _l.cliente_nome, 'projeto', _l.projeto, 'servico', _l.servico,
    'dia_faturamento', _l.dia_faturamento, 'data_faturamento', _l.data_faturamento, 'data_corte', _l.data_corte,
    'responder_ate', _l.responder_ate, 'vigencia_final', _l.vigencia_final,
    'valor_contrato', _l.valor_contrato, 'valor_mes_anterior', _l.valor_mes_anterior, 'motivos', to_jsonb(_l.motivos),
    'situacao', _l.situacao, 'valor_faturar', _l.valor_faturar, 'instrucao', _l.instrucao,
    'acao_contrato', _l.acao_contrato, 'pos_corte', _l.pos_corte, 'notas_valor', _l.notas_valor,
    'notas_numeros', _l.notas_numeros, 'aberta', _l.aberta, 'pode_responder', _pode and _l.aberta,
    'resposta', case when _l.resposta is null then null else jsonb_build_object(
      'tipo', _l.resposta, 'valor', _l.valor_resposta, 'permanente', _l.valor_permanente,
      'vigencia', _l.vigencia_resposta, 'motivo', _l.motivo_resposta, 'em', _l.respondido_em,
      'por', receita.fat_pessoa(_l.respondido_por)) end,
    'feito_omie', case when _l.feito_omie_em is null then null else jsonb_build_object(
      'em', _l.feito_omie_em, 'por', receita.fat_pessoa(_l.feito_omie_por)) end,
    'repassado_para', receita.fat_pessoa(_l.dono_id))
$$;

create or replace function receita.fat_comp_procedencia(_emissoras uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contratos_lidos_em', (select min(m.ultimo) from (
        select max(c.sincronizado_em) as ultimo from integracoes.omie_contratos_vigentes c
         where c.emissora_id = any (_emissoras) group by c.emissora_id) m),
    'notas_lidas_em', (select min(m.ultimo) from (
        select max(x.sincronizado_em) as ultimo from integracoes.omie_notas_contrato x
         where x.emissora_id = any (_emissoras) group by x.emissora_id) m),
    'empresas_sem_leitura_hoje', coalesce((
        select jsonb_agg(g.apelido order by g.apelido) from organizacao.empresas_grupo g
         where g.id = any (_emissoras)
           and coalesce((select max(c.sincronizado_em) from integracoes.omie_contratos_vigentes c where c.emissora_id = g.id),
                        '-infinity') < (receita.fat_hoje()::timestamp at time zone 'America/Sao_Paulo')), '[]'::jsonb))
$$;

-- =================================================================================================================
-- 6. API das telas
-- =================================================================================================================
create or replace function ops.fat_contratos_mes(p_competencia date default null, p_emissora uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _comp date;
  _linhas jsonb;
  _empresas jsonb;
  _visiveis uuid[];
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _comp := coalesce(date_trunc('month', p_competencia)::date,
                    (select min(c.competencia) from receita.fat_competencias c
                      where c.competencia >= date_trunc('month', receita.fat_hoje())::date),
                    date_trunc('month', receita.fat_hoje())::date);

  with l as (
    select x as linha, x.emissora_id, x.apelido, x.situacao, x.projeto, x.cliente_nome,
           receita.fat_comp_pode_responder(_e, x.emissora_id, x.dono_id) as pode
      from receita.fat_comp_linhas(_comp) x
     where receita.fat_comp_ve(_e, x.emissora_id, x.dono_id)
  )
  select coalesce(jsonb_agg(receita.fat_comp_json(l.linha, l.pode) order by l.projeto nulls last, l.cliente_nome)
                    filter (where p_emissora is null or l.emissora_id = p_emissora), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', z.emissora_id, 'apelido', z.apelido,
                                                       'precisa_resposta', z.n, 'contratos', z.t) order by z.apelido)
                     from (select l2.emissora_id, l2.apelido, count(*) filter (where l2.situacao = 'precisa_resposta') n,
                                  count(*) t
                             from l l2 group by 1, 2) z), '[]'::jsonb),
         array(select distinct l3.emissora_id from l l3)
    into _linhas, _empresas, _visiveis
    from l;

  return jsonb_build_object(
    'competencia', _comp,
    'competencias', coalesce((select jsonb_agg(distinct c.competencia order by c.competencia)
                                from receita.fat_competencias c
                               where c.competencia >= (date_trunc('month', receita.fat_hoje()) - interval '2 months')::date),
                             '[]'::jsonb),
    'inicio_portal', receita.fat_recorrente_inicio(),
    'empresas', _empresas,
    'linhas', _linhas,
    'responde_por_alguma', (cardinality(_e.dono) + cardinality(_e.gestor)) > 0
                           or exists (select 1 from receita.fat_contrato_donos d where d.dono_id = _e.uid),
    've_tudo', cardinality(_e.controladoria) + cardinality(_e.tesouraria) > 0,
    'procedencia', receita.fat_comp_procedencia(coalesce(_visiveis, '{}')));
end $$;
comment on function ops.fat_contratos_mes(date, uuid) is
  'Contratos do mês (/faturamento/contratos): as linhas que o usuário vê (dono, gestor, substituto, repasse, '
  'tesouraria ou controladoria da empresa), com situação, motivos e se pode responder. Sem p_competencia: o mês '
  'aberto mais próximo.';

create or replace function ops.fat_contrato_detalhe(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _c receita.fat_competencias;
  _l receita.fat_comp_linha_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _c from receita.fat_competencias where id = p_id;
  if not found then raise exception 'Contrato do mês não encontrado.' using errcode = 'P0002'; end if;
  select * into _l from receita.fat_comp_linhas(_c.competencia) x where x.id = p_id;
  if not receita.fat_comp_ve(_e, _l.emissora_id, _l.dono_id) then
    raise exception 'Este contrato não está no seu escopo.' using errcode = '42501';
  end if;
  return receita.fat_comp_json(_l, receita.fat_comp_pode_responder(_e, _l.emissora_id, _l.dono_id))
    || jsonb_build_object(
      'itens', _c.itens, 'vigencia_inicial', _c.vigencia_inicial, 'dia_vencimento', _c.dia_vencimento,
      'notas', coalesce((select jsonb_agg(jsonb_build_object('tipo', n.tipo, 'numero', n.numero, 'emitida_em', n.emitida_em,
                                                             'valor', n.valor, 'cancelada', n.cancelada)
                                          order by n.emitida_em desc)
                           from integracoes.omie_notas_contrato n
                          where n.emissora_id = _c.emissora_id and n.codigo_contrato = _c.codigo_contrato
                            and n.emitida_em >= (_c.competencia - interval '3 months')), '[]'::jsonb),
      'historico', coalesce((select jsonb_agg(jsonb_build_object('evento', v.evento, 'de', v.de, 'para', v.para,
                                                                 'diff', v.diff, 'em', v.em,
                                                                 'autor', receita.fat_pessoa(v.autor_id)) order by v.em)
                               from receita.fat_eventos v where v.entidade = 'competencia' and v.entidade_id = _c.id),
                            '[]'::jsonb));
end $$;
comment on function ops.fat_contrato_detalhe(uuid) is
  'Sheet do contrato: a linha, os itens, as notas dos três meses anteriores (e do mês) e o histórico de respostas.';

create or replace function ops.fat_contrato_responder(p_id uuid, p_resposta text, p_dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _c receita.fat_competencias;
  _l receita.fat_comp_linha_t;
  _valor numeric(14,2);
  _vig date;
  _motivo text := nullif(btrim(coalesce(p_dados ->> 'motivo', '')), '');
  _perm boolean := coalesce((p_dados ->> 'permanente')::boolean, false);
  _de text;
  _n receita.fat_comp_linha_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _c from receita.fat_competencias where id = p_id for update;
  if not found then raise exception 'Contrato do mês não encontrado.' using errcode = 'P0002'; end if;
  select * into _l from receita.fat_comp_linhas(_c.competencia) x where x.id = p_id;
  if not receita.fat_comp_pode_responder(_e, _c.emissora_id, _l.dono_id) then
    raise exception 'Só o dono, o gestor ou quem recebeu o contrato responde.' using errcode = '42501';
  end if;
  if _c.automacao then
    raise exception 'Este contrato sai pela automação do Omie neste mês.' using errcode = '55000';
  end if;
  if now() > _c.responder_ate then
    raise exception 'O prazo para responder este contrato acabou em %.',
      to_char(_c.responder_ate at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') using errcode = '55000';
  end if;
  _de := _l.situacao;
  begin
    _valor := nullif(p_dados ->> 'valor', '')::numeric(14,2);
    _vig := nullif(p_dados ->> 'vigencia', '')::date;
  exception when others then
    perform receita.fat_recusar(receita.fat_erro('p_dados', 'Valor ou data em formato inválido.'));
  end;

  case p_resposta
    when 'confirmar' then
      if 'sumiu' = any (_c.motivos) then
        perform receita.fat_recusar(receita.fat_erro('p_resposta',
          'Este contrato não está vigente no Omie: use "Faturar este mês" com o valor, ou "Cliente saiu".'));
      end if;
      _valor := null; _vig := null; _perm := false;
    when 'ajustar' then
      if _valor is null or _valor <= 0 then perform receita.fat_recusar(receita.fat_erro('valor', 'Informe o valor deste mês.')); end if;
      if _motivo is null then perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo do ajuste.')); end if;
      _vig := null;
    when 'nao_faturar' then
      if _motivo is null then perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva por que não fatura este mês.')); end if;
      _valor := null; _vig := null; _perm := false;
    when 'renovar' then
      if not (_c.motivos && array['vence', 'sumiu']) then
        perform receita.fat_recusar(receita.fat_erro('p_resposta', 'Renovar vale para contrato que vence ou que sumiu.'));
      end if;
      if _vig is null or _vig < _c.data_faturamento then
        perform receita.fat_recusar(receita.fat_erro('vigencia', 'Informe a nova vigência final, depois deste faturamento.'));
      end if;
      _valor := null; _perm := false;
    when 'encerrar' then
      if not ('vence' = any (_c.motivos)) then
        perform receita.fat_recusar(receita.fat_erro('p_resposta', 'Encerrar depois deste mês vale para contrato que vence.'));
      end if;
      _valor := null; _vig := null; _perm := false;
    when 'faturar_mes' then
      if not ('sumiu' = any (_c.motivos)) then
        perform receita.fat_recusar(receita.fat_erro('p_resposta', 'Faturar este mês vale para contrato que sumiu.'));
      end if;
      if _valor is null or _valor <= 0 then perform receita.fat_recusar(receita.fat_erro('valor', 'Informe o valor deste mês.')); end if;
      if _motivo is null then perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo (por exemplo, renovado em contrato novo).')); end if;
      _perm := false;
    when 'cliente_saiu' then
      _valor := null; _vig := null; _perm := false;
    when 'desfazer' then
      if _c.resposta is null then
        perform receita.fat_recusar(receita.fat_erro('p_resposta', 'Não há resposta para desfazer.'));
      end if;
    else
      perform receita.fat_recusar(receita.fat_erro('p_resposta',
        'Resposta desconhecida (confirmar, ajustar, nao_faturar, renovar, encerrar, faturar_mes, cliente_saiu, desfazer).'));
  end case;

  if p_resposta = 'desfazer' then
    update receita.fat_competencias
       set resposta = null, valor_resposta = null, valor_permanente = false, vigencia_resposta = null,
           motivo_resposta = null, respondido_por = null, respondido_em = null, feito_omie_por = null, feito_omie_em = null
     where id = p_id;
  else
    update receita.fat_competencias
       set resposta = p_resposta, valor_resposta = _valor, valor_permanente = _perm and p_resposta = 'ajustar',
           vigencia_resposta = _vig, motivo_resposta = _motivo, respondido_por = _e.uid, respondido_em = now(),
           feito_omie_por = null, feito_omie_em = null
     where id = p_id;
  end if;
  select * into _n from receita.fat_comp_linhas(_c.competencia) x where x.id = p_id;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('competencia', p_id, _c.emissora_id,
          case when p_resposta = 'desfazer' then 'contrato_resposta_desfeita' else 'contrato_respondido' end,
          _de, _n.situacao,
          jsonb_strip_nulls(jsonb_build_object('resposta', p_resposta, 'valor', _valor, 'permanente', nullif(_perm, false),
                                               'vigencia', _vig, 'motivo', _motivo, 'competencia', _c.competencia,
                                               'contrato', _c.numero_contrato)),
          _e.uid);
  return receita.fat_comp_json(_n, true);
end $$;
comment on function ops.fat_contrato_responder(uuid, text, jsonb) is
  'Resposta do dono a um contrato do mês, até o prazo da linha: confirmar, ajustar ({valor, motivo, permanente}), '
  'nao_faturar ({motivo}), renovar ({vigencia}), encerrar, faturar_mes ({valor, motivo, vigencia?}), cliente_saiu '
  '({motivo?}) ou desfazer. Registra em receita.fat_eventos.';

create or replace function ops.fat_contratos_confirmar(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _id uuid;
  _ok int := 0;
  _recusados jsonb := '[]'::jsonb;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    perform receita.fat_recusar(receita.fat_erro('p_ids', 'Selecione ao menos um contrato.'));
  end if;
  if cardinality(p_ids) > 500 then
    perform receita.fat_recusar(receita.fat_erro('p_ids', 'Confirme até 500 contratos por vez.'));
  end if;
  foreach _id in array p_ids loop
    begin
      perform ops.fat_contrato_responder(_id, 'confirmar', '{}'::jsonb);
      _ok := _ok + 1;
    exception when others then
      _recusados := _recusados || jsonb_build_object('id', _id, 'mensagem', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('confirmados', _ok, 'recusados', _recusados);
end $$;
comment on function ops.fat_contratos_confirmar(uuid[]) is
  'Confirmar selecionados: confirma cada linha pelas mesmas regras de ops.fat_contrato_responder; a que não pode '
  'volta em recusados com o motivo.';

create or replace function ops.fat_contrato_pessoas(p_emissora uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if not (p_emissora = any (_e.papel) or p_emissora = any (_e.controladoria)) then
    raise exception 'Esta empresa não está no seu escopo.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.user_id, 'nome', coalesce(nullif(btrim(p.nome), ''), p.email),
                                        'email', p.email) order by coalesce(nullif(btrim(p.nome), ''), p.email))
      from public.profiles p
     where p.user_id <> _e.uid and ops.can_user(p.user_id, 'view.faturamento')), '[]'::jsonb);
end $$;
comment on function ops.fat_contrato_pessoas(uuid) is
  'Quem pode receber o repasse de um contrato: quem já tem acesso ao Faturamento (view.faturamento). Dar acesso a um '
  'sócio novo segue fora do portal.';

create or replace function ops.fat_contrato_repassar(p_id uuid, p_para uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _c receita.fat_competencias;
  _atual uuid;
  _rid uuid;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _c from receita.fat_competencias where id = p_id;
  if not found then raise exception 'Contrato do mês não encontrado.' using errcode = 'P0002'; end if;
  select d.dono_id into _atual from receita.fat_contrato_donos d
   where (d.emissora_id, d.codigo_contrato) = (_c.emissora_id, _c.codigo_contrato);
  if not receita.fat_comp_pode_responder(_e, _c.emissora_id, _atual) then
    raise exception 'Só o dono, o gestor ou quem recebeu o contrato repassa.' using errcode = '42501';
  end if;
  if p_para is null then
    -- Volta para os donos da empresa.
    delete from receita.fat_contrato_donos d
     where (d.emissora_id, d.codigo_contrato) = (_c.emissora_id, _c.codigo_contrato)
    returning d.id into _rid;
  else
    if not ops.can_user(p_para, 'view.faturamento') then
      perform receita.fat_recusar(receita.fat_erro('p_para', 'Essa pessoa ainda não tem acesso ao Faturamento.'));
    end if;
    insert into receita.fat_contrato_donos as d (emissora_id, codigo_contrato, dono_id, repassado_por, repassado_em)
    values (_c.emissora_id, _c.codigo_contrato, p_para, _e.uid, now())
    on conflict (emissora_id, codigo_contrato) do update
       set dono_id = excluded.dono_id, repassado_por = excluded.repassado_por, repassado_em = now()
    returning d.id into _rid;
  end if;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('competencia', p_id, _c.emissora_id, 'contrato_repassado', _atual::text, p_para::text,
          jsonb_build_object('contrato', _c.numero_contrato, 'codigo_contrato', _c.codigo_contrato), _e.uid);
  return jsonb_build_object('id', p_id, 'repassado_para', receita.fat_pessoa(p_para));
end $$;
comment on function ops.fat_contrato_repassar(uuid, uuid) is
  'Repassa o contrato (todos os meses) a outra pessoa com acesso ao Faturamento; p_para nulo devolve aos donos da '
  'empresa. Quem pode: dono, gestor, substituto ou quem tem o repasse.';

create or replace function ops.fat_corte(p_dia date default null, p_emissora uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _hoje date := receita.fat_hoje();
  _dia date;
  _escopo uuid[];
  _linhas jsonb;
  _comp date;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _escopo := array(select distinct u from unnest(_e.tesouraria || _e.controladoria) u);
  if cardinality(_escopo) = 0 then
    raise exception 'A Lista do corte é da tesouraria e da controladoria.' using errcode = '42501';
  end if;
  _dia := coalesce(p_dia,
                   (select min(c.data_corte) from receita.fat_competencias c
                     where not c.automacao and c.emissora_id = any (_escopo) and c.data_corte >= _hoje),
                   (select max(c.data_corte) from receita.fat_competencias c
                     where not c.automacao and c.emissora_id = any (_escopo)));
  _comp := (select min(c.competencia) from receita.fat_competencias c where c.data_corte = _dia);

  select coalesce(jsonb_agg(receita.fat_comp_json(x, false)
                              || jsonb_build_object('motivo_nao_faturar',
                                   case when x.instrucao <> 'nao_faturar' then null
                                        when x.situacao = 'sem_resposta' then 'o dono não respondeu até o prazo'
                                        else coalesce(x.motivo_resposta, case x.situacao when 'encerrado' then 'contrato encerrado' end) end)
                            order by x.apelido, case x.instrucao when 'nao_faturar' then 0 when 'outro_valor' then 1 else 2 end,
                                     (x.acao_contrato is null), x.cliente_nome), '[]'::jsonb)
    into _linhas
    from receita.fat_comp_linhas(_comp) x
   where x.data_corte = _dia and not x.automacao and x.emissora_id = any (_escopo)
     and (p_emissora is null or x.emissora_id = p_emissora)
     -- Contrato já encerrado no Omie sem resposta não é trabalho da tesouraria, a não ser que tenha saído nota.
     and not (x.motivos = array['encerrado_omie'] and x.resposta is null and x.pos_corte is null);

  return jsonb_build_object(
    'dia', _dia,
    'lista_aberta', exists (select 1 from receita.fat_competencias c
                             where c.data_corte = _dia and not c.automacao and now() <= c.responder_ate),
    'fecha_em', (select max(c.responder_ate) from receita.fat_competencias c where c.data_corte = _dia),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('dia', z.data_corte, 'contratos', z.n) order by z.data_corte)
                        from (select c.data_corte, count(*) n from receita.fat_competencias c
                               where not c.automacao and c.emissora_id = any (_escopo)
                                 and c.data_corte >= (date_trunc('month', _hoje) - interval '1 month')::date
                               group by 1) z), '[]'::jsonb),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', z.emissora_id, 'apelido', z.apelido, 'contratos', z.n)
                                           order by z.apelido)
                            from (select x.emissora_id, x.apelido, count(*) n from receita.fat_comp_linhas(_comp) x
                                   where x.data_corte = _dia and not x.automacao and x.emissora_id = any (_escopo)
                                   group by 1, 2) z), '[]'::jsonb),
    'linhas', _linhas,
    'pode_marcar', cardinality(_e.tesouraria) > 0,
    'procedencia', receita.fat_comp_procedencia(_escopo));
end $$;
comment on function ops.fat_corte(date, uuid) is
  'Lista do corte (/faturamento/corte): contratos com corte no dia (padrão: o próximo), com a instrução, a ação no '
  'contrato do Omie e o depois do corte. Só tesouraria e controladoria, no recorte de empresas delas.';

create or replace function ops.fat_corte_feito(p_id uuid, p_feito boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _c receita.fat_competencias;
  _l receita.fat_comp_linha_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _c from receita.fat_competencias where id = p_id for update;
  if not found then raise exception 'Contrato do mês não encontrado.' using errcode = 'P0002'; end if;
  if not _c.emissora_id = any (_e.tesouraria) then
    raise exception 'Só a tesouraria desta empresa marca o que foi feito no Omie.' using errcode = '42501';
  end if;
  select * into _l from receita.fat_comp_linhas(_c.competencia) x where x.id = p_id;
  if _l.acao_contrato is null then
    perform receita.fat_recusar(receita.fat_erro('p_id', 'Este contrato não tem nada a mudar no Omie.'));
  end if;
  update receita.fat_competencias
     set feito_omie_em = case when p_feito then now() end, feito_omie_por = case when p_feito then _e.uid end
   where id = p_id;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('competencia', p_id, _c.emissora_id, case when p_feito then 'contrato_feito_omie' else 'contrato_feito_omie_desfeito' end,
          null, null, jsonb_build_object('acao', _l.acao_contrato, 'contrato', _c.numero_contrato), _e.uid);
  select * into _l from receita.fat_comp_linhas(_c.competencia) x where x.id = p_id;
  return receita.fat_comp_json(_l, false);
end $$;
comment on function ops.fat_corte_feito(uuid, boolean) is
  'Tesouraria marca (ou desmarca) que aplicou no contrato do Omie o que o dono respondeu (renovar, encerrar, mudar o valor).';

-- =================================================================================================================
-- 7. Acesso e agenda
-- =================================================================================================================
revoke all on function integracoes.fat_notas_aplicar(uuid, date, date, jsonb),
                       ops.fat_conector_notas_aplicar(uuid, date, date, jsonb),
                       integracoes.fat_notas_enfileirar(),
                       receita.fat_competencias_gerar(date), receita.fat_competencias_atualizar(),
                       receita.fat_comp_linhas(date),
                       receita.fat_comp_pode_responder(receita.fat_escopo_t, uuid, uuid),
                       receita.fat_comp_ve(receita.fat_escopo_t, uuid, uuid),
                       receita.fat_comp_json(receita.fat_comp_linha_t, boolean), receita.fat_comp_procedencia(uuid[]),
                       receita.fat_dia_util_ate(date), receita.fat_dia_util_antes(date), receita.fat_recorrente_inicio()
  from public, anon, authenticated;
grant execute on function integracoes.fat_notas_aplicar(uuid, date, date, jsonb),
                          ops.fat_conector_notas_aplicar(uuid, date, date, jsonb),
                          integracoes.fat_notas_enfileirar(),
                          receita.fat_competencias_gerar(date), receita.fat_competencias_atualizar()
  to service_role;
revoke all on function ops.fat_contratos_mes(date, uuid), ops.fat_contrato_detalhe(uuid),
                       ops.fat_contrato_responder(uuid, text, jsonb), ops.fat_contratos_confirmar(uuid[]),
                       ops.fat_contrato_pessoas(uuid), ops.fat_contrato_repassar(uuid, uuid),
                       ops.fat_corte(date, uuid), ops.fat_corte_feito(uuid, boolean)
  from public, anon;
grant execute on function ops.fat_contratos_mes(date, uuid), ops.fat_contrato_detalhe(uuid),
                          ops.fat_contrato_responder(uuid, text, jsonb), ops.fat_contratos_confirmar(uuid[]),
                          ops.fat_contrato_pessoas(uuid), ops.fat_contrato_repassar(uuid, uuid),
                          ops.fat_corte(date, uuid), ops.fat_corte_feito(uuid, boolean)
  to authenticated;

select cron.unschedule(j) from unnest(array['faturamento-omie-notas', 'faturamento-omie-notas-dia',
                                            'faturamento-competencias']) j
 where exists (select 1 from cron.job where jobname = j);
-- 6h30 de São Paulo = 9h30 UTC; 12h e 16h = 15h e 19h UTC em dia útil.
select cron.schedule('faturamento-omie-notas', '30 9 * * *', $cron$ select integracoes.fat_notas_enfileirar(); $cron$);
select cron.schedule('faturamento-omie-notas-dia', '0 15,19 * * 1-5', $cron$ select integracoes.fat_notas_enfileirar(); $cron$);
select cron.schedule('faturamento-competencias', '45 * * * *', $cron$ select receita.fat_competencias_atualizar(); $cron$);

do $conferencia$
declare n int;
begin
  if has_table_privilege('authenticated', 'receita.fat_competencias', 'select')
     or has_table_privilege('authenticated', 'integracoes.omie_notas_contrato', 'select')
     or has_table_privilege('authenticated', 'receita.fat_contrato_donos', 'select') then
    raise exception 'E2: authenticated lê tabela do recorrente';
  end if;
  if has_function_privilege('authenticated', 'receita.fat_comp_linhas(date)', 'execute')
     or has_function_privilege('authenticated', 'receita.fat_competencias_gerar(date)', 'execute') then
    raise exception 'E2: authenticated executa função interna do recorrente';
  end if;
  select count(*) into n from cron.job
   where jobname in ('faturamento-omie-notas', 'faturamento-omie-notas-dia', 'faturamento-competencias') and active;
  if n <> 3 then raise exception 'E2: % dos 3 jobs ativos', n; end if;
end $conferencia$;

commit;
