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
import { Secao } from "@/components/planning";
import { formatarValor } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { perguntasDaFrente } from "@/lib/cockpit-ceo/perguntas";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { CoberturaBadge, EstadoBadge } from "./estado";
import { ClientesAtivos } from "./clientes-ativos";
import { CoortesRetencao } from "./coortes";
import { ExportarEvidencias } from "./exportar-evidencias";
import { RedeUnidades } from "./rede-unidades";
import { Trajetoria } from "./trajetoria";

// A vista de uma frente do cockpit (`?frente=`), item próprio da lateral (N6). Mostra o painel da
// frente, quando existe, e as perguntas que ela responde, com fonte, responsável e o que falta.

function GraficoDiario({ serie }: { serie: NonNullable<Cockpit["serieDiaria"]> }) {
  return (
    <Secao
      titulo="Quantos eventos comerciais aconteceram por dia?"
      descricao="Negócios do pipe de Monetização, por dia do período. Eventos, não coorte."
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="label" {...eixoProps} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} {...eixoProps} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendaProps} />
            <Bar
              isAnimationActive={false}
              dataKey="started"
              name="Leads trabalhados"
              fill={CORES_SERIE[0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="scheduled"
              name="Reuniões marcadas"
              fill={CORES_SERIE[1]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="meeting"
              name="Reuniões realizadas"
              fill={CORES_SERIE[2]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Secao>
  );
}

export function VistaFrente({
  cockpit,
  frente,
  onAbrirIndicador,
  preview,
}: {
  cockpit: Cockpit;
  frente: Frente;
  onAbrirIndicador: (id: string) => void;
  preview: boolean;
}) {
  const perguntas = perguntasDaFrente(frente);
  const comNumero = perguntas.filter((p) => p.cobertura === "implementada_nao_homologada").length;
  return (
    <>
      {frente === "receita" && (cockpit.trajetoria || cockpit.trajetoriaAviso) && (
        <Trajetoria
          trajetoria={cockpit.trajetoria}
          aviso={cockpit.trajetoriaAviso}
          preview={preview}
        />
      )}
      {frente === "clientes" && (cockpit.clientes || cockpit.clientesAviso) && (
        <ClientesAtivos clientes={cockpit.clientes} aviso={cockpit.clientesAviso} />
      )}
      {frente === "comercial" && cockpit.serieDiaria && (
        <GraficoDiario serie={cockpit.serieDiaria} />
      )}
      {frente === "rede" && (cockpit.rede || cockpit.trajetoriaAviso) && (
        <RedeUnidades rede={cockpit.rede} aviso={cockpit.trajetoriaAviso} />
      )}
      {frente === "retencao" && (cockpit.coortes || cockpit.coortesAviso) && (
        <CoortesRetencao coortes={cockpit.coortes} aviso={cockpit.coortesAviso} />
      )}
      {frente === "capital" && <ExportarEvidencias cockpit={cockpit} />}

      <Secao
        titulo="Quais perguntas esta frente responde?"
        descricao={`${comNumero} de ${perguntas.length} com cálculo implementado; as demais dizem o que falta e quem responde.`}
      >
        <ul className="divide-y rounded-xl border bg-card">
          {perguntas.map((p) => (
            <li key={p.id} className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{p.texto}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Fonte:</span> {p.fonte}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Responsável:</span> {p.responsavel}
                  {p.pendencia && (
                    <>
                      {" · "}
                      <span className="text-foreground">Falta:</span> {p.pendencia}
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
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {i.titulo}: <strong className="num">{formatarValor(i)}</strong>
                          {i.estado !== "disponivel" && <EstadoBadge estado={i.estado} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
                <CoberturaBadge cobertura={p.cobertura} />
                {p.exigencia && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                    title="Exigência explícita do mapa de investidores"
                  >
                    Mapa · {p.exigencia}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Secao>
    </>
  );
}
