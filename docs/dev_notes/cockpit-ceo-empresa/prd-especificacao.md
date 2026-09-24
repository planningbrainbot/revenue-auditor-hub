# Cockpit do CEO empresarial: PRD e especificação (v2, 23/09/2026)

Substitui o escopo do piloto (Base e Monetização) pelo da empresa inteira. Base: o diagnóstico
(`diagnostico.md`), as decisões de 22–23/09 do `DECISIONS.md`, o PRD de 22/09
(`monetizacao/outputs/2026-09-22-cockpit-ceo/PRD.md`) e o pedido do Pedro de 23/09.

## 1. Problema

A meta é **R$ 1 bilhão de faturamento anual da Planning**, ano-alvo 2030, com o perímetro ainda por
escolher. O cockpit publicado em 23/09 tinha três problemas:

- Respondia quase só sobre Monetização, que é uma linha da ponte do bilhão, não a empresa.
- Lia faturamento de uma cópia congelada do Financeiro, cerca de 10% abaixo da tela oficial.
- Não enxergava Growth, Operação, caixa nem margem, embora esses dados existam no banco.

## 2. Resultado de uso

Na daily, o Pedro abre a Visão executiva e em um minuto sabe cinco coisas:
1. onde a empresa está frente à meta (perímetro declarado);
2. de onde veio a variação do último mês fechado (ponte);
3. quais motores sustentam a previsão (aquisição, base, rede, monetização) e quanto do plano está
   realizado;
4. quais gargalos e riscos pedem decisão (ativação, caixa, recebimento, fonte parada);
5. quem precisa agir.

Todo número abre a composição, a fonte, a cobertura e a tela dona.

## 3. Escopo desta versão

1. **Fonte canônica do Financeiro.** A leitura sai do Financial Brain, no servidor, pelas funções
   oficiais: faturamento por cliente e mês, emitido × recebido, inadimplência ao vivo, caixa livre,
   margem por empresa e cobertura. A leitura da cópia unificada congelada sai do cockpit.
2. **Ponte de faturamento do grupo, mês a mês, por cliente.** Fecha exatamente com o total do
   Financeiro (seção 6).
3. **Aquisição (Growth):** funil mensal de investimento → leads → MQL → vendas → MRR novo, plano ×
   realizado, custo de mídia por venda e o forecast do mês do Growth.
4. **Motores comerciais:** MRR vendido por mês em Inside Sales, Sócios e Monetização. Pipeline Inside
   Sales aberto, sem ponderação.
5. **Operação:** fila de onboarding por fase e idade, concluídos, churn no onboarding e tempo do
   contrato ganho à conclusão.
6. **Unidades:** o que já existe (apuração), mais a meta trimestral por unidade do Growth.
7. **Cadeia aquisição → venda → ativação → faturamento → retenção**, com a taxa de vínculo comprovado
   em cada elo e os elos sem chave declarados.
8. **Registro único** pergunta → exigência do mapa → pilar → feature → indicador → fonte →
   responsável → estado (dado, implementação, homologação, adoção, decisão). Ele alimenta a tela, o
   CSV de evidências e a `atualizacao-para-artifact.md`.
9. **Visão executiva redesenhada** e frentes reorganizadas (seção 7).

## 4. Não objetivos

- Escolher perímetro, definição de cliente ativo, probabilidades, custos ou metas. Isso é decisão de
  negócio: o cockpit mostra os candidatos e a lacuna.
- Previsão empresarial de faturamento inventada. Não existe fonte dela, e ela aparece como lacuna
  com dono.
- Receita realizada por vertical. O Financeiro não classifica, e PARTNERS está sem Omie.
- Recalcular o que já tem dono: faturamento, IDU, royalties, forecast do Growth.
- Escrever em CRM, e-mail, automação; reclassificar a base; mudar a regra de origem ou a exceção de
  Curitiba.
- Liberar acesso financeiro a quem não tem, ou ligar o Jev em produção.
- Publicar ou fazer merge sem autorização. Esta versão sai como branch, PR em rascunho e preview local.

## 5. Mapa de fontes (servidor)

| Leitura | Fonte | Cliente | Porta conferida antes |
|---|---|---|---|
| Faturamento, ponte, emitido × recebido, inadimplência, caixa, margem por empresa, cobertura | Financial Brain `public.fn_faturamento_mensal`, `fn_receita_emitido_recebido`, `fn_inadimplencia_live`, `fn_cockpit_indicadores`, `fn_competencias_cobertura` | service role do Financial Brain (`client.financeiro.server.ts`), só no servidor | área `cockpit_ceo` + `tem_produto('financeiro')` + `usuario_escopo.todas_empresas` (a regra do Financeiro para consolidado) |
| Rede (apuração) | `ops.royalties_apuracao`, `ops.unidades` | JWT da pessoa (RLS) | todas as unidades + `portas.ts` |
| Aquisição | `growth.serie_mensal`, `growth.metas`, `growth.mes_corrente`, `growth.dist_metas`, `growth.deals` (Inside Sales ganho/aberto) | JWT da pessoa (RLS) | `tem_produto('growth')` + `growth.e_membro()`, por RPC com o JWT: é a própria policy |
| Motores (Sócios, Inside Sales em contrato) | `ops.contratos` | JWT (RLS) | porta `contratos` |
| Onboarding | `ops.cs_onboarding_cards`, `ops.contratos` | JWT (RLS) | chaves `view.painel_cs`/`view.fila_cella` (espelho da policy) + todas as unidades |
| Clientes ativos, coortes | inalterados (rodada 2) | JWT (RLS) | inalterados |
| Monetização | `useMonetizacao()` | JWT (RLS) | inalterado |

Regras gerais:
- Do servidor para o navegador **só sai agregado**. Nome de cliente e CNPJ ficam no servidor.
- O cache da tela é por usuário (`["cockpit-ceo", <leitura>, user.id]`).
- Falha de uma leitura não derruba as outras: cada uma tem estado próprio.

## 6. Contratos das medidas novas

O contrato completo de cada indicador está em `contratos-indicadores.md`. Aqui ficam as regras que
evitam dupla contagem.

- **Seis momentos da receita, nunca misturados:** receita prevista → ganho no CRM → assinatura →
  faturamento (emissão) → recebido → retido.
  - MRR vendido é evento comercial, em reais **por mês de contrato**. Faturamento é emissão, em reais
    **no mês**.
  - A ponte nunca soma MRR vendido com faturamento.
- **Ponte de faturamento por cliente** (identidade do cliente = nome do cliente no Financeiro, a mesma
  chave da tela de Faturamento). Para cada mês M com o mês anterior fechado, cada cliente cai em
  exatamente um grupo:
  - **base (expansão/contração):** faturou em M−1 e em M; conta a diferença;
  - **entrada nova:** faturou em M, não em M−1, e não faturou em nenhum mês anterior da janela lida.
    Com janela curta, "nova" quer dizer "sem faturamento desde jan/2026", e a tela diz isso;
  - **retorno:** faturou em M, não em M−1, mas faturou antes;
  - **sem faturamento no mês:** faturou em M−1 e não em M. Não é churn confirmado: a régua é emissão;
  - **sem cliente identificado:** a linha do Financeiro sem cliente.

  Identidade verificada:
  `receita(M−1) + novas + retornos + expansão − contração − sem faturamento + Δ sem cliente = receita(M)`,
  em centavos. Se não fechar, o estado é `fonte_indisponivel` e a tela mostra a diferença.
- **Hierarquia de atribuição** (uma receita vai para uma linha só): aquisição > unidade nova >
  monetização. "Novas unidades", "aquisições" e "monetização" não têm vínculo de receita por cliente
  hoje, então aparecem como linhas **não modeladas**, nunca zero. A ponte fica parcial até existir o
  vínculo cliente → unidade/produto na receita.
- **Plano × realizado da aquisição:** `growth.metas` (papel `funil`) contra `growth.serie_mensal`. Mês
  sem plano mostra "sem plano", não 0% de atingimento.
- **Forecast:**
  - Inside Sales: `growth.mes_corrente` (ritmo e pipeline), exibido com o nome do modelo e a data da
    leitura. O cockpit não recalcula.
  - Pipeline aberto: soma não ponderada, com a data de fechamento esperada declarada; negócio sem data
    é contado à parte.
  - Monetização: v10 de 09/09, como recorte, com o aviso "valor assinado".
  - Previsão empresarial de faturamento: **lacuna** (dono CFO + RevOps).
- **Mês fechado, parcial, em andamento e sem cobertura** vêm da cobertura do Financeiro
  (`competencias`). O mês em andamento nunca entra em média, ritmo ou ponte.
- **Faturamento anual:** quatro medidas distintas e rotuladas.
  - Realizado dos últimos 12 meses: só com 12 meses fechados; hoje não há.
  - Acumulado no ano: meses fechados do ano.
  - Ritmo anualizado: média dos meses fechados × 12, rotulado como ritmo, não realizado.
  - Previsão: lacuna.

## 7. Arquitetura de informação

Visão executiva, no arquétipo Visão geral (`docs/design/ARQUETIPOS.md` §1):

1. `PageHeader` com a pergunta, o universo, a procedência (Financeiro, Growth, Ops com a data de cada
   fonte) e os filtros de período.
2. Seis cartões:

   | # | Cartão | Pergunta que responde |
   |---|---|---|
   | 1 | Faturamento do último mês fechado | quanto faturamos? (variação sobre o mês anterior) |
   | 2 | Ritmo para o bilhão | estamos no plano? (múltiplo necessário; leitura do grupo com o perímetro "candidato") |
   | 3 | Recebido do emitido | o faturamento vira caixa? |
   | 4 | MRR vendido no mês × plano | a aquisição sustenta? |
   | 5 | Onboardings parados | conseguimos ativar? |
   | 6 | Faturamento que saiu da base | quem sai? (sem faturamento no mês + contração) |

3. **O que é decisão sua?** Até três decisões, uma linha cada.
4. **O que ameaça o resultado?** Lista com borda: fonte parada, ativação travada, inadimplência,
   plano não atingido, dependência de capital.
5. **De onde veio a variação do faturamento?** Um gráfico: a ponte do último mês fechado.
6. **Quais motores sustentam o crescimento?** Um gráfico: MRR vendido por motor × plano, nos últimos
   meses.
7. **Para onde ir?** Cartões das frentes, cada um com quantas perguntas têm resposta, parcial ou
   lacuna.

Frentes na lateral (as chaves da URL existentes são preservadas):

| Chave | Título | Conteúdo |
|---|---|---|
| `receita` | Receita e trajetória | trajetória (grupo e rede, lado a lado), ponte mensal, faturamento por grupo de apuração, forecast (camadas) |
| `comercial` | Aquisição e conversão | funil Growth plano × realizado, motores, pipeline aberto, forecast do mês, eventos da Monetização |
| `clientes` | Clientes | definições de cliente ativo (rodada 2) |
| `retencao` | Retenção e expansão | coortes (rodada 2), ponte da base (expansão, contração, sem faturamento) |
| `operacao` | Operação e capacidade | onboarding por fase e idade, concluídos, tempo até a conclusão, lacunas de capacidade |
| `rede` | Unidades | rede por unidade (rodada 2), meta trimestral × vendido por unidade |
| `portfolio` | Portfólio e monetização | os seis números da Monetização (antiga primeira dobra), demanda por produto, forecast v10 (recorte) |
| `caixa` | Caixa e margem | emitido × recebido, inadimplência por faixa, caixa livre, margem por grupo de apuração |
| `capital` | Evidências e capital | pilares, as 11 exigências do mapa, matriz de evidências (CSV), consolidação como lacuna |

## 8. Critérios de aceite

1. O faturamento do cockpit é igual ao da função oficial do Financial Brain, conferido mês a mês
   contra SQL independente.
2. A ponte fecha em centavos para cada mês. As parcelas batem com uma recontagem SQL independente
   (outra consulta, não a mesma função).
3. Plano × realizado da aquisição bate com `growth.metas` e `growth.serie_mensal`, conferidos por SQL.
4. A fila de onboarding bate com a contagem SQL por fase.
5. Nenhuma leitura sem porta vira 0. Cada perfil sem acesso recebe "acesso insuficiente", testado por
   função pura e, onde a RLS decide, por JWT simulado.
6. Mês em andamento e mês parcial nunca entram em média, ritmo nem ponte. Mês parcial não é
   anualizado.
7. Cada número abre a composição com fonte, período, universo, cobertura e limitação.
8. O registro único alimenta tela, CSV e `atualizacao-para-artifact.md`, sem segunda lista.
9. Testes, `tsc` sem erro novo, `design:lint` sem violação nova e build verde.
10. Preview sintético por CDP com as nove frentes, sem requisição externa além da fonte.
11. Percurso de aceite por área (Growth, comercial, Ops, unidades, clientes/CS, Financeiro,
    Monetização) até uma pergunta respondida, ou até a lacuna exata.

## 9. Dependências e decisões pendentes

| Pendência | Dono | Impacto |
|---|---|---|
| Perímetro da meta (grupo, rede ou outro) | CEO + CFO | sem ele não há gap único; a tela mostra candidatos |
| Cobrança das GitHub Actions da conta `pedroluca-prog` | dono da conta | Financeiro sem carga desde 20/09; o cockpit mostra a idade do dado |
| Migração do Financeiro para o banco único | Eliezek + dono do Financeiro | enquanto não acontece, o cockpit lê o Financial Brain pela ponte de servidor |
| Vínculo receita → unidade/produto/vertical | Controladoria + Receitas | a ponte fica sem as linhas de unidade nova e monetização |
| Previsão empresarial (plano de receita por mês) | CFO + RevOps | forecast só por recorte |
| Instrumentar a entrega (horas, SLA, capacidade) | Operações | capacidade vira lacuna |
| Mandato de consolidação | CEO + CFO | aquisições não modeladas |
| Quem lê a pesquisa dos sócios | Expansão | satisfação sem leitura |
| Guarda nas funções SECURITY DEFINER e `security_invoker` em `qb_clientes_ativos` | donos do Financeiro e do Ops | migrations propostas em `supabase/proposals/`, sem aplicar |

## 10. Migrações

Nenhuma é necessária para esta versão: nenhuma tabela, view ou policy nova. As propostas de
segurança ficam em `supabase/proposals/` para os donos revisarem.

## 11. Lotes

| Lote | Entrega | Verificação |
|---|---|---|
| 1 | Financeiro canônico: leitura no servidor, extração pura, trajetória, caixa, margem | testes puros + conciliação com SQL no Financial Brain |
| 2 | Ponte por cliente | identidade em centavos + recontagem SQL independente |
| 3 | Aquisição e motores (Growth + contratos) | testes puros + conciliação SQL |
| 4 | Operação (onboarding) | testes puros + contagem SQL |
| 5 | Registro único (pilares, exigências, estados) + CSV + artifact.md | testes do registro (ids estáveis, cobertura das 11 exigências) |
| 6 | Visão executiva e frentes | CDP no preview sintético, lint de design, capturas |
| 7 | Propostas de segurança e homologação por perfis | JWT simulado em transação só de leitura |
