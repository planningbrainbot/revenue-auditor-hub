import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import { ANO_ALVO, MEDIA_MENSAL_NECESSARIA, mesBr } from "@/lib/cockpit-ceo/receita";
import type { ResumoLeitura } from "@/lib/cockpit-ceo/receita";
import { BotaoDestino } from "./composicao";
import { EstadoBadge, valorCurto } from "./estado";

// Trajetória para R$ 1 bi em 2030, uma leitura candidata por cartão. O perímetro da meta não está
// decidido, então nada aqui soma leituras nem escolhe "o" gap: cada cartão diz sozinho quanto a
// leitura fatura hoje e quanto precisaria multiplicar.

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const vezes = (x: number) => `${x.toFixed(1).replace(".", ",")}×`;

function Serie({ serie }: { serie: ResumoLeitura["serie"] }) {
  const dados = serie.map((s) => ({ ...s, rotulo: mesBr(s.mes) }));
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fontSize: 10 }}
            width={76}
            tickFormatter={(v: number) => valorCurto(v, "reais")}
          />
          <Tooltip
            formatter={(v: number, _n, p) => [
              formatarNumero(v, "reais") + (p?.payload?.parcial ? " (parcial)" : ""),
              "Faturamento",
            ]}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
          />
          <Bar isAnimationActive={false} dataKey="valor">
            {dados.map((s) => (
              <Cell key={s.mes} fill={s.parcial ? "var(--muted-foreground)" : "var(--chart-1)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-[10px] text-muted-foreground">{nota}</p>}
    </div>
  );
}

function CartaoLeitura({ t, preview }: { t: ResumoLeitura; preview: boolean }) {
  const f = t.fechados;
  const mesesComNota = t.serie.filter((s) => t.notasPorMes[s.mes]);
  return (
    <article className="space-y-3 rounded-lg border p-3">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{t.titulo}</h4>
          <EstadoBadge estado={t.estado} />
        </div>
        <p className="text-xs text-muted-foreground">{t.definicao}</p>
        <p className="text-[11px] text-muted-foreground">
          <span className="text-foreground/80">Fonte:</span> {t.fonte}
        </p>
      </header>

      {f ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero
              rotulo="Média mensal"
              valor={valorCurto(f.media, "reais")}
              nota={`${mesBr(f.de)} a ${mesBr(f.ate)} · ${f.meses} ${f.meses === 1 ? "mês fechado" : "meses fechados"}`}
            />
            <Numero
              rotulo={`Precisa em ${ANO_ALVO}`}
              valor={t.multiploNecessario ? vezes(t.multiploNecessario) : "—"}
              nota={`${valorCurto(MEDIA_MENSAL_NECESSARIA, "reais")} por mês`}
            />
            <Numero
              rotulo="12 meses fechados"
              valor={t.doze !== null ? valorCurto(t.doze, "reais") : "—"}
              nota={t.doze === null ? "ainda sem 12 meses contíguos" : undefined}
            />
            <Numero
              rotulo={`Crescimento ao ano até ${ANO_ALVO}`}
              valor={
                t.crescimentoAnualNecessario !== null ? pct(t.crescimentoAnualNecessario) : "—"
              }
              nota={t.crescimentoAnualNecessario === null ? "exige 12 meses fechados" : undefined}
            />
          </div>
          {t.serie.length > 0 && <Serie serie={t.serie} />}
          {t.porChave.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              Participação na janela:{" "}
              {t.porChave
                .slice(0, 5)
                .map((c) => `${c.chave} ${pct(c.participacao)}`)
                .join(" · ")}
              {t.porChave.length > 5 ? ` · outras ${t.porChave.length - 5}` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t.notas[0] ?? "Sem meses fechados com dado nesta leitura."}
        </p>
      )}

      {(t.notas.length > (f ? 0 : 1) || mesesComNota.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Cobertura e ressalvas ({t.notas.length - (f ? 0 : 1) + mesesComNota.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            {t.notas.slice(f ? 0 : 1).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {mesesComNota.map((s) => (
              <li key={s.mes}>
                <span className="text-foreground/80">{mesBr(s.mes)}:</span> {t.notasPorMes[s.mes]}
              </li>
            ))}
          </ul>
        </details>
      )}
      <BotaoDestino destino={t.destino} preview={preview} compacto />
    </article>
  );
}

export function Trajetoria({
  trajetoria,
  aviso,
  preview,
}: {
  trajetoria: ResumoLeitura[] | null;
  aviso: string | null;
  preview: boolean;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Trajetória para a meta">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">
          Trajetória para R$ 1 bi de faturamento em {ANO_ALVO}
        </h3>
        <p className="text-xs text-muted-foreground">
          Leituras candidatas do perímetro da meta, lado a lado. Elas não se somam: royalties das
          unidades são receita do grupo e parte do faturamento da rede. Mês em andamento e mês que a
          fonte marca como parcial ficam fora da conta. Vale para a empresa inteira: o filtro de
          unidade e o de período não se aplicam aqui.
        </p>
      </header>
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
      {trajetoria && (
        <div className="grid gap-3 lg:grid-cols-2">
          {trajetoria.map((t) => (
            <CartaoLeitura key={t.id} t={t} preview={preview} />
          ))}
        </div>
      )}
    </section>
  );
}
