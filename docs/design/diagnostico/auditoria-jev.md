# Auditoria do Jev · design system v2

O Jev (`typesafe/jev-1.13`, pela API de decisões do OpenRouter) é um classificador de rubrica fechada. Ele responde perguntas de escolha, de nota e de sim/não. Não faz crítica livre. Por isso a rubrica foi escrita antes: sete perguntas, cada uma com os documentos que a respondem no `state`. O limite de entrada é de cerca de 16–24 mil caracteres por chamada, e acima disso ele devolve `max_tokens_exceeded`. Script da auditoria: `jev_auditar.py`, no scratchpad da sessão. A chave vem do Keychain e nunca é gravada.

| Pergunta | Tipo | Rodada 0 (só documentos) | Rodada 1 (código + capturas) | Meta |
|---|---|---|---|---|
| A conclusão sobre a hipótese do Pedro tem evidência? | choice | confirma_com_evidencia (1,0) | confirma_com_evidencia (1,0) | confirma ou nega com evidência |
| Paleta, logo e fonte oficiais mantidos; elementos novos derivados da marca | noul | 0,91 | 0,92 | > 0,5 |
| Regras de navegação e visuais verificáveis | score 0–3 | 2,73 | 2,78 → **2,99*** | ≥ 2 |
| Cada tela ligada a uma ação de negócio | score 0–3 | 2,99 | 2,98 | ≥ 2 |
| Processo de subida (papéis, portão, ordem, conflito) | score 0–3 | 3,00 | 3,00 | ≥ 2 |
| **Impacto visual medido antes/depois** | score 0–3 | **0,04** (reprovado: nenhuma tela mudou) | **3,00** | ≥ 2 |
| Contém dado de terceiro ou pessoal sensível | noul | 0,08 | 0,08 | < 0,5 |

\* Na rodada 1, a pergunta de regras recebia os 8 mil primeiros caracteres de `NAVEGACAO.md` e de `DESIGN.md`, e a seção de regras visuais (§10) começa depois do caractere 16 mil, então ficava de fora. A correção foi mandar só as seções de regra (N1–N14 e V1–V21). Com isso a nota foi para 2,99.

O loop parou quando todas as perguntas passaram. Foram 17 chamadas, US$ 0,0031 no total.

O que o Jev **não** avalia: se a pergunta de cada tela é a certa, se o drill-down bate com a fonte e se a tela é agradável de usar. Isso é revisão humana (`PROCESSO.md` §5) e teste com as pessoas que usam o Brain.
