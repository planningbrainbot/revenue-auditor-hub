# Contrato · Funil de CAC, aba Fechamento do mês (`/meu-funil-cac`, `/unidades/funil-cac`)

**Dono de produto:** dono do Ops   **Dono do código:** Claude Code   **Data:** 22/10/2026

PRD: `wiki/prds/2026-10-minha-unidade-fechamento-de-cac.md` (repo de wiki). Validado em tela local pelo dono em 21 e 22/10/2026.

## Propósito
- **Pergunta (h1 da aba):** "Quanto de CAC entra em {mês}?"
- **Público:** sócio regional de unidade que paga CAC (`view.meu_funil_cac`) e a matriz (`view.unidades_rede`).
- **Decisão que provoca:** fechar o CAC do mês com o sócio, na reunião de apuração, no formato do demonstrativo.
- **Métrica de sucesso:** a reunião de fechamento acontece pela tela, sem planilha paralela, e o número da tela é o da apuração.
- **Arquétipo:** Lista/Relatório.
- **Universo medido:** itens de CAC da apuração de royalties de uma unidade, num mês de referência.

## Números
| Número | Definição | Unidade | Fonte e régua | Drill-down | O destino bate? |
|---|---|---|---|---|---|
| CAC da apuração | `royalties_apuracao.cac_valor` do mês. **Sempre igual à apuração** (regra do dono, 22/10/2026) | R$ | `ops.cac_fechamento_dados` | listas por parcela | sim: soma dos itens com valor; se divergir, aviso e vale o total da apuração |
| Pelo gatilho | soma do esperado das linhas cujo gatilho é do mês (1ª na assinatura pela Central de Contratos; 2ª no 1º honorário pago, marcado no card) | R$ | `v_cac_funil` + itens | filtro por situação | conferência, não substitui o da apuração |
| Linhas para conferir | linhas com situação de divergência ou valor diferente do esperado | linhas | idem | filtro por situação | sim |

A nota emitida (`royalties_faturas`) **não entra**: não acompanha cancelamento nem pagamento avulso no Omie (Maceió 08/2026).

## Estados
| Estado | Quando | Tela |
|---|---|---|
| Carregando | leitura da função | `Carregando variante="pagina"` |
| Sem unidade (rede) | filtro em "Escolha a unidade" | `EstadoVazio` |
| Apuração não liberada (sócio) | nenhum mês confirmado | `EstadoVazio` "Apuração ainda não liberada" |
| Prévia (matriz) | mês em rascunho | `StatusBadge` "prévia, pode mudar" |
| Erro / sem acesso | a função recusa (42501) ou falha | `ErroDaConsulta` com a chave |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `visao` | `fechamento`, `funil` | `fechamento` | aba |
| `mes` | AAAA-MM | mês anterior ao corrente com apuração visível | aba Fechamento |
| `sit` | chave da situação | todas | listas |
| `unidade` | nome (só rede) | nenhuma | aba Fechamento |

## Permissões (N8)
- Rede: `view.unidades_rede` (e `view.broker_admin` ou a unidade no escopo, como a `v_cac_funil`). Sócio: `view.meu_funil_cac`, unidade que paga CAC, só mês confirmado. Tudo aplicado dentro de `ops.cac_fechamento_dados`.

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| Exportar planilha do mês | quem vê | não | download `.xlsx` no layout do demonstrativo, com a situação |

## O que NÃO entra, e por quê
- Editar item: a escrita continua na apuração e no card (um lugar só de escrita).
- "De acordo" do sócio, crédito usado, retrato na confirmação, data do 1º honorário no card: fatias seguintes do PRD.

## Para onde manda
- Apuração de Royalties (`/royalties/$unidadeId/$mes`) é a dona dos números.
