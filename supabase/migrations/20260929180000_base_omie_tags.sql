-- Tags do cadastro do Omie (Cliente, Fornecedor, Funcionário...) na Base de clientes (pedido do Pedro, 29/09/2026:
-- "um filtro geral nas tags do omie de todos os clientes pra saber o que é cliente e o que é fornecedor").
--
-- O cadastro "Clientes e Fornecedores" do Omie de cada unidade mistura quem a unidade atende com quem ela paga.
-- A Base puxa o cadastro inteiro, e em 29/09 1.473 contas da Base eram só Fornecedor no Omie (1.235 delas só da
-- Matriz). A tag é o que o Omie tem para separar; `ops.omie_clientes` não a guarda.
--
-- ops.base_omie_tags: um registro por cadastro (unidade × código do Omie), gravado por `omie-tags-sync`.
-- Lido só pela ficha da base (security definer, que confere sessão, área e escopo); fechado ao cliente.

create table if not exists ops.base_omie_tags (
  unidade text not null,
  codigo_omie bigint not null,
  cnpj text,
  tags text[] not null default '{}',
  inativo boolean not null default false,
  -- Calculadas das tags na gravação (trigger abaixo): a ficha lê 10 mil contas e não pode normalizar texto por conta.
  cliente boolean not null default false,
  fornecedor boolean not null default false,
  interna boolean not null default false,
  sincronizado_em timestamptz not null default now(),
  primary key (unidade, codigo_omie)
);
comment on table ops.base_omie_tags is
  'Tags do cadastro do Omie por unidade (Cliente, Fornecedor, Funcionário...). Gravada por omie-tags-sync; CNPJ só dígitos.';
create index if not exists base_omie_tags_cnpj_idx on ops.base_omie_tags (cnpj);
alter table ops.base_omie_tags enable row level security;
revoke all on ops.base_omie_tags from public, anon, authenticated;
grant select, insert, update, delete on ops.base_omie_tags to service_role;

-- Tag comparável: sem acento, sem caixa ("FORNECEDOR" de Curitiba = "Fornecedor" do Rio).
create or replace function ops.omie_tag_normal(t text) returns text
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select lower(translate(trim(coalesce(t, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                                               'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
$$;

-- A regra das tags, num lugar só: Cliente; Fornecedor ou Transportadora; Funcionário, Sócio, CLT, PJ ou Estágio.
create or replace function ops.base_omie_tags_flags() returns trigger
language plpgsql set search_path = ops, public, extensions as $$
declare n text[];
begin
  select coalesce(array_agg(ops.omie_tag_normal(t)), '{}') into n from unnest(new.tags) t;
  new.cliente := 'cliente' = any(n);
  new.fornecedor := n && array['fornecedor', 'transportadora'];
  new.interna := n && array['funcionario', 'socio', 'clt', 'pj', 'estagio'];
  return new;
end $$;
drop trigger if exists base_omie_tags_flags on ops.base_omie_tags;
create trigger base_omie_tags_flags before insert or update of tags on ops.base_omie_tags
  for each row execute function ops.base_omie_tags_flags();

-- O sinal da conta, somando os cadastros de todos os CNPJs dela em todos os Omie (Matriz inclusive):
-- classe = cliente · cliente_e_fornecedor · fornecedor (sem Cliente) · pessoa_interna (sem Cliente nem Fornecedor) ·
-- sem_tag (está no Omie sem nenhuma dessas tags). Nulo quando nenhum CNPJ da conta está no Omie (a tela diz
-- "fora do Omie"). `cliente_em`/`fornecedor_em` dizem em qual Omie: fornecedor só da Matriz é quem a Planning
-- Partners paga, o que não é o mesmo que fornecedor da unidade.
-- Sem checagem de sessão: só a ficha (security definer) chama.
create or replace function ops.base_conta_omie_tags(_cnpjs text[])
returns table (omie jsonb)
language sql stable set search_path = ops, public, extensions as $$
  select case when count(*) = 0 then null else jsonb_build_object(
    'classe', case
      when bool_or(o.cliente) and bool_or(o.fornecedor) then 'cliente_e_fornecedor'
      when bool_or(o.cliente) then 'cliente'
      when bool_or(o.fornecedor) then 'fornecedor'
      when bool_or(o.interna) then 'pessoa_interna'
      else 'sem_tag' end,
    'cliente_em', coalesce(to_jsonb(array_agg(distinct o.unidade) filter (where o.cliente)), '[]'::jsonb),
    'fornecedor_em', coalesce(to_jsonb(array_agg(distinct o.unidade) filter (where o.fornecedor)), '[]'::jsonb),
    'sincronizado_em', max(o.sincronizado_em)
  ) end
  from ops.base_omie_tags o
  where o.cnpj = any(coalesce(_cnpjs, '{}'::text[]))
$$;
revoke all on function ops.base_conta_omie_tags(text[]) from public, anon, authenticated;
grant execute on function ops.base_conta_omie_tags(text[]) to service_role;

-- A ficha ganha `omie`. Definição de produção em 29/09 (pg_get_functiondef) com a chave e o join acrescentados.
CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select a.key, a.unidade_ids, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
   'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie)
 from ops.base_conta_estado a
 left join ops.base_conta_sinais(_keys) s on s.key = a.key
 left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
 where _keys is null or a.key=any(_keys)
$function$;

-- Leitura de hora em hora: cada execução faz as unidades mais antigas até o orçamento de tempo; a volta completa
-- (≈ 20 mil cadastros em 11 credenciais) fecha em uma ou duas execuções. Mesmo segredo dos outros sinais da base.
select cron.unschedule('omie-tags-sync-hora') where exists (select 1 from cron.job where jobname = 'omie-tags-sync-hora');
select cron.schedule('omie-tags-sync-hora', '23 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/omie-tags-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-planning-sinais-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'base_sinais_cron_secret')),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);
