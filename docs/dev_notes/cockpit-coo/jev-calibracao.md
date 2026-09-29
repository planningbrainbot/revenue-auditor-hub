# Calibração da triagem do Cockpit do COO (Jev), 2026-09-29

Taxonomia `cockpit-coo-triagem-v1`. 108 KRs reais (tema rotulado pelo departamento, mapa aprovado pelo COO) e 24 frases SINTÉTICAS de compromisso (unidade). Falhas de chamada: 0. Custo informado: US$ 0.003643.

## Tema (rótulo real)
| Limiar | Sugestões acima | Acerto |
|---|---|---|
| 0 | 108 de 108 | 50.9% |
| 0.5 | 86 de 108 | 52.3% |
| 0.6 | 75 de 108 | 57.3% |
| 0.7 | 68 de 108 | 61.8% |
| 0.8 | 45 de 108 | 75.6% |
| 0.85 | 38 de 108 | 78.9% |
| 0.9 | 31 de 108 | 80.6% |

## Unidade (conjunto sintético)
| Limiar | Sugestões acima | Acerto |
|---|---|---|
| 0 | 24 de 24 | 95.8% |
| 0.5 | 24 de 24 | 95.8% |
| 0.6 | 22 de 24 | 100.0% |
| 0.7 | 22 de 24 | 100.0% |
| 0.8 | 22 de 24 | 100.0% |
| 0.85 | 20 de 24 | 100.0% |
| 0.9 | 16 de 24 | 100.0% |

Temas: Growth, Financeiro e Operações, CS e RH, Monetização, Estratégico. Dados completos em `jev-calibracao.json`.

## Decisão (29/09/2026)

- **Tema: desligado.** 51% de acerto no total; 80,6% nos 31 casos acima de 0,9. Não chega aos 90% da regra da spec. As confusões mais comuns: Receitas (Monetização) lido como Growth (12), CEO/Novos Sócios (Estratégico) lido como Growth (6) e Financeiro e Operações (5). O nome de uma KR não carrega o dono; a pasta carrega. O tema de uma tarefa vem da pasta do ClickUp (mapa tema → departamento aprovado pelo COO).
- **Unidade: limiar 0,8.** 22 de 24 acima do limiar, 100% certos, em frases sintéticas. O único erro geral foi "Atualizar o manual de marca do site da matriz" → Goiânia (0,55), abaixo do limiar. Rever com tarefas reais.
- **Bloqueio: desligado** até haver comentários reais rotulados.
- **Duplicidade: 0,85, só aviso** (não impede criar).
