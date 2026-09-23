/**
 * Tema único de gráfico (Recharts) do Planning Brain.
 *
 * Por que existe: cada tela montava eixo, grade, tooltip e cor de série à mão,
 * e 33 lugares embrulhavam a variável em hsl() embora ela seja hex. Isso é CSS
 * inválido: a série saía no preto padrão do SVG e o eixo sumia no tema escuro.
 * Aqui tudo é `var(--…)` puro, então o gráfico troca de tema junto com a tela.
 *
 * Regras de uso: docs/design/DESIGN.md §5. Uma série = CORES_SERIE[0]; meta é
 * linha tracejada neutra (linhaMetaProps); negativo é COR_NEGATIVO; status
 * (success/warning/danger) não pinta categoria.
 *
 * ── Validação da paleta (23/09/2026) ─────────────────────────────────────────
 * Script `validate_palette.js` da skill dataviz (OKLab ×100, CVD por
 * Machado 2009), pares adjacentes, séries 1–5; a 6 é o neutro de "Outros"/meta
 * e falha o piso de croma de propósito (não carrega identidade).
 *
 * Escuro, superfície card #0d1418, #0ae18c #14c8fa #962dff #fa6914 #c3e61e:
 *   Faixa de luminosidade  FAIL  verde 0,80 · ciano 0,78 · laranja 0,69 · lima 0,87
 *                                (faixa da skill: 0,48–0,67)
 *   Croma                  PASS
 *   Separação CVD          PASS  pior par lima↔laranja ΔE 16,9 (deutan)
 *   Piso visão normal      PASS  pior par ciano↔verde ΔE 19,0
 *   Contraste vs card      PASS  todos ≥3:1 (roxo é o menor: 3,6:1)
 *   Desvio aceito: no escuro a spec (§2.2) fixa a paleta da marca sem
 *   alteração, e "vivo sobre preto" é a assinatura dela. Escurecer para a
 *   faixa da skill apagaria justamente o que a marca pede. O risco que a faixa
 *   aponta (cor brilhante dominar a leitura) fica contido pelas regras de
 *   marca: traço fino, ≤3 séries empilhadas, texto nunca na cor da série.
 *
 * Claro, superfície card #ffffff, #00a454 #009bcb #962dff #f36201 #526b00:
 *   Faixa de luminosidade  PASS  (0,43–0,77)
 *   Croma                  PASS
 *   Separação CVD          PASS  pior par lima↔laranja ΔE 8,5 (protan)
 *   Piso visão normal      PASS  pior par ciano↔verde ΔE 18,5
 *   Contraste vs card      PASS  todos ≥3:1
 *   Como chegou aqui: cada cor da marca foi escurecida no mesmo matiz OKLCH até
 *   ≥3,2:1 sobre branco. A lima em #7d9b00 colapsava com o laranja para
 *   deuteranopia (ΔE 4,4, FAIL); descer a lima até #526b00 resolveu sem mexer
 *   no laranja, que escurecido virava vermelho e colidia com `danger`.
 *
 * Todos os pares (dispersão, small multiples): só as 3 primeiras passam nos
 * dois temas (pior ΔE 13,9 claro / 17,6 escuro). Mais de 3 séries nessas
 * formas vira facetas ou "Outros", não cor nova.
 */

import { createElement } from "react";

/** Cores de série na ordem fixa da marca. Nunca ciclar: a 7ª série vira "Outros". */
export const CORES_SERIE = [
  "var(--chart-1)", // verde
  "var(--chart-2)", // ciano
  "var(--chart-3)", // roxo
  "var(--chart-4)", // laranja
  "var(--chart-5)", // lima
  "var(--chart-6)", // neutro (Outros, meta, referência)
] as const;

export const COR_NEUTRA = "var(--chart-6)";
export const COR_NEGATIVO = "var(--danger)";

/** XAxis / YAxis. */
export const eixoProps = {
  stroke: "var(--border)",
  tick: { fill: "var(--muted-foreground)", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;

/** CartesianGrid: recessiva, só horizontal. */
export const gradeProps = {
  stroke: "var(--border)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** Tooltip: superfície elevada, texto em foreground (nunca na cor da série). */
export const tooltipProps = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
  },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
  cursor: { fill: "var(--muted)", stroke: "var(--border)", opacity: 0.5 },
} as const;

/**
 * Legend. O Recharts pinta o texto da legenda com a cor da série; o
 * `formatter` devolve o texto à cor de texto, e a bolinha carrega a identidade.
 */
export const legendaProps = {
  iconType: "circle",
  iconSize: 8,
  wrapperStyle: { fontSize: 12 },
  formatter: (valor: unknown) =>
    createElement("span", { style: { color: "var(--muted-foreground)" } }, String(valor)),
} as const;

/** ReferenceLine de meta: tracejado neutro; o rótulo "Meta" vai no `label`. */
export const linhaMetaProps = {
  stroke: COR_NEUTRA,
  strokeDasharray: "4 4",
  strokeWidth: 1.5,
} as const;

/** ReferenceLine de zero / break-even. */
export const linhaZeroProps = {
  stroke: "var(--muted-foreground)",
  strokeWidth: 1,
} as const;
