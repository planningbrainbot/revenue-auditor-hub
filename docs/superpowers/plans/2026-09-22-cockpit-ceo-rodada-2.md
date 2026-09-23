# Cockpit do CEO — rodada 2 (lotes 1, 3–7) Implementation Plan

> Execução inline e sequencial (`superpowers:executing-plans`, lido de `../superpowers`; plugin não
> carregado). Ledger: `.superpowers/sdd/2026-09-22-cockpit-ceo-rodada-2/progress.md`.

**Goal:** Homologar a primeira fatia com dado real e levar o cockpit às frentes de receita, trajetória
para R$ 1 bi em 2030, clientes ativos, retenção, rede e evidências, além de avaliar o Jev com casos
rotulados. Fica de fora a integração com a main.

**Architecture:** Mesmo padrão da rodada 1: funções puras em `src/lib/cockpit-ceo/`, cada fonte nova
com estado de disponibilidade próprio, fonte sintética para o preview e fonte real via server
function com a sessão da pessoa (RLS da casa). A homologação lê o banco único em modo somente
leitura (`scripts/cockpit-ceo/brain-ro.mjs`) e roda o MESMO código TS sobre o dado real, com
conferências independentes em SQL. Só agregados saem para arquivo.

**Spec:** `../briefing/PRD.md`, `../briefing/missao-piloto.md` e as decisões do dono em 22/09 (nesta
sessão): leitura read-only autorizada; área `cockpit_ceo` só para super admin autorizada; perímetro
do bilhão = mostrar candidatos e decidir depois; **ano-alvo 2030**; Jev com a chave atual até 50
chamadas na avaliação.

## Global Constraints

- Nada escrito em produção além da área `cockpit_ceo` (papel `admin`). Nenhuma migration de dado,
  função ou RLS. Sem push, deploy, merge, CRM, e-mail.
- Leitura: papel de leitura da Management API; `begin transaction read only` só onde ele não alcança.
- Nenhum nome, CNPJ, contato ou texto de cliente em arquivo do repositório ou em log.
- Perímetro do bilhão não decidido: mostrar leituras candidatas lado a lado, sem gap escolhido.
  Não somar grupo e rede (royalties aparecem nos dois).
- Ano-alvo 2030: meta = R$ 1 bi de faturamento no ano civil de 2030.
- "Cliente ativo" não decidido: mostrar definições candidatas lado a lado, com sobreposição.
- Coorte exige denominador fixo e evento de saída registrado; ausência de histórico não vira retenção.
- Jev: avaliação em ledger próprio, teto 50 requisições e US$ 0,10, sem retry, só texto fictício.

## Review Focus

1. Pessoa sem acesso ao Financeiro abre a frente Receita → "acesso insuficiente", nunca R$ 0.
2. Unidade sem Omie no funil → aparece como sem cobertura, não como faturamento zero.
3. Série mensal com mês em andamento → mês parcial marcado; nunca entra no cálculo de 12 meses.
4. Cliente com dois CNPJs ou duas definições → contado uma vez por definição; sobreposição explícita.
5. Coorte recente (menos meses observados) → célula vazia, não 0% nem 100%.

---

### Task 1: Homologação dos seis indicadores com dado real
Carga real read-only replicando `carregarMonetizacao` + `base_carteira_pagina` (sem a checagem de
sessão), `montarCockpit` sobre ela, conferências independentes em SQL: eventos por métrica e produto
no período, receita prevista aberta, e paridade de elegibilidade TS × `ops.monetizacao_offer_issue`.
Tempos de cada consulta e do cálculo. Saída agregada em `docs/dev_notes/cockpit-ceo-piloto/homologacao/`.
**Aceite:** divergência zero em eventos e receita; paridade de elegibilidade explicada conta a conta
em agregado; tempos registrados.

### Task 2: Permissões com perfis reais
Com JWT simulado dentro de transação read-only: super admin, sócio regional, pessoa sem papel.
Contagens visíveis de negócios e contas e o estado que o cockpit mostraria.
**Aceite:** o estado previsto bate com o que a RLS entrega para cada perfil.

### Task 3: Área `cockpit_ceo` aplicada e app local ligado à produção
Migration aplicada só com `admin`, verificada; `supabase/proposals` → `supabase/migrations`;
`scripts/cockpit-ceo/local-producao.sh` com URL e chave pública do projeto (não secretas) em
`.env.local` (ignorado pelo Git); boot conferido.
**Aceite:** `ops.acesso_do_usuario` devolve a área para admin e não para os demais papéis.

### Task 4: Receita e trajetória para R$ 1 bi em 2030 (lotes 3 e 4)
`receita.ts` (puro): séries mensais por leitura candidata (grupo pela DRE do Brain Financeiro, com as
eliminações cadastradas aplicadas quando reproduzíveis; rede pelo `v_funil_mensal`; matriz pela DRE
Partners), 12 meses fechados, mês parcial marcado, cobertura, crescimento anual necessário até 2030.
Server function com a sessão da pessoa; fonte sintética; frente Receita com gráfico e tabela.
**Aceite:** números da homologação batem com SQL independente; sem acesso ao Financeiro → acesso
insuficiente; nenhum gap único calculado.

### Task 5: Clientes ativos e penetração (lote 5)
Definições candidatas (contrato de serviço ativo no Omie; recebeu em 90 dias; `qb_clientes_ativos`;
MRR > 0 na cascata) por CNPJ distinto, com sobreposição; penetração por produto de Monetização como
"contratado no CRM" sobre cada denominador.
**Aceite:** contagens batem com SQL; rótulos dizem a definição.

### Task 6: Retenção, rede e evidências (lote 6)
Coortes de logo por mês de ganho (contrato) com churn do pipe de Tratativas; rede por unidade
(faturado, recebido, royalties, concentração); satisfação dos sócios como fonte existente sem dado se
vazia; exportação da matriz de evidências.
**Aceite:** coorte com denominador fixo e células futuras vazias; concentração soma 100%.

### Task 7: Avaliação rotulada do Jev (lote 7)
40 casos fictícios em português (claros, ambíguos, contraditórios, fora de escopo), rótulos do autor,
baseline por palavras-chave, até 50 chamadas; acerto por classe, confusão, calibração da confiança,
p50/p95, custo por mil.
**Aceite:** ledger próprio dentro do teto; relatório com parecer.

### Task 8: Revisão, verificação e registro
Suíte, tsc, build, CDP, revisão final independente, DECISIONS.md, relatório da rodada.
