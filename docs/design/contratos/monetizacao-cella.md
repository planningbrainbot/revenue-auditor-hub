# Contrato · Cella (`/monetizacao?aba=cella`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 22/10/2026
Estado: **aprovado** ("1 ok", Pedro, 22/10/2026), com o honorário a 20% do crédito ("no contrato é mais confiável").
Moldura comum: `monetizacao.md`.

Origem: pauta da reunião com a Diehl & Cella de 22/10 (https://claude.ai/artifact/8KwNMNcj7DE6QAwmjKXXar) e a escolha
do Pedro no mesmo dia ("Tela da Cella no Brain"). Os dados vêm da volta da integração: `ops.monetizacao_cella_negocios`,
lida do funil 9 "Projeto Planning" da Diehl & Cella a cada 5 minutos (DECISIONS.md, 22/10).

## Propósito
- **Pergunta (N1):** "Onde está cada contrato da Cella, e quanto vale cada tese?"
- **Público:** Pedro e Paulo; Matheus, que conduz os negócios da Cella. Tela interna: nada dela vai para a Cella.
- **Ação que provoca:** cobrar da Cella o valor da tese que falta e conferir os abertos da reta final na conversa
  quinzenal com ela.
- **Métrica de sucesso:** "Contratos sem valor de tese" chega a 0 em até 30 dias depois da assinatura de cada contrato.
- **Arquétipo:** **Lista/Relatório** (uma linha por contrato, as teses abrem dentro) com os números da **Visão geral**
  no topo.
- **Universo (`descricao`):** cards da Planning com a Cella ligados ao funil 9 deles · desde 17/09/2026 · contrato e
  tese contados como negócio do funil deles.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Contratos assinados | negócio principal ganho lá, com data do contrato | contrato | `monetizacao_cella_negocios` (principal, won, data_contrato) | 5 min | filtra a lista | sim |
| Contratos sem valor de tese | assinados sem nenhuma tese com valor | contrato ("n de N") | idem, teses = outros negócios do mesmo cliente no funil 9 | 5 min | filtra a lista | sim |
| Crédito estimado | soma do Valor das teses abertas ou ganhas | R$ | Valor do negócio-tese, cadastrado pela Cella | 5 min | lista | sim |
| Honorário estimado | crédito estimado × 20% (contrato do Radar; decisão do Pedro, 22/10) | R$ | sem nenhuma tese com valor: "não apurado", não R$ 0 | 5 min | lista | sim |
| Parte da Planning | honorário estimado × 25% | R$ | regra da parceria (deck de 13/10) | 5 min | lista | sim |
| Abertos com a Cella | principal aberto lá | negócio | idem | 5 min | filtra a lista | sim |
| Lados divergentes | aberto aqui e perdido lá, ou o contrário | card | `monetizacao_cella_envios.estado = parado_deles` + perdido aqui com principal aberto lá | 5 min | filtra a lista | sim |
| Lista (linhas) | cliente (título do card; a organização embaixo quando é outra, ex.: Tech Med na org "REVENDEDOR PHILIPS") · assinado em · dias desde a assinatura · teses (n) · crédito · honorário · situação lá · etapa aqui e lá · atualizado lá em; ao abrir, as teses: título, fase, valor, tipo de contrato | contrato | idem + `monetizacao_deals` | 5 min | card no Pipedrive da Planning | sim |

- Valor zero não é "sem tese": a linha mostra "valor não cadastrado" até a Cella preencher.
- O negócio extra que não é tese (ex.: "Assessoria Mensal") aparece em "outros negócios com o cliente", fora do crédito.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura da Monetização em curso | `Carregando` da página |
| Vazio | nenhum contrato ligado | `EstadoVazio`: "Nenhum negócio da Cella ligado ao funil deles" |
| Vazio por filtro | o número escolhido tem 0 | `EstadoVazio total={universo}` com o nome do filtro |
| Leitura atrasada | `monetizacao_cella_sync.rodado_em` com mais de 30 min | `StatusBadge` de atenção no cabeçalho: "Pipedrive da Cella sem leitura desde hh:mm" (a `Procedencia` não tem tom) |
| Erro / sem acesso | iguais aos da Monetização | já tratados no painel |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `aba` | `cella` | n/a | abre esta aba |
| `ver` | `contratos`, `sem-valor`, `abertos`, `divergentes` | `contratos` | números e lista |

## Permissões (N8)
- Área que abre a tela: a mesma da Monetização.
- Chaves: só leitura; nenhuma ação grava.
- Quem não tem a área não vê a aba.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Abrir o card | quem vê a aba | não | Pipedrive da Planning em nova aba |

## O que NÃO entra, e por quê
- Nada é escrito no Pipedrive da Cella pela tela: a escrita é só do envio automático.
- Consultoria e Finance do mesmo cliente: ficam nas abas deles.
- O link do negócio no Pipedrive da Cella: a Planning só tem o token, e o time não tem login lá.

## Para onde manda (tela dona)
- Card do pipe 39 ou 40 no Pipedrive da Planning.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente)
