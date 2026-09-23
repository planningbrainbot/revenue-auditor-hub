# PROCESSO.md · Como uma tela nova chega ao Brain

Proposta de 23/09/2026 para Pedro, Mika e Eliezek. Nada aqui foi combinado ainda: é o ponto de partida da conversa entre os três. Onde está escrito "Eliezek decide" ou "Mika decide", a proposta é só dar dono. O conteúdo da decisão é de quem decide.

## 1. O problema que o processo resolve

Hoje duas pessoas desenham a navegação do mesmo app sem regra comum: Eliezek, a estrutura e o menu, e Pedro, a Base de clientes e a Monetização. O Mika é dono da marca, e nenhuma tela passa por ele. Cada tela é pedida a um agente que não sabe da anterior. A pesquisa de referência acontece no meio da tarefa de código e se perde no fim da sessão. O resultado está medido em `diagnostico/telas-do-brain.md`: 9 estilos de cabeçalho, 20 cards de KPI e 1.650 cores escritas à mão.

O processo tem três peças: **cada decisão com um dono**, **um portão que a máquina confere** e **uma ordem de migração que não briga com o trabalho diário na `main`**.

## 2. Quem decide o quê

| Assunto | Dono (decide) | Revisa | Onde fica escrito |
|---|---|---|---|
| Marca: paleta, logo, fonte, grafismos | **Mika** | Pedro | `DESIGN.md` §2 e §6 |
| Tokens de papel (cor de status, contraste, gráfico) | **Mika** aprova, com proposta do Pedro ou de agente | Eliezek | `DESIGN.md` §3–5, `src/styles.css` |
| Para que serve cada módulo, a pergunta de cada tela, o que entra e o que sai | **Pedro** | dono do módulo | `PRODUCT.md`, `CONTRATO-DE-TELA.md` |
| Regras de navegação (N1–N14) e mapa do menu | **Pedro** propõe, **Eliezek** aprova | Mika (nomes) | `NAVEGACAO.md`, `src/lib/areas.ts` |
| Casca (lateral, cabeçalho, permissão, `areas.ts`) e componentes base | **Eliezek** | Pedro | código + `DECISIONS.md` |
| Merge na `main` e deploy | **Eliezek** | — | `DECISIONS.md` (entradas de deploy) |
| Tela de um módulo | dono do módulo em `PRODUCT.md` | Eliezek (código), Pedro (contrato) | PR |

Agente executa contra esses arquivos e não decide nada que esteja em `PRODUCT.md` §5 (decisões pendentes).

**Pendências que só o Mika resolve**, e que travam a marca completa:
1. Os arquivos `.woff2` da Bw Glenn Sans (licença). Até lá, a tela usa a Fira Sans.
2. Qual é o logo vetorial oficial. Há dois gradientes em uso (`diagnostico/design-system-planning.md`).

## 3. Integrar esta branch (uma vez só)

A branch `feat/design-system-v2-20260923` saiu de `origin/main` `eea3d90`. A `main` recebe commits todo dia, então a integração é em **três PRs**, do menos para o mais conflituoso:

| PR | Conteúdo | Conflito esperado | Quem aprova |
|---|---|---|---|
| **A · Fundação** | tokens, fonte, `lang`, `<Toaster/>`, `hsl(var())` corrigido, primitivos `ui/*`, `components/planning/*`, vitrine, `design:lint`, `docs/design/` | baixo: poucos arquivos de tela | Eliezek (código), Mika (marca) |
| **B · Casca** | lateral, cabeçalho com trilha, `AppShell` → `PageHeader` | médio: `app-sidebar.tsx` e `route.tsx` são do Eliezek | Eliezek |
| **C · Codemod e cabeçalhos** | troca de cor crua por token, fonte menor que 12px, cabeçalhos ad-hoc → `PageHeader` | **alto**: toca ~90 arquivos | Eliezek + Pedro |

O PR C não é mesclado resolvendo conflito à mão. No dia combinado:
1. Eliezek segura os commits por uma janela curta.
2. A branch é refeita a partir da `main` do dia.
3. `node scripts/design/codemod-cores.mjs` roda de novo; o script é reexecutável de propósito.
4. Build + `npm run design:lint` + capturas.
5. Merge no mesmo dia.

Antes de cada merge, o preview da Vercel é aberto nas cinco telas de conferência (Overview da Rede, Base de clientes, Fila Cella, Apuração de Royalties e Admin › Usuários), nos dois temas. Se der errado, volta com `git revert` do merge.

Antes de começar, falta confirmar uma coisa. O `AGENTS.md` do app diz que `git push origin main` publica. A memória de operação do Pedro diz que o deploy do Ops é pela CLI. Quem sabe qual vale é o Eliezek, e isso muda o risco do PR C.

## 4. Toda tela nova ou alterada, daqui para frente

```
1. Contrato       Pedro (ou o dono do módulo) preenche CONTRATO-DE-TELA.md; arquétipo escolhido
2. Aprovação      uma mensagem do dono: "contrato ok". Sem isso não se abre código.
3. Construção     agente ou dev lê docs/design/README.md na ordem indicada e compõe com components/planning
4. Portão         build + npm run design:lint (sem violação nova) + captura escuro/claro
5. PR             template .github/pull_request_template.md com a definição de pronto marcada
6. Revisão        Eliezek: código, casca, permissão · Pedro: o contrato foi cumprido · Mika: só se tocou marca
7. Merge/deploy   Eliezek
```

**Como pedir ao agente.** Esta é a troca que resolve o "pesquise referências de UI/UX" que nunca funcionou:

> Tela `/rede-overview`. Leia `docs/design/README.md` e siga a ordem de leitura. O contrato aprovado está em `docs/design/contratos/rede-overview.md`. O arquétipo é Visão geral. Não pesquise referência externa; se faltar regra, registre a lacuna no PR.

A pesquisa de referência tem hora própria (§6) e vira regra em `docs/design/`. A tarefa lê a regra, e não a internet.

## 5. O portão que a máquina confere

- **Agora:** `npm run design:lint` lista as violações por regra (V1–V6) e compara com a linha de base de `medicoes.md`. As regras são:
  - nada de `hsl(var())`;
  - nada de hex em componente;
  - nada de cor crua de status;
  - nada de fonte menor que 12px;
  - `confirm()` nativo e rota sem `PageHeader` geram aviso.

  A regra de merge proposta tem duas partes. Arquivo tocado no PR não pode ter violação nova. A contagem global só pode cair (catraca).
- **Depois (proposta, decisão do Eliezek):** uma GitHub Action que roda build + `design:lint --changed` em todo PR e comenta as capturas da vitrine.

A revisão humana fica com o que a máquina não vê: se a pergunta da tela é a certa, se o número abre o registro certo e se a tela provoca a ação do contrato.

## 6. Ordem de migração dos módulos

Uma área por vez, por impacto no objetivo do Brain (`PRODUCT.md` §1) e com o dono presente:

| Semana | Módulo | Arquétipo principal | Por que agora | Dono |
|---|---|---|---|---|
| 1 | Monetização · Fila Cella | Fila de trabalho | é onde o Brain vira receita; KR semanal | Pedro |
| 2 | Rede · Overview + IDU | Visão geral | primeira tela da diretoria; cards que não batem com o destino (N2) | Eliezek |
| 3 | Base de clientes | Lista/Relatório + Ficha | decisão pendente sobre rotas irmãs × faixa única (`PRODUCT.md` §5) | Pedro |
| 4 | Receita e Repasses | Fila (apuração) + Relatório | fechamento do mês; a controladoria usa todo dia | Eliezek |
| 5 | Planning People | Fila (minha vez) + Ficha | abas duplicadas no menu | Eliezek |
| 6 | Administração | Configuração | baixo risco; fecha o ciclo | Eliezek |

Cada módulo sai com três coisas: contrato, arquétipo aplicado e drill-down conferido contra a fonte (N2). Visual sem essas três não conta como migrado.

**Growth (`brain-web`) e Financeiro** entram depois do Ops. O Financeiro já usa parte do design system. O Growth é Next.js sem shadcn. Os dois recebem os tokens de `src/styles.css` por cópia versionada, e não por um pacote novo, até a casca única dos três produtos (DECISIONS 14/09) pedir mais.

## 7. Ritual

- **Revisão de tela, a cada 15 dias, 30 min, com os três.** Abre a vitrine e as capturas do que mudou, passa pelo `PRODUCT.md` §5 e decide uma pendência por vez. Saída: entradas no `DECISIONS.md`.
- **Rodada de referência, 1 por mês, com o Mika na frente.** Pesquisa com `REFERENCIAS.md`, prints escolhidos por uma pessoa e salvos em `docs/design/referencias/`. Termina com uma regra nova ou alterada. Não acontece no meio de tarefa.
- **Medição, mensal.** `npm run design:lint --baseline` atualiza `medicoes.md`. Se a curva parou de cair, o problema está no processo, e não na tela.

## 8. O que não fazer

- Aprovar tela bonita que não diz a que pergunta responde.
- Criar card, cabeçalho ou cor local "só para esta tela". Se falta componente, ele entra em `components/planning` com revisão.
- Resolver conflito do codemod à mão.
- Mudar a marca sem o Mika, ou mudar a casca sem o Eliezek.
