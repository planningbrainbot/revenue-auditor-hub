# Cockpit do CEO — relatório da rodada 2 (22–23/09/2026)

Continuação do piloto na cópia isolada (`planning-brain-cockpit-piloto-20260922/app`, branch
`feat/cockpit-ceo-piloto`, sem remote). Escopo pedido: lotes 1, 3, 4, 5, 6 e 7 — tudo menos a
integração com a main. Decisões do dono nesta sessão: leitura somente leitura da produção; área
`cockpit_ceo` só para `admin`; perímetro da meta = candidatos lado a lado; **ano-alvo 2030**; Jev
com a chave atual, até 50 chamadas.

**Escrito em produção:** só a área `cockpit_ceo` para o papel `admin`
(`supabase/migrations/20260922220000_cockpit_ceo_area.sql`, rollback em `supabase/rollback/`). Todo
o resto foi leitura: Management API com papel de leitura, ou `begin transaction read only` onde ele
não alcança. Sem push, deploy, merge, CRM, e-mail ou automação.

## 1. Como abrir

```bash
cd "PM Work/execution/planning-brain-cockpit-piloto-20260922/app"
./scripts/cockpit-ceo/preview.sh            # sintético, sem login: http://127.0.0.1:8080/piloto/cockpit-ceo
./scripts/cockpit-ceo/local-producao.sh     # app local lendo produção com a SUA sessão: http://127.0.0.1:8081/cockpit-ceo
```

O segundo exige login de super admin (a área só existe para `admin`) e usa só URL e chave pública do
projeto, em `.env.producao.local` (fora do Git). Jev fica desligado nele.

## 2. O que mudou na tela

| Frente | Novo | Régua |
|---|---|---|
| Receita | Trajetória para R$ 1 bi em 2030, duas leituras lado a lado | Grupo: Faturamento do Brain Financeiro. Rede: apuração de royalties confirmada |
| Clientes | Quatro definições de cliente ativo, sobreposição, penetração por produto | CNPJ distinto; penetração = ganho no CRM |
| Rede | Faturamento, royalties + CSC, participação e concentração por unidade | Janela de meses completos da apuração |
| Retenção | Coortes de logo por mês de ganho | Contratos de venda × churn datado da Central de Tratativas |
| Capital | Exportação CSV da matriz de evidências | Catálogo + estados, sem dado de cliente |

Cada painel diz a própria cobertura. Nada é somado entre réguas, e nenhuma lacuna vira zero: mês em
andamento, mês parcial na fonte, mês antes do registro de churn e acesso insuficiente aparecem vazios
ou com o estado, nunca como 0 ou 100%.

## 3. Números com dado real (lidos em 22/09, super admin simulado)

Todos conferidos com SQL independente, mês a mês ou célula a célula — tudo confere.

**Faturamento do grupo** (Faturamento do Financeiro): jan–jul/2026 fechados, média **R$ 5,83 mi/mês**.
Para R$ 83,3 mi/mês em 2030 é preciso **14,3×**. Agosto está marcado parcial pela própria fonte
(a cobertura do Financeiro ainda o chama de "mês em curso"). Não há 12 meses: o histórico começa em
jan/2026, então o crescimento anual necessário não é calculado. O Financeiro declara ausências:
PARTNERS em zero desde julho (sem chave do Omie), AGRO fora por credencial revogada. Finance e
Negócios Estruturados ficam fora por padrão da tela (R$ 1,72 mi no período lido, declarado).

> A soma crua de `financeiro.lancamentos` dá ~2× isso (planilha e Omie guardados em paralelo). O
> ~R$ 11,9 mi/mês que circulou antes nesta sessão estava errado por esse motivo.

**Faturamento da rede** (apuração confirmada): jun–ago/2026, média **R$ 1,40 mi/mês** (59,7×).
12/2025, 04 e 05/2026 são parciais (unidade inaugurada sem apuração). Concentração na janela: maior
unidade **43,3%**, três maiores **73,0%**, HHI **0,26**. Royalties + CSC sobre o faturamento variam
de 6,7% a 62% — nas unidades pequenas o CSC fixo domina.

**Clientes ativos** (CNPJ distinto): contrato no Omie **566** · pagou em 90 dias **560** · cadastro
(`qb_clientes_ativos`) **650** · MRR > 0 **546**. Em pelo menos uma: **797**; em todas: **412**.
O cadastro tem 555 empresas sem CNPJ e o MRR tem 491 — por isso essas duas definições aparecem
parciais. Penetração ganha no CRM ≈ 0: o pipe de Monetização tem 2 negócios ganhos.

**Retenção** (15 coortes fechadas, 06/2025–08/2026; churn datado desde 06/2025): 06/2025 — 11 ganhos,
**45% no M12**; 09/2025 — 10 ganhos, 70% no M11; 10/2025 — 8 ganhos, 62% no M8; 01/2026 — 14 ganhos,
71% no M2; 02/2026 — 18 ganhos, 83% no M6. Fora da coorte e declarados: 119 contratos do lote
`socios` e 338 de fora da rede (Matriz, sem unidade, unidades internas — conferido: nenhum contrato de
unidade regional ficou de fora por grafia). Só 29 churns têm data: o registro é recente e
provavelmente incompleto, então essas retenções são teto, não piso.

**Satisfação dos sócios:** a pesquisa do comitê tem 8 respostas (última em 10/09), mas só uma policy
de INSERT público. Nenhum papel lê pelo app; o cockpit mostra "sem leitura".

## 4. Permissões (homologadas com JWT simulado)

- Área `cockpit_ceo` aplicada e conferida: `acesso_do_usuario` devolve a área para admin e não para
  sócio regional nem conta sem papel.
- Leitura do grupo: exige `tem_produto('financeiro')` **e** todas as empresas; sem isso, "acesso
  insuficiente". Conferido: o sócio regional sem Financeiro fica fora.
- Rede, clientes ativos e coortes: exigem todas as unidades **e** passar na porta de cada fonte
  (`portas.ts`, espelho das policies de SELECT). Sem a porta, "acesso insuficiente" — nunca 0.
  Conferido contra a RLS real em 8 perfis (super admin, diretor, financeiro, cs, hunter_monetizacao,
  auditor, sócio regional, conta sem papel): onde a porta abre, a RLS entrega a tabela inteira. O
  papel `financeiro` era o caso-problema: a RLS lhe dá 0 de 1.784 contratos do Omie, e antes da
  correção o cockpit mostraria "0 clientes".
- Onde a porta é mais estrita que a RLS (papéis customizados), sai "acesso insuficiente" a mais —
  conservador e declarado.
- CNPJs das definições vão à tela só para quem tem as chaves da Base; coortes chegam agregadas; o
  cache da tela é por usuário.

## 5. Lacunas de acesso encontradas (não corrigidas — decisão de quem é dono)

1. **Financeiro:** as 63 funções SECURITY DEFINER do schema `financeiro` são executáveis por qualquer
   usuário autenticado, e nenhuma confere acesso no corpo. Um sócio regional sem Financeiro recebe a
   série de faturamento e linha por cliente de `fn_faturamento_mensal`, enquanto a RLS da tabela lhe
   dá 0 lançamentos. Sugestão: guarda `tem_produto('financeiro')` + escopo no início das funções, ou
   revogar EXECUTE de `authenticated`.
2. **`ops.qb_clientes_ativos`** roda como dono da view: um sócio regional com escopo por unidade vê
   1.236 empresas de 18 unidades por ela, contra 304 pela RLS. Sugestão: `security_invoker = true`,
   depois de ver quem depende dela.

## 6. Jev — avaliação rotulada

40 perguntas fictícias, rótulos congelados em commit antes da primeira chamada (`e599210`), ledger
próprio (`jev-avaliacao.jsonl`), teto 50 requisições / US$ 0,10, sem retry.

| | Jev | Palavras-chave |
|---|---|---|
| Geral | **95%** (38/40) | 72,5% |
| Claras (16) | 15 | 13 |
| Ambíguas (10) | 9 | 5 |
| Contraditórias (6) | 6 | 4 |
| Fora de escopo (8) | 8 | 7 |

Os dois erros vieram com confiança < 0,5 (royalties por unidade → "fora de escopo"; "quem puxa a
meta" → "insuficiente"). Acima de 0,5: 33/33. Regra sugerida: abaixo de 0,5, não encaminhar sozinho —
mostrar as opções. `pede_dado`: 14/17 (os três erros são rótulos discutíveis). Latência p50 321 ms,
p95 391 ms. Custo total US$ 0,00115 (US$ 0,029 por mil). Usadas 40 de 50 requisições.

## 7. Verificações

- Testes: 187/187 (`node --test tests/*.test.mjs`).
- `tsc --noEmit`: só os 7 erros preexistentes, nenhum no cockpit.
- Build de produção: ok; nenhuma chave no artefato.
- CDP no preview: 23/23 (seis frentes, nenhuma requisição fora de 127.0.0.1 além da fonte do Google,
  nenhuma exceção).
- Homologação com dado real: `docs/dev_notes/cockpit-ceo-piloto/homologacao/` — `resultado-*`
  (primeira fatia), `perfis-*` (porta × RLS), `receita-*`, `clientes-*`, `rede-retencao-*`. Só
  agregados; unidades pela posição.
- Revisão independente somente leitura: ver seção 9.

## 8. Decisões que continuam com você

1. Perímetro da meta (grupo, rede ou outro) — sem ele não há gap.
2. Qual definição de cliente ativo vale em cada contexto.
3. As duas lacunas de acesso da seção 5 (donos: Financeiro e Ops).
4. Quem lê a pesquisa dos sócios.
5. Revogar a chave OpenRouter usada no piloto (ela passou pelo chat). Remoção local:
   `security delete-generic-password -a planning -s planning-openrouter-cockpit-piloto`.
6. Integração com a main — fora desta rodada por pedido seu.

## 9. Revisão final

Um revisor independente, somente leitura (árvore conferida por hash e data de arquivo antes e
depois: intacta), confirmou a trajetória, a rede por unidade, a matriz de evidências e a avaliação
do Jev, e achou dois bloqueantes — os dois conferidos com dado real e corrigidos em `4797a52`:

- **B1 — falta de acesso virava "0, disponível"** em clientes ativos e "nenhum churn" nas coortes
  (cada tabela tem policy própria). Corrigido com a porta por fonte descrita na seção 4.
- **B2 — unidade casada por igualdade exata e exclusões invisíveis.** Medido: não havia contrato
  regional perdido por grafia; ainda assim a regra passou a ser a da casa (contém, sem acento), as
  exclusões aparecem por tipo e a conferência SQL passou a usar `ilike`, independente do TS.

Também corrigidos: leitura da rede cortada em 1.000 linhas sem aviso (paginação única), ordem de
paginação sem chave única, cache da tela sem o usuário na chave, penetração com cara de 0% sem
rótulo, coorte anterior ao registro de churn com células "reais", coorte do mês em andamento, royalties
ausentes como R$ 0, mensagens da rede, exportação e lacuna no gráfico. Mantido e declarado: o script
de avaliação liga o piloto e tem ledger próprio — no total foram 43 chamadas reais ao Jev (3 do
preview + 40 da avaliação), US$ 0,0012.

## 10. Commits da rodada

```
4797a52 fix(cockpit-ceo): correções da revisão final da rodada 2
66e8e14 chore(cockpit-ceo): homologação final da rodada 2, capturas e royalties sintéticos
df9a20a docs(cockpit-ceo): avaliação rotulada do Jev com 40 chamadas reais
e599210 test(cockpit-ceo): casos rotulados da avaliação do Jev, congelados antes das chamadas
5064382 feat(cockpit-ceo): retenção por coorte, rede por unidade e matriz de evidências
8b957e5 style(cockpit-ceo): prettier no script de capturas
51c6dba feat(cockpit-ceo): clientes ativos por definição candidata e penetração ganha no CRM
1819e5c feat(cockpit-ceo): trajetória para R$ 1 bi em 2030 com leituras candidatas
0b48f8f feat(cockpit-ceo): homologação com dado real, perfis e área aplicada
```

Mais o commit deste relatório e da entrada em `DECISIONS.md`. Nada foi enviado a remote.
