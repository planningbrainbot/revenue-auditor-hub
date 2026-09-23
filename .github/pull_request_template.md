## O quê

<!-- A mudança em uma ou duas frases. Rotas e componentes tocados. -->

## Por quê

<!-- O problema ou pedido que originou. Link para a entrada do DECISIONS.md, se houver. -->

## Contrato

<!-- Link para docs/design/contratos/<rota>.md e para a mensagem "contrato ok" do dono. PR sem tela: escreva "não se aplica". -->

## Arquétipo

<!-- Visão geral · Fila de trabalho · Lista/Relatório · Ficha · Configuração (docs/design/ARQUETIPOS.md). -->

## Capturas

| Escuro | Claro |
|---|---|
| <!-- imagem --> | <!-- imagem --> |

## Definição de pronto

Copiada de `docs/design/README.md`. Item não cumprido diz qual e por quê; "depois eu arrumo" não é motivo.

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
- [ ] **`npm run design:lint:changed` limpo** (sem violação nova nos arquivos alterados e catraca sem subir).
