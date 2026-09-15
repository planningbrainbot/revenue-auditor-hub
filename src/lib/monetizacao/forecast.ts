import { operacao } from "./model.ts";
import type { ForecastSource, Negocio } from "./types";

export function forecastComparison(
  source: ForecastSource,
  cards: Negocio[],
  cutoff: string | null,
) {
  const planned = (row: number, index: number) =>
    source.rows.find((r) => r.row === row)?.values[index] ?? null;
  return source.months.map((month, index) => {
    const from = month + "-01";
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const through = cutoff && cutoff < end ? cutoff : end;
    const actual =
      cutoff && from <= cutoff
        ? operacao(cards, { from, to: through, owner: null, product: "" })
        : null;
    return {
      month,
      through,
      partial: !!cutoff && from <= cutoff && cutoff < end,
      actual,
      planned: {
        started: planned(29, index),
        meeting: planned(35, index),
        validated: planned(37, index),
        signed: planned(41, index),
      },
      products: (["cella", "consultoria", "finance"] as const).map((product, i) => ({
        product,
        plannedStarted: planned(25 + i, index),
        plannedSigned: planned(38 + i, index),
        actual: actual?.products.find((p) => p.product === product) ?? null,
        scheduled: cards.filter(
          (c) =>
            c.route === product &&
            c.status === "open" &&
            c.validated_at &&
            c.expected_close?.startsWith(month),
        ),
      })),
    };
  });
}
