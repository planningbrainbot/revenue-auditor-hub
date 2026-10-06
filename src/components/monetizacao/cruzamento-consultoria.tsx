import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  KpiCard,
  PageHeader,
  StatusBadge,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarCruzamentoConsultoria } from "@/lib/monetizacao/cruzamento-consultoria.functions";
import {
  ETAPAS_COORTE,
  FALA_MAQUINA,
  GRUPOS,
  REGIMES,
  STATUS,
  montarCruzamento,
  type Cartao,
  type Cliente,
  type Cruzamento,
  type CruzamentoBruto,
  type EtapaCoorte,
  type Formato,
  type Negocio,
  type Projeto,
  type Proposta,
  type Regime,
  type Registros,
  type Status,
} from "@/lib/monetizacao/cruzamento-consultoria";
import {
  CORES_SERIE,
  COR_NEUTRA,
  eixoProps,
  gradeProps,
  RAIO_BARRA,
  tooltipProps,
} from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import type { BuscaMonetizacao } from "./busca";

// Cruzamento Consultoria (contrato docs/design/contratos/monetizacao-cruzamento-consultoria.md).
// Visão geral: cada número dito na call de 05/10 vira um cartão "dito × medido"; a conta, a fonte e os
// registros moram na gaveta (`?grafico=`). A conta inteira é de src/lib/monetizacao/cruzamento-consultoria.ts.

// A tela é "Consultoria"; esta é a visão "Cruzamento com a call" (as abas vêm de consultoria.tsx).
const TITULO = "Consultoria";
const PERGUNTA =
  "Os números que a Consultoria e o CEO deram em 05/10 batem com o que o Brain mede hoje?";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
const INT = new Intl.NumberFormat("pt-BR");
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brl = (v: number | null) => (v === null ? "—" : BRL.format(Math.round(v)));
const umaCasa = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
function valor(formato: Formato, v: number | null) {
  if (v === null) return "—";
  if (formato === "pct") return `${umaCasa(v * 100)}%`;
  if (formato === "brl") {
    const a = Math.abs(v);
    if (a >= 1e6) return `R$ ${umaCasa(v / 1e6)} mi`;
    if (a >= 1e3) return `R$ ${umaCasa(v / 1e3)} mil`;
    return BRL.format(Math.round(v));
  }
  return INT.format(Math.round(v));
}
const diferenca = (d: number | null) =>
  d === null
    ? "sem medida"
    : d === 0
      ? "igual"
      : `${d > 0 ? "+" : "−"}${Math.round(Math.abs(d) * 100)}%`;
const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "sem registro";
const TOM: Record<Status, "sucesso" | "info" | "perigo" | "neutro"> = {
  bate: "sucesso",
  perto: "info",
  diverge: "perigo",
  "outra-conta": "neutro",
};
const ROTULO_STATUS: Record<Status, string> = {
  bate: "bate",
  perto: "perto",
  diverge: "diverge",
  "outra-conta": "outra conta",
};
const ETAPA: Record<string, string> = {
  fila_processamento: "Fila de Processamento",
  fluxo_documentos: "Fluxo de Documentos",
  operacao: "Operação",
  qualidade: "Qualidade",
  saida_entrega: "Saída / Entrega",
  pos_entrega: "Pós-entrega",
};
/** Colunas da grade de cartões no desktop: 4 cartões em 4 colunas, sem cartão órfão na linha de baixo. */
const COLUNAS: Record<number, string> = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4" };
const REGIME_CURTO: Record<Regime, string> = {
  real: "Real",
  presumido: "Presumido",
  simples: "Simples",
  sem: "—",
};

export function CruzamentoConsultoria({
  busca,
  mudarBusca,
  abas,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  /** As abas da tela Consultoria, logo abaixo do cabeçalho. */
  abas?: ReactNode;
}) {
  const { user } = useAuth();
  const ler = useServerFn(carregarCruzamentoConsultoria);
  const q = useQuery({
    queryKey: ["cruzamento-consultoria", user?.id],
    queryFn: () => ler(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {abas}
        {!erro ? (
          <Carregando variante="kpis" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao com todas as unidades" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: plataforma da Consultoria, contratos e PAT. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return (
    <PainelCruzamentoConsultoria bruto={q.data} busca={busca} mudarBusca={mudarBusca} abas={abas} />
  );
}

/** A tela a partir do payload do RPC: separada da leitura para a conferência visual com dado real. */
export function PainelCruzamentoConsultoria({
  bruto,
  busca,
  mudarBusca,
  hoje = hojeSP(),
  abas,
}: {
  bruto: CruzamentoBruto;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  hoje?: string;
  abas?: ReactNode;
}) {
  const p = montarCruzamento(bruto, hoje, { regime: busca.regime });
  const abrir = (id: string) => mudarBusca({ grafico: id });
  const fila = p.janela.entraram.length - p.janela.sairam.length;
  const total = p.cartoes.length;
  const procedencia = {
    fonte: "API da plataforma da Consultoria · contratos ganhos (Pipedrive) · PAT no Financeiro",
    atualizadoEm: p.frescor.consultoria ?? p.lidoEm,
    regua: "dito na call de 05/10 × medido agora",
  };
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={`${total} números ditos pelo Pedro Siqueira e pelo CEO · ${INT.format(p.clientes.length)} clientes e ${INT.format(p.projetos.length)} projetos na plataforma · ${INT.format(p.negocios.filter((n) => n.maquina).length)} negócios da máquina em 2026`}
        procedencia={procedencia}
        acoes={
          <StatusBadge tom="info" icone={false}>
            Call de 05/10/2026
          </StatusBadge>
        }
      />
      {abas}

      <section aria-label="Placar da call" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STATUS.map((s) => (
          <KpiCard
            key={s.id}
            rotulo={s.rotulo}
            valor={INT.format(p.contagem[s.id])}
            nota={`de ${total} · ${s.regra}`}
            tom={s.id === "bate" ? "sucesso" : s.id === "diverge" ? "perigo" : undefined}
            abrir={{ onClick: () => abrir(`status-${s.id}`), rotulo: "Ver números" }}
          />
        ))}
        <KpiCard
          rotulo="Fila em 4 semanas"
          valor={`${fila > 0 ? "+" : ""}${INT.format(fila)}`}
          nota={`${INT.format(p.janela.entraram.length)} entraram · ${INT.format(p.janela.sairam.length)} saíram`}
          tom={fila > 0 ? "perigo" : "sucesso"}
          tomRotulo={fila > 0 ? "crescendo" : "andando"}
          abrir={{ onClick: () => abrir("fila"), rotulo: "Ver projetos" }}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <Atencao p={p} abrir={abrir} />

      {GRUPOS.map((g) => {
        const cartoes = p.cartoes.filter((c) => c.grupo === g.id);
        return (
          <section key={g.id} aria-labelledby={`cc-${g.id}`} className="min-w-0 space-y-3">
            <div>
              <h2 id={`cc-${g.id}`} className="text-lg font-semibold">
                {g.titulo}
              </h2>
              <p className="text-[13px] text-muted-foreground">{g.pergunta}</p>
            </div>
            {g.id === "maquina" ? (
              <>
                <div className="grid min-w-0 gap-3 xl:grid-cols-3">
                  {cartoes.map((c) => (
                    <CartaoDito key={c.id} c={c} abrir={abrir} />
                  ))}
                  <div className="min-w-0 xl:col-span-2">
                    <GraficoMaquina p={p} abrir={abrir} />
                  </div>
                </div>
                <Coorte p={p} abrir={abrir} regime={busca.regime} mudarBusca={mudarBusca} />
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "grid min-w-0 gap-3 md:grid-cols-2",
                    COLUNAS[cartoes.length] ?? "xl:grid-cols-3",
                  )}
                >
                  {cartoes.map((c) => (
                    <CartaoDito key={c.id} c={c} abrir={abrir} />
                  ))}
                </div>
                {g.id === "vazao" && <GraficoVazao p={p} abrir={abrir} />}
              </>
            )}
          </section>
        );
      })}

      <Gaveta
        id={busca.grafico ?? null}
        p={p}
        abrir={abrir}
        fechar={() => mudarBusca({ grafico: undefined })}
      />
    </main>
  );
}

// ─── Cartão dito × medido ────────────────────────────────────────────────────────────────────────

function CartaoDito({ c, abrir }: { c: Cartao; abrir: (id: string) => void }) {
  const max = Math.max(Math.abs(c.dito), Math.abs(c.medido ?? 0), 1e-9);
  return (
    <button
      type="button"
      onClick={() => abrir(`dito-${c.id}`)}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:border-primary-text/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{c.tema}</h3>
        <StatusBadge tom={TOM[c.status]} className="shrink-0">
          {ROTULO_STATUS[c.status]}
        </StatusBadge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Dito na call</p>
          <p className="num text-xl font-semibold text-muted-foreground">
            {valor(c.formato, c.dito)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Medido agora</p>
          <p className="num text-2xl font-semibold">{valor(c.formato, c.medido)}</p>
        </div>
      </div>
      <div className="space-y-1" aria-hidden>
        <span className="block h-1.5 rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-muted-foreground/40"
            style={{ width: `${(Math.abs(c.dito) / max) * 100}%` }}
          />
        </span>
        <span className="block h-1.5 rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-[var(--chart-1)]"
            style={{ width: `${(Math.abs(c.medido ?? 0) / max) * 100}%` }}
          />
        </span>
      </div>
      <blockquote className="line-clamp-2 border-l-2 pl-3 text-[13px] italic text-muted-foreground">
        “{c.fala}”
      </blockquote>
      <p className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {c.quem} · {c.quando}
        </span>
        <span className="num font-semibold text-foreground">{diferenca(c.diferenca)}</span>
      </p>
    </button>
  );
}

// ─── O que pede atenção ──────────────────────────────────────────────────────────────────────────

function Atencao({ p, abrir }: { p: Cruzamento; abrir: (id: string) => void }) {
  const fila = p.janela.entraram.length - p.janela.sairam.length;
  const itens: {
    id: string;
    tom: "perigo" | "atencao" | "info";
    texto: ReactNode;
    acao: string;
  }[] = [];
  if (p.contagem.diverge)
    itens.push({
      id: "status-diverge",
      tom: "perigo",
      texto: (
        <>
          <b className="font-semibold">{INT.format(p.contagem.diverge)} números divergem</b>{" "}
          <span className="text-muted-foreground">do que foi dito na call</span>
        </>
      ),
      acao: "Ver quais",
    });
  if (fila > 0)
    itens.push({
      id: "fila",
      tom: "atencao",
      texto: (
        <>
          <b className="font-semibold">A fila cresceu {INT.format(fila)} projetos</b>{" "}
          <span className="text-muted-foreground">em 4 semanas: entra mais do que sai</span>
        </>
      ),
      acao: "Ver projetos",
    });
  if (p.maquinaSemCnpj.length)
    itens.push({
      id: "sem-cnpj",
      tom: "info",
      texto: (
        <>
          <b className="font-semibold">
            {INT.format(p.maquinaSemCnpj.length)} negócios da máquina sem CNPJ
          </b>{" "}
          <span className="text-muted-foreground">não dá para saber se chegaram</span>
        </>
      ),
      acao: "Ver lista",
    });
  if (!itens.length) return null;
  return (
    <section aria-labelledby="cc-atencao" className="rounded-xl border bg-card">
      <h2 id="cc-atencao" className="border-b px-4 py-3 text-base font-semibold">
        O que pede atenção
      </h2>
      <ul>
        {itens.slice(0, 3).map((i) => (
          <li key={i.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
            <StatusBadge tom={i.tom} className="shrink-0">
              {i.tom === "perigo" ? "cobrar" : i.tom === "atencao" ? "vazão" : "cadastro"}
            </StatusBadge>
            <span className="min-w-0 flex-1 text-sm">{i.texto}</span>
            <Button size="sm" variant="outline" onClick={() => abrir(i.id)}>
              {i.acao} →
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Gráficos ────────────────────────────────────────────────────────────────────────────────────

const Chave = ({ cor, texto, tracejado }: { cor: string; texto: string; tracejado?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      aria-hidden
      className={cn(
        "inline-block",
        tracejado ? "h-0 w-3 border-t-2 border-dashed" : "size-2.5 rounded-sm",
      )}
      style={tracejado ? { borderColor: cor } : { background: cor }}
    />
    {texto}
  </span>
);
// Recharts entrega no clique o ponto com `payload`; o tipo dele varia por versão.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chaveDoClique = (d: any, campo: string): string | undefined =>
  d?.payload?.[campo] ?? d?.[campo];
const rotuloTopo =
  (negrito = false) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (props: any) => {
    const v = Number(props.value);
    if (!v) return null;
    return (
      <text
        x={Number(props.x) + Number(props.width) / 2}
        y={Number(props.y) - 6}
        textAnchor="middle"
        className={cn("fill-foreground text-xs", negrito && "font-semibold")}
      >
        {INT.format(v)}
      </text>
    );
  };

function Bloco({
  titulo,
  legenda,
  children,
  rodape,
}: {
  titulo: string;
  legenda: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{titulo}</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legenda}
        </div>
      </div>
      <div className="mt-3 h-64">{children}</div>
      {rodape && <p className="mt-2 text-[13px] text-muted-foreground">{rodape}</p>}
    </section>
  );
}

function GraficoVazao({ p, abrir }: { p: Cruzamento; abrir: (id: string) => void }) {
  const dados = p.semanas.map((s) => ({
    semana: s.semana,
    rotulo: `${ddmm(s.semana)}${s.parcial ? "*" : ""}`,
    entraram: s.entraram.length,
    sairam: s.sairam.length,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clique = (d: any) => {
    const s = chaveDoClique(d, "semana");
    if (s) abrir(`semana-${s}`);
  };
  return (
    <Bloco
      titulo="Entram × saem por semana"
      legenda={
        <>
          <Chave cor={CORES_SERIE[0]} texto="Entraram (cadastro)" />
          <Chave cor={CORES_SERIE[1]} texto="Saíram (entrega)" />
          <Chave cor={COR_NEUTRA} texto="Dito na call: 16 e 6" tracejado />
        </>
      }
      rodape="Semana de segunda a domingo; * = semana em curso. Clique na semana para ver os projetos."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 18, right: 8, left: -12, bottom: 0 }} barGap={2}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="rotulo" {...eixoProps} />
          <YAxis allowDecimals={false} {...eixoProps} />
          <Tooltip
            {...tooltipProps}
            formatter={(v: number, nome: string) => [INT.format(v), nome]}
          />
          <ReferenceLine y={16} stroke={COR_NEUTRA} strokeDasharray="4 4" />
          <ReferenceLine y={6} stroke={COR_NEUTRA} strokeDasharray="4 4" />
          <Bar
            dataKey="entraram"
            name="Entraram"
            fill={CORES_SERIE[0]}
            radius={RAIO_BARRA}
            maxBarSize={20}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList dataKey="entraram" content={rotuloTopo(true)} />
          </Bar>
          <Bar
            dataKey="sairam"
            name="Saíram"
            fill={CORES_SERIE[1]}
            radius={RAIO_BARRA}
            maxBarSize={20}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList dataKey="sairam" content={rotuloTopo()} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Bloco>
  );
}

function GraficoMaquina({ p, abrir }: { p: Cruzamento; abrir: (id: string) => void }) {
  const dados = p.maquinaPorMes.map((m) => ({
    mes: m.mes,
    rotulo: rotuloMes(m.mes),
    ganhos: m.ganhos.length,
    dito: m.dito,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clique = (d: any) => {
    const m = chaveDoClique(d, "mes");
    if (m) abrir(`maquina-${m}`);
  };
  return (
    <Bloco
      titulo="Máquina de vendas por mês"
      legenda={
        <>
          <Chave cor={CORES_SERIE[0]} texto="Ganhos no Inside Sales" />
          <Chave cor={CORES_SERIE[2]} texto="Dito pelo CEO" />
        </>
      }
      rodape={`CEO, 00:10:45: “${FALA_MAQUINA}”. Clique no mês para ver os negócios.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={{ top: 18, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="rotulo" {...eixoProps} />
          <YAxis allowDecimals={false} {...eixoProps} />
          <Tooltip
            {...tooltipProps}
            formatter={(v: number, nome: string) => [v === null ? "—" : INT.format(v), nome]}
          />
          <Bar
            dataKey="ganhos"
            name="Ganhos no Inside Sales"
            fill={CORES_SERIE[0]}
            radius={RAIO_BARRA}
            maxBarSize={28}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList dataKey="ganhos" content={rotuloTopo(true)} />
          </Bar>
          <Line
            dataKey="dito"
            name="Dito pelo CEO"
            stroke={CORES_SERIE[2]}
            strokeWidth={0}
            dot={{ r: 5, fill: CORES_SERIE[2], stroke: CORES_SERIE[2] }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Bloco>
  );
}

// ─── Teste do CEO: a coorte de cada mês ──────────────────────────────────────────────────────────

function Coorte({
  p,
  abrir,
  regime,
  mudarBusca,
}: {
  p: Cruzamento;
  abrir: (id: string) => void;
  regime: Regime | undefined;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const semPorta = !p.porta.aberta;
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">O que a máquina vendeu chegou à Consultoria?</h3>
        <button
          type="button"
          onClick={() => abrir("coorte")}
          className="rounded-sm text-[13px] text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Como se conta
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Regime tributário">
        {[{ id: undefined, rotulo: "Todos" }, ...REGIMES].map((r) => (
          <Button
            key={r.rotulo}
            size="sm"
            variant={regime === r.id ? "default" : "outline"}
            aria-pressed={regime === r.id}
            onClick={() => mudarBusca({ regime: r.id })}
          >
            {r.rotulo}
          </Button>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês do ganho</TableHead>
              {ETAPAS_COORTE.map((e) => (
                <TableHead key={e.id} className="text-right">
                  {e.rotulo}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.coorte.map((l) => (
              <TableRow key={l.mes}>
                <TableCell className="font-medium">{rotuloMes(l.mes)}</TableCell>
                {ETAPAS_COORTE.map((e, i) => {
                  const lista = l.etapas[e.id];
                  const acima = i ? l.etapas[ETAPAS_COORTE[i - 1].id] : null;
                  if (lista === null)
                    return (
                      <TableCell key={e.id} className="text-right text-xs text-muted-foreground">
                        {semPorta ? "sem acesso" : "—"}
                      </TableCell>
                    );
                  return (
                    <TableCell key={e.id} className="text-right">
                      <button
                        type="button"
                        onClick={() => abrir(`coorte-${l.mes}-${e.id}`)}
                        className="num rounded-sm font-semibold text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {INT.format(lista.length)}
                      </button>
                      {acima && acima.length > 0 && (
                        <span className="num block text-xs text-muted-foreground">
                          {Math.round((lista.length / acima.length) * 100)}%
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Cada coluna é parte da anterior; a % é a coluna ÷ a anterior. O ganho leva ~1 mês até o
        kickoff: o mês corrente e o anterior ainda não chegaram.
      </p>
    </section>
  );
}

// ─── Gaveta: a conta, a fonte e os registros de cada número ──────────────────────────────────────

function TabelaProjetos({ itens }: { itens: Projeto[] }) {
  if (!itens.length)
    return <p className="text-sm text-muted-foreground">Nenhum projeto neste recorte.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Cliente</TableHead>
            <TableHead className="text-xs">Etapa</TableHead>
            <TableHead className="text-xs">Cadastro</TableHead>
            <TableHead className="text-xs">Entrega</TableHead>
            <TableHead className="text-right text-xs">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((x) => (
            <TableRow key={x.chave}>
              <TableCell className="text-xs">
                {x.cliente.nome}
                <span className="block text-muted-foreground">
                  {REGIME_CURTO[x.cliente.regime]} · {x.produto ?? "sem produto"}
                </span>
              </TableCell>
              <TableCell className="text-xs">
                {ETAPA[x.etapa ?? ""] ?? x.etapaDescricao ?? "—"}
              </TableCell>
              <TableCell className="text-xs">{ddmm(x.cadastrado)}</TableCell>
              <TableCell className="text-xs">{ddmm(x.entregue)}</TableCell>
              <TableCell className="num text-right text-xs">
                {x.valor ? brl(x.valor) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TabelaClientes({ itens }: { itens: Cliente[] }) {
  if (!itens.length)
    return <p className="text-sm text-muted-foreground">Nenhum cliente neste recorte.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Cliente</TableHead>
            <TableHead className="text-xs">Regime</TableHead>
            <TableHead className="text-right text-xs">Projetos</TableHead>
            <TableHead className="text-right text-xs">Valor identificado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="text-xs">
                {c.nome}
                <span className="block text-muted-foreground">
                  {c.cnpj ?? "sem CNPJ"}
                  {c.parceiro ? ` · ${c.parceiro}` : ""}
                </span>
              </TableCell>
              <TableCell className="text-xs">{REGIME_CURTO[c.regime]}</TableCell>
              <TableCell className="num text-right text-xs">
                {INT.format(c.projetos.length)}
              </TableCell>
              <TableCell className="num text-right text-xs">{brl(c.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TabelaPropostas({ itens }: { itens: Proposta[] }) {
  if (!itens.length)
    return <p className="text-sm text-muted-foreground">Nenhuma proposta neste recorte.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Empresa</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-right text-xs">Êxito</TableHead>
            <TableHead className="text-right text-xs">Valor</TableHead>
            <TableHead className="text-xs">Envio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((x) => (
            <TableRow key={x.id}>
              <TableCell className="text-xs">
                {x.empresa}
                <span className="block text-muted-foreground">{x.produto ?? "sem produto"}</span>
              </TableCell>
              <TableCell className="text-xs">{x.status ?? "—"}</TableCell>
              <TableCell className="num text-right text-xs">
                {x.exito === null ? "—" : `${umaCasa(x.exito)}%`}
              </TableCell>
              <TableCell className="num text-right text-xs">{brl(x.valorTotal)}</TableCell>
              <TableCell className="text-xs">{ddmm(x.envio)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function situacao(n: Negocio) {
  if (!n.cnpj)
    return (
      <StatusBadge tom="atencao" icone={false}>
        sem CNPJ
      </StatusBadge>
    );
  if (n.faturou)
    return (
      <StatusBadge tom="sucesso" icone={false}>
        faturou na PAT
      </StatusBadge>
    );
  if (n.trabalhado)
    return (
      <StatusBadge tom="info" icone={false}>
        trabalhado
      </StatusBadge>
    );
  if (n.naPlataforma)
    return (
      <StatusBadge tom="neutro" icone={false}>
        na plataforma
      </StatusBadge>
    );
  return (
    <StatusBadge tom="neutro" icone={false}>
      fora da plataforma
    </StatusBadge>
  );
}

function TabelaNegocios({ itens }: { itens: Negocio[] }) {
  if (!itens.length)
    return <p className="text-sm text-muted-foreground">Nenhum negócio neste recorte.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Negócio</TableHead>
            <TableHead className="text-xs">Ganho</TableHead>
            <TableHead className="text-xs">Regime</TableHead>
            <TableHead className="text-xs">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((n) => (
            <TableRow key={n.deal}>
              <TableCell className="text-xs">
                <a
                  href={`https://grupoplanning.pipedrive.com/deal/${n.deal}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-text hover:underline"
                >
                  {n.titulo}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="block text-muted-foreground">
                  {n.unidade ?? "sem unidade"} · {n.cnpj ?? "sem CNPJ"}
                  {n.cliente ? ` · na plataforma como ${n.cliente.nome}` : ""}
                  {n.onboarding ? " · com card de onboarding" : ""}
                </span>
              </TableCell>
              <TableCell className="text-xs">{ddmm(n.ganho)}</TableCell>
              <TableCell className="text-xs">{REGIME_CURTO[n.regime]}</TableCell>
              <TableCell className="text-xs">{situacao(n)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ListaRegistros({ r }: { r: Registros }) {
  if (r.tipo === "projetos") return <TabelaProjetos itens={r.itens} />;
  if (r.tipo === "clientes") return <TabelaClientes itens={r.itens} />;
  if (r.tipo === "propostas") return <TabelaPropostas itens={r.itens} />;
  return <TabelaNegocios itens={r.itens} />;
}

type ConteudoGaveta = {
  titulo: string;
  valor?: string;
  partes: { titulo: string; corpo: ReactNode }[];
  registros?: { titulo: string; r: Registros }[];
};

function conteudo(id: string, p: Cruzamento, abrir: (id: string) => void): ConteudoGaveta | null {
  if (id.startsWith("dito-")) {
    const c = p.cartoes.find((x) => `dito-${x.id}` === id);
    if (!c) return null;
    return {
      titulo: c.tema,
      valor: `${valor(c.formato, c.medido)} medido · ${valor(c.formato, c.dito)} dito`,
      partes: [
        {
          titulo: "O que foi dito",
          corpo: (
            <>
              <blockquote className="border-l-2 pl-3 italic">“{c.fala}”</blockquote>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {c.quem} · call de 05/10/2026, {c.quando}
              </p>
            </>
          ),
        },
        {
          titulo: "Medido agora",
          corpo: (
            <span className="inline-flex items-center gap-2">
              <StatusBadge tom={TOM[c.status]}>{ROTULO_STATUS[c.status]}</StatusBadge>
              <span className="num">{diferenca(c.diferenca)} contra o dito</span>
            </span>
          ),
        },
        { titulo: "Como o Brain mede", corpo: c.como },
        ...(c.porque ? [{ titulo: "Por que pode diferir", corpo: c.porque }] : []),
      ],
      registros: [{ titulo: "Os registros", r: c.registros }],
    };
  }
  if (id.startsWith("status-")) {
    const s = STATUS.find((x) => `status-${x.id}` === id);
    if (!s) return null;
    const cs = p.cartoes.filter((c) => c.status === s.id);
    return {
      titulo: s.rotulo,
      valor: `${INT.format(cs.length)} de ${INT.format(p.cartoes.length)}`,
      partes: [
        { titulo: "Regra", corpo: `Comparação entre o número dito e o medido: ${s.regra}.` },
        {
          titulo: "Os números",
          corpo: cs.length ? (
            <ul className="space-y-1.5">
              {cs.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => abrir(`dito-${c.id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left outline-none hover:border-primary-text/40 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-sm">{c.tema}</span>
                    <span className="num text-xs text-muted-foreground">
                      {valor(c.formato, c.dito)} →{" "}
                      <b className="text-foreground">{valor(c.formato, c.medido)}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            "Nenhum número nesta situação."
          ),
        },
      ],
    };
  }
  if (id === "fila")
    return {
      titulo: "Fila em 4 semanas",
      valor: `${INT.format(p.janela.entraram.length)} entraram · ${INT.format(p.janela.sairam.length)} saíram`,
      partes: [
        {
          titulo: "Como se conta",
          corpo: `Projetos cadastrados na plataforma de ${ddmm(p.janela.de)} a ${ddmm(p.janela.ate)} contra projetos com data de entrega no mesmo período. Na call: “A gente está recebendo 16 e saindo 6 por semana.”`,
        },
      ],
      registros: [
        { titulo: "Entraram", r: { tipo: "projetos", itens: p.janela.entraram } },
        { titulo: "Saíram", r: { tipo: "projetos", itens: p.janela.sairam } },
      ],
    };
  if (id.startsWith("semana-")) {
    const s = p.semanas.find((x) => `semana-${x.semana}` === id);
    if (!s) return null;
    return {
      titulo: `Semana de ${ddmm(s.semana)}${s.parcial ? " (em curso)" : ""}`,
      valor: `${INT.format(s.entraram.length)} entraram · ${INT.format(s.sairam.length)} saíram`,
      partes: [
        {
          titulo: "Como se conta",
          corpo: "Cadastro e entrega dos projetos na plataforma, de segunda a domingo.",
        },
      ],
      registros: [
        { titulo: "Entraram", r: { tipo: "projetos", itens: s.entraram } },
        { titulo: "Saíram", r: { tipo: "projetos", itens: s.sairam } },
      ],
    };
  }
  if (id.startsWith("maquina-")) {
    const m = p.maquinaPorMes.find((x) => `maquina-${x.mes}` === id);
    if (!m) return null;
    return {
      titulo: `Máquina de vendas · ${rotuloMes(m.mes)}`,
      valor: `${INT.format(m.ganhos.length)} ganhos${m.dito !== null ? ` · ${INT.format(m.dito)} ditos` : ""}`,
      partes: [
        {
          titulo: "Como se conta",
          corpo:
            "Negócios ganhos no pipeline Inside Sales do Pipedrive no mês (ops.contratos). O pipe Sócios fica fora: “Tudo o que for carteira de BPO, que não seja o sócio ou parceiro é máquina de venda” (CEO, 00:02:35).",
        },
      ],
      registros: [{ titulo: "Os negócios", r: { tipo: "negocios", itens: m.ganhos } }],
    };
  }
  if (id === "coorte")
    return {
      titulo: "O que a máquina vendeu chegou à Consultoria?",
      partes: [
        {
          titulo: "O pedido",
          corpo:
            "CEO, 00:08:28: “eu queria pegar por teste ali, pegar no mês passado, os clientes que fecharam é e ver se isso está sendo feito, essa passagem de bastão está sendo feita.”",
        },
        {
          titulo: "Como se conta",
          corpo:
            "Ganhos = negócios do Inside Sales no mês. Com CNPJ = o CNPJ veio do contrato, do documento do Pipefy, da empresa, do onboarding ou do Pipedrive. Na plataforma = o CNPJ (ou a raiz) está cadastrado na plataforma da Consultoria. Trabalhados = algum projeto do cliente passou de Fila de Processamento e Fluxo de Documentos, ou foi entregue. Faturou = a PAT faturou ou recebeu do CNPJ do mês do ganho em diante. Cada coluna é parte da anterior.",
        },
      ],
    };
  if (id.startsWith("coorte-")) {
    const [, a, mm, ...resto] = id.split("-");
    const mes = `${a}-${mm}`;
    const etapa = resto.join("-") as EtapaCoorte;
    const l = p.coorte.find((x) => x.mes === mes);
    const lista = l?.etapas[etapa];
    const rot = ETAPAS_COORTE.find((e) => e.id === etapa)?.rotulo;
    if (!l || !lista || !rot) return null;
    return {
      titulo: `${rot} · ${rotuloMes(mes)}`,
      valor: INT.format(lista.length),
      partes: [
        { titulo: "Recorte", corpo: "Negócios da máquina ganhos no mês, nesta etapa ou além." },
      ],
      registros: [{ titulo: "Os negócios", r: { tipo: "negocios", itens: lista } }],
    };
  }
  if (id === "sem-cnpj")
    return {
      titulo: "Negócios da máquina sem CNPJ",
      valor: INT.format(p.maquinaSemCnpj.length),
      partes: [
        {
          titulo: "Por que importa",
          corpo:
            "Sem CNPJ o negócio não casa com a plataforma nem com a PAT. O CNPJ é lido no contrato, no documento do Pipefy, na empresa, no onboarding e, por fim, no negócio e na organização do Pipedrive (a cada 30 minutos).",
        },
      ],
      registros: [{ titulo: "Os negócios", r: { tipo: "negocios", itens: p.maquinaSemCnpj } }],
    };
  return null;
}

function Gaveta({
  id,
  p,
  abrir,
  fechar,
}: {
  id: string | null;
  p: Cruzamento;
  abrir: (id: string) => void;
  fechar: () => void;
}) {
  const c = id ? conteudo(id, p, abrir) : null;
  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? fechar() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {c && (
          <>
            <SheetHeader>
              <SheetTitle>{c.titulo}</SheetTitle>
              <SheetDescription>
                Plataforma da Consultoria (API) · contratos ganhos · PAT no Financeiro · lido em{" "}
                {quando(p.lidoEm)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              {c.valor && <p className="num text-2xl font-semibold">{c.valor}</p>}
              {c.partes.map((x) => (
                <Parte key={x.titulo} titulo={x.titulo}>
                  {x.corpo}
                </Parte>
              ))}
              <Parte titulo="Fonte e frescor">
                Plataforma {quando(p.frescor.consultoria)} · negócios e PAT{" "}
                {quando(p.frescor.negocios)} · Financeiro{" "}
                {quando(p.frescor.financeiro_carregado_em)}
              </Parte>
              {c.registros?.map((r) => (
                <Parte key={r.titulo} titulo={`${r.titulo} (${INT.format(r.r.itens.length)})`}>
                  <ListaRegistros r={r.r} />
                </Parte>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Parte({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}
