-- Dois sinais externos na geração de bases do Brain (DECISIONS 28/09/2026):
--
-- (A) Distrato, lido do pipe [PTRS-CLI-02] Tratativas de Churn do Pipefy (307196408). O espelho
--     ops.central_tratativas estava parado desde 15/09 17:37 UTC: o cron do Ops antigo foi
--     desligado na migração para o banco único (24/08) e o disparo que o substituiu parou. A sync
--     volta como edge function versionada (supabase/functions/pipefy-tratativas-sync), agendada
--     aqui por pg_cron, e passa a gravar a fase, o conector do cliente e o estado do distrato.
-- (B) Operação da Consultoria, lida da API da plataforma do Pedro Siqueira (api-comercial):
--     clientes e propostas em tabelas próprias, sincronizadas por supabase/functions/consultoria-sync.
--     A API ainda não traz cliente inativo nem valor a recuperar; as colunas já existem e ficam
--     nulas até ela trazer.
--
-- Os sinais são calculados na leitura (ops.base_conta_sinais), não gravados na conta: casamento
-- por conector do Pipefy e id do negócio (distrato), por CNPJ completo e por raiz (Consultoria) e,
-- só para proposta sem CNPJ, por nome normalizado, marcado como incerto e sem efeito em regra.
-- A regra entra nas duas pontas: oferta() no cliente e ops.monetizacao_offer_issue no servidor.
-- Rollback: supabase/rollback/20260928200000_base_sinais_distrato_consultoria_rollback.sql.
begin;

-- ---------------------------------------------------------------------------------------------
-- (A) Central de Tratativas
-- ---------------------------------------------------------------------------------------------
alter table ops.central_tratativas
  add column if not exists fase_id text,
  add column if not exists pipefy_cliente_ids text[] not null default '{}',
  add column if not exists distrato_estado text,
  add column if not exists pipefy_criado_em timestamptz,
  add column if not exists sincronizado_em timestamptz;

alter table ops.central_tratativas drop constraint if exists central_tratativas_distrato_estado_check;
alter table ops.central_tratativas add constraint central_tratativas_distrato_estado_check
  check (distrato_estado is null or distrato_estado in ('tratativa', 'concluido', 'revertido'));

comment on column ops.central_tratativas.distrato_estado is
  'Estado do pedido de distrato pela fase do card: tratativa (pode reverter), concluido (perdido), revertido (retido). Gravado por pipefy-tratativas-sync.';
comment on column ops.central_tratativas.pipefy_cliente_ids is
  'Registros do conector "cliente" do card (tabela de empresas do Pipefy) = ops.empresas.pipefy_record_id. Chave de junção com a conta da base.';

-- As 31 linhas de antes da sync nova ganham estado pelo status que já tinham; a primeira rodada
-- reescreve tudo a partir da fase.
update ops.central_tratativas
   set distrato_estado = case status when 'lost' then 'concluido' when 'won' then 'revertido' else 'tratativa' end
 where distrato_estado is null;

create index if not exists central_tratativas_cliente_ids_idx on ops.central_tratativas using gin (pipefy_cliente_ids);
create index if not exists central_tratativas_deal_idx on ops.central_tratativas (pipedrive_deal_id);

-- O monitor (v_integracoes_status) e o frescor da base pedem "a última execução desta fonte";
-- sem índice, cada consulta varre as ~45 mil linhas do log.
create index if not exists sync_log_fonte_executado_idx on ops.sync_log (fonte, executado_em desc);

-- ---------------------------------------------------------------------------------------------
-- (B) Consultoria
-- ---------------------------------------------------------------------------------------------
-- Nome comparável para casar proposta sem CNPJ. Igualdade exata depois de normalizar: nada de
-- semelhança (DECISIONS 15/09: nunca conciliar por semelhança de nome). Mesmo assim o casamento
-- é declarado incerto na tela e não entra em regra nenhuma.
create or replace function ops.nome_comparavel(t text) returns text
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
        '[^a-z0-9]+', ' ', 'g'),
      '\m(ltda|me|epp|eireli|sa|s a|grupo|cia|companhia|comercio|industria|e|de|do|da|dos|das)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

create table if not exists ops.consultoria_clientes (
  id uuid primary key,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  cnpj_raiz text generated always as (left(cnpj, 8)) stored,
  razao_social text,
  nome_fantasia text,
  grupo_economico text,
  parceiro text,
  uf text,
  municipio text,
  cnae text,
  cnae_descricao text,
  porte text,
  regime_tributario text,
  situacao_receita text,
  ativo boolean not null default true,
  -- Reservados: a API de 28/09 não informa cliente inativo nem valor a recuperar. A sync lê
  -- `inativo_desde`, `valor_a_recuperar` e `valor_a_recuperar_em` quando vierem no payload.
  inativo_desde date,
  valor_a_recuperar numeric(16, 2),
  valor_a_recuperar_em date,
  cadastrado_em timestamptz,
  atualizado_em timestamptz,
  payload jsonb not null,
  sincronizado_em timestamptz not null default now(),
  -- Sumiu da API numa carga completa. Não apaga: a linha fica como histórico e sai do casamento.
  ausente_desde timestamptz
);
create index if not exists consultoria_clientes_cnpj_idx on ops.consultoria_clientes (cnpj);
create index if not exists consultoria_clientes_raiz_idx on ops.consultoria_clientes (cnpj_raiz);
comment on table ops.consultoria_clientes is
  'Clientes da plataforma de operação da Consultoria (Pedro Siqueira), GET /clientes. Sync: consultoria-sync (pg_cron). Uma linha por id da plataforma.';

create table if not exists ops.consultoria_propostas (
  id uuid primary key,
  empresa text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  cliente_id uuid,
  produto text,
  linha_produto text,
  categoria text,
  -- Reservado: a API não informa se a proposta está aberta, ganha ou perdida. Nulo = aberta.
  status text,
  responsavel text,
  parceiro text,
  canal_venda text,
  unidade text,
  data_envio date,
  data_ultimo_fup date,
  data_proximo_fup date,
  tipo_cobranca text,
  valor_total numeric(16, 2),
  valor_fixo numeric(16, 2),
  percentual_exito numeric,
  num_parcelas integer,
  criada_em timestamptz,
  atualizado_em timestamptz,
  payload jsonb not null,
  sincronizado_em timestamptz not null default now(),
  ausente_desde timestamptz,
  -- Nome normalizado para o casamento incerto de proposta sem CNPJ, calculado uma vez na gravação.
  empresa_comparavel text generated always as (ops.nome_comparavel(empresa)) stored
);
create index if not exists consultoria_propostas_cnpj_idx on ops.consultoria_propostas (cnpj);
create index if not exists consultoria_propostas_cliente_idx on ops.consultoria_propostas (cliente_id);
comment on table ops.consultoria_propostas is
  'Propostas e contratos da Consultoria, GET /propostas da plataforma. CNPJ muitas vezes nulo: casamento por nome só vira selo incerto, nunca regra.';

-- Leitura só pelas funções da base (security definer), que conferem sessão, área e escopo.
alter table ops.consultoria_clientes enable row level security;
alter table ops.consultoria_propostas enable row level security;
revoke all on ops.consultoria_clientes, ops.consultoria_propostas from public, anon, authenticated;
grant select, insert, update, delete on ops.consultoria_clientes, ops.consultoria_propostas to service_role;

-- ---------------------------------------------------------------------------------------------
-- Sinais por conta
-- ---------------------------------------------------------------------------------------------



-- Um objeto por conta com sinal: distrato e Consultoria. `_keys` nulo = base inteira (régua).
-- Sem checagem de sessão: só é chamada por funções security definer que já checaram, e ninguém
-- além do dono e do service_role a executa.
create or replace function ops.base_conta_sinais(_keys text[] default null)
returns table (key text, distrato jsonb, consultoria jsonb)
language sql stable set search_path = ops, public, extensions as $$
-- Função SQL é planejada sem o valor do parâmetro: `_keys is null or key = any(_keys)` não usa
-- índice e varre a base inteira (medido em 28/09: 350 ms contra 37 ms por página de 400). A lista
-- de chaves é resolvida uma vez e todo filtro é `= any(...)`.
with alvo as (
  select coalesce(_keys, array(select key from ops.monetizacao_contas)) as ks
),
contas as (
  select a.key, a.empresa_ids, a.perfil->>'name' as nome
    from ops.monetizacao_contas a
   where a.key = any((select ks from alvo)::text[])
),
emp as (
  select c.key, e.id, e.pipefy_record_id, nullif(e.pipedrive_id, '') as pipedrive_id, e.razao_social, e.titulo
    from contas c join ops.empresas e on e.id = any(c.empresa_ids)
),
-- (A) Card da Central de Tratativas pela empresa da conta: conector "cliente" do Pipefy, id do
-- negócio no Pipedrive ou a empresa já resolvida pela sync.
trat as (
  select distinct on (emp.key, t.pipefy_card_id) emp.key, t.*,
         case when emp.pipefy_record_id = any(t.pipefy_cliente_ids) then 'pipefy' else 'negocio' end as casamento
    from emp
    join ops.central_tratativas t
      on emp.pipefy_record_id = any(t.pipefy_cliente_ids)
      or emp.pipedrive_id = t.pipedrive_deal_id::text
      or t.empresa_id = emp.id
   where t.distrato_estado is not null
   order by emp.key, t.pipefy_card_id, (emp.pipefy_record_id = any(t.pipefy_cliente_ids)) desc
),
-- Mais de um card: tratativa aberta vence (é o que pede ação), depois concluído, depois revertido.
distrato as (
  select distinct on (t.key) t.key,
         jsonb_build_object(
           'estado', t.distrato_estado,
           'fase', t.estagio,
           'card_id', t.pipefy_card_id,
           'data_churn', t.data_churn,
           'categoria', t.motivo,
           'casamento', t.casamento,
           'cards', count(*) over (partition by t.key),
           'atualizado_em', t.update_time,
           'sincronizado_em', t.sincronizado_em) as sinal
    from trat t
   order by t.key,
            case t.distrato_estado when 'tratativa' then 1 when 'concluido' then 2 else 3 end,
            t.update_time desc nulls last
),
cn as (
  select d.account_key as key, d.cnpj
    from ops.base_conta_cnpjs d
   where d.account_key = any((select ks from alvo)::text[])
),
-- (B) Cliente da Consultoria por CNPJ completo e, sem ele, pela raiz (mesma pessoa jurídica).
cliente as (
  select distinct on (cn.key) cn.key,
         jsonb_build_object(
           'casamento', case when cc.cnpj = cn.cnpj then 'cnpj' else 'raiz' end,
           'cnpj', cc.cnpj,
           'razao_social', cc.razao_social,
           'ativo', cc.ativo,
           'inativo_desde', cc.inativo_desde,
           'valor_a_recuperar', cc.valor_a_recuperar,
           'valor_a_recuperar_em', cc.valor_a_recuperar_em,
           'regime_tributario', cc.regime_tributario,
           'parceiro', cc.parceiro,
           'cadastrado_em', cc.cadastrado_em,
           'sincronizado_em', cc.sincronizado_em) as sinal
    from cn join ops.consultoria_clientes cc on cc.cnpj_raiz = left(cn.cnpj, 8) and cc.ausente_desde is null
   order by cn.key, (cc.cnpj = cn.cnpj) desc, cc.ativo desc, cc.cadastrado_em
),
prop_cnpj as (
  select cn.key, p.*, case when coalesce(p.cnpj, pc.cnpj) = cn.cnpj then 'cnpj' else 'raiz' end as casamento
    from ops.consultoria_propostas p
    left join ops.consultoria_clientes pc on pc.id = p.cliente_id
    join cn on left(coalesce(p.cnpj, pc.cnpj), 8) = left(cn.cnpj, 8)
   where p.ausente_desde is null
),
nomes as (
  select key, ops.nome_comparavel(nome) as n from contas
  union
  select key, ops.nome_comparavel(razao_social) from emp
  union
  select key, ops.nome_comparavel(titulo) from emp
),
prop_nome as (
  select nomes.key, p.*, 'nome'::text as casamento
    from ops.consultoria_propostas p
    left join ops.consultoria_clientes pc on pc.id = p.cliente_id
    join nomes on nomes.n = p.empresa_comparavel
   where p.ausente_desde is null
     and coalesce(p.cnpj, pc.cnpj) is null
     and length(p.empresa_comparavel) >= 4
     and p.empresa_comparavel not like 'a identificar%'
),
prop as (
  select distinct on (x.key, x.id) x.* from (
    select * from prop_cnpj union all select * from prop_nome
  ) x
  order by x.key, x.id, case x.casamento when 'cnpj' then 1 when 'raiz' then 2 else 3 end
),
propostas as (
  select p.key, jsonb_agg(jsonb_build_object(
           'id', p.id,
           'categoria', p.categoria,
           'status', p.status,
           'produto', p.produto,
           'linha_produto', p.linha_produto,
           'valor_total', p.valor_total,
           'tipo_cobranca', p.tipo_cobranca,
           'percentual_exito', p.percentual_exito,
           'data_envio', p.data_envio,
           'data_ultimo_fup', p.data_ultimo_fup,
           'data_proximo_fup', p.data_proximo_fup,
           'responsavel', p.responsavel,
           'casamento', p.casamento) order by p.data_envio desc nulls last, p.id) as lista,
         max(p.sincronizado_em) as sincronizado_em
    from prop p group by p.key
),
todas as (
  select key from distrato union select key from cliente union select key from propostas
)
select t.key,
       d.sinal,
       case when c.key is not null or p.key is not null then jsonb_build_object(
         'cliente', c.sinal,
         'propostas', coalesce(p.lista, '[]'::jsonb),
         'sincronizado_em', greatest((c.sinal->>'sincronizado_em')::timestamptz, p.sincronizado_em))
       end
  from todas t
  left join distrato d on d.key = t.key
  left join cliente c on c.key = t.key
  left join propostas p on p.key = t.key
$$;
revoke all on function ops.base_conta_sinais(text[]) from public, anon, authenticated;
grant execute on function ops.base_conta_sinais(text[]) to service_role;

-- Regras dos sinais, puras para o teste de paridade com o cliente (tests/base-sinais.sql espelha
-- tests/portfolio.test.mjs). Mesma ordem e mesmo motivo de oferta() em src/lib/monetizacao/model.ts.
create or replace function ops.base_distrato_bloqueio(distrato jsonb) returns text
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select case distrato->>'estado'
    when 'concluido' then 'Distrato concluído na Central de Tratativas; fora das ofertas'
    when 'tratativa' then 'Cliente em tratativa de distrato na Central de Tratativas; fora do envio até a tratativa terminar'
  end
$$;

create or replace function ops.base_consultoria_bloqueio(consultoria jsonb) returns text
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select case
    when consultoria->'cliente' is not null and jsonb_typeof(consultoria->'cliente') = 'object'
         and coalesce((consultoria->'cliente'->>'ativo')::boolean, true)
      then case consultoria->'cliente'->>'casamento'
             when 'raiz' then 'A mesma empresa (raiz do CNPJ) já é cliente da Consultoria; não oferecer Consultoria'
             else 'Já é cliente da Consultoria; não oferecer Consultoria' end
    when exists (select 1 from jsonb_array_elements(coalesce(consultoria->'propostas', '[]')) p
                  where p->>'casamento' in ('cnpj', 'raiz') and p->>'categoria' = 'Contrato')
      then 'Contrato da Consultoria registrado na plataforma; não oferecer Consultoria'
    when exists (select 1 from jsonb_array_elements(coalesce(consultoria->'propostas', '[]')) p
                  where p->>'casamento' in ('cnpj', 'raiz') and p->>'categoria' = 'Proposta'
                    and coalesce(p->>'status', 'aberta') = 'aberta')
      then 'Proposta da Consultoria em aberto; não duplicar a oferta'
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- As três funções vivas que passam a carregar os sinais. Corpo anterior copiado da produção em
-- 28/09 (supabase/rollback/…); a mudança é só o que está marcado "sinais".
-- ---------------------------------------------------------------------------------------------
create or replace function ops.base_unica_catalogo(_keys text[] default null::text[])
returns jsonb
language sql stable security definer set search_path to 'ops', 'public', 'extensions' as $function$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
   -- sinais
   'distrato',s.distrato,'consultoria',s.consultoria)),'[]')
 from ops.base_conta_estado a
 left join ops.base_conta_sinais(_keys) s on s.key = a.key  -- sinais
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(a.unidade_ids) and (_keys is null or a.key=any(_keys))
$function$;

create or replace function ops.base_carteira_manifesto()
returns jsonb
language plpgsql stable security definer set search_path to 'ops', 'public', 'extensions' as $function$
declare pages jsonb; total integer; all_units boolean; units integer[];
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 with ordered as (
  select key,row_number() over(order by key) rn from ops.monetizacao_contas
  where all_units or unidade_ids && units
 ), chunks as (
  select (rn-1)/400 page,max(key) through,count(*) count from ordered group by 1
 ), boundaries as (
  select lag(through) over(order by page) after,through,count,page from chunks
 ) select coalesce(jsonb_agg(jsonb_build_object('after',after,'through',through,'count',count) order by page),'[]'),coalesce(sum(count),0) into pages,total from boundaries;
 return jsonb_build_object('pages',pages,'count',total,'catalog_at',(select catalog_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature(),
  -- sinais: última carga concluída de cada fonte, para a procedência da tela (N3)
  'sinais',jsonb_build_object(
   'tratativas',(select max(executado_em) from ops.sync_log where fonte='pipefy_tratativas' and status='sucesso'),
   'consultoria',(select max(executado_em) from ops.sync_log where fonte='consultoria' and status='sucesso')));
end $function$;

create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare b record; adjusted jsonb; situacao text; s record; issue text;
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
end $$;

-- ---------------------------------------------------------------------------------------------
-- Monitor e agendamento
-- ---------------------------------------------------------------------------------------------
insert into ops.integracoes_config (fonte, nome_exibicao, tipo, intervalo_esperado_minutos, ativo, observacao)
values ('consultoria', 'Plataforma da Consultoria → clientes e propostas', 'cron', 60, true,
        'Edge Function consultoria-sync, pg_cron de hora em hora (job consultoria-sync-hora). API api-comercial do Pedro Siqueira, header x-api-key.')
on conflict (fonte) do update set nome_exibicao = excluded.nome_exibicao, tipo = excluded.tipo,
  intervalo_esperado_minutos = excluded.intervalo_esperado_minutos, ativo = true, observacao = excluded.observacao;
update ops.integracoes_config
   set observacao = 'Edge Function pipefy-tratativas-sync, pg_cron a cada 15min (job pipefy-tratativas-sync-15min, banco único, desde 28/09/2026). Parada de 15/09 a 28/09: o disparo anterior morreu na migração.'
 where fonte = 'pipefy_tratativas';

-- O segredo do cabeçalho mora no Vault (base_sinais_cron_secret) e na edge function
-- (SINAIS_CRON_SECRET); nenhum dos dois está no repositório. Mesmo padrão de base-clientes-reconcile.
select cron.schedule('pipefy-tratativas-sync-15min', '*/15 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/pipefy-tratativas-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=120000);
$cron$);
select cron.schedule('consultoria-sync-hora', '20 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/consultoria-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=120000);
$cron$);

commit;
