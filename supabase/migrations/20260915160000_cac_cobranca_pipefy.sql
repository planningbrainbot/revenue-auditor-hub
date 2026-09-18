-- A Apuração de CAC passa a ser lista do pipe, não dos contratos (15/09/2026)
--
-- Até aqui a tela nascia dos contratos ganhos no Pipedrive: todo contrato de
-- unidade que paga CAC virava item, e o pipe Pipefy "[PTRS-CLI-03] Central de
-- Contratos" só respondia "já assinou?". Eram 117 itens, a maioria sem nenhuma
-- cobrança em andamento, e a decisão de cobrar vivia fora do sistema.
--
-- Agora quem manda é o pipe "Cobrança CAC Adiantado" (307316953), onde a
-- operação de fato trabalha: o card existe quando há cobrança a fazer, e a
-- fase dele diz o que já pode ser cobrado da unidade. Decisão do usuário em
-- 15/09/2026.
--
-- O valor NÃO vem do card (o pipe não tem campo de valor): segue saindo de
-- contratos.mrr_mensal, com as regras por unidade que já existiam.
--
-- `set search_path` em vez de prefixo fixo: no banco único as tabelas do Ops
-- vivem em `ops`, no projeto antigo em `public`, e o Postgres ignora em
-- silêncio schema que não existe. A mesma migration roda nos dois.
set search_path to ops, public;

create table if not exists cac_cobranca_cards (
  pipefy_card_id  text primary key,
  titulo          text,
  -- Campo "Cliente" do start form. Texto livre: é por ele que o card acha o
  -- contrato, já que o pipe não tem CNPJ nem Deal ID.
  cliente         text,
  -- Campo "Unidade de negócio", também texto livre ("Campo Novo", "Maceió").
  unidade         text,
  data_assinatura date,
  fase_id         text,
  fase_atual      text,
  criado_em       timestamptz,
  synced_at       timestamptz not null default now()
);

comment on table cac_cobranca_cards is
  'Cards do pipe Pipefy "Cobranca CAC Adiantado" (307316953). Fonte da lista da tela /unidades/cac. Sync: Edge Function pipefy-cac-cobranca-sync + botao Forcar atualizacao.';
comment on column cac_cobranca_cards.fase_atual is
  'Fase do card. Nova Cobranca e "Ainda nao Faturou" nao liberam cobranca; Cobrar 50% libera a parcela 1; Cobrar 100% e Cobranca Concluida liberam o total.';

alter table cac_cobranca_cards enable row level security;
grant select on cac_cobranca_cards to authenticated;
grant all    on cac_cobranca_cards to service_role;

-- Leitura segue a permissão da própria página, não has_role hardcoded.
drop policy if exists "cac_cobranca_cards_select" on cac_cobranca_cards;
create policy "cac_cobranca_cards_select" on cac_cobranca_cards
  for select to authenticated using ((select can('view.unidades_rede')));

-- Escrita é exclusiva do sync (service_role, que ignora RLS): ninguém edita
-- card do Pipefy por dentro do Ops.

-- ─────────────────────────────────────────────────────────────
-- O item da apuração guarda de qual card ele nasceu
-- ─────────────────────────────────────────────────────────────
-- Item que já existia continua o mesmo registro (com pagamento, vínculo de
-- royalties e histórico) — o card só se amarra nele. Sem esta coluna, card de
-- cliente sem contrato casado não teria como ser reencontrado na próxima
-- sincronização e viraria item duplicado a cada carregamento da tela.
alter table cac_apuracao_itens add column if not exists pipefy_card_id text;

create unique index if not exists cac_apuracao_itens_card_idx
  on cac_apuracao_itens (pipefy_card_id)
  where pipefy_card_id is not null;

comment on column cac_apuracao_itens.pipefy_card_id is
  'Card do pipe Cobranca CAC Adiantado que originou este item. Nulo = item antigo, de quando a lista nascia dos contratos.';
