import { Fragment } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Secao } from "@/components/planning";
import type { ForecastSource } from "@/lib/monetizacao/types";
import type { Bloco, BuscaMonetizacao } from "./busca";
import { downloadCsv, number } from "./common";

const BLOCKS: { id: Bloco; name: string; start: number; end: number }[] = [
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
/** "set/2026 a ago/2027": os meses que a fonte traz, não um período fixo no código. */
const periodoDaFonte = (months: string[]) => {
  const ano = (m: string) => `${monthLabel(m)}/${m.slice(0, 4)}`;
  return months.length ? `${ano(months[0])} a ${ano(months[months.length - 1])}` : "sem meses";
};
const currency = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Grade da planilha (12 meses × blocos). Bloco e "Só totais" moram na URL (`blocos`, `totais`),
 * como o resto do estado de `/monetizacao` (N7).
 */
export function ForecastModel({
  source,
  selectedMonth,
  bloco,
  soTotais,
  mudar,
}: {
  source: ForecastSource;
  selectedMonth: string;
  /** Bloco da URL; sem ele, todos. */
  bloco?: Bloco;
  soTotais: boolean;
  mudar: (patch: Pick<BuscaMonetizacao, "blocos" | "totais">) => void;
}) {
  const block = bloco ?? "all";
  const summary = soTotais;
  const groups = BLOCKS.filter((b) => block === "all" || b.id === block);
  return (
    <Secao
      titulo="O que a planilha projeta, mês a mês?"
      descricao={`Modelo completo · ${periodoDaFonte(source.months)} · ${source.rows.length} linhas · planilha ${source.version}`}
      acoes={
        <>
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
        </>
      }
    >
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-5 py-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Blocos do forecast">
            {[{ id: "all" as const, name: "Tudo" }, ...BLOCKS].map((b) => (
              <Button
                key={b.id}
                type="button"
                size="sm"
                variant={block === b.id ? "secondary" : "ghost"}
                aria-pressed={block === b.id}
                onClick={() => mudar({ blocos: b.id === "all" ? undefined : b.id })}
                className={block === b.id ? "border border-input" : "text-muted-foreground"}
              >
                {b.name}
              </Button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-sm text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
            <input
              type="checkbox"
              className="size-4 accent-primary focus-visible:outline-none"
              checked={summary}
              onChange={(e) => mudar({ totais: e.target.checked || undefined })}
            />{" "}
            Só totais
          </label>
        </div>
        <div
          className="relative isolate max-h-[640px] overflow-auto border-b focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  <span className="block pt-1 text-xs font-normal">Valores monetários em R$</span>
                </th>
                {source.months.map((m) => (
                  <th
                    scope="col"
                    key={m}
                    aria-current={m === selectedMonth ? "date" : undefined}
                    className={`sticky top-0 z-20 border-b px-4 py-3 ${m === selectedMonth ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    <span className="block text-sm capitalize">{monthLabel(m)}</span>
                    <span className="mt-1 block text-xs font-normal opacity-75">
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
                        className="sticky left-0 z-10 border-r bg-accent px-5 py-3 text-left font-semibold text-accent-foreground"
                      >
                        <span className="mr-2 text-xs text-muted-foreground">
                          {String(BLOCKS.indexOf(g) + 1).padStart(2, "0")}
                        </span>
                        {g.name}
                      </th>
                      <td colSpan={source.months.length} className="bg-accent" />
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
                              className={`border-b px-4 py-3.5 tabular-nums whitespace-nowrap ${i === source.months.indexOf(selectedMonth) ? "bg-primary/5 border-x border-x-primary/15" : bg} ${r.format === "money" && v < 0 ? "text-danger" : ""}`}
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
        <div className="flex flex-wrap justify-between gap-2 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            Premissas do modelo preservadas. Caixa projetado e receita prevista são medidas
            distintas.
          </p>
          <p>Passe sobre um valor para ver a fórmula de origem.</p>
        </div>
      </div>
    </Secao>
  );
}
