import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import {
  CORES_COCKPIT,
  HACHURA_ID,
  RAIO_BARRA,
  RAIO_BARRA_HORIZONTAL,
  eixoProps,
  gradeProps,
} from "@/lib/planning/grafico";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { CHURN_REFERENCIA, LIMIAR_ABERTO, mesAnterior, proximoMes } from "@/lib/cockpit-ceo/visual";
import type {
  CascataPonte,
  Composicao,
  Entrega,
  FonteParada,
  FormulaChurn,
  MesFranqueadoraModelo,
  Rede,
  Trajetoria,
} from "@/lib/cockpit-ceo/visual";
import { pctTexto, reaisCurto, vezesTexto } from "@/lib/cockpit-ceo/explicacoes";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dica, Legenda } from "./graficos";
import type { DicaDado } from "./graficos";

// Os gráficos da Visão executiva (revisão visual de 28/09/2026). Cada um recebe o modelo pronto de
// `lib/cockpit-ceo/visual.ts` e só desenha: traço fino, barra com canto de 4px na ponta, grade
// discreta, rótulo direto só no ponto que importa, legenda com duas séries ou mais, um eixo só.

const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const cursorSuave = { fill: "var(--muted)", opacity: 0.4 };
const UNIVERSO_GRUPO = "grupo · emissão · recortes padrão";

// ── 1. Trajetória rumo ao bilhão ─────────────────────────────────────────────

const TICKS_LOG = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8];

export function GraficoTrajetoria({ m, compacto = false }: { m: Trajetoria; compacto?: boolean }) {
  const celular = useIsMobile();
  const inicio = m.pontos[0].mes;
  const fim = `${m.degraus.at(-1)!.ano}-12`;
  const ultimoFechado = [...m.pontos].reverse().find((p) => !p.parcial) ?? null;
  const porMes = new Map(m.pontos.map((p) => [p.mes, p]));
  const degrauDoAno = new Map(m.degraus.map((d) => [d.ano, d.media]));
  const dados: Record<string, unknown>[] = [];
  for (let mes = inicio; mes <= fim; mes = proximoMes(mes)) {
    const p = porMes.get(mes);
    const ano = Number(mes.slice(0, 4));
    const degrau = degrauDoAno.get(ano) ?? null;
    const ehUltimoFechado = ultimoFechado?.mes === mes;
    dados.push({
      mes,
      real: p && !p.parcial ? p.valor : null,
      // O trecho parcial liga o último mês fechado ao mês em curso.
      parcial: p?.parcial || ehUltimoFechado ? p?.valor : null,
      // O degrau do ano corrente só começa depois do último realizado, para não cruzar a linha.
      degrau: ano === m.ano ? null : degrau,
      dica: {
        titulo: mesBr(mes),
        linhas: [
          ...(p
            ? ([[p.parcial ? "Faturado até agora" : "Faturado", reaisCurto(p.valor)]] as [
                string,
                string,
              ][])
            : []),
          ...(degrau !== null
            ? ([[`Média exigida em ${ano}`, `${reaisCurto(degrau)}/mês`]] as [string, string][])
            : []),
          ["Meta", `${reaisCurto(m.meta)}/mês`],
        ],
        periodo: p?.parcial ? "mês em curso, parcial" : p ? "mês fechado" : "projeção da meta",
        universo: UNIVERSO_GRUPO,
      } satisfies DicaDado,
    });
  }
  const ticksX = dados.map((d) => d.mes as string).filter((mes) => mes.endsWith("-01"));
  const altura = compacto ? "h-20" : "h-72 md:h-80";
  return (
    <div className="space-y-2">
      <div
        className={altura}
        role="img"
        aria-label={`Faturamento mensal do grupo em ${m.ano} e a média mensal exigida até ${m.degraus.at(-1)!.ano}, escala logarítmica`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={dados}
            margin={
              compacto
                ? { top: 4, right: 4, left: 4, bottom: 0 }
                : { top: 20, right: 12, left: 4, bottom: 0 }
            }
          >
            {!compacto && <CartesianGrid {...gradeProps} />}
            <XAxis
              dataKey="mes"
              {...eixoProps}
              ticks={ticksX}
              tickFormatter={(v: string) => v.slice(0, 4)}
              hide={compacto}
            />
            <YAxis
              {...eixoProps}
              scale="log"
              domain={[Math.min(TICKS_LOG[0], m.media / 2), 1.2e8]}
              ticks={TICKS_LOG}
              allowDataOverflow
              width={76}
              tickFormatter={(v: number) => reaisCurto(v).replace(",0", "")}
              hide={compacto}
            />
            <Tooltip content={<Dica />} cursor={{ stroke: "var(--border)" }} />
            <ReferenceLine
              y={m.meta}
              stroke={CORES_COCKPIT.meta}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={
                compacto
                  ? undefined
                  : {
                      value: `Meta ${reaisCurto(m.meta)}/mês = R$ 1 bi/ano`,
                      position: "insideTopLeft",
                      fill: "var(--muted-foreground)",
                      fontSize: 12,
                    }
              }
            />
            <Line
              dataKey="degrau"
              type="stepAfter"
              stroke={CORES_COCKPIT.meta}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            >
              {!compacto && !celular && (
                <LabelList
                  dataKey="degrau"
                  content={({ x, y, value, index }) => {
                    const d = dados[index as number];
                    if (!d || !(d.mes as string).endsWith("-01") || value == null) return null;
                    return (
                      <text
                        x={Number(x) + 4}
                        y={Number(y) - 6}
                        fontSize={12}
                        fill="var(--muted-foreground)"
                        className="num"
                      >
                        {reaisCurto(Number(value)).replace(",0", "")}
                      </text>
                    );
                  }}
                />
              )}
            </Line>
            <Line
              dataKey="parcial"
              stroke={CORES_COCKPIT.realizado}
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              dataKey="real"
              stroke={CORES_COCKPIT.realizado}
              strokeWidth={2}
              dot={compacto ? false : { r: 2.5, fill: CORES_COCKPIT.realizado, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls={false}
            >
              {!compacto && (
                <LabelList
                  dataKey="real"
                  content={({ x, y, value, index }) => {
                    if (dados[index as number]?.mes !== ultimoFechado?.mes || value == null)
                      return null;
                    return (
                      <text
                        x={Number(x)}
                        y={Number(y) - 10}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={600}
                        fill="var(--foreground)"
                      >
                        {reaisCurto(Number(value))}
                      </text>
                    );
                  }}
                />
              )}
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!compacto && (
        <Legenda
          itens={[
            { rotulo: "Faturado (mês fechado)", cor: CORES_COCKPIT.realizado, forma: "traco" },
            { rotulo: "Mês em curso, parcial", cor: CORES_COCKPIT.realizado, forma: "tracejado" },
            { rotulo: "Média mensal exigida no ano", cor: CORES_COCKPIT.meta, forma: "tracejado" },
          ]}
        />
      )}
    </div>
  );
}

/** Os quatro números ao lado da trajetória. Todos calculados do modelo. */
export function NumerosTrajetoria({ m, seloD0 }: { m: Trajetoria; seloD0: React.ReactNode }) {
  const itens: { rotulo: string; valor: string; extra?: React.ReactNode }[] = [
    { rotulo: "Meta", valor: `${reaisCurto(m.meta)}/mês`, extra: seloD0 },
    { rotulo: `Média do grupo ${m.ano}`, valor: `${reaisCurto(m.media)}/mês` },
    { rotulo: "Distância", valor: vezesTexto(m.distancia) },
    { rotulo: "Ritmo pedido", valor: `${pctTexto(m.ritmoPct, 0)} a.a.` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
      {itens.map((i) => (
        <div key={i.rotulo} className="min-w-0 space-y-0.5">
          <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {i.rotulo}
          </dt>
          <dd className="num text-2xl font-bold leading-tight md:text-3xl">{i.valor}</dd>
          {i.extra && <dd>{i.extra}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ── 2. Ponte do último mês fechado ───────────────────────────────────────────

const ROTULO_CURTO_PONTE: Record<string, string> = {
  novos: "Novos",
  expansao: "Expande",
  contracao: "Contrai",
  saida: "Saída",
  "sem-cliente": "S/ cliente",
};

export function GraficoPonte({ m }: { m: CascataPonte }) {
  const celular = useIsMobile();
  const dados = m.degraus.map((d) => ({
    rotulo:
      d.tipo === "nivel"
        ? celular
          ? `${d.rotulo.slice(0, 3)}${d.rotulo.slice(5)}`
          : d.rotulo
        : celular
          ? (ROTULO_CURTO_PONTE[d.id] ?? d.rotulo)
          : d.rotulo,
    faixa: d.tipo === "nivel" ? null : [Math.min(d.de, d.ate), Math.max(d.de, d.ate)],
    nivel: d.tipo === "nivel" ? d.valor : null,
    tipo: d.tipo,
    valor: d.valor,
    dica: {
      titulo: d.tipo === "nivel" ? `Faturamento de ${d.rotulo}` : d.rotulo,
      linhas: [
        [
          d.tipo === "nivel" ? "Faturado" : "Movimento",
          d.tipo === "nivel"
            ? reaisCurto(d.valor)
            : `${d.valor >= 0 ? "+" : "−"}${reaisCurto(Math.abs(d.valor))}`,
        ],
        ...(d.clientes !== null ? ([["Clientes", String(d.clientes)]] as [string, string][]) : []),
      ],
      periodo: `${mesBr(mesAnterior(m.mes))} → ${mesBr(m.mes)}`,
      universo: UNIVERSO_GRUPO,
    } satisfies DicaDado,
  }));
  const topo = Math.max(...m.degraus.flatMap((d) => [d.de, d.ate]));
  return (
    <div className="space-y-2">
      <div className="h-56" role="img" aria-label={`Ponte do faturamento de ${mesBr(m.mes)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 20, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis
              dataKey="rotulo"
              {...eixoProps}
              interval={0}
              tick={{ ...eixoProps.tick, fontSize: 12 }}
            />
            <YAxis
              {...eixoProps}
              domain={[m.piso, topo * 1.03]}
              allowDataOverflow
              width={76}
              tickFormatter={(v: number) => reaisCurto(v)}
            />
            <Tooltip content={<Dica />} cursor={cursorSuave} />
            <Bar dataKey="faixa" radius={4} isAnimationActive={false} maxBarSize={44}>
              {dados.map((d) => (
                <Cell
                  key={d.rotulo}
                  fill={d.tipo === "saida" ? CORES_COCKPIT.alerta : CORES_COCKPIT.realizado}
                />
              ))}
              <LabelList
                dataKey="valor"
                content={({ x, y, width, index }) => {
                  const d = dados[index as number];
                  if (!d || d.tipo === "nivel" || celular) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--foreground)"
                    >
                      {`${d.valor >= 0 ? "+" : "−"}${reaisCurto(Math.abs(d.valor))}`}
                    </text>
                  );
                }}
              />
            </Bar>
            {/* Nível: traço grosso na largura da coluna, não barra com eixo cortado. */}
            <Scatter
              dataKey="nivel"
              isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { valor: number } }) =>
                p.cx == null || p.cy == null || p.payload == null ? (
                  <g />
                ) : (
                  <g>
                    <line
                      x1={p.cx - 22}
                      x2={p.cx + 22}
                      y1={p.cy}
                      y2={p.cy}
                      stroke="var(--foreground)"
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                    <text
                      x={p.cx}
                      y={p.cy - 8}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--foreground)"
                    >
                      {reaisCurto(p.payload.valor)}
                    </text>
                  </g>
                )
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Eixo cortado: começa em {reaisCurto(m.piso)}</p>
    </div>
  );
}

// ── 3. Composição da receita ─────────────────────────────────────────────────

export function GraficoComposicao({ m }: { m: Composicao }) {
  const dados = m.itens.map((i) => ({
    name: i.categoria,
    size: i.receita,
    recorrente: i.recorrente,
    participacao: i.participacao,
    dica: {
      titulo: i.categoria,
      linhas: [
        ["Receita", reaisCurto(i.receita)],
        ["Participação", pctTexto(i.participacao)],
        [
          "Recorrência",
          i.recorrente === null ? "sem marcação" : i.recorrente ? "recorrente" : "não recorrente",
        ],
      ],
      periodo: `${mesBr(m.de)} a ${mesBr(m.ate)}`,
      universo: UNIVERSO_GRUPO,
    } satisfies DicaDado,
  }));
  return (
    <div className="space-y-2">
      <div className="h-56" role="img" aria-label="Receita por categoria de serviço">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={dados}
            dataKey="size"
            isAnimationActive={false}
            content={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ((p: any) => {
                if (p.depth !== 1) return <g />;
                const cor =
                  p.recorrente === null
                    ? `url(#${HACHURA_ID})`
                    : p.recorrente
                      ? CORES_COCKPIT.realizado
                      : CORES_COCKPIT.terceira;
                const cabe = p.width > 70 && p.height > 34;
                return (
                  <g>
                    <rect
                      x={p.x + 1}
                      y={p.y + 1}
                      width={Math.max(0, p.width - 2)}
                      height={Math.max(0, p.height - 2)}
                      rx={4}
                      fill={cor}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                    {cabe && (
                      <>
                        <text
                          x={p.x + 8}
                          y={p.y + 18}
                          fontSize={12}
                          fontWeight={600}
                          fill={p.recorrente === null ? "var(--foreground)" : "var(--viz-rotulo)"}
                        >
                          {String(p.name).length * 7 > p.width - 12
                            ? `${String(p.name).slice(0, Math.max(3, Math.floor((p.width - 20) / 7)))}…`
                            : p.name}
                        </text>
                        <text
                          x={p.x + 8}
                          y={p.y + 32}
                          fontSize={12}
                          fill={p.recorrente === null ? "var(--foreground)" : "var(--viz-rotulo)"}
                        >
                          {pctTexto(p.participacao, 0)}
                        </text>
                      </>
                    )}
                  </g>
                );
              }) as never
            }
          >
            <Tooltip content={<Dica />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <Legenda
        itens={[
          { rotulo: "Recorrente", cor: CORES_COCKPIT.realizado },
          { rotulo: "Não recorrente", cor: CORES_COCKPIT.terceira },
          ...(m.semClassificacao
            ? [
                {
                  rotulo: "Sem marcação",
                  cor: "var(--muted-foreground)",
                  forma: "hachura" as const,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

// ── 4. Churn por fórmula ─────────────────────────────────────────────────────

export function GraficoChurn({ fs, compacto = false }: { fs: FormulaChurn[]; compacto?: boolean }) {
  const maximo = Math.max(CHURN_REFERENCIA * 1.5, ...fs.map((f) => f.max?.taxa ?? 0)) * 1.08;
  const dados = fs.map((f) => ({
    rotulo: f.rotulo,
    faixa:
      f.min && f.max
        ? [f.min.taxa, Math.max(f.max.taxa, f.min.taxa + maximo * 0.004)]
        : [0, maximo],
    media: f.media,
    semNumero: f.media === null,
    dica: {
      titulo: f.rotulo,
      linhas:
        f.media === null
          ? ([["Estado", f.motivo ?? "sem número"]] as [string, string][])
          : ([
              ["Média mensal", pctTexto(f.media)],
              ["Menor mês", `${pctTexto(f.min!.taxa)} · ${mesBr(f.min!.mes)}`],
              ["Maior mês", `${pctTexto(f.max!.taxa)} · ${mesBr(f.max!.mes)}`],
            ] as [string, string][]),
      periodo: `${f.meses.length} meses`,
      universo: f.fonte,
    } satisfies DicaDado,
  }));
  return (
    <div className="space-y-2">
      <div
        className={compacto ? "h-24" : "h-60"}
        role="img"
        aria-label="Churn mensal por fórmula: média e faixa entre o menor e o maior mês"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={
              compacto
                ? { top: 0, right: 4, left: 0, bottom: 0 }
                : { top: 16, right: 16, left: 0, bottom: 0 }
            }
            barCategoryGap={compacto ? 4 : 14}
          >
            {!compacto && <CartesianGrid {...gradeProps} horizontal={false} vertical />}
            <XAxis
              type="number"
              {...eixoProps}
              domain={[0, maximo]}
              tickFormatter={(v: number) => pctTexto(v, 0)}
              hide={compacto}
            />
            <YAxis
              type="category"
              dataKey="rotulo"
              {...eixoProps}
              width={compacto ? 0 : 150}
              hide={compacto}
              tick={{ ...eixoProps.tick, fontSize: 12 }}
            />
            <Tooltip content={<Dica />} cursor={cursorSuave} />
            <ReferenceLine
              x={CHURN_REFERENCIA}
              stroke={CORES_COCKPIT.meta}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={
                compacto
                  ? undefined
                  : {
                      value: `${pctTexto(CHURN_REFERENCIA, 2)} no mapa`,
                      position: "top",
                      fill: "var(--muted-foreground)",
                      fontSize: 12,
                    }
              }
            />
            <Bar
              dataKey="faixa"
              isAnimationActive={false}
              shape={
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((p: any) => {
                  const d = p.payload;
                  const meio = p.y + p.height / 2;
                  if (d.semNumero)
                    return (
                      <g>
                        <rect
                          x={p.x}
                          y={meio - 5}
                          width={p.width}
                          height={10}
                          rx={4}
                          fill={`url(#${HACHURA_ID})`}
                          opacity={0.5}
                        />
                        {!compacto && (
                          <text
                            x={p.x + 6}
                            y={meio + 4}
                            fontSize={12}
                            fill="var(--muted-foreground)"
                          >
                            sem número
                          </text>
                        )}
                      </g>
                    );
                  const [a, b] = d.faixa as [number, number];
                  const cx = p.x + (p.width * ((d.media as number) - a)) / (b - a || 1);
                  return (
                    <g>
                      <rect
                        x={p.x}
                        y={meio - 3}
                        width={Math.max(p.width, 2)}
                        height={6}
                        rx={3}
                        fill={CORES_COCKPIT.terceira}
                        opacity={0.45}
                      />
                      <circle
                        cx={cx}
                        cy={meio}
                        r={compacto ? 4 : 6}
                        fill={CORES_COCKPIT.terceira}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                      {!compacto && (
                        <text
                          x={p.x + Math.max(p.width, 2) + 8}
                          y={meio + 4}
                          fontSize={12}
                          fill="var(--foreground)"
                          className="num"
                        >
                          {pctTexto(d.media as number)}
                        </text>
                      )}
                    </g>
                  );
                }) as never
              }
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!compacto && (
        <Legenda
          itens={[
            { rotulo: "Média mensal", cor: CORES_COCKPIT.terceira },
            { rotulo: "Faixa: menor a maior mês", cor: CORES_COCKPIT.terceira, forma: "traco" },
            { rotulo: "Referência do mapa", cor: CORES_COCKPIT.meta, forma: "tracejado" },
          ]}
        />
      )}
    </div>
  );
}

// ── 5. Rede: MRR por unidade e franqueadora ──────────────────────────────────

export function GraficoRedeMrr({ m, compacto = false }: { m: Rede; compacto?: boolean }) {
  const dados = m.unidades.map((u, i) => ({
    rotulo: u.unidade,
    mrr: u.mrr,
    maior: i === 0,
    participacao: u.participacao,
    dica: {
      titulo: u.unidade,
      linhas: [
        ["MRR ativo", reaisCurto(u.mrr)],
        ["Participação", pctTexto(u.participacao)],
        ["Contratos ativos", String(u.contratos)],
      ],
      periodo: "fotografia de agora",
      universo: "contratos de serviço ativos do Omie das unidades",
    } satisfies DicaDado,
  }));
  const linhas = compacto ? dados.slice(0, 5) : dados;
  return (
    <div
      style={{ height: compacto ? 96 : Math.max(160, linhas.length * 30 + 24) }}
      role="img"
      aria-label="MRR ativo por base do Omie das unidades"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={linhas}
          layout="vertical"
          margin={
            compacto
              ? { top: 0, right: 4, left: 0, bottom: 0 }
              : { top: 0, right: 96, left: 0, bottom: 0 }
          }
          barCategoryGap={compacto ? 3 : 6}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="rotulo"
            {...eixoProps}
            width={compacto ? 0 : 140}
            hide={compacto}
            tick={{ ...eixoProps.tick, fontSize: 12 }}
          />
          <Tooltip content={<Dica />} cursor={cursorSuave} />
          <Bar dataKey="mrr" radius={RAIO_BARRA_HORIZONTAL} isAnimationActive={false}>
            {linhas.map((d) => (
              <Cell
                key={d.rotulo}
                fill={
                  d.maior
                    ? CORES_COCKPIT.realizado
                    : `color-mix(in oklab, ${CORES_COCKPIT.realizado} 45%, var(--card))`
                }
              />
            ))}
            {!compacto && (
              <LabelList
                dataKey="mrr"
                content={({ x, y, width, height, index }) => {
                  const d = linhas[index as number];
                  if (!d) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2 + 4}
                      fontSize={12}
                      fontWeight={d.maior ? 600 : 400}
                      fill={d.maior ? "var(--foreground)" : "var(--muted-foreground)"}
                    >
                      {d.maior
                        ? `${reaisCurto(d.mrr)} · ${pctTexto(d.participacao, 0)}`
                        : reaisCurto(d.mrr)}
                    </text>
                  );
                }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficoFranqueadora({ meses }: { meses: MesFranqueadoraModelo[] }) {
  const dados = meses.map((x) => ({
    mes: x.mes,
    rotulo: mesCurto(x.mes) + (x.parcial ? "*" : ""),
    faturado: x.semTitulo ? null : x.faturado,
    recebido: x.semTitulo ? null : x.recebido,
    aberto: x.semTitulo ? null : x.emAberto,
    semTitulo: x.semTitulo,
    parcial: x.parcial,
    dica: {
      titulo: mesBr(x.mes) + (x.parcial ? " (parcial)" : ""),
      linhas: x.semTitulo
        ? ([["Títulos", "nenhum com vencimento no mês"]] as [string, string][])
        : ([
            ["Faturado", reaisCurto(x.faturado)],
            ["Recebido", reaisCurto(x.recebido)],
            ["Em aberto", reaisCurto(x.emAberto)],
            ["Títulos", String(x.titulos)],
          ] as [string, string][]),
      periodo: "mês de vencimento",
      universo: "títulos da franqueadora (Omie da Partners)",
    } satisfies DicaDado,
  }));
  const topo = Math.max(1, ...dados.map((d) => d.faturado ?? 0));
  return (
    <div className="space-y-2">
      <div className="h-52" role="img" aria-label="Faturado e recebido da franqueadora por mês">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 22, right: 4, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="rotulo" {...eixoProps} interval="preserveStartEnd" />
            <YAxis
              {...eixoProps}
              width={76}
              domain={[0, topo * 1.12]}
              tickFormatter={(v: number) => reaisCurto(v)}
            />
            <Tooltip content={<Dica />} cursor={cursorSuave} />
            {dados
              .filter((d) => d.semTitulo)
              .map((d) => (
                <ReferenceArea
                  key={d.rotulo}
                  x1={d.rotulo}
                  x2={d.rotulo}
                  fill={`url(#${HACHURA_ID})`}
                  fillOpacity={0.35}
                  strokeOpacity={0}
                />
              ))}
            <Bar
              dataKey="faturado"
              fill={CORES_COCKPIT.terceira}
              radius={RAIO_BARRA}
              isAnimationActive={false}
              maxBarSize={18}
            >
              {dados.map((d) => (
                <Cell
                  key={d.rotulo}
                  fill={d.parcial ? `url(#${HACHURA_ID})` : CORES_COCKPIT.terceira}
                  stroke={d.parcial ? CORES_COCKPIT.terceira : undefined}
                />
              ))}
              <LabelList
                dataKey="aberto"
                content={({ x, y, width, index }) => {
                  const d = dados[index as number];
                  if (!d || d.aberto === null || d.aberto <= LIMIAR_ABERTO) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) * 2 + 2}
                      y={Number(y) - 8}
                      textAnchor="end"
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--foreground)"
                    >
                      {`aberto ${reaisCurto(d.aberto)}`}
                    </text>
                  );
                }}
              />
            </Bar>
            <Bar
              dataKey="recebido"
              fill={CORES_COCKPIT.realizado}
              radius={RAIO_BARRA}
              isAnimationActive={false}
              maxBarSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legenda
        itens={[
          { rotulo: "Faturado", cor: CORES_COCKPIT.terceira },
          { rotulo: "Recebido", cor: CORES_COCKPIT.realizado },
          { rotulo: "* mês em curso", cor: CORES_COCKPIT.terceira, forma: "hachura" },
        ]}
      />
    </div>
  );
}

// ── 6. Entrega ───────────────────────────────────────────────────────────────

export function GraficoEntrega({ m, compacto = false }: { m: Entrega; compacto?: boolean }) {
  const dados = m.fases.map((f) => ({
    rotulo: f.fase,
    cards: f.cards,
    gargalo: f.fase === m.gargalo,
    dica: {
      titulo: f.fase + (f.fase === m.gargalo ? " · gargalo" : ""),
      linhas: [
        ["Clientes na fase", String(f.cards)],
        ["Há mais de 30 dias", String(f.acima30)],
        ["Há mais de 60 dias", String(f.acima60)],
      ],
      periodo: "fotografia de agora",
      universo: "pipe de Onboarding, cards em curso",
    } satisfies DicaDado,
  }));
  return (
    <div
      style={{ height: compacto ? 96 : Math.max(160, dados.length * 34 + 16) }}
      role="img"
      aria-label="Clientes em onboarding por fase"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={dados}
          layout="vertical"
          margin={
            compacto
              ? { top: 0, right: 4, left: 0, bottom: 0 }
              : { top: 0, right: 110, left: 0, bottom: 0 }
          }
          barCategoryGap={compacto ? 3 : 8}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="rotulo"
            {...eixoProps}
            width={compacto ? 0 : 150}
            hide={compacto}
            tick={{ ...eixoProps.tick, fontSize: 12 }}
          />
          <Tooltip content={<Dica />} cursor={cursorSuave} />
          <Bar dataKey="cards" radius={RAIO_BARRA_HORIZONTAL} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell
                key={d.rotulo}
                fill={
                  d.gargalo
                    ? CORES_COCKPIT.alerta
                    : `color-mix(in oklab, ${CORES_COCKPIT.terceira} 55%, var(--card))`
                }
              />
            ))}
            {!compacto && (
              <LabelList
                dataKey="cards"
                content={({ x, y, width, height, index }) => {
                  const d = dados[index as number];
                  if (!d) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2 + 4}
                      fontSize={12}
                      fontWeight={d.gargalo ? 600 : 400}
                      fill={d.gargalo ? "var(--foreground)" : "var(--muted-foreground)"}
                    >
                      {d.gargalo ? `${d.cards} · gargalo` : d.cards}
                    </text>
                  );
                }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 7. Saúde das fontes ──────────────────────────────────────────────────────

export function GraficoFontes({
  paradas,
  compacto = false,
}: {
  paradas: FonteParada[];
  compacto?: boolean;
}) {
  const maximo = Math.max(3, ...paradas.map((p) => p.dias ?? 0));
  const dados = paradas.map((p) => ({
    rotulo: p.fonte.split(" · ")[0],
    dias: p.dias ?? maximo,
    semData: p.dias === null,
    dica: {
      titulo: p.fonte,
      linhas: [
        ["Dias sem carga", p.dias === null ? "sem data de carga" : String(p.dias)],
        ...(p.atualizadoEm
          ? ([["Última carga", p.atualizadoEm.slice(0, 10).split("-").reverse().join("/")]] as [
              string,
              string,
            ][])
          : []),
      ],
      periodo: "agora",
      universo: "fontes do cockpit",
    } satisfies DicaDado,
  }));
  return (
    <div
      style={{ height: compacto ? 72 : Math.max(96, dados.length * 30 + 12) }}
      role="img"
      aria-label="Dias desde a última carga das fontes paradas"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={dados}
          layout="vertical"
          margin={
            compacto
              ? { top: 0, right: 4, left: 0, bottom: 0 }
              : { top: 0, right: 64, left: 0, bottom: 0 }
          }
          barCategoryGap={6}
        >
          <XAxis type="number" hide domain={[0, maximo]} />
          <YAxis
            type="category"
            dataKey="rotulo"
            {...eixoProps}
            width={compacto ? 0 : 120}
            hide={compacto}
            tick={{ ...eixoProps.tick, fontSize: 12 }}
          />
          <Tooltip content={<Dica />} cursor={cursorSuave} />
          <Bar dataKey="dias" radius={RAIO_BARRA_HORIZONTAL} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell
                key={d.rotulo}
                fill={d.semData ? `url(#${HACHURA_ID})` : CORES_COCKPIT.alerta}
                stroke={d.semData ? "var(--muted-foreground)" : undefined}
              />
            ))}
            {!compacto && (
              <LabelList
                dataKey="dias"
                content={({ x, y, width, height, index }) => {
                  const d = dados[index as number];
                  if (!d) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2 + 4}
                      fontSize={12}
                      fill="var(--foreground)"
                    >
                      {d.semData ? "sem data" : `${d.dias} ${d.dias === 1 ? "dia" : "dias"}`}
                    </text>
                  );
                }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
