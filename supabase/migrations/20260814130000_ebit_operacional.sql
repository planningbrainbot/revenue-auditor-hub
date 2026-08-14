-- Nova página "/ebit-operacional" — acompanha a meta de zerar o custo
-- operacional do time via venda de serviços internos para as unidades
-- (RH, CS, Compliance etc). Duas fontes:
--
--  - vendas_servicos_unidades: pipe Pipefy "[PTRS-UNI-06] Vendas de Serviços
--    para Unidades" (id 307297295). Campos "Valor no teto da rampa" e
--    "Gatilho do reajuste" foram criados no pipe em 14/08/2026 pra capturar
--    de forma estruturada as rampas de valor que antes só existiam como
--    texto livre no campo "Negociação" (ex: "PTM 2k (6 meses) -> 3k").
--    Sincronizado via Edge Function pipefy-vendas-servicos-sync (pg_cron
--    15min) + botão de forçar atualização, mesmo padrão de painel-cs.
--
--  - custo_operacional_mensal: aba "Controle de Gastos Geral" da planilha
--    Google Sheets (id 1waLaMOUCF3l8eOkRKJ6er2jvYe5Oc28d64HL324ca10),
--    linhas com Departamento = Operação. Sincronizado via Edge Function
--    custo-operacional-sync (pg_cron diário). Ver DATA-RULES.md 14/08/2026
--    sobre o conflito encontrado na linha "Total" do topo da aba (~4x maior
--    que a soma dos itens) — usamos a soma dos itens individuais, decisão
--    confirmada com o usuário, não a linha Total.

CREATE TABLE public.vendas_servicos_unidades (
  pipefy_card_id text PRIMARY KEY,
  titulo text,
  solucao text,
  unidade text,
  fase_atual text,
  venda_feita boolean,
  reuniao_aconteceu boolean,
  valor_mensal_1_mes numeric,
  valor_teto_rampa numeric,
  gatilho_reajuste text,
  negociacao text,
  data_reuniao date,
  criado_em timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendas_servicos_unidades ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vendas_servicos_unidades TO authenticated;
GRANT ALL ON public.vendas_servicos_unidades TO service_role;

CREATE POLICY "Permission-based read" ON public.vendas_servicos_unidades
  FOR SELECT TO authenticated
  USING (public.can('view.ebit_operacional'));

CREATE TABLE public.custo_operacional_mensal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  despesa text NOT NULL,
  categoria text,
  tipo text,
  cobranca text,
  mes date NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (despesa, categoria, mes)
);

ALTER TABLE public.custo_operacional_mensal ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.custo_operacional_mensal TO authenticated;
GRANT ALL ON public.custo_operacional_mensal TO service_role;

CREATE POLICY "Permission-based read" ON public.custo_operacional_mensal
  FOR SELECT TO authenticated
  USING (public.can('view.ebit_operacional'));

-- Chave própria desde o início, seguindo feedback_new_page_permissions —
-- liberada por padrão pra admin e diretor; demais papéis ficam de fora até
-- um admin liberar manualmente em /admin/permissoes.
INSERT INTO public.role_permissions (role, permission_key, allowed) VALUES
  ('admin','view.ebit_operacional', true),
  ('diretor','view.ebit_operacional', true)
ON CONFLICT (role, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed;
