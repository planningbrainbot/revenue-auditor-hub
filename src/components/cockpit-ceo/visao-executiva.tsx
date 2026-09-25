import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, Clock, MessagesSquare, TriangleAlert } from "lucide-react";
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
import { KpiCard, KpiGrade, Secao, StatusBadge, formatarQuando } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FRENTES, ORDEM_FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { montarLeituraExecutiva } from "@/lib/cockpit-ceo/visao-executiva";
import type { SaudeDados } from "@/lib/cockpit-ceo/visao-executiva";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";
import { BotaoDestino } from "./composicao";
import { valorCurto } from "./estado";
import { cartaoDoIndicador } from "./indicador";

// Visão executiva, revisão de 24/09/2026 (contrato docs/design/contratos/cockpit-ceo.md, revisão
// "leitura de dez segundos"). Arquétipo Visão geral, nesta ordem:
//   1. quatro números com comparação e tendência (clique abre a composição);
//   2. o gráfico principal (faturamento do grupo, meses fechados) ao lado do que pede atenção;
//   3. abaixo da dobra: decisões com alternativas e o caminho para as frentes.
// Método, fórmula e procedência completa ficam na composição de cada número e na frente
// Evidências; aqui fica só o nome da fonte e a saúde das fontes num selo.

const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

/** Selo compacto de saúde das fontes; o detalhe abre num popover (N3 sem poluir a leitura). */
export function SaudeDasFontes({ saude }: { saude: SaudeDados }) {
  if (!saude.total) return null;
  const ok = saude.paradas.length === 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Saúde das fontes de dados">
          {ok ? (
            <CircleCheck className="size-4 text-success" aria-hidden />
          ) : (
            <TriangleAlert className="size-4 text-warning" aria-hidden />
          )}
          {ok
            ? "Fontes em dia"
            : `${saude.paradas.length} de ${saude.total} fonte${saude.total > 1 ? "s" : ""} atrasada${saude.paradas.length > 1 ? "s" : ""}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-3">
        <p className="text-sm font-semibold">Última atualização de cada fonte</p>
        <ul className="space-y-2">
          {saude.linhas.map((l) => (
            <li key={l.fonte} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{l.fonte}</span>
                {l.estado !== "em_dia" && (
                  <span className="block text-[13px] text-muted-foreground">{l.nota}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                {formatarQuando(l.atualizadoEm) || "sem data"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/cockpit-ceo"
          search={{ frente: "capital" } as never}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-text hover:underline"
        >
          Método, réguas e cobertura <ArrowRight className="size-4" aria-hidden />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

export function BotaoPerguntar() {
  return (
    <Button asChild size="sm">
      <Link to="/cockpit-ceo/perguntar">
        <MessagesSquare className="size-4" aria-hidden /> Perguntar ao Brain
      </Link>
    </Button>
  );
}

function Caixa({
  titulo,
  acao,
  children,
}: {
  titulo: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{titulo}</h2>
        {acao}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

export function VisaoExecutivaLeitura({
  cockpit,
  abrir,
  preview,
  irParaFrente,
}: {
  cockpit: Cockpit;
  abrir: (id: string) => void;
  preview: boolean;
  irParaFrente: (f: Frente) => void;
}) {
  const l = useMemo(() => montarLeituraExecutiva(cockpit), [cockpit]);
  const g = l.grafico;
  return (
    <>
      <KpiGrade colunas={4}>
        {l.cartoes.map(({ indicador: i, rotulo, fonteCurta, tendencia }) => {
          const p = cartaoDoIndicador(i, () => abrir(i.id));
          return (
            <KpiCard
              key={i.id}
              {...p}
              rotulo={rotulo}
              procedencia={{ fonte: fonteCurta, atualizadoEm: i.dataDado }}
              tendencia={tendencia ?? undefined}
            />
          );
        })}
      </KpiGrade>
      {l.ausentes.length > 0 && (
        <ul className="space-y-1" aria-label="Números sem dado agora">
          {l.ausentes.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{a.titulo}</span> sem número agora:{" "}
                {a.motivo.replace(/\.$/, "")}.
                {a.ultimoConfiavel ? ` Último mês confiável: ${a.ultimoConfiavel}.` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Caixa
          titulo={
            g?.ultimo
              ? `Como o faturamento evoluiu até ${mesBr(g.ultimo.mes)}?`
              : "Como o faturamento evoluiu?"
          }
          acao={
            <Button variant="ghost" size="sm" onClick={() => irParaFrente("receita")}>
              De onde veio <ArrowRight className="size-4" aria-hidden />
            </Button>
          }
        >
          {g && g.meses.length ? (
            <div className="space-y-3">
              <div
                className="h-44 w-full"
                role="img"
                aria-label={`Faturamento do grupo por mês fechado, ${g.meses.length} meses`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={g.meses.map((m) => ({ ...m, rotulo: mesCurto(m.mes) }))}
                    margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="rotulo" {...eixoProps} />
                    <YAxis
                      {...eixoProps}
                      width={84}
                      tickFormatter={(v: number) => valorCurto(v, "reais")}
                    />
                    <Tooltip
                      {...tooltipProps}
                      formatter={(v) => [valorCurto(Number(v), "reais"), "Faturamento"]}
                    />
                    <Bar dataKey="valor" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {g.meses.map((m, i) => (
                        <Cell
                          key={m.mes}
                          fill={
                            i === g.meses.length - 1
                              ? CORES_SERIE[0]
                              : `color-mix(in oklab, ${CORES_SERIE[0]} 40%, var(--card))`
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {g.ponte && (
                <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Em {mesBr(g.ponte.mes)}:</span>
                  <span>
                    entrou{" "}
                    <span className="num font-semibold text-success">
                      +{valorCurto(g.ponte.entrou, "reais")}
                    </span>
                  </span>
                  <span>
                    saiu{" "}
                    <span className="num font-semibold text-danger">
                      {valorCurto(g.ponte.saiu, "reais")}
                    </span>
                  </span>
                  {!g.conciliado && (
                    <StatusBadge tom="atencao">Gráfico e cartão não conciliam</StatusBadge>
                  )}
                </p>
              )}
              <p className="text-[13px] text-muted-foreground">
                Grupo pela emissão, só meses fechados. Unidade nova e monetização ainda não aparecem
                separadas.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cockpit.trajetoriaAviso ?? "Sem mês fechado de faturamento para mostrar."}
            </p>
          )}
        </Caixa>

        <Caixa titulo="O que pede sua atenção?">
          {l.excecoes.length ? (
            <ol className="-my-1 divide-y">
              {l.excecoes.map((e) => (
                <li key={e.id} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-2">
                    <StatusBadge tom={e.gravidade === "alta" ? "perigo" : "atencao"}>
                      {e.gravidade === "alta" ? "Alta" : "Média"}
                    </StatusBadge>
                    <p className="min-w-0 font-medium leading-snug">{e.titulo}</p>
                  </div>
                  <p className="line-clamp-2 text-[13px] text-muted-foreground" title={e.impacto}>
                    {e.impacto}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px]">
                      <span className="text-muted-foreground">Responsável:</span> {e.responsavel}
                    </span>
                    {e.indicador && (
                      <Button variant="outline" size="sm" onClick={() => abrir(e.indicador!)}>
                        Ver número <ArrowRight className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma regra de atenção disparou com os números disponíveis. Isso não cobre o que
              ainda não é apurado.
            </p>
          )}
        </Caixa>
      </div>

      {l.decisoes.length > 0 && (
        <Secao titulo="O que é decisão sua?">
          <ul className="grid gap-3 lg:grid-cols-3">
            {l.decisoes.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                <StatusBadge tom="info">Decisão</StatusBadge>
                <p className="font-semibold leading-snug">{d.titulo}</p>
                {d.alternativas.length > 0 ? (
                  <ul className="space-y-1 text-[13px]">
                    {d.alternativas.map((a) => (
                      <li key={a} className="flex gap-1.5">
                        <span aria-hidden className="text-muted-foreground">
                          ·
                        </span>
                        {a}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted-foreground">{d.porque}</p>
                )}
                {d.efeito && (
                  <p className="text-[13px] text-muted-foreground">Efeito: {d.efeito}</p>
                )}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[13px]">
                    <span className="text-muted-foreground">Quem decide:</span> {d.responsavel}
                  </span>
                  {d.destino && <BotaoDestino destino={d.destino} preview={preview} compacto />}
                </div>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <nav
        aria-label="Frentes do cockpit"
        className="flex flex-wrap items-center gap-2 border-t pt-4"
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aprofundar
        </span>
        {ORDEM_FRENTES.map((f) => (
          <Button key={f} variant="outline" size="sm" onClick={() => irParaFrente(f)}>
            {FRENTES[f].titulo}
          </Button>
        ))}
      </nav>
    </>
  );
}
