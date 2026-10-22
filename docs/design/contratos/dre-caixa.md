# Contrato · DRE e Caixa da Partners (`/dre-caixa`)

**Dono de produto:** Financeiro da Partners   **Dono do código:** a decidir pelo dono de produto   **Data:** 15/10/2026

**Estado:** aprovado e publicado em 15/10/2026 ("pode publicar" do dono de produto). A regra de cada número foi validada antes na planilha "Financeiro - Planning Partners", abas `DRE`, `FCX`, `DRE · Variação`, `Base Omie (DRE)`, `Apuração Unidades (Ops)`, `Mídia Paga (faturas)`, `Mídia por BU (reembolso)` e `Pool Comercial e Mkt (conferência)`, montadas por `tools/dre_sheets.py` e `tools/fcx_sheets.py` (repo ai-projects-scripts). Permissão da v1: área `receita`, como o Financeiro semanal; a chave própria `view.dre_caixa` fica para quando a tela tiver ação de escrita.

Substitui `/financeiro-partners` (abas DRE projetada, DRE realizada, FCx, contas a receber e pagamentos), que lê `partners_*` com regras anteriores a estas e não está no menu.

## Propósito
- **Pergunta que responde (`<h1>`):** "Por que o resultado do mês é diferente do caixa do mês, e o que mudou de um mês para o outro?"
- **Público:** Financeiro da Partners e CEO. Sócio regional não vê.
- **Decisão ou ação que provoca:** fechar o mês (o que falta para ele deixar de ser provisório), cobrar o que foi apurado e não faturado, cobrar das outras empresas a parte do CSC que mudou depois da cobrança, e corrigir lançamento no mês errado ou na categoria errada no Omie.
- **Métrica de sucesso:** a reunião de fechamento explica a diferença entre DRE e caixa de qualquer mês sem abrir planilha, e nenhum mês fica provisório por mais de 15 dias depois de virar.
- **Arquétipo:** Visão geral, com gaveta de detalhe por linha.
- **Universo (`descricao`):** "Planning Partners · competência da Partners · jan/26 até o mês corrente (parcial)".

## Anatomia (ordem fixa)
1. `PageHeader` com a pergunta, o universo, o seletor de mês (`?mes=`) e o selo de situação do mês: **fechado** ou **provisório** com o motivo.
2. Quatro `KpiCard`: Resultado da DRE · Resultado do caixa · Diferença DRE × caixa · Resultado sem o investidor (DRE e caixa no mesmo cartão).
3. **Ponte DRE → caixa** do mês escolhido (seção "Ponte"): do resultado da DRE até o resultado do caixa, um degrau por motivo.
4. **Ponte do EBIT** mês contra o anterior: EBIT do mês anterior, as 12 contas que mais mexeram, demais contas, EBIT do mês. Cada degrau abre em conta › fornecedor ou unidade, para responder "o que gerou os R$ 100 mil a mais de despesa" sem sair da tela.
5. **O que falta para fechar o mês**: a lista de pendências (seção "Conferências").
6. Tabela da DRE do mês com os 3 níveis (bloco › conta › fornecedor ou unidade) e a série de 12 meses; verde/vermelho = melhora/piora contra o mês anterior.
7. Gaveta (`?detalhe=`) de qualquer linha: o que é, de onde vem (título do Omie, apuração, fatura, aba do rateio), a régua do mês e os lançamentos que compõem o valor.

## Réguas (decididas em 15/10/2026)
| Linha | Mês em que entra na DRE | Fonte |
|---|---|---|
| Receita das unidades (royalties, CSC, CAC, mídia, outras) | **mês em que a Partners apura e cobra** = mês de referência da apuração + 1 | `ops.royalties_apuracao` |
| Faturado no Omie para as unidades | conferência, fora dos totais | contas a receber do Omie |
| CSC Comercial · custo total | competência da base | aba Custos Growth (vira tabela) |
| Rateio do CSC e das comissões (parte das outras empresas) | competência; soma das linhas de cada empresa, nunca "total − Expansão" | abas de rateio (viram tabela) |
| Performance do CSC ainda não rateada | estimada com a proporção de propostas do último mês fechado; mês fica provisório | idem |
| Pagamento a fornecedor que está na base do CSC, em qualquer departamento | sai da DRE (já está no custo total) | Omie + base do CSC |
| Mídia paga | 100% pelas faturas, no **mês de emissão da fatura**; todo Tráfego Pago do Omie sai | faturas do Meta e do Google |
| Despesas com Pessoal (grupo 2.03) | mês do serviço = vencimento − 15 dias | Omie |
| Demais despesas | mês de emissão do título | Omie |
| Aporte do investidor (1.04.99) | não operacional; o resultado "sem o investidor" sempre ao lado | Omie |
| Investimento em projeto novo (grupo 2.07 e lançamentos apontados) | bloco próprio "(i) Investimentos em novos projetos", abaixo do resultado, no mês do pagamento; não entra no EBIT nem no resultado; no caixa, linha própria e resultado "sem investimentos" | Omie |
| Caixa (FCX) | data do lançamento no extrato; sem transferências entre contas próprias e sem "Previsto" | extrato de conta corrente do Omie |

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Resultado da DRE | EBIT + não operacional do mês | R$ | réguas acima | data do snapshot | tabela da DRE do mês | sim |
| Resultado do caixa | entradas − saídas do extrato no mês | R$ | FCX | idem | gaveta com o extrato do mês | sim |
| Diferença DRE × caixa | caixa − DRE | R$ | as duas acima | idem | Ponte DRE → caixa | sim, a ponte fecha no centavo |
| Resultado sem o investidor | DRE e caixa sem 1.04.99 | R$ | idem | idem | linha do aporte | sim |
| Saldo em conta sem o investidor | saldo do fim do mês − aportes acumulados | R$ | FCX | idem | série de saldo | sim |

## Ponte DRE → caixa (degraus)
Cada degrau é "o que está na DRE do mês e não passou pelo caixa no mês, ou o contrário", com a gaveta listando os lançamentos. Exemplo de ago/26, conferido na planilha (resultado da DRE −66,7 mil; caixa +124,6 mil; diferença +191,3 mil):

| Degrau | DRE | Caixa | Efeito | O que explica |
|---|---|---|---|---|
| Mídia | −216,8 | −82,4 | +134,4 | fatura do Meta de 01/08 na DRE; no caixa saiu só o repasse da mídia; a fatura foi paga por outra empresa do grupo e a Partners devolveu a parte dela em set |
| CSC Comercial líquido e demais despesas | −271,0 | −225,6 | +45,4 | parte da Partners no CSC de ago cobrada só em out (R$ 91,8 mil); PJ de ago pago em set |
| Receita das unidades | 291,5 | 309,7 | +18,2 | recebido no mês de faturas de meses anteriores |
| Não operacional | 130,0 | 122,9 | −7,1 | empréstimo entre empresas do grupo pago em outro mês |
| Deduções | −0,3 | 0 | +0,3 | imposto ainda não pago |

## Conferências (o que falta para fechar o mês)
Cada item abre a lista e diz quem resolve. Todas foram encontradas na análise de 15/10/2026:
| Conferência | O que aponta | Exemplo |
|---|---|---|
| Apurado × faturado × recebido, por unidade | apuração sem nota emitida, nota sem recebimento | ago/26: RJ, Maceió e Patos sem nota (R$ 108,6 mil) |
| Apuração faltando ou em rascunho | unidade que tinha apuração no mês anterior e não tem neste; rascunho sem receita base | set/26: São Bernardo, Recife e Sorocaba sem apuração; Patos, São Luís e Fortaleza em rascunho |
| Base do CSC sem rateio | base − total rateado por mês | set/26: R$ 141,8 mil com a Partners até sair a performance |
| Mudança em mês já cobrado | custo que entrou na base depois da cobrança, e quanto cobrar de cada empresa | ago/26 depois do Renan: Matriz +2.872,79, Construção Civil +2.008,25 |
| Duplicidade com o CSC | fornecedor pago no Omie que está na base do CSC | 28 fornecedores, R$ 292 mil em jan–set |
| Comercial fora da base do CSC | PJ com departamento Comercial no Omie que não está na base | 5 pessoas acrescentadas em 15/10 |
| Mês fora do lugar | emissão no Omie diferente do mês do serviço; nota lançada depois do pagamento | notas de PJ de ago emitidas como 31/07 ou em set |
| Pagamento sem documento | título criado depois do pagamento, sem número de nota, pessoa física | R$ 20 mil de 08/10 (compra de domínio lançada como PJ) |
| Categoria fora de lugar | investimento lançado como despesa | idem |
| Variação por falta de lançamento | conta que tinha valor no mês anterior e está zerada no mês | set/26: comissões zeradas (ago R$ 52,2 mil) por não terem sido lançadas |
| Possível duplicidade na base do CSC | mesmo primeiro nome em duas linhas no mesmo mês | set/26: "RENAN" R$ 23 mil e "Renan Weiser Rios" R$ 36,1 mil |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | consulta em curso | `Carregando variante="painel"` |
| Vazio (sem dado na fonte) | mês sem snapshot | `EstadoVazio` + "o snapshot deste mês ainda não foi gerado" |
| Parcial / não apurado | mês em andamento, CSC sem performance ou apuração pendente | selo "provisório" com os motivos; linhas estimadas marcadas |
| Fonte indisponível / erro | snapshot com mais de 24 h ou falha de leitura | `EstadoErro` com a fonte e a hora do último snapshot |
| Sem acesso | sem a chave | `EstadoSemAcesso oQueFalta="view.dre_caixa"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | AAAA-MM | último mês fechado | toda a tela |
| `detalhe` | id da linha | nenhum | gaveta |
| `comparar` | AAAA-MM | mês anterior a `mes` | ponte do EBIT |

## Permissões (N8)
- Área que abre a tela: `receita` (Receita e Repasses), grupo "Caixa da Partners".
- Chaves: `view.dre_caixa` (ver). Sem ação de escrita na v1.
- O que quem não tem a chave vê: `EstadoSemAcesso`. Sócio regional nunca recebe a chave: a tela mostra custo de pessoas e o rateio entre empresas do grupo.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Exportar o mês (XLSX) | quem vê | não | download |
| Abrir o título no Omie / a apuração no Ops | quem vê | não | nova aba |

## Dados (a decidir pelo dono do código)
A regra está hoje em `tools/dre_sheets.py`. Para a tela, o mesmo cálculo grava um snapshot por mês em tabela do `ops` (DRE por linha e mês, ponte, conferências), rodado na nuvem depois do sync do Omie, nunca em máquina local. As abas mantidas à mão (base do CSC, rateio, faturas de mídia) precisam virar tabela antes, senão a tela depende da planilha.

## O que NÃO entra, e por quê
- DRE das outras empresas do grupo e das unidades: a tela é da Partners.
- Projeção e forecast: ficam no Forecast; meta não vira previsão.
- Edição de lançamento: correção é no Omie ou no Ops, a tela só aponta.
- Rateio do CSC como cadastro (base, propostas, cobrança): é o sistema de rateio do CSC, outro módulo, pedido em 01/10/2026.

## Para onde manda (tela dona)
- Apuração de uma unidade: `/unidades/royalties?mes=`.
- Cobrança das unidades: `/receita-overview`.
- Previsibilidade de caixa (a pagar pelo vencimento): `/financeiro-semanal`.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente contra a planilha, mês a mês, jan–set/26)
