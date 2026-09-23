# REFERENCIAS.md · De onde vêm as regras, e como um agente usa cada fonte

Fonte: `diagnostico/pesquisa-referencias.md` (pesquisa de 23/09/2026; estrelas e atividade conferidas pela API do GitHub nessa data).

## A regra

**Pesquisa de referência não acontece no meio de tarefa de dev. Acontece aqui, vira regra, e a tarefa lê a regra.**

Por quê, em mecânica (`pesquisa-referencias.md` §6):
1. A busca devolve o topo de SEO, não o canônico; o agente não tem critério para descartar listicle.
2. O agente não vê imagem pelo WebFetch: galeria vira lista de legendas.
3. O que volta é resumo de resumo ("use hierarquia clara"), que é o próprio padrão do modelo.
4. No meio da tarefa o objetivo dominante é compilar; a pesquisa vira cerimônia.
5. Nada persiste: a tela seguinte pesquisa de novo e chega a outra conclusão. **Esta é a causa do "sem nexo" entre telas.**
6. Sem critério de aceite de design, tela feia e desconectada também "passa".

Como fica na prática:
- Tarefa de tela lê `README.md` → `DESIGN.md` → `NAVEGACAO.md` → `ARQUETIPOS.md` e preenche o `CONTRATO-DE-TELA.md`. Não abre navegador para "buscar inspiração".
- Se a regra não cobre o caso, a tarefa **para e registra a lacuna** (no PR ou no `DECISIONS.md`). Uma rodada de pesquisa separada, com humano, destila a fonte em regra e atualiza estes arquivos.
- Referência visual entra como **arquivo escolhido por humano** (3 a 5 capturas salvas em `docs/design/capturas/referencias/`), lida com `Read`, nunca como URL de galeria.

---

## 1. O stack: três camadas e um portão

| Camada | Fonte escolhida | Onde vira regra neste repo |
|---|---|---|
| (i) Regras de estrutura e navegação | **SAP Fiori floorplans** + **Pencil & Paper** + estados do **GitHub Primer** | `ARQUETIPOS.md`, `NAVEGACAO.md`, estados em `DESIGN.md` e `CONTRATO-DE-TELA.md` |
| (ii) Sistema visual e tokens | spec v2 (paleta oficial da Planning) no formato de tokens por papel; **Google DESIGN.md** como formato candidato; **tweakcn** para ajuste visual | `DESIGN.md` + `src/styles.css` |
| (iii) Componentes e blocos | **shadcn/ui** (charts, blocks, registry, MCP) com a casca do **shadcn-admin** como referência de código; Recharts como padrão | `src/components/ui/`, `src/components/planning/` |
| **Portão** | lint determinístico + captura de tela contra o arquétipo declarado | `npm run design:lint`, `/vitrine`, `scripts/design/capturar.mjs` |

Sem o portão, as três camadas viram sugestão (`pesquisa-referencias.md` §3). A evidência mais sólida da pesquisa (UI-Bench, 4.000+ julgamentos humanos, https://arxiv.org/abs/2508.20410) é que o que separa ferramentas boas é orquestração, biblioteca de templates e curadoria, não o modelo.

---

## 2. Top 10 e como o agente consome cada uma

| # | Fonte | URL | Como o agente consome | Não fazer |
|---|---|---|---|---|
| 1 | shadcn/ui charts + blocks + skill/MCP | https://ui.shadcn.com/blocks · https://ui.shadcn.com/charts · https://ui.shadcn.com/docs/mcp · https://ui.shadcn.com/llms.txt | antes de criar componente, procura no registry (MCP `shadcn` já configurado em `PM Work/.mcp.json`); instala e depois aplica os tokens v2 | usar block sem tokens próprios (todo app shadcn fica igual) |
| 2 | SAP Fiori floorplans | https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/when-to-use-which-floorplan | já destilado em `ARQUETIPOS.md`; o agente lê o arquivo, não o site | copiar a estética SAP |
| 3 | Pencil & Paper (tabelas, filtros, dashboards, navegação, vazio, loading) | https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables (e artigos irmãos) | destilado em regras de `ARQUETIPOS.md` (Lista, Fila) e `NAVEGACAO.md` (N5, N7); novas regras entram por rodada de pesquisa | mandar o agente "ler o site" ao vivo |
| 4 | Google DESIGN.md (formato + CLI) | https://github.com/google-labs-code/design.md | formato candidato para `DESIGN.md` com tokens em YAML e lint de contraste; adoção fica para depois do v2 (alpha) | trocar o formato no meio da branch |
| 5 | tweakcn | https://tweakcn.com | humano ajusta o tema visualmente e exporta variáveis; agente só consome o CSS resultante | agente "escolher" tema |
| 6 | impeccable (detector de 61 regras) | https://github.com/pbakaus/impeccable | candidato a segundo portão ao lado do `design:lint`; ajustar a config (proíbe fontes que não nos afetam; comandos "bolder/colorize" puxam para marketing) | rodar `colorize`/`bolder` em tela do Brain |
| 7 | IBM Carbon — data viz e dashboards | https://carbondesignsystem.com/data-visualization/dashboards/ | destilado junto com a skill `dataviz` em `DESIGN.md` §5 | — |
| 8 | GitHub Primer UI patterns | https://primer.style/product/ui-patterns/ | estados vazio, carregando, erro e degradado viraram `EstadoVazio`, `Carregando`, `EstadoErro`, `EstadoSemAcesso` e N4 | copiar o vocabulário do GitHub sem adaptar |
| 9 | satnaing/shadcn-admin | https://github.com/satnaing/shadcn-admin | referência de código para a casca e a data table (filtro facetado, paginação, ações em massa); o agente lê arquivos específicos de um clone à parte | fazer fork ou copiar a estrutura de pastas |
| 10 | Vercel Web Interface Guidelines | https://github.com/vercel-labs/web-interface-guidelines | regras de interação (estado na URL, foco, teclado, `tabular-nums`) já refletidas em N7 e V9/V12; pode entrar como skill de revisão | aplicar as regras específicas de Next.js ao TanStack |

Menções: **Mobbin** (MCP pago, em beta; útil numa rodada de pesquisa de fluxo, como a ficha de cliente), **NN/g** (fundamento para separar dashboard operacional de analítico, https://www.nngroup.com/articles/dashboards-preattentive/), **Tremor** (ler os blocks de KPI, não instalar), skill local **`dataviz`** (validador de paleta; obrigatória antes de mexer em cor de gráfico).

Referências internas que valem mais que qualquer externa:
- `PM Work/planning-design-system/` (marca, `dataviz-guide.md`, `patterns.md`); congelado em 21/07 e em Tailwind v3, mas é a fonte da paleta.
- A camada `components/planning` do Brain Financeiro (único app da casa que já usa o DS).
- Capturas do Cockpit do CEO (piloto) em `docs/dev_notes/cockpit-ceo-piloto/capturas/` do worktree do piloto: o padrão visual mais coeso da casa.
- O dashboard do Conciliador como **método** (contrato de significado, lógica testada fora da tela), nunca como marca (`conciliador.md` §5).

---

## 3. Não use

| Fonte | Por quê |
|---|---|
| Dribbble / Behance | imagem feita para ganhar like, com dado fictício bonito e sem estados; o agente só recebe a legenda |
| Magic UI / Aceternity | efeitos de landing page; tiram atenção do dado e custam performance |
| ui-ux-pro-max-skill | catálogo de estilos: empurra o agente a escolher um estilo por tela, o oposto de coerência; nenhuma evidência publicada |
| awesome-design-md como identidade | copiar o DESIGN.md de Linear ou Stripe faz o Brain parecer produto de outra empresa; extração não oficial |
| skill `frontend-design` sem ajuste | escrita contra estética genérica em peça nova; em CRM/DRE troca legibilidade por "personalidade". Se usar, sobrescrever com "produto operacional, denso, sóbrio" e com este `DESIGN.md` |
| Material 3 | densidade e padrões de mobile e consumo |
| Polaris React, SLDS como código | depreciado ou arquivado; ler a doc, não instalar |
| Tremor como dependência | congelado desde a compra pela Vercel |
| Awesome lists como entrada de agente | 300 links sem critério |
| Listicles de SEO ("12 princípios de dashboard") | repetem NN/g de terceira mão |
| Playbook 7 Níveis do Recon | é roteiro de landing page (vídeo no hero, glass, contador); não fala de dashboard, densidade nem estado vazio (`conciliador.md` §4.1) |
| Marca Recon (Tessera, verde/cream/âmbar, Outfit) | é de outra frente; nenhum hex do Recon entra na Planning (`conciliador.md` §5). O `PM Work/AGENTS.md` ainda manda "frontend → estudo-de-marca Recon" sem distinguir frente: para o Brain, vale este diretório |

---

## 4. O que nenhuma fonte substitui

Pesquisa com usuário, arquitetura de informação do domínio, prioridade do que entra na primeira dobra e teste com cinco pessoas (`pesquisa-referencias.md` §5). Esses ficam com os donos de `PRODUCT.md`; os agentes executam contra as regras.
