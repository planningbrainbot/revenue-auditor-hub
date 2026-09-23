# docs/design · Como mexer em tela no Planning Brain

Regra que não está no repositório que o agente abre não existe para ele. Por isso o design system do Brain mora aqui (spec `docs/superpowers/specs/2026-09-23-design-system-v2-design.md` §2.1). Vale para humano e para agente, em tela nova ou alterada.

## Ordem de leitura

Antes de tocar em qualquer arquivo de `src/routes/` ou `src/components/`:

1. **Este README**: a definição de pronto abaixo.
2. **`PRODUCT.md`**: para que serve o Brain, quem usa, o que o módulo deve provocar e o que ainda não está decidido. Se a tarefa esbarra numa "decisão pendente", pare e pergunte ao dono.
3. **`NAVEGACAO.md`**: as regras N1–N14 e o mapa do menu. Onde a tela entra e com que nome.
4. **`ARQUETIPOS.md`**: escolha um dos cinco (Visão geral, Fila de trabalho, Lista/Relatório, Ficha, Configuração) e siga a anatomia.
5. **`CONTRATO-DE-TELA.md`**: preencha o contrato **antes** do código.
6. **`DESIGN.md`**: tokens, marca, gráficos, ícones e regras V1–V19 na hora de escrever JSX.
7. `DECISIONS.md` (raiz): o que já foi decidido sobre o módulo que você vai tocar.

`REFERENCIAS.md` só é lido numa rodada de pesquisa, nunca no meio da tarefa.

## Índice

| Arquivo | Responde |
|---|---|
| `PRODUCT.md` | objetivo, públicos, módulos, decisões pendentes |
| `NAVEGACAO.md` | regras de navegação (N), mapa atual, estrutura alvo (proposta) |
| `ARQUETIPOS.md` | os cinco tipos de página, anatomia e rotas de cada um |
| `CONTRATO-DE-TELA.md` | template e três exemplos preenchidos |
| `DESIGN.md` | sistema visual e regras verificáveis (V) |
| `PROCESSO.md` | quem decide o quê (Pedro, Mika, Eliezek), como integrar esta branch, fluxo de toda tela nova, ordem de migração |
| `REFERENCIAS.md` | fontes externas curadas e a lista "não use" |
| `contratos/` | contratos aprovados, um por rota (`<rota>.md`) |
| `diagnostico/` | os cinco relatórios de 23/09/2026 que fundamentam tudo acima |
| `capturas/` | antes/depois da vitrine e da casca |
| `medicoes.md` | contagens do `design:lint` (baseline e atual) |

Código: tokens em `src/styles.css`; componentes em `src/components/planning/` (`PageHeader`, `Secao`, `KpiCard`, `KpiGrade`, `StatusBadge`, `EstadoVazio`, `EstadoErro`, `EstadoSemAcesso`, `Carregando`, `Procedencia`, `Degrau`, `AnelArea`, `GradeCirculos`, `BarraFiltros`); helpers em `src/lib/planning/`. Vitrine em `/vitrine` (só em desenvolvimento).

## Definição de pronto de tela

Uma tela só está pronta quando todos os itens valem. Copie a lista para o PR.

- [ ] **Contrato preenchido** (`CONTRATO-DE-TELA.md`), com "o que não entra" e "para onde manda".
- [ ] **Arquétipo declarado** no contrato, e a tela segue a anatomia dele.
- [ ] **`PageHeader`** (ou `AppShell`, que o renderiza) com `titulo` igual ao item do menu, `pergunta` e `descricao` com o universo medido (N1).
- [ ] **Estados**: carregando (`Carregando`), vazio (`EstadoVazio`, com `total` quando é filtro), erro (`EstadoErro`), sem acesso (`EstadoSemAcesso`), e nenhum `0` no lugar de dado ausente (N4).
- [ ] **Drill-down**: todo número clicável abre os registros que o compõem e o total do destino bate, ou a tela avisa (N2).
- [ ] **Procedência**: fonte, data de atualização e régua visíveis (N3).
- [ ] **Filtros, período e aba na URL**: recarregar e colar o link reproduz a tela (N7).
- [ ] **`npm run design:lint` limpo** nos arquivos tocados (V1–V6 sem erro novo).
- [ ] **Captura** da tela ou do arquétipo na vitrine, tema escuro e claro, anexada ao PR ou salva em `docs/design/capturas/`.
- [ ] **Entrada no `DECISIONS.md`** se a tarefa decidiu algo não óbvio (nome, régua, o que saiu da tela).

Tela que não cumpre um item por motivo legítimo diz qual e por quê no PR. "Depois eu arrumo" não é motivo.

## Quando a regra não cobre o caso

Não invente e não pesquise no meio da tarefa. Registre a lacuna no PR, siga o arquétipo mais próximo e avise o dono do módulo (`PRODUCT.md` §4). A lacuna vira regra aqui numa rodada separada (`REFERENCIAS.md`).
