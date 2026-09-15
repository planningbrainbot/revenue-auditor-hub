import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { disponibilidade, oferta } from "@/lib/monetizacao/model";
import { forecastComparison } from "@/lib/monetizacao/forecast";
import { NOMES } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Negocio } from "@/lib/monetizacao/types";
import { date, downloadCsv, Field, inputClass, Kpi, money, Notice, number, Panel } from "./common";

export function Forecast({
  data,
  month,
  openDeals,
}: {
  data: BaseMonetizacao;
  month: string;
  openDeals: (title: string, rows: Negocio[], period?: { from: string; to: string }) => void;
}) {
  const [chosen, setChosen] = useState(month);
  const source = [...data.forecasts].sort((a, b) => b.source_date.localeCompare(a.source_date))[0];
  if (!source)
    return (
      <Notice>
        {data.permissions.all_units
          ? "Ainda não há uma versão do forecast importada."
          : "O forecast consolidado exige acesso às carteiras de todas as unidades."}
      </Notice>
    );
  const cutoff = data.measured_at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(data.measured_at))
    : null;
  const comparisons = forecastComparison(source, data.cards, cutoff);
  const selected = comparisons.find((c) => c.month === chosen) || comparisons[0];
  const show = (title: string, rows: Negocio[]) =>
    openDeals(title, rows, {
      from: selected.month + "-01",
      to: selected.actual
        ? selected.through
        : new Date(
            Date.UTC(Number(selected.month.slice(0, 4)), Number(selected.month.slice(5, 7)), 0),
          )
            .toISOString()
            .slice(0, 10),
    });
  const metrics = [
    ["started", "Ofertas trabalhadas"],
    ["meeting", "Reuniões realizadas"],
    ["validated", "Oportunidades validadas"],
    ["signed", "Contratos assinados"],
  ] as const;
  const chart = comparisons.map((c) => ({
    name: date(c.month + "-01").slice(3),
    projetado: c.planned.signed,
    realizado: c.actual?.rows.signed.length ?? null,
  }));
  const index = source.months.indexOf(selected.month);
  const fmt = (v: number | null, type: string) =>
    v === null
      ? "—"
      : type === "money"
        ? money(v)
        : type === "percent"
          ? number(v * 100) + "%"
          : number(v);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Projetado × realizado</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Toda a frente · plano mensal {source.version} · fonte de {date(source.source_date)}
          </p>
        </div>
        <Field label="Mês de comparação">
          <select
            className={inputClass}
            value={selected.month}
            onChange={(e) => setChosen(e.target.value)}
          >
            {source.months.map((m) => (
              <option key={m} value={m}>
                {date(m + "-01").slice(3)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Notice>
        {source.note} O realizado acompanha o CRM
        {cutoff ? ` até ${date(cutoff)}` : " após a primeira sincronização"}.{" "}
        {selected.partial ? "O mês está em andamento; a diferença usa a meta do mês inteiro." : ""}
      </Notice>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(([key, label]) => (
          <Kpi
            key={key}
            label={label}
            value={`${selected.actual?.rows[key].length ?? "—"} / ${fmt(selected.planned[key], "number")}`}
            hint="Realizado / projetado no mês"
            onClick={selected.actual ? () => show(label, selected.actual!.rows[key]) : undefined}
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Contratos por mês">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis allowDecimals={false} fontSize={10} />
                <Tooltip
                  contentStyle={{ background: "var(--background)", borderColor: "var(--border)" }}
                />
                <Legend />
                <Bar
                  dataKey="projetado"
                  name="Projetado · v10"
                  fill="var(--muted-foreground)"
                  opacity={0.5}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="realizado"
                  name="Realizado · CRM"
                  fill="var(--primary)"
                  radius={[3, 3, 0, 0]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Meses futuros ficam sem realizado. O mês corrente mostra o acumulado até a última carga.
          </p>
        </Panel>
        <Panel title="Diferença para o plano mensal">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th>Indicador</th>
                <th>Realizado</th>
                <th>Projetado</th>
                <th>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([key, label]) => {
                const real = selected.actual?.rows[key].length ?? null,
                  plan = selected.planned[key];
                return (
                  <tr className="border-t" key={key}>
                    <td className="py-4">{label}</td>
                    <td>
                      {real === null ? (
                        "—"
                      ) : (
                        <button
                          className="text-primary underline"
                          onClick={() => show(label, selected.actual!.rows[key])}
                        >
                          {real}
                        </button>
                      )}
                    </td>
                    <td>{fmt(plan, "number")}</td>
                    <td>{real === null || plan === null ? "—" : number(real - plan)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Produto por produto">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th>Produto</th>
                <th>Trabalho projetado</th>
                <th>Trabalho realizado</th>
                <th>Contratos projetados</th>
                <th>Contratos assinados</th>
                <th>Validadas com data no mês</th>
                <th>Disponíveis agora</th>
              </tr>
            </thead>
            <tbody>
              {selected.products.map((p) => {
                const free = data.accounts.filter(
                  (a) =>
                    oferta(a, p.product).status === "elegivel" &&
                    disponibilidade(a, p.product, data.cards, undefined, data.reservations).free,
                ).length;
                return (
                  <tr key={p.product} className="border-t">
                    <td className="py-4 font-semibold">{NOMES[p.product]}</td>
                    <td>{fmt(p.plannedStarted, "number")}</td>
                    <td>{p.actual?.started ?? "—"}</td>
                    <td>{fmt(p.plannedSigned, "number")}</td>
                    <td>{p.actual?.signed ?? "—"}</td>
                    <td>
                      <button
                        className="text-primary underline"
                        onClick={() =>
                          show(
                            `${NOMES[p.product]} · data prevista em ${selected.month}`,
                            p.scheduled,
                          )
                        }
                      >
                        {p.scheduled.length}
                      </button>
                    </td>
                    <td>{free}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          As datas registradas no CRM representam expectativas das oportunidades em aberto. Não
          somamos esse estoque aos contratos assinados para prometer um fechamento. “Disponíveis
          agora” usa a base atual, independentemente do mês do plano.
        </p>
        <Link
          to="/monetizacao"
          search={{ aba: "capacidade" }}
          className="mt-3 inline-block text-sm text-primary underline"
        >
          Ajustar a alocação e as hipóteses por produto →
        </Link>
      </Panel>
      {data.cards.some((c) => !c.history_known) && (
        <Notice>
          {data.cards.filter((c) => !c.history_known).length} negócios estão sem histórico completo.
          Os movimentos desses negócios não são inferidos da etapa atual.
        </Notice>
      )}
      <Panel
        title="Modelo completo de referência"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("forecast-v10.csv", [
                ["Linha", ...source.months],
                ...source.rows.map((r) => [r.label, ...r.values]),
              ])
            }
          >
            Exportar modelo
          </Button>
        }
      >
        <details>
          <summary className="cursor-pointer text-sm text-primary">
            Ver as 44 linhas e os 12 meses da planilha
          </summary>
          <p className="my-3 text-xs text-muted-foreground">
            Valores do modelo original, incluindo estoque, receita, caixa e custo. O caixa projetado
            não é comparado à receita prevista contratual: são medidas diferentes. Passe sobre um
            valor para conferir a célula e a fórmula de origem.
          </p>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[1450px] text-right text-xs">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="sticky left-0 bg-background py-3 text-left">Linha</th>
                  {source.months.map((m) => (
                    <th className="px-3" key={m}>
                      {date(m + "-01").slice(3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {source.rows.map((r) => (
                  <tr className="border-t" key={r.row}>
                    <td className="sticky left-0 bg-background py-2 pr-4 text-left">{r.label}</td>
                    {r.values.map((v, i) => (
                      <td
                        className={`px-3 tabular-nums ${i === index ? "bg-primary/5" : ""}`}
                        key={i}
                        title={`Forecast!${String.fromCharCode(67 + i)}${r.row}${r.formulas[i] ? " = " + r.formulas[i] : " · entrada da planilha"}`}
                      >
                        {fmt(v, r.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="mt-3 text-xs text-muted-foreground">
          {source.source_name} · referência importada e preservada no Planning Brain. Atualizar o
          CRM não altera as premissas da planilha.
        </p>
      </Panel>
    </div>
  );
}
