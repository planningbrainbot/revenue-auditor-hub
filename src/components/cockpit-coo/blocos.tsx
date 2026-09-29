import { Link } from "@tanstack/react-router";
import { AlertOctagon, AlertTriangle, ArrowUpRight, ClipboardPlus, ExternalLink, Unplug } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiGrade, StatusBadge } from "@/components/planning";
import type { EstadoKpi } from "@/components/planning";
import { Bloco, Legenda, SemDadoGrafico } from "@/components/cockpit-ceo/graficos";
import { valorCurto } from "@/components/cockpit-ceo/estado";
import { hrefDoDestino } from "@/components/cockpit-ceo/composicao";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import {
  CORES_SERIE,
  COR_NEUTRA,
  RAIO_BARRA,
  RAIO_BARRA_HORIZONTAL,
  eixoProps,
  gradeProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { MAX_ALERTAS_NA_TELA, TEMAS, ordenarAlertas } from "@/lib/cockpit-coo/contrato";
import type { AlertaCoo, Estado, GraficoCoo, NumeroCoo, Tema } from "@/lib/cockpit-coo/contrato";
import type { Compromisso, ExecucaoTema } from "@/lib/cockpit-coo/compromissos";
import type { OkrsTema } from "@/lib/cockpit-coo/okrs";
import { cn } from "@/lib/utils";

const ESTADO_KPI: Record<Estado, EstadoKpi> = {
  disponivel: "ok",
  parcial: "parcial",
  nao_apurado: "nao-apurado",
  fonte_indisponivel: "indisponivel",
  acesso_insuficiente: "sem-acesso",
};

const dataCurta = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
      })
    : "sem prazo";

// ---------------------------------------------------------------------------------------------
// Números da primeira dobra
// ---------------------------------------------------------------------------------------------

export function NumerosTema({ numeros, abrir }: { numeros: NumeroCoo[]; abrir: (n: NumeroCoo) => void }) {
  return (
    <KpiGrade colunas={numeros.length > 4 ? 6 : numeros.length === 3 ? 3 : 4}>
      {numeros.map((n) => (
        <KpiCard
          key={n.id}
          area="cockpit_coo"
          rotulo={n.rotulo}
          valor={valorCurto(n.valor, n.unidade)}
          estado={ESTADO_KPI[n.estado]}
          nota={n.estado === "disponivel" || n.estado === "parcial" ? n.nota : (n.motivo ?? n.nota)}
          meta={n.meta ? { valor: formatarNumero(n.meta.valor, n.unidade), rotulo: n.meta.rotulo } : undefined}
          delta={n.delta}
          tendencia={n.tendencia}
          tom={n.tom}
          procedencia={{ fonte: n.fonte, atualizadoEm: n.dataDado }}
          abrir={{ onClick: () => abrir(n), rotulo: "Ver explicação" }}
        />
      ))}
    </KpiGrade>
  );
}

// ---------------------------------------------------------------------------------------------
// O que pede atenção: até 3, cada um com destino e com o compromisso (novo ou o que já existe)
// ---------------------------------------------------------------------------------------------

export function CaixaAtencao({
  alertas,
  compromissos,
  podeCriar,
  motivoSemCriar,
  virarCompromisso,
}: {
  alertas: AlertaCoo[];
  compromissos: Compromisso[];
  podeCriar: boolean;
  motivoSemCriar: string | null;
  virarCompromisso: (a: AlertaCoo) => void;
}) {
  const ordenados = ordenarAlertas(alertas);
  const mostrados = ordenados.slice(0, MAX_ALERTAS_NA_TELA);
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="coo-atencao">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="coo-atencao" className="text-[15px] font-semibold">
          O que pede atenção
        </h2>
        <span className="text-xs text-muted-foreground">
          {ordenados.length === 0
            ? "nada fora da régua"
            : ordenados.length > mostrados.length
              ? `${mostrados.length} de ${ordenados.length}, os mais graves`
              : `${ordenados.length}`}
        </span>
      </header>
      {mostrados.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum alerta pelas regras deste tema.</p>
      ) : (
        <ul className="divide-y">
          {mostrados.map((a) => {
            const existente = compromissos.find((c) => c.origem === a.chave && !c.concluida);
            const Icone = a.gravidade === "critico" ? AlertOctagon : AlertTriangle;
            return (
              <li key={a.chave} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <p className="flex min-w-0 items-center gap-2 text-sm" title={a.limiar}>
                  <Icone
                    className={cn("size-4 shrink-0", a.gravidade === "critico" ? "text-danger" : "text-warning")}
                    aria-label={a.gravidade === "critico" ? "crítico" : "atenção"}
                  />
                  <span className="truncate">{a.titulo}</span>
                </p>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {a.destino && (
                    <Button asChild size="sm" variant="outline">
                      <a href={hrefDoDestino(a.destino)}>
                        Abrir
                        <ArrowUpRight className="ml-1 size-3" aria-hidden />
                      </a>
                    </Button>
                  )}
                  {existente ? (
                    <a
                      href={existente.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      compromisso: {existente.dono?.nome ?? "sem dono"} · {dataCurta(existente.prazo)}
                    </a>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => virarCompromisso(a)}
                      disabled={!podeCriar}
                      title={podeCriar ? "Criar uma tarefa no ClickUp com dono e prazo" : (motivoSemCriar ?? undefined)}
                    >
                      <ClipboardPlus className="mr-1 size-4" aria-hidden />
                      Virar compromisso
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Execução no ClickUp: compromissos do tema desde a última reunião
// ---------------------------------------------------------------------------------------------

export function CaixaExecucao({
  tema,
  execucao,
  conectado,
  motivo,
}: {
  tema: Tema;
  execucao: ExecucaoTema | null;
  conectado: boolean;
  motivo: string | null;
}) {
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="coo-execucao">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="coo-execucao" className="text-[15px] font-semibold">
          Compromissos de {TEMAS[tema].diaRotulo.toLowerCase()}
        </h2>
        <Link
          to="/cockpit-coo/compromissos"
          search={{ tema }}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Ver todos →
        </Link>
      </header>
      {!conectado || !execucao ? (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Unplug className="size-4 shrink-0" aria-hidden />
          {motivo ?? "O ClickUp ainda não está conectado."}
        </p>
      ) : (
        <>
          <p className="num px-4 pt-3 text-sm">
            <b>{execucao.abertos}</b> abertos ·{" "}
            <b className={execucao.vencidos ? "text-danger" : undefined}>{execucao.vencidos}</b> vencidos ·{" "}
            <b>{execucao.feitosDesdeUltima}</b> feitos desde {dataCurta(execucao.desde)}
          </p>
          {execucao.destaques.length === 0 ? (
            <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">Nenhum compromisso aberto neste tema.</p>
          ) : (
            <ul className="divide-y pt-2">
              {execucao.destaques.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {c.vencido && <AlertOctagon className="size-4 shrink-0 text-danger" aria-label="vencido" />}
                    <span className="truncate">{c.nome}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {c.dono?.nome ?? "sem dono"} · {c.vencido ? `venceu ${dataCurta(c.prazo)}` : dataCurta(c.prazo)}
                    <a href={c.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${c.nome} no ClickUp`}>
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// OKRs do tema: evolução diária por departamento contra o esperado do ciclo (pedido do COO)
// ---------------------------------------------------------------------------------------------

const pct = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);

export function BlocoOkrs({ okrs, abrir }: { okrs: OkrsTema | null; abrir: () => void }) {
  if (!okrs)
    return (
      <Bloco titulo="Como evoluem os OKRs deste tema?" abrir={abrir}>
        <SemDadoGrafico estado="fonte_indisponivel" motivo="a foto diária de OKRs não carregou" />
      </Bloco>
    );
  const deptos = okrs.departamentos;
  const titulo = `Como evoluem os OKRs de ${TEMAS[okrs.tema].departamentos.join(", ")}?`;
  if (!deptos.length)
    return (
      <Bloco titulo={titulo} abrir={abrir}>
        <SemDadoGrafico estado={okrs.estado === "disponivel" ? "nao_apurado" : okrs.estado} motivo={okrs.motivo ?? "nenhuma KR destes departamentos na foto"} />
      </Bloco>
    );
  // Uma linha por dia com o progresso de cada departamento e o esperado do ciclo.
  const dias = [...new Set(deptos.flatMap((d) => d.serie.map((p) => p.dia)))].sort();
  const pontos = dias.map((dia) => {
    const linha: Record<string, number | string | null> = { dia: dia.slice(8, 10) + "/" + dia.slice(5, 7) };
    for (const [i, d] of deptos.entries()) {
      const p = d.serie.find((x) => x.dia === dia);
      linha[`d${i}`] = p?.progresso == null ? null : Math.round(p.progresso * 1000) / 10;
    }
    const esperado = deptos[0].serie.find((x) => x.dia === dia)?.esperado ?? null;
    linha.esperado = esperado == null ? null : Math.round(esperado * 1000) / 10;
    return linha;
  });
  const media =
    deptos.filter((d) => d.progresso != null).reduce((s, d) => s + (d.progresso ?? 0), 0) /
    Math.max(1, deptos.filter((d) => d.progresso != null).length);
  return (
    <Bloco
      titulo={titulo}
      numero={pct(deptos.some((d) => d.progresso != null) ? media : null)}
      complemento={`esperado ${pct(deptos[0].esperado)} em ${dataCurta(okrs.ultimoDia)}`}
      selo={
        okrs.parado ? (
          <StatusBadge tom="atencao">foto parada desde {dataCurta(okrs.ultimoDia)}</StatusBadge>
        ) : undefined
      }
      abrir={abrir}
    >
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="dia" {...eixoProps} minTickGap={24} />
            <YAxis {...eixoProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
            <Tooltip {...tooltipProps} formatter={(v: number | string) => (typeof v === "number" ? `${v}%` : v)} />
            <Line dataKey="esperado" name="Esperado do ciclo" stroke={COR_NEUTRA} strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
            {deptos.map((d, i) => (
              <Line
                key={d.nome}
                dataKey={`d${i}`}
                name={d.base}
                stroke={CORES_SERIE[i % 5]}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legenda
        itens={[
          ...deptos.map((d, i) => ({ rotulo: d.base, cor: CORES_SERIE[i % 5] as string })),
          { rotulo: "Esperado do ciclo", cor: COR_NEUTRA, forma: "tracejado" as const },
        ]}
      />
      <ul className="mt-2 divide-y rounded-lg border">
        {deptos.map((d) => (
          <li key={d.nome} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
            <span className="font-medium">{d.nome}</span>
            <span className="num text-muted-foreground">
              {pct(d.progresso)} · {d.krs.noRitmo} no ritmo · {d.krs.atras} atrás · {d.krs.semMedicao} sem medição
            </span>
          </li>
        ))}
      </ul>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------------------------
// O gráfico do tema
// ---------------------------------------------------------------------------------------------

export function GraficoTema({ g, abrir }: { g: GraficoCoo; abrir: () => void }) {
  if (g.estado !== "disponivel" && g.estado !== "parcial")
    return (
      <Bloco titulo={g.titulo} abrir={abrir}>
        <SemDadoGrafico estado={g.estado} motivo={g.motivo ?? "sem dado"} />
      </Bloco>
    );
  const fmt = (v: number | string) => (typeof v === "number" ? valorCurto(v, g.unidade) : v);
  const horizontal = g.tipo === "barras-h";
  const altura = horizontal ? Math.max(160, g.pontos.length * 28 + 40) : 220;
  return (
    <Bloco
      titulo={g.titulo}
      selo={g.estado === "parcial" ? <StatusBadge tom="atencao">dado parcial</StatusBadge> : undefined}
      abrir={abrir}
    >
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          {g.tipo === "linhas" ? (
            <LineChart data={g.pontos} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="rotulo" {...eixoProps} minTickGap={16} />
              <YAxis {...eixoProps} tickFormatter={(v) => fmt(v)} width={72} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <Tooltip {...tooltipProps} formatter={(v: number | string) => fmt(v)} />
              {g.series.map((s, i) => (
                <Line key={s.chave} dataKey={s.chave} name={s.rotulo} stroke={CORES_SERIE[i % 5]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          ) : (
            <BarChart
              data={g.pontos}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: 8, right: 16, bottom: 0, left: horizontal ? 8 : 0 }}
            >
              <CartesianGrid {...gradeProps} vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" {...eixoProps} tickFormatter={(v) => fmt(v)} />
                  <YAxis type="category" dataKey="rotulo" {...eixoProps} width={120} />
                </>
              ) : (
                <>
                  <XAxis dataKey="rotulo" {...eixoProps} />
                  <YAxis {...eixoProps} tickFormatter={(v) => fmt(v)} width={72} />
                </>
              )}
              <Tooltip {...tooltipProps} formatter={(v: number | string) => fmt(v)} />
              {g.series.map((s, i) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.rotulo}
                  fill={CORES_SERIE[i % 5]}
                  radius={horizontal ? RAIO_BARRA_HORIZONTAL : RAIO_BARRA}
                  maxBarSize={22}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {g.series.length > 1 && (
        <Legenda itens={g.series.map((s, i) => ({ rotulo: s.rotulo, cor: CORES_SERIE[i % 5] as string }))} />
      )}
    </Bloco>
  );
}
