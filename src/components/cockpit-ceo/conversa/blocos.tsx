import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, TriangleAlert } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard, Procedencia, StatusBadge } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { partesDoLink } from "@/lib/areas";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { UnidadeContagem } from "@/lib/cockpit-ceo/contrato";
import type { BlocoResolvido } from "@/lib/cockpit-ceo/conversa/spec";
import type { Resultado } from "@/lib/cockpit-ceo/conversa/resultado";
import {
  COR_NEGATIVO,
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  linhaZeroProps,
  tooltipProps,
} from "@/lib/planning/grafico";

// Renderizador da UI generativa: recebe um bloco validado (tipo do catálogo + resultado de uma
// consulta autorizada) e monta componentes do design system. Nada aqui interpreta texto do modelo
// como código ou marcação; o único texto do modelo que aparece é o título opcional do bloco, como
// texto puro. Todo número sai de `bloco.resultado`.

const mesCurto = (x: string) =>
  /^\d{4}-\d{2}$/.test(x) ? `${x.slice(5, 7)}/${x.slice(2, 4)}` : x;

export function curto(v: number | null, unidade: UnidadeContagem): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unidade === "reais") {
    const a = Math.abs(v);
    const s = v < 0 ? "−" : "";
    if (a >= 1e9) return `${s}R$ ${(a / 1e9).toFixed(2).replace(".", ",")} bi`;
    if (a >= 1e6) return `${s}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} mi`;
    if (a >= 1e4) return `${s}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
    return formatarNumero(v, unidade);
  }
  return formatarNumero(v, unidade);
}

const temNumero = (r: Resultado) => r.estado === "disponivel" || r.estado === "parcial";

function SemNumero({ r }: { r: Resultado }) {
  const motivo = r.avisos[0] ?? "A consulta não trouxe número.";
  const rotulo =
    r.estado === "acesso_insuficiente"
      ? "Sem acesso"
      : r.estado === "fonte_indisponivel"
        ? "Fonte indisponível"
        : "Não apurado";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3">
      <StatusBadge tom={r.estado === "acesso_insuficiente" ? "neutro" : "atencao"}>
        {rotulo}
      </StatusBadge>
      <p className="text-sm text-muted-foreground">{motivo}</p>
    </div>
  );
}

function Destino({ r }: { r: Resultado }) {
  if (!r.destino) return null;
  const { to, search } = partesDoLink(
    r.destino.rota + (Object.keys(r.destino.search).length ? "?" + new URLSearchParams(r.destino.search) : ""),
  );
  return (
    <Link
      to={to as never}
      search={search as never}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {r.destino.rotulo}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

/** Moldura de um bloco: pergunta/título, conteúdo, avisos curtos e procedência. */
export function MolduraBloco({
  bloco,
  children,
}: {
  bloco: BlocoResolvido;
  children: ReactNode;
}) {
  const r = bloco.resultado;
  const avisos = temNumero(r) ? r.avisos.slice(0, 2) : [];
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{bloco.titulo ?? r.titulo}</h3>
        {r.estado === "parcial" && <StatusBadge tom="atencao">Dado parcial</StatusBadge>}
      </header>
      {r.filtrosAplicados.length > 0 && (
        <p className="text-[13px] text-muted-foreground">{r.filtrosAplicados.filter(Boolean).join(" · ")}</p>
      )}
      <div className="min-w-0">{temNumero(r) ? children : <SemNumero r={r} />}</div>
      {avisos.length > 0 && (
        <ul className="space-y-1">
          {avisos.map((a) => (
            <li key={a} className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Procedencia fonte={r.fonte} atualizadoEm={r.atualizadoEm} className="min-w-0" />
        <Destino r={r} />
      </footer>
    </section>
  );
}

function BlocoKpi({ r }: { r: Resultado }) {
  const d = r.dados;
  if (d.forma !== "kpi") return null;
  const c = d.comparacoes[0];
  const delta = r.destaques.find((x) => x.unidade === "percentual" && x.rotulo.startsWith("Variação"));
  return (
    <KpiCard
      rotulo={r.titulo}
      valor={curto(d.valor, r.unidade)}
      nota={c ? `${c.rotulo}: ${curto(c.valor, c.unidade ?? r.unidade)}` : undefined}
      delta={delta?.valor != null ? { valor: delta.valor, rotulo: c?.rotulo ? `vs ${c.rotulo.toLowerCase()}` : undefined } : undefined}
      estado={r.estado === "parcial" ? "parcial" : "ok"}
      className="border-0 p-0"
    />
  );
}

function BlocoSerie({ r }: { r: Resultado }) {
  const d = r.dados;
  if (d.forma !== "serie") return null;
  const dados = d.pontos.map((p) => ({ x: mesCurto(p.x), ...p.valores }));
  const realizados = d.series.filter((s) => s.tipo !== "meta").slice(0, 3);
  const metas = d.series.filter((s) => s.tipo === "meta");
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="x" {...eixoProps} />
          <YAxis {...eixoProps} width={84} tickFormatter={(v: number) => curto(v, r.unidade)} />
          <Tooltip {...tooltipProps} formatter={(v) => curto(v === null ? null : Number(v), r.unidade)} />
          {d.series.length > 1 && <Legend {...legendaProps} />}
          {realizados.map((s, i) => (
            <Line
              key={s.chave}
              type="monotone"
              dataKey={s.chave}
              name={s.rotulo}
              stroke={CORES_SERIE[i]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {metas.map((s) => (
            <Line
              key={s.chave}
              type="monotone"
              dataKey={s.chave}
              name={s.rotulo}
              {...linhaMetaProps}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BlocoBarras({ r, ranking }: { r: Resultado; ranking?: boolean }) {
  const d = r.dados;
  if (d.forma === "serie") {
    const dados = d.pontos.map((p) => ({ x: mesCurto(p.x), ...p.valores }));
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="x" {...eixoProps} />
            <YAxis {...eixoProps} width={84} tickFormatter={(v: number) => curto(v, r.unidade)} />
            <Tooltip {...tooltipProps} formatter={(v) => curto(Number(v), r.unidade)} />
            {d.series.length > 1 && <Legend {...legendaProps} />}
            {d.series.slice(0, 3).map((s, i) => (
              <Bar key={s.chave} dataKey={s.chave} name={s.rotulo} fill={CORES_SERIE[i]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  const itens =
    d.forma === "categorias"
      ? d.itens
      : d.forma === "funil"
        ? d.etapas.map((e) => ({ rotulo: e.rotulo, valor: e.valor, detalhe: undefined }))
        : [];
  const maximo = Math.max(1, ...itens.map((i) => Math.abs(i.valor ?? 0)));
  const total = d.forma === "categorias" ? d.total : null;
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {itens.map((i, n) => (
          <li key={`${i.rotulo}-${n}`} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-sm" title={i.rotulo}>
              {ranking && <span className="num mr-1.5 text-muted-foreground">{n + 1}.</span>}
              {i.rotulo}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(Math.abs(i.valor ?? 0) / maximo) * 100}%`,
                  background: (i.valor ?? 0) < 0 ? COR_NEGATIVO : CORES_SERIE[0],
                }}
              />
            </span>
            <span className="num text-right text-sm font-medium">
              {curto(i.valor, r.unidade)}
              {i.detalhe && <span className="block text-xs font-normal text-muted-foreground">{i.detalhe}</span>}
            </span>
          </li>
        ))}
      </ol>
      {total !== null && d.forma === "categorias" && d.somaFecha && (
        <p className="flex justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="num font-semibold">{curto(total, r.unidade)}</span>
        </p>
      )}
    </div>
  );
}

function BlocoFunil({ r }: { r: Resultado }) {
  const d = r.dados;
  const etapas =
    d.forma === "funil" ? d.etapas : d.forma === "categorias" ? d.itens.map((i) => ({ rotulo: i.rotulo, valor: i.valor })) : [];
  const primeiro = etapas[0]?.valor ?? null;
  return (
    <ol className="space-y-2">
      {etapas.map((e, i) => {
        const pct = primeiro && e.valor !== null ? (e.valor / primeiro) * 100 : null;
        return (
          <li key={e.rotulo} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
            <span className="text-sm">{e.rotulo}</span>
            <span className="h-5 overflow-hidden rounded bg-muted" aria-hidden>
              <span
                className="block h-full rounded"
                style={{
                  width: `${pct === null ? 0 : Math.max(2, Math.min(100, pct))}%`,
                  background: `color-mix(in oklab, ${CORES_SERIE[0]} ${100 - i * 15}%, var(--card))`,
                }}
              />
            </span>
            <span className="num text-right text-sm font-medium">
              {e.valor === null ? "—" : formatarNumero(e.valor, r.unidade)}
              {pct !== null && i > 0 && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{pct.toFixed(0)}%</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function BlocoPonte({ r }: { r: Resultado }) {
  const d = r.dados;
  if (d.forma !== "ponte") return null;
  const dados = d.passos.map((p) => ({ rotulo: p.rotulo, valor: p.valor, clientes: p.clientes }));
  const variacao = d.fim.valor - d.inicio.valor;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{d.inicio.rotulo}</dt>
          <dd className="num font-semibold">{curto(d.inicio.valor, "reais")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Variação</dt>
          <dd className={`num font-semibold ${variacao < 0 ? "text-danger" : "text-success"}`}>
            {variacao >= 0 ? "+" : ""}
            {curto(variacao, "reais")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{d.fim.rotulo}</dt>
          <dd className="num font-semibold">{curto(d.fim.valor, "reais")}</dd>
        </div>
      </dl>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" {...eixoProps} tickFormatter={(v: number) => curto(v, "reais")} />
            <YAxis type="category" dataKey="rotulo" width={150} {...eixoProps} />
            <ReferenceLine x={0} {...linhaZeroProps} />
            <Tooltip
              {...tooltipProps}
              formatter={(v, _n, p) => [
                `${curto(Number(v), "reais")}${p?.payload?.clientes != null ? ` · ${p.payload.clientes} clientes` : ""}`,
                "Movimento",
              ]}
            />
            <Bar dataKey="valor" name="Movimento" isAnimationActive={false}>
              {dados.map((x) => (
                <Cell key={x.rotulo} fill={x.valor < 0 ? COR_NEGATIVO : CORES_SERIE[0]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Tabela genérica: desenha qualquer forma com os valores exatos. */
function BlocoTabela({ r }: { r: Resultado }) {
  const d = r.dados;
  let colunas: { chave: string; rotulo: string; num?: boolean }[] = [];
  let linhas: Record<string, string | number | null>[] = [];
  const f = (v: unknown) => (typeof v === "number" ? formatarNumero(v, r.unidade) : v == null ? "—" : String(v));
  switch (d.forma) {
    case "tabela":
      colunas = d.colunas.map((c) => ({ chave: c.chave, rotulo: c.rotulo }));
      linhas = d.linhas;
      break;
    case "serie":
      colunas = [{ chave: "x", rotulo: "Mês" }, ...d.series.map((s) => ({ chave: s.chave, rotulo: s.rotulo, num: true }))];
      linhas = d.pontos.map((p) => ({ x: mesCurto(p.x), ...p.valores }));
      break;
    case "categorias":
      colunas = [{ chave: "rotulo", rotulo: "Item" }, { chave: "valor", rotulo: "Valor", num: true }];
      linhas = d.itens.map((i) => ({ rotulo: i.rotulo, valor: i.valor }));
      break;
    case "funil":
      colunas = [{ chave: "rotulo", rotulo: "Etapa" }, { chave: "valor", rotulo: "Quantidade", num: true }];
      linhas = d.etapas.map((e) => ({ rotulo: e.rotulo, valor: e.valor }));
      break;
    case "kpi":
      colunas = [{ chave: "rotulo", rotulo: "Parcela" }, { chave: "valor", rotulo: "Valor", num: true }];
      linhas = [{ rotulo: r.titulo, valor: d.valor }, ...d.comparacoes.map((c) => ({ rotulo: c.rotulo, valor: c.valor })), ...d.composicao.map((c) => ({ rotulo: c.rotulo, valor: c.valor }))];
      break;
    case "ponte":
      colunas = [{ chave: "rotulo", rotulo: "Parcela" }, { chave: "valor", rotulo: "Valor", num: true }];
      linhas = [d.inicio, ...d.passos, d.fim].map((p) => ({ rotulo: p.rotulo, valor: p.valor }));
      break;
    default:
      return null;
  }
  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {colunas.map((c) => (
              <TableHead key={c.chave} className={c.num ? "text-right" : undefined}>
                {c.rotulo}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l, i) => (
            <TableRow key={i}>
              {colunas.map((c) => (
                <TableCell key={c.chave} className={c.num || typeof l[c.chave] === "number" ? "num text-right" : undefined}>
                  {f(l[c.chave])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BlocoCoorte({ r }: { r: Resultado }) {
  const d = r.dados;
  if (d.forma !== "coorte") return null;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Ganho em</th>
            <th className="px-2 py-1 text-right font-semibold text-muted-foreground">Contratos</th>
            {d.colunas.map((c) => (
              <th key={c} className="px-1 py-1 text-right font-semibold text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.linhas.map((l) => (
            <tr key={l.coorte}>
              <td className="num px-2 py-1">{mesCurto(l.coorte)}</td>
              <td className="num px-2 py-1 text-right">{l.base}</td>
              {d.colunas.map((c, i) => {
                const v = l.valores[i];
                return (
                  <td
                    key={c}
                    className="num rounded px-1 py-1 text-right"
                    style={
                      v == null
                        ? undefined
                        : { background: `color-mix(in oklab, ${CORES_SERIE[0]} ${Math.round(v * 0.45)}%, var(--card))` }
                    }
                  >
                    {v == null ? "" : `${v.toFixed(0)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocoAcoes({ r }: { r: Resultado }) {
  const d = r.dados;
  if (d.forma !== "acoes") return null;
  return (
    <ul className="divide-y rounded-lg border">
      {d.itens.map((a) => (
        <li key={a.titulo} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
          <StatusBadge tom={a.gravidade === "alta" ? "perigo" : a.gravidade === "media" ? "atencao" : "info"}>
            {a.gravidade === "alta" ? "Alta" : a.gravidade === "media" ? "Média" : "Decisão"}
          </StatusBadge>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{a.titulo}</p>
            <p className="text-[13px] text-muted-foreground">
              {a.detalhe} <span className="text-foreground">Responsável: {a.responsavel}.</span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Bloco({ bloco }: { bloco: BlocoResolvido }) {
  const r = bloco.resultado;
  const conteudo = (() => {
    switch (bloco.tipo) {
      case "kpi":
        return <BlocoKpi r={r} />;
      case "serie":
        return <BlocoSerie r={r} />;
      case "barras":
        return <BlocoBarras r={r} />;
      case "ranking":
        return <BlocoBarras r={r} ranking />;
      case "funil":
        return <BlocoFunil r={r} />;
      case "ponte":
        return <BlocoPonte r={r} />;
      case "tabela":
        return <BlocoTabela r={r} />;
      case "coorte":
        return <BlocoCoorte r={r} />;
      case "acoes":
        return <BlocoAcoes r={r} />;
    }
  })();
  return <MolduraBloco bloco={bloco}>{conteudo}</MolduraBloco>;
}
