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
| Sem contato | ativos − com WhatsApp; quando os universos não fecham (resultado negativo), mostra `nao-apurado` com a nota do descasamento | ativos |
| Contatos para classificar | contatos sem empresa vinculada, **com ou sem WhatsApp** (o subtítulo prometia "têm WhatsApp") | contatos |

## Correções de exibição
1. KPIs locais → `KpiCard`; estados do DS.
2. Abas (`cobertura`, `plano`) e filtros (busca, unidade, situação) na URL.
3. A tabela "Empresas sem contato válido" ganha, por linha, o link para a empresa em `/clientes` (ficha) como próxima ação.

## O que NÃO entra
Vincular ou cadastrar contato por aqui (não existe escrita); a fusão com a visão Contatos de `/clientes` (5.9).

## Achado para o dono
A tela não confere `view.base_contatos` nem `view.contatos` (a visão Contatos de `/clientes` confere). Não mexido: é permissão.
