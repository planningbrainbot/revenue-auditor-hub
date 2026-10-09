# Contrato · Pré-venda (`/monetizacao?aba=pre-venda`)

**Dono de produto:** Pedro Luca   **Operação:** Matheus Carvalho e Heloá (pré-venda, todo dia); Paulo e Jordana na daily   **Dono do código:** Pedro Luca (tela) · Eliezek (casca, `areas.ts`, merge)   **Data:** 09/10/2026

Estado: **PRD aprovado em 09/10/2026** (https://claude.ai/artifact/VVsFAthHk5cSdd8yuLHSwg, slide 6 "A tela nova", régua no slide 5), com as decisões 1A, 2A, 3B, 4B e 5. Moldura comum: `monetizacao.md`. Contrato de dados (fonte única do formato): `monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md`. A tela consome só as quatro RPCs desse contrato.

Critério do dono para a forma: **sexy e didática; bate o olho e entende; menos texto, mais gráfico.** Nota de `KpiCard` com uma informação só; lista de atenção em caixa com borda, uma linha por item; nada de tabela linha a linha em Visão geral (DECISIONS 23/09, "Visão executiva refeita na anatomia do arquétipo").

## Propósito
Uma tela, três visões na mesma aba (`?visao=`), com controle segmentado no topo. Cada visão é uma pergunta e segue um arquétipo.

| Visão | Pergunta (vira o `<h1>`, N1) | Arquétipo |
|---|---|---|
| Ritmo (`visao` ausente ou `ritmo`) | Quem está no ritmo da cadência? | Visão geral |
| Aderência (`visao=aderencia`) | Quem segue o script, e onde pula? | Visão geral |
| Ficha › Ligações (`visao=ficha`) | O que foi dito em cada ligação? | Lista/Relatório com a Ficha ao lado (no celular, em `Sheet`) |
| Ficha › Reuniões (`visao=ficha&ficha=reunioes`) | O que foi dito e ofertado em cada reunião do pipe 39? | a tela Gravações, sem reescrever (`contratos/monetizacao-gravacoes.md`) |

- **Público:** Matheus e Heloá todo dia; todo mundo na daily (decisão 5); Pedro, Paulo e Jordana.
- **Decisão ou ação que provoca:** Ritmo: pôr em dia a cadência atrasada, card a card. Aderência: escolher a pergunta do script que a daily treina. Ficha: escutar a ligação, conferir o trecho e levar a qualificação ao sócio da área.
- **Métrica de sucesso:** "Vencidas agora" perto de zero no fim do dia; a pergunta que mais fica de fora muda de semana a semana (sinal de treino); toda ligação de 60 s ou mais com ficha.
- **Universo (`descricao`):**
  - Ritmo: "Pipe 39 · pré-venda: {quem} · {período} · abordagem = card que começou no dia (dono do card); atividade = item da cadência pelo vencimento; ligação = discada pelo ramal Api4Com".
  - Aderência: "Ligações avaliadas, a atendida mais longa de cada card (60 s ou mais) · {quem} · {período} · % de aderência ao script de 09/10".
  - Ficha › Ligações: "Uma ligação por card do pipe 39, a atendida mais longa (60 s ou mais) · {quem} · {período} · ligação".

## Números
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down (destino) | O destino bate? |
|---|---|---|---|---|---|---|
| Abordagens por dia útil | abordagens do período ÷ dias úteis do período até hoje (seg–sex, sem feriado de `feriados.ts`); nota "N em M dias úteis" | card | `monetizacao_pre_venda_ritmo.abordagens` (`started_at` do card, dono do card; leitura provisória, o Pedro vai refatorar) | carga do CRM, 5 min | o gráfico "Quantas abordagens por dia útil?" logo abaixo (a RPC devolve contagem, não cards) | — |
| Feitas hoje | itens da cadência com vencimento hoje e `feita = true`; unidade "de N previstas" | atividade | `ritmo.atividades_feitas` e `atividades_previstas` do dia de hoje | função `monetizacao-cadencia`, 5 min | — | — |
| Vencidas agora | soma das atividades vencidas e não feitas dos cards com cadência ativa; nota "em N cards" | atividade | `monetizacao_pre_venda_atrasados.vencidas` | idem | rola até a caixa "Atrasados na cadência" | sim (a caixa soma o mesmo) |
| Ligações atendidas | atendidas ÷ discadas no período; nota "N de M discadas" | ligação | `ritmo.ligacoes_atendidas` ÷ `ritmo.ligacoes` (`ops.monetizacao_ligacoes`) | idem | — | — |
| Atrasados na cadência (caixa) | um card por linha: empresa, pessoa, dia da cadência (D{n}), vencidas, próxima atividade; mais vencidas primeiro | card | `monetizacao_pre_venda_atrasados` | idem | "Abrir o card" (Pipedrive) | sim |
| Abordagens por dia (colunas) | colunas empilhadas por pessoa (Matheus `--chart-1`, Heloá `--chart-2`) em cada dia útil; dia não útil só aparece se teve abordagem; tracejado = média do período (**média, não meta**: sem meta, decisão do Paulo em 08/10) | card | `ritmo.abordagens` | idem | — (cursor não muda) | — |
| Atividades por dia | uma faixa por pessoa; barra empilhada feitas (`--chart-1`), vencidas (`danger`), a vencer (neutro) | atividade | `ritmo.atividades_*` | idem | — | — |
| % de aderência (cartão por pessoa) | média simples das notas das ligações `avaliada` da pessoa no período; nota "N ligações avaliadas"; tom ≥ 80 bom, 50–79 atenção, < 50 crítico | % (ligação) | `monetizacao_pre_venda_avaliacoes.nota` (0–100, régua do contrato de dados) | avaliação, minutos depois da ligação | Ficha › Ligações com a pessoa | sim (a lista diz "N avaliadas de M") |
| Mais fica de fora (cartão) | a pergunta P1–P4 feita no menor % das ligações avaliadas do recorte; "fora em N de M ligações" | ligação | `avaliacoes.perguntas[].feita` | idem | Ficha › Ligações com `falta=<pergunta>` | sim |
| Mapa de calor (célula) | linha de bloco (Abertura, Fechamento): crédito médio (sim 1, parcial ½, não 0); linha de pergunta (P1–P4): % das ligações em que foi feita; colunas = pessoas + "Os dois"; cor semântica sempre com o número escrito e o ícone | % | `avaliacoes.blocos` e `.perguntas` | idem | Ficha › Ligações com a pessoa e `falta=<item>` (as ligações em que o item faltou ou saiu parcial) | sim (o rótulo do clique diz quantas) |
| Evolução semanal | média das notas por semana (segunda a domingo, data da ligação em São Paulo), uma linha por pessoa; com menos de duas semanas no período vira frase | % | `avaliacoes.nota` | idem | — | — |
| Antipadrões (caixa) | ligações com cada antipadrão, uma linha por antipadrão, mais frequente primeiro; não desconta a nota | ligação | `avaliacoes.antipadroes[].chave` | idem | Ficha › Ligações com `antipadrao=<chave>` | sim |
| Lista de ligações | uma linha por card avaliado: data, empresa, pessoa, duração, nota com selo, situação (pendente e transcrevendo = "Na fila"; transcrita = "Avaliando"; avaliada; erro) | ligação | `avaliacoes` | idem | a ficha ao lado (`monetizacao_pre_venda_avaliacao`) | sim |

Nenhum número mistura unidade com outro do mesmo rótulo (N11): abordagem conta card, cadência conta atividade, aderência conta ligação.

## A ficha da ligação
Player `<audio controls preload="none">` com o link público da Api4Com; a nota em % grande com o selo da faixa e uma barra; a trilha dos 3 blocos (✔ ◐ ✘, peso de cada um) e as 4 perguntas como chips feitas/não feitas com a frente (F Finance, J Cella, T todas): clicar num deles mostra o trecho citado e a nota curta; antipadrões em vermelho com o trecho; a qualificação para o sócio (resumo, sinal por frente, quem decide, próximo passo); a transcrição por falante numa sanfona, com o trecho escolhido marcado; botão "Abrir o card".

**Acréscimos do backend (09/10, opcionais):** `blocos[].rebaixado` e `perguntas[].rebaixada` (a IA marcou sim ou parcial,
mas o trecho não está na transcrição, e virou "não"): a trilha e o chip mostram o ícone `SearchX` e o painel diz
"citado pela IA, mas o trecho não está na transcrição. Conta como não feito"; `qualificacao.frentes[].trecho` (a fala do
cliente que sustenta o sinal) aparece citada embaixo da frente; `oportunidade` ∈ `sim`, `nao`, `sem_dado` vira selo; as
colunas `tentativas`, `custo_usd`, `modelos` e `notas_em` chegam na ficha, e só `notas_em` aparece ("notas no card em…").
O nome da pessoa sai sempre do cadastro dos closers pelo `user_id` (a ficha traz o nome bruto do Pipedrive). No Ritmo,
cadência encerrada conta só a atividade feita e a que venceu antes de o card sair (regra do servidor).

**Áudio:** o app não define CSP (nem `vercel.json`, nem `<meta>`, nem `server.ts`; o `_headers` do build só tem cache).
Conferido na captura de 09/10: o `<audio>` da ficha tocou um mp3 público de outro domínio (1,46 s de 6,1 s), sem bloqueio.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | primeira leitura de cada RPC | `Carregando variante="kpis"` (Ritmo, Aderência) e `"tabela"` (lista) |
| Ainda não ativada | RPC inexistente (`PGRST202`/`42883`: migration do agente de avaliação não aplicada) | `EstadoVazio` "A Pré-venda ainda não foi ativada no banco" |
| Vazio (sem ligação avaliada) | nenhuma linha em `avaliacoes` | `EstadoVazio`: "A avaliação começa quando a ligação pelo ramal da Api4Com cair no card do pipe 39. Matheus: ramal 1023. Heloá: ramal 1020." |
| Vazio (Ritmo) | nenhuma linha em `ritmo` no período | `EstadoVazio` com o período |
| Vazio por filtro | pessoa, `falta` ou `antipadrao` sem ligação | `EstadoVazio total={n}` |
| Parcial | pessoa sem ligação avaliada no recorte | cartão `nao-apurado` e célula "—", nunca 0 (N4) |
| Erro | falha de leitura | `EstadoErro` com a fonte e "Tentar de novo" |
| Sem acesso | sem `view.monetizacao` | `EstadoSemAcesso oQueFalta="view.monetizacao"` (moldura) |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `aba` | `pre-venda` | — | a tela |
| `visao` | `ritmo`, `aderencia`, `ficha` | `ritmo` (fora da URL) | a visão |
| `de`, `ate` | `aaaa-mm-dd` | 1º dia do mês corrente → hoje (São Paulo) | Ritmo, Aderência, Ficha › Ligações |
| `responsavel` | `28381245` (Matheus), `28897937` (Heloá) | os dois | Ritmo, Aderência, Ficha › Ligações |
| `ficha` | `reunioes` | Ligações | Ficha |
| `ligacao` | id do card | a primeira da lista (só no desktop) | a ficha aberta |
| `falta` | `abertura`, `momento`, `capital`, `porte`, `teses`, `fechamento` | nenhum | lista de ligações |
| `antipadrao` | chave do antipadrão | nenhum | lista de ligações |
| `mes`, `gravacao`, `q`, `reuniao` | os da tela Gravações | — | Ficha › Reuniões |
| `aposentada` | `gravacoes`, `pessoas` | — | aviso de tela que saiu do menu (N14) |

Trocar de visão mantém período e pessoa e limpa o resto. Links antigos: `?aba=gravacoes` abre Pré-venda › Ficha › Reuniões e `?aba=pessoas` abre Pré-venda › Aderência, os dois com o aviso "{tela}: esta tela saiu do menu em 09/10/2026" (o mesmo do PR #71), preservando `reuniao`, `mes`, `gravacao` e `q`.

## Permissões (N8)
- Área `monetizacao` (`view.monetizacao`), como toda a Monetização.
- **Decisão 4B:** todos que veem a Monetização veem tudo, inclusive Matheus e Heloá as fichas um do outro. A tela não aplica trava por closer, e as quatro RPCs também não (contrato de dados).
- Ficha › Reuniões continua com a trava das RPCs de Gravações (`monetizacao_gravacoes_lista`/`monetizacao_gravacao`: closer vê só as próprias reuniões). Tirar essa trava é migration, fora desta tela; ver "Em aberto".

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Ouvir a ligação | quem vê a tela | — | player nativo |
| Abrir o card | idem | — | Pipedrive em aba nova |
| Trocar visão, pessoa, período, item que falta | idem | — | URL |

A tela não grava nada.

## O que NÃO entra, e por quê
- Meta, comissão e forecast: o Paulo congelou em 08/10 até a capacidade ser medida. O tracejado do Ritmo é média.
- Score de qualidade do Growth (0 a 5): decisão 2A, uma nota só, a aderência em %.
- Ranking aberto entre as pessoas e PDI gerado por IA: fora desta rodada (PRD, slide 7).
- O formulário manual de PDI (antiga "Pessoas e PDI"): saiu do menu e do código (decisão 1A). Os registros em `ops.monetizacao_registros` ficam no banco.
- Tabela linha a linha no Ritmo e na Aderência (arquétipo Visão geral): a lista mora na Ficha.

## Para onde manda (tela dona)
- Card no Pipedrive (caixa de atrasados e ficha).
- Ficha › Ligações a partir dos cartões, do mapa de calor, da pergunta que mais falta e dos antipadrões.

## Em aberto
- Ficha › Reuniões ainda tem a trava por closer no servidor (Gravações, 02/10). A decisão 4B pede tudo aberto; mudar a RPC é migration (dono: Pedro).
- A evolução semanal com o período padrão (mês corrente) tem poucas semanas; DESIGN §5 pede 4 pontos para gráfico de linha. Com menos de duas semanas, a tela escreve a frase em vez do gráfico.

## Checagem
- [x] Contrato, arquétipo, `PageHeader` com pergunta e universo, estados, filtros na URL, procedência.
- [x] `design:lint:changed` sem violação nos arquivos tocados (a catraca V21 de `meus-servicos.tsx` vem do main).
- [x] Capturas claro, escuro e celular com os dados de exemplo em `docs/design/capturas/pre-venda/`, comparadas com a
  vitrine (`capturas/depois/*-arquetipos.png`, Visão geral e Lista/Relatório).
- [ ] Números conferidos na fonte (recontagem independente): depende das RPCs aplicadas e da primeira ligação avaliada.
