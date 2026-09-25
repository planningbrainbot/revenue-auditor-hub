# Avaliação dos modelos da conversa (25/09/2026)

**Escolha: `openai/gpt-5.5`.** A alternativa barata é `openai/gpt-5.4-mini`, e a troca é só a variável `COCKPIT_CONVERSA_MODELO`.

## Por que OpenAI e não Claude

O plano era comparar Claude Sonnet 5 com Opus 5.5 pelo OpenRouter, mas a conta do OpenRouter está sem crédito. O Pedro forneceu uma chave da OpenAI e escolheu "OpenAI, escolha por avaliação". Os candidatos foram GPT-5.5 e GPT-5.4-mini. O Jev ficou desligado nas duas rodadas, por decisão do Pedro.

## Como foi medido

- **Conjunto:** 24 casos em `perguntas.json`, cobrindo:
  - perguntas simples e de vários domínios;
  - refinamentos em duas mensagens;
  - ambiguidade de receita, cliente ativo e período;
  - mês parcial e fonte desatualizada;
  - unidade inexistente;
  - duas injeções de instrução;
  - visualização sem dado;
  - réguas que não se somam;
  - fora do escopo.
- **Percurso:** real, pela rota `/api/cockpit-ceo/conversa`, com a sessão do Pedro e a carga real.
- **Gabaritos:** conferidos por SQL independente, só leitura:
  - faturamento de 08/2026 = R$ 7.455.047,01 (Financial Brain);
  - onboarding parado há mais de 30 dias = 95;
  - Curitiba, Belém e Patos de Minas, por mês e no acumulado (apuração confirmada).
- **Critérios por caso:**
  - estado esperado;
  - consulta e filtro certos;
  - tipo de visual;
  - número conferido com o gabarito;
  - nenhuma frase retirada pela conferência;
  - texto obrigatório;
  - nada proibido.
- **Teto:** ledger cumulativo de US$ 5 (`ledger.jsonl`). Gasto total nas duas rodadas: **US$ 1,31**.

## Resultados (rodada 2, `resultado-2026-09-251523.json`)

| | GPT-5.4-mini | GPT-5.5 |
|---|---|---|
| Aprovados | 23/24 | **24/24** |
| Consulta e filtro certos | 23 | 24 |
| Número = gabarito | 24 | 24 |
| Sem frase retirada | 24 | 24 |
| Latência mediana / p90 | 6,5 s / 10,3 s | 6,9 s / 13,0 s |
| Custo médio por pergunta | US$ 0,0039 | US$ 0,0229 |

A primeira pergunta de cada sessão leva de 30 a 38 s, porque carrega todas as fontes; as seguintes saem do cache de 10 minutos.

## O que a rodada 1 mostrou e foi corrigido antes da rodada 2

**Erros do avaliador:**
- as somas por unidade faltavam no gabarito;
- P5 exigia um único gabarito;
- I2 reprovava a recusa correta por citar "R$ 50";
- ajuste de bloco contava como invenção.

**Rigidez do sistema:**
- bloco em formato incompatível derrubava a visão inteira; agora o bloco é ajustado ou descartado sozinho;
- "2025-06" virava o número −6;
- o horizonte da coorte e os parâmetros da visão anterior não contavam como origem.

**Defeito real de infraestrutura:** a carteira da Monetização falhava no servidor por estouro de tempo e o erro ficava 10 minutos no cache. Agora há uma nova tentativa, e carga com parte em erro vale só 30 s.

**Instrução nova:** pergunta fora do escopo é recusada em uma frase, sem pedir esclarecimento. Com o Jev desligado, era esse o caminho que falhava.

**Erros reais de modelo na rodada 1:**
- GPT-5.4-mini, três:
  - pediu esclarecimento sobre o restaurante;
  - somou duas unidades por conta própria;
  - calculou "10 negócios acima".

  As duas contas foram retiradas pela conferência.
- GPT-5.5: nenhum. As reprovações dele foram todas do avaliador ou da infraestrutura.

## Decisão

- O GPT-5.5 ganha em confiabilidade: segue melhor a instrução de declarar a régua usada e não fez conta própria.
- A latência é praticamente igual à do mini.
- O custo absoluto é baixo: com o teto padrão de US$ 20/mês, cabem cerca de 870 perguntas.
- Se o volume crescer, o mini é a alternativa. A conferência de números segura o risco de conta própria, porque retira a frase.

## Limites desta avaliação

- Os casos de falta de permissão para outra pessoa não rodam com a conta do Pedro, que é admin. Eles estão cobertos pela RLS provada e pelos testes da camada de consultas.
- Falha de Jev, modelo e ferramenta está coberta pelos testes com modelo simulado.
- Claude não foi avaliado, por falta de crédito no OpenRouter.
- O custo da OpenAI é estimado pelos tokens com a tabela oficial de 25/09. A OpenAI não devolve o custo por chamada.
