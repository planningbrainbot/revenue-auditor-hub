# Contrato · Perguntar ao Brain (`/cockpit-ceo/perguntar`)

**Dono de produto:** Pedro Luca   **Usuário:** CEO e sócios da matriz com a área `cockpit_ceo`   **Dono do código:** Pedro Luca (tela) · Eliezek (casca, publicação)   **Data:** 24/09/2026

Estado: **implementada sob pedido explícito do Pedro em 24/09** ("implementação testada, não proposta"). Falta o "contrato ok" formal (PROCESSO §4) antes do merge.

## Propósito
- **Pergunta (`<h1>`, N1):** "O que você quer saber sobre a empresa?"
- **Público:** quem tem a área `cockpit_ceo`.
- **Decisão ou ação que provoca:** responder em uma frase, com o gráfico ou a tabela que prova a frase e o caminho para a tela dona; salvar a visão para rever depois.
- **Métrica de sucesso:**
  - a resposta cita só números que vieram de consulta;
  - refinar ("agora só a base nova") muda o recorte sem repetir a pergunta;
  - uma visão salva reabre com os números de agora.
- **Arquétipo:** nenhum dos cinco cobre exatamente. **Lacuna registrada:** a tela é exploratória, e o mais próximo é **Lista/Relatório**, com um recorte, um gráfico que responde e filtros visíveis. A lacuna vai para a rodada de referências (`REFERENCIAS.md`).
- **Universo (`descricao`):** "Empresa inteira no seu acesso · os números saem das mesmas fontes e regras do cockpit · conversas e visões são só suas".

## Números
Não há número fixo na tela. Cada bloco da área visual é o resultado de uma consulta do catálogo fechado (`src/lib/cockpit-ceo/conversa/metricas.ts`), e cada consulta usa as mesmas funções do cockpit:

| Consulta | Contrato de origem |
|---|---|
| indicador | `contratos-indicadores.md` |
| série de faturamento, ponte, variação por chave, ranking de unidades | leituras grupo e rede e ponte (Receita e trajetória) |
| aquisição mensal e funil | Growth |
| onboarding, cadeia | Operação e capacidade |
| caixa | Caixa e margem |
| coortes, clientes ativos | Retenção; Clientes |
| portfólio | primeira fatia da Monetização |
| ações, frescor | regras fixas do cockpit; frescor das fontes |

Todo bloco mostra:
- o recorte aplicado;
- a fonte, sem nome de tabela;
- a data do dado;
- até dois avisos;
- o destino "Abrir…" para a tela dona (N2).

Número de texto sem origem sai da resposta, e o descarte fica registrado.

## Estados
| Estado | O que a tela mostra |
|---|---|
| Consultando | etapas reais em linha ("Entendendo a pergunta", "Consultando os dados", "Conferindo os números") e o botão Cancelar |
| Resposta ok | conclusão, blocos, próximas perguntas |
| Esclarecimento | a pergunta de volta, com opções clicáveis |
| Fora do escopo | frase fixa, sem modelo |
| Sem dado numa consulta | bloco com `StatusBadge` "Não apurado", "Fonte indisponível" ou "Sem acesso" e o motivo; nunca 0 |
| IA pausada (teto de consumo) | selo "IA pausada" e a frase "os painéis do cockpit continuam funcionando" |
| Falha do provedor | "Não consegui montar a resposta agora. Nenhum número foi mostrado…" e o botão Tentar de novo |
| Sem acesso | `EstadoSemAcesso` pedindo a área Cockpit do CEO |

## Filtros na URL (N7)
- `conversa`: id da conversa aberta.
- `visao`: id da visão salva aberta.

Os controles de período, leitura, base, produto e unidades valem para a visão mostrada e ficam na definição que se salva.

## Permissões (N8)
- **Área:** `cockpit_ceo`, conferida no servidor antes de qualquer leitura (rota SSE e funções de servidor).
- **Leituras:** cada leitura confere de novo a porta da própria fonte (`portas.ts`, porta do Financeiro), com a sessão da pessoa.
- **Tabelas da conversa** (conversas, mensagens, visões, consumo): RLS "só o dono" mais a área (migration `20260925000000`).
- **Unidade fora do escopo:** não é lida, e a resposta não diz se ela existe.
- **Jev e o modelo:** não concedem permissão nenhuma.

## Ações
| Ação | Confirmação | Retorno |
|---|---|---|
| Perguntar / Cancelar | — | etapas em linha; resposta ou "Consulta cancelada" |
| Mudar filtro | — | a visão consulta de novo, com o rótulo "Filtros alterados" |
| Salvar / renomear visão | diálogo com nome | toast |
| Excluir visão ou conversa | `AlertDialog` | toast |

## O que NÃO entra, e por quê
- **SQL livre, HTML ou código do modelo:** a segurança depende do catálogo fechado.
- **Nomes de cliente e CNPJ:** as consultas só devolvem agregado.
- **Número guardado como atual:** a visão salva guarda a definição, não os números.
- **Tokens do modelo antes da conferência:** o texto chega já conferido; o stream mostra as etapas.

## Para onde manda
As frentes do cockpit, o Painel de CS, a Apuração de Royalties e o Brain Financeiro, pelo destino de cada bloco.
