import type { Coortes } from "@/lib/cockpit-ceo/coortes";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { EstadoBadge } from "./estado";

// Retenção de logo por coorte: cada linha é o mês do ganho com denominador fixo; cada coluna, o fim
// de um mês depois dele. Célula vazia é mês não medido (futuro, em andamento ou antes do registro de
// churn) — nunca 100%.

const pct = (x: number) => `${Math.round(x * 100)}%`;

// Escala sequencial de um tom só (a série principal), proporcional à retenção. Sem cortes de
// "bom" e "ruim": ninguém decidiu que 85% é atenção, e cor de status não pinta série (DESIGN.md §5).
const fundo = (p: number) => ({
  background: `color-mix(in srgb, var(--chart-1) ${Math.round(8 + p * 32)}%, transparent)`,
});

export function CoortesRetencao({
  coortes,
  aviso,
}: {
  coortes: Coortes | null;
  aviso: string | null;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" aria-label="Coortes de retenção">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Quem permanece depois do ganho, por coorte?</h2>
        {coortes && <EstadoBadge estado={coortes.estado} />}
      </header>
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
      {coortes && coortes.linhas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 pr-2 text-left font-medium">Coorte</th>
                <th className="py-1 pr-2 text-right font-medium">Ganhos</th>
                {Array.from({ length: coortes.horizonte + 1 }, (_, k) => (
                  <th key={k} className="px-1 py-1 text-center font-medium">
                    M{k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coortes.linhas.map((l) => (
                <tr key={l.mes} className="border-b last:border-0">
                  <td className="py-1 pr-2 text-left">
                    {mesBr(l.mes)}
                    {l.antesDoRegistro && (
                      <span
                        className="ml-1 text-muted-foreground"
                        title="Começa antes do registro de churn: nenhum mês medido"
                      >
                        ·sem registro
                      </span>
                    )}
                    {l.recente && (
                      <span
                        className="ml-1 text-muted-foreground"
                        title="Menos de 90 dias: pode mudar"
                      >
                        ·recente
                      </span>
                    )}
                    {l.churnsSemData > 0 && (
                      <span
                        className="ml-1 text-warning"
                        title={`${l.churnsSemData} churn sem data: retenção real menor`}
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right">{l.denominador}</td>
                  {l.retidos.map((r, k) => (
                    <td
                      key={k}
                      className="px-1 py-1 text-center"
                      style={r === null ? undefined : fundo(r / l.denominador)}
                      title={r === null ? "Mês não medido" : `${r} de ${l.denominador}`}
                    >
                      {r === null ? "" : pct(r / l.denominador)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {coortes && (
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {coortes.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
