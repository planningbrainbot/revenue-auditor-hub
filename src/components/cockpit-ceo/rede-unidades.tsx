import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import type { RedeUnidades as Rede } from "@/lib/cockpit-ceo/rede";
import { EstadoBadge } from "./estado";

// Rede por unidade na janela de meses completos da apuração de royalties: faturamento, participação,
// royalties + CSC devidos à matriz e concentração. Mesma régua da leitura "rede" da trajetória.

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")}%`);

export function RedeUnidades({ rede }: { rede: Rede | null }) {
  if (!rede) return null;
  const j = rede.janela;
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Rede por unidade">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Faturamento, repasse e concentração por unidade</h3>
          <EstadoBadge estado={rede.estado} />
        </div>
        <p className="text-xs text-muted-foreground">
          {j
            ? `Apuração de royalties confirmada, ${mesBr(j.de)} a ${mesBr(j.ate)} (${j.meses} ${j.meses === 1 ? "mês completo" : "meses completos"}). Mês com unidade inaugurada sem apuração fica fora. Vale para a rede inteira.`
            : "Sem janela de meses completos na apuração de royalties."}
        </p>
      </header>
      {rede.linhas.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 text-left font-medium">Unidade</th>
                  <th className="py-1.5 text-right font-medium">Faturamento</th>
                  <th className="py-1.5 text-right font-medium">Participação</th>
                  <th className="py-1.5 text-right font-medium">Royalties + CSC</th>
                  <th className="py-1.5 text-right font-medium">Sobre o faturamento</th>
                </tr>
              </thead>
              <tbody>
                {rede.linhas.map((l) => (
                  <tr key={l.unidade} className="border-b last:border-0">
                    <td className="py-1.5 text-left">{l.unidade}</td>
                    <td className="py-1.5 text-right">{formatarNumero(l.faturamento, "reais")}</td>
                    <td className="py-1.5 text-right">{pct(l.participacao)}</td>
                    <td className="py-1.5 text-right">{formatarNumero(l.royaltiesCsc, "reais")}</td>
                    <td className="py-1.5 text-right">{pct(l.takeRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs">
            Maior unidade: <strong>{pct(rede.top1)}</strong> · três maiores:{" "}
            <strong>{pct(rede.top3)}</strong> · índice de concentração (HHI):{" "}
            <strong>{rede.hhi === null ? "—" : rede.hhi.toFixed(2).replace(".", ",")}</strong>
            <span className="text-muted-foreground">
              {" "}
              · participações somam {pct(rede.somaParticipacoes)}
            </span>
          </p>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        Recebido por unidade fica de fora: a única série mensal disponível agrupa títulos por data
        de competência, régua que a casa declarou não confiável em 26/08.
      </p>
    </section>
  );
}
