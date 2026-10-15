-- Portal de Faturamento · F1, fundação de dados (15/10/2026).
--
-- Spec: PM Work/execution/portal-faturamento-prd-20261013/spec-portal-faturamento.md (§3, §4, §7, §10, §11 F1).
-- Decisões do Daniel Faria e da Ana Carvalhais em 15/10/2026: 1A 2A 3A 4A 5A.
-- Ensaio (begin … rollback, RLS testada como authenticated): supabase/gates/20261015_portal_faturamento_f1.sql
-- Rollback: supabase/rollback/20261015150000_portal_faturamento_f1_rollback.sql
--
-- O que cria:
--   1. Os schemas de domínio `organizacao` (Rede e Organização) e `receita` (Receita e Repasses). As tabelas
--      nascem no domínio de destino (princípio 5 do mapa de 09/10). Os dois schemas NÃO estão no db_schema do
--      PostgREST: a API REST não os enxerga até alguém expor (é configuração do projeto, não migration). F1 não
--      precisa disso; F2 decide entre expor o schema ou ler por RPC/servidor.
--   2. organizacao.empresas_grupo, semeada com as 18 empresas de public.empresas do Financial Brain
--      (itpddzjfrgrbathcqbpo), lidas em 15/10/2026. O id é o MESMO uuid de lá, que é o que
--      ops.usuario_empresas.empresa_id já guarda: o recorte por empresa do Brain Financeiro vale aqui sem tradução.
--   3. receita.fat_donos, receita.fat_servicos (cache do Omie, nasce vazio: a carga vem do E0) e
--      receita.fat_eventos (append-only), de que F2 em diante dependem.
--   4. Os tipos receita.dinheiro (numeric(14,2)) e receita.competencia (date sempre no dia 1), para F2 em diante.
--   5. O acesso (RF-A04): áreas, as quatro chaves, os papéis fat_tesouraria e fat_controladoria, e as funções de
--      permissão do portal.
--
-- Por que TRÊS áreas e não uma: a RF-A04 pede a área `faturamento` com as quatro chaves, mas no modelo do Ops a área
-- libera TODAS as chaves dela (decisão de 15/09). Com uma área só, a tesouraria teria admin.faturamento e poderia se
-- cadastrar como dona de qualquer empresa. Mesmo precedente de broker_matriz e minha_unidade_financeiro (16/09):
-- fronteira de confiança diferente, área própria. As chaves e os papéis são os da spec.
--
-- Quem vê o quê (RF-A02), conferido no banco (RF-A05):
--   * Porta: ops.can('view.faturamento'). Ela traz junto o que o Ops já confere (pessoa ativa, porta do Ops,
--     negação por pessoa, "Ver como"). Desativar a pessoa fecha o portal na hora, mesmo com linha em fat_donos.
--   * Tesouraria e controladoria: a chave da área delas E a empresa no recorte da pessoa
--     (ops.usuario_escopo.todas_empresas ou ops.usuario_empresas), a mesma régua do Brain Financeiro. Hoje todo
--     mundo do papel financeiro tem todas_empresas, então "veem todas" vale; quem tem recorte (o super admin
--     victor.eliezek só tem a PARTNERS) vê só o recorte. Ausência de linha fecha.
--   * Dono, gestor e solicitante: a porta E uma linha ativa em receita.fat_donos naquela empresa. fat_donos já é
--     por empresa, então não se exige também ops.usuario_empresas (seriam duas listas para o mesmo fato).
--
-- As funções de permissão são SECURITY DEFINER porque leem fat_donos de dentro da policy de fat_donos (sem isso, a
-- RLS recursaria) e leem o recorte em ops. Todas começam pela checagem de quem chama (auth.uid() nulo devolve false)
-- e só respondem sobre quem chama: nenhuma recebe outro usuário. search_path vazio, nomes qualificados.
-- Nas policies, chamadas soltas, sem embrulhar em (select …) (DECISIONS: has_role e o wrap na RLS).

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Schemas
-- ---------------------------------------------------------------------------------------------------------------
create schema if not exists organizacao;
create schema if not exists receita;

comment on schema organizacao is
  'Domínio Rede e Organização: empresas do grupo, unidades e estrutura. Criado em 15/10/2026 pelo Portal de '
  'Faturamento (F1) com organizacao.empresas_grupo.';
comment on schema receita is
  'Domínio Receita e Repasses: todo faturamento que as empresas do grupo emitem. As tabelas do Portal de '
  'Faturamento levam o prefixo fat_. Criado em 15/10/2026 (F1).';

revoke all on schema organizacao, receita from public;
grant usage on schema organizacao, receita to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Tipos para F2 em diante (§7 e RNF-03/RNF-04)
-- ---------------------------------------------------------------------------------------------------------------
create domain receita.dinheiro as numeric(14, 2);
comment on domain receita.dinheiro is 'Dinheiro do portal: numeric(14,2), em reais (RNF-04).';

create domain receita.competencia as date
  constraint competencia_no_dia_1 check (extract(day from value) = 1);
comment on domain receita.competencia is
  'Mês de referência do serviço: sempre o dia 1 do mês (RNF-03). Calcule no fuso America/Sao_Paulo.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. updated_at (uma função por schema, para cada domínio não depender do outro)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function organizacao.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function receita.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. organizacao.empresas_grupo
-- ---------------------------------------------------------------------------------------------------------------
create table organizacao.empresas_grupo (
  id uuid primary key default gen_random_uuid(),
  apelido text not null unique check (apelido <> '' and apelido = upper(btrim(apelido))),
  razao_social text not null,
  nome_fantasia text,
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  grupo_apuracao text,
  -- Nome do segredo no Vault. O formato recusa qualquer coisa que pareça chave (app_key do Omie é número,
  -- app_secret é hexadecimal): só aceita omie_<sigla>.
  omie_credencial_ref text unique check (omie_credencial_ref ~ '^omie_[a-z0-9_]+$'),
  ativa boolean not null default true,
  fatura_por text check (fatura_por in ('os', 'contrato', 'ambos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table organizacao.empresas_grupo is
  'Domínio Rede e Organização. Empresas do Grupo Planning que emitem nota, cada uma com o seu Omie. '
  'Dono provisório: Controladoria (Ana Carvalhais), pelo Portal de Faturamento, até o domínio Rede e Organização '
  'assumir. Semeada em 15/10/2026 com as 18 empresas de public.empresas do Financial Brain (itpddzjfrgrbathcqbpo). '
  'O id é o mesmo uuid de lá e de ops.usuario_empresas.empresa_id. ATENÇÃO: o apelido segue as siglas do Pipefy '
  'de Contas a Receber, não o do Financial Brain. MAROX aqui é a Marox Serviços (55.950.467); a Planning Marox '
  'Consultoria (apelido MAROX no Financial Brain) é PMC. O elo entre os sistemas é o id ou o CNPJ, nunca o apelido. '
  'Escrita: service role; a controladoria só altera fatura_por.';
comment on column organizacao.empresas_grupo.apelido is
  'Sigla usada pelo time no faturamento (PAC, PRJ, PMC, DOC, PIS, NEO, PCC, PGE, MAROX, BPO, PAT…), conforme o '
  'campo "Empresa de faturamento" do Pipefy de Contas a Receber em 09/10/2026, casada pelo CNPJ.';
comment on column organizacao.empresas_grupo.cnpj is 'CNPJ só com dígitos.';
comment on column organizacao.empresas_grupo.grupo_apuracao is 'Grupo de apuração do Brain Financeiro (copiado de lá).';
comment on column organizacao.empresas_grupo.omie_credencial_ref is
  'Nome do segredo no Vault do banco único (vault.secrets.name) com a credencial do Omie desta empresa. Nunca a '
  'chave. Nulo = empresa sem Omie (PAI e PMN em 15/10/2026). O segredo ainda não existe: as chaves estão no '
  'BRAIN_OPS_ENV do Financeiro (nome em public.empresas.omie_env_ref de lá) e vêm para o Vault no E0.';
comment on column organizacao.empresas_grupo.fatura_por is
  'os, contrato ou ambos: vem do mapeamento da Ana. Nulo até ela responder.';

create trigger empresas_grupo_updated_at before update on organizacao.empresas_grupo
  for each row execute function organizacao.tocar_updated_at();

insert into organizacao.empresas_grupo
  (id, apelido, razao_social, nome_fantasia, cnpj, grupo_apuracao, omie_credencial_ref, ativa)
values
  ('59028b02-f52f-4a64-a933-ad4b5028c985', 'AGRO', 'PLANNING AGRO CONSULTORIA LTDA', 'PLANNING AGRO', '59073211000105', 'AGRO', 'omie_agro', true),  -- Financeiro: AGRO
  ('acf8fb38-16b6-4c38-b862-5359edafdd48', 'BPO', 'PLANNING BPO CONTABIL LTDA', 'PLANNING BPO CONTABIL', '44275738000137', 'BPO', 'omie_bpo', true),  -- Financeiro: BPO Contábil
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', 'DOC', 'PLANNING DOC ASSESSORIA PARALEGAL LTDA', 'PLANNING', '49726267000150', 'DOC', 'omie_doc', true),  -- Financeiro: DOC
  ('727ee9ea-e786-4d81-bb51-69198a7b507d', 'MAROX', 'MAROX SERVICOS LTDA', 'MAROX SERVICOS', '55950467000194', 'MAROX', 'omie_marox', true),  -- Financeiro: MAROX SERVIÇOS
  ('505278f4-b1be-4cef-b56d-2f03273988f9', 'NEO', 'PLANNING NEO SERVICES LTDA', null, '66532907000100', 'NEO', 'omie_neo', true),  -- Financeiro: NEO
  ('8cdf5de7-683f-4d8e-a194-f303677ac6ea', 'PAC', 'PLANNING AUDITORES E CONTADORES LTDA', 'PLANNING AUDITORES E CONTADORES LTDA', '24296850000147', 'BPO', 'omie_pac', true),  -- Financeiro: PAC
  ('111069ce-695a-499f-a7b0-57611debac15', 'PAC SP', 'PLANNING AUDITORES E CONTADORES SP S/S LTDA', 'PLANNING SAO PAULO', '59639455000102', 'SP', 'omie_pac_sp', true),  -- Financeiro: PLNG SP
  ('edb1ab3c-0f41-4191-b86f-04c01ebd53db', 'PAI', 'PLANNING AUDITORES INDEPENDENTES S/S LTDA', 'PLANNING AUDITORES INDEPENDENTES', '22929096000100', 'PAI', null, false),  -- Financeiro: PAI (sem Omie)
  ('769854a7-0b0b-48e2-ace8-9b0636e19a56', 'PARTNERS', 'PLANNING PARTNERS BRASIL LTDA', 'PLANNING PARTNERS BRASIL LTDA', '58565726000151', 'EXPANSÃO', 'omie_partners', true),  -- Financeiro: PARTNERS
  ('052aecd6-e33a-411a-9664-7a4a9571342a', 'PAT', 'PLANNING ASSESSORIA DE TRIBUTOS LTDA', 'PLANNING ASSESSORIA DE TRIBUTOS', '40949469000196', 'PAT', 'omie_pat', true),  -- Financeiro: PAT
  ('70b317a6-4779-4634-a6b9-fe2daa6e5e57', 'PCC', 'PLANNING CONSULTORIA CONTABIL LTDA', 'PLANNING CONSULTORIA CONTABIL LTDA', '23527887000176', 'BPO', 'omie_pcc', true),  -- Financeiro: PCC
  ('bcfbb86c-a941-4e79-bf87-1d35824a3098', 'PGE', 'PLANNING GESTAO EMPRESARIAL LTDA', 'PLANNING GESTAO EMPRESARIAL', '23632609000189', 'BPO', 'omie_pge', true),  -- Financeiro: GESTÃO
  ('92eabf46-07a2-44c6-8f23-b7588e89314e', 'PIS', 'PLANNING INTELIGENCIA SOCIETARIA', 'PLANNING INTELIGENCIA SOCIETARIA', '40417435000150', 'PIS', 'omie_pis', true),  -- Financeiro: PIS
  ('2f7050d9-50b7-43df-aeae-bc64dbd061aa', 'PMC', 'PLANNING MAROX CONSULTORIA LTDA', 'PLANNING MAROX CONSULTORIA', '30459798000103', 'MAROX', 'omie_pmc', true),  -- Financeiro: MAROX
  ('b6a3d177-f015-4abb-86a0-1642daeeb85f', 'PMN', 'PLANNING MEU NEGOCIO LTDA', 'PLANNING MEU NEGOCIO', '35754187000101', 'PMN', null, false),  -- Financeiro: MEU NEGOCIO (sem Omie)
  ('4828f6a0-7f4e-42b6-8f3e-3fa45fe7d539', 'PNC', 'PLANNING NEGOCIOS CORPORATIVOS LTDA', 'PLANNING NEGOCIOS CORPORATIVOS', '24600951000160', 'PAT', 'omie_pnc', true),  -- Financeiro: PNC
  ('f85b9ff8-d04f-4cf3-b045-86c177c82237', 'PRJ', 'PLANNING AUDITORES E CONTADORES RJ S/S LTDA', 'PLANNING RIO DE JANEIRO', '55909495000168', 'EXPANSÃO', 'omie_prj', true),  -- Financeiro: PRJ
  ('45fcc16a-d2c1-44cc-9924-5c5f817c3f6b', 'ROIT', 'ROIT PLANNING CONTABILIDADE LTDA', 'ROIT PLANNING', '48790748000161', 'ROIT', 'omie_roit', true);  -- Financeiro: ROIT

-- ---------------------------------------------------------------------------------------------------------------
-- 5. receita.fat_donos
-- ---------------------------------------------------------------------------------------------------------------
create table receita.fat_donos (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  papel text not null check (papel in ('dono', 'gestor', 'solicitante')),
  substituto_id uuid references auth.users (id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emissora_id, user_id, papel),
  check (substituto_id is distinct from user_id),
  check (substituto_id is null or papel = 'dono')
);

comment on table receita.fat_donos is
  'Domínio Receita e Repasses. Dono: Controladoria (Ana Carvalhais). Quem pode ser dono da receita, gestor ou '
  'solicitante em cada empresa que fatura (RF-A03/RF-A04). É daqui, e não de chave, que vem o que cada pessoa faz '
  'em cada empresa; a chave view.faturamento é só a porta. Mudar quem é o quê = desativar a linha e criar outra '
  '(a controladoria só altera substituto_id e ativo). Toda criação e alteração vira evento em receita.fat_eventos.';
comment on column receita.fat_donos.substituto_id is
  'Quem responde pelo dono na ausência dele (só para papel dono). O gestor da empresa é o substituto padrão (F2).';

create trigger fat_donos_updated_at before update on receita.fat_donos
  for each row execute function receita.tocar_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. receita.fat_servicos (cache do cadastro de serviços do Omie de cada emissora)
-- ---------------------------------------------------------------------------------------------------------------
create table receita.fat_servicos (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  codigo_omie text not null check (btrim(codigo_omie) <> ''),
  descricao text not null,
  codigo_lc116 text,
  codigo_municipal text,
  tributacao jsonb not null default '{}'::jsonb check (jsonb_typeof(tributacao) = 'object'),
  categoria_padrao text,
  conta_corrente_padrao bigint,
  ativo boolean not null default true,
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emissora_id, codigo_omie)
);

comment on table receita.fat_servicos is
  'Domínio Receita e Repasses. Dono: Controladoria (Ana Carvalhais). Cache do cadastro de serviços do Omie de cada '
  'emissora (servicos/servico ListarCadastroServico), com sincronizado_em. Exceção declarada ao princípio 4. '
  'Quem grava é a carga (service role, E0/Integrações); a controladoria só altera ativo e os padrões de categoria e '
  'conta corrente. Ninguém digita imposto: tributacao vem do Omie como veio.';
comment on column receita.fat_servicos.codigo_omie is 'Código do serviço no Omie daquela emissora (nCodServ).';
comment on column receita.fat_servicos.tributacao is 'Bloco de impostos do serviço como o Omie devolveu.';
comment on column receita.fat_servicos.conta_corrente_padrao is 'nCodCC da conta corrente no Omie da emissora.';

create trigger fat_servicos_updated_at before update on receita.fat_servicos
  for each row execute function receita.tocar_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- 7. receita.fat_eventos (append-only, RNF-02)
-- ---------------------------------------------------------------------------------------------------------------
create table receita.fat_eventos (
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('pedido', 'contrato', 'item', 'competencia', 'dono')),
  entidade_id uuid not null,
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  evento text not null check (evento ~ '^[a-z][a-z_]*$'),
  de text,
  para text,
  diff jsonb not null default '{}'::jsonb check (jsonb_typeof(diff) = 'object'),
  autor_id uuid,
  em timestamptz not null default now()
);

comment on table receita.fat_eventos is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento (Controladoria). Histórico append-only de tudo que muda '
  'valor, dono, empresa ou status (RNF-02, RF-P10): sem UPDATE, DELETE nem TRUNCATE, por privilégio, por policy '
  'restritiva e por gatilho. Quem grava: service role e funções do portal; o navegador nunca grava direto. '
  'em é o momento da criação (não há updated_at porque linha nenhuma muda). entidade = dono registra o cadastro '
  'de receita.fat_donos; as outras quatro são de F2 em diante.';
comment on column receita.fat_eventos.entidade_id is 'id da linha da entidade (sem FK: a tabela é polimórfica).';
comment on column receita.fat_eventos.emissora_id is
  'Empresa que fatura da entidade. É o que recorta a leitura por escopo sem juntar com a entidade.';
comment on column receita.fat_eventos.de is 'Estado anterior (status do pedido ou da competência; ativo/inativo do dono).';
comment on column receita.fat_eventos.para is 'Estado novo.';
comment on column receita.fat_eventos.diff is 'Campos que mudaram: {"campo": {"de": valor, "para": valor}}.';
comment on column receita.fat_eventos.autor_id is
  'auth.users.id de quem fez; nulo = sistema. Sem FK de propósito: o histórico não pode impedir apagar uma conta, '
  'nem ser alterado quando ela some.';

create index fat_eventos_entidade_idx on receita.fat_eventos (entidade, entidade_id, em);
create index fat_eventos_emissora_idx on receita.fat_eventos (emissora_id, em);

create or replace function receita.fat_eventos_imutavel()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'receita.fat_eventos é append-only: % recusado. Registre um evento novo em vez de corrigir o antigo.', tg_op
    using errcode = '42501';
end $$;

create trigger fat_eventos_sem_alterar before update or delete on receita.fat_eventos
  for each row execute function receita.fat_eventos_imutavel();
create trigger fat_eventos_sem_truncar before truncate on receita.fat_eventos
  for each statement execute function receita.fat_eventos_imutavel();

-- Cadastro de donos vira evento. Função de gatilho: o Postgres só a executa disparada por escrita em
-- receita.fat_donos, e essa escrita já passou pela RLS de fat_donos (só a controladoria grava). É SECURITY DEFINER
-- porque o navegador não tem INSERT em fat_eventos.
create or replace function receita.fat_donos_registrar_evento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('dono', new.id, new.emissora_id, 'criado', null,
            case when new.ativo then 'ativo' else 'inativo' end,
            jsonb_build_object(
              'user_id', jsonb_build_object('de', null, 'para', new.user_id),
              'papel', jsonb_build_object('de', null, 'para', new.papel),
              'substituto_id', jsonb_build_object('de', null, 'para', new.substituto_id),
              'ativo', jsonb_build_object('de', null, 'para', new.ativo)),
            auth.uid());
    return new;
  end if;

  if new.emissora_id is distinct from old.emissora_id then
    _diff := _diff || jsonb_build_object('emissora_id', jsonb_build_object('de', old.emissora_id, 'para', new.emissora_id));
  end if;
  if new.user_id is distinct from old.user_id then
    _diff := _diff || jsonb_build_object('user_id', jsonb_build_object('de', old.user_id, 'para', new.user_id));
  end if;
  if new.papel is distinct from old.papel then
    _diff := _diff || jsonb_build_object('papel', jsonb_build_object('de', old.papel, 'para', new.papel));
  end if;
  if new.substituto_id is distinct from old.substituto_id then
    _diff := _diff || jsonb_build_object('substituto_id', jsonb_build_object('de', old.substituto_id, 'para', new.substituto_id));
  end if;
  if new.ativo is distinct from old.ativo then
    _diff := _diff || jsonb_build_object('ativo', jsonb_build_object('de', old.ativo, 'para', new.ativo));
  end if;
  if _diff = '{}'::jsonb then
    return new;
  end if;

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('dono', new.id, new.emissora_id,
          case when new.ativo is distinct from old.ativo
               then case when new.ativo then 'reativado' else 'desativado' end
               else 'alterado' end,
          case when old.ativo then 'ativo' else 'inativo' end,
          case when new.ativo then 'ativo' else 'inativo' end,
          _diff, auth.uid());
  return new;
end $$;

create trigger fat_donos_evento after insert or update on receita.fat_donos
  for each row execute function receita.fat_donos_registrar_evento();

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Acesso no modelo do Ops (RF-A04): áreas, chaves e papéis
-- ---------------------------------------------------------------------------------------------------------------
insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('faturamento', 'Faturamento',
   'Portal de Faturamento: pedidos pontuais e contratos recorrentes das empresas do grupo, do dono da receita ao '
   'Omie. É a porta; o que cada pessoa faz em cada empresa (dono, gestor, solicitante) vem do cadastro de donos.',
   'empresa', 35, true),
  ('faturamento_tesouraria', 'Faturamento · Tesouraria',
   'Conferir, faturar e devolver pedidos e a lista do corte, nas empresas do recorte da pessoa.',
   'empresa', 36, true),
  ('faturamento_controladoria', 'Faturamento · Controladoria',
   'Configurar empresas, serviços, donos e calendário do Portal de Faturamento, nas empresas do recorte da pessoa.',
   'empresa', 37, true)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem, ativa = excluded.ativa;

insert into ops.area_chaves (area, permission_key) values
  ('faturamento', 'view.faturamento'),
  ('faturamento', 'edit.faturamento_pedido'),
  ('faturamento_tesouraria', 'edit.faturamento_tesouraria'),
  ('faturamento_controladoria', 'admin.faturamento')
on conflict (area, permission_key) do nothing;

-- is_system = true de propósito: papel customizado (is_system = false) ganha leitura de nove tabelas do Ops pelas
-- policies "Custom roles can read" (empresas, contratos, NPS, auditorias…), e a tesouraria não precisa delas.
-- Na tela, a diferença é só não editar nome e descrição; as áreas do papel continuam editáveis.
insert into ops.roles (key, label, description, is_system) values
  ('fat_tesouraria', 'Faturamento · Tesouraria',
   'Equipe do financeiro que confere e fatura no Omie pelo Portal de Faturamento.', true),
  ('fat_controladoria', 'Faturamento · Controladoria',
   'Administra o Portal de Faturamento: empresas, serviços, donos, calendário e exceções.', true)
on conflict (key) do update set label = excluded.label, description = excluded.description;

-- Ninguém recebe papel aqui: a Ana e a tesouraria entram pela tela de acessos, depois do front.
insert into ops.role_areas (role, area, allowed) values
  ('admin', 'faturamento', true),
  ('admin', 'faturamento_tesouraria', true),
  ('admin', 'faturamento_controladoria', true),
  ('fat_tesouraria', 'faturamento', true),
  ('fat_tesouraria', 'faturamento_tesouraria', true),
  ('fat_controladoria', 'faturamento', true),
  ('fat_controladoria', 'faturamento_controladoria', true)
on conflict (role, area) do update set allowed = excluded.allowed, updated_at = now();

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Funções de permissão do portal (respondem só sobre quem chama)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function receita.fat_porta()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return ops.can('view.faturamento');
end $$;
comment on function receita.fat_porta() is
  'Quem chama abre o Portal de Faturamento (chave view.faturamento, com pessoa ativa e porta do Ops).';

create or replace function receita.fat_no_escopo(_emissora uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or _emissora is null then return false; end if;
  return coalesce((select e.todas_empresas from ops.usuario_escopo e where e.user_id = auth.uid()), false)
      or exists (select 1 from ops.usuario_empresas ue
                  where ue.user_id = auth.uid() and ue.empresa_id = _emissora);
end $$;
comment on function receita.fat_no_escopo(uuid) is
  'A empresa está no recorte de empresas de quem chama (ops.usuario_escopo.todas_empresas ou ops.usuario_empresas), '
  'a mesma régua do Brain Financeiro. Sem linha, fecha.';

create or replace function receita.fat_tesouraria(_emissora uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return ops.can('edit.faturamento_tesouraria') and receita.fat_no_escopo(_emissora);
end $$;
comment on function receita.fat_tesouraria(uuid) is
  'Quem chama é tesouraria do faturamento (área faturamento_tesouraria) e a empresa está no recorte dele.';

create or replace function receita.fat_controladoria(_emissora uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return ops.can('admin.faturamento') and receita.fat_no_escopo(_emissora);
end $$;
comment on function receita.fat_controladoria(uuid) is
  'Quem chama é controladoria do faturamento (área faturamento_controladoria) e a empresa está no recorte dele.';

create or replace function receita.fat_ve_tudo(_emissora uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return receita.fat_tesouraria(_emissora) or receita.fat_controladoria(_emissora);
end $$;
comment on function receita.fat_ve_tudo(uuid) is
  'Tesouraria ou controladoria naquela empresa: vê tudo dela (RF-A02).';

create or replace function receita.fat_tem_papel(_emissora uuid, _papeis text[] default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or _emissora is null then return false; end if;
  if not ops.can('view.faturamento') then return false; end if;
  return exists (
    select 1 from receita.fat_donos d
     where d.user_id = auth.uid() and d.emissora_id = _emissora and d.ativo
       and (_papeis is null or d.papel = any (_papeis)));
end $$;
comment on function receita.fat_tem_papel(uuid, text[]) is
  'Quem chama tem a porta do portal e uma linha ativa em receita.fat_donos naquela empresa, num dos papéis pedidos '
  '(nulo = qualquer um: dono, gestor ou solicitante).';

revoke all on function
  receita.fat_porta(), receita.fat_no_escopo(uuid), receita.fat_tesouraria(uuid),
  receita.fat_controladoria(uuid), receita.fat_ve_tudo(uuid), receita.fat_tem_papel(uuid, text[])
  from public, anon;
grant execute on function
  receita.fat_porta(), receita.fat_no_escopo(uuid), receita.fat_tesouraria(uuid),
  receita.fat_controladoria(uuid), receita.fat_ve_tudo(uuid), receita.fat_tem_papel(uuid, text[])
  to authenticated, service_role;

-- Funções de gatilho: o Postgres não confere EXECUTE quando o gatilho dispara, e ninguém precisa chamá-las.
revoke all on function
  organizacao.tocar_updated_at(), receita.tocar_updated_at(),
  receita.fat_eventos_imutavel(), receita.fat_donos_registrar_evento()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. RLS e privilégios
-- ---------------------------------------------------------------------------------------------------------------
alter table organizacao.empresas_grupo enable row level security;
alter table receita.fat_donos enable row level security;
alter table receita.fat_servicos enable row level security;
alter table receita.fat_eventos enable row level security;

-- empresas_grupo: cadastro mestre do grupo (nomes, CNPJs, nome do segredo; nenhum segredo). Lê quem está ativo.
create policy empresas_grupo_ler on organizacao.empresas_grupo
  for select to authenticated using (ops.pessoa_ativa(auth.uid()));
create policy empresas_grupo_alterar on organizacao.empresas_grupo
  for update to authenticated
  using (receita.fat_controladoria(id)) with check (receita.fat_controladoria(id));

-- fat_donos: a controladoria vê e grava; tesouraria vê; quem tem papel numa empresa vê o cadastro dela (o solicitante
-- precisa saber quem são os donos); o substituto vê a linha em que é substituto.
create policy fat_donos_ler on receita.fat_donos
  for select to authenticated
  using (receita.fat_ve_tudo(emissora_id)
         or receita.fat_tem_papel(emissora_id)
         or (substituto_id = auth.uid() and receita.fat_porta()));
create policy fat_donos_incluir on receita.fat_donos
  for insert to authenticated with check (receita.fat_controladoria(emissora_id));
create policy fat_donos_alterar on receita.fat_donos
  for update to authenticated
  using (receita.fat_controladoria(emissora_id)) with check (receita.fat_controladoria(emissora_id));

-- fat_servicos: quem opera a empresa vê os serviços dela; a carga grava; a controladoria ajusta.
create policy fat_servicos_ler on receita.fat_servicos
  for select to authenticated
  using (receita.fat_ve_tudo(emissora_id) or receita.fat_tem_papel(emissora_id));
create policy fat_servicos_alterar on receita.fat_servicos
  for update to authenticated
  using (receita.fat_controladoria(emissora_id)) with check (receita.fat_controladoria(emissora_id));

-- fat_eventos: tesouraria, controladoria e o gestor da empresa leem. A leitura do dono e do solicitante (eventos do
-- pedido ou do contrato deles) entra em F2, com a tabela da entidade. Nenhuma policy de escrita para o navegador;
-- e duas RESTRICTIVE que travam UPDATE e DELETE mesmo se alguém criar uma permissiva no futuro.
create policy fat_eventos_ler on receita.fat_eventos
  for select to authenticated
  using (receita.fat_ve_tudo(emissora_id) or receita.fat_tem_papel(emissora_id, array['gestor']));
create policy fat_eventos_sem_alterar on receita.fat_eventos
  as restrictive for update to public using (false) with check (false);
create policy fat_eventos_sem_apagar on receita.fat_eventos
  as restrictive for delete to public using (false);

revoke all on organizacao.empresas_grupo, receita.fat_donos, receita.fat_servicos, receita.fat_eventos
  from public, anon, authenticated, service_role;

grant select on organizacao.empresas_grupo to authenticated;
grant update (fatura_por) on organizacao.empresas_grupo to authenticated;
grant select, insert, update, delete on organizacao.empresas_grupo to service_role;

grant select, insert on receita.fat_donos to authenticated;
grant update (substituto_id, ativo) on receita.fat_donos to authenticated;
grant select, insert, update on receita.fat_donos to service_role;

grant select on receita.fat_servicos to authenticated;
grant update (ativo, categoria_padrao, conta_corrente_padrao) on receita.fat_servicos to authenticated;
grant select, insert, update, delete on receita.fat_servicos to service_role;

grant select on receita.fat_eventos to authenticated;
grant select, insert on receita.fat_eventos to service_role;
grant usage on sequence receita.fat_eventos_id_seq to service_role;

commit;
