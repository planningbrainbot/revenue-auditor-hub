# Cockpit do CEO — primeira fatia (piloto) Implementation Plan

> **Para quem executa:** plano executado inline, em sequência, sem fan-out, seguindo
> `superpowers:executing-plans` (lido da cópia local `../superpowers`, plugin NÃO carregado nesta
> sessão). Passos com checkbox (`- [ ]`). Ledger em `.superpowers/sdd/2026-09-22-cockpit-ceo-piloto/progress.md`.

**Goal:** Entregar um módulo "Cockpit do CEO" navegável e testado, com uma cadeia completa
pergunta → indicador → composição → tela de origem sobre Base e Monetização, filtros de período e
perímetro na URL, estados de disponibilidade honestos e Jev real encaminhando uma pergunta do CEO.

**Architecture:** Camada pura em `src/lib/cockpit-ceo/` (contrato do indicador, período, catálogo de
perguntas, agregações que reaproveitam `oferta/disponibilidade/estadoProduto/operacao/receitaSomada`),
alimentada por dois adaptadores: um real (`useMonetizacao` + `usePermissions`, somente leitura, sem
consulta nova ao banco) e um sintético identificado (preview). UI em `src/components/cockpit-ceo/`
com o design system existente (`Panel`, `Kpi`, `Sheet`, recharts). Jev fica atrás de um adaptador de
servidor (`*.server.ts`) com validação, timeout, sem retry, orçamento e ledger; só liga com
`COCKPIT_JEV_PILOTO=1` fora de produção, com chave lida do Keychain do macOS no servidor.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind 4, recharts, zod, `node --test` com
type stripping (Node 22), OpenRouter Decisions API (`typesafe/jev-1.13`).

**Spec:** `../briefing/PRD.md` (produto), `../briefing/missao-piloto.md` (método e limites),
instrução do usuário de 22/09 nesta sessão (substitui as instruções de inicialização do `start.py`).

## Global Constraints

- Meta: **R$ 1 bilhão de faturamento anual**. Não inventar ano-alvo; não confundir receita do grupo, faturamento da rede, receita Partners e volume transacionado; não é valuation.
- Snapshots dos documentos são históricos: nenhum número do briefing entra no código como valor do painel.
- `null` não vira zero; sem permissão não vira "nenhum"; erro não vira sucesso com cache antigo oculto.
- Estados: `disponivel`, `parcial`, `nao_apurado`, `fonte_indisponivel`, `acesso_insuficiente`.
- Duas ofertas da mesma conta não duplicam contas únicas. Rótulo declara negócio / evento / conta.
- Ganho no CRM ≠ recebimento; receita prevista do CRM é declaração, não faturamento; carteira atual ≠ histórico de coorte.
- Reaproveitar regras existentes (origem, Curitiba, elegibilidade por produto, sobreposição, eventos, forecast). Não redefinir nenhuma.
- Não reconstruir Base, Monetização, Growth ou Financeiro dentro do cockpit: o cockpit agrega, explica e aponta.
- Sem migration aplicada, sem mudança de auth/RLS/permissão, sem push/deploy/merge, sem CRM/e-mail, sem Supabase de produção.
- Dados sintéticos identificados como tal em tela e no código.
- Jev: `POST https://openrouter.ai/api/alpha/decisions`, modelo `typesafe/jev-1.13`; só textos fictícios; ≤ 10 requisições no piloto; sem retry automático; parar com US$ 0,10 de custo informado ou com custo ausente; chave nunca no navegador, código, log ou Git.
- Jev sugere; não decide fatos, cálculos, elegibilidade, permissões nem ações.
- Dependências: nenhuma nova. Imports relativos com extensão `.ts` na camada pura (roda em `node --test`).

## Review Focus

1. Pessoa sem `view.monetizacao` abre o cockpit → indicadores comerciais mostram "acesso insuficiente", nunca "0 negócios".
2. Carga do CRM falhou ou está velha → número marcado como parcial com a data do dado, não apresentado como atual.
3. Perímetro = uma unidade → negócio sem conta vinculada fica fora e a composição diz quantos ficaram de fora.
4. Período personalizado inválido ou maior que 3 anos na URL → cai no mês corrente com aviso, sem quebrar a página.
5. Jev indisponível, sem chave, sem orçamento ou com resposta fora da taxonomia → cockpit continua; o painel Jev mostra o erro e não mostra classificação.

---

### Task 1: Ambiente, baseline e inventário

**Files:**
- Create: `docs/dev_notes/cockpit-ceo-piloto/ambiente.md`
- Create: `docs/dev_notes/cockpit-ceo-piloto/inventario.md`

**Interfaces:** Produces: registro do ambiente real (não isolado), baseline (95/95 testes, 7 erros `tsc` preexistentes, build verde) e matriz pergunta → fonte → responsável → aceite que a Task 3 transforma em código.

- [ ] Step 1: Escrever `ambiente.md` com: sessão iniciada pelo chat (sem `start.py`), permissões e MCPs disponíveis, as 3 verificações (leitura/escrita fora, rede) e o fato de terem passado, restrições auto-impostas, contrato Jev conferido na documentação.
- [ ] Step 2: Escrever `inventario.md` com a matriz das perguntas (seis frentes + 11 exigências do mapa + trajetória R$ 1 bi) e serviços existentes reaproveitáveis.
- [ ] Step 3: Commit `docs(cockpit-ceo): ambiente real, baseline e inventário do piloto`.

Aceite: os dois arquivos existem, não contêm segredo nem dado nominal, e registram o que não foi comprovado.

### Task 2: Contrato do indicador e período

**Files:**
- Create: `src/lib/cockpit-ceo/contrato.ts`, `src/lib/cockpit-ceo/periodo.ts`
- Test: `tests/cockpit-ceo.test.mjs`

**Interfaces — Produces:**
- `type Frente = "receita"|"clientes"|"comercial"|"rede"|"retencao"|"capital"`; `FRENTES: Record<Frente,{titulo,perguntas:string}>`
- `type Estado = "disponivel"|"parcial"|"nao_apurado"|"fonte_indisponivel"|"acesso_insuficiente"`; `ESTADOS: Record<Estado,string>`
- `interface Indicador { id, versaoRegra, frente, pergunta, titulo, definicao, unidade, numerador?, denominador?, periodo: {de,ate}|null, perimetro, filtros: string[], fonte, dataDado: string|null, dataApuracao, estado, valor: number|null, comparacoes: Comparacao[], composicao: LinhaComposicao[], notaComposicao?, destino: Destino|null, lacuna: Lacuna|null, sintetico }`
- `formatarValor(i: Indicador): string` — `null` → `"—"`, nunca `"0"`.
- `somaDaComposicao(i): number|null` — soma das linhas `soma: true`; `null` se alguma for `null`.
- `resolverPeriodo(busca: {periodo?,de?,ate?}, hoje: string): Periodo & {aviso: string|null}`; presets `mes|mes_anterior|trimestre|ano|personalizado`.
- `periodoAnterior(p): {de,ate}` (mesma duração, imediatamente antes).
- `mesDoPeriodo(p): {mes: string, completo: boolean}|null` — só quando de/ate estão no mesmo mês e `de` é dia 1.
- `validarBusca(s: Record<string,unknown>): BuscaCockpit` — `{periodo, de, ate, perimetro, frente, indicador}` todos string.

Casos de teste (escritos antes da implementação):
- `mes` em 2026-09-22 → 2026-09-01..2026-09-22; `mes_anterior` → 2026-08-01..2026-08-31; `trimestre` → 2026-07-01..2026-09-22; `ano` → 2026-01-01..2026-09-22.
- `personalizado` válido mantém; inválido (`2026-02-30`, `de>ate`, >3 anos) → cai em `mes` com `aviso` não nulo.
- `periodoAnterior(2026-09-01..2026-09-22)` → 2026-08-10..2026-08-31 (22 dias).
- `mesDoPeriodo` de `mes` → `{mes:"2026-09", completo:false}`; de `mes_anterior` → `{mes:"2026-08", completo:true}`; de trimestre → `null`.
- `formatarValor` com `valor:null` → `"—"`; com `0` e `disponivel` → `"0"`.
- Nenhum preset fixa setembro: com `hoje=2027-03-05`, `mes` → 2027-03-01..2027-03-05.

- [ ] Step 1: escrever os testes; Step 2: rodar `node --test tests/cockpit-ceo.test.mjs` → FAIL (módulo inexistente); Step 3: implementar; Step 4: rodar → PASS; Step 5: commit `feat(cockpit-ceo): contrato do indicador e período`.

### Task 3: Catálogo de perguntas (matriz rastreável)

**Files:** Create `src/lib/cockpit-ceo/perguntas.ts`; Test `tests/cockpit-ceo.test.mjs`.

**Interfaces — Produces:** `interface PerguntaCatalogo { id, frente, texto, origem, fonte, responsavel, cobertura: Cobertura, aceite, indicadores: string[], roadmap: string[] }`; `type Cobertura = "verificada"|"implementada_nao_homologada"|"depende_dado"|"depende_decisao"`; `PERGUNTAS: PerguntaCatalogo[]`; `EXIGENCIAS_INVESTIDOR` (11).

Casos: todas as 11 exigências da p.25 aparecem em ao menos uma pergunta; existe a pergunta transversal "Qual é nossa trajetória para R$ 1 bi anual?" com `depende_decisao`; cada frente tem ≥1 pergunta; nenhuma pergunta está `verificada` (piloto sem homologação); todo `indicadores[]` referenciado existe no conjunto de ids produzido pela Task 4.

- [ ] Steps RED → GREEN → commit `feat(cockpit-ceo): catálogo de perguntas com fonte, responsável e aceite`.

### Task 4: Agregações de Base e Monetização

**Files:** Create `src/lib/cockpit-ceo/indicadores.ts`; Test `tests/cockpit-ceo.test.mjs`.

**Interfaces — Consumes:** Task 2. **Produces:**
- `interface FonteCockpit { sintetico: boolean; hoje: string; agora: string; monetizacao: { estado: "ok"|"erro"|"carregando"; erro: string|null; dados: BaseMonetizacao|null } }`
- `montarCockpit(fonte, recorte: {periodo, perimetro: string}): Cockpit` com `{ universo, perimetros, indicadores: Indicador[], decisoes: Decisao[], ameacas: Ameaca[], porProduto: LinhaProduto[], serieDiaria, avisos }`
- Ids: `meta-bilhao`, `contratos-ganhos`, `oportunidades-validadas`, `leads-trabalhados`, `receita-prevista-aberta`, `contas-prontas`.

Casos (fixtures mínimos nos testes):
- Conta apta a Consultoria e Finance e livre nas duas → `contas-prontas` = 1 conta única; composição por produto soma 2 e a linha de sobreposição diz 1.
- Negócio com evento `signed` dentro e outro fora do período → só o de dentro conta; composição por produto soma o total.
- `permissions.view = false` → `contratos-ganhos` com `acesso_insuficiente` e `valor null`; `contas-prontas` segue disponível.
- `monetizacao.estado = "erro"` → todos os indicadores da fonte com `fonte_indisponivel`, `valor null`.
- `sync_error` com `measured_at` → comerciais `parcial` e `dataDado = measured_at`.
- Perímetro de unidade → negócio cuja org não está em conta da unidade fica fora, e a nota diz quantos negócios sem conta vinculada ficaram de fora.
- Plano mensal: período `mes_anterior` completo com plano de 6 contratos → comparação "Meta do mês" 6; período `trimestre` → comparação de plano com estado `nao_apurado` e nota "plano é mensal".
- `meta-bilhao` sempre `nao_apurado`, `valor null`, lacuna com responsável "CEO + CFO".
- `receita-prevista-aberta`: negócio sem valor → estado `parcial` e composição mostra "sem valor declarado: N".
- Destino de `contratos-ganhos` = `/monetizacao?aba=operacao` com `mesmoRecorte=false` e observação sobre o filtro padrão do destino.
- Decisões ≤ 3, ameaças determinísticas (plano sem alocação, CRM parado, ritmo abaixo da meta, contas só no Omie).

- [ ] Steps RED → GREEN → commit `feat(cockpit-ceo): indicadores de Base e Monetização com composição`.

### Task 5: Fonte sintética e adaptador do Brain

**Files:** Create `src/lib/cockpit-ceo/fixture-sintetica.ts`, `src/lib/cockpit-ceo/adaptador-brain.ts`; Test `tests/cockpit-ceo.test.mjs`.

**Interfaces — Produces:** `baseSintetica(hoje: string): BaseMonetizacao` (determinística, nomes "Empresa Sintética NNN", unidades "Unidade Exemplo …"); `fonteSintetica(hoje, agora): FonteCockpit` (`sintetico: true`); `fonteDoBrain({data,error,isLoading}, hoje, agora): FonteCockpit`.

Casos: duas chamadas com o mesmo `hoje` geram o mesmo resultado; todo nome de conta começa com "Empresa Sintética"; `montarCockpit(fonteSintetica(...))` marca todos os indicadores `sintetico: true` e produz ao menos uma sobreposição de produtos; `fonteDoBrain` com erro → `estado:"erro"` e mensagem legível; carregando → `carregando`.

- [ ] Steps RED → GREEN → commit `feat(cockpit-ceo): fonte sintética identificada e adaptador somente leitura`.

### Task 6: Interface, rotas e navegação

**Files:**
- Create: `src/components/cockpit-ceo/{cockpit-ceo.tsx,indicador.tsx,composicao.tsx,frentes.tsx,estado.tsx}`
- Create: `src/routes/_authenticated/cockpit-ceo.tsx` (real), `src/routes/piloto.cockpit-ceo.tsx` (preview sintético, só dev/flag)
- Modify: `src/lib/areas.ts` (área `cockpit_ceo`)
- Create: `supabase/proposals/20260922120000_cockpit_ceo_area.sql` (NÃO aplicada)
- Regenerate: `src/routeTree.gen.ts` (pelo build)

Aceite: primeira dobra com cabeçalho do universo medido, filtros (período, perímetro) na URL, até 6 indicadores, até 3 decisões; abaixo: o que mudou, de onde vem o crescimento, ameaças, seis frentes com perguntas e cobertura; clique no número abre composição com definição, período, recorte, fonte, versão, datas e destino; rota real exige área `cockpit_ceo` e não dispara carga sem ela; preview retorna 404 fora de dev/flag. `tsc` sem erro novo; build verde.

- [ ] Steps: implementar → `npx tsc --noEmit` (7 erros, os mesmos) → build → commit `feat(cockpit-ceo): visão executiva, composição e navegação`.

### Task 7: Adaptador Jev (servidor), orçamento e ledger

**Files:** Create `src/lib/cockpit-ceo/jev/contrato.ts`, `src/lib/cockpit-ceo/jev/adaptador.server.ts`, `src/lib/cockpit-ceo/jev.functions.ts`; Test `tests/cockpit-ceo-jev.test.mjs`.

**Interfaces — Produces:** `JEV_ENDPOINT`, `JEV_MODELO`, `TAXONOMIA_VERSAO`; `PERGUNTAS_CEO_FICTICIAS`; `payloadRoteamento(id)`; `payloadTesteEmail()`; `validarResposta(raw, perguntas)`; `avaliarOrcamento(registros, limites)`; `decidirJev(payload, deps)`; `criarLedgerArquivo(caminho)`; `obterChaveKeychain()`; server fns `rotearPerguntaPiloto`, `statusJevPiloto`.

Casos (transporte simulado): payload tem `criteria` nas três primitivas, com `"true"`/`"false"` no `noul`; resposta com `choice` fora da taxonomia, `score` fora de 0..n−1, `noul` fora de 0..1 ou modelo não `typesafe/jev-` → erro `resposta_invalida`; custo ausente → `custoUsd: null` e a próxima chamada é bloqueada; 10 tentativas → 11ª bloqueada antes do transporte; custo acumulado ≥ 0,10 → bloqueio; timeout → erro `tempo_esgotado` com o transporte chamado uma vez (sem retry); HTTP 402 → `openrouter_http_402`; a chave não aparece no resultado nem no ledger; o ledger não contém o texto analisado; flag desligada → `desativado` sem ler chave.

- [ ] Steps RED → GREEN → commit `feat(cockpit-ceo): adaptador Jev de servidor com orçamento e ledger`.

### Task 8: Jev real e demonstração no preview

**Files:** Create `scripts/cockpit-ceo/jev-teste-real.ts`, `scripts/cockpit-ceo/preview.sh`, `src/components/cockpit-ceo/jev-roteador.tsx`; `docs/dev_notes/cockpit-ceo-piloto/jev-live-*.json`, `jev-chamadas.jsonl`.

Aceite: com a chave no Keychain, 1 chamada real do e-mail fictício com as três perguntas registrada (resposta, modelo, duração, custo do fornecedor ou "custo não informado"); no preview, a pergunta fictícia do CEO é encaminhada por Jev (sugestão marcada como IA) e leva à frente, onde o número vem do código. Sem chave: pendência explícita, nenhuma simulação de sucesso. Total ≤ 10 requisições.

### Task 9: Verificação visual, revisão e registro

**Files:** `docs/dev_notes/cockpit-ceo-piloto/{relatorio.md,capturas/*.png}`, `DECISIONS.md` (entrada nova).

Aceite: capturas da primeira dobra (1440×900), composição aberta, frente comercial com gráfico diário e retorno; suíte completa verde; `tsc` sem erro novo; build verde; revisão final da branch registrada no ledger; entrada no `DECISIONS.md`.
