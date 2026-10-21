-- Portal de Faturamento · T1b, a API das telas e do conector (20/10/2026).
--
-- Contrato da API (assinaturas e JSON de retorno): PM Work/execution/portal-faturamento-prd-20261013/e1/API.md.
-- Plano: e1/PLANO-E1.md (API, linha T1b). Spec: spec-portal-faturamento.md §4, §5, §7, §12 e §13.3. Contratos de tela:
-- docs/design/contratos/faturamento*.md (seções "Lacunas"). Decisões do Pedro de 20/10 no DECISIONS.md (ninguém dá o OK
-- no próprio pedido; rascunho descartado vira cancelado "descartado pelo autor").
-- Depende de: 20261015150000_portal_faturamento_f1, 20261020100000_portal_faturamento_t1a e
-- 20261020101000_portal_faturamento_servicos_e0, aplicadas antes desta.
-- Ensaio e gates (begin … rollback): supabase/gates/20261020_portal_faturamento_t1b.sql
-- Rollback: supabase/rollback/20261020120000_portal_faturamento_t1b_rollback.sql
--
-- O que faz:
--   1. Colunas que as telas e o conector pedem em receita.fat_pedidos (quem enviou, chegada na fila, simulação, dados
--      lidos do Omie, foto do tomador no envio), receita.fat_departamentos (as 19 opções do pipe), fat_servicos.no_omie,
--      fat_eventos com as entidades emissora e servico, omie_envios com modo, depende_de e as operações alterar_os e
--      sincronizar_servicos, pipefy_envios.seq, integracoes.omie_emissora_estado e integracoes.receita_cnpj.
--   2. A máquina de estados: receita.fat_transicao é a única que muda fat_pedidos.status (gatilho recusa o resto),
--      grava fat_eventos com diff e autor e enfileira o Pipefy.
--   3. As regras: OK nunca de quem enviou nem do autor; devolver e cancelar com motivo; parcelas geradas ao entrar na
--      fila; competência padrão; documento com dígito verificador; e-mails; serviço da emissora, liberado e com
--      tributação; aviso de contrato em outra empresa (RF-P03) por ops.omie_contratos_servico.
--   4. As RPCs das telas (ops.fat_*, security definer, porta conferida na primeira linha com ops.can) e do conector
--      (integracoes.*, só service_role).
--
-- Quem lê o quê: o navegador continua sem ler nem gravar tabela do portal. Tudo vai pelas RPCs.

begin;

-- =================================================================================================================
-- 1. Tabelas e colunas
-- =================================================================================================================

-- 1.1 Departamentos (a mesma lista do Contas a Pagar, campo `departamento` do pipe 307098392, lida em 20/10/2026)
create table receita.fat_departamentos (
  nome text primary key check (nome <> '' and nome = btrim(nome)),
  ordem smallint not null unique check (ordem > 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table receita.fat_departamentos is
  'Domínio Receita e Repasses. Dono: Controladoria (Ana Carvalhais). Opções do campo Departamento do pedido: as 19 do '
  'campo departamento do pipe 307098392 (Contas a Receber), as mesmas do Contas a Pagar, lidas em 20/10/2026 '
  '(e1/pipefy-307098392-mapa.md §2). Lida pela tela por ops.fat_departamentos(). Desativar em vez de apagar: pedido '
  'antigo aponta para o nome.';
create trigger fat_departamentos_updated_at before update on receita.fat_departamentos
  for each row execute function receita.tocar_updated_at();

insert into receita.fat_departamentos (nome, ordem) values
  ('Facilities', 1), ('Financeiro', 2), ('Comercial', 3), ('Gente e Gestão', 4), ('Marketing', 5),
  ('Sucesso do Cliente', 6), ('Gestão de Risco', 7), ('Tecnologia', 8), ('Implantação', 9), ('Jurídico', 10),
  ('Operação', 11), ('Contábil', 12), ('Fiscal', 13), ('Sócios', 14), ('Folha', 15), ('Negócios Estruturados', 16),
  ('Expansão', 17), ('Finance', 18), ('Controladoria', 19);

alter table receita.fat_departamentos enable row level security;
revoke all on receita.fat_departamentos from public, anon, authenticated, service_role;
grant select on receita.fat_departamentos to service_role;

-- 1.2 receita.fat_pedidos: o que as telas e o conector pedem
alter table receita.fat_pedidos
  add column enviado_por uuid references auth.users (id),
  add column enviado_em timestamptz,
  add column status_em timestamptz not null default now(),
  add column na_fila_em timestamptz,
  add column conferido_por uuid references auth.users (id),
  add column faturado_em timestamptz,
  add column simulacao boolean not null default false,
  add column omie_os_etapa text,
  add column omie_nf_emitida_em timestamptz,
  add column omie_lido_em timestamptz,
  add column tomador_municipio text,
  add column tomador_uf text check (tomador_uf ~ '^[A-Z]{2}$'),
  add column tomador_situacao text,
  add constraint fat_pedidos_parcelas_max check (parcelas <= 36),
  add constraint fat_pedidos_departamento_fk foreign key (departamento)
    references receita.fat_departamentos (nome) on update cascade;

-- Pedir cancelamento não exige o pedido completo (um devolvido pode estar a meio da correção).
alter table receita.fat_pedidos drop constraint fat_pedidos_completo;
alter table receita.fat_pedidos add constraint fat_pedidos_completo check (
  status in ('rascunho', 'devolvido', 'cancelamento_pedido', 'cancelado')
  or (tomador_tipo is not null and tomador_documento is not null and nullif(btrim(tomador_nome), '') is not null
      and servico_id is not null and nullif(btrim(descricao_nf), '') is not null and valor is not null
      and forma is not null and parcelas is not null and primeiro_vencimento is not null
      and competencia is not null and documento is not null and meio is not null and dono_id is not null));

comment on column receita.fat_pedidos.enviado_por is 'Quem enviou por último (o OK nunca vem dele nem do autor).';
comment on column receita.fat_pedidos.enviado_em is
  'Primeiro envio. Nulo = nunca enviado: só o autor vê o pedido (rascunho, ou descartado antes de enviar).';
comment on column receita.fat_pedidos.status_em is 'Quando a situação mudou pela última vez ("desde quando").';
comment on column receita.fat_pedidos.na_fila_em is
  'Quando o pedido chegou à fila do Omie (depois do OK, ou do envio pelo dono). É o "dia de chegada" da tesouraria. '
  'Reenviar depois de erro não muda a chegada; reenviar depois de devolução muda.';
comment on column receita.fat_pedidos.conferido_por is 'Quem da tesouraria marcou Em conferência.';
comment on column receita.fat_pedidos.faturado_em is
  'Quando o pedido virou faturado pela primeira vez. Régua de "Faturado no mês" quando a data da nota não veio.';
comment on column receita.fat_pedidos.simulacao is
  'O pedido passou pelo Omie em simulação (modo_omie = simular). Continua simulado até o fim; fica fora dos números '
  'de Meu faturamento.';
comment on column receita.fat_pedidos.omie_os_etapa is 'Etapa da OS no Omie (cEtapa), da última leitura.';
comment on column receita.fat_pedidos.omie_nf_emitida_em is 'Emissão da NFS-e no Omie (régua de "Faturado no mês").';
comment on column receita.fat_pedidos.omie_lido_em is 'Última leitura de status no Omie (RF-P09).';
comment on column receita.fat_pedidos.tomador_situacao is
  'Situação na Receita no envio (integracoes.receita_cnpj). Nula = não conferida.';

create index fat_pedidos_status_idx on receita.fat_pedidos (status, status_em);
create index fat_pedidos_enviado_por_idx on receita.fat_pedidos (enviado_por);

-- Só receita.fat_transicao muda a situação: ela marca a transação com o id do pedido antes do UPDATE.
create or replace function receita.fat_pedidos_status_guarda()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('receita.fat_transicao', true), '') <> new.id::text then
    raise exception 'A situação do pedido % só muda por receita.fat_transicao (máquina de estados do portal).', new.numero
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger fat_pedidos_status_guarda before update of status on receita.fat_pedidos
  for each row execute function receita.fat_pedidos_status_guarda();

-- 1.3 fat_servicos: o serviço ainda está (ativo) no Omie?
alter table receita.fat_servicos add column no_omie boolean not null default true;
comment on column receita.fat_servicos.no_omie is
  'Estava presente e ativo no Omie na última sincronização. false = sumiu ou ficou inativo lá: sai do pedido.';

-- 1.4 fat_eventos: a configuração da emissora e do serviço também vira evento
alter table receita.fat_eventos drop constraint fat_eventos_entidade_check;
alter table receita.fat_eventos add constraint fat_eventos_entidade_check
  check (entidade in ('pedido', 'contrato', 'item', 'competencia', 'dono', 'emissora', 'servico'));

-- 1.5 Fila do Omie: modo congelado no envio, dependência e operações novas
alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
  'garantir_cliente', 'incluir_os', 'alterar_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os',
  'sincronizar_servicos'));
alter table integracoes.omie_envios drop constraint omie_envios_origem_check;
alter table integracoes.omie_envios add constraint omie_envios_origem_check
  check (origem in ('fat_pedido', 'fat_contrato', 'fat_competencia', 'fat_emissora'));
alter table integracoes.omie_envios
  add column modo text not null default 'simular' check (modo in ('simular', 'gravar')),
  add column depende_de uuid references integracoes.omie_envios (id);
create index omie_envios_depende_idx on integracoes.omie_envios (depende_de) where depende_de is not null;

comment on column integracoes.omie_envios.modo is
  'modo_omie da emissora no momento em que o envio entrou na fila (simular: só lê e responde simulado; gravar: grava). '
  'Ligar a gravação vale para o próximo envio. Pedido já simulado fatura em simulação.';
comment on column integracoes.omie_envios.depende_de is
  'Envio que precisa terminar (ok ou simulado) antes deste: incluir_os e alterar_os dependem do garantir_cliente.';
comment on column integracoes.omie_envios.payload is
  'Entrada do conector: a foto dos dados do portal quando o envio entrou na fila (versao 1, ver e1/API.md §2.2), sem '
  'app_key nem app_secret. O param do Omie quem monta é o conector, e ele o devolve em resposta.';
comment on column integracoes.omie_envios.resposta is
  'O que o conector devolveu (param montado e resposta do Omie, sem chave) e, em resposta.codigos, os códigos que o '
  'banco aplicou (nCodOS, cliente, nota).';

-- 1.6 Fila do Pipefy: ordem de chegada (um pedido nunca move a fase antes de o card existir)
alter table integracoes.pipefy_envios add column seq bigint generated always as identity;
create index pipefy_envios_origem_seq_idx on integracoes.pipefy_envios (origem, origem_id, seq);
comment on column integracoes.pipefy_envios.seq is 'Ordem de chegada na fila; o conector processa cada pedido nessa ordem.';
comment on column integracoes.pipefy_envios.payload is
  'Entrada do conector (versao 1, ver e1/API.md §2.7): a foto do pedido no criar_card; de, para e motivo no '
  'mover_fase. Sem token. A mutation montada volta em resposta.';

-- 1.7 Estado do Omie por emissora (bloqueio por MISUSE/425, indisponível por 403 ou aplicativo suspenso)
create table integracoes.omie_emissora_estado (
  emissora_id uuid primary key references organizacao.empresas_grupo (id),
  bloqueada_ate timestamptz,
  indisponivel boolean not null default false,
  motivo text,
  ultimo_ok_em timestamptz,
  ultima_falha_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not indisponivel or nullif(btrim(motivo), '') is not null)
);
comment on table integracoes.omie_emissora_estado is
  'Domínio Integrações. Dono: Integrações (conector do Omie, T2). Estado do Omie de cada emissora: bloqueada_ate para '
  'a fila dela (MISUSE_API_PROCESS bloqueia a chave por ~238 s; repetir estende o bloqueio) e indisponivel com o '
  'motivo legível (403, aplicativo suspenso). As outras emissoras seguem (CA-12). Gravado por '
  'integracoes.fat_envio_resultado; lido pelas telas pelas RPCs ops.fat_*.';
create trigger omie_emissora_estado_updated_at before update on integracoes.omie_emissora_estado
  for each row execute function integracoes.tocar_updated_at();

-- 1.8 Consulta à Receita (cache): é daqui que sai o bloqueio de CNPJ inapto (RF-P02, CA-05)
create table integracoes.receita_cnpj (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  razao_social text,
  nome_fantasia text,
  situacao text check (situacao = upper(btrim(situacao)) and situacao <> ''),
  situacao_desde date,
  municipio text,
  uf text check (uf ~ '^[A-Z]{2}$'),
  emails text[] not null default '{}',
  fonte text not null check (btrim(fonte) <> ''),
  consultado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table integracoes.receita_cnpj is
  'Domínio Integrações. Dono: Integrações. Última consulta da situação cadastral de cada CNPJ na Receita (CNPJá aberta '
  'ou outra fonte), gravada só pelo service_role (integracoes.receita_cnpj_gravar), nunca pelo navegador. '
  'ops.fat_tomador lê daqui nome, município e situação; o envio do pedido recusa CNPJ com situação conhecida diferente '
  'de ATIVA. O banco único não tinha situação cadastral (ops.base_enriquecimento_cnpj só tem regime e segmento).';
create trigger receita_cnpj_updated_at before update on integracoes.receita_cnpj
  for each row execute function integracoes.tocar_updated_at();

alter table integracoes.omie_emissora_estado enable row level security;
alter table integracoes.receita_cnpj enable row level security;
revoke all on integracoes.omie_emissora_estado, integracoes.receita_cnpj from public, anon, authenticated, service_role;
grant select, insert, update on integracoes.omie_emissora_estado, integracoes.receita_cnpj to service_role;

-- =================================================================================================================
-- 2. Funções internas (receita): regras puras, escopo, ações
-- =================================================================================================================

create or replace function receita.fat_hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create or replace function receita.fat_dias_uteis(_de date, _ate date)
returns integer language sql immutable set search_path = '' as $$
  select count(*)::int from generate_series(_de + 1, _ate, interval '1 day') d where extract(isodow from d) < 6
$$;
comment on function receita.fat_dias_uteis(date, date) is
  'Dias úteis (segunda a sexta) depois de _de até _ate. Sem feriados: o calendário com feriados é da E3.';

create or replace function receita.fat_status_rotulo(_s text)
returns text language sql immutable set search_path = '' as $$
  select case _s
    when 'rascunho' then 'Rascunho' when 'aguardando_ok' then 'Aguardando OK' when 'devolvido' then 'Devolvido'
    when 'na_fila_omie' then 'Na fila do Omie' when 'simulado' then 'Simulado' when 'erro_omie' then 'Erro no Omie'
    when 'os_criada' then 'OS criada' when 'em_conferencia' then 'Em conferência' when 'faturado' then 'Faturado'
    when 'recebido' then 'Recebido' when 'em_atraso' then 'Em atraso'
    when 'cancelamento_pedido' then 'Cancelamento pedido' when 'cancelado' then 'Cancelado' else _s end
$$;

-- Documento: CPF (11) ou CNPJ (14) só com dígitos e dígito verificador certo.
create or replace function receita.fat_documento_valido(_doc text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d int[];
  s int;
  r int;
  i int;
  p1 constant int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  p2 constant int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
begin
  if _doc is null then return false; end if;
  if _doc ~ '^[0-9]{11}$' then
    if _doc ~ '^(.)\1{10}$' then return false; end if;
    d := array(select substr(_doc, g, 1)::int from generate_series(1, 11) g);
    s := 0; for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0; for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  elsif _doc ~ '^[0-9]{14}$' then
    if _doc ~ '^(.)\1{13}$' then return false; end if;
    d := array(select substr(_doc, g, 1)::int from generate_series(1, 14) g);
    s := 0; for i in 1..12 loop s := s + d[i] * p1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> d[13] then return false; end if;
    s := 0; for i in 1..13 loop s := s + d[i] * p2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = d[14];
  end if;
  return false;
end $$;

create or replace function receita.fat_email_valido(_e text)
returns boolean language sql immutable set search_path = '' as $$
  select _e is not null and char_length(_e) <= 254
     and _e ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
$$;

-- Parcelas (RNF-04, §5.2): valor ÷ parcelas truncado nos centavos, a última leva a sobra; vencimento no mesmo dia dos
-- meses seguintes, ou no último dia do mês quando o dia não existe (somar meses a partir do 1º vencimento faz isso).
create or replace function receita.fat_parcelas_calcular(_valor numeric, _parcelas integer, _primeiro date)
returns table (n integer, vencimento date, valor numeric)
language plpgsql immutable set search_path = '' as $$
declare
  _base numeric;
begin
  if _valor is null or _valor <= 0 then
    raise exception 'O valor precisa ser maior que zero.' using errcode = '22023',
      detail = '{"erros":[{"campo":"valor","mensagem":"O valor precisa ser maior que zero."}]}';
  end if;
  if _valor <> round(_valor, 2) then
    raise exception 'O valor tem mais de 2 casas decimais.' using errcode = '22023',
      detail = '{"erros":[{"campo":"valor","mensagem":"O valor tem mais de 2 casas decimais."}]}';
  end if;
  if _parcelas is null or _parcelas < 1 or _parcelas > 36 then
    raise exception 'O número de parcelas vai de 1 a 36.' using errcode = '22023',
      detail = '{"erros":[{"campo":"parcelas","mensagem":"O número de parcelas vai de 1 a 36."}]}';
  end if;
  if _primeiro is null then
    raise exception 'Informe o 1º vencimento.' using errcode = '22023',
      detail = '{"erros":[{"campo":"primeiro_vencimento","mensagem":"Informe o 1º vencimento."}]}';
  end if;
  _base := trunc(_valor / _parcelas, 2);
  if _base < 0.01 then
    raise exception 'Valor pequeno demais para % parcelas.', _parcelas using errcode = '22023',
      detail = '{"erros":[{"campo":"parcelas","mensagem":"Valor pequeno demais para esse número de parcelas."}]}';
  end if;
  return query
    select g, (_primeiro + make_interval(months => g - 1))::date,
           case when g = _parcelas then _valor - _base * (_parcelas - 1) else _base end
      from generate_series(1, _parcelas) g;
end $$;
comment on function receita.fat_parcelas_calcular(numeric, integer, date) is
  'Regra única das parcelas: a prévia da tela (ops.fat_parcelas_previa) e as gravadas ao entrar na fila usam esta.';

-- Recusa de validação: 22023 com {"erros":[{campo, mensagem}]} em DETAIL.
create or replace function receita.fat_recusar(_erros jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception '%', case when jsonb_array_length(_erros) = 1 then _erros -> 0 ->> 'mensagem'
                            else 'Pedido incompleto ou com erro.' end
    using errcode = '22023', detail = jsonb_build_object('erros', _erros)::text;
end $$;

create or replace function receita.fat_erro(_campo text, _mensagem text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_array(jsonb_build_object('campo', _campo, 'mensagem', _mensagem))
$$;

create or replace function receita.fat_pessoa(_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case when _id is null then null else coalesce(
    (select jsonb_build_object('id', p.user_id, 'nome', coalesce(nullif(btrim(p.nome), ''), p.email))
       from public.profiles p where p.user_id = _id),
    jsonb_build_object('id', _id, 'nome', null)) end
$$;

create or replace function receita.fat_diff(_antes jsonb, _depois jsonb, _campos text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(c, jsonb_build_object('de', coalesce(_antes -> c, 'null'::jsonb),
                                                         'para', coalesce(_depois -> c, 'null'::jsonb))), '{}'::jsonb)
    from unnest(_campos) c
   where coalesce(_antes -> c, 'null'::jsonb) is distinct from coalesce(_depois -> c, 'null'::jsonb)
$$;

-- 2.1 Escopo de quem chama (uma leitura por RPC)
create type receita.fat_escopo_t as (
  uid uuid,
  porta boolean,
  admin boolean,
  tesouraria uuid[],
  controladoria uuid[],
  gestor uuid[],
  dono uuid[],
  papel uuid[]
);
comment on type receita.fat_escopo_t is
  'Escopo de quem chama no portal: porta (view.faturamento), admin, e as emissoras em que é tesouraria, controladoria '
  '(chave da área + recorte de empresas), gestor, dono, e com qualquer papel ativo em fat_donos.';

create or replace function receita.fat_escopo()
returns receita.fat_escopo_t language plpgsql stable security definer set search_path = '' as $$
declare
  e receita.fat_escopo_t;
  _recorte uuid[];
begin
  e.uid := auth.uid();
  e.porta := e.uid is not null and ops.can('view.faturamento');
  e.admin := false;
  e.tesouraria := '{}'; e.controladoria := '{}'; e.gestor := '{}'; e.dono := '{}'; e.papel := '{}';
  if not e.porta then return e; end if;
  e.admin := ops.eh_super_admin(e.uid);
  if coalesce((select x.todas_empresas from ops.usuario_escopo x where x.user_id = e.uid), false) then
    _recorte := array(select g.id from organizacao.empresas_grupo g);
  else
    _recorte := array(select ue.empresa_id from ops.usuario_empresas ue where ue.user_id = e.uid);
  end if;
  if ops.can('edit.faturamento_tesouraria') then e.tesouraria := _recorte; end if;
  if ops.can('admin.faturamento') then e.controladoria := _recorte; end if;
  select coalesce(array_agg(distinct d.emissora_id) filter (where d.papel = 'gestor'), '{}'),
         coalesce(array_agg(distinct d.emissora_id) filter (where d.papel = 'dono'), '{}'),
         coalesce(array_agg(distinct d.emissora_id), '{}')
    into e.gestor, e.dono, e.papel
    from receita.fat_donos d
   where d.user_id = e.uid and d.ativo;
  return e;
end $$;

create or replace function receita.fat_exigir_porta(_e receita.fat_escopo_t)
returns void language plpgsql stable set search_path = '' as $$
begin
  if _e.uid is null or not coalesce(_e.porta, false) then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
end $$;

-- 2.2 Quem vê o pedido (CA-09) e as pendências
create or replace function receita.fat_ve(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(_e.porta, false) and _e.uid is not null
     and (_p.enviado_em is not null or _p.solicitante_id = _e.uid)
     and (_p.emissora_id = any (_e.tesouraria) or _p.emissora_id = any (_e.controladoria)
          or _p.emissora_id = any (_e.gestor)
          or _p.dono_id = _e.uid or _p.solicitante_id = _e.uid or _p.enviado_por = _e.uid
          or exists (select 1 from receita.fat_donos d
                      where d.emissora_id = _p.emissora_id and d.user_id = _p.dono_id and d.papel = 'dono'
                        and d.ativo and d.substituto_id = _e.uid))
$$;

create or replace function receita.fat_e_substituto(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from receita.fat_donos d
                  where d.emissora_id = _p.emissora_id and d.user_id = _p.dono_id and d.papel = 'dono'
                    and d.ativo and d.substituto_id = _e.uid)
$$;

create or replace function receita.fat_pend_ok(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns boolean language sql stable set search_path = '' as $$
  select _p.status = 'aguardando_ok'
     and _e.uid is distinct from _p.solicitante_id and _e.uid is distinct from _p.enviado_por
     and ((_p.dono_id = _e.uid and _p.emissora_id = any (_e.dono))
          or receita.fat_e_substituto(_e, _p)
          or (_p.emissora_id = any (_e.gestor)
              and receita.fat_dias_uteis((_p.status_em at time zone 'America/Sao_Paulo')::date, receita.fat_hoje()) >= 2))
$$;

create or replace function receita.fat_pend_devolvido(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns boolean language sql stable set search_path = '' as $$
  select _p.status = 'devolvido' and (_p.solicitante_id = _e.uid or _p.enviado_por = _e.uid)
$$;

create or replace function receita.fat_pend_erro(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns boolean language sql stable set search_path = '' as $$
  select _p.status = 'erro_omie'
     and (_p.solicitante_id = _e.uid or _p.enviado_por = _e.uid or _p.dono_id = _e.uid
          or _p.emissora_id = any (_e.tesouraria))
$$;

-- 2.3 O que quem chama pode fazer agora com o pedido (a ficha mostra; as RPCs de ação conferem de novo)
create or replace function receita.fat_acoes(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  autor boolean := _p.solicitante_id = _e.uid;
  enviou boolean := _p.enviado_por is not distinct from _e.uid;
  dono boolean := _p.dono_id = _e.uid and _p.emissora_id = any (_e.dono);
  subst boolean := receita.fat_e_substituto(_e, _p);
  gestor boolean := _p.emissora_id = any (_e.gestor);
  tes boolean := _p.emissora_id = any (_e.tesouraria);
  pede boolean := _p.emissora_id = any (_e.papel);
  tem_os boolean := _p.omie_os_codigo is not null;
  rotulo text := receita.fat_status_rotulo(_p.status);
  apelido text := (select g.apelido from organizacao.empresas_grupo g where g.id = _p.emissora_id);
  faturando boolean;
  em_curso boolean;
  faturado_ok boolean;
  r jsonb := '{}'::jsonb;

  -- pode / não pode, com o código do motivo (42501 papel, 55000 situação)
  sim constant jsonb := '{"pode": true, "motivo": null, "codigo": null}';
begin
  select coalesce(bool_or(x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')), false),
         coalesce(bool_or(x.status = 'processando'), false),
         coalesce(bool_or(x.operacao = 'faturar_os' and x.status = 'ok'), false)
    into faturando, em_curso, faturado_ok
    from integracoes.omie_envios x
   where x.origem = 'fat_pedido' and x.origem_id = _p.id;

  -- editar e enviar
  r := r || jsonb_build_object('editar', case
    when _p.status = 'rascunho' then case
      when not autor then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Só quem escreveu o rascunho mexe nele.')
      when not pede then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', format('Você não pede mais faturamento pela %s.', apelido))
      else sim end
    when _p.status = 'devolvido' then case
      when (autor and pede) or dono or gestor then sim
      else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem corrige o devolvido é o autor, o dono ou o gestor.') end
    else jsonb_build_object('pode', false, 'codigo', '55000',
           'motivo', format('Pedido em %s: só volta a ser editável se for devolvido.', rotulo)) end);
  r := r || jsonb_build_object('enviar', r -> 'editar');

  -- descartar
  r := r || jsonb_build_object('descartar', case
    when _p.status not in ('rascunho', 'devolvido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', format('Pedido em %s não se descarta.', rotulo))
    when not autor then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Só o autor descarta o pedido.')
    when tem_os then jsonb_build_object('pode', false, 'codigo', '55000',
           'motivo', format('A OS %s já existe no Omie da %s: peça o cancelamento.', _p.omie_os_codigo, apelido))
    else sim end);

  -- dar o OK
  r := r || jsonb_build_object('aprovar', case
    when _p.status <> 'aguardando_ok' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só pedido Aguardando OK recebe o OK.')
    when autor or enviou then
      jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem enviou não dá o OK no próprio pedido.')
    when dono or subst or gestor then sim
    else jsonb_build_object('pode', false, 'codigo', '42501',
           'motivo', format('Só o dono, o substituto dele ou o gestor da %s dá o OK.', apelido)) end);

  -- devolver
  r := r || jsonb_build_object('devolver', case
    when _p.status = 'aguardando_ok' then case
      when dono or subst or gestor then sim
      else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Antes do OK, quem devolve é o dono, o substituto ou o gestor.') end
    when _p.status in ('simulado', 'os_criada', 'em_conferencia', 'erro_omie') then case
      when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Depois do Omie, quem devolve é a tesouraria.')
      when faturando or em_curso then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Há um envio ao Omie em curso: espere a resposta.')
      else sim end
    else jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', format('Pedido em %s não se devolve.', rotulo)) end);

  -- reenviar
  r := r || jsonb_build_object('reenviar', case
    when _p.status <> 'erro_omie' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só pedido com erro no Omie se reenvia.')
    when not (autor or enviou or dono or tes) then
      jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Reenvia o autor, o dono ou a tesouraria.')
    when em_curso then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Há um envio ao Omie em curso: espere a resposta.')
    else sim end);

  -- pedir cancelamento (dono, substituto, gestor) e confirmar (tesouraria)
  r := r || jsonb_build_object('pedir_cancelamento', case
    when _p.status = 'rascunho' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Rascunho se descarta, não se cancela.')
    when _p.status = 'cancelamento_pedido' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'O cancelamento já foi pedido.')
    when _p.status = 'cancelado' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido já cancelado.')
    when dono or subst or gestor then sim
    else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem pede o cancelamento é o dono, o substituto ou o gestor.') end);
  r := r || jsonb_build_object('confirmar_cancelamento', case
    when _p.status <> 'cancelamento_pedido' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Não há cancelamento pedido.')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem confirma o cancelamento é a tesouraria.')
    else sim end);

  -- tesouraria: conferir e faturar
  r := r || jsonb_build_object('conferir', case
    when _p.status = 'em_conferencia' then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Já está em conferência.')
    when _p.status not in ('os_criada', 'simulado') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só dá para conferir depois de a OS existir no Omie (ou ser simulada).')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem confere é a tesouraria.')
    else sim end);
  r := r || jsonb_build_object('faturar', case
    when faturado_ok or _p.status in ('faturado', 'em_atraso', 'recebido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido já faturado.')
    when _p.status not in ('os_criada', 'simulado', 'em_conferencia') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só dá para faturar depois de a OS existir no Omie.')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem fatura é a tesouraria.')
    when faturando then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Faturando: espere a resposta do Omie.')
    when not tem_os and not _p.simulacao then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'O pedido ainda não tem OS no Omie.')
    else sim end);

  -- atualizar a situação no Omie (quem vê o pedido)
  r := r || jsonb_build_object('atualizar_status', case
    when _p.simulacao then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido simulado: não há OS no Omie para ler.')
    when not tem_os or _p.status not in ('os_criada', 'em_conferencia', 'faturado', 'em_atraso', 'recebido', 'cancelamento_pedido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Ainda não há OS no Omie para ler.')
    else sim end);
  return r;
end $$;

create or replace function receita.fat_exigir(_e receita.fat_escopo_t, _p receita.fat_pedidos, _acao text)
returns void language plpgsql stable set search_path = '' as $$
declare
  a jsonb := receita.fat_acoes(_e, _p) -> _acao;
begin
  if a is null then raise exception 'Ação desconhecida: %', _acao using errcode = '22023'; end if;
  if not (a ->> 'pode')::boolean then
    raise exception '%', a ->> 'motivo' using errcode = a ->> 'codigo';
  end if;
end $$;

-- 2.4 Contrato vigente do tomador em outra empresa do grupo (RF-P03, CA-04). Na E1 a fonte é ops.omie_contratos_servico,
--     que lê o Omie das unidades: a empresa do contrato sai do CNPJ da unidade (Rio de Janeiro = PRJ) e de Planning
--     Partners (Matriz) = PARTNERS. Contrato de unidade franqueada não é de empresa do grupo e não gera aviso. Com
--     contrato vigente na própria emissora escolhida, também não há aviso.
create or replace function receita.fat_contratos_vigentes(_doc text)
returns table (emissora_id uuid, apelido text, unidade text, numero text, valor_mensal numeric, vigencia_inicial date,
               vigencia_final date, sincronizado_em timestamptz)
language sql stable set search_path = '' as $$
  with mapa as (
    select distinct c.unidade, g.id as emissora_id, g.apelido
      from ops.omie_credentials c
      left join ops.unidades u on u.id = c.unidade_id
      join organizacao.empresas_grupo g
        on g.cnpj = any (array(select regexp_replace(x, '\D', '', 'g')
                                 from regexp_split_to_table(coalesce(u.cnpj, ''), E'[\\n,;]+') x))
        or (c.unidade = 'Planning Partners (Matriz)' and g.id = '769854a7-0b0b-48e2-ace8-9b0636e19a56')
  )
  select m.emissora_id, m.apelido, k.unidade, k.numero, k.valor_mensal, k.vigencia_inicial, k.vigencia_final,
         k.sincronizado_em
    from ops.omie_contratos_servico k
    join mapa m on m.unidade = k.unidade
   where _doc is not null and k.cnpj_digitos = _doc and k.situacao = '10'
     and (k.vigencia_final is null or k.vigencia_final >= receita.fat_hoje())
$$;

create or replace function receita.fat_contratos_outra_emissora(_doc text, _emissora uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when _emissora is not null and exists (select 1 from receita.fat_contratos_vigentes(_doc) v where v.emissora_id = _emissora)
      then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'emissora', jsonb_build_object('id', v.emissora_id, 'apelido', v.apelido), 'unidade', v.unidade,
               'numero', v.numero, 'valor_mensal', v.valor_mensal, 'vigencia_inicial', v.vigencia_inicial,
               'vigencia_final', v.vigencia_final) order by v.apelido, v.numero)
        from receita.fat_contratos_vigentes(_doc) v
       where _emissora is null or v.emissora_id <> _emissora), '[]'::jsonb) end
$$;

-- 2.5 Situação na Receita: bloqueio (RF-P02, CA-05)
create or replace function receita.fat_bloqueio(_doc text)
returns text language sql stable set search_path = '' as $$
  select case when r.situacao is not null and r.situacao <> 'ATIVA'
              then format('CNPJ %s na Receita%s. O envio fica bloqueado.', r.situacao,
                          case when r.situacao_desde is not null then ' desde ' || to_char(r.situacao_desde, 'DD/MM/YYYY') else '' end)
         end
    from integracoes.receita_cnpj r
   where r.cnpj = _doc
$$;

-- 2.6 O que falta para o pedido poder ser enviado (lista de {campo, mensagem}; vazia = pode)
create or replace function receita.fat_pedido_validar(_p receita.fat_pedidos)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  e jsonb := '[]'::jsonb;
  g organizacao.empresas_grupo;
  s receita.fat_servicos;
  _m text;
  _x text;
  _contratos jsonb;
begin
  select * into g from organizacao.empresas_grupo where id = _p.emissora_id;
  if not g.ativa or g.omie_credencial_ref is null then
    e := e || receita.fat_erro('emissora_id', format('A %s não fatura pelo portal.', g.apelido));
  end if;

  if _p.dono_id is null then
    e := e || receita.fat_erro('dono_id', 'Escolha o dono da receita.');
  elsif not exists (select 1 from receita.fat_donos d where d.emissora_id = _p.emissora_id and d.user_id = _p.dono_id
                                                       and d.papel = 'dono' and d.ativo) then
    e := e || receita.fat_erro('dono_id', format('%s não é dono da receita na %s.',
                                                 coalesce(receita.fat_pessoa(_p.dono_id) ->> 'nome', 'Essa pessoa'), g.apelido));
  end if;

  if _p.tomador_tipo is null then
    e := e || receita.fat_erro('tomador_tipo', 'Diga se o cliente é pessoa jurídica ou física.');
  end if;
  if _p.tomador_documento is null then
    e := e || receita.fat_erro('tomador_documento', case when _p.tomador_tipo = 'pf' then 'Informe o CPF.' else 'Informe o CNPJ.' end);
  elsif not receita.fat_documento_valido(_p.tomador_documento) then
    e := e || receita.fat_erro('tomador_documento', case when _p.tomador_tipo = 'pf' then 'CPF com dígito verificador errado.'
                                                         else 'CNPJ com dígito verificador errado.' end);
  else
    _m := receita.fat_bloqueio(_p.tomador_documento);
    if _m is not null then e := e || receita.fat_erro('tomador_documento', _m); end if;
  end if;
  if nullif(btrim(_p.tomador_nome), '') is null then
    e := e || receita.fat_erro('tomador_nome', 'Informe o nome do cliente.');
  end if;

  if cardinality(_p.emails_envio) = 0 then
    e := e || receita.fat_erro('emails_envio', 'Informe ao menos um e-mail para envio.');
  else
    foreach _x in array _p.emails_envio loop
      if not receita.fat_email_valido(_x) then
        e := e || receita.fat_erro('emails_envio', format('E-mail inválido: %s.', _x));
      end if;
    end loop;
  end if;

  if nullif(btrim(_p.projeto), '') is null then e := e || receita.fat_erro('projeto', 'Informe o nome do projeto.'); end if;

  if _p.servico_id is null then
    e := e || receita.fat_erro('servico_id', 'Escolha o serviço.');
  else
    select * into s from receita.fat_servicos where id = _p.servico_id;
    if not (s.ativo and s.no_omie and s.tem_tributacao) then
      e := e || receita.fat_erro('servico_id', format(
        'O serviço "%s" não está liberado no portal (retirado, fora do Omie ou sem tributação). Escolha outro ou fale com a controladoria.',
        s.descricao));
    end if;
  end if;

  if nullif(btrim(_p.descricao_nf), '') is null then e := e || receita.fat_erro('descricao_nf', 'Escreva a descrição da nota.'); end if;
  if _p.valor is null then e := e || receita.fat_erro('valor', 'Informe o valor.'); end if;
  if _p.forma is null then
    e := e || receita.fat_erro('forma', 'Diga se é à vista ou parcelado.');
  elsif _p.forma = 'parcelado' and (_p.parcelas is null or _p.parcelas < 2) then
    e := e || receita.fat_erro('parcelas', 'Parcelado pede de 2 a 36 parcelas.');
  end if;
  if _p.primeiro_vencimento is null then e := e || receita.fat_erro('primeiro_vencimento', 'Informe o 1º vencimento.'); end if;
  if _p.valor is not null and _p.parcelas is not null and _p.parcelas between 1 and 36
     and trunc(_p.valor / _p.parcelas, 2) < 0.01 then
    e := e || receita.fat_erro('parcelas', 'Valor pequeno demais para esse número de parcelas.');
  end if;
  if _p.documento is null then e := e || receita.fat_erro('documento', 'Escolha nota fiscal, recibo ou nota de débito.'); end if;
  if _p.meio is null then e := e || receita.fat_erro('meio', 'Escolha boleto ou pix.'); end if;
  if _p.departamento is not null
     and not exists (select 1 from receita.fat_departamentos d where d.nome = _p.departamento and d.ativo) then
    e := e || receita.fat_erro('departamento', 'Departamento fora da lista.');
  end if;
  if nullif(btrim(_p.observacoes), '') is null then
    e := e || receita.fat_erro('observacoes', 'Escreva as observações (podem ser curtas).');
  end if;

  if _p.tomador_documento is not null then
    _contratos := receita.fat_contratos_outra_emissora(_p.tomador_documento, _p.emissora_id);
    if jsonb_array_length(_contratos) > 0 and not _p.confirmou_emissora then
      e := e || receita.fat_erro('confirmou_emissora', format(
        'Este cliente tem contrato vigente na %s. Confirme que quem fatura é a %s.',
        (select string_agg(distinct x -> 'emissora' ->> 'apelido', ', ') from jsonb_array_elements(_contratos) x), g.apelido));
    end if;
  end if;
  return e;
end $$;

-- 2.7 Foto do pedido para os conectores (payload versao 1, e1/API.md §2.2)
create or replace function receita.fat_snapshot(_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'versao', 1,
    'pedido', jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'codigo_integracao', p.codigo_integracao, 'valor', p.valor, 'forma', p.forma,
      'parcelas', p.parcelas, 'primeiro_vencimento', p.primeiro_vencimento, 'competencia', p.competencia,
      'documento', p.documento, 'meio', p.meio, 'descricao_nf', p.descricao_nf, 'projeto', p.projeto,
      'departamento', p.departamento, 'observacoes', p.observacoes, 'emails_envio', to_jsonb(p.emails_envio)),
    'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido, 'cnpj', g.cnpj,
                                   'conta_corrente_padrao', g.conta_corrente_padrao),
    'tomador', jsonb_build_object('tipo', p.tomador_tipo, 'documento', p.tomador_documento, 'nome', p.tomador_nome,
                                  'municipio', p.tomador_municipio, 'uf', p.tomador_uf,
                                  'emails', to_jsonb(p.emails_envio), 'codigo_cliente_integracao', p.tomador_documento),
    'servico', case when s.id is null then null else jsonb_build_object(
      'id', s.id, 'codigo_omie', s.codigo_omie, 'codigo', s.codigo, 'descricao', s.descricao,
      'codigo_lc116', s.codigo_lc116, 'codigo_municipal', s.codigo_municipal, 'id_tributacao', s.id_tributacao,
      'categoria', s.categoria_padrao, 'conta_corrente', coalesce(s.conta_corrente_padrao, g.conta_corrente_padrao),
      'tributacao', s.tributacao) end,
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'vencimento', x.vencimento, 'valor', x.valor,
                                                              'omie_titulo_codigo', x.omie_titulo_codigo) order by x.n)
                            from receita.fat_pedido_parcelas x where x.pedido_id = p.id), '[]'::jsonb),
    'omie_os_codigo', p.omie_os_codigo)
    from receita.fat_pedidos p
    join organizacao.empresas_grupo g on g.id = p.emissora_id
    left join receita.fat_servicos s on s.id = p.servico_id
   where p.id = _id
$$;

-- =================================================================================================================
-- 3. A máquina de estados
-- =================================================================================================================

create or replace function receita.fat_transicao_permitida(_de text, _para text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case _de
    when 'rascunho'            then _para in ('aguardando_ok', 'na_fila_omie', 'cancelado')
    when 'devolvido'           then _para in ('aguardando_ok', 'na_fila_omie', 'cancelado', 'cancelamento_pedido')
    when 'aguardando_ok'       then _para in ('na_fila_omie', 'devolvido', 'cancelamento_pedido')
    when 'na_fila_omie'        then _para in ('simulado', 'os_criada', 'erro_omie', 'faturado', 'cancelamento_pedido')
    when 'erro_omie'           then _para in ('na_fila_omie', 'devolvido', 'cancelamento_pedido', 'os_criada', 'simulado', 'faturado')
    when 'simulado'            then _para in ('em_conferencia', 'faturado', 'devolvido', 'erro_omie', 'cancelamento_pedido')
    when 'os_criada'           then _para in ('em_conferencia', 'faturado', 'devolvido', 'erro_omie', 'cancelamento_pedido')
    when 'em_conferencia'      then _para in ('faturado', 'devolvido', 'erro_omie', 'cancelamento_pedido')
    when 'faturado'            then _para in ('recebido', 'em_atraso', 'cancelamento_pedido')
    when 'em_atraso'           then _para in ('recebido', 'faturado', 'cancelamento_pedido')
    when 'recebido'            then _para in ('faturado', 'em_atraso', 'cancelamento_pedido')
    when 'cancelamento_pedido' then _para = 'cancelado'
    else false end, false)
$$;
comment on function receita.fat_transicao_permitida(text, text) is
  'Tabela de transições do pedido (e1/API.md §0.6). Quem pode cada uma é conferido antes, por receita.fat_acoes.';

create or replace function receita.fat_transicao(p_pedido uuid, p_para text, p_motivo text default null,
                                                 p_evento text default null, p_diff jsonb default '{}'::jsonb)
returns receita.fat_pedidos language plpgsql set search_path = '' as $$
declare
  _p receita.fat_pedidos;
  _n receita.fat_pedidos;
  _motivo text := nullif(btrim(p_motivo), '');
begin
  select * into _p from receita.fat_pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_transicao_permitida(_p.status, p_para) then
    raise exception 'Pedido % está em %: não vai para %.', _p.numero, receita.fat_status_rotulo(_p.status),
      receita.fat_status_rotulo(p_para) using errcode = '55000';
  end if;
  if p_para in ('devolvido', 'cancelamento_pedido') and _motivo is null then
    perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo.'));
  end if;

  perform set_config('receita.fat_transicao', p_pedido::text, true);
  update receita.fat_pedidos
     set status = p_para,
         motivo_status = case when p_para = 'cancelado' then coalesce(_motivo, motivo_status) else _motivo end,
         status_em = now(),
         na_fila_em = case when p_para = 'na_fila_omie' and _p.status <> 'erro_omie' then now() else na_fila_em end,
         faturado_em = case when p_para = 'faturado' and faturado_em is null then now() else faturado_em end,
         conferido_por = case when p_para = 'em_conferencia' then auth.uid()
                              when p_para in ('devolvido', 'na_fila_omie') then null else conferido_por end
   where id = p_pedido
  returning * into _n;
  perform set_config('receita.fat_transicao', '', true);

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _n.id, _n.emissora_id, coalesce(p_evento, p_para), _p.status, p_para,
          coalesce(p_diff, '{}'::jsonb)
            || case when _motivo is not null then jsonb_build_object('motivo', _motivo) else '{}'::jsonb end,
          auth.uid());

  -- Pipefy (decisão 4): o card nasce na primeira chegada à fila e anda a cada mudança depois disso. Sempre gravado; o
  -- conector decide pelo pipefy_sync da emissora se executa ou só monta.
  if p_para = 'na_fila_omie'
     and not exists (select 1 from integracoes.pipefy_envios x
                      where x.origem = 'fat_pedido' and x.origem_id = _n.id and x.operacao = 'criar_card') then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'criar_card',
            receita.fat_snapshot(_n.id) || jsonb_build_object(
              'status', p_para,
              'solicitante', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                                from public.profiles u where u.user_id = _n.solicitante_id),
              'dono', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                         from public.profiles u where u.user_id = _n.dono_id)));
  elsif _n.na_fila_em is not null then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'mover_fase', jsonb_build_object(
      'versao', 1, 'de', _p.status, 'para', p_para, 'evento', coalesce(p_evento, p_para), 'motivo', _motivo,
      'pedido', jsonb_build_object('id', _n.id, 'numero', _n.numero, 'omie_os_codigo', _n.omie_os_codigo,
                                   'omie_nf_numero', _n.omie_nf_numero, 'omie_nf_link', _n.omie_nf_link,
                                   'omie_nf_emitida_em', _n.omie_nf_emitida_em)));
  end if;
  return _n;
end $$;
comment on function receita.fat_transicao(uuid, text, text, text, jsonb) is
  'A única que muda receita.fat_pedidos.status (o gatilho fat_pedidos_status_guarda recusa o resto). Confere a '
  'transição, exige motivo em devolvido e cancelamento_pedido, grava receita.fat_eventos (de, para, diff com o motivo, '
  'autor = auth.uid(), nulo = sistema) e enfileira o Pipefy (criar_card na primeira chegada à fila, mover_fase depois).';

create or replace function receita.fat_evento_pedido(_p receita.fat_pedidos, _evento text, _diff jsonb)
returns void language sql set search_path = '' as $$
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, _evento, _p.status, _p.status, coalesce(_diff, '{}'::jsonb), auth.uid())
$$;

-- Entrar na fila do Omie: parcelas, garantir_cliente, incluir_os (ou alterar_os) e a transição.
create or replace function receita.fat_entrar_na_fila(_id uuid, _evento text, _diff jsonb default '{}'::jsonb)
returns receita.fat_pedidos language plpgsql set search_path = '' as $$
declare
  _p receita.fat_pedidos;
  g organizacao.empresas_grupo;
  _modo text;
  _snap jsonb;
  _gid uuid;
  _op text;
begin
  select * into _p from receita.fat_pedidos where id = _id for update;
  select * into g from organizacao.empresas_grupo where id = _p.emissora_id;
  if not g.ativa or g.omie_credencial_ref is null then
    raise exception 'A % não fatura pelo portal (sem Omie ou fora do portal).', g.apelido using errcode = '55000';
  end if;
  if exists (select 1 from integracoes.omie_envios x
              where x.origem = 'fat_pedido' and x.origem_id = _id and x.status = 'processando') then
    raise exception 'Há um envio ao Omie em curso para o pedido %: espere a resposta.', _p.numero using errcode = '55000';
  end if;

  -- Parcelas regeradas a cada entrada na fila (antes do faturamento não há título no Omie).
  delete from receita.fat_pedido_parcelas where pedido_id = _id;
  insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor)
  select _id, c.n, c.vencimento, c.valor from receita.fat_parcelas_calcular(_p.valor, _p.parcelas, _p.primeiro_vencimento) c;

  -- Sem OS no Omie, o pedido volta a seguir o modo atual da emissora.
  if _p.simulacao and _p.omie_os_codigo is null then
    update receita.fat_pedidos set simulacao = false where id = _id;
    _p.simulacao := false;
  end if;
  _modo := case when _p.simulacao then 'simular' else g.modo_omie end;
  _snap := receita.fat_snapshot(_id);

  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel, depende_de)
  values (_p.emissora_id, 'fat_pedido', _id, 'garantir_cliente', _p.numero,
          jsonb_build_object('versao', 1, 'pedido', jsonb_build_object('id', _id, 'numero', _p.numero),
                             'emissora', _snap -> 'emissora', 'tomador', _snap -> 'tomador'),
          _modo, 'pendente', 0, now(), null, null, null)
  on conflict (operacao, codigo_integracao) do update
     set emissora_id = excluded.emissora_id, origem_id = excluded.origem_id, payload = excluded.payload,
         modo = excluded.modo, status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), resposta = null,
         erro_legivel = null, depende_de = null
  returning x.id into _gid;

  _op := case when _p.omie_os_codigo is null then 'incluir_os' else 'alterar_os' end;
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel, depende_de)
  values (_p.emissora_id, 'fat_pedido', _id, _op, _p.numero, _snap, _modo, 'pendente', 0, now(), null, null, _gid)
  on conflict (operacao, codigo_integracao) do update
     set emissora_id = excluded.emissora_id, origem_id = excluded.origem_id, payload = excluded.payload,
         modo = excluded.modo, status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), resposta = null,
         erro_legivel = null, depende_de = excluded.depende_de;

  return receita.fat_transicao(_id, 'na_fila_omie', null, _evento, _diff);
end $$;
comment on function receita.fat_entrar_na_fila(uuid, text, jsonb) is
  'Entrada na fila do Omie (envio pelo dono ou OK): regera as parcelas, enfileira garantir_cliente e, dependendo dele, '
  'incluir_os (ou alterar_os quando já há OS, no reenvio depois de devolução), reaproveitando as linhas pelo par '
  '(operacao, numero do pedido), e faz a transição para na_fila_omie.';

-- =================================================================================================================
-- 4. RPCs das telas (ops). Primeira linha: a porta (ops.can('view.faturamento')); depois papel e escopo.
-- =================================================================================================================

-- 4.1 Contexto
create or replace function ops.fat_contexto()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _emis uuid[];
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _emis := _e.tesouraria || _e.controladoria || _e.papel;

  with em as (
    select g.* from organizacao.empresas_grupo g where g.ativa and g.id = any (_emis)
  )
  select jsonb_build_object(
    'usuario', (select jsonb_build_object('id', u.user_id, 'nome', coalesce(nullif(btrim(u.nome), ''), u.email), 'email', u.email)
                  from public.profiles u where u.user_id = _e.uid),
    'papeis', jsonb_build_object('pede', cardinality(_e.papel) > 0, 'tesouraria', cardinality(_e.tesouraria) > 0,
                                 'controladoria', cardinality(_e.controladoria) > 0, 'admin', _e.admin),
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'razao_social', g.razao_social, 'cnpj', g.cnpj,
               'modo_omie', g.modo_omie, 'pipefy_sync', g.pipefy_sync,
               'meus_papeis', coalesce((select jsonb_agg(d.papel order by d.papel) from receita.fat_donos d
                                         where d.emissora_id = g.id and d.user_id = _e.uid and d.ativo), '[]'::jsonb),
               'tesouraria', g.id = any (_e.tesouraria), 'controladoria', g.id = any (_e.controladoria),
               'pode_pedir', g.id = any (_e.papel) and g.omie_credencial_ref is not null,
               'donos', case when g.id = any (_e.papel) then coalesce((
                          select jsonb_agg(receita.fat_pessoa(d.user_id) order by u.nome)
                            from receita.fat_donos d left join public.profiles u on u.user_id = d.user_id
                           where d.emissora_id = g.id and d.papel = 'dono' and d.ativo), '[]'::jsonb) else '[]'::jsonb end,
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate, 'ultimo_ok_em', s.ultimo_ok_em,
                                          'ultima_falha_em', s.ultima_falha_em))
             order by g.apelido)
        from em g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id), '[]'::jsonb),
    'simulacao', coalesce((select jsonb_agg(g.apelido order by g.apelido) from em g where g.modo_omie = 'simular'), '[]'::jsonb),
    'pendencias', jsonb_build_object(
      'ok_a_dar', jsonb_build_object('quantidade', (select count(*) from receita.fat_pedidos p
                                                     where p.status = 'aguardando_ok' and receita.fat_ve(_e, p)
                                                       and receita.fat_pend_ok(_e, p)),
                                     'filtro', '{"pendencia": "ok"}'::jsonb),
      'devolvidos', jsonb_build_object('quantidade', (select count(*) from receita.fat_pedidos p
                                                       where p.status = 'devolvido' and receita.fat_ve(_e, p)
                                                         and receita.fat_pend_devolvido(_e, p)),
                                       'filtro', '{"pendencia": "devolvido"}'::jsonb),
      'erro_omie', jsonb_build_object('quantidade', (select count(*) from receita.fat_pedidos p
                                                      where p.status = 'erro_omie' and receita.fat_ve(_e, p)
                                                        and receita.fat_pend_erro(_e, p)),
                                      'filtro', '{"pendencia": "erro"}'::jsonb),
      'para_faturar', case when cardinality(_e.tesouraria) > 0 then jsonb_build_object(
                        'quantidade', (select count(*) from receita.fat_pedidos p
                                        where p.emissora_id = any (_e.tesouraria) and p.enviado_em is not null
                                          and p.status in ('os_criada', 'simulado', 'em_conferencia')),
                        'filtro', '{"situacao": ["os_criada", "simulado", "em_conferencia"]}'::jsonb) end),
    'erros_omie', coalesce((
      select jsonb_agg(x.j order by x.desde)
        from (select p.status_em as desde,
                     jsonb_build_object('id', p.id, 'numero', p.numero,
                                        'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
                                        'tomador_nome', p.tomador_nome, 'erro_legivel', p.motivo_status,
                                        'desde', p.status_em) as j
                from receita.fat_pedidos p join organizacao.empresas_grupo g on g.id = p.emissora_id
               where p.status = 'erro_omie' and receita.fat_ve(_e, p) and receita.fat_pend_erro(_e, p)
               order by p.status_em
               limit 50) x), '[]'::jsonb),
    'lido_em', now())
  into _r;
  return _r;
end $$;

-- 4.2 Resumo (os 4 números de Meu faturamento)
create or replace function ops.fat_resumo(p_periodo date default null, p_emissoras uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _hoje date;
  _mes date;
  _fim date;
  _rec uuid[];
  _sim text[];
  _estado text;
  _tipo text;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _hoje := receita.fat_hoje();
  _mes := date_trunc('month', coalesce(p_periodo, _hoje))::date;
  _fim := (_mes + interval '1 month')::date;
  _rec := array(select g.id from organizacao.empresas_grupo g
                 where g.ativa and g.id = any (_e.tesouraria || _e.controladoria || _e.papel)
                   and (p_emissoras is null or g.id = any (p_emissoras)));
  _sim := array(select g.apelido from organizacao.empresas_grupo g where g.id = any (_rec) and g.modo_omie = 'simular'
                 order by g.apelido);
  _estado := case when cardinality(_rec) > 0 and cardinality(_sim) = cardinality(_rec) then 'nao_apurado'
                  when cardinality(_sim) > 0 then 'parcial' else 'ok' end;
  _tipo := case when cardinality(_e.tesouraria) > 0 then 'tesouraria'
                when cardinality(_e.controladoria) > 0 then 'controladoria'
                when cardinality(_e.gestor) > 0 then 'gestor' else 'pessoal' end;

  with vis as materialized (
    select p.* from receita.fat_pedidos p
     where receita.fat_ve(_e, p) and (p_emissoras is null or p.emissora_id = any (p_emissoras))
  ), af as (
    select coalesce(sum(p.valor), 0) v, count(*) n from vis p
     where not p.simulacao and p.status in ('aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia')
  ), fm as (
    select coalesce(sum(p.valor), 0) v, count(*) n from vis p
     where not p.simulacao and p.status <> 'cancelado' and p.faturado_em is not null
       and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date >= _mes
       and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date < _fim
  ), rm as (
    select coalesce(sum(x.valor), 0) v, count(*) n
      from vis p join receita.fat_pedido_parcelas x on x.pedido_id = p.id
     where not p.simulacao and p.status <> 'cancelado' and x.situacao = 'pago' and x.pago_em >= _mes and x.pago_em < _fim
  ), at as (
    select coalesce(sum(x.valor), 0) v, count(*) n
      from vis p join receita.fat_pedido_parcelas x on x.pedido_id = p.id
     where not p.simulacao and p.status in ('faturado', 'em_atraso') and x.situacao not in ('pago', 'cancelado')
       and x.vencimento < _hoje
  )
  select jsonb_build_object(
    'periodo', _mes,
    'recorte', jsonb_build_object('tipo', _tipo, 'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'apelido', g.apelido, 'modo_omie', g.modo_omie) order by g.apelido)
        from organizacao.empresas_grupo g where g.id = any (_rec)), '[]'::jsonb)),
    'simulacao', jsonb_build_object('todas', _estado = 'nao_apurado', 'emissoras', to_jsonb(_sim)),
    'numeros', jsonb_build_object(
      'a_faturar', (select jsonb_build_object('valor', af.v, 'quantidade', af.n, 'unidade', 'pedido', 'estado', 'ok',
                                              'filtro', '{"situacao": ["a_faturar"]}'::jsonb) from af),
      'faturado_no_mes', (select jsonb_build_object('valor', fm.v, 'quantidade', fm.n, 'unidade', 'nota', 'estado', _estado,
                                                    'filtro', jsonb_build_object('mes', to_char(_mes, 'YYYY-MM'), 'regua', 'nota')) from fm),
      'recebido_no_mes', (select jsonb_build_object('valor', rm.v, 'quantidade', rm.n, 'unidade', 'parcela', 'estado', _estado,
                                                    'filtro', jsonb_build_object('mes', to_char(_mes, 'YYYY-MM'), 'regua', 'pagamento')) from rm),
      'em_atraso', (select jsonb_build_object('valor', at.v, 'quantidade', at.n, 'unidade', 'parcela', 'estado', _estado,
                                              'filtro', '{"regua": "atraso"}'::jsonb) from at)),
    'por_situacao', coalesce((
      select jsonb_agg(jsonb_build_object('situacao', s.status, 'quantidade', s.n,
                                          'filtro', jsonb_build_object('situacao', jsonb_build_array(s.status)))
                       order by array_position(array['aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie',
                                                     'os_criada', 'em_conferencia'], s.status))
        from (select p.status, count(*) n from vis p
               where p.status in ('aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie', 'os_criada', 'em_conferencia')
               group by p.status) s), '[]'::jsonb),
    'sem_pedido', not exists (select 1 from vis))
  into _r;
  return _r;
end $$;

-- 4.3 Próximo passo de um pedido (lista e fila)
create or replace function receita.fat_proximo_passo(_e receita.fat_escopo_t, _p receita.fat_pedidos)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  _tentar timestamptz;
  _faturando boolean;
  _venc date;
  _atraso date;
  _tes boolean := _p.emissora_id = any (_e.tesouraria);
begin
  select min(x.proxima_tentativa_em) filter (where x.status = 'pendente'),
         coalesce(bool_or(x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')), false)
    into _tentar, _faturando
    from integracoes.omie_envios x where x.origem = 'fat_pedido' and x.origem_id = _p.id;
  select min(x.vencimento) filter (where x.situacao not in ('pago', 'cancelado')),
         min(x.vencimento) filter (where x.situacao not in ('pago', 'cancelado') and x.vencimento < receita.fat_hoje())
    into _venc, _atraso
    from receita.fat_pedido_parcelas x where x.pedido_id = _p.id;

  return case
    when _p.status = 'rascunho' then jsonb_build_object('acao', 'terminar_rascunho', 'quem', 'pessoa',
      'pessoa', receita.fat_pessoa(_p.solicitante_id), 'voce', _p.solicitante_id = _e.uid, 'desde', _p.status_em,
      'data', null, 'tentar_em', null)
    when _p.status = 'aguardando_ok' then jsonb_build_object('acao', 'dar_ok', 'quem', 'pessoa',
      'pessoa', receita.fat_pessoa(_p.dono_id), 'voce', receita.fat_pend_ok(_e, _p) or (_p.dono_id = _e.uid and _p.enviado_por is distinct from _e.uid),
      'desde', _p.status_em, 'data', null, 'tentar_em', null)
    when _p.status = 'devolvido' then jsonb_build_object('acao', 'corrigir', 'quem', 'pessoa',
      'pessoa', receita.fat_pessoa(_p.solicitante_id), 'voce', _p.solicitante_id = _e.uid, 'desde', _p.status_em,
      'data', null, 'tentar_em', null)
    when _p.status = 'na_fila_omie' or (_faturando and _p.status in ('os_criada', 'simulado', 'em_conferencia')) then
      jsonb_build_object('acao', 'aguardar_omie', 'quem', 'omie', 'pessoa', null, 'voce', false, 'desde', _p.status_em,
                         'data', null, 'tentar_em', _tentar)
    when _p.status = 'erro_omie' then jsonb_build_object('acao', 'reenviar', 'quem', 'tesouraria', 'pessoa', null,
      'voce', _tes or _p.solicitante_id = _e.uid or _p.enviado_por = _e.uid or _p.dono_id = _e.uid,
      'desde', _p.status_em, 'data', null, 'tentar_em', null)
    when _p.status in ('os_criada', 'simulado') then jsonb_build_object('acao', 'conferir', 'quem', 'tesouraria',
      'pessoa', null, 'voce', _tes, 'desde', _p.status_em, 'data', _p.primeiro_vencimento, 'tentar_em', null)
    when _p.status = 'em_conferencia' then jsonb_build_object('acao', 'faturar', 'quem', 'tesouraria',
      'pessoa', receita.fat_pessoa(_p.conferido_por), 'voce', _tes, 'desde', _p.status_em, 'data', _p.primeiro_vencimento,
      'tentar_em', null)
    when _p.status in ('faturado', 'em_atraso') then jsonb_build_object('acao', 'aguardar_pagamento', 'quem', 'cliente',
      'pessoa', null, 'voce', false, 'desde', _p.status_em, 'data', coalesce(_atraso, _venc), 'tentar_em', null)
    when _p.status = 'cancelamento_pedido' then jsonb_build_object('acao', 'confirmar_cancelamento', 'quem', 'tesouraria',
      'pessoa', null, 'voce', _tes, 'desde', _p.status_em, 'data', null, 'tentar_em', null)
    else jsonb_build_object('acao', null, 'quem', null, 'pessoa', null, 'voce', false, 'desde', _p.status_em,
                            'data', null, 'tentar_em', null) end;
end $$;

-- 4.4 Lista de pedidos
create or replace function ops.fat_pedidos(p_filtro jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _sit text[];
  _a_faturar boolean := false;
  _pend text;
  _emis uuid[];
  _dono uuid;
  _mes date;
  _fim date;
  _regua text;
  _sim boolean;
  _busca text;
  _busca_doc text;
  _ordem text;
  _dir text;
  _pag int;
  _pp int;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _hoje := receita.fat_hoje();
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := array(select jsonb_array_elements_text(_f -> 'situacao'));
          _a_faturar := 'a_faturar' = any (_sit);
          if exists (select 1 from unnest(_sit) s where s not in ('a_faturar', 'rascunho', 'aguardando_ok', 'devolvido',
               'na_fila_omie', 'simulado', 'erro_omie', 'os_criada', 'em_conferencia', 'faturado', 'recebido', 'em_atraso',
               'cancelamento_pedido', 'cancelado')) then raise exception 'situacao'; end if;
        when 'pendencia' then
          _pend := _f ->> 'pendencia';
          if _pend not in ('ok', 'devolvido', 'erro') then raise exception 'pendencia'; end if;
        when 'emissoras' then _emis := array(select (jsonb_array_elements_text(_f -> 'emissoras'))::uuid);
        when 'dono' then _dono := (_f ->> 'dono')::uuid;
        when 'mes' then _mes := to_date(_f ->> 'mes' || '-01', 'YYYY-MM-DD');
                        if _f ->> 'mes' !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'mes'; end if;
        when 'regua' then
          _regua := _f ->> 'regua';
          if _regua not in ('competencia', 'nota', 'pagamento', 'atraso') then raise exception 'regua'; end if;
        when 'simulacao' then _sim := (_f -> 'simulacao')::boolean;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'ordem' then
          _ordem := _f ->> 'ordem';
          if _ordem not in ('atualizado', 'valor', 'vencimento', 'numero') then raise exception 'ordem'; end if;
        when 'direcao' then
          _dir := _f ->> 'direcao';
          if _dir not in ('asc', 'desc') then raise exception 'direcao'; end if;
        when 'pagina' then _pag := (_f ->> 'pagina')::int; if _pag < 1 then raise exception 'pagina'; end if;
        when 'por_pagina' then _pp := (_f ->> 'por_pagina')::int; if _pp not between 1 and 200 then raise exception 'por_pagina'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if _regua in ('competencia', 'nota', 'pagamento') and _mes is null then
    _erros := _erros || receita.fat_erro('mes', 'A régua pede o mês (AAAA-MM).');
  end if;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  _fim := (_mes + interval '1 month')::date;
  _ordem := coalesce(_ordem, 'atualizado');
  _dir := coalesce(_dir, case when _ordem = 'vencimento' then 'asc' else 'desc' end);
  _pag := coalesce(_pag, 1);
  _pp := coalesce(_pp, 50);
  _busca_doc := nullif(regexp_replace(coalesce(_busca, ''), '\D', '', 'g'), '');

  with filt as materialized (
    select p.id, p.numero, p.valor, p.updated_at, p.primeiro_vencimento, pc.pago_mes, pc.atraso
      from receita.fat_pedidos p
      left join lateral (
        select sum(x.valor) filter (where x.situacao = 'pago' and x.pago_em >= _mes and x.pago_em < _fim) as pago_mes,
               sum(x.valor) filter (where x.situacao not in ('pago', 'cancelado') and x.vencimento < _hoje) as atraso
          from receita.fat_pedido_parcelas x where x.pedido_id = p.id) pc on true
     where receita.fat_ve(_e, p)
       and (case when _sit is null then p.status <> 'cancelado'
                 else p.status = any (_sit)
                      or (_a_faturar and not p.simulacao
                          and p.status in ('aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia')) end)
       and (_pend is null
            or (_pend = 'ok' and receita.fat_pend_ok(_e, p))
            or (_pend = 'devolvido' and receita.fat_pend_devolvido(_e, p))
            or (_pend = 'erro' and receita.fat_pend_erro(_e, p)))
       and (_emis is null or p.emissora_id = any (_emis))
       and (_dono is null or p.dono_id = _dono)
       and (_sim is null or p.simulacao = _sim)
       and (_regua is null
            or (_regua = 'competencia' and p.competencia >= _mes and p.competencia < _fim)
            or (_regua = 'nota' and not p.simulacao and p.status <> 'cancelado' and p.faturado_em is not null
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date >= _mes
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date < _fim)
            or (_regua = 'pagamento' and not p.simulacao and pc.pago_mes is not null)
            or (_regua = 'atraso' and not p.simulacao and p.status in ('faturado', 'em_atraso') and pc.atraso is not null))
       and (_busca is null
            or p.numero ilike '%' || _busca || '%' or p.tomador_nome ilike '%' || _busca || '%'
            or p.projeto ilike '%' || _busca || '%'
            or (_busca_doc is not null and p.tomador_documento like '%' || _busca_doc || '%'))
  ), ordenado as (
    select f.*, row_number() over (order by
       case when _ordem = 'atualizado' and _dir = 'asc' then f.updated_at end asc,
       case when _ordem = 'atualizado' and _dir = 'desc' then f.updated_at end desc,
       case when _ordem = 'valor' and _dir = 'asc' then f.valor end asc nulls last,
       case when _ordem = 'valor' and _dir = 'desc' then f.valor end desc nulls last,
       case when _ordem = 'vencimento' and _dir = 'asc' then f.primeiro_vencimento end asc nulls last,
       case when _ordem = 'vencimento' and _dir = 'desc' then f.primeiro_vencimento end desc nulls last,
       case when _ordem = 'numero' and _dir = 'asc' then f.numero end asc,
       case when _ordem = 'numero' and _dir = 'desc' then f.numero end desc,
       f.numero desc) as ord
      from filt f
  ), pagina as (
    select o.* from ordenado o where o.ord > (_pag - 1) * _pp and o.ord <= _pag * _pp
  )
  select jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'status', p.status, 'simulacao', p.simulacao,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('tipo', p.tomador_tipo, 'documento', p.tomador_documento, 'nome', p.tomador_nome),
               'projeto', p.projeto, 'valor', p.valor,
               'dono', receita.fat_pessoa(p.dono_id), 'solicitante', receita.fat_pessoa(p.solicitante_id),
               'primeiro_vencimento', p.primeiro_vencimento, 'competencia', p.competencia,
               'proximo_passo', receita.fat_proximo_passo(_e, p),
               'atualizado_em', p.updated_at,
               'pago_no_mes', case when _regua = 'pagamento' then f.pago_mes end,
               'em_atraso', case when _regua = 'atraso' then f.atraso end)
             order by f.ord)
        from pagina f
        join receita.fat_pedidos p on p.id = f.id
        join organizacao.empresas_grupo g on g.id = p.emissora_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_recorte', (select count(*) from receita.fat_pedidos p where receita.fat_ve(_e, p)),
    'soma', (select coalesce(sum(f.valor), 0) from filt f),
    'soma_parcelas', case when _regua = 'pagamento' then (select coalesce(sum(f.pago_mes), 0) from filt f)
                          when _regua = 'atraso' then (select coalesce(sum(f.atraso), 0) from filt f) end,
    'pagina', _pag, 'por_pagina', _pp)
  into _r;
  return _r;
end $$;

-- 4.5 Ficha do pedido
create or replace function ops.fat_pedido(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _tec boolean;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then
    raise exception 'Este pedido não está no seu escopo.' using errcode = '42501';
  end if;
  _tec := _p.emissora_id = any (_e.tesouraria || _e.controladoria);

  select jsonb_build_object(
    'pedido', jsonb_build_object(
      'id', _p.id, 'numero', _p.numero, 'status', _p.status, 'simulacao', _p.simulacao,
      'motivo_status', _p.motivo_status, 'status_em', _p.status_em,
      'emissora', (select jsonb_build_object('id', g.id, 'apelido', g.apelido, 'razao_social', g.razao_social,
                                             'modo_omie', g.modo_omie, 'pipefy_sync', g.pipefy_sync)
                     from organizacao.empresas_grupo g where g.id = _p.emissora_id),
      'dono', receita.fat_pessoa(_p.dono_id), 'solicitante', receita.fat_pessoa(_p.solicitante_id),
      'enviado_por', receita.fat_pessoa(_p.enviado_por), 'conferido_por', receita.fat_pessoa(_p.conferido_por),
      'tomador', jsonb_build_object(
        'tipo', _p.tomador_tipo, 'documento', _p.tomador_documento, 'nome', _p.tomador_nome,
        'municipio', coalesce(_p.tomador_municipio, rc.municipio), 'uf', coalesce(_p.tomador_uf, rc.uf),
        'situacao', coalesce(_p.tomador_situacao, rc.situacao),
        'situacao_conferida', case when _p.enviado_em is null then rc.situacao is not null else _p.tomador_situacao is not null end),
      'emails_envio', to_jsonb(_p.emails_envio), 'projeto', _p.projeto,
      'servico', (select jsonb_build_object('id', s.id, 'codigo_omie', s.codigo_omie, 'codigo', s.codigo, 'descricao', s.descricao)
                    from receita.fat_servicos s where s.id = _p.servico_id),
      'descricao_nf', _p.descricao_nf, 'valor', _p.valor, 'forma', _p.forma, 'parcelas', _p.parcelas,
      'primeiro_vencimento', _p.primeiro_vencimento, 'competencia', _p.competencia, 'documento', _p.documento,
      'meio', _p.meio, 'departamento', _p.departamento, 'observacoes', _p.observacoes,
      'confirmou_emissora', _p.confirmou_emissora,
      'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_p.tomador_documento, _p.emissora_id),
      'omie', jsonb_build_object('os_codigo', _p.omie_os_codigo, 'os_etapa', _p.omie_os_etapa, 'nf_numero', _p.omie_nf_numero,
                                 'nf_link', _p.omie_nf_link, 'nf_emitida_em', _p.omie_nf_emitida_em, 'lido_em', _p.omie_lido_em),
      'criado_em', _p.created_at, 'enviado_em', _p.enviado_em, 'na_fila_em', _p.na_fila_em,
      'faturado_em', _p.faturado_em, 'atualizado_em', _p.updated_at),
    'resumo', (select jsonb_build_object(
      'valor', _p.valor,
      'recebido', coalesce(sum(x.valor) filter (where x.situacao = 'pago'), 0),
      'em_atraso', coalesce(sum(x.valor) filter (where x.situacao not in ('pago', 'cancelado') and x.vencimento < receita.fat_hoje()), 0),
      'parcelas_pagas', count(*) filter (where x.situacao = 'pago'),
      'parcelas_total', coalesce(nullif(count(x.n), 0), _p.parcelas),
      'proximo_vencimento', coalesce(
        (select jsonb_build_object('data', y.vencimento, 'valor', y.valor, 'previsto', false)
           from receita.fat_pedido_parcelas y
          where y.pedido_id = _p.id and y.situacao not in ('pago', 'cancelado') order by y.n limit 1),
        case when _p.primeiro_vencimento is not null and not exists (select 1 from receita.fat_pedido_parcelas z where z.pedido_id = _p.id)
             then jsonb_build_object('data', _p.primeiro_vencimento, 'valor', null, 'previsto', true) end))
      from receita.fat_pedido_parcelas x where x.pedido_id = _p.id),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'vencimento', x.vencimento, 'valor', x.valor,
                                                              'situacao', x.situacao, 'pago_em', x.pago_em,
                                                              'omie_titulo_codigo', x.omie_titulo_codigo) order by x.n)
                            from receita.fat_pedido_parcelas x where x.pedido_id = _p.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'evento', v.evento, 'de', v.de, 'para', v.para,
                                                             'diff', v.diff, 'autor', receita.fat_pessoa(v.autor_id), 'em', v.em)
                                          order by v.em desc, v.id desc)
                           from receita.fat_eventos v where v.entidade = 'pedido' and v.entidade_id = _p.id), '[]'::jsonb),
    'omie', jsonb_build_object(
      'envios', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', x.id, 'operacao', x.operacao, 'status', x.status, 'modo', x.modo, 'tentativas', x.tentativas,
                    'proxima_tentativa_em', x.proxima_tentativa_em, 'erro_legivel', x.erro_legivel,
                    'codigos', x.resposta -> 'codigos', 'criado_em', x.created_at, 'atualizado_em', x.updated_at)
                    || case when _tec then jsonb_build_object('payload', x.payload, 'resposta', x.resposta) else '{}'::jsonb end
                    order by x.created_at, x.operacao)
                  from integracoes.omie_envios x where x.origem = 'fat_pedido' and x.origem_id = _p.id), '[]'::jsonb),
      'leitura_pendente', (select jsonb_build_object('tentar_em', x.proxima_tentativa_em) from integracoes.omie_envios x
                            where x.origem = 'fat_pedido' and x.origem_id = _p.id and x.operacao = 'consultar_status'
                              and x.status in ('pendente', 'processando'))),
    'pipefy', jsonb_build_object(
      'envios', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', x.id, 'operacao', x.operacao, 'status', x.status, 'card_id', x.card_id,
                    'fase', x.resposta ->> 'fase', 'card_url', x.resposta ->> 'card_url', 'erro_legivel', x.erro_legivel,
                    'criado_em', x.created_at, 'atualizado_em', x.updated_at)
                    || case when _tec then jsonb_build_object('payload', x.payload, 'resposta', x.resposta) else '{}'::jsonb end
                    order by x.seq)
                  from integracoes.pipefy_envios x where x.origem = 'fat_pedido' and x.origem_id = _p.id), '[]'::jsonb)),
    'papel', jsonb_build_object(
      'autor', _p.solicitante_id = _e.uid, 'enviou', _p.enviado_por is not distinct from _e.uid,
      'dono', _p.dono_id = _e.uid, 'substituto', receita.fat_e_substituto(_e, _p),
      'gestor', _p.emissora_id = any (_e.gestor), 'tesouraria', _p.emissora_id = any (_e.tesouraria),
      'controladoria', _p.emissora_id = any (_e.controladoria)),
    'acoes', receita.fat_acoes(_e, _p))
  into _r
  from (select 1) um
  left join integracoes.receita_cnpj rc on rc.cnpj = _p.tomador_documento;
  return _r;
end $$;

-- 4.6 Fila da tesouraria
create or replace function ops.fat_fila_tesouraria(p_emissora uuid default null, p_filtro jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _emis uuid[];
  _sit text;
  _hig text;
  _dia date;
  _busca text;
  _busca_doc text;
  _lim int := 300;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if cardinality(_e.tesouraria) = 0 then
    raise exception 'Só a tesouraria abre a fila.' using errcode = '42501';
  end if;
  if p_emissora is not null and not p_emissora = any (_e.tesouraria) then
    raise exception 'Esta empresa não está no seu recorte da tesouraria.' using errcode = '42501';
  end if;
  _hoje := receita.fat_hoje();
  _emis := case when p_emissora is null then _e.tesouraria else array[p_emissora] end;
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := _f ->> 'situacao';
          if _sit not in ('para_faturar', 'em_conferencia', 'erro_omie', 'na_fila_omie', 'faturado', 'cancelamento_pedido') then
            raise exception 'situacao'; end if;
        when 'higiene' then
          _hig := _f ->> 'higiene';
          if _hig not in ('erro', 'vence_3d', 'parado_1du') then raise exception 'higiene'; end if;
        when 'dia' then _dia := case when _f ->> 'dia' = 'hoje' then _hoje else (_f ->> 'dia')::date end;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'limite' then _lim := (_f ->> 'limite')::int; if _lim not between 1 and 1000 then raise exception 'limite'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;
  _busca_doc := nullif(regexp_replace(coalesce(_busca, ''), '\D', '', 'g'), '');

  with base as materialized (
    select p.*,
           (p.na_fila_em at time zone 'America/Sao_Paulo')::date as dia_chegada,
           exists (select 1 from integracoes.omie_envios x where x.origem = 'fat_pedido' and x.origem_id = p.id
                     and x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')) as faturando,
           p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia')
             and p.primeiro_vencimento <= _hoje + 3 as vence_3d,
           p.status in ('os_criada', 'simulado', 'em_conferencia')
             and receita.fat_dias_uteis((p.status_em at time zone 'America/Sao_Paulo')::date, _hoje) > 1 as parado_1du
      from receita.fat_pedidos p
     where p.emissora_id = any (_e.tesouraria) and p.enviado_em is not null
       and (p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')
            or (p.status = 'faturado' and (p.faturado_em at time zone 'America/Sao_Paulo')::date = _hoje))
  ), fila as (
    select b.* from base b where b.emissora_id = any (_emis)
  ), filt as (
    select f.* from fila f
     where (_sit is null and f.status <> 'faturado'
            or _sit = 'para_faturar' and f.status in ('os_criada', 'simulado')
            or _sit = f.status)
       and (_hig is null or (_hig = 'erro' and f.status = 'erro_omie') or (_hig = 'vence_3d' and f.vence_3d)
            or (_hig = 'parado_1du' and f.parado_1du))
       and (_dia is null or f.dia_chegada = _dia or (_sit = 'faturado' and (f.faturado_em at time zone 'America/Sao_Paulo')::date = _dia))
       and (_busca is null or f.numero ilike '%' || _busca || '%' or f.tomador_nome ilike '%' || _busca || '%'
            or f.projeto ilike '%' || _busca || '%' or (_busca_doc is not null and f.tomador_documento like '%' || _busca_doc || '%'))
  ), pagina as (
    select f.*,
           row_number() over (order by f.dia_chegada,
             array_position(array['erro_omie', 'cancelamento_pedido', 'em_conferencia', 'os_criada', 'simulado',
                                  'na_fila_omie', 'faturado'], f.status),
             f.primeiro_vencimento, f.numero) as ord
      from filt f
     order by ord
     limit _lim
  )
  select jsonb_build_object(
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'modo_omie', g.modo_omie,
               'trabalho', (select count(*) from base b where b.emissora_id = g.id
                             and b.status in ('erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')),
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate))
             order by g.apelido)
        from organizacao.empresas_grupo g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id
       where g.ativa and g.id = any (_e.tesouraria)), '[]'::jsonb),
    'ritmo', jsonb_build_object(
      'para_faturar', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                 'filtro', '{"situacao": "para_faturar"}'::jsonb)
                         from fila f where f.status in ('os_criada', 'simulado')),
      'em_conferencia', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "em_conferencia"}'::jsonb)
                           from fila f where f.status = 'em_conferencia'),
      'faturados_hoje', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "faturado", "dia": "hoje"}'::jsonb)
                           from fila f where f.status = 'faturado')),
    'higiene', (select jsonb_build_object('erro', count(*) filter (where f.status = 'erro_omie'),
                                          'vence_3d', count(*) filter (where f.vence_3d),
                                          'parado_1du', count(*) filter (where f.parado_1du)) from fila f),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'numero', f.numero, 'chegou_em', f.na_fila_em, 'dia', f.dia_chegada,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('nome', f.tomador_nome, 'documento', f.tomador_documento,
                                             'situacao_conferida', f.tomador_situacao is not null),
               'servico', jsonb_build_object('descricao', s.descricao, 'codigo', s.codigo),
               'projeto', f.projeto, 'documento', f.documento, 'forma', f.forma, 'parcelas', f.parcelas,
               'valor', f.valor, 'primeiro_vencimento', f.primeiro_vencimento, 'status', f.status,
               'simulacao', f.simulacao, 'faturando', f.faturando, 'conferido_por', receita.fat_pessoa(f.conferido_por),
               'erro_legivel', case when f.status = 'erro_omie' then f.motivo_status end,
               'onde_parou', (select jsonb_build_object('evento', v.evento, 'em', v.em, 'autor', receita.fat_pessoa(v.autor_id),
                                                        'motivo', v.diff ->> 'motivo')
                                from receita.fat_eventos v where v.entidade = 'pedido' and v.entidade_id = f.id
                               order by v.em desc, v.id desc limit 1),
               'proxima_acao', jsonb_build_object(
                 'acao', case when f.faturando then 'aguardar_omie'
                              when f.status = 'erro_omie' then 'reenviar'
                              when f.status = 'cancelamento_pedido' then 'confirmar_cancelamento'
                              when f.status = 'em_conferencia' then 'faturar'
                              when f.status in ('os_criada', 'simulado') then 'conferir'
                              when f.status = 'na_fila_omie' then 'aguardar_omie' end,
                 'data', case when f.status in ('em_conferencia', 'os_criada', 'simulado') then f.primeiro_vencimento end,
                 'desde', f.status_em,
                 'tentar_em', case when f.status = 'na_fila_omie' or f.faturando then (
                   select min(x.proxima_tentativa_em) from integracoes.omie_envios x
                    where x.origem = 'fat_pedido' and x.origem_id = f.id and x.status = 'pendente') end),
               'higiene', jsonb_build_object('erro', f.status = 'erro_omie', 'vence_3d', f.vence_3d, 'parado_1du', f.parado_1du))
             order by f.ord)
        from pagina f
        join organizacao.empresas_grupo g on g.id = f.emissora_id
        left join receita.fat_servicos s on s.id = f.servico_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_fila', (select count(*) from fila f where f.status <> 'faturado'),
    'lido_em', now())
  into _r;
  return _r;
end $$;

-- 4.7 Catálogo, departamentos, tomador, prévia das parcelas
create or replace function ops.fat_servicos(p_emissora uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
      'servicos', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', s.id, 'codigo_omie', s.codigo_omie, 'codigo', s.codigo, 'descricao', s.descricao,
                     'codigo_lc116', s.codigo_lc116, 'codigo_municipal', s.codigo_municipal, 'categoria', s.categoria_padrao)
                     order by s.descricao)
                   from receita.fat_servicos s
                  where s.emissora_id = g.id and s.ativo and s.no_omie and s.tem_tributacao), '[]'::jsonb),
      'sem_tributacao', (select count(*) from receita.fat_servicos s
                          where s.emissora_id = g.id and s.ativo and s.no_omie and not s.tem_tributacao),
      'sincronizado_em', (select max(s.sincronizado_em) from receita.fat_servicos s where s.emissora_id = g.id))
      from organizacao.empresas_grupo g where g.id = p_emissora);
end $$;

create or replace function ops.fat_departamentos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  return jsonb_build_object('departamentos', coalesce((
    select jsonb_agg(jsonb_build_object('nome', d.nome, 'ordem', d.ordem) order by d.ordem)
      from receita.fat_departamentos d where d.ativo), '[]'::jsonb));
end $$;

create or replace function ops.fat_tomador(p_documento text, p_emissora uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  _tipo text;
  rc integracoes.receita_cnpj;
  _b_id integer;
  _b_razao text;
  _b_uf text;
  _emails jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is not null and not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  _tipo := case char_length(_doc) when 14 then 'pj' when 11 then 'pf' end;
  if _tipo is null or not receita.fat_documento_valido(_doc) then
    return jsonb_build_object('documento', _doc, 'tipo', _tipo, 'valido', false,
      'erro', case when _tipo is null then 'O documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).'
                   when _tipo = 'pf' then 'CPF com dígito verificador errado.' else 'CNPJ com dígito verificador errado.' end,
      'nome', null, 'nome_fonte', null, 'municipio', null, 'uf', null, 'situacao', null, 'situacao_desde', null,
      'situacao_fonte', null, 'situacao_consultada_em', null, 'consultar_receita', false, 'emails', '[]'::jsonb,
      'bloqueio', null, 'contratos_outra_emissora', '[]'::jsonb, 'contratos_lidos_em', null, 'base', null);
  end if;

  select * into rc from integracoes.receita_cnpj r where r.cnpj = _doc;
  select x.id, x.razao_social, x.uf into _b_id, _b_razao, _b_uf
    from ops.empresas x where ops.qb_so_digitos(x.cnpj) = _doc order by x.id limit 1;

  select coalesce(jsonb_agg(m.email order by m.ordem, m.email), '[]'::jsonb) into _emails
    from (select e.email, min(e.ordem) as ordem
            from (select lower(btrim(u)) as email, 1 as ordem from unnest(rc.emails) u
                  union all
                  select lower(btrim(x.email_fiscal)), 2 from ops.empresas x
                   where ops.qb_so_digitos(x.cnpj) = _doc and nullif(btrim(x.email_fiscal), '') is not null
                  union all
                  select u, 3 from receita.fat_pedidos p, unnest(p.emails_envio) u
                   where p.tomador_documento = _doc and receita.fat_ve(_e, p)) e
           where receita.fat_email_valido(e.email)
           group by e.email) m;

  return jsonb_build_object(
    'documento', _doc, 'tipo', _tipo, 'valido', true, 'erro', null,
    'nome', coalesce(rc.razao_social, _b_razao),
    'nome_fonte', case when rc.razao_social is not null then 'Receita' when _b_razao is not null then 'base de clientes' end,
    'municipio', rc.municipio, 'uf', coalesce(rc.uf, _b_uf),
    'situacao', rc.situacao, 'situacao_desde', rc.situacao_desde, 'situacao_fonte', rc.fonte,
    'situacao_consultada_em', rc.consultado_em,
    'consultar_receita', _tipo = 'pj' and (rc.cnpj is null or rc.consultado_em < now() - interval '30 days'),
    'emails', _emails,
    'bloqueio', case when receita.fat_bloqueio(_doc) is not null then jsonb_build_object('motivo', receita.fat_bloqueio(_doc)) end,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_doc, p_emissora),
    'contratos_lidos_em', (select max(k.sincronizado_em) from ops.omie_contratos_servico k),
    'base', case when _b_id is not null then jsonb_build_object('empresa_id', _b_id, 'razao_social', _b_razao, 'uf', _b_uf) end);
end $$;

create or replace function ops.fat_parcelas_previa(p_valor numeric, p_parcelas integer, p_primeiro_vencimento date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
            'parcelas', jsonb_agg(jsonb_build_object('n', c.n, 'vencimento', c.vencimento, 'valor', c.valor) order by c.n),
            'total', sum(c.valor))
            from receita.fat_parcelas_calcular(p_valor, p_parcelas, p_primeiro_vencimento) c);
end $$;

-- 4.8 Salvar (criar ou alterar rascunho / devolvido)
create or replace function ops.fat_pedido_salvar(p_id uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _n receita.fat_pedidos;
  _antes jsonb;
  _erros jsonb := '[]'::jsonb;
  _k text;
  _v jsonb;
  _num numeric;
  _txt text;
  _nova_emissora uuid;
  _apelido text;
  _novo boolean := p_id is null;
  _campos constant text[] := array['emissora_id', 'dono_id', 'tomador_tipo', 'tomador_documento', 'tomador_nome',
    'emails_envio', 'projeto', 'servico_id', 'descricao_nf', 'valor', 'forma', 'parcelas', 'primeiro_vencimento',
    'competencia', 'documento', 'meio', 'departamento', 'observacoes', 'confirmou_emissora'];
  _diff jsonb;
  _parcelas jsonb := '[]'::jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    perform receita.fat_recusar(receita.fat_erro(null, 'p_dados precisa ser um objeto.'));
  end if;
  for _k in select jsonb_object_keys(p_dados) loop
    if not _k = any (_campos) then _erros := _erros || receita.fat_erro(_k, 'Campo desconhecido.'); end if;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  -- Carrega ou cria
  if _novo then
    begin
      _nova_emissora := (p_dados ->> 'emissora_id')::uuid;
    exception when others then
      perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Empresa inválida.'));
    end;
    if _nova_emissora is null then perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Escolha a empresa que fatura.')); end if;
    select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _nova_emissora and g.ativa;
    if not found then perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Empresa fora do Portal de Faturamento.')); end if;
    if not _nova_emissora = any (_e.papel) then
      raise exception 'Você não pede faturamento pela %.', _apelido using errcode = '42501';
    end if;
    insert into receita.fat_pedidos (emissora_id, solicitante_id, dono_id)
    values (_nova_emissora, _e.uid, case when _nova_emissora = any (_e.dono) then _e.uid end)
    returning * into _p;
    _antes := '{}'::jsonb;
  else
    select * into _p from receita.fat_pedidos where id = p_id for update;
    if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
    if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
    perform receita.fat_exigir(_e, _p, 'editar');
    _antes := to_jsonb(_p);
  end if;
  _n := _p;

  -- Aplica cada campo enviado (erro de formato vira {campo, mensagem})
  foreach _k in array _campos loop
    continue when not p_dados ? _k;
    _v := p_dados -> _k;
    begin
      case _k
        when 'emissora_id' then
          _nova_emissora := (_v #>> '{}')::uuid;
          if _nova_emissora is null then raise exception 'Escolha a empresa que fatura.'; end if;
          if _nova_emissora is distinct from _p.emissora_id then
            if _p.omie_os_codigo is not null then
              raise exception 'A OS % já existe no Omie desta empresa: para trocar a empresa, peça o cancelamento e faça outro pedido.', _p.omie_os_codigo;
            end if;
            select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _nova_emissora and g.ativa;
            if not found then raise exception 'Empresa fora do Portal de Faturamento.'; end if;
            if not _nova_emissora = any (_e.papel) then
              raise exception 'Você não pede faturamento pela %.', _apelido;
            end if;
            _n.emissora_id := _nova_emissora;
            _n.servico_id := null;
            _n.confirmou_emissora := false;
            if not exists (select 1 from receita.fat_donos d where d.emissora_id = _nova_emissora and d.user_id = _n.dono_id
                                                             and d.papel = 'dono' and d.ativo) then
              _n.dono_id := case when _nova_emissora = any (_e.dono) then _e.uid end;
            end if;
          end if;
        when 'dono_id' then
          _n.dono_id := (_v #>> '{}')::uuid;
        when 'tomador_tipo' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('pj', 'pf') then raise exception 'Use pj ou pf.'; end if;
          _n.tomador_tipo := _txt;
        when 'tomador_documento' then
          _txt := nullif(regexp_replace(coalesce(_v #>> '{}', ''), '\D', '', 'g'), '');
          if _txt is not null and char_length(_txt) not in (11, 14) then
            raise exception 'O documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).';
          end if;
          if _txt is distinct from _p.tomador_documento then
            _n.confirmou_emissora := case when p_dados ? 'confirmou_emissora' then _n.confirmou_emissora else false end;
            _n.tomador_municipio := null; _n.tomador_uf := null; _n.tomador_situacao := null;
          end if;
          _n.tomador_documento := _txt;
        when 'tomador_nome' then _n.tomador_nome := nullif(regexp_replace(btrim(_v #>> '{}'), '\s+', ' ', 'g'), '');
        when 'emails_envio' then
          if _v is not null and jsonb_typeof(_v) <> 'null' and jsonb_typeof(_v) <> 'array' then
            raise exception 'Mande uma lista de e-mails.';
          end if;
          _n.emails_envio := coalesce((select array_agg(x.e order by x.o) from (
                               select lower(btrim(t.v)) as e, min(t.o) as o
                                 from jsonb_array_elements_text(coalesce(nullif(_v, 'null'::jsonb), '[]'::jsonb)) with ordinality t(v, o)
                                where btrim(t.v) <> '' group by lower(btrim(t.v))) x), '{}');
        when 'projeto' then _n.projeto := nullif(regexp_replace(btrim(_v #>> '{}'), '\s+', ' ', 'g'), '');
        when 'servico_id' then _n.servico_id := (_v #>> '{}')::uuid;
        when 'descricao_nf' then _n.descricao_nf := nullif(btrim(_v #>> '{}'), '');
        when 'valor' then
          _num := (_v #>> '{}')::numeric;
          if _num is not null and _num <= 0 then raise exception 'O valor precisa ser maior que zero.'; end if;
          if _num is not null and _num <> round(_num, 2) then raise exception 'O valor tem mais de 2 casas decimais.'; end if;
          _n.valor := _num;
        when 'forma' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('avulso', 'parcelado') then raise exception 'Use avulso ou parcelado.'; end if;
          _n.forma := _txt;
        when 'parcelas' then
          _num := (_v #>> '{}')::numeric;
          if _num is not null and (_num <> trunc(_num) or _num < 1 or _num > 36) then
            raise exception 'O número de parcelas vai de 1 a 36.';
          end if;
          _n.parcelas := _num::int;
        when 'primeiro_vencimento' then _n.primeiro_vencimento := (_v #>> '{}')::date;
        when 'competencia' then _n.competencia := date_trunc('month', (_v #>> '{}')::date)::date;
        when 'documento' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('nf', 'recibo', 'nd') then raise exception 'Use nf, recibo ou nd.'; end if;
          _n.documento := _txt;
        when 'meio' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('boleto', 'pix') then raise exception 'Use boleto ou pix.'; end if;
          _n.meio := _txt;
        when 'departamento' then
          _txt := nullif(btrim(_v #>> '{}'), '');
          if _txt is not null and not exists (select 1 from receita.fat_departamentos d where d.nome = _txt and d.ativo) then
            raise exception 'Departamento fora da lista.';
          end if;
          _n.departamento := _txt;
        when 'observacoes' then _n.observacoes := nullif(btrim(_v #>> '{}'), '');
        when 'confirmou_emissora' then
          if jsonb_typeof(_v) <> 'boolean' then raise exception 'Use true ou false.'; end if;
          _n.confirmou_emissora := (_v)::boolean;
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlstate = 'P0001' then sqlerrm else 'Valor inválido.' end);
    end;
  end loop;

  -- Coerência entre campos
  if _n.forma = 'avulso' then _n.parcelas := 1; end if;
  if _n.tomador_tipo is null and _n.tomador_documento is not null then
    _n.tomador_tipo := case char_length(_n.tomador_documento) when 14 then 'pj' else 'pf' end;
  end if;
  if _n.tomador_documento is not null and _n.tomador_tipo is not null
     and char_length(_n.tomador_documento) <> (case _n.tomador_tipo when 'pj' then 14 else 11 end) then
    if p_dados ? 'tomador_documento' then
      _erros := _erros || receita.fat_erro('tomador_documento', case _n.tomador_tipo when 'pj' then 'CNPJ tem 14 dígitos.' else 'CPF tem 11 dígitos.' end);
    else
      _n.tomador_documento := null;  -- trocou PJ/PF: o documento antigo não serve
    end if;
  end if;
  if p_dados ? 'dono_id' and _n.dono_id is not null
     and not exists (select 1 from receita.fat_donos d where d.emissora_id = _n.emissora_id and d.user_id = _n.dono_id
                                                      and d.papel = 'dono' and d.ativo) then
    _erros := _erros || receita.fat_erro('dono_id', 'Escolha um dono da receita desta empresa.');
  end if;
  if _n.servico_id is not null
     and not exists (select 1 from receita.fat_servicos s where s.id = _n.servico_id and s.emissora_id = _n.emissora_id) then
    _erros := _erros || receita.fat_erro('servico_id', 'Esse serviço não é do catálogo desta empresa.');
  end if;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  -- Nome do tomador: sem nome digitado, vem da Receita ou da base
  if _n.tomador_nome is null and _n.tomador_documento is not null then
    _n.tomador_nome := coalesce((select r.razao_social from integracoes.receita_cnpj r where r.cnpj = _n.tomador_documento),
                                (select x.razao_social from ops.empresas x where ops.qb_so_digitos(x.cnpj) = _n.tomador_documento
                                  order by x.id limit 1));
  end if;

  -- Devolvido em correção: as parcelas da entrada anterior saem (voltam ao entrar na fila de novo)
  if _p.status = 'devolvido' then
    delete from receita.fat_pedido_parcelas where pedido_id = _p.id;
  end if;

  update receita.fat_pedidos
     set emissora_id = _n.emissora_id, dono_id = _n.dono_id, tomador_tipo = _n.tomador_tipo,
         tomador_documento = _n.tomador_documento, tomador_nome = _n.tomador_nome, emails_envio = _n.emails_envio,
         projeto = _n.projeto, servico_id = _n.servico_id, descricao_nf = _n.descricao_nf, valor = _n.valor,
         forma = _n.forma, parcelas = _n.parcelas, primeiro_vencimento = _n.primeiro_vencimento,
         competencia = _n.competencia, documento = _n.documento, meio = _n.meio, departamento = _n.departamento,
         observacoes = _n.observacoes, confirmou_emissora = _n.confirmou_emissora,
         tomador_municipio = _n.tomador_municipio, tomador_uf = _n.tomador_uf, tomador_situacao = _n.tomador_situacao
   where id = _p.id
  returning * into _n;

  _diff := receita.fat_diff(_antes, to_jsonb(_n), _campos);
  if _novo then
    perform receita.fat_evento_pedido(_n, 'criado', _diff);
  elsif _diff <> '{}'::jsonb then
    perform receita.fat_evento_pedido(_n, 'alterado', _diff);
  end if;

  if _n.valor is not null and _n.parcelas is not null and _n.primeiro_vencimento is not null then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('n', c.n, 'vencimento', c.vencimento, 'valor', c.valor) order by c.n), '[]'::jsonb)
        into _parcelas from receita.fat_parcelas_calcular(_n.valor, _n.parcelas, _n.primeiro_vencimento) c;
    exception when sqlstate '22023' then _parcelas := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object(
    'id', _n.id, 'numero', _n.numero, 'status', _n.status,
    'pendencias', receita.fat_pedido_validar(_n),
    'parcelas', _parcelas,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_n.tomador_documento, _n.emissora_id),
    'bloqueio', case when receita.fat_bloqueio(_n.tomador_documento) is not null
                     then jsonb_build_object('motivo', receita.fat_bloqueio(_n.tomador_documento)) end);
end $$;

-- 4.9 Enviar, aprovar, devolver, reenviar, descartar, cancelar
create or replace function ops.fat_pedido_enviar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _erros jsonb;
  rc integracoes.receita_cnpj;
  _sim boolean;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'enviar');

  if _p.competencia is null and _p.primeiro_vencimento is not null then
    _p.competencia := date_trunc('month', _p.primeiro_vencimento)::date;
  end if;
  _erros := receita.fat_pedido_validar(_p);
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  select * into rc from integracoes.receita_cnpj r where r.cnpj = _p.tomador_documento;
  update receita.fat_pedidos
     set competencia = _p.competencia, enviado_por = _e.uid, enviado_em = coalesce(enviado_em, now()),
         tomador_municipio = coalesce(rc.municipio, tomador_municipio), tomador_uf = coalesce(rc.uf, tomador_uf),
         tomador_situacao = rc.situacao
   where id = _p.id;

  if _p.dono_id = _e.uid then
    _p := receita.fat_entrar_na_fila(_p.id, 'enviado');
  else
    _p := receita.fat_transicao(_p.id, 'aguardando_ok', null, 'enviado');
  end if;
  select g.modo_omie = 'simular' into _sim from organizacao.empresas_grupo g where g.id = _p.emissora_id;
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'simulacao_emissora', _sim,
                            'aguardando', case when _p.status = 'aguardando_ok' then receita.fat_pessoa(_p.dono_id) end);
end $$;

create or replace function ops.fat_pedido_aprovar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _sim boolean;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'aprovar');
  _p := receita.fat_entrar_na_fila(_p.id, 'aprovado');
  select g.modo_omie = 'simular' into _sim from organizacao.empresas_grupo g where g.id = _p.emissora_id;
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'simulacao_emissora', _sim);
end $$;

create or replace function ops.fat_pedido_devolver(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  if nullif(btrim(p_motivo), '') is null then
    perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo da devolução.'));
  end if;
  perform receita.fat_exigir(_e, _p, 'devolver');
  _p := receita.fat_transicao(_p.id, 'devolvido', p_motivo, 'devolvido');
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status,
                            'devolvido_a', receita.fat_pessoa(_p.solicitante_id));
end $$;

create or replace function ops.fat_pedido_reenviar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _n int;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'reenviar');
  -- A mesma linha volta para a fila, com o mesmo código de integração: nunca uma segunda OS (CA-06, CA-12).
  update integracoes.omie_envios
     set status = 'pendente', proxima_tentativa_em = now(), tentativas = 0, erro_legivel = null
   where origem = 'fat_pedido' and origem_id = _p.id and status = 'erro'
     and operacao in ('garantir_cliente', 'incluir_os', 'alterar_os', 'faturar_os');
  get diagnostics _n = row_count;
  _p := receita.fat_transicao(_p.id, 'na_fila_omie', null, 'reenviado', jsonb_build_object('reenfileirados', _n));
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'reenfileirados', _n);
end $$;

create or replace function ops.fat_pedido_descartar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'descartar');
  update receita.fat_pedido_parcelas set situacao = 'cancelado' where pedido_id = _p.id and situacao <> 'pago';
  _p := receita.fat_transicao(_p.id, 'cancelado', 'descartado pelo autor', 'descartado');
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status);
end $$;

create or replace function ops.fat_pedido_cancelar(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;

  if _p.status = 'cancelamento_pedido' then
    -- A tesouraria efetiva (cancelou no Omie): RF-P11
    perform receita.fat_exigir(_e, _p, 'confirmar_cancelamento');
    update receita.fat_pedido_parcelas set situacao = 'cancelado' where pedido_id = _p.id and situacao <> 'pago';
    _p := receita.fat_transicao(_p.id, 'cancelado', p_motivo, 'cancelado');
  else
    if nullif(btrim(p_motivo), '') is null then
      perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo do cancelamento.'));
    end if;
    perform receita.fat_exigir(_e, _p, 'pedir_cancelamento');
    _p := receita.fat_transicao(_p.id, 'cancelamento_pedido', p_motivo, 'cancelamento_pedido');
  end if;
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status);
end $$;

-- 4.10 Tesouraria: conferir, faturar, devolver
create or replace function ops.fat_tesouraria_acao(p_id uuid, p_acao text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _modo text;
  _st text;
  _faturando boolean := false;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  if not _p.emissora_id = any (_e.tesouraria) then
    raise exception 'Só a tesouraria desta empresa faz isso.' using errcode = '42501';
  end if;

  case p_acao
    when 'em_conferencia' then
      perform receita.fat_exigir(_e, _p, 'conferir');
      _p := receita.fat_transicao(_p.id, 'em_conferencia', null, 'conferencia');
    when 'devolver' then
      if nullif(btrim(p_motivo), '') is null then
        perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo da devolução.'));
      end if;
      perform receita.fat_exigir(_e, _p, 'devolver');
      _p := receita.fat_transicao(_p.id, 'devolvido', p_motivo, 'devolvido');
    when 'faturar' then
      perform receita.fat_exigir(_e, _p, 'faturar');
      select x.status into _st from integracoes.omie_envios x where x.operacao = 'faturar_os' and x.codigo_integracao = _p.numero;
      if _st = 'ok' then raise exception 'Pedido % já foi faturado no Omie.', _p.numero using errcode = '55000'; end if;
      select case when _p.simulacao then 'simular' else g.modo_omie end into _modo
        from organizacao.empresas_grupo g where g.id = _p.emissora_id;
      insert into integracoes.omie_envios as x
        (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
         proxima_tentativa_em, resposta, erro_legivel)
      values (_p.emissora_id, 'fat_pedido', _p.id, 'faturar_os', _p.numero,
              jsonb_build_object('versao', 1, 'pedido', jsonb_build_object('id', _p.id, 'numero', _p.numero),
                                 'emissora', jsonb_build_object('id', _p.emissora_id),
                                 'omie_os_codigo', _p.omie_os_codigo,
                                 'parcelas', (receita.fat_snapshot(_p.id) -> 'parcelas')),
              _modo, 'pendente', 0, now(), null, null)
      on conflict (operacao, codigo_integracao) do update
         set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
             proxima_tentativa_em = now(), resposta = null, erro_legivel = null;
      perform receita.fat_evento_pedido(_p, 'faturar_pedido', jsonb_build_object('modo', _modo));
      _faturando := true;
    else
      perform receita.fat_recusar(receita.fat_erro('p_acao', 'Ação da tesouraria desconhecida (em_conferencia, faturar ou devolver).'));
  end case;
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'faturando', _faturando);
end $$;

-- 4.11 Atualizar a situação no Omie sob demanda (RF-P09)
create or replace function ops.fat_atualizar_status(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _x integracoes.omie_envios;
  _modo text;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'atualizar_status');

  select * into _x from integracoes.omie_envios x where x.operacao = 'consultar_status' and x.codigo_integracao = _p.numero;
  if found and _x.status in ('pendente', 'processando') then
    return jsonb_build_object('enfileirado', false, 'tentar_em', _x.proxima_tentativa_em);
  end if;
  select g.modo_omie into _modo from organizacao.empresas_grupo g where g.id = _p.emissora_id;
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel)
  values (_p.emissora_id, 'fat_pedido', _p.id, 'consultar_status', _p.numero,
          jsonb_build_object('versao', 1, 'pedido', jsonb_build_object('id', _p.id, 'numero', _p.numero),
                             'emissora', jsonb_build_object('id', _p.emissora_id), 'omie_os_codigo', _p.omie_os_codigo,
                             'parcelas', (receita.fat_snapshot(_p.id) -> 'parcelas')),
          _modo, 'pendente', 0, now(), null, null)
  on conflict (operacao, codigo_integracao) do update
     set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
         proxima_tentativa_em = now(), resposta = null, erro_legivel = null
  returning x.* into _x;
  return jsonb_build_object('enfileirado', true, 'tentar_em', _x.proxima_tentativa_em);
end $$;

-- 4.12 Configuração (controladoria)
create or replace function ops.fat_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if cardinality(_e.controladoria) = 0 then
    raise exception 'Só a controladoria abre a configuração do faturamento.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pode_gravar_omie', _e.admin,
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'razao_social', g.razao_social, 'cnpj', g.cnpj, 'ativa', g.ativa,
               'fatura_por', g.fatura_por, 'modo_omie', g.modo_omie, 'pipefy_sync', g.pipefy_sync,
               'conta_corrente_padrao', g.conta_corrente_padrao,
               'tem_chave', g.omie_credencial_ref is not null
                            and exists (select 1 from vault.secrets v where v.name = g.omie_credencial_ref),
               'tem_pedido', exists (select 1 from receita.fat_pedidos p where p.emissora_id = g.id),
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate, 'ultimo_ok_em', s.ultimo_ok_em,
                                          'ultima_falha_em', s.ultima_falha_em),
               'pessoas', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', d.id, 'pessoa', receita.fat_pessoa(d.user_id), 'email', u.email, 'papel', d.papel,
                          'substituto', receita.fat_pessoa(d.substituto_id), 'ativo', d.ativo, 'desde', d.created_at,
                          'abre_faturamento', ops.can_user(d.user_id, 'view.faturamento'),
                          'aguardando_ok', case when d.papel = 'dono' then (
                            select count(*) from receita.fat_pedidos p
                             where p.emissora_id = g.id and p.dono_id = d.user_id and p.status = 'aguardando_ok') end)
                        order by d.papel, u.nome)
                   from receita.fat_donos d left join public.profiles u on u.user_id = d.user_id
                  where d.emissora_id = g.id), '[]'::jsonb),
               'contagem', (select jsonb_build_object(
                              'donos', count(*) filter (where d.papel = 'dono'),
                              'gestores', count(*) filter (where d.papel = 'gestor'),
                              'solicitantes', count(*) filter (where d.papel = 'solicitante'))
                              from receita.fat_donos d where d.emissora_id = g.id and d.ativo),
               'servicos', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', v.id, 'codigo_omie', v.codigo_omie, 'codigo', v.codigo, 'descricao', v.descricao,
                          'codigo_lc116', v.codigo_lc116, 'codigo_municipal', v.codigo_municipal,
                          'tem_tributacao', v.tem_tributacao, 'ativo', v.ativo, 'no_omie', v.no_omie,
                          'categoria_padrao', v.categoria_padrao, 'conta_corrente_padrao', v.conta_corrente_padrao,
                          'sincronizado_em', v.sincronizado_em) order by v.descricao)
                   from receita.fat_servicos v where v.emissora_id = g.id), '[]'::jsonb),
               'servicos_liberados', (select count(*) from receita.fat_servicos v
                                       where v.emissora_id = g.id and v.ativo and v.no_omie and v.tem_tributacao),
               'servicos_total', (select count(*) from receita.fat_servicos v where v.emissora_id = g.id),
               'sincronizacao', (select jsonb_build_object('status', x.status, 'erro_legivel', x.erro_legivel, 'em', x.updated_at)
                                   from integracoes.omie_envios x
                                  where x.origem = 'fat_emissora' and x.origem_id = g.id and x.operacao = 'sincronizar_servicos'))
             order by g.ativa desc, g.apelido)
        from organizacao.empresas_grupo g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id
       where g.id = any (_e.controladoria)), '[]'::jsonb),
    'pessoas_ativas', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.user_id, 'nome', coalesce(nullif(btrim(u.nome), ''), u.email),
                                          'email', u.email, 'abre_faturamento', ops.can_user(u.user_id, 'view.faturamento'))
                       order by u.nome)
        from public.profiles u where u.ativo), '[]'::jsonb));
end $$;

create or replace function ops.fat_dono_salvar(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _d receita.fat_donos;
  _id uuid;
  _emissora uuid;
  _user uuid;
  _papel text;
  _subst uuid;
  _ativo boolean;
  _k text;
  _erros jsonb := '[]'::jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    perform receita.fat_recusar(receita.fat_erro(null, 'p_dados precisa ser um objeto.'));
  end if;
  for _k in select jsonb_object_keys(p_dados) loop
    if _k not in ('id', 'emissora_id', 'user_id', 'papel', 'substituto_id', 'ativo') then
      _erros := _erros || receita.fat_erro(_k, 'Campo desconhecido.');
    end if;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;
  begin
    _id := (p_dados ->> 'id')::uuid;
    _emissora := (p_dados ->> 'emissora_id')::uuid;
    _user := (p_dados ->> 'user_id')::uuid;
    _subst := (p_dados ->> 'substituto_id')::uuid;
    _papel := p_dados ->> 'papel';
    _ativo := coalesce((p_dados -> 'ativo')::boolean, true);
  exception when others then
    perform receita.fat_recusar(receita.fat_erro(null, 'Valor inválido em p_dados.'));
  end;

  if _id is not null then
    select * into _d from receita.fat_donos where id = _id for update;
    if not found then raise exception 'Cadastro não encontrado.' using errcode = 'P0002'; end if;
    if not _d.emissora_id = any (_e.controladoria) then
      raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
    end if;
    if (p_dados ? 'emissora_id' and _emissora is distinct from _d.emissora_id)
       or (p_dados ? 'user_id' and _user is distinct from _d.user_id)
       or (p_dados ? 'papel' and _papel is distinct from _d.papel) then
      perform receita.fat_recusar(receita.fat_erro('papel', 'Para mudar a pessoa, a empresa ou o papel, desative e cadastre de novo.'));
    end if;
    _papel := _d.papel; _user := _d.user_id; _emissora := _d.emissora_id;
    if not p_dados ? 'substituto_id' then _subst := _d.substituto_id; end if;
    if not p_dados ? 'ativo' then _ativo := _d.ativo; end if;
  else
    if _emissora is null or _user is null or _papel is null then
      perform receita.fat_recusar(receita.fat_erro(null, 'Informe a empresa, a pessoa e o papel.'));
    end if;
    if not _emissora = any (_e.controladoria) then
      raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
    end if;
    if _papel not in ('dono', 'gestor', 'solicitante') then
      perform receita.fat_recusar(receita.fat_erro('papel', 'O papel é dono, gestor ou solicitante.'));
    end if;
    if not exists (select 1 from organizacao.empresas_grupo g where g.id = _emissora) then
      perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Empresa desconhecida.'));
    end if;
  end if;

  if not exists (select 1 from public.profiles u where u.user_id = _user and u.ativo) then
    perform receita.fat_recusar(receita.fat_erro('user_id', 'Essa pessoa não está ativa no Brain.'));
  end if;
  if _subst is not null then
    if _papel <> 'dono' then perform receita.fat_recusar(receita.fat_erro('substituto_id', 'Só dono tem substituto.')); end if;
    if _subst = _user then perform receita.fat_recusar(receita.fat_erro('substituto_id', 'O substituto não pode ser a própria pessoa.')); end if;
    if not exists (select 1 from public.profiles u where u.user_id = _subst and u.ativo) then
      perform receita.fat_recusar(receita.fat_erro('substituto_id', 'O substituto não está ativo no Brain.'));
    end if;
  end if;

  if _id is not null then
    update receita.fat_donos set substituto_id = _subst, ativo = _ativo where id = _id returning * into _d;
  else
    insert into receita.fat_donos as d (emissora_id, user_id, papel, substituto_id, ativo)
    values (_emissora, _user, _papel, _subst, true)
    on conflict (emissora_id, user_id, papel) do update set substituto_id = excluded.substituto_id, ativo = true
    returning d.* into _d;
  end if;
  return jsonb_build_object('id', _d.id, 'emissora_id', _d.emissora_id, 'pessoa', receita.fat_pessoa(_d.user_id),
                            'papel', _d.papel, 'substituto', receita.fat_pessoa(_d.substituto_id), 'ativo', _d.ativo,
                            'abre_faturamento', ops.can_user(_d.user_id, 'view.faturamento'));
end $$;

create or replace function ops.fat_dono_remover(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _d receita.fat_donos;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _d from receita.fat_donos where id = p_id for update;
  if not found then raise exception 'Cadastro não encontrado.' using errcode = 'P0002'; end if;
  if not _d.emissora_id = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  update receita.fat_donos set ativo = false where id = p_id returning * into _d;
  return jsonb_build_object('id', _d.id, 'ativo', _d.ativo, 'aguardando_ok', (
    select count(*) from receita.fat_pedidos p
     where p.emissora_id = _d.emissora_id and p.dono_id = _d.user_id and p.status = 'aguardando_ok'));
end $$;

create or replace function ops.fat_servico_ativar(p_id uuid, p_ativo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _s receita.fat_servicos;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_ativo is null then perform receita.fat_recusar(receita.fat_erro('p_ativo', 'Diga true ou false.')); end if;
  select * into _s from receita.fat_servicos where id = p_id for update;
  if not found then raise exception 'Serviço não encontrado.' using errcode = 'P0002'; end if;
  if not _s.emissora_id = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  if _s.ativo is distinct from p_ativo then
    update receita.fat_servicos set ativo = p_ativo where id = p_id;
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('servico', _s.id, _s.emissora_id, case when p_ativo then 'liberado' else 'retirado' end,
            case when _s.ativo then 'ativo' else 'inativo' end, case when p_ativo then 'ativo' else 'inativo' end,
            jsonb_build_object('ativo', jsonb_build_object('de', _s.ativo, 'para', p_ativo), 'descricao', _s.descricao),
            auth.uid());
  end if;
  return jsonb_build_object('id', _s.id, 'ativo', p_ativo, 'rascunhos_usando', (
    select count(*) from receita.fat_pedidos p where p.servico_id = _s.id and p.status in ('rascunho', 'devolvido')));
end $$;

create or replace function ops.fat_servico_padroes(p_id uuid, p_categoria text, p_conta_corrente bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _s receita.fat_servicos;
  _n receita.fat_servicos;
  _diff jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_conta_corrente is not null and p_conta_corrente <= 0 then
    perform receita.fat_recusar(receita.fat_erro('p_conta_corrente', 'Conta corrente inválida.'));
  end if;
  select * into _s from receita.fat_servicos where id = p_id for update;
  if not found then raise exception 'Serviço não encontrado.' using errcode = 'P0002'; end if;
  if not _s.emissora_id = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  update receita.fat_servicos
     set categoria_padrao = nullif(btrim(p_categoria), ''), conta_corrente_padrao = p_conta_corrente
   where id = p_id returning * into _n;
  _diff := receita.fat_diff(to_jsonb(_s), to_jsonb(_n), array['categoria_padrao', 'conta_corrente_padrao']);
  if _diff <> '{}'::jsonb then
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('servico', _n.id, _n.emissora_id, 'alterado', null, null, _diff, auth.uid());
  end if;
  return jsonb_build_object('id', _n.id, 'categoria_padrao', _n.categoria_padrao, 'conta_corrente_padrao', _n.conta_corrente_padrao);
end $$;

create or replace function ops.fat_servicos_sincronizar(p_emissora uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  g organizacao.empresas_grupo;
  _x integracoes.omie_envios;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  select * into g from organizacao.empresas_grupo where id = p_emissora;
  if not g.ativa or g.omie_credencial_ref is null then
    raise exception 'A % não tem Omie no portal.', g.apelido using errcode = '55000';
  end if;
  select * into _x from integracoes.omie_envios x
   where x.operacao = 'sincronizar_servicos' and x.codigo_integracao = 'servicos:' || g.id::text;
  if found and _x.status in ('pendente', 'processando') then
    return jsonb_build_object('envio_id', _x.id, 'status', _x.status);
  end if;
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel)
  values (g.id, 'fat_emissora', g.id, 'sincronizar_servicos', 'servicos:' || g.id::text,
          jsonb_build_object('versao', 1, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido)),
          g.modo_omie, 'pendente', 0, now(), null, null)
  on conflict (operacao, codigo_integracao) do update
     set modo = excluded.modo, status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), resposta = null,
         erro_legivel = null
  returning x.* into _x;
  return jsonb_build_object('envio_id', _x.id, 'status', _x.status);
end $$;

create or replace function ops.fat_emissora_config(p_emissora uuid, p_modo_omie text default null,
                                                   p_pipefy_sync boolean default null, p_fatura_por text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  g organizacao.empresas_grupo;
  n organizacao.empresas_grupo;
  _diff jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  if p_modo_omie is not null and p_modo_omie not in ('simular', 'gravar') then
    perform receita.fat_recusar(receita.fat_erro('p_modo_omie', 'Use simular ou gravar.'));
  end if;
  if p_fatura_por is not null and p_fatura_por not in ('os', 'contrato', 'ambos') then
    perform receita.fat_recusar(receita.fat_erro('p_fatura_por', 'Use os, contrato ou ambos.'));
  end if;
  select * into g from organizacao.empresas_grupo where id = p_emissora for update;
  if p_modo_omie = 'gravar' and g.modo_omie <> 'gravar' then
    if not _e.admin then
      raise exception 'Só o administrador do Brain liga a gravação no Omie (trava da E1).' using errcode = '42501';
    end if;
    if not g.ativa or g.omie_credencial_ref is null
       or not exists (select 1 from vault.secrets v where v.name = g.omie_credencial_ref) then
      raise exception 'A % não tem chave do Omie no cofre.', g.apelido using errcode = '55000';
    end if;
  end if;
  update organizacao.empresas_grupo
     set modo_omie = coalesce(p_modo_omie, modo_omie), pipefy_sync = coalesce(p_pipefy_sync, pipefy_sync),
         fatura_por = coalesce(p_fatura_por, fatura_por)
   where id = p_emissora returning * into n;
  _diff := receita.fat_diff(to_jsonb(g), to_jsonb(n), array['modo_omie', 'pipefy_sync', 'fatura_por']);
  if _diff <> '{}'::jsonb then
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('emissora', n.id, n.id, 'configurado', g.modo_omie, n.modo_omie, _diff, auth.uid());
  end if;
  return jsonb_build_object('id', n.id, 'apelido', n.apelido, 'modo_omie', n.modo_omie, 'pipefy_sync', n.pipefy_sync,
                            'fatura_por', n.fatura_por);
end $$;

-- =================================================================================================================
-- 5. RPCs do conector (integracoes, só service_role)
-- =================================================================================================================

create or replace function integracoes.fat_exigir_conector()
returns void language plpgsql stable set search_path = '' as $$
begin
  if coalesce(current_setting('role', true), 'none') <> 'service_role' then
    raise exception 'Só o conector (service_role) chama esta função.' using errcode = '42501';
  end if;
end $$;

create or replace function integracoes.fat_envio_proximos(p_limite integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _ids uuid[];
begin
  perform integracoes.fat_exigir_conector();
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'p_limite vai de 1 a 100.' using errcode = '22023';
  end if;
  -- Conector que caiu no meio: o envio volta para a fila (o Omie reconhece pelo código de integração).
  update integracoes.omie_envios set status = 'pendente', proxima_tentativa_em = now()
   where status = 'processando' and updated_at < now() - interval '15 minutes';

  with cand as (
    select e.id
      from integracoes.omie_envios e
      join organizacao.empresas_grupo g on g.id = e.emissora_id and g.ativa
      left join integracoes.omie_emissora_estado s on s.emissora_id = e.emissora_id
      left join integracoes.omie_envios d on d.id = e.depende_de
      left join receita.fat_pedidos p on e.origem = 'fat_pedido' and p.id = e.origem_id
     where e.status = 'pendente' and e.proxima_tentativa_em <= now()
       and (s.bloqueada_ate is null or s.bloqueada_ate <= now())
       and (e.depende_de is null or d.status in ('ok', 'simulado'))
       and (e.origem <> 'fat_pedido'
            or (e.operacao = 'consultar_status' and p.status not in ('rascunho', 'aguardando_ok'))
            or (e.operacao <> 'consultar_status'
                and p.status not in ('rascunho', 'aguardando_ok', 'devolvido', 'cancelamento_pedido', 'cancelado')))
     order by e.proxima_tentativa_em, e.created_at
     limit p_limite
     for update of e skip locked
  ), upd as (
    update integracoes.omie_envios e set status = 'processando', tentativas = e.tentativas + 1
      from cand where e.id = cand.id
    returning e.id
  )
  select array_agg(upd.id) into _ids from upd;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
             'origem', e.origem, 'origem_id', e.origem_id, 'operacao', e.operacao,
             'codigo_integracao', e.codigo_integracao, 'modo', e.modo, 'tentativas', e.tentativas,
             'payload', e.payload,
             'cliente_omie', (select jsonb_build_object('codigo_cliente_omie', v.codigo_cliente_omie,
                                                        'codigo_cliente_integracao', v.codigo_cliente_integracao)
                                from integracoes.omie_vinculo_cliente v
                               where v.emissora_id = e.emissora_id and v.documento = e.payload -> 'tomador' ->> 'documento'),
             'dependencia', (select jsonb_build_object('operacao', d.operacao, 'status', d.status, 'codigos', d.resposta -> 'codigos')
                               from integracoes.omie_envios d where d.id = e.depende_de))
           order by e.proxima_tentativa_em, e.created_at)
      from integracoes.omie_envios e join organizacao.empresas_grupo g on g.id = e.emissora_id
     where e.id = any (_ids)), '[]'::jsonb);
end $$;

create or replace function integracoes.fat_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb default null,
                                                           p_erro_legivel text default null,
                                                           p_codigos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _x integracoes.omie_envios;
  _p receita.fat_pedidos;
  _c jsonb := coalesce(p_codigos, '{}'::jsonb);
  _escrita boolean;
  _erro text := nullif(btrim(p_erro_legivel), '');
  _ate timestamptz;
  _os bigint;
  _de_ok text[];
  _ev text;
begin
  perform integracoes.fat_exigir_conector();
  select * into _x from integracoes.omie_envios where id = p_envio for update;
  if not found then raise exception 'Envio não encontrado.' using errcode = 'P0002'; end if;
  if _x.status <> 'processando' then
    raise exception 'O envio % está %, não processando: reserve antes por fat_envio_proximos.', _x.id, _x.status
      using errcode = '55000';
  end if;
  if p_status not in ('ok', 'simulado', 'erro', 'pendente') then
    raise exception 'p_status: ok, simulado, erro ou pendente.' using errcode = '22023';
  end if;
  if jsonb_typeof(_c) <> 'object' then raise exception 'p_codigos precisa ser um objeto.' using errcode = '22023'; end if;
  _escrita := _x.operacao in ('garantir_cliente', 'incluir_os', 'alterar_os', 'faturar_os', 'incluir_conta_receber');
  if _escrita and p_status = 'ok' and _x.modo <> 'gravar' then
    raise exception 'Envio em modo simular não pode voltar ok: responda simulado.' using errcode = '22023';
  end if;
  if _escrita and p_status = 'simulado' and _x.modo <> 'simular' then
    raise exception 'Envio em modo gravar não pode voltar simulado.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel: escreva a mensagem para quem opera.' using errcode = '22023';
  end if;
  if p_status = 'ok' and _x.operacao in ('incluir_os', 'alterar_os') and nullif(_c ->> 'nCodOS', '') is null then
    raise exception 'incluir_os/alterar_os ok sem nCodOS em p_codigos.' using errcode = '22023';
  end if;

  -- Envio
  update integracoes.omie_envios
     set status = p_status,
         resposta = case when p_resposta is null or jsonb_typeof(p_resposta) <> 'object'
                         then jsonb_build_object('retorno', p_resposta, 'codigos', _c)
                         else p_resposta || jsonb_build_object('codigos', _c) end,
         erro_legivel = _erro,
         proxima_tentativa_em = case when p_status = 'pendente' then coalesce(
             (_c ->> 'tentar_em')::timestamptz,
             now() + case when _x.tentativas <= 1 then interval '1 minute' when _x.tentativas = 2 then interval '5 minutes'
                          when _x.tentativas = 3 then interval '15 minutes' else interval '60 minutes' end)
           else proxima_tentativa_em end
   where id = _x.id
  returning * into _x;

  -- Estado do Omie da emissora (CA-12: bloqueia só a fila dela)
  _ate := (_c ->> 'bloquear_emissora_ate')::timestamptz;
  if _ate is not null or _c ? 'emissora_indisponivel' or p_status in ('ok', 'simulado', 'erro') then
    insert into integracoes.omie_emissora_estado as s
      (emissora_id, bloqueada_ate, indisponivel, motivo, ultimo_ok_em, ultima_falha_em)
    values (_x.emissora_id, _ate,
            coalesce((_c ->> 'emissora_indisponivel')::boolean, false),
            case when coalesce((_c ->> 'emissora_indisponivel')::boolean, false) then coalesce(_erro, 'Omie indisponível.') end,
            case when p_status in ('ok', 'simulado') then now() end,
            case when p_status = 'erro' then now() end)
    on conflict (emissora_id) do update
       set bloqueada_ate = coalesce(excluded.bloqueada_ate, s.bloqueada_ate),
           indisponivel = case when _c ? 'emissora_indisponivel' then excluded.indisponivel
                               when p_status in ('ok', 'simulado') then false else s.indisponivel end,
           motivo = case when _c ? 'emissora_indisponivel' then excluded.motivo
                         when p_status in ('ok', 'simulado') then null else s.motivo end,
           ultimo_ok_em = coalesce(excluded.ultimo_ok_em, s.ultimo_ok_em),
           ultima_falha_em = coalesce(excluded.ultima_falha_em, s.ultima_falha_em);
  end if;

  if p_status = 'pendente' or _x.origem <> 'fat_pedido' or _x.operacao = 'consultar_status' then
    return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status), 'pedido', null);
  end if;

  select * into _p from receita.fat_pedidos where id = _x.origem_id for update;

  if _x.operacao = 'garantir_cliente' and p_status in ('ok', 'simulado') then
    if nullif(_c ->> 'codigo_cliente_omie', '') is not null then
      insert into integracoes.omie_vinculo_cliente as v (emissora_id, documento, codigo_cliente_omie, codigo_cliente_integracao, sincronizado_em)
      values (_x.emissora_id, _p.tomador_documento, (_c ->> 'codigo_cliente_omie')::bigint, _c ->> 'codigo_cliente_integracao', now())
      on conflict (emissora_id, documento) do update
         set codigo_cliente_omie = excluded.codigo_cliente_omie,
             codigo_cliente_integracao = coalesce(excluded.codigo_cliente_integracao, v.codigo_cliente_integracao),
             sincronizado_em = now();
    end if;
    perform receita.fat_evento_pedido(_p, 'omie_cliente', jsonb_build_object(
      'modo', _x.modo, 'cliente_existia', _c -> 'cliente_existia', 'codigo_cliente_omie', _c -> 'codigo_cliente_omie'));
    return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status),
                              'pedido', jsonb_build_object('id', _p.id, 'status', _p.status));
  end if;

  if p_status = 'erro' then
    if _p.status in ('na_fila_omie', 'os_criada', 'simulado', 'em_conferencia') then
      _p := receita.fat_transicao(_p.id, 'erro_omie', _erro, 'omie_erro', jsonb_build_object('operacao', _x.operacao));
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'erro', _erro));
    end if;
  elsif _x.operacao in ('incluir_os', 'alterar_os') then
    _os := nullif(_c ->> 'nCodOS', '')::bigint;
    if _os is not null or _c ? 'cEtapa' then
      update receita.fat_pedidos set omie_os_codigo = coalesce(_os, omie_os_codigo),
                                     omie_os_etapa = coalesce(_c ->> 'cEtapa', omie_os_etapa)
       where id = _p.id returning * into _p;
    end if;
    if p_status = 'simulado' then
      update receita.fat_pedidos set simulacao = true where id = _p.id returning * into _p;
    end if;
    if _p.status in ('na_fila_omie', 'erro_omie') then
      _p := receita.fat_transicao(_p.id, case when p_status = 'ok' then 'os_criada' else 'simulado' end, null,
              case when p_status = 'simulado' then 'omie_simulado'
                   when _x.operacao = 'alterar_os' then 'omie_os_alterada' else 'omie_os_criada' end,
              jsonb_build_object('omie_os_codigo', jsonb_build_object('de', null, 'para', _os), 'modo', _x.modo)
                || case when p_status = 'simulado'
                        then jsonb_build_object('cliente_existe', _c -> 'cliente_existe', 'servico_existe', _c -> 'servico_existe')
                        else '{}'::jsonb end);
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'omie_os_codigo', _os));
    end if;
  elsif _x.operacao = 'faturar_os' then
    update receita.fat_pedidos
       set omie_nf_numero = coalesce(nullif(_c ->> 'nf_numero', ''), omie_nf_numero),
           omie_nf_link = coalesce(nullif(_c ->> 'nf_link', ''), omie_nf_link),
           omie_nf_emitida_em = coalesce((_c ->> 'nf_emitida_em')::timestamptz, omie_nf_emitida_em),
           simulacao = simulacao or p_status = 'simulado'
     where id = _p.id returning * into _p;
    if jsonb_typeof(_c -> 'titulos') = 'array' then
      update receita.fat_pedido_parcelas x set omie_titulo_codigo = (t ->> 'codigo')::bigint
        from jsonb_array_elements(_c -> 'titulos') t
       where x.pedido_id = _p.id and x.n = (t ->> 'parcela')::int and nullif(t ->> 'codigo', '') is not null;
    end if;
    if _p.status in ('na_fila_omie', 'erro_omie', 'os_criada', 'simulado', 'em_conferencia') then
      _p := receita.fat_transicao(_p.id, 'faturado', null, case when p_status = 'simulado' then 'faturado_simulado' else 'faturado' end,
              jsonb_build_object('omie_nf_numero', _p.omie_nf_numero, 'modo', _x.modo));
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'omie_nf_numero', _p.omie_nf_numero));
    end if;
  end if;

  return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status),
                            'pedido', jsonb_build_object('id', _p.id, 'status', _p.status));
end $$;

create or replace function integracoes.fat_status_aplicar(p_pedido uuid, p_status jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _p receita.fat_pedidos;
  _s jsonb := coalesce(p_status, '{}'::jsonb);
  _t jsonb;
  _par receita.fat_pedido_parcelas;
  _antes text;
  _para text;
  _faturou_portal boolean;
  _hoje date := receita.fat_hoje();
  _total int;
  _pagas int;
  _atraso boolean;
begin
  perform integracoes.fat_exigir_conector();
  if jsonb_typeof(_s) <> 'object' then raise exception 'p_status precisa ser um objeto.' using errcode = '22023'; end if;
  select * into _p from receita.fat_pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if _p.simulacao then
    return jsonb_build_object('pedido', jsonb_build_object('id', _p.id, 'status', _p.status), 'mudou', false,
                              'ignorado', 'simulado');
  end if;
  _antes := _p.status;

  update receita.fat_pedidos
     set omie_os_codigo = coalesce(omie_os_codigo, nullif(_s #>> '{os,codigo}', '')::bigint),
         omie_os_etapa = coalesce(nullif(_s #>> '{os,etapa}', ''), omie_os_etapa),
         omie_nf_numero = coalesce(nullif(_s #>> '{nf,numero}', ''), omie_nf_numero),
         omie_nf_link = coalesce(nullif(_s #>> '{nf,link}', ''), omie_nf_link),
         omie_nf_emitida_em = coalesce(nullif(_s #>> '{nf,emitida_em}', '')::timestamptz, omie_nf_emitida_em),
         omie_lido_em = coalesce(nullif(_s ->> 'lido_em', '')::timestamptz, now())
   where id = _p.id returning * into _p;

  if jsonb_typeof(_s -> 'titulos') = 'array' then
    for _t in select * from jsonb_array_elements(_s -> 'titulos') loop
      if (_t ->> 'situacao') is not null and (_t ->> 'situacao') not in ('a_vencer', 'pago', 'em_atraso', 'cancelado') then
        raise exception 'Situação de título desconhecida: %', _t ->> 'situacao' using errcode = '22023';
      end if;
      select * into _par from receita.fat_pedido_parcelas where pedido_id = _p.id and n = (_t ->> 'parcela')::int for update;
      continue when not found;
      update receita.fat_pedido_parcelas
         set omie_titulo_codigo = coalesce(nullif(_t ->> 'codigo', '')::bigint, omie_titulo_codigo),
             situacao = coalesce(_t ->> 'situacao', situacao),
             pago_em = case when coalesce(_t ->> 'situacao', situacao) = 'pago'
                            then coalesce(nullif(_t ->> 'pago_em', '')::date, pago_em, _hoje) else null end
       where pedido_id = _p.id and n = _par.n;
      if _par.situacao <> 'pago' and _t ->> 'situacao' = 'pago' then
        perform receita.fat_evento_pedido(_p, 'parcela_paga', jsonb_build_object(
          'parcela', _par.n, 'de_parcelas', _p.parcelas, 'valor', _par.valor,
          'pago_em', coalesce(nullif(_t ->> 'pago_em', '')::date, _hoje)));
      end if;
    end loop;
  end if;

  -- Nota emitida: faturado (pelo portal ou direto no Omie, RF-P08)
  if _p.omie_nf_numero is not null and _p.status in ('na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia') then
    _faturou_portal := exists (select 1 from integracoes.omie_envios x
                                where x.operacao = 'faturar_os' and x.codigo_integracao = _p.numero and x.status = 'ok');
    _p := receita.fat_transicao(_p.id, 'faturado', null,
            case when _faturou_portal then 'faturado' else 'faturado_no_omie' end,
            jsonb_build_object('omie_nf_numero', _p.omie_nf_numero));
  end if;

  -- Títulos: recebido, em atraso ou faturado
  if _p.status in ('faturado', 'em_atraso', 'recebido') then
    select count(*) filter (where x.situacao <> 'cancelado'), count(*) filter (where x.situacao = 'pago'),
           coalesce(bool_or(x.situacao not in ('pago', 'cancelado') and x.vencimento < _hoje), false)
      into _total, _pagas, _atraso
      from receita.fat_pedido_parcelas x where x.pedido_id = _p.id;
    _para := case when _total > 0 and _pagas = _total then 'recebido' when _atraso then 'em_atraso' else 'faturado' end;
    if _para <> _p.status then
      _p := receita.fat_transicao(_p.id, _para, null, _para,
              jsonb_build_object('parcelas_pagas', _pagas, 'parcelas', _total));
    end if;
  end if;

  update integracoes.omie_emissora_estado set ultimo_ok_em = now() where emissora_id = _p.emissora_id;
  return jsonb_build_object('pedido', jsonb_build_object('id', _p.id, 'status', _p.status), 'mudou', _p.status <> _antes);
end $$;

create or replace function integracoes.fat_status_enfileirar(p_emissora uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _n int;
begin
  perform integracoes.fat_exigir_conector();
  insert into integracoes.omie_envios as x
    (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
     proxima_tentativa_em, resposta, erro_legivel)
  select p.emissora_id, 'fat_pedido', p.id, 'consultar_status', p.numero,
         jsonb_build_object('versao', 1, 'pedido', jsonb_build_object('id', p.id, 'numero', p.numero),
                            'emissora', jsonb_build_object('id', p.emissora_id), 'omie_os_codigo', p.omie_os_codigo,
                            'parcelas', (receita.fat_snapshot(p.id) -> 'parcelas')),
         g.modo_omie, 'pendente', 0, now(), null, null
    from receita.fat_pedidos p join organizacao.empresas_grupo g on g.id = p.emissora_id
   where p.status in ('os_criada', 'em_conferencia', 'faturado', 'em_atraso', 'cancelamento_pedido')
     and p.omie_os_codigo is not null and not p.simulacao and g.ativa
     and (p_emissora is null or p.emissora_id = p_emissora)
  on conflict (operacao, codigo_integracao) do update
     set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
         proxima_tentativa_em = now(), resposta = null, erro_legivel = null
   where x.status not in ('pendente', 'processando');
  get diagnostics _n = row_count;
  return jsonb_build_object('enfileirados', _n);
end $$;

create or replace function integracoes.fat_servicos_aplicar(p_emissora uuid, p_catalogo jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _item jsonb;
  _s receita.fat_servicos;
  _n receita.fat_servicos;
  _cod text;
  _entraram int := 0;
  _mudaram int := 0;
  _sairam int := 0;
  _diff jsonb;
  _vistos text[] := '{}';
  _campos constant text[] := array['codigo', 'descricao', 'codigo_lc116', 'codigo_municipal', 'id_tributacao',
                                   'tributacao', 'categoria_padrao', 'no_omie'];
begin
  perform integracoes.fat_exigir_conector();
  if not exists (select 1 from organizacao.empresas_grupo g where g.id = p_emissora) then
    raise exception 'Emissora desconhecida.' using errcode = 'P0002';
  end if;
  if p_catalogo is null or jsonb_typeof(p_catalogo) <> 'array' or jsonb_array_length(p_catalogo) = 0 then
    raise exception 'Catálogo vazio ou fora do formato: nada aplicado (mais provável erro de leitura).' using errcode = '22023';
  end if;

  for _item in select * from jsonb_array_elements(p_catalogo) loop
    _cod := nullif(btrim(_item ->> 'codigo_omie'), '');
    if _cod is null or nullif(btrim(_item ->> 'descricao'), '') is null then
      raise exception 'Item do catálogo sem codigo_omie ou descricao.' using errcode = '22023';
    end if;
    if _item ? 'tributacao' and jsonb_typeof(_item -> 'tributacao') <> 'object' then
      raise exception 'tributacao do serviço % precisa ser objeto.', _cod using errcode = '22023';
    end if;
    _vistos := _vistos || _cod;
    select * into _s from receita.fat_servicos where emissora_id = p_emissora and codigo_omie = _cod for update;
    if not found then
      insert into receita.fat_servicos (emissora_id, codigo_omie, codigo, descricao, codigo_lc116, codigo_municipal,
                                        id_tributacao, tributacao, categoria_padrao, ativo, no_omie, sincronizado_em)
      values (p_emissora, _cod, _item ->> 'codigo', btrim(_item ->> 'descricao'), _item ->> 'codigo_lc116',
              _item ->> 'codigo_municipal', _item ->> 'id_tributacao', coalesce(_item -> 'tributacao', '{}'::jsonb),
              _item ->> 'categoria', false, not coalesce((_item ->> 'inativo')::boolean, false), now())
      returning * into _n;
      insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
      values ('servico', _n.id, p_emissora, 'entrou', null, 'inativo',
              jsonb_build_object('codigo_omie', _cod, 'descricao', _n.descricao), null);
      _entraram := _entraram + 1;
    else
      update receita.fat_servicos
         set codigo = _item ->> 'codigo', descricao = btrim(_item ->> 'descricao'),
             codigo_lc116 = _item ->> 'codigo_lc116', codigo_municipal = _item ->> 'codigo_municipal',
             id_tributacao = _item ->> 'id_tributacao', tributacao = coalesce(_item -> 'tributacao', tributacao),
             categoria_padrao = coalesce(categoria_padrao, _item ->> 'categoria'),
             no_omie = not coalesce((_item ->> 'inativo')::boolean, false), sincronizado_em = now()
       where id = _s.id returning * into _n;
      _diff := receita.fat_diff(to_jsonb(_s), to_jsonb(_n), _campos);
      if _diff <> '{}'::jsonb then
        insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
        values ('servico', _n.id, p_emissora, case when _s.no_omie and not _n.no_omie then 'saiu' else 'mudou' end,
                null, null, _diff, null);
        if _s.no_omie and not _n.no_omie then _sairam := _sairam + 1; else _mudaram := _mudaram + 1; end if;
      end if;
    end if;
  end loop;

  -- Sumiu do Omie: sai do pedido
  for _s in select * from receita.fat_servicos
             where emissora_id = p_emissora and no_omie and not codigo_omie = any (_vistos) for update loop
    update receita.fat_servicos set no_omie = false, sincronizado_em = now() where id = _s.id;
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('servico', _s.id, p_emissora, 'saiu', null, null,
            jsonb_build_object('no_omie', jsonb_build_object('de', true, 'para', false), 'descricao', _s.descricao), null);
    _sairam := _sairam + 1;
  end loop;

  return jsonb_build_object('entraram', _entraram, 'mudaram', _mudaram, 'sairam', _sairam,
                            'total', jsonb_array_length(p_catalogo));
end $$;

create or replace function integracoes.pipefy_envio_proximos(p_limite integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _ids uuid[];
begin
  perform integracoes.fat_exigir_conector();
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'p_limite vai de 1 a 100.' using errcode = '22023';
  end if;
  update integracoes.pipefy_envios set status = 'pendente', proxima_tentativa_em = now()
   where status = 'processando' and updated_at < now() - interval '15 minutes';

  with cand as (
    select e.id
      from integracoes.pipefy_envios e
     where e.status = 'pendente' and e.proxima_tentativa_em <= now()
       and not exists (select 1 from integracoes.pipefy_envios x
                        where x.origem = e.origem and x.origem_id = e.origem_id and x.seq < e.seq
                          and x.status in ('pendente', 'processando', 'erro'))
     order by e.seq
     limit p_limite
     for update of e skip locked
  ), upd as (
    update integracoes.pipefy_envios e set status = 'processando', tentativas = e.tentativas + 1
      from cand where e.id = cand.id
    returning e.id
  )
  select array_agg(upd.id) into _ids from upd;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido), 'pipefy_sync', g.pipefy_sync,
             'origem', e.origem, 'origem_id', e.origem_id, 'operacao', e.operacao, 'tentativas', e.tentativas,
             'card_id', coalesce(e.card_id, (select x.card_id from integracoes.pipefy_envios x
                                              where x.origem = e.origem and x.origem_id = e.origem_id
                                                and x.operacao = 'criar_card' and x.card_id is not null
                                              order by x.seq desc limit 1)),
             'payload', e.payload)
           order by e.seq)
      from integracoes.pipefy_envios e join organizacao.empresas_grupo g on g.id = e.emissora_id
     where e.id = any (_ids)), '[]'::jsonb);
end $$;

create or replace function integracoes.pipefy_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb default null,
                                                              p_erro_legivel text default null, p_card_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _x integracoes.pipefy_envios;
  _erro text := nullif(btrim(p_erro_legivel), '');
begin
  perform integracoes.fat_exigir_conector();
  select * into _x from integracoes.pipefy_envios where id = p_envio for update;
  if not found then raise exception 'Envio não encontrado.' using errcode = 'P0002'; end if;
  if _x.status <> 'processando' then
    raise exception 'O envio % está %, não processando.', _x.id, _x.status using errcode = '55000';
  end if;
  if p_status not in ('ok', 'simulado', 'erro', 'pendente') then
    raise exception 'p_status: ok, simulado, erro ou pendente.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel.' using errcode = '22023';
  end if;
  update integracoes.pipefy_envios
     set status = p_status, resposta = p_resposta, erro_legivel = _erro,
         card_id = coalesce(nullif(btrim(p_card_id), ''), card_id),
         proxima_tentativa_em = case when p_status = 'pendente' then now() + case
             when tentativas <= 1 then interval '1 minute' when tentativas = 2 then interval '5 minutes'
             when tentativas = 3 then interval '15 minutes' else interval '60 minutes' end
           else proxima_tentativa_em end
   where id = _x.id returning * into _x;
  return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status, 'card_id', _x.card_id));
end $$;

create or replace function integracoes.receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  _d jsonb := coalesce(p_dados, '{}'::jsonb);
  _r integracoes.receita_cnpj;
begin
  perform integracoes.fat_exigir_conector();
  if char_length(_cnpj) <> 14 or not receita.fat_documento_valido(_cnpj) then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(_d ->> 'fonte'), '') is null then
    raise exception 'p_dados.fonte é obrigatório.' using errcode = '22023';
  end if;
  if _d ? 'emails' and jsonb_typeof(_d -> 'emails') <> 'array' then
    raise exception 'p_dados.emails precisa ser lista.' using errcode = '22023';
  end if;
  insert into integracoes.receita_cnpj as r
    (cnpj, razao_social, nome_fantasia, situacao, situacao_desde, municipio, uf, emails, fonte, consultado_em)
  values (_cnpj, nullif(btrim(_d ->> 'razao_social'), ''), nullif(btrim(_d ->> 'nome_fantasia'), ''),
          nullif(upper(btrim(_d ->> 'situacao')), ''), nullif(_d ->> 'situacao_desde', '')::date,
          nullif(btrim(_d ->> 'municipio'), ''), nullif(upper(btrim(_d ->> 'uf')), ''),
          coalesce(array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(_d -> 'emails', '[]'::jsonb)) x
                          where receita.fat_email_valido(lower(btrim(x)))), '{}'),
          btrim(_d ->> 'fonte'), coalesce(nullif(_d ->> 'consultado_em', '')::timestamptz, now()))
  on conflict (cnpj) do update
     set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, situacao = excluded.situacao,
         situacao_desde = excluded.situacao_desde, municipio = excluded.municipio, uf = excluded.uf,
         emails = excluded.emails, fonte = excluded.fonte, consultado_em = excluded.consultado_em
  returning r.* into _r;
  return jsonb_build_object('cnpj', _r.cnpj, 'situacao', _r.situacao, 'consultado_em', _r.consultado_em);
end $$;

-- =================================================================================================================
-- 6. Privilégios: telas para authenticated; conector só service_role; internas para ninguém (só o dono, postgres)
-- =================================================================================================================
do $grants$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where (p.pronamespace = 'receita'::regnamespace and p.proname in (
              'fat_hoje', 'fat_dias_uteis', 'fat_status_rotulo', 'fat_documento_valido', 'fat_email_valido',
              'fat_parcelas_calcular', 'fat_recusar', 'fat_erro', 'fat_pessoa', 'fat_diff', 'fat_escopo',
              'fat_exigir_porta', 'fat_ve', 'fat_e_substituto', 'fat_pend_ok', 'fat_pend_devolvido', 'fat_pend_erro',
              'fat_acoes', 'fat_exigir', 'fat_contratos_vigentes', 'fat_contratos_outra_emissora', 'fat_bloqueio',
              'fat_pedido_validar', 'fat_snapshot', 'fat_transicao_permitida', 'fat_transicao', 'fat_evento_pedido',
              'fat_entrar_na_fila', 'fat_proximo_passo', 'fat_pedidos_status_guarda'))
        or (p.pronamespace = 'integracoes'::regnamespace and p.proname in (
              'fat_exigir_conector', 'fat_envio_proximos', 'fat_envio_resultado', 'fat_status_aplicar',
              'fat_status_enfileirar', 'fat_servicos_aplicar', 'pipefy_envio_proximos', 'pipefy_envio_resultado',
              'receita_cnpj_gravar'))
        or (p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%' loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'integracoes'::regnamespace and p.proname in (
              'fat_envio_proximos', 'fat_envio_resultado', 'fat_status_aplicar', 'fat_status_enfileirar',
              'fat_servicos_aplicar', 'pipefy_envio_proximos', 'pipefy_envio_resultado', 'receita_cnpj_gravar') loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

-- =================================================================================================================
-- 7. Conferência antes do commit
-- =================================================================================================================
do $conferencia$
declare
  n int;
begin
  select count(*) into n from receita.fat_departamentos;
  if n <> 19 then raise exception 'T1b: % departamentos (esperava 19)', n; end if;
  select count(*) into n from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%';
  if n <> 25 then raise exception 'T1b: % RPCs ops.fat_* (esperava 25)', n; end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%'
     and (not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'));
  if n <> 0 then raise exception 'T1b: % RPCs ops.fat_* sem security definer ou search_path fixo', n; end if;
  select count(*) into n from receita.fat_pedidos;
  if n <> 0 then raise exception 'T1b: a tabela de pedidos devia estar vazia (% linhas)', n; end if;
end $conferencia$;

commit;
