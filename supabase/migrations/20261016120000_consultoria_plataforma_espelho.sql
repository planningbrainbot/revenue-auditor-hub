-- Consultoria › Buscar empresa: a ficha passa a trazer tudo o que a plataforma do Pedro Siqueira tem da empresa.
--
-- Pedido do Pedro em 16/10/2026: "Eu quero basicamente puxar todas as infos do cliente que eu pesquiso sem precisar
-- entrar na plataforma do Pedro. Garanta isso." A API `api-comercial` só manda o cadastro, a etapa dos projetos, o
-- valor identificado, o crédito somado e as propostas em negociação. A plataforma tem mais: as teses uma a uma, os
-- gestores, o canal, os follow-ups, as propostas aceitas e perdidas, o estoque de crédito mês a mês, as faturas e os
-- recebimentos da Consultoria, o histórico de etapas e 77 projetos sem CNPJ.
--
-- Decisão do Pedro (16/10): um login técnico só de leitura na plataforma (planning.brain.bot@gmail.com, papel
-- Comercial, unidade PAT), lido pela Edge Function `consultoria-plataforma-sync` a cada 15 minutos. O papel Comercial
-- vê tudo da PAT; não vê 4 lançamentos da PAC, que não são clientes da Consultoria.
--
-- 1. ops.consultoria_plataforma: espelho genérico, uma linha por (tabela, id), com o registro inteiro em `dados`.
--    Gravado só pelo RPC ops.consultoria_plataforma_gravar, que escreve só o que mudou (hash) e marca ausente quem
--    sumiu, com a mesma trava da consultoria-sync (leitura vazia ou que perde mais da metade não marca ninguém).
-- 2. ops.consultoria_empresa_ficha(...): tudo da plataforma sobre uma empresa, para a ficha.
-- 3. ops.consultoria_plataforma_indice(): o que a busca precisa a mais: projetos sem cliente e propostas de todos os
--    status (a API só manda as em negociação).
-- 4. A cópia da API (consultoria-sync) passa de hora em hora para a cada 15 minutos, junto com a nova.

begin;

create table if not exists ops.consultoria_plataforma (
  tabela text not null,
  id text not null,
  cliente_id text,
  projeto_id text,
  cnpj text,
  nome text,
  dados jsonb not null,
  hash text not null,
  alterado_em timestamptz not null default now(),
  ausente_desde timestamptz,
  primary key (tabela, id)
);
create index if not exists consultoria_plataforma_cliente on ops.consultoria_plataforma (cliente_id)
  where ausente_desde is null and cliente_id is not null;
create index if not exists consultoria_plataforma_projeto on ops.consultoria_plataforma (projeto_id)
  where ausente_desde is null and projeto_id is not null;
create index if not exists consultoria_plataforma_cnpj on ops.consultoria_plataforma (cnpj)
  where ausente_desde is null and cnpj is not null;
comment on table ops.consultoria_plataforma is
  'Espelho da plataforma da Consultoria (Supabase dkgfajxmuyrejxbyqgxn, Pedro Siqueira), lido com o login técnico '
  'planning.brain.bot@gmail.com (papel Comercial). Uma linha por (tabela, id) da plataforma. Sync: '
  'consultoria-plataforma-sync a cada 15 min. Só o RPC consultoria_plataforma_gravar escreve.';
alter table ops.consultoria_plataforma enable row level security;
revoke all on ops.consultoria_plataforma from public, anon, authenticated;
grant select, insert, update, delete on ops.consultoria_plataforma to service_role;

-- Nome para casar projeto, tese e proposta sem CNPJ: sem acento, minúsculo, só letras e números.
create or replace function ops.consultoria_nome_norm(p text)
returns text
language sql
immutable
set search_path to 'ops', 'public', 'extensions'
as $$
  select nullif(trim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Grava uma tabela inteira da plataforma. p_linhas: [{id, cliente_id, projeto_id, cnpj, nome, dados}].
create or replace function ops.consultoria_plataforma_gravar(p_tabela text, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _lidos int;
  _antes int;
  _novos int := 0;
  _alterados int := 0;
  _ausentes int := 0;
  _recusa text;
  _ids text[];
begin
  if coalesce(p_tabela, '') = '' or jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'tabela ou linhas inválidas' using errcode = '22023';
  end if;
  select count(*) into _antes from ops.consultoria_plataforma where tabela = p_tabela and ausente_desde is null;
  select array_agg(distinct x->>'id') into _ids
    from jsonb_array_elements(p_linhas) x where coalesce(x->>'id', '') <> '';
  _lidos := coalesce(cardinality(_ids), 0);

  with entrada as (
    select distinct on (x->>'id')
           x->>'id' as id, nullif(x->>'cliente_id', '') as cliente_id, nullif(x->>'projeto_id', '') as projeto_id,
           nullif(x->>'cnpj', '') as cnpj, nullif(x->>'nome', '') as nome, x->'dados' as dados,
           md5((x->'dados')::text) as hash
      from jsonb_array_elements(p_linhas) x
     where coalesce(x->>'id', '') <> '' and jsonb_typeof(x->'dados') = 'object'
  ),
  gravadas as (
    insert into ops.consultoria_plataforma as t
           (tabela, id, cliente_id, projeto_id, cnpj, nome, dados, hash, alterado_em, ausente_desde)
    select p_tabela, e.id, e.cliente_id, e.projeto_id, e.cnpj, e.nome, e.dados, e.hash, now(), null from entrada e
    on conflict (tabela, id) do update
       set cliente_id = excluded.cliente_id, projeto_id = excluded.projeto_id, cnpj = excluded.cnpj,
           nome = excluded.nome, dados = excluded.dados, hash = excluded.hash, alterado_em = now(), ausente_desde = null
     where t.hash is distinct from excluded.hash or t.ausente_desde is not null
    returning (xmax = 0) as novo
  )
  select count(*) filter (where novo), count(*) filter (where not novo) into _novos, _alterados from gravadas;

  -- A mesma trava da consultoria-sync: API fora do ar ou paginação quebrada não esvazia a ficha.
  if _lidos = 0 then
    _recusa := 'leitura vazia';
  elsif _antes >= 20 and _lidos < _antes / 2.0 then
    _recusa := format('leitura trouxe %s de %s presentes', _lidos, _antes);
  else
    update ops.consultoria_plataforma t set ausente_desde = now()
     where t.tabela = p_tabela and t.ausente_desde is null and not (t.id = any(_ids));
    get diagnostics _ausentes = row_count;
  end if;

  return jsonb_build_object('tabela', p_tabela, 'lidos', _lidos, 'novos', _novos, 'alterados', _alterados,
                            'ausentes', _ausentes, 'ausencia_recusada', _recusa);
end;
$$;
revoke execute on function ops.consultoria_plataforma_gravar(text, jsonb) from public, anon, authenticated;
grant execute on function ops.consultoria_plataforma_gravar(text, jsonb) to service_role;

-- A porta das leituras da tela Consultoria: a mesma do RPC do Cruzamento (20261006200000).
create or replace function ops.consultoria_porta_leitura()
returns text
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _escopo record;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  select todas_unidades, todas_empresas into _escopo from ops.usuario_escopo where user_id = auth.uid();
  if not coalesce(_escopo.todas_unidades, false) then
    raise exception 'Seu acesso não inclui a visão de todas as unidades.' using errcode = '42501';
  end if;
  -- Devolve o motivo de a porta do Financeiro estar fechada, ou null quando está aberta.
  return case
    when not coalesce(public.tem_produto('financeiro'), false) then 'Sua conta não tem acesso ao Brain Financeiro.'
    when not coalesce(_escopo.todas_empresas, false)
      then 'Os valores financeiros exigem ver todas as empresas no Financeiro; seu escopo é por empresa.'
  end;
end;
$$;
revoke execute on function ops.consultoria_porta_leitura() from public, anon, authenticated;

-- O que a busca precisa além dos dois RPCs que ela já lê.
create or replace function ops.consultoria_plataforma_indice()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
begin
  perform ops.consultoria_porta_leitura();
  return jsonb_build_object(
    'lido_em', now(),
    'sincronizado_em', (select max(executado_em) from ops.sync_log
                         where fonte = 'consultoria_plataforma' and status in ('sucesso', 'parcial')),
    -- Projetos cadastrados sem cliente (sem CNPJ): só têm o nome.
    'projetos_sem_cliente', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.dados->>'razao_social', 'apelido', p.dados->>'apelido',
               'departamento', p.dados->>'departamento', 'etapa', p.dados->>'etapa_atual',
               'produto', p.dados->>'produto', 'baixado', (p.dados->>'baixado')::boolean,
               'data_entrada', p.dados->>'data_entrada') order by p.dados->>'razao_social')
        from ops.consultoria_plataforma p
       where p.tabela = 'projetos_gestao' and p.ausente_desde is null and p.cliente_id is null), '[]'::jsonb),
    -- Teses importadas sem projeto: só têm o nome da empresa (205 vieram de importação).
    'teses_sem_projeto', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', t.empresa, 'teses', t.n, 'valor', t.valor) order by t.empresa)
        from (select min(x.nome) as empresa, count(*) as n,
                     sum(coalesce((x.dados->>'oportunidade')::numeric, 0))
                       filter (where coalesce(x.dados->>'convertido_status', '') not in ('Declinado', 'Baixada')) as valor
                from ops.consultoria_plataforma x
               where x.tabela = 'oportunidades' and x.ausente_desde is null and x.projeto_id is null
                 and x.nome is not null
               group by ops.consultoria_nome_norm(x.nome)) t), '[]'::jsonb),
    -- Propostas de todos os status (a API manda só as em negociação).
    'propostas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'empresa', p.dados->>'empresa', 'cnpj', p.cnpj, 'cliente_id', p.cliente_id,
               'produto', p.dados->>'produto', 'status', p.dados->>'status',
               'percentual_exito', p.dados->'percentual_exito', 'valor_total', p.dados->'valor_total',
               'data_envio', p.dados->>'data_envio') order by p.dados->>'data_envio' desc nulls last)
        from ops.consultoria_plataforma p
       where p.tabela = 'propostas' and p.ausente_desde is null), '[]'::jsonb)
  );
end;
$$;
revoke execute on function ops.consultoria_plataforma_indice() from public, anon;
grant execute on function ops.consultoria_plataforma_indice() to authenticated;

-- Tudo da plataforma sobre uma empresa. A ficha manda os ids de cliente da plataforma, os CNPJs (só dígitos) e os
-- nomes por que a empresa aparece; projeto, tese e proposta sem cliente nem CNPJ casam pelo nome normalizado.
create or replace function ops.consultoria_empresa_ficha(p_cliente_ids text[], p_cnpjs text[], p_nomes text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _porta text;
  _cnpjs text[];
  _nomes text[];
  _cli text[];
  _proj text[];
  _prop text[];
  _est text[];
  _fat text[];
  _ger text[];
begin
  _porta := ops.consultoria_porta_leitura();
  _cnpjs := array(select distinct regexp_replace(c, '\D', '', 'g') from unnest(coalesce(p_cnpjs, '{}')) c
                   where length(regexp_replace(c, '\D', '', 'g')) in (11, 14));
  _nomes := array(select distinct ops.consultoria_nome_norm(n) from unnest(coalesce(p_nomes, '{}')) n
                   where length(coalesce(ops.consultoria_nome_norm(n), '')) >= 3);

  _cli := array(select c.id from ops.consultoria_plataforma c
                 where c.tabela = 'clientes' and c.ausente_desde is null
                   and (c.id = any(coalesce(p_cliente_ids, '{}')) or c.cnpj = any(_cnpjs)));
  _proj := array(select p.id from ops.consultoria_plataforma p
                  where p.tabela = 'projetos_gestao' and p.ausente_desde is null
                    and (p.cliente_id = any(_cli) or p.cnpj = any(_cnpjs)
                         or (p.cliente_id is null and p.cnpj is null
                             and (ops.consultoria_nome_norm(p.nome) = any(_nomes)
                                  or ops.consultoria_nome_norm(p.dados->>'apelido') = any(_nomes)))));
  _prop := array(select p.id from ops.consultoria_plataforma p
                  where p.tabela = 'propostas' and p.ausente_desde is null
                    and (p.cliente_id = any(_cli) or p.cnpj = any(_cnpjs)
                         or (p.cliente_id is null and p.cnpj is null and ops.consultoria_nome_norm(p.nome) = any(_nomes))));
  _est := array(select e.id from ops.consultoria_plataforma e
                 where e.tabela = 'estoque_credito' and e.ausente_desde is null
                   and (e.cliente_id = any(_cli) or e.cnpj = any(_cnpjs) or e.projeto_id = any(_proj)));
  _fat := array(select f.id from ops.consultoria_plataforma f
                 where f.tabela = 'faturamentos' and f.ausente_desde is null
                   and (f.cnpj = any(_cnpjs) or f.dados->>'proposta_id' = any(_prop)));
  _ger := array(select distinct g.dados->>'gestor_id' from ops.consultoria_plataforma g
                 where g.tabela = 'projeto_gestores' and g.ausente_desde is null and g.projeto_id = any(_proj));

  return jsonb_build_object(
    'lido_em', now(),
    'sincronizado_em', (select max(executado_em) from ops.sync_log
                         where fonte = 'consultoria_plataforma' and status in ('sucesso', 'parcial')),
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'clientes', ops.consultoria_plataforma_dados('clientes', _cli),
    'projetos', ops.consultoria_plataforma_dados('projetos_gestao', _proj),
    'prazos', coalesce((select jsonb_agg(x.dados) from ops.consultoria_plataforma x
                         where x.tabela = 'v_painel_prazo_card' and x.ausente_desde is null
                           and x.projeto_id = any(_proj)), '[]'::jsonb),
    'gestores_projeto', coalesce((select jsonb_agg(x.dados) from ops.consultoria_plataforma x
                                   where x.tabela = 'projeto_gestores' and x.ausente_desde is null
                                     and x.projeto_id = any(_proj)), '[]'::jsonb),
    'gestores', ops.consultoria_plataforma_dados('gestores', _ger),
    'teses', coalesce((select jsonb_agg(x.dados order by (x.dados->>'oportunidade')::numeric desc nulls last)
                        from ops.consultoria_plataforma x
                       where x.tabela = 'oportunidades' and x.ausente_desde is null
                         and (x.projeto_id = any(_proj)
                              or (x.projeto_id is null and ops.consultoria_nome_norm(x.nome) = any(_nomes)))),
                      '[]'::jsonb),
    'temas_projeto', coalesce((select jsonb_agg(x.dados || jsonb_build_object('tema', t.dados))
                                from ops.consultoria_plataforma x
                                left join ops.consultoria_plataforma t
                                  on t.tabela = 'temas_tributarios' and t.id = x.dados->>'tema_id'
                               where x.tabela = 'projeto_temas' and x.ausente_desde is null
                                 and x.projeto_id = any(_proj)), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(x.dados order by x.dados->>'registrado_em' desc)
                        from ops.consultoria_plataforma x
                       where x.tabela = 'projeto_area_registro' and x.ausente_desde is null
                         and x.projeto_id = any(_proj)), '[]'::jsonb),
    'fups', coalesce((select jsonb_agg(x.dados order by x.dados->>'created_at' desc)
                       from ops.consultoria_plataforma x
                      where x.tabela = 'projeto_fups' and x.ausente_desde is null
                        and x.projeto_id = any(_proj)), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(x.dados order by x.dados->>'data_evento' desc)
                            from ops.consultoria_plataforma x
                           where x.tabela = 'vw_linha_do_tempo' and x.ausente_desde is null
                             and x.dados->>'entidade_id' = any(_proj || _prop || _cli)), '[]'::jsonb),
    'retificacoes', coalesce((select jsonb_agg(x.dados) from ops.consultoria_plataforma x
                               where x.tabela = 'retificacoes' and x.ausente_desde is null
                                 and (x.projeto_id = any(_proj) or x.cliente_id = any(_cli))), '[]'::jsonb),
    'propostas', ops.consultoria_plataforma_dados('propostas', _prop),
    'estoques', coalesce((select jsonb_agg(e.dados || jsonb_build_object('saldo', s.dados))
                           from ops.consultoria_plataforma e
                           left join ops.consultoria_plataforma s
                             on s.tabela = 'estoque_saldos' and s.id = e.id and s.ausente_desde is null
                          where e.tabela = 'estoque_credito' and e.ausente_desde is null and e.id = any(_est)),
                         '[]'::jsonb),
    'movimentos', coalesce((select jsonb_agg(x.dados order by x.dados->>'competencia')
                             from ops.consultoria_plataforma x
                            where x.tabela = 'estoque_movimentos' and x.ausente_desde is null
                              and x.dados->>'estoque_id' = any(_est)), '[]'::jsonb),
    'utilizacoes', coalesce((select jsonb_agg(x.dados order by x.dados->>'competencia')
                              from ops.consultoria_plataforma x
                             where x.tabela = 'estoque_utilizacoes' and x.ausente_desde is null
                               and x.dados->>'estoque_id' = any(_est)), '[]'::jsonb),
    -- A origem que a Consultoria atribui ao CNPJ (parceiro e rótulo de OKR).
    'classificacao', coalesce((select jsonb_agg(x.dados) from ops.consultoria_plataforma x
                                where x.tabela = 'classificacao_cliente' and x.ausente_desde is null
                                  and x.cnpj = any(_cnpjs)), '[]'::jsonb),
    'canais', coalesce((select jsonb_agg(x.dados) from ops.consultoria_plataforma x
                         where x.tabela = 'canais_venda' and x.ausente_desde is null), '[]'::jsonb),
    'parceiros', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'apelido', x.dados->>'apelido'))
                            from ops.consultoria_plataforma x
                           where x.tabela = 'parceiros' and x.ausente_desde is null), '[]'::jsonb),
    -- Faturas e recebimentos da própria Consultoria: só com a porta do Financeiro.
    'faturas', case when _porta is null then ops.consultoria_plataforma_dados('faturamentos', _fat) end,
    'recebimentos', case when _porta is null then coalesce((
                      select jsonb_agg(x.dados order by x.dados->>'data_vencimento' desc nulls last)
                        from ops.consultoria_plataforma x
                       where x.tabela = 'recebimentos' and x.ausente_desde is null
                         and (x.cnpj = any(_cnpjs) or x.dados->>'proposta_id' = any(_prop))), '[]'::jsonb) end,
    'provisoes', case when _porta is null then coalesce((
                   select jsonb_agg(x.dados order by x.dados->>'data_prevista')
                     from ops.consultoria_plataforma x
                    where x.tabela = 'provisoes_recebimento' and x.ausente_desde is null
                      and (x.cnpj = any(_cnpjs) or x.dados->>'faturamento_id' = any(_fat))), '[]'::jsonb) end
  );
end;
$$;

-- Os registros de uma tabela pelos ids.
create or replace function ops.consultoria_plataforma_dados(p_tabela text, p_ids text[])
returns jsonb
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select coalesce(jsonb_agg(x.dados), '[]'::jsonb) from ops.consultoria_plataforma x
   where x.tabela = p_tabela and x.ausente_desde is null and x.id = any(coalesce(p_ids, '{}'))
$$;
revoke execute on function ops.consultoria_plataforma_dados(text, text[]) from public, anon, authenticated;
revoke execute on function ops.consultoria_empresa_ficha(text[], text[], text[]) from public, anon;
grant execute on function ops.consultoria_empresa_ficha(text[], text[], text[]) to authenticated;

-- Frescor: a cópia da API e o espelho da plataforma a cada 15 minutos.
insert into ops.integracoes_config (fonte, nome_exibicao, tipo, intervalo_esperado_minutos, ativo, observacao)
values ('consultoria_plataforma', 'Plataforma da Consultoria → ficha completa (leitura direta)', 'cron', 15, true,
        'Edge Function consultoria-plataforma-sync, pg_cron a cada 15 min (job consultoria-plataforma-sync-15min). '
        'Login técnico planning.brain.bot@gmail.com (papel Comercial) no Supabase da plataforma do Pedro Siqueira.')
on conflict (fonte) do update set nome_exibicao = excluded.nome_exibicao, tipo = excluded.tipo,
  intervalo_esperado_minutos = excluded.intervalo_esperado_minutos, ativo = true, observacao = excluded.observacao;
update ops.integracoes_config
   set intervalo_esperado_minutos = 15,
       observacao = 'Edge Function consultoria-sync, pg_cron a cada 15 min (job consultoria-sync-15min, desde 16/10/2026; '
                    'antes de hora em hora). API api-comercial do Pedro Siqueira, header x-api-key.'
 where fonte = 'consultoria';

select cron.unschedule('consultoria-sync-hora') where exists (select 1 from cron.job where jobname = 'consultoria-sync-hora');
select cron.schedule('consultoria-sync-15min', '2,17,32,47 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/consultoria-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=120000);
$cron$);
select cron.schedule('consultoria-plataforma-sync-15min', '7,22,37,52 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/consultoria-plataforma-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=150000);
$cron$);

commit;
