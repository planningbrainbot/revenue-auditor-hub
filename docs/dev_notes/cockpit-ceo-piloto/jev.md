# Jev real no piloto do Cockpit do CEO — 22/09/2026

## O que foi feito

Três requisições reais ao `POST https://openrouter.ai/api/alpha/decisions`, modelo pedido
`typesafe/jev-1.13`, todas com texto fictício, sem retry, pelo adaptador de servidor
`src/lib/cockpit-ceo/jev/`. Registro por chamada em `jev-chamadas.jsonl` (sem texto analisado, sem
credencial) e resposta completa do teste de e-mail em `jev-live-20260923T012414Z.json`.

| # | Exemplo | Modelo retornado | Duração medida | Custo informado (`usage.cost`) | Tokens |
|---|---|---|---:|---:|---|
| 1 | E-mail fictício (Empresa Exemplo Alfa) | typesafe/jev-1.13-20260917 | 873 ms | US$ 0,000025368 | 604 / 97 |
| 2 | Pergunta do CEO: ritmo de contratos | typesafe/jev-1.13-20260917 | 711 ms | US$ 0,00002919 | 695 / 108 |
| 3 | Pergunta do CEO: evidência de retenção | typesafe/jev-1.13-20260917 | 429 ms | US$ 0,000029232 | 696 / 108 |

Total informado pelo fornecedor: **US$ 0,00008379** em 3 de 10 requisições permitidas. Duração é a
medida no servidor do piloto (inclui rede), não a latência do modelo.

### Teste real: e-mail fictício, três perguntas

> "Olá! Na Empresa Exemplo Alfa precisamos entender se a revisão tributária se aplica ao nosso caso.
> Já temos contador e gostaria de conversar com um especialista antes de decidir. Vocês conseguem
> explicar o serviço?"

| Pergunta | Primitiva | Resposta real |
|---|---|---|
| Qual a intenção principal? (conhecer, proposta, suporte, outro, insuficiente) | `choice` | `conhecer`, confiança 1,00; probabilidades conhecer 1,00, demais 0 |
| Força da intenção comercial explicitamente demonstrada (0 ausente · 1 exploratória · 2 pedido concreto) | `score` | 1,0 (exploratória), confiança 1,00 |
| A mensagem pede conversa com uma pessoa? | `noul` | 0,92 (sem campo de confiança, por definição da primitiva) |

### Preview: encaminhamento de pergunta do CEO

| Pergunta fictícia | Frente sugerida | Confiança | Pede dado verificável (`noul`) |
|---|---|---:|---:|
| "Por que os contratos ganhos deste mês estão abaixo da meta, e qual produto está puxando para baixo?" | Execução comercial (0,92; Receita e crescimento 0,08) | 0,90 | 0,91 |
| "Que evidência mostramos a um investidor sobre quem continua com a gente depois de um ano?" | Retenção e entrega (0,99; Capital e evidências 0,01) | 0,98 | 0,89 |

No preview, o painel "Pergunte ao cockpit" marca o resultado como **sugestão de IA, não dado
verificado**, mostra a pergunta encaminhada, a distribuição, modelo, duração, custo e tokens, e o
botão abre a frente sugerida — cujos números vêm do cálculo do Brain, não do Jev. Capturas:
`capturas/07-jev-ritmo-contratos.png`, `07-jev-investidor-retencao.png`,
`08-jev-abre-frente-sugerida.png`.

## Como ler esses números

- Três respostas provam conectividade, contrato e custo nesta forma de pedido. **Não provam
  qualidade**: nenhuma delas foi comparada com um rótulo humano, e os exemplos foram escritos para
  serem claros.
- `confidence` resume o formato da distribuição. Confiança 1,00 não é "100% de certeza de estar
  certo". O limiar 0,5 do painel é provisório (orientação da TypeSafe) e não foi validado.
- A segunda pergunta de roteamento era a candidata a ambígua (retenção × capital) e veio com 0,98 em
  Retenção. Isso não diz se a escolha é a que o CEO esperaria; diz que o modelo não viu ambiguidade.
- Custo por mil chamadas, extrapolado das três observadas e do tamanho deste pedido: na ordem de
  US$ 0,03. É extrapolação de 3 chamadas, não custo medido da Planning.

## Contrato e controles

- Pedido validado antes de sair; `criteria` nas três primitivas (no `noul`, `"true"`/`"false"`),
  exigidos pelo schema do OpenRouter. O `jev_bridge.py` preparado para o piloto não mandava critérios
  no `noul`.
- Resposta validada contra a taxonomia e os intervalos (choice dentro das opções, score em 0..n−1,
  noul em 0..1, modelo `typesafe/jev-*`). As respostas reais vieram com `type` em cada item e
  probabilidades do score com chaves `"0".."2"`, como a documentação descreve.
- Uma requisição por pedido, sem retry; tempo limite de 20 s; teto de 10 requisições e US$ 0,10;
  custo ausente bloqueia as próximas; reserva gravada antes da chamada; trava entre processos; ledger
  em caminho fixo. Esse controle é posterior à cobrança de cada chamada e **não substitui o teto de
  crédito configurado na chave**.
- Chave lida do Keychain do macOS (serviço `planning-openrouter-cockpit-piloto`) só no servidor.
  Nunca em variável `VITE_*`, bundle, arquivo, log ou Git — conferido por busca no repositório e no
  bundle de produção.
- Só liga com `COCKPIT_JEV_PILOTO=1` e fora de produção; a server function aceita apenas o id de uma
  pergunta fictícia.

## Incidente de credencial

A chave foi colada no chat da sessão (não pedida). Foi gravada no Keychain a partir dali, pela
entrada padrão do `security`, e não aparece em nenhum arquivo do repositório. Como está no histórico
da conversa, **deve ser tratada como exposta: revogar no OpenRouter ao fim do piloto** e remover do
Keychain:

    security delete-generic-password -a planning -s planning-openrouter-cockpit-piloto

## Parecer de adoção

Usar como **sugestão de encaminhamento**, nunca como automatismo, até haver avaliação própria:
conjunto rotulado em português com casos claros, ambíguos, contraditórios e fora de escopo, separado
dos exemplos que ajustaram os critérios; acerto por classe, falsos positivos, encaminhamentos à
revisão, p50/p95 de duração e custo por mil. Produção continua desligada. Nenhum dado real foi
enviado; antes de enviar texto privado é preciso autorização do escopo (finalidade, campos, amostra
redigida, retenção no OpenRouter/TypeSafe).
