# Contrato · Funil da Rede (`/unidades/funil-rede`)

**Dono de produto:** Receita e Repasses (matriz)   **Dono do código:** a definir   **Data:** 16/10/2026

## Propósito
- **Pergunta (h1):** "Da venda ao royalty, onde a rede está perdendo dinheiro?"
- **Público:** quem tem `view.royalties_split` (controladoria e diretoria da matriz).
- **Decisão ou ação:** descobrir se o royalty que falta é gap de cadastro, de contrato, de faturamento, de inadimplência ou de split, e abrir os clientes que formam cada um.
- **Métrica de sucesso:** o gap de royalty explicado cliente a cliente, sem divergência sem categoria.
- **Arquétipo:** Visão geral (com a Conciliação como Lista/Relatório).
- **Universo:** unidades com split ativo, a partir da data do split de cada uma · fluxo do mês por vencimento do boleto · cliente = contratos e boletos que dividem CNPJ.

## Números
| Número | Definição | Unidade | Fonte e régua | Drill-down | O destino bate? |
|---|---|---|---|---|---|
| 1. Vendas | MRR vendido e quantidade, por `ganho_em` | venda | `contratos` ativos, pipes Sócios e Inside Sales | — | — |
| 2. Contratos | assinatura (Pipedrive ou Pipefy); sem ela, primeiro boleto | contrato | `contratos`, `contratos_documentos`, `contas_receber` | — | — |
| 3. Faturado | boletos não cancelados | R$ | `contas_receber` da unidade, vencimento | Split do Asaas | sim (mesma régua) |
| 4. Recebido / A receber | status RECEBIDO / demais | R$ | idem | Split do Asaas | sim |
| 5. Royalty recebido / a receber | split DONE / PENDING | R$ | `asaas_splits` por `codigo_omie` | Split do Asaas | sim; split sem título fica fora e a tela avisa |
| Pago sem reter royalty | boleto pago sem split × % | R$ | idem | Split do Asaas | sim |
| Royalty potencial e gaps | ver DECISIONS 16/10/2026 | R$ | todas acima | aba Conciliação | — |
| Categoria da conciliação | ver DECISIONS 16/10/2026 | cliente | idem | a própria tabela | — |

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | server function em curso | `Carregando variante="pagina"` |
| Vazio (sem unidade com split) | nenhuma `split_ativo_desde` | `EstadoVazio` com o motivo |
| Vazio por filtro | recorte sem linha | `EstadoVazio` |
| Erro | falha de leitura | `ErroDaConsulta` com a chave |
| Sem acesso | sem `view.royalties_split` | `GuardaUnidades` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `visao` | funil, gap, conciliacao | funil | a visão |
| `unidade` | nome da unidade | todas | tudo |
| `canal` | Hunter, Inside Sales, Sem venda registrada | todos | tudo |
| `de`, `ate` | AAAA-MM | primeiro e último mês | funil e gap |
| `situacao` | recebido, a_receber | recebido | etapas 4 e 5 do funil |
| `categoria` | categoria da conciliação | todas | tabela da conciliação |

## Permissões (N8)
- Área `receita`, chave `view.royalties_split`. Pendente: as tabelas lidas têm RLS com outras chaves (ver DECISIONS).

## Ações
Nenhuma. A tela não baixa churn nem cancela venda; só aponta.

## O que NÃO entra
- Unidades sem split, nem o faturado do Omie delas.
- Coorte (conversão dos mesmos clientes): o funil é fluxo do mês.
- Split sem título no Omie: fica fora do funil por mês e é declarado no rodapé.

## Para onde manda
- Split do Asaas (`/unidades/split`) para o boleto e o split de cada cliente.

## Checagem
- [x] Números conferidos na fonte (planilhas de 16/10/2026 batem com a tela)
- [ ] Definição de pronto de `docs/design/README.md`
