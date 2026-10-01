-- Prova de cliente na Base e fornecedor só para admin (pedido do Pedro, 01/10/2026: "edite isso no planning brain e
-- garanta que quem não é admin não tenha acesso a fornecedor"). Estudo de 01/10: das 10.322 contas da Base, 2.546 têm
-- prova de que pagam a Planning; o filtro de 30/09 (só fornecedor sai das ofertas) deixava três buracos abertos:
--   1. Curitiba não usa tag: a regra de 18/09 carimbou "Base antiga" no cadastro inteiro do Omie de Curitiba e 580
--      contas sem prova nenhuma (cartórios, Juntas Comerciais, TIM) ficaram prontas para Consultoria;
--   2. a Matriz marca Cliente em quem ela paga (Facebook, Telefônica, TAM): o filtro de tag não pega;
--   3. empresas do próprio grupo contadas como clientes.
--
-- O que esta migration faz:
--   a. ops.base_omie_pagamentos: contas a pagar do Omie de cada unidade (Edge Function omie-pagamentos-sync). É a
--      prova de fornecedor pelo dinheiro: quem recebe pagamento da unidade ou da Matriz.
--   b. ops.base_grupo_cnpjs: raízes de CNPJ das empresas do grupo e das franquias.
--   c. ops.base_conta_prova(): o nível de prova de cada conta, gravado na ficha (`prova`):
--        grupo · comprovado (contrato de serviço, conta a receber, ECD ou ganho no Pipedrive) · fornecedor (recebe
--        pagamento no Omie, ou só tag de fornecedor/funcionário, sem prova de cliente) · cadastrado (card no Pipefy)
--        · so_tag (tag Cliente no Omie, sem outra prova) · sem_prova (só no cadastro do Omie).
--   d. Fornecedor e grupo só para admin: super admin ou admin (nível 3) da área Clientes ou Monetização. Vale nas
--      RPCs da Base e em RLS restritiva das tabelas que a pessoa lê direto (contas, detalhes, itens, envios e o
--      cadastro bruto do Omie). "Ver como" simula quem não é admin.
--   e. Ofertas: grupo, fornecedor e sem prova saem de todas (Consultoria, Finance, Cella, Recon), na mesma posição
--      de fornecedorForaDeOferta() no cliente (src/lib/monetizacao/model.ts).

-- a. Contas a pagar do Omie -------------------------------------------------------------------------------------------
create table if not exists ops.base_omie_pagamentos (
  unidade text not null,
  codigo_lancamento bigint not null,
  codigo_omie bigint not null,
  valor numeric,
  vencimento date,
  status text,
  sincronizado_em timestamptz not null default now(),
  primary key (unidade, codigo_lancamento)
);
comment on table ops.base_omie_pagamentos is
  'Contas a pagar do Omie por unidade (ListarContasPagar), gravadas por omie-pagamentos-sync. codigo_omie é o cadastro do fornecedor (liga em base_omie_tags).';
create index if not exists base_omie_pagamentos_cadastro on ops.base_omie_pagamentos (unidade, codigo_omie);
-- Busca pela raiz do CNPJ (filiais da mesma empresa) em ops.base_omie_tags.
create index if not exists base_omie_tags_raiz on ops.base_omie_tags (left(cnpj, 8));
alter table ops.base_omie_pagamentos enable row level security;
revoke all on ops.base_omie_pagamentos from public, anon, authenticated;
grant select, insert, update, delete on ops.base_omie_pagamentos to service_role;

-- Fila e retomada: a leitura de uma unidade pode passar de uma execução (limite de 150 s da Edge Function).
create table if not exists ops.base_omie_pagamentos_leituras (
  unidade text primary key,
  tentativa_em timestamptz,
  inicio_em timestamptz,
  proxima_pagina integer,
  concluida_em timestamptz,
  titulos integer,
  erro text
);
comment on table ops.base_omie_pagamentos_leituras is
  'Fila da omie-pagamentos-sync por unidade: tentativa, passada em curso (inicio_em, proxima_pagina), conclusão e erro.';
alter table ops.base_omie_pagamentos_leituras enable row level security;
revoke all on ops.base_omie_pagamentos_leituras from public, anon, authenticated;
grant select, insert, update, delete on ops.base_omie_pagamentos_leituras to service_role;

-- Contas a pagar das empresas do grupo no Financial Brain (titulos_pagar_live), acumuladas por CNPJ: o título pago sai
-- de lá, o CNPJ fica aqui com a última vez em que foi visto. Pega o que o Omie das unidades não mostra (equipe PJ,
-- Telefônica, ContaAzul pagos pela PAC ou pela PRJ).
create table if not exists ops.base_pagamentos_grupo (
  cnpj text primary key,
  nome text,
  empresas text[] not null default '{}',
  titulos_abertos integer,
  primeira_vez timestamptz not null default now(),
  visto_em timestamptz not null default now()
);
comment on table ops.base_pagamentos_grupo is
  'CNPJs com conta a pagar nas empresas do grupo (Financial Brain · titulos_pagar_live), acumulados por omie-pagamentos-sync. empresas = apelidos de quem paga.';
create index if not exists base_pagamentos_grupo_raiz on ops.base_pagamentos_grupo (left(cnpj, 8));
alter table ops.base_pagamentos_grupo enable row level security;
revoke all on ops.base_pagamentos_grupo from public, anon, authenticated;
grant select, insert, update, delete on ops.base_pagamentos_grupo to service_role;

-- b. Empresas do grupo ------------------------------------------------------------------------------------------------
-- Raiz do CNPJ (8 dígitos): pega matriz e filiais. As 18 empresas do Financial Brain e as franquias e veículos do grupo
-- que estavam na Base em 01/10. As ROIT sem "Planning" no nome ficam de fora: várias são clientes com prova.
create table if not exists ops.base_grupo_cnpjs (
  raiz text primary key check (raiz ~ '^\d{8}$'),
  cnpj text,
  nome text not null,
  fonte text not null
);
comment on table ops.base_grupo_cnpjs is
  'Raízes de CNPJ do grupo Planning (empresas do Financial Brain, franquias e veículos). Conta com essa raiz não é cliente da Base.';
alter table ops.base_grupo_cnpjs enable row level security;
revoke all on ops.base_grupo_cnpjs from public, anon, authenticated;
grant select, insert, update, delete on ops.base_grupo_cnpjs to service_role;
insert into ops.base_grupo_cnpjs (raiz, cnpj, nome, fonte) values
  ('59073211', '59073211000105', 'PLANNING AGRO CONSULTORIA LTDA', 'Financial Brain · empresas'),
  ('44275738', '44275738000137', 'PLANNING BPO CONTABIL LTDA', 'Financial Brain · empresas'),
  ('49726267', '49726267000150', 'PLANNING DOC ASSESSORIA PARALEGAL LTDA', 'Financial Brain · empresas'),
  ('23632609', '23632609000189', 'PLANNING GESTAO EMPRESARIAL LTDA', 'Financial Brain · empresas'),
  ('30459798', '30459798000103', 'PLANNING MAROX CONSULTORIA LTDA', 'Financial Brain · empresas'),
  ('55950467', '55950467000194', 'MAROX SERVICOS LTDA', 'Financial Brain · empresas'),
  ('35754187', '35754187000101', 'PLANNING MEU NEGOCIO LTDA', 'Financial Brain · empresas'),
  ('66532907', '66532907000100', 'PLANNING NEO SERVICES LTDA', 'Financial Brain · empresas'),
  ('24296850', '24296850000147', 'PLANNING AUDITORES E CONTADORES LTDA', 'Financial Brain · empresas'),
  ('22929096', '22929096000100', 'PLANNING AUDITORES INDEPENDENTES S/S LTDA', 'Financial Brain · empresas'),
  ('58565726', '58565726000151', 'PLANNING PARTNERS BRASIL LTDA', 'Financial Brain · empresas'),
  ('40949469', '40949469000196', 'PLANNING ASSESSORIA DE TRIBUTOS LTDA', 'Financial Brain · empresas'),
  ('23527887', '23527887000176', 'PLANNING CONSULTORIA CONTABIL LTDA', 'Financial Brain · empresas'),
  ('40417435', '40417435000150', 'PLANNING INTELIGENCIA SOCIETARIA', 'Financial Brain · empresas'),
  ('59639455', '59639455000102', 'PLANNING AUDITORES E CONTADORES SP S/S LTDA', 'Financial Brain · empresas'),
  ('24600951', '24600951000160', 'PLANNING NEGOCIOS CORPORATIVOS LTDA', 'Financial Brain · empresas'),
  ('55909495', '55909495000168', 'PLANNING AUDITORES E CONTADORES RJ S/S LTDA', 'Financial Brain · empresas'),
  ('48790748', '48790748000161', 'ROIT PLANNING CONTABILIDADE LTDA', 'Financial Brain · empresas'),
  ('66438610', '66438610000180', 'PLANNING ALAGOAS LTDA', 'Base de clientes · franquia'),
  ('62792675', '62792675000178', 'PLANNING CAMPO NOVO LTDA', 'Base de clientes · franquia'),
  ('45037508', '45037508000100', 'PLANNING CONTABILIDADE E PLANEJAMENTO LTDA', 'Base de clientes · franquia'),
  ('36729702', '36729702000158', 'PLANNING CWB 01 CONTABILIDADE SS', 'Base de clientes · franquia'),
  ('37382313', '37382313000161', 'PLANNING CWB 02 CONTABILIDADE SS', 'Base de clientes · franquia'),
  ('36878291', '36878291000162', 'PLANNING CWB 03 CONTABILIDADE SS', 'Base de clientes · franquia'),
  ('17721729', '17721729000230', 'PLANNING CWB APOIO EMPRESARIAL LTDA', 'Base de clientes · franquia'),
  ('39948902', '39948902000190', 'PLANNING CWB LEGALIZAÇÃO EMPRESARIAL LTDA', 'Base de clientes · franquia'),
  ('07694022', '07694022000148', 'PLANNING CWB PLANEJAMENTO TRIBUTARIO LTDA', 'Base de clientes · franquia'),
  ('13242415', '13242415000113', 'INNOVA PLANNING RJ SERVICOS CONTABEIS LTDA.', 'Base de clientes · franquia'),
  ('20548290', '20548290000110', 'INNOVA PLANNING SERVICOS CONTABEIS S/S', 'Base de clientes · franquia'),
  ('01672221', '01672221000179', 'PLANNING GESTORA DE INVESTIMENTOS LTDA', 'Base de clientes · veículo do grupo'),
  ('28741660', '28741660000142', 'PLANNING PARTICIPACOES E INVESTIMENTOS LTDA', 'Base de clientes · veículo do grupo'),
  ('48994415', '48994415000154', 'PLANNING TECH TECNOLOGIA LTDA', 'Base de clientes · veículo do grupo')
on conflict (raiz) do nothing;

-- c. Prova de cliente da conta ----------------------------------------------------------------------------------------
-- Ordem: grupo > comprovado > fornecedor > cadastrado > so_tag > sem_prova. Prova de cliente vence a tag e o pagamento
-- (cliente que também vende à Planning continua cliente); sem prova, quem recebe pagamento é fornecedor, com qualquer tag.
-- Sem prova e sem card no Pipefy, a filial cuja empresa (raiz do CNPJ) é fornecedora em outra filial também é fornecedor:
-- TIM, Claro e Google têm uma filial marcada Fornecedor na Matriz e outra sem tag em Curitiba.
-- `_omie` é o sinal de ops.base_conta_omie_tags (classe, cliente_em, fornecedor_em).
create or replace function ops.base_conta_prova(_cnpjs text[], _empresa_ids integer[], _ecd jsonb, _perfil jsonb, _omie jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ops, public, extensions as $$
declare
  cs text[] := coalesce(_cnpjs, '{}'::text[]);
  grupo text;
  provas text[] := '{}';
  rotulos text[] := '{}';
  pago text[];
  pago_grupo text[];
  irmas text[];
  raizes text[] := array(select distinct left(x, 8) from unnest(coalesce(_cnpjs, '{}'::text[])) x);
  classe text := _omie->>'classe';
  onde text;
  saida jsonb;
begin
  select g.nome into grupo from ops.base_grupo_cnpjs g
   where g.raiz = any(array(select left(x, 8) from unnest(cs) x)) order by g.raiz limit 1;
  if grupo is not null then
    return jsonb_build_object('nivel', 'grupo', 'provas', '[]'::jsonb, 'pago_em', '[]'::jsonb,
      'motivo', 'Empresa do grupo Planning (' || grupo || '). Fora das ofertas.');
  end if;
  if cardinality(cs) > 0 and (exists (select 1 from ops.omie_contratos_servico s where s.cnpj_digitos = any(cs))
      or exists (select 1 from ops.base_omie_contratos s where s.cnpj = any(cs))) then
    provas := array_append(provas, 'contrato'); rotulos := array_append(rotulos, 'contrato de serviço no Omie');
  end if;
  if cardinality(cs) > 0 and exists (select 1 from ops.contas_receber r where ops.qb_so_digitos(r.cpf_cnpj) = any(cs)) then
    provas := array_append(provas, 'receber'); rotulos := array_append(rotulos, 'conta a receber');
  end if;
  if jsonb_typeof(_ecd) = 'array' and jsonb_array_length(_ecd) > 0 then
    provas := array_append(provas, 'ecd'); rotulos := array_append(rotulos, 'ECD na Planning');
  end if;
  if coalesce((_perfil->>'pipedrive_contract')::boolean, false) then
    provas := array_append(provas, 'ganho_pipedrive'); rotulos := array_append(rotulos, 'negócio ganho no Pipedrive');
  end if;
  select coalesce(array_agg(distinct p.unidade order by p.unidade), '{}') into pago
    from ops.base_omie_tags t join ops.base_omie_pagamentos p on p.unidade = t.unidade and p.codigo_omie = t.codigo_omie
   where t.cnpj = any(cs);
  select coalesce(array_agg(distinct e order by e), '{}') into pago_grupo
    from ops.base_pagamentos_grupo g cross join lateral unnest(g.empresas) e where g.cnpj = any(cs);
  saida := jsonb_build_object('provas', to_jsonb(provas), 'pago_em', to_jsonb(pago), 'pago_pelo_grupo', to_jsonb(pago_grupo));
  if cardinality(provas) > 0 then
    return saida || jsonb_build_object('nivel', 'comprovado',
      'motivo', 'Prova de cliente: ' || array_to_string(rotulos, ', ') || '.');
  end if;
  if cardinality(pago) > 0 or cardinality(pago_grupo) > 0 then
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Fornecedor: recebe pagamento ' ||
        array_to_string(array_remove(array[
          case when cardinality(pago) > 0 then 'no Omie (' || array_to_string(pago, ', ') || ')' end,
          case when cardinality(pago_grupo) > 0 then 'das empresas do grupo (' || array_to_string(pago_grupo, ', ') || ')' end
        ], null), ' e ') || ' e não tem prova de cliente. Fora das ofertas.');
  end if;
  if classe = 'fornecedor' then
    select string_agg(x, ', ') into onde from jsonb_array_elements_text(coalesce(_omie->'fornecedor_em', '[]')) x;
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Só fornecedor no Omie' || coalesce(' (' || onde || ')', '') || ', sem tag de cliente. Fora das ofertas.');
  end if;
  if classe = 'pessoa_interna' then
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Funcionário, sócio ou prestador no Omie, sem tag de cliente. Fora das ofertas.');
  end if;
  if cardinality(coalesce(_empresa_ids, '{}'::integer[])) = 0 and cardinality(raizes) > 0 then
    select coalesce(array_agg(distinct t.unidade order by t.unidade), '{}') into irmas
      from ops.base_omie_tags t
     where left(t.cnpj, 8) = any(raizes) and length(t.cnpj) = 14 and not (t.cnpj = any(cs))
       and ((t.fornecedor and not t.cliente)
            or exists (select 1 from ops.base_omie_pagamentos p where p.unidade = t.unidade and p.codigo_omie = t.codigo_omie));
    if exists (select 1 from ops.base_pagamentos_grupo g where left(g.cnpj, 8) = any(raizes) and not (g.cnpj = any(cs))) then
      irmas := array_append(irmas, 'empresas do grupo');
    end if;
    if cardinality(irmas) > 0 then
      return saida || jsonb_build_object('nivel', 'fornecedor', 'filial_fornecedora_em', to_jsonb(irmas),
        'motivo', 'Fornecedor: outra filial da mesma empresa (raiz do CNPJ) é fornecedora no Omie (' ||
          array_to_string(irmas, ', ') || ') e esta não tem prova de cliente. Fora das ofertas.');
    end if;
  end if;
  if cardinality(coalesce(_empresa_ids, '{}'::integer[])) > 0 then
    return saida || jsonb_build_object('nivel', 'cadastrado',
      'motivo', 'Cadastrada pela unidade no Pipefy; sem contrato, recebimento, ECD ou negócio ganho no Brain.');
  end if;
  if classe in ('cliente', 'cliente_e_fornecedor') then
    select string_agg(x, ', ') into onde from jsonb_array_elements_text(coalesce(_omie->'cliente_em', '[]')) x;
    return saida || jsonb_build_object('nivel', 'so_tag',
      'motivo', 'Marcada Cliente no Omie' || coalesce(' (' || onde || ')', '') || ', sem outra prova de cliente.');
  end if;
  return saida || jsonb_build_object('nivel', 'sem_prova',
    'motivo', 'Sem prova de cliente: ' || case when _omie is not null then 'só no cadastro do Omie, ' else '' end ||
      'sem contrato, recebimento, ECD, negócio ganho nem card no Pipefy. Fora das ofertas.');
end $$;
revoke all on function ops.base_conta_prova(text[], integer[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function ops.base_conta_prova(text[], integer[], jsonb, jsonb, jsonb) to service_role;

-- d. Quem vê fornecedor -----------------------------------------------------------------------------------------------
-- Admin = super admin, ou admin (nível 3) da área Clientes ou Monetização. "Ver como" (super admin simulando uma
-- unidade) responde como quem não é admin, para a simulação mostrar o que a unidade vê.
create or replace function ops.base_ve_fornecedor()
returns boolean
language sql stable security definer set search_path = ops, public, extensions as $$
  select case
    when auth.uid() is null then false
    when ops.ver_como_ativa() then false
    else ops.eh_super_admin(auth.uid())
      or ops.nivel_na_area(auth.uid(), 'clientes') >= 3
      or ops.nivel_na_area(auth.uid(), 'monetizacao') >= 3
  end
$$;
revoke all on function ops.base_ve_fornecedor() from public, anon;
grant execute on function ops.base_ve_fornecedor() to authenticated, service_role;

-- Conta restrita = nível fornecedor ou grupo. Antes de a ficha ganhar `prova` (até a carteira se atualizar), a tag
-- de fornecedor/funcionário já basta para esconder.
create or replace function ops.base_prova_restrita(_base jsonb)
returns boolean
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select coalesce(_base->'prova'->>'nivel',
                  case when _base->'omie'->>'classe' in ('fornecedor', 'pessoa_interna') then 'fornecedor' end,
                  '') in ('fornecedor', 'grupo')
$$;
grant execute on function ops.base_prova_restrita(jsonb) to authenticated, service_role;

-- Liberada para quem não é admin: a conta já está na carteira e não é restrita. Conta nova, antes da primeira
-- atualização da carteira (até ~6 min), fica oculta: na dúvida, não mostra.
create or replace function ops.base_conta_liberada(_key text)
returns boolean
language sql stable security definer set search_path = ops, public, extensions as $$
  select exists (select 1 from ops.base_carteira c where c.key = _key and not ops.base_prova_restrita(c.base))
$$;
revoke all on function ops.base_conta_liberada(text) from public, anon;
grant execute on function ops.base_conta_liberada(text) to authenticated, service_role;

-- CNPJs das contas restritas, mantidos pela carteira (gatilho abaixo): o cadastro bruto do Omie é por CNPJ.
create table if not exists ops.base_cnpj_restrito (
  cnpj text not null,
  account_key text not null,
  nivel text not null,
  primary key (cnpj, account_key)
);
comment on table ops.base_cnpj_restrito is
  'CNPJs de contas da Base com nível fornecedor ou grupo, mantidos pelo gatilho de ops.base_carteira. Lido pela RLS do cadastro bruto do Omie.';
create index if not exists base_cnpj_restrito_conta on ops.base_cnpj_restrito (account_key);
alter table ops.base_cnpj_restrito enable row level security;
revoke all on ops.base_cnpj_restrito from public, anon, authenticated;
grant select, insert, update, delete on ops.base_cnpj_restrito to service_role;

create or replace function ops.base_carteira_restritos()
returns trigger
language plpgsql security definer set search_path = ops, public, extensions as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from ops.base_cnpj_restrito where account_key = old.key;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and ops.base_prova_restrita(new.base) then
    insert into ops.base_cnpj_restrito (cnpj, account_key, nivel)
    select distinct x, new.key, coalesce(new.base->'prova'->>'nivel', 'fornecedor')
      from jsonb_array_elements_text(coalesce(new.base->'cnpjs', '[]')) x
    on conflict (cnpj, account_key) do update set nivel = excluded.nivel;
  end if;
  return null;
end $$;
revoke all on function ops.base_carteira_restritos() from public, anon, authenticated;
drop trigger if exists base_carteira_restritos on ops.base_carteira;
create trigger base_carteira_restritos after insert or update of base or delete on ops.base_carteira
  for each row execute function ops.base_carteira_restritos();
-- Semente com o que a carteira já sabe (tag de fornecedor); a atualização da carteira completa com `prova`.
insert into ops.base_cnpj_restrito (cnpj, account_key, nivel)
select distinct x, c.key, coalesce(c.base->'prova'->>'nivel', 'fornecedor')
  from ops.base_carteira c cross join lateral jsonb_array_elements_text(coalesce(c.base->'cnpjs', '[]')) x
 where ops.base_prova_restrita(c.base)
on conflict (cnpj, account_key) do nothing;

-- Só fornecedor aqui: empresa do grupo continua no cadastro bruto (royalties e contas a receber das franquias).
create or replace function ops.base_cnpj_fornecedor(_doc text)
returns boolean
language sql stable security definer set search_path = ops, public, extensions as $$
  select exists (select 1 from ops.base_cnpj_restrito r where r.cnpj = ops.base_cnpj(_doc) and r.nivel = 'fornecedor')
$$;
revoke all on function ops.base_cnpj_fornecedor(text) from public, anon;
grant execute on function ops.base_cnpj_fornecedor(text) to authenticated, service_role;

-- RLS restritiva: soma (AND) às policies que já existem. `(select ...)` avalia quem é admin uma vez por consulta;
-- base_ve_fornecedor é SECURITY DEFINER, então não reentra na RLS de user_roles.
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_contas;
create policy base_fornecedor_so_admin on ops.monetizacao_contas as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(key));
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_detalhes;
create policy base_fornecedor_so_admin on ops.monetizacao_detalhes as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(account_key));
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_itens;
create policy base_fornecedor_so_admin on ops.monetizacao_itens as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(account_key));
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_envios;
create policy base_fornecedor_so_admin on ops.monetizacao_envios as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(account_key));
drop policy if exists base_fornecedor_so_admin on ops.omie_clientes;
create policy base_fornecedor_so_admin on ops.omie_clientes as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or not ops.base_cnpj_fornecedor(cnpj_cpf));
drop policy if exists base_fornecedor_so_admin on ops.omie_clientes_cadastro;
create policy base_fornecedor_so_admin on ops.omie_clientes_cadastro as restrictive for select to authenticated
  using ((select ops.base_ve_fornecedor()) or not ops.base_cnpj_fornecedor(cnpj));

-- Contas a pagar a cada 10 minutos, defasado das tags (3-59/10): uma unidade por execução, com retomada.
select cron.unschedule('omie-pagamentos-sync-10min') where exists (select 1 from cron.job where jobname = 'omie-pagamentos-sync-10min');
select cron.schedule('omie-pagamentos-sync-10min', '7-59/10 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/omie-pagamentos-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-planning-sinais-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'base_sinais_cron_secret')),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);

-- e. Funções existentes (definições de produção de 01/10, com a regra acrescentada) -------------------------------------
-- A ficha ganha `prova` (nível de prova de cliente). Definição de produção em 01/10 com a coluna e o join acrescentados.
CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select a.key, a.unidade_ids, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
   'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie,'prova',pv.prova)
 from ops.base_conta_estado a
 left join ops.base_conta_sinais(_keys) s on s.key = a.key
 left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
 left join lateral (select ops.base_conta_prova(a.cnpjs, a.empresa_ids, a.ecd_registros, a.perfil, om.omie) prova) pv on true  -- prova de cliente (01/10)
 where _keys is null or a.key=any(_keys)
$function$;

-- Manifesto e página da carteira: fornecedor e grupo só para admin.
CREATE OR REPLACE FUNCTION ops.base_carteira_manifesto()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare pages jsonb; total integer; all_units boolean; units integer[]; ve boolean:=ops.base_ve_fornecedor();
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 with ordered as (
  select key,row_number() over(order by key) rn from ops.base_carteira
  where (all_units or unidade_ids && units) and (ve or not ops.base_prova_restrita(base))  -- fornecedor e grupo só para admin (01/10)
 ), chunks as (
  select (rn-1)/1000 page,max(key) through,count(*) count from ordered group by 1
 ), boundaries as (
  select lag(through) over(order by page) after,through,count,page from chunks
 ) select coalesce(jsonb_agg(jsonb_build_object('after',after,'through',through,'count',count) order by page),'[]'),coalesce(sum(count),0) into pages,total from boundaries;
 return jsonb_build_object('pages',pages,'count',total,'catalog_at',(select catalog_at from ops.monetizacao_sync where id),
  'carteira_at',(select carteira_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature(),
  -- sinais: última carga concluída de cada fonte, para a procedência da tela (N3)
  'sinais',jsonb_build_object(
   'tratativas',(select max(executado_em) from ops.sync_log where fonte='pipefy_tratativas' and status='sucesso'),
   'consultoria',(select max(executado_em) from ops.sync_log where fonte='consultoria' and status='sucesso')));
end $function$;

CREATE OR REPLACE FUNCTION ops.base_carteira_pagina(_after text DEFAULT NULL::text, _through text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare rows jsonb; fichas jsonb; n integer; last_key text; all_units boolean; units integer[]; ve boolean:=ops.base_ve_fornecedor();
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 if length(_after)>80 or length(_through)>80 then raise exception 'Limite de página inválido';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'perfil',a.perfil,'unidade_ids',a.unidade_ids) order by a.key),'[]'),
        coalesce(jsonb_agg(a.base) filter (where a.base is not null),'[]'), count(*), max(a.key)
   into rows, fichas, n, last_key from (
  select c.key,c.perfil,c.unidade_ids,c.base from ops.base_carteira c
  where (all_units or c.unidade_ids && units) and (ve or not ops.base_prova_restrita(c.base)) and (_after is null or c.key>_after) and (_through is null or c.key<=_through)
  order by c.key limit 1000
 ) a;
 return jsonb_build_object('rows',rows,'base',fichas,'next',case when n=1000 then last_key end,
  'catalog_at',(select catalog_at from ops.monetizacao_sync where id),
  'carteira_at',(select carteira_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature());
end $function$;

-- Catálogo por chave (listas e apresentação): mesma regra.
CREATE OR REPLACE FUNCTION ops.base_unica_catalogo(_keys text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(f.ficha),'[]')
 from ops.base_unica_ficha(_keys) f
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(f.unidade_ids)
   and ((select ops.base_ve_fornecedor()) or not ops.base_prova_restrita(f.ficha))  -- fornecedor e grupo só para admin (01/10)
$function$;

-- Detalhe da conta: quem não é admin não abre fornecedor nem empresa do grupo.
CREATE OR REPLACE FUNCTION ops.monetizacao_detail(_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare detail jsonb; a ops.monetizacao_contas; channels jsonb:='[]'; documents jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 select * into a from ops.monetizacao_contas where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do seu escopo';end if;
 if not ops.base_ve_fornecedor() and not ops.base_conta_liberada(_key) then raise exception 'Conta fora do seu escopo';end if;  -- fornecedor e grupo só para admin (01/10)
 select detalhe into detail from ops.monetizacao_detalhes where account_key=_key;
 select coalesce(jsonb_agg(cnpj),'[]') into documents from ops.base_conta_cnpjs where account_key=_key;
 if ops.monetizacao_can('view.contatos') then
  select coalesce(jsonb_agg(distinct x),'[]') into channels from (
   select x from jsonb_array_elements(coalesce(detail->'contacts','[]')) x
    where cardinality(a.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Pipefy · contato vinculado','at',c.updated_at)
   from ops.contatos c left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
   cross join lateral (values ('email',c.email),('whatsapp',c.whatsapp)) v(tipo,valor)
   where c.empresa_id=any(a.empresa_ids) and s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Omie · canal da empresa','at',coalesce(o.synced_at,o.updated_at))
   from ops.base_conta_cnpjs d join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
   cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
   where d.account_key=_key and nullif(trim(v.valor),'') is not null
  ) q;
 end if;
 return jsonb_build_object('cnpjs',documents,'fields',detail->'fields','driva',detail->'driva','ecd_summary',detail->'ecd_summary','sources',detail->'sources','contacts',channels,'contacts_restricted',not ops.monetizacao_can('view.contatos'));
end $function$;

-- Exportar contatos: idem.
CREATE OR REPLACE FUNCTION ops.base_contatos_exportar(_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare out jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 if not ops.monetizacao_can('view.contatos') then raise exception 'Sem permissão para ver contatos';end if;
 if cardinality(_keys)>500 then raise exception 'Máximo de 500 contas por lote';end if;
 -- EXECUTE planeja com o array de verdade; o plano genérico do plpgsql levava 8 s por lote de 500.
 execute $q$ with contas as (
  select a.key,a.empresa_ids from ops.monetizacao_contas a
  where a.key=any($1) and ops.monetizacao_scope(a.unidade_ids) and ($2 or ops.base_conta_liberada(a.key))
 ), canais as (
  -- Conta sem empresa no Ops: o que ficou gravado no detalhe (Pipedrive e stakeholder do Pipefy).
  select c.key,null::text nome,null::text cargo,x->>'type' tipo,x->>'value' valor
  from contas c join ops.monetizacao_detalhes d on d.account_key=c.key
  cross join lateral jsonb_array_elements(coalesce(d.detalhe->'contacts','[]')) x
  where cardinality(c.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
  union all
  select c.key,nullif(trim(p.nome_completo),''),nullif(trim(p.cargo),''),v.tipo,v.valor
  from contas c join ops.contatos p on p.empresa_id=any(c.empresa_ids)
  left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=p.id
  cross join lateral (values ('email',p.email),('whatsapp',p.whatsapp)) v(tipo,valor)
  where s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
  union all
  select c.key,null,null,v.tipo,v.valor
  from contas c join ops.base_conta_cnpjs d on d.account_key=c.key
  join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
  cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
  where nullif(trim(v.valor),'') is not null
 ), emails as (
  -- O Omie guarda vários e-mails no mesmo campo, separados por vírgula ou ponto e vírgula.
  select distinct key,lower(e) email from canais
  cross join lateral regexp_split_to_table(trim(valor),'[,;[:space:]]+') e
  where tipo='email' and e like '%@%'
 ), telefones as (
  -- O mesmo número chega formatado de jeitos diferentes; vale um por sequência de dígitos, sem o 55.
  select distinct on (key,digitos) key,trim(valor) telefone from (
   select key,valor,regexp_replace(regexp_replace(valor,'\D','','g'),'^55(?=\d{10,11}$)','') digitos
   from canais where tipo<>'email'
  ) t where digitos<>'' order by key,digitos,valor
 )
 select coalesce(jsonb_object_agg(c.key,jsonb_build_object(
   'nomes',(select string_agg(distinct nome||coalesce(' ('||cargo||')',''),'; ') from canais n where n.key=c.key and nome is not null),
   'emails',(select string_agg(email,'; ' order by email) from emails e where e.key=c.key),
   'telefones',(select string_agg(telefone,'; ' order by telefone) from telefones t where t.key=c.key))),'{}')
 from (select distinct key from canais) c $q$ into out using _keys, ops.base_ve_fornecedor();
 return out;
end $function$;

CREATE OR REPLACE FUNCTION ops.base_contatos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and ops.monetizacao_can('view.contatos') and (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
   and ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(a.key))
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$function$;

CREATE OR REPLACE FUNCTION ops.monetizacao_base_origins()
 RETURNS TABLE(account_key text, origin jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 with scoped as (
  select c.* from ops.monetizacao_contas c
  where (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao'))
    and ops.monetizacao_scope(c.unidade_ids)
    and ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(c.key))
 ), facts as (
  select c.key,
   coalesce(bool_or(trim(e.origem_da_base)='Base Antiga'),false) as antiga,
   coalesce(bool_or(trim(e.origem_da_base)='Base Nova'),false) as nova,
   coalesce((c.perfil->>'new_commercial')::boolean,false) or coalesce(c.perfil#>>'{consultoria_origin,status}'='comercial',false) as comercial,
   coalesce(c.perfil#>>'{consultoria_origin,status}'='retroativa',false) as retroativa
  from scoped c left join ops.empresas e on e.id=any(c.empresa_ids)
  group by c.key,c.perfil
 ), classified as (
  select *,case when antiga and (nova or comercial) then 'divergente'
    when antiga then 'antiga' when nova or comercial then 'nova'
    when retroativa then 'antiga' else 'confirmar' end as classification
  from facts
 )
 select key,jsonb_build_object(
  'status',classification,'commercial',comercial,
  'source',case when antiga or nova then 'Ops · empresas.origem_da_base, confrontado com os fechamentos comerciais'
    when comercial then 'CRM · fechamento comercial identificado na conta conciliada'
    when retroativa then 'Origem retroativa conferida no Ops/Pipefy'
    else 'Sem origem explícita ou fechamento comercial comprovado' end,
  'reason',case classification
   when 'divergente' then 'Há Base Antiga no cadastro e também Base Nova ou fechamento comercial. Conferir a origem; excluída da Consultoria retroativa.'
   when 'antiga' then 'Base Antiga registrada na carteira da unidade, sem fechamento comercial identificado no cruzamento.'
   when 'nova' then case when nova then 'Base Nova registrada no cadastro da unidade.' else 'Fechamento comercial identificado; tratada como Base Nova.' end
   else 'Origem não comprovada. Ausência de contrato, contato ou CNPJ não comprova Base Antiga.' end)
 from classified
$function$;

CREATE OR REPLACE FUNCTION ops.base_validar_origem(_key text, _origem text, _responsavel text, _evidencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare a record; e record; alvo text; pending integer:=0; previous jsonb;
begin
 if auth.uid() is null or not ops.monetizacao_can('manage.aquario') then raise exception 'Sem permissão para validar origem'; end if;
 select * into a from ops.base_conta_estado where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do escopo';end if;
 if not ops.base_ve_fornecedor() and not ops.base_conta_liberada(_key) then raise exception 'Conta fora do escopo';end if;  -- fornecedor e grupo só para admin (01/10)
 if a.identity_conflict then raise exception 'Resolver a divergência de CNPJ antes de validar origem';end if;
 if _origem not in ('antiga','nova') or length(trim(_responsavel))<3 or length(trim(_evidencia))<10 then raise exception 'Informe origem, responsável e evidência da unidade';end if;
 if a.origin_evidence->>'status' in ('nova','antiga') and _origem<>a.origin_evidence->>'status' then raise exception 'A evidência Omie/Pipedrive determina a origem; revisar a fonte antes de alterar';end if;
 alvo:=case when _origem='antiga' then 'Base Antiga' else 'Base Nova' end;
 insert into ops.base_origem_validacoes(account_key,origem,responsavel,evidencia,ator,fingerprint)
 values(_key,_origem,trim(_responsavel),trim(_evidencia),auth.uid(),a.fingerprint)
 on conflict(account_key) do update set origem=excluded.origem,responsavel=excluded.responsavel,evidencia=excluded.evidencia,ator=excluded.ator,fingerprint=excluded.fingerprint,confirmado_em=now();
 for e in select * from ops.empresas where id=any(a.empresa_ids) and pipefy_record_id is not null and coalesce((select campos->>'origem_da_base' from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=empresas.pipefy_record_id),case when not exists(select 1 from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=empresas.pipefy_record_id) then origem_da_base end) is distinct from alvo loop
  if exists(select 1 from ops.base_alteracoes where empresa_id=e.id and campo='origem_da_base' and (status in ('pending','sending') or (status='error' and tentativas<5))) then raise exception 'Já existe uma correção de origem em andamento';end if;
  select campos->'origem_da_base' into previous from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=e.pipefy_record_id;
  insert into ops.base_alteracoes(empresa_id,campo,valor_anterior,valor_proposto,ator_id,motivo,regra) values(e.id,'origem_da_base',coalesce(previous,to_jsonb(e.origem_da_base)),to_jsonb(alvo),auth.uid(),trim(_evidencia),'validacao-unidade-2026-09-16');pending:=pending+1;
 end loop;
 return jsonb_build_object('status',case when pending>0 then 'pending_source' else 'confirmed' end,'pending',pending);
end $function$;

-- Ofertas: grupo, fornecedor e sem prova ficam fora.
CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare b record; adjusted jsonb; situacao text; s record; issue text; rr jsonb; acima boolean; abaixo boolean; pv jsonb;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 -- sinais: distrato concluído vale para todos os produtos, logo depois da situação cadastral
 -- (definitivo antes do que pede ação humana), na mesma ordem de oferta() no cliente.
 select * into s from ops.base_conta_sinais(array[a->>'key']);
 if s.distrato->>'estado'='concluido' then return ops.base_distrato_bloqueio(s.distrato);end if;
 -- Prova de cliente (01/10): empresa do grupo, fornecedor (recebe pagamento no Omie, ou só tag de fornecedor) e conta
 -- só do Omie sem prova saem de todas as ofertas, Recon inclusive. Mesma posição de fornecedorForaDeOferta() no cliente.
 pv:=ops.base_conta_prova(b.cnpjs, b.empresa_ids, b.ecd_registros, b.perfil, (select t.omie from ops.base_conta_omie_tags(b.cnpjs) t));
 if pv->>'nivel' in ('grupo','fornecedor','sem_prova') then return pv->>'motivo';end if;
 -- Só fornecedor no Omie (tags do cadastro, 29/09): fora de todas as ofertas, Recon inclusive, na mesma posição
 -- de fornecedorForaDeOferta() no cliente (src/lib/monetizacao/model.ts).
 if (select t.omie->>'classe' from ops.base_conta_omie_tags(b.cnpjs) t)='fornecedor' then
  return 'Só fornecedor no Omie, sem tag de cliente; fora das ofertas';
 end if;
 -- Recon (pipe 38 do Pipedrive, 29/09): o espelho de ofertaRecon (src/lib/monetizacao/recon.ts), na mesma
 -- ordem: identidade, situação e distrato concluído já passaram; o cadastro ausente no Pipefy não veta o Recon.
 if p='recon' then
  rr:=a->'recon';
  if rr is null or jsonb_typeof(rr)<>'object' then return 'Contrato e carteira BPO ainda não conferidos';end if;
  if rr->>'bpo_status'='bpo' then return coalesce(nullif(rr->>'reason',''),'Cliente com BPO contábil, fiscal, folha ou financeiro');end if;
  if coalesce((rr->>'revenue_conflict')::boolean,false) or coalesce((a->>'band_conflict')::boolean,false) then return 'Fontes divergem sobre o faturamento anual';end if;
  acima:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric>5000000 else coalesce((rr->>'revenue_min')::numeric>5000000,false) end;
  abaixo:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric<=5000000 else coalesce((rr->>'revenue_max')::numeric<=5000000,false) end;
  if abaixo then return 'Faturamento anual de até R$ 5 milhões';end if;
  if not acima then return 'Confirmar faturamento anual acima de R$ 5 milhões; a faixa atual não comprova o corte';end if;
  if coalesce(rr->>'bpo_status','')<>'fora_bpo' then return coalesce(nullif(rr->>'reason',''),'Confirmar que a empresa não tem BPO');end if;
  -- a tratativa em andamento segura a oferta, como comTratativa() no cliente
  return ops.base_distrato_bloqueio(s.distrato);
 end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 -- sinais: quem já é cliente (ou tem proposta aberta) da Consultoria não recebe Consultoria.
 if p='consultoria' then
  issue:=ops.base_consultoria_bloqueio(s.consultoria);
  if issue is not null then return issue;end if;
 end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 issue:=ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;
