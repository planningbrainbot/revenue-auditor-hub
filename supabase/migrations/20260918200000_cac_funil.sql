-- Funil de CAC: da venda ganha até a cobrança concluída.
--
-- Por que existe: a conciliação de 18/09/2026 entre o BI de vendas e o pipe
-- "Cobrança CAC" (307316953) mostrou que ninguém no Ops enxergava o caminho
-- inteiro. O pipe sozinho diz o que já virou card; o contrato sozinho diz o que
-- foi assinado; a venda sozinha diz o que foi ganho. O buraco vive entre eles.
--
-- Regra que a view materializa: contrato assinado em unidade que cobra CAC tem
-- que ter card de cobrança. O degrau "assinado sem card" é, por definição, uma
-- falha operacional, e por isso a elegibilidade precisa estar certa: sem
-- `cac_desde`, São Bernardo (que não cobra) e as vendas de Patos anteriores a
-- agosto/2026 apareciam como buraco, e o número acusava 15 falhas onde há 3.

-- São Bernardo, Recife e Sorocaba cobram CAC (confirmado pelo usuário em
-- 18/09/2026); o cadastro dizia que não.
update ops.unidades set paga_cac = true
 where nome_da_praca in ('São Bernardo', 'Recife', 'Sorocaba');

alter table ops.unidades add column if not exists cac_desde date;
comment on column ops.unidades.cac_desde is
  'Data a partir da qual a venda da unidade gera CAC devido à matriz. Nulo = a unidade não cobra CAC. Patos de Minas entra em 01/08/2026, por decisão de 16/09/2026, junto com a verba de mídia que ele paga.';

update ops.unidades set cac_desde = date '2026-02-01'
 where paga_cac and nome_da_praca in ('Campo Novo', 'Fortaleza', 'São Luis', 'Maceió')
   and cac_desde is null;
update ops.unidades set cac_desde = date '2026-08-01'
 where nome_da_praca = 'Patos de Minas' and cac_desde is null;
update ops.unidades set cac_desde = date '2026-02-01'
 where nome_da_praca in ('São Bernardo', 'Recife', 'Sorocaba') and cac_desde is null;

-- Piso por unidade: Patos de Minas só paga CAC quando o honorário mensal passa
-- de R$ 10.000 (regra do usuário em 18/09/2026, medida no mensal e não no
-- contrato inteiro). Com esse corte, nenhuma das 11 vendas de Patos no recorte
-- gera CAC: a maior é DOM LOGISTICS, com R$ 7.500 por mês.
alter table ops.unidades add column if not exists cac_honorario_minimo_mensal numeric;
comment on column ops.unidades.cac_honorario_minimo_mensal is
  'Honorário mensal mínimo para a venda gerar CAC nessa unidade. Nulo = sem piso. Patos de Minas: R$ 10.000/mês.';
update ops.unidades set cac_honorario_minimo_mensal = 10000
 where nome_da_praca = 'Patos de Minas' and cac_honorario_minimo_mensal is null;

-- Venda que o Ops registra mas que não existe como contrato para efeito de CAC:
-- deal ganho no Pipedrive que nunca virou contrato, venda avulsa, duplicidade.
create table if not exists ops.cac_funil_ignorados (
  contrato_id bigint primary key references ops.contratos(id) on delete cascade,
  motivo text not null,
  criado_em timestamptz not null default now()
);
alter table ops.cac_funil_ignorados enable row level security;
drop policy if exists cac_funil_ignorados_leitura on ops.cac_funil_ignorados;
create policy cac_funil_ignorados_leitura on ops.cac_funil_ignorados
  for select to authenticated using (ops.can('view.unidades_rede'));
drop policy if exists cac_funil_ignorados_escrita on ops.cac_funil_ignorados;
create policy cac_funil_ignorados_escrita on ops.cac_funil_ignorados
  for all to authenticated using (ops.can('manage.broker')) with check (ops.can('manage.broker'));
grant select on ops.cac_funil_ignorados to authenticated;

insert into ops.cac_funil_ignorados (contrato_id, motivo) values
  (23219, 'Deal 90577 no Pipedrive (Assessoria DOC, R$ 3.000 avulso) nunca virou contrato. Decisão do usuário em 18/09/2026.')
on conflict (contrato_id) do update set motivo = excluded.motivo;

-- Grupo Andrade Bezerra é Fortaleza, confirmado pelo usuário em 18/09/2026. O
-- Pipedrive (deal 61648) já dizia Fortaleza; quem estava velho era o Ops, sinal
-- de que a unidade não é reprocessada depois do primeiro sync do contrato.
update ops.contratos set unidade = 'Fortaleza' where id = 20703 and unidade <> 'Fortaleza';

create or replace function ops.cac_unidade_chave(t text)
returns text language sql immutable as $$
  -- O pipe escreve "São Bernardo do Campo" e a tabela unidades guarda
  -- "São Bernardo". Sem isso a unidade fica de fora do próprio funil.
  select replace(ops.cac_nome_chave(t), ' do campo', '')
$$;

drop view if exists ops.v_cac_funil_resumo;
drop view if exists ops.v_cac_funil;

create view ops.v_cac_funil as
with un as (
  select u.id as unidade_id, u.nome_da_praca as unidade, u.paga_cac, u.cac_desde,
         u.cac_honorario_minimo_mensal as piso,
         ops.cac_unidade_chave(u.nome_da_praca) as chave
  from ops.unidades u
  where u.paga_cac
     or exists (select 1 from ops.cac_cobranca_cards c
                where ops.cac_unidade_chave(c.unidade) = ops.cac_unidade_chave(u.nome_da_praca))
),
vendas as (
  -- Venda de sócio (pipeline 4) não gera CAC: só a máquina de growth gera.
  select c.id as contrato_id, c.titulo as cliente, c.ganho_em, c.mrr_mensal,
         c.valor_total, c.status_contrato, c.pipedrive_deal_id,
         ops.cac_unidade_chave(c.unidade) as chave_un,
         ops.cac_nome_chave(c.titulo) as chave_cli
  from ops.contratos c
  where c.origem_pipeline = 'inside_sales' and c.ganho_em >= date '2026-02-01'
    and not exists (select 1 from ops.cac_funil_ignorados ig where ig.contrato_id = c.id)
),
base as (
  select un.unidade_id, un.unidade, un.paga_cac, un.cac_desde, un.piso,
         v.contrato_id, v.cliente, v.ganho_em, v.mrr_mensal, v.valor_total, v.status_contrato,
         d.fase_atual as fase_contrato, d.data_assinatura,
         k.pipefy_card_id as cac_card_id, k.fase_atual as fase_cac,
         k.unidade as unidade_card,
         -- O dinheiro fica com a unidade DO CARD. Quando o card está em outra
         -- unidade, esta linha só aponta o erro de cadastro; o valor aparece na
         -- unidade do card, como card sem venda. Sem isso, Grupo Andrade
         -- Bezerra (card em Fortaleza, contrato em Maceió, decidido em 18/09
         -- como venda de Fortaleza) migrava R$ 4.000 de unidade sozinho.
         (case when ops.cac_unidade_chave(k.unidade) = v.chave_un
               then k.valor_1_honorario end)::numeric(12,2) as honorario,
         (case when ops.cac_unidade_chave(k.unidade) = v.chave_un
               then coalesce(k.valor_cobrado_p1, 0) + coalesce(k.valor_cobrado_p2, 0)
               else 0 end)::numeric(12,2) as cobrado,
         k.data_cobranca_p1, k.data_cobranca_p2,
         -- Elegível = a unidade cobra, a venda é posterior ao início da
         -- cobrança nela, e o honorário mensal passa do piso que ela negociou.
         -- Vale o honorário do card quando existe; sem card, o mensal da venda.
         (un.cac_desde is not null
          and v.ganho_em >= un.cac_desde
          and (un.piso is null
               or coalesce(k.valor_1_honorario, v.mrr_mensal, 0) >= un.piso)) as elegivel
  from vendas v
  join un on un.chave = v.chave_un
  left join lateral (
    -- Um deal pode ter mais de um card na Central de Contratos (reenvio,
    -- aditivo). Vale o mais avançado, não o mais recente. O cruzamento é por
    -- `pipedrive_deal_id` e nunca por `cliente`: essa coluna vem com a string
    -- `undefined` em 80 dos 460 cards, defeito de pipefy-contratos-sync.
    select cd.fase_atual, cd.data_assinatura
    from ops.contratos_documentos cd
    where cd.pipedrive_deal_id = v.pipedrive_deal_id
    order by case cd.fase_atual
               when 'Churn no Contrato' then 6 when 'Retroativo' then 5
               when 'Enviar para Onboarding' then 4 when 'Contrato Assinado' then 3
               when 'Contrato Enviado' then 2 when 'Alterações no contrato' then 1
               else 0 end desc, cd.created_at desc
    limit 1) d on true
  left join lateral (
    -- Primeiro na própria unidade. Não achando, procura o mesmo cliente em
    -- qualquer unidade: card aberto na unidade errada é erro de cadastro, não
    -- venda sem cobrança, e sumiria do radar se a busca parasse na unidade.
    select cc.* from ops.cac_cobranca_cards cc
    where ops.cac_nome_chave(coalesce(cc.cliente, cc.titulo)) = v.chave_cli
    order by (ops.cac_unidade_chave(cc.unidade) = v.chave_un) desc, cc.criado_em desc
    limit 1) k on true
  union all
  -- Cards no pipe que nenhuma venda da própria unidade reivindica. Sem isto o
  -- funil esconderia justamente o card órfão, que é onde mora o erro.
  select un.unidade_id, un.unidade, un.paga_cac, un.cac_desde, un.piso,
         null::bigint, cc.titulo, null::date, null::numeric, null::numeric, null::text,
         null::text, cc.data_assinatura,
         cc.pipefy_card_id, cc.fase_atual, cc.unidade,
         cc.valor_1_honorario::numeric(12,2),
         (coalesce(cc.valor_cobrado_p1, 0) + coalesce(cc.valor_cobrado_p2, 0))::numeric(12,2),
         cc.data_cobranca_p1, cc.data_cobranca_p2,
         un.paga_cac
  from ops.cac_cobranca_cards cc
  join un on un.chave = ops.cac_unidade_chave(cc.unidade)
  where not exists (select 1 from vendas v
                    where v.chave_un = ops.cac_unidade_chave(cc.unidade)
                      and v.chave_cli = ops.cac_nome_chave(coalesce(cc.cliente, cc.titulo)))
)
select b.*,
  (b.fase_contrato in ('Contrato Assinado', 'Enviar para Onboarding', 'Retroativo', 'Churn no Contrato')
   or b.data_assinatura is not null) as assinado,
  -- Churn antes do 1º fee: cliente que saiu sem nunca pagar o honorário que
  -- sustenta o CAC. Os dois pipes marcam, nem sempre os dois juntos: Bender
  -- Industrial está em "Churn no Contrato" e nunca teve card de cobrança.
  -- `contratos.status_contrato` não serve: os cinco churns de 18/09/2026
  -- estavam todos como 'Ativo'.
  (b.fase_cac = 'Churn antes do 1º Fee' or b.fase_contrato = 'Churn no Contrato') as churn,
  case
    when b.fase_cac = 'Churn antes do 1º Fee' and b.fase_contrato = 'Churn no Contrato' then 'cobranca e contrato'
    when b.fase_cac = 'Churn antes do 1º Fee' then 'pipe de cobranca'
    when b.fase_contrato = 'Churn no Contrato' then 'Central de Contratos'
  end as churn_origem,
  case
    when b.contrato_id is null then 'card_sem_venda'
    when b.cac_card_id is not null and ops.cac_unidade_chave(b.unidade_card) <> ops.cac_unidade_chave(b.unidade) then 'card_em_outra_unidade'
    -- Churn vem antes do gate: cliente que saiu não precisava de cobrança
    -- aberta, e contá-lo como falha operacional é acusar o time de algo que
    -- não aconteceu (Bender Industrial, Fortaleza, 18/09/2026).
    when b.cac_card_id is null and (b.fase_cac = 'Churn antes do 1º Fee' or b.fase_contrato = 'Churn no Contrato') then 'churn_sem_cobranca'
    when not b.elegivel and b.cac_card_id is null then 'fora_da_regua'
    when b.cac_card_id is null and b.fase_contrato in ('Contrato Assinado', 'Enviar para Onboarding', 'Retroativo', 'Churn no Contrato') then 'assinado_sem_card'
    when b.cac_card_id is null and b.fase_contrato is not null then 'contrato_em_andamento'
    when b.cac_card_id is null then 'sem_contrato'
    when coalesce(b.honorario, 0) = 0 then 'card_sem_honorario'
    when b.cobrado = 0 then 'card_sem_cobranca'
    when b.cobrado < b.honorario - 0.5 then 'cobranca_parcial'
    else 'cobranca_concluida'
  end as etapa,
  greatest(coalesce(b.honorario, 0) - b.cobrado, 0)::numeric(12,2) as a_cobrar
from base b
where ops.can('view.unidades_rede')
  and (ops.can('view.broker_admin') or b.unidade_id in (select ops.minhas_unidades()));

comment on view ops.v_cac_funil is
  'Uma linha por venda de inside sales elegível a CAC, com fase do contrato, card de cobrança, churn, elegibilidade e etapa do funil. Inclui cards órfãos e card aberto na unidade errada.';

create view ops.v_cac_funil_resumo as
select unidade_id, unidade, paga_cac, cac_desde, piso as cac_honorario_minimo_mensal,
  count(*) filter (where contrato_id is not null) as vendas,
  count(*) filter (where contrato_id is not null and elegivel) as elegiveis,
  count(*) filter (where etapa = 'fora_da_regua') as fora_da_regua,
  count(*) filter (where assinado and elegivel) as assinadas,
  count(*) filter (where cac_card_id is not null and contrato_id is not null
                     and etapa <> 'card_em_outra_unidade') as com_card,
  count(*) filter (where etapa = 'assinado_sem_card') as assinadas_sem_card,
  count(*) filter (where etapa = 'card_em_outra_unidade') as card_em_outra_unidade,
  count(*) filter (where etapa = 'card_sem_honorario') as sem_honorario,
  count(*) filter (where etapa = 'card_sem_cobranca') as sem_cobranca,
  count(*) filter (where etapa = 'cobranca_parcial') as parciais,
  count(*) filter (where etapa = 'cobranca_concluida') as concluidas,
  count(*) filter (where etapa = 'card_sem_venda') as cards_orfaos,
  count(*) filter (where churn) as churns,
  count(*) filter (where etapa = 'churn_sem_cobranca') as churn_sem_cobranca,
  -- Churn sai do "falta receber" na leitura da tela: cliente que saiu antes do
  -- 1º fee não paga CAC. Fortaleza tinha R$ 16.350 de churn dentro dos
  -- R$ 62.053 "a cobrar", prometendo à matriz dinheiro que não vem.
  coalesce(sum(cobrado) filter (where churn), 0)::numeric(12,2) as churn_cobrado,
  coalesce(sum(a_cobrar) filter (where churn), 0)::numeric(12,2) as churn_a_cobrar,
  coalesce(sum(honorario), 0)::numeric(12,2) as honorario,
  coalesce(sum(cobrado), 0)::numeric(12,2) as cobrado,
  coalesce(sum(a_cobrar), 0)::numeric(12,2) as a_cobrar
from ops.v_cac_funil
group by unidade_id, unidade, paga_cac, cac_desde, piso;

comment on view ops.v_cac_funil_resumo is
  'Resumo do funil de CAC por unidade: elegibilidade, contagem por etapa, churn e o que falta cobrar.';

grant select on ops.v_cac_funil, ops.v_cac_funil_resumo to authenticated;
