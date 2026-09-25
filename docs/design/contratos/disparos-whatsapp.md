# Contrato · Disparos de WhatsApp (`/disparos-whatsapp`)

**Dono de produto:** Eliezek (NPS/CS)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Disparo, reenvio, ligação, custos e permissões (`send.whatsapp`, `edit.nps`) não mudam.

## Propósito
- **Pergunta (N1):** "Quem recebeu a pesquisa, quem não respondeu, e para quem eu ligo?"
- **Público:** CS; só quem tem `send.whatsapp` (área própria `disparos_whatsapp`).
- **Ação:** disparar a rodada (custa por conversa), ligar para quem não respondeu e registrar a resposta.
- **Arquétipo:** Fila de trabalho (Execução) + Lista (Custos).
- **Universo (`descricao`):** "Últimos 500 envios da pesquisa NPS · clientes sem churn · atualiza a cada 15 s".

## Execução
| Número | Definição |
|---|---|
| Enviados · Respondidos · Aguardando · Falhas | sobre os **últimos 500 envios** (teto da leitura, agora dito na nota) |
| Ligações feitas · contatos ligados | todas as ligações registradas (até 1.000), fora do recorte dos 500 |
| Agendados para retornar | telefones cuja última ligação tem retorno marcado |

Os KPIs não obedecem aos filtros da tabela: a seção diz isso. Tabela: mais recentes primeiro; **[apresentação]** a linha inteira abre o `Sheet` do contato (hoje só o nome), e a última coluna tem a próxima ação ("Ligar", "Registrar resposta" ou "Reenviar").

## Custos
Gasto no mês, conversas no mês, custo médio por conversa, acumulado. Rótulos passam a declarar o período real: "Custo médio por conversa (todo o histórico importado)" e "Acumulado (histórico importado)" (hoje "180 dias", que não é garantido).

## Correções de exibição
1. Sem `send.whatsapp`, a rota redirecionava em silêncio para `/`: passa a `EstadoSemAcesso oQueFalta="send.whatsapp"` (N8).
2. Registrar ligação/resposta sem `edit.nps`: botão desabilitado com o motivo (o servidor já recusa).
3. Carregando/erro/vazio do DS; KPIs locais → `KpiCard`; abas e filtros na URL.
4. "Atualizado há Ns" se atualiza sozinho.

## Conflito declarado (não resolvido)
A Execução estima o custo em **US$ por mensagem** (0,3217) e a aba Custos cobra em **R$ por conversa**. A tela passa a mostrar a nota "estimativa em US$ por mensagem; a cobrança real é por conversa, em R$ (aba Custos)" no diálogo de disparo. Unificar a régua é decisão do dono.

## O que NÃO entra
Mudança do valor por mensagem ou do teto de 500.
