-- Outras receitas da apuração em duas categorias, pedido de 16/10/2026:
--   ferramentas ... reembolso de ferramentas (Qculture Rocks, Pipedrive, Panda Pé, CEFIS)
--   servicos ...... serviços contratados pela unidade
--
-- Só classifica: royalties_apuracao.outras_receitas continua sendo a soma de
-- TODOS os itens, então a ND, o fechamento e o total da fatura não mudam.
-- Tudo o que já existe era ferramenta, e por isso é o padrão.

set search_path = ops, public;

alter table ops.royalties_outras_receitas_itens
  add column if not exists categoria text not null default 'ferramentas'
  check (categoria in ('ferramentas', 'servicos'));

comment on column ops.royalties_outras_receitas_itens.categoria is
  'ferramentas = reembolso de ferramentas; servicos = serviços contratados. '
  'As duas somam em royalties_apuracao.outras_receitas.';
