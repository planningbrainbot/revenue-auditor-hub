# Antes × depois · Cockpit do CEO no Design System v2

Capturas do preview sintético (`/piloto/cockpit-ceo`, sem login e sem banco), 1440×900 e página inteira, temas escuro e claro: `node scripts/cockpit-ceo/capturar-ds.mjs <rotulo>`. "Antes" é o commit `2b71c2a` (piloto trazido para a base nova, ainda sem DS); "depois" é esta branch. Contrato: `docs/design/contratos/cockpit-ceo.md`.

| Vista | Antes | Depois |
|---|---|---|
| Visão executiva | `antes/<tema>-executiva-*.png` | `depois/<tema>-executiva-*.png` |
| Receita e crescimento | `antes/<tema>-receita-*.png` | `depois/<tema>-receita-*.png` |
| Clientes e produtos | `antes/<tema>-clientes-*.png` | `depois/<tema>-clientes-*.png` |
| Execução comercial | `antes/<tema>-comercial-*.png` | `depois/<tema>-comercial-*.png` |
| Saúde da rede | `antes/<tema>-rede-*.png` | `depois/<tema>-rede-*.png` |
| Retenção e entrega | `antes/<tema>-retencao-*.png` | `depois/<tema>-retencao-*.png` |
| Capital e evidências | `antes/<tema>-capital-*.png` | `depois/<tema>-capital-*.png` |

## O que mudou na tela

| Aspecto | Antes | Depois | Regra |
|---|---|---|---|
| Cabeçalho | `<h1>` "Cockpit do CEO" e uma linha de universo | `PageHeader`: área, item do menu, pergunta como título, universo medido, procedência da carga com régua | N1, N3 |
| Números | 6 cartões próprios em 3 colunas, estado num selo solto | 6 `KpiCard` numa faixa: estado do dado (não apurado, parcial, sem acesso) no lugar de 0, ritmo da meta ao lado do valor, variação com `Degrau` quando há base, procedência no rodapé, clique abre a composição | N2, N4, N12, N13, V10 |
| Decisões e ameaças | painel lateral + bolinhas vermelha/âmbar | seção "O que pede atenção?": até 3 decisões com destino; ameaças com `StatusBadge` (ícone + palavra) | N12, V7 |
| Frentes | 6 abas dentro da página | 6 itens da lateral (`?frente=`), cada um com a própria pergunta no `PageHeader`; sem abas | N6, N7 |
| Gráficos | cores e eixos escritos à mão | tema de gráfico (`CORES_SERIE`, `eixoProps`, `gradeProps`, `tooltipProps`, `legendaProps`) | V8 |
| Coortes | fundo verde/âmbar/vermelho com cortes de 95/85/70% que ninguém decidiu | escala de um tom só, proporcional à retenção | DESIGN §5 |
| Cor e fonte | 31 cores cruas de status, 29 fontes < 12px, 2 `text-primary` em texto | 0 (lint limpo) | V3, V4, V21 |
| Destinos | contas prontas → "Base de clientes"; rede → `/royalties` (redirect silencioso) | contas prontas → Produtos e listas; rede → Apuração de Royalties `/unidades/royalties` | N2, N14 |

Regras de cálculo, consultas, `portas.ts`, RLS e homologação não mudaram (testes do cockpit: os mesmos 92, verdes).
