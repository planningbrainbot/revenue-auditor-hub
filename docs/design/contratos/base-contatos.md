# Contrato · Base de Contatos (`/base-contatos`)

**Dono de produto:** Pedro + Eliezek (`PRODUCT.md` 5.9, duplicação com a visão Contatos de `/clientes`)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Sem fusão com `/clientes` (5.9 continua aberta). Fórmulas e fontes não mudam.

## Propósito
- **Pergunta (N1):** "Quais clientes ativos não têm contato para receber a pesquisa?"
- **Público:** CS.
- **Ação:** achar a empresa sem WhatsApp válido e completar o contato no Pipefy/CRM.
- **Arquétipo:** Lista/Relatório (Cobertura) + Fila (Plano de ação).
- **Universo (`descricao`):** "Clientes ativos (franquias de unidades regionais, sem churn) · contato válido = WhatsApp com 10+ dígitos".

## Números (N11: universos declarados)
| Rótulo | Definição | Universo |
|---|---|---|
| Clientes ativos | empresas ativas | ativos |
| Já receberam a pesquisa (era "Já disparadas") | empresas distintas com pesquisa | **todas as empresas**, nota "inclui inativas" |
| Com WhatsApp válido | Cobertura: todas as empresas; Plano de ação: só ativas — o rótulo de cada aba diz o universo | ver rótulo |
| Sem contato | soma, por unidade, de (clientes ativos − com WhatsApp) — ver nota abaixo | ativos |
| Contatos para classificar | contatos sem empresa vinculada, **com ou sem WhatsApp** (o subtítulo prometia "têm WhatsApp") | contatos |

**Revisão de 24/09 (Sem contato):** o número passou a vir da soma de `empresas − comWhatsapp` das linhas por unidade, que já contam só clientes ativos. A conta anterior (`totalEmpresas − totalComWhatsapp`) subtraía um total de todas as empresas (inclui inativas) de um total de ativos: misturava universos, podia dar negativo e não era o número que o rótulo "clientes ativos" promete. Com a soma por unidade o cartão bate com a tabela e o caso `nao-apurado` deixa de existir. A fórmula do servidor não mudou; mudou qual dos números já devolvidos a tela usa.

## Correções de exibição
1. KPIs locais → `KpiCard`; estados do DS.
2. Abas (`cobertura`, `plano`) e filtros (busca, unidade, situação) na URL.
3. A tabela "Empresas sem contato válido" ganha, por linha, o link para a empresa em `/clientes` (ficha) como próxima ação.

## O que NÃO entra
Vincular ou cadastrar contato por aqui (não existe escrita); a fusão com a visão Contatos de `/clientes` (5.9).

## Achado para o dono
A tela não confere `view.base_contatos` nem `view.contatos` (a visão Contatos de `/clientes` confere). Não mexido: é permissão.
