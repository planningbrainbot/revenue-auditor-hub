import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FRENTES, ORDEM_FRENTES, formatarValor } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { perguntasDaFrente } from "@/lib/cockpit-ceo/perguntas";
import { CoberturaBadge, EstadoBadge } from "./estado";

function GraficoDiario({ serie }: { serie: NonNullable<Cockpit["serieDiaria"]> }) {
  return (
    <figure className="rounded-lg border p-3">
      <figcaption className="mb-2 text-xs font-medium">
        Eventos por dia no período · negócios do pipe de Monetização
      </figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              isAnimationActive={false}
              dataKey="started"
              name="Leads trabalhados"
              fill="var(--chart-1)"
            />
            <Bar
              isAnimationActive={false}
              dataKey="scheduled"
              name="Reuniões marcadas"
              fill="var(--chart-2)"
            />
            <Bar
              isAnimationActive={false}
              dataKey="meeting"
              name="Reuniões realizadas"
              fill="var(--chart-3)"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function Frentes({
  cockpit,
  frente,
  onFrente,
  onAbrirIndicador,
}: {
  cockpit: Cockpit;
  frente: Frente;
  onFrente: (f: Frente) => void;
  onAbrirIndicador: (id: string) => void;
}) {
  const perguntas = perguntasDaFrente(frente);
  const comNumero = (f: Frente) =>
    perguntasDaFrente(f).filter((p) => p.cobertura === "implementada_nao_homologada").length;
  return (
    <section id="frentes" className="rounded-xl border bg-card">
      <div
        className="flex gap-1 overflow-x-auto border-b px-2"
        role="tablist"
        aria-label="Frentes do cockpit"
      >
        {ORDEM_FRENTES.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={f === frente}
            onClick={() => onFrente(f)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium ${f === frente ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {FRENTES[f].titulo}
            <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">
              {comNumero(f)}/{perguntasDaFrente(f).length}
            </span>
          </button>
        ))}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          {FRENTES[frente].pergunta} O número ao lado da frente diz quantas perguntas já têm cálculo
          implementado (ainda não homologado); as demais mostram o que falta e quem responde.
        </p>
        {frente === "comercial" && cockpit.serieDiaria && (
          <GraficoDiario serie={cockpit.serieDiaria} />
        )}
        <ul className="divide-y rounded-lg border">
          {perguntas.map((p) => (
            <li key={p.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{p.texto}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground/80">Fonte:</span> {p.fonte}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground/80">Responsável:</span> {p.responsavel}
                  {p.pendencia && (
                    <>
                      {" · "}
                      <span className="text-foreground/80">Falta:</span> {p.pendencia}
                    </>
                  )}
                </p>
                {p.indicadores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.indicadores.map((id) => {
                      const i = cockpit.indicadores.find((x) => x.id === id);
                      if (!i) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onAbrirIndicador(id)}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:border-primary"
                        >
                          {i.titulo}: <strong className="tabular-nums">{formatarValor(i)}</strong>
                          {i.estado !== "disponivel" && <EstadoBadge estado={i.estado} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-start gap-1.5 md:justify-end">
                <CoberturaBadge cobertura={p.cobertura} />
                {p.exigencia && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
                    title="Exigência explícita do mapa de investidores"
                  >
                    Mapa · {p.exigencia}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
