import { Fragment, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ForecastSource } from "@/lib/monetizacao/types";
import { downloadCsv, number } from "./common";

const BLOCKS = [
  { id: "base", name: "Formação da base", start: 12, end: 19 },
  { id: "capacidade", name: "Capacidade e ofertas", start: 20, end: 31 },
  { id: "funil", name: "Funil e contratos", start: 35, end: 42 },
  { id: "receita", name: "Receita prevista", start: 46, end: 50 },
  { id: "caixa", name: "Entrada em caixa", start: 54, end: 59 },
  { id: "margem", name: "Time e margem", start: 63, end: 67 },
];
const TOTALS = new Set([21, 28, 29, 35, 37, 41, 50, 58, 66, 67]);
const LABELS: Record<number, string> = {
  13: "Unidades novas · modelo R$ 15 mil",
  20: "Closers ativos",
  30: "Cobertura do pool",
  31: "Capacidade ociosa",
  37: "Oportunidades validadas",
  59: "Assinado sem entrada em caixa no ano",
};
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(month + "-01T12:00:00Z"))
    .replace(".", "");
const currency = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ForecastModel({
  source,
  selectedMonth,
}: {
  source: ForecastSource;
  selectedMonth: string;
}) {
  const [block, setBlock] = useState("all");
  const [summary, setSummary] = useState(false);
  const groups = BLOCKS.filter((b) => block === "all" || b.id === block);
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">Modelo completo</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set/26 a ago/27 · {source.rows.length} linhas · {source.version}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {source.drive_url?.startsWith("https://docs.google.com/spreadsheets/d/") && (
            <Button size="sm" variant="outline" asChild>
              <a href={source.drive_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Planilha no Drive
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("forecast-modelo.csv", [
                ["Bloco", "Linha", ...source.months],
                ...source.rows.map((r) => [
                  BLOCKS.find((b) => r.row >= b.start && r.row <= b.end)?.name,
                  r.label,
                  ...r.values,
                ]),
              ])
            }
          >
            <Download size={14} /> Exportar valores
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/25 px-5 py-3">
        <div className="flex flex-wrap gap-1" aria-label="Blocos do forecast">
          {[{ id: "all", name: "Tudo" }, ...BLOCKS].map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={block === b.id}
              onClick={() => setBlock(b.id)}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${block === b.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {b.name}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={summary}
            onChange={(e) => setSummary(e.target.checked)}
          />{" "}
          Só totais
        </label>
      </div>
      <div
        className="relative isolate max-h-[640px] overflow-auto border-y outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-primary"
        tabIndex={0}
        role="region"
        aria-label="Forecast por mês. Role para ver os 12 meses e todos os blocos."
      >
        <table className="w-full min-w-[2080px] table-fixed border-separate border-spacing-0 text-right text-xs">
          <caption className="sr-only">
            Modelo original de referência. Valores em reais. Mês de comparação destacado.
          </caption>
          <colgroup>
            <col className="w-[280px]" />
            {source.months.map((m) => (
              <col key={m} className="w-[150px]" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 border-b border-r bg-card px-5 py-4 text-left text-muted-foreground"
              >
                Indicador{" "}
                <span className="block pt-1 text-[10px] font-normal">Valores monetários em R$</span>
              </th>
              {source.months.map((m) => (
                <th
                  scope="col"
                  key={m}
                  aria-current={m === selectedMonth ? "date" : undefined}
                  className={`sticky top-0 z-20 border-b px-4 py-3 ${m === selectedMonth ? "bg-primary text-primary-foreground" : "bg-card"}`}
                >
                  <span className="block text-sm capitalize">{monthLabel(m)}</span>
                  <span className="mt-1 block text-[10px] font-normal opacity-75">
                    {m.slice(0, 4)}
                    {m === selectedMonth ? " · selecionado" : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => {
              const rows = source.rows.filter(
                (r) => r.row >= g.start && r.row <= g.end && (!summary || TOTALS.has(r.row)),
              );
              if (!rows.length) return null;
              return (
                <Fragment key={g.id}>
                  <tr>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-primary/20 bg-primary/15 px-5 py-3 text-left font-semibold text-foreground backdrop-blur-xl"
                    >
                      <span className="mr-2 text-[10px] text-muted-foreground">
                        {String(BLOCKS.indexOf(g) + 1).padStart(2, "0")}
                      </span>
                      {g.name}
                    </th>
                    <td colSpan={source.months.length} className="bg-primary/10" />
                  </tr>
                  {rows.map((r, ri) => {
                    const total = TOTALS.has(r.row);
                    const bg = total ? "bg-muted" : ri % 2 === 0 ? "bg-card" : "bg-background";
                    return (
                      <tr key={r.row} className={`group ${total ? "font-semibold" : ""}`}>
                        <th
                          scope="row"
                          className={`sticky left-0 z-10 border-b border-r px-5 py-3.5 text-left leading-relaxed ${bg} group-hover:bg-muted`}
                        >
                          {LABELS[r.row] || r.label}
                        </th>
                        {r.values.map((v, i) => (
                          <td
                            key={source.months[i]}
                            className={`border-b px-4 py-3.5 tabular-nums whitespace-nowrap ${i === source.months.indexOf(selectedMonth) ? "bg-primary/5 border-x border-x-primary/15" : bg} ${r.format === "money" && v < 0 ? "text-destructive" : ""}`}
                            title={`Forecast!${String.fromCharCode(67 + i)}${r.row}${r.formulas[i] ? " = " + r.formulas[i] : " · entrada da planilha"}`}
                          >
                            {v == null
                              ? "—"
                              : r.format === "percent"
                                ? number(v * 100) + "%"
                                : r.format === "money"
                                  ? currency.format(v)
                                  : number(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {gi < groups.length - 1 && (
                    <tr aria-hidden="true">
                      <td colSpan={source.months.length + 1} className="h-2 bg-card" />
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {summary &&
          groups.every(
            (g) =>
              !source.rows.some((r) => r.row >= g.start && r.row <= g.end && TOTALS.has(r.row)),
          ) && (
            <p className="p-5 text-sm text-muted-foreground">
              Este bloco tem premissas detalhadas. Desmarque “Só totais” para vê-las.
            </p>
          )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          Premissas do modelo preservadas. Caixa projetado e receita prevista são medidas distintas.
        </p>
        <p>Passe sobre um valor para ver a fórmula de origem.</p>
      </div>
    </section>
  );
}
