import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNps } from "@/hooks/use-nps";
import type { NpsRow } from "@/lib/nps.functions";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import {
  BarraFiltros,
  Carregando,
  Degrau,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const ABAS = ["resumo", "unidades", "respostas"] as const;
const CHAVES_FILTRO = ["q", "unidade", "segmento", "categoria", "fase", "rodada"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const FONTE = "Pipefy: pesquisa NPS (nps_pesquisas)";

type Categoria = "promotor" | "neutro" | "detrator" | null;

function categorize(score: string | null): Categoria {
  if (score == null || score === "") return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
}

const CATEGORIA: Record<Exclude<Categoria, null>, { tom: TomStatus; rotulo: string; plural: string }> = {
  promotor: { tom: "sucesso", rotulo: "Promotor", plural: "Promotores" },
  neutro: { tom: "atencao", rotulo: "Neutro", plural: "Neutros" },
  detrator: { tom: "perigo", rotulo: "Detrator", plural: "Detratores" },
};

// Categoria é identidade de série, não status (DESIGN §5.3): cor de série
// fixa por categoria, sempre com o rótulo ao lado.
const COR_CATEGORIA: Record<Exclude<Categoria, null>, string> = {
  promotor: CORES_SERIE[0],
  neutro: CORES_SERIE[1],
  detrator: CORES_SERIE[2],
};

function npsBadge(cat: Categoria) {
  if (!cat) return <span className="text-muted-foreground">—</span>;
  const c = CATEGORIA[cat];
  return <StatusBadge tom={c.tom}>{c.rotulo}</StatusBadge>;
}

function classifyNps(score: number): { label: string; tom: TomStatus } {
  if (score >= 75) return { label: "Excelente", tom: "sucesso" };
  if (score >= 50) return { label: "Muito bom", tom: "sucesso" };
  if (score >= 0) return { label: "Razoável", tom: "atencao" };
  return { label: "Crítico", tom: "perigo" };
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  // Data pura ("aaaa-mm-dd") sai da própria string: `new Date` a leria em UTC
  // e, no fuso de Brasília, mostraria o dia anterior.
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
}

// Mês do eixo a partir da string "aaaa-mm", sem passar por Date.
function fmtMes(mesKey: string): string {
  const [ano, mes] = String(mesKey).split("-");
  const nome = MESES[Number(mes) - 1];
  return nome && ano ? `${nome}/${ano.slice(2)}` : String(mesKey);
}

// Chave de mês local do created_at (timestamptz): o mês de criação do card no
// fuso de quem olha.
function mesDoCard(created: string | null): string | null {
  const d = created ? new Date(created) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// CSAT consolida as 3 notas por serviço (fiscal/contábil/folha) num único
// score — convenção top-box: nota >= 8 (de 0-10) conta como "satisfeito".
function csatRatings(r: NpsRow): number[] {
  // Number(null) === 0 em JS — sem o filtro de nulo/vazio ANTES da
  // conversão, todo campo não respondido virava uma "nota 0" (bug real:
  // inflava o total de notas e derrubava o CSAT artificialmente).
  return [r.avaliacao_fiscal, r.avaliacao_contabil, r.avaliacao_folha_pagamento]
    .filter((v): v is string => v != null && v !== "" && v !== "Sem Resposta")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
}

// fill com hsl() em volta de var(--x) saía preto (as variáveis são hex). var(--x)
// puro resolve e troca junto com o tema; o CSAT tem token próprio em styles.css.
const NPS_FILL = CORES_SERIE[0];
const CSAT_FILL = "var(--chart-csat)";

// Amostra pequena no mês corrente torna o delta ruído, não sinal — suprime
// a variação (mostra só "amostra pequena") abaixo de AMOSTRA_MINIMA.
const AMOSTRA_MINIMA = 10;

// Mostra o valor da barra sempre, e a variação % vs. a barra anterior
// quando existir — mesmo padrão do benchmark (valor + tag de variação).
function renderDeltaLabel(serie: Array<{ [k: string]: string | number }>, key: string, suffix = "") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (props: any) => {
    const { x, y, width, index } = props as { x?: number; y?: number; width?: number; index?: number };
    if (index == null || x == null || y == null || width == null) return null;
    const atual = Number(serie[index]?.[key]);
    if (!Number.isFinite(atual)) return null;
    const anterior = index > 0 ? Number(serie[index - 1]?.[key]) : null;
    const temDelta = anterior != null && Number.isFinite(anterior) && anterior !== 0;
    const delta = temDelta ? Math.round(((atual - (anterior as number)) / Math.abs(anterior as number)) * 100) : 0;
    const positivo = delta >= 0;
    return (
      <g>
        {temDelta && (
          <text
            x={x + width / 2}
            y={y - 20}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill={positivo ? "var(--success)" : "var(--danger)"}
          >
            {positivo ? "▲" : "▼"} {positivo ? "+" : ""}{delta}%
          </text>
        )}
        <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-foreground">
          {atual}{suffix}
        </text>
      </g>
    );
  };
}

type DeltaMes = { delta: number; amostraPequena: boolean; mesAtual: string; mesAnterior: string; amostra: number };

// Entre os dois últimos meses com dado; a nota do card diz quais são.
function deltaVsMesAnterior(
  serie: { mes: string }[],
  key: "nps" | "csat",
  amostraKey: "respondentes" | "notas",
): DeltaMes | null {
  if (serie.length < 2) return null;
  const atualRow = serie[serie.length - 1] as unknown as Record<string, number>;
  const anteriorRow = serie[serie.length - 2] as unknown as Record<string, number>;
  const amostraAtual = atualRow[amostraKey] ?? 0;
  return {
    delta: Math.round((atualRow[key] - anteriorRow[key]) * 10) / 10,
    amostraPequena: amostraAtual < AMOSTRA_MINIMA,
    mesAtual: serie[serie.length - 1].mes,
    mesAnterior: serie[serie.length - 2].mes,
    amostra: amostraAtual,
  };
}

/** Variação em pontos (NPS) ou pontos percentuais (CSAT), com os dois meses. */
function NotaDelta({ d, unidade, apoio }: { d: DeltaMes | null; unidade: "pts" | "pp"; apoio: string }) {
  if (!d) return <>{apoio} · sem mês anterior para comparar</>;
  const meses = `${fmtMes(d.mesAtual)} vs. ${fmtMes(d.mesAnterior)}`;
  if (d.amostraPequena) {
    return (
      <>
        {apoio} · variação suprimida: {fmtMes(d.mesAtual)} tem {d.amostra} (mínimo {AMOSTRA_MINIMA})
      </>
    );
  }
  const sentido = d.delta > 0 ? "sobe" : d.delta < 0 ? "desce" : "estavel";
  const cor = d.delta > 0 ? "text-success" : d.delta < 0 ? "text-danger" : "text-muted-foreground";
  const numero = `${d.delta > 0 ? "+" : d.delta < 0 ? "−" : ""}${String(Math.abs(d.delta)).replace(".", ",")} ${unidade}`;
  return (
    <>
      <span className={cn("num inline-flex items-center gap-1 font-semibold", cor)}>
        <Degrau sentido={sentido} />
        {numero}
      </span>{" "}
      {meses} · {apoio}
    </>
  );
}

const AVISO_CATEGORIA = "O filtro de categoria altera o indicador; remova para ver o NPS.";

/** No lugar de um gráfico de NPS/CSAT quando o filtro de categoria o distorce. */
function AvisoCategoria() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
      {AVISO_CATEGORIA}
    </div>
  );
}

function Alternar<T extends string>({
  valor,
  opcoes,
  aoMudar,
}: {
  valor: T;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5 text-xs" role="group">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => aoMudar(o.valor)}
          className={cn(
            "rounded-full px-3 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            valor === o.valor ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

function Legenda({ itens }: { itens: { rotulo: string; cor: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((i) => (
        <li key={i.rotulo} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: i.cor }} />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}

function Filtro({
  valor,
  aoMudar,
  todos,
  opcoes,
  rotulo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  todos: string;
  opcoes: { valor: string; rotulo: string }[];
  rotulo: string;
}) {
  // Valor da URL que não existe mais nas opções continua visível (e removível).
  const lista = valor !== ALL && !opcoes.some((o) => o.valor === valor) ? [...opcoes, { valor, rotulo: valor }] : opcoes;
  return (
    <Select value={valor} onValueChange={(v) => aoMudar(v)}>
      <SelectTrigger className="h-8 w-auto min-w-[150px]" aria-label={rotulo}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{todos}</SelectItem>
        {lista.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function linkCard(id: string | number | null): ReactNode {
  if (!id) return "—";
  return (
    <a
      href={`https://app.pipefy.com/open-cards/${id}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      ver card
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export function NpsPainelTab() {
  const { data, isLoading, error, refetch } = useNps();
  const perms = usePermissions();
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    // Mesmo padrão de tratativas-tab.tsx: só restringe por unidade quando o
    // usuário é escopado a uma unidade própria (sócio regional). Papéis
    // sem esse escopo (admin/diretor/auditor/CS) veem tudo, inclusive linhas
    // sem unidade reconhecida — necessário pra campanha de WhatsApp, cujos
    // cards nascem sem unidade (só descoberta depois, se descoberta).
    // Antes disso usava isUnidadeDaRede, que descartava silenciosamente
    // qualquer linha sem unidade pra TODO MUNDO, inclusive admin.
    if (!perms.scopedToOwnUnit || !perms.unidade) return all;
    return all.filter((r) => unitMatches(perms.unidade, r.unidade ?? r.empresa_unidade));
  }, [data, perms.scopedToOwnUnit, perms.unidade]);

  // Aba e filtros na URL (N7): recarregar ou colar o link reproduz o recorte.
  const [aba, setAba] = useFiltroNaUrl("aba", "resumo");
  const [q, setQ] = useFiltroNaUrl("q", "");
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", ALL);
  const [segmento, setSegmento] = useFiltroNaUrl("segmento", ALL);
  const [categoria, setCategoria] = useFiltroNaUrl("categoria", ALL);
  const [fase, setFase] = useFiltroNaUrl("fase", ALL);
  const [rodada, setRodada] = useFiltroNaUrl("rodada", ALL);
  const limparFiltros = useLimparFiltrosNaUrl(CHAVES_FILTRO);
  const [npsView, setNpsView] = useState<"geral" | "segmento">("geral");
  const [csatView, setCsatView] = useState<"geral" | "segmento">("geral");
  const abaAtual = (ABAS as readonly string[]).includes(aba) ? aba : "resumo";

  // Filtrar por categoria muda o próprio indicador (só promotores → NPS 100):
  // com ele ativo, NPS e CSAT não são apurados; as listas continuam filtradas.
  const categoriaAtiva = categoria !== ALL;

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const segmentos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.segmento).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const fases = useMemo(
    () => Array.from(new Set(rows.map((r) => r.fase).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const rodadas = useMemo(
    () => Array.from(new Set(rows.map((r) => r.rodada).filter(Boolean) as string[])).sort().reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (segmento !== ALL && r.segmento !== segmento) return false;
      if (fase !== ALL && r.fase !== fase) return false;
      if (rodada !== ALL && r.rodada !== rodada) return false;
      if (categoria !== ALL) {
        const cat = categorize(r.nps_recomendacao);
        if (cat !== categoria) return false;
      }
      if (qn) {
        const hay = `${r.empresa ?? ""} ${r.nome_contato ?? ""} ${r.email_pesquisa ?? ""}`.toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    });
  }, [rows, q, unidade, segmento, fase, rodada, categoria]);

  const respondidas = useMemo(
    () => filtered.filter((r) => categorize(r.nps_recomendacao) !== null),
    [filtered],
  );

  const kpis = useMemo(() => {
    const total = filtered.length;
    const resp = respondidas.length;
    const promotores = respondidas.filter((r) => categorize(r.nps_recomendacao) === "promotor").length;
    const neutros = respondidas.filter((r) => categorize(r.nps_recomendacao) === "neutro").length;
    const detratores = respondidas.filter((r) => categorize(r.nps_recomendacao) === "detrator").length;
    const nps = resp > 0 ? Math.round(((promotores - detratores) / resp) * 100) : null;
    return { total, resp, promotores, neutros, detratores, nps };
  }, [filtered, respondidas]);

  const csat = useMemo(() => {
    const ratings = filtered.flatMap(csatRatings);
    const satisfeitos = ratings.filter((n) => n >= 8).length;
    const score = ratings.length > 0 ? Math.round((satisfeitos / ratings.length) * 1000) / 10 : null;
    return { score, totalNotas: ratings.length };
  }, [filtered]);

  const evolucaoCsatMensal = useMemo(() => {
    const map = new Map<string, { satisfeitos: number; total: number }>();
    for (const r of filtered) {
      const key = mesDoCard(r.created_at);
      if (!key) continue;
      const ratings = csatRatings(r);
      if (ratings.length === 0) continue;
      const cur = map.get(key) ?? { satisfeitos: 0, total: 0 };
      cur.satisfeitos += ratings.filter((n) => n >= 8).length;
      cur.total += ratings.length;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        csat: Math.round((v.satisfeitos / v.total) * 1000) / 10,
        notas: v.total,
      }));
  }, [filtered]);

  const distribuicaoCategoria = useMemo(
    () =>
      (["promotor", "neutro", "detrator"] as const).map((c) => ({
        name: CATEGORIA[c].plural,
        value: c === "promotor" ? kpis.promotores : c === "neutro" ? kpis.neutros : kpis.detratores,
        fill: COR_CATEGORIA[c],
      })),
    [kpis],
  );

  const distribuicaoNota = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i <= 10; i++) map.set(i, 0);
    for (const r of respondidas) {
      const n = Number(r.nps_recomendacao);
      if (Number.isFinite(n) && n >= 0 && n <= 10) {
        map.set(n, (map.get(n) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([nota, qtd]) => ({
      nota: String(nota),
      qtd,
      fill: COR_CATEGORIA[nota >= 9 ? "promotor" : nota >= 7 ? "neutro" : "detrator"],
    }));
  }, [respondidas]);

  const npsPorUnidade = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      // "Matriz" nesse pipe é resquício de um lote antigo de cards (pré-projeto
      // de WhatsApp) sem vínculo de empresa confiável — não representa uma
      // unidade real de cliente, então fica fora desse recorte por unidade
      // (mas continua contando no NPS/CSAT geral).
      if (r.unidade === "Matriz") continue;
      const u = r.unidade ?? "—";
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(u) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => ({
        unidade,
        nps: Math.round(((v.promotor - v.detrator) / v.total) * 100),
        respondentes: v.total,
      }))
      .sort((a, b) => b.nps - a.nps);
  }, [respondidas]);

  const npsPorSegmento = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      const s = r.segmento ?? "—";
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(s) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(s, cur);
    }
    return Array.from(map.entries())
      .map(([segmento, v]) => ({
        segmento,
        nps: Math.round(((v.promotor - v.detrator) / v.total) * 100),
        respondentes: v.total,
      }))
      .sort((a, b) => b.nps - a.nps);
  }, [respondidas]);

  const csatPorSegmento = useMemo(() => {
    const map = new Map<string, { satisfeitos: number; total: number }>();
    for (const r of filtered) {
      const s = r.segmento ?? "—";
      const ratings = csatRatings(r);
      if (ratings.length === 0) continue;
      const cur = map.get(s) ?? { satisfeitos: 0, total: 0 };
      cur.satisfeitos += ratings.filter((n) => n >= 8).length;
      cur.total += ratings.length;
      map.set(s, cur);
    }
    return Array.from(map.entries())
      .map(([segmento, v]) => ({
        segmento,
        csat: Math.round((v.satisfeitos / v.total) * 1000) / 10,
        notas: v.total,
      }))
      .sort((a, b) => b.csat - a.csat);
  }, [filtered]);

  const evolucaoMensal = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      const key = mesDoCard(r.created_at);
      if (!key) continue;
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(key) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        nps: Math.round(((v.promotor - v.detrator) / v.total) * 100),
        respondentes: v.total,
      }));
  }, [respondidas]);

  // Ordena pela nota (a menor primeiro), não pela data: o rótulo diz isso.
  const detratoresList = useMemo(
    () =>
      respondidas
        .filter((r) => categorize(r.nps_recomendacao) === "detrator")
        .sort((a, b) => Number(a.nps_recomendacao) - Number(b.nps_recomendacao))
        .slice(0, 10),
    [respondidas],
  );

  const ultimaAtualizacao = useMemo(() => {
    let max: string | null = null;
    for (const r of rows) {
      const t = r.updated_at ?? r.created_at;
      if (t && (!max || t > max)) max = t;
    }
    return max;
  }, [rows]);

  const hasFilters = !!q || unidade !== ALL || segmento !== ALL || fase !== ALL || categoria !== ALL || rodada !== ALL;

  const recorteUnidade =
    unidade !== ALL
      ? unidade
      : perms.scopedToOwnUnit && perms.unidade
        ? perms.unidade
        : "todas as unidades";
  const recorteRodada = rodada !== ALL ? `rodada ${rodada}` : "todas as rodadas";

  const npsDelta = deltaVsMesAnterior(evolucaoMensal, "nps", "respondentes");
  const csatDelta = deltaVsMesAnterior(evolucaoCsatMensal, "csat", "notas");

  const tickMes = (v: string) => fmtMes(v);
  const rotuloMes = (v: unknown) => fmtMes(String(v));

  let conteudo: ReactNode;
  if (isLoading) {
    conteudo = (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        <Carregando variante="grafico" />
      </div>
    );
  } else if (error) {
    conteudo = (
      <EstadoErro
        detalhe={`Fonte: nps_pesquisas (Pipefy): ${error instanceof Error ? error.message : String(error)}`}
        tentarNovamente={() => void refetch()}
      />
    );
  } else if (rows.length === 0) {
    conteudo = (
      <EstadoVazio
        titulo="Nenhuma pesquisa NPS registrada"
        descricao={
          perms.scopedToOwnUnit && perms.unidade
            ? `Ainda não há pesquisa para ${perms.unidade}. O disparo fica em Disparos de WhatsApp.`
            : "O disparo fica em Disparos de WhatsApp."
        }
      />
    );
  } else {
    conteudo = (
      <Tabs value={abaAtual} onValueChange={(v) => setAba(v)} className="w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="unidades">Por unidade</TabsTrigger>
          <TabsTrigger value="respostas">Respostas</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-6">
          <KpiGrade colunas={3}>
            <KpiCard
              rotulo="NPS"
              valor={kpis.nps}
              estado={categoriaAtiva || kpis.nps == null ? "nao-apurado" : "ok"}
              nota={
                categoriaAtiva ? (
                  AVISO_CATEGORIA
                ) : kpis.nps == null ? (
                  "nenhuma resposta no recorte"
                ) : (
                  <NotaDelta d={npsDelta} unidade="pts" apoio="escala −100 a 100" />
                )
              }
            />
            <KpiCard
              rotulo="CSAT"
              valor={csat.score != null ? String(csat.score).replace(".", ",") : null}
              unidade="%"
              estado={categoriaAtiva || csat.score == null ? "nao-apurado" : "ok"}
              nota={
                categoriaAtiva ? (
                  AVISO_CATEGORIA
                ) : csat.score == null ? (
                  "nenhuma nota de serviço no recorte"
                ) : (
                  <NotaDelta
                    d={csatDelta}
                    unidade="pp"
                    apoio={`${csat.totalNotas} notas ≥ 8 de 0–10 (fiscal + contábil + folha)`}
                  />
                )
              }
            />
            <KpiCard
              rotulo="Respostas"
              valor={kpis.resp}
              nota={`pesquisas respondidas de ${kpis.total} no recorte`}
            />
          </KpiGrade>

          <div className="grid gap-4 md:grid-cols-2">
            <Secao
              titulo="Como o NPS evoluiu?"
              descricao={npsView === "geral" ? "por mês de criação do card · escala −100 a 100" : "por segmento · escala −100 a 100"}
              acoes={
                <Alternar
                  valor={npsView}
                  aoMudar={setNpsView}
                  opcoes={[
                    { valor: "geral", rotulo: "Por mês" },
                    { valor: "segmento", rotulo: "Por segmento" },
                  ]}
                />
              }
            >
              <Card className="p-4">
                {categoriaAtiva ? (
                  <AvisoCategoria />
                ) : (npsView === "geral" ? evolucaoMensal : npsPorSegmento).length === 0 ? (
                  <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                    Sem respostas registradas no filtro atual.
                  </div>
                ) : npsView === "geral" ? (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={evolucaoMensal} margin={{ top: 34 }}>
                        <CartesianGrid {...gradeProps} />
                        <XAxis {...eixoProps} dataKey="mes" tickFormatter={tickMes} />
                        <YAxis {...eixoProps} domain={[-100, 100]} width={36} />
                        <Tooltip {...tooltipProps} labelFormatter={rotuloMes} formatter={(v: number) => [v, "NPS"]} />
                        <Bar dataKey="nps" name="NPS" fill={NPS_FILL} radius={[2, 2, 0, 0]} maxBarSize={44}>
                          <LabelList content={renderDeltaLabel(evolucaoMensal, "nps")} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={npsPorSegmento} layout="vertical" margin={{ left: 70 }}>
                        <CartesianGrid {...gradeProps} />
                        <XAxis {...eixoProps} type="number" domain={[-100, 100]} />
                        <YAxis {...eixoProps} type="category" dataKey="segmento" width={70} />
                        <Tooltip {...tooltipProps} formatter={(v: number) => [v, "NPS"]} />
                        <Bar dataKey="nps" name="NPS" fill={NPS_FILL} radius={[0, 2, 2, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </Secao>

            <Secao
              titulo="Como o CSAT evoluiu?"
              descricao={
                csatView === "geral"
                  ? "por mês de criação do card · % de notas ≥ 8"
                  : "por segmento · % de notas ≥ 8"
              }
              acoes={
                <Alternar
                  valor={csatView}
                  aoMudar={setCsatView}
                  opcoes={[
                    { valor: "geral", rotulo: "Por mês" },
                    { valor: "segmento", rotulo: "Por segmento" },
                  ]}
                />
              }
            >
              <Card className="p-4">
                {categoriaAtiva ? (
                  <AvisoCategoria />
                ) : (csatView === "geral" ? evolucaoCsatMensal : csatPorSegmento).length === 0 ? (
                  <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                    Sem notas de serviço registradas no filtro atual.
                  </div>
                ) : csatView === "geral" ? (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={evolucaoCsatMensal} margin={{ top: 34 }}>
                        <CartesianGrid {...gradeProps} />
                        <XAxis {...eixoProps} dataKey="mes" tickFormatter={tickMes} />
                        <YAxis {...eixoProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                        <Tooltip {...tooltipProps} labelFormatter={rotuloMes} formatter={(v: number) => [`${v}%`, "CSAT"]} />
                        <Bar dataKey="csat" name="CSAT" fill={CSAT_FILL} radius={[2, 2, 0, 0]} maxBarSize={44}>
                          <LabelList content={renderDeltaLabel(evolucaoCsatMensal, "csat", "%")} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={csatPorSegmento} layout="vertical" margin={{ left: 70 }}>
                        <CartesianGrid {...gradeProps} />
                        <XAxis {...eixoProps} type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <YAxis {...eixoProps} type="category" dataKey="segmento" width={70} />
                        <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, "CSAT"]} />
                        <Bar dataKey="csat" name="CSAT" fill={CSAT_FILL} radius={[0, 2, 2, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </Secao>
          </div>

          <Secao
            titulo="Detratores com a menor nota"
            descricao="os 10 de nota mais baixa no recorte · abra o card no Pipefy para tratar"
          >
            <Card className="p-4">
              {detratoresList.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum detrator no filtro atual.</div>
              ) : (
                <ul className="divide-y">
                  {detratoresList.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.empresa ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.unidade ?? "—"} · {r.nome_contato ?? "—"} · {r.email_pesquisa ?? "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusBadge tom="perigo">Nota {r.nps_recomendacao}</StatusBadge>
                        {linkCard(r.pipefy_card_id)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Secao>

          <div className="grid gap-4 lg:grid-cols-2">
            <Secao
              titulo="Como as respostas se dividem?"
              descricao="respostas por categoria · promotor 9–10, neutro 7–8, detrator 0–6"
            >
              <Card className="p-4">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distribuicaoCategoria}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={(e: { name?: string; value?: number }) => `${e.name}: ${e.value}`}
                      >
                        {distribuicaoCategoria.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipProps} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <Legenda itens={distribuicaoCategoria.map((d) => ({ rotulo: d.name, cor: d.fill }))} />
              </Card>
            </Secao>

            <Secao titulo="Quais notas os clientes deram?" descricao="respostas por nota de 0 a 10">
              <Card className="p-4">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distribuicaoNota}>
                      <CartesianGrid {...gradeProps} />
                      <XAxis {...eixoProps} dataKey="nota" />
                      <YAxis {...eixoProps} allowDecimals={false} />
                      <Tooltip {...tooltipProps} />
                      <Bar dataKey="qtd" name="Respostas">
                        {distribuicaoNota.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Legenda
                  itens={(["detrator", "neutro", "promotor"] as const).map((c) => ({
                    rotulo: `${CATEGORIA[c].plural} (${c === "detrator" ? "0–6" : c === "neutro" ? "7–8" : "9–10"})`,
                    cor: COR_CATEGORIA[c],
                  }))}
                />
              </Card>
            </Secao>
          </div>
        </TabsContent>

        <TabsContent value="unidades" className="space-y-6">
          {categoriaAtiva ? (
            <EstadoVazio titulo="NPS por unidade não apurado" descricao={AVISO_CATEGORIA} />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Secao titulo="Qual unidade tem o NPS mais alto?" descricao="sem a Matriz · escala −100 a 100">
                  <Card className="p-4">
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={npsPorUnidade} layout="vertical" margin={{ left: 60 }}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis {...eixoProps} type="number" domain={[-100, 100]} />
                          <YAxis {...eixoProps} type="category" dataKey="unidade" width={110} />
                          <Tooltip {...tooltipProps} />
                          <Bar dataKey="nps" name="NPS" fill={NPS_FILL} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Secao>

                <Secao titulo="Qual segmento tem o NPS mais alto?" descricao="todas as unidades do recorte · escala −100 a 100">
                  <Card className="p-4">
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={npsPorSegmento} layout="vertical" margin={{ left: 60 }}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis {...eixoProps} type="number" domain={[-100, 100]} />
                          <YAxis {...eixoProps} type="category" dataKey="segmento" width={110} />
                          <Tooltip {...tooltipProps} />
                          <Bar dataKey="nps" name="NPS" fill={NPS_FILL} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Secao>
              </div>

              <Secao titulo="Detalhe por unidade" descricao="sem a Matriz · respondentes e NPS de cada unidade">
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unidade</TableHead>
                        <TableHead className="text-right">Respondentes</TableHead>
                        <TableHead className="text-right">NPS</TableHead>
                        <TableHead>Classificação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {npsPorUnidade.map((u) => {
                        const c = classifyNps(u.nps);
                        return (
                          <TableRow key={u.unidade}>
                            <TableCell className="font-medium">{u.unidade}</TableCell>
                            <TableCell className="num text-right">{u.respondentes}</TableCell>
                            <TableCell className="num text-right font-semibold">{u.nps}</TableCell>
                            <TableCell>
                              <StatusBadge tom={c.tom}>{c.label}</StatusBadge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {npsPorUnidade.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                            Sem respostas no filtro atual.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </Secao>
            </>
          )}
        </TabsContent>

        <TabsContent value="respostas">
          {filtered.length === 0 ? (
            <EstadoVazio titulo="Nenhuma pesquisa encontrada" total={rows.length} />
          ) : (
            <Card>
              <div className="flex items-center justify-between border-b p-3">
                <div className="text-sm font-medium">Pesquisas</div>
                <div className="num text-xs text-muted-foreground">
                  {filtered.length} de {rows.length} pesquisa(s)
                </div>
              </div>
              <div className="relative max-h-[600px] overflow-auto">
                <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="bg-background">Empresa</TableHead>
                      <TableHead className="bg-background">CNPJ</TableHead>
                      <TableHead className="bg-background">Unidade</TableHead>
                      <TableHead className="bg-background">Segmento</TableHead>
                      <TableHead className="bg-background">Contato</TableHead>
                      <TableHead className="bg-background text-center">NPS</TableHead>
                      <TableHead className="bg-background">Categoria</TableHead>
                      <TableHead className="bg-background text-center">Fiscal</TableHead>
                      <TableHead className="bg-background text-center">Contábil</TableHead>
                      <TableHead className="bg-background text-center">Folha</TableHead>
                      <TableHead className="bg-background">Serviços</TableHead>
                      <TableHead className="bg-background">Fase</TableHead>
                      <TableHead className="bg-background">Enviada em</TableHead>
                      <TableHead className="bg-background">Data</TableHead>
                      <TableHead className="bg-background">Card</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r: NpsRow) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.empresa ?? "—"}</TableCell>
                        <TableCell className="num text-xs text-muted-foreground">{r.empresa_cnpj ?? "—"}</TableCell>
                        <TableCell>{r.unidade ?? "—"}</TableCell>
                        <TableCell>{r.segmento ?? "—"}</TableCell>
                        <TableCell>
                          <div className="text-sm">{r.nome_contato ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.email_pesquisa ?? ""}</div>
                        </TableCell>
                        <TableCell className="num text-center">{r.nps_recomendacao ?? "—"}</TableCell>
                        <TableCell>{npsBadge(categorize(r.nps_recomendacao))}</TableCell>
                        <TableCell className="num text-center">{r.avaliacao_fiscal ?? "—"}</TableCell>
                        <TableCell className="num text-center">{r.avaliacao_contabil ?? "—"}</TableCell>
                        <TableCell className="num text-center">{r.avaliacao_folha_pagamento ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.servicos_contratados?.join(", ") ?? "—"}</TableCell>
                        <TableCell>{r.fase ?? "—"}</TableCell>
                        <TableCell className="num">{fmtDate(r.data_envio)}</TableCell>
                        <TableCell className="num">{fmtDate(r.created_at)}</TableCell>
                        <TableCell>{linkCard(r.pipefy_card_id)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="NPS"
        pergunta="O cliente recomenda a Planning, e quem está insatisfeito agora?"
        descricao={`Pesquisas NPS respondidas · ${recorteUnidade} · ${recorteRodada} · nota 0–10, promotor 9–10, detrator 0–6`}
        procedencia={{
          fonte: FONTE,
          atualizadoEm: ultimaAtualizacao,
          regua: "NPS = % promotores − % detratores",
        }}
      >
        <BarraFiltros aoLimpar={hasFilters ? limparFiltros : undefined}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar empresa, contato ou e-mail"
              aria-label="Buscar empresa, contato ou e-mail"
              className="h-8 w-64 pl-8"
            />
          </div>
          <Filtro
            rotulo="Unidade"
            valor={unidade}
            aoMudar={setUnidade}
            todos="Todas as unidades"
            opcoes={unidades.map((u) => ({ valor: u, rotulo: u }))}
          />
          <Filtro
            rotulo="Segmento"
            valor={segmento}
            aoMudar={setSegmento}
            todos="Todos os segmentos"
            opcoes={segmentos.map((s) => ({ valor: s, rotulo: s }))}
          />
          <Filtro
            rotulo="Categoria"
            valor={categoria}
            aoMudar={setCategoria}
            todos="Todas as categorias"
            opcoes={(["promotor", "neutro", "detrator"] as const).map((c) => ({ valor: c, rotulo: CATEGORIA[c].plural }))}
          />
          <Filtro
            rotulo="Fase"
            valor={fase}
            aoMudar={setFase}
            todos="Todas as fases"
            opcoes={fases.map((f) => ({ valor: f, rotulo: f }))}
          />
          <Filtro
            rotulo="Rodada"
            valor={rodada}
            aoMudar={setRodada}
            todos="Todas as rodadas"
            opcoes={rodadas.map((rd) => ({ valor: rd, rotulo: rd }))}
          />
        </BarraFiltros>
      </PageHeader>

      {conteudo}
    </div>
  );
}
