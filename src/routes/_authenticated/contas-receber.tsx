import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Building2,
  TriangleAlert,
} from "lucide-react";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
import { useContasReceber } from "@/hooks/use-contas-receber";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { date, num } from "@/components/audit/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataProvider, BaseFilterSelect, RefreshButton } from "@/components/audit/data-context";
import { OmieLastSync } from "@/components/omie-last-sync";
import { SafraFatoFilter } from "@/components/safra-fato-filter";
import type { SafraFatoMode } from "@/hooks/use-safra-fato";
import { MensalidadesTab } from "@/components/audit/mensalidades-tab";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CORES_SERIE,
  COR_NEGATIVO,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import {
  Carregando,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import {
  brlOuTraco,
  eixoMoeda,
  ehMes,
  ErroDaConsulta,
  mesCorrente,
  MolduraReceita,
  rotuloDia,
  rotuloMesCurto,
  TooltipMoeda,
} from "@/components/receita/moldura";
import type { ContaReceber } from "@/lib/contas-receber.functions";

const ALL = "__all__";
const POR_PAGINA = 100;
const CHAVES = "view.contas_receber";

const texto = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/**
 * Tudo que define a tela mora na URL (N7) e é gravado de volta: antes a
 * página lia `unidade`/`status`/`dataIni`/`dataFim`/`dataTipo` uma vez e
 * seguia em `useState`, e recarregar perdia busca, aba e mês. As chaves
 * antigas continuam valendo (o Funil de Receita linka com elas). O filtro por
 * mês usa `mesFiltro`/`modo`, não `mes`/`modo`: o hook antigo gravava
 * `?mes=` mesmo com o filtro desligado, e um link velho ligaria o filtro.
 */
type Busca = {
  unidade?: string;
  status?: string;
  dataIni?: string;
  dataFim?: string;
  dataTipo?: string;
  q?: string;
  aba?: string;
  mesFiltro?: string;
  modo?: string;
};

export const Route = createFileRoute("/_authenticated/contas-receber")({
  validateSearch: (search: Record<string, unknown>): Busca => ({
    unidade: texto(search.unidade),
    status: texto(search.status),
    dataIni: texto(search.dataIni),
    dataFim: texto(search.dataFim),
    dataTipo: texto(search.dataTipo),
    q: texto(search.q),
    aba: texto(search.aba),
    mesFiltro: texto(search.mesFiltro),
    modo: texto(search.modo),
  }),
  head: () => ({
    meta: [
      { title: "Contas a Receber – Planning" },
      {
        name: "description",
        content: "Faturas das unidades no Omie: o que está em atraso e de quem cobrar.",
      },
    ],
  }),
  component: ContasReceberPage,
});

type DataTipo = "competencia" | "vencimento" | "pagamento";
type Aba = "resumo" | "faturas" | "mensalidades";

const DATA_TIPO_FIELD: Record<DataTipo, "data_competencia" | "data_vencimento" | "data_pagamento"> =
  {
    competencia: "data_competencia",
    vencimento: "data_vencimento",
    pagamento: "data_pagamento",
  };

const DATA_TIPO_LABEL: Record<DataTipo, string> = {
  competencia: "Competência",
  vencimento: "Vencimento",
  pagamento: "Pagamento",
};

const STATUS_VALIDOS = ["A VENCER", "ATRASADO", "RECEBIDO", "NAO_RECEBIDO"];

function statusBadge(s: string | null) {
  if (s === "RECEBIDO") return <StatusBadge tom="sucesso">Recebido</StatusBadge>;
  if (s === "ATRASADO") return <StatusBadge tom="perigo">Atrasado</StatusBadge>;
  if (s === "A VENCER") return <StatusBadge tom="atencao">A vencer</StatusBadge>;
  if (s === "CANCELADO") return <StatusBadge tom="neutro">Cancelado</StatusBadge>;
  return <StatusBadge tom="neutro">{s ?? "—"}</StatusBadge>;
}

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  try {
    // parseISO lê "YYYY-MM-DD" no fuso de quem usa; `new Date()` leria meia-noite
    // UTC e, no Brasil, o dia anterior.
    const dt = parseISO(d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

/** Dias corridos desde o vencimento, pelo calendário local (não por UTC). */
function diasAtraso(venc: string | null): number | null {
  const d = parseDate(venc);
  if (!d) return null;
  const diff = differenceInCalendarDays(startOfDay(new Date()), d);
  return diff > 0 ? diff : null;
}

/**
 * Ordem de trabalho da aba Faturas (contrato §3): em atraso primeiro, a mais
 * antiga no topo; depois a vencer, a mais próxima primeiro; o resto (recebido,
 * cancelado) por vencimento mais recente. `id` desempata, para a ordem não
 * mudar entre renderizações.
 */
function prioridade(s: string | null): number {
  if (s === "ATRASADO") return 0;
  if (s === "A VENCER") return 1;
  return 2;
}
function ordemDeTrabalho(a: ContaReceber, b: ContaReceber): number {
  const pa = prioridade(a.status_pagamento);
  const pb = prioridade(b.status_pagamento);
  if (pa !== pb) return pa - pb;
  const va = a.data_vencimento ?? "";
  const vb = b.data_vencimento ?? "";
  if (va !== vb) {
    if (!va) return 1;
    if (!vb) return -1;
    return pa === 2 ? vb.localeCompare(va) : va.localeCompare(vb);
  }
  return a.id - b.id;
}

/** O que fazer com a fatura, com a data que manda (Fila: próxima ação com data). */
function proximaAcao(r: ContaReceber): { texto: string; tom?: "perigo" } | null {
  if (r.status_pagamento === "ATRASADO") {
    const d = diasAtraso(r.data_vencimento);
    return {
      texto: d ? `Cobrar · vencida há ${num(d)} ${d === 1 ? "dia" : "dias"}` : "Cobrar",
      tom: "perigo",
    };
  }
  if (r.status_pagamento === "A VENCER") {
    const dia = rotuloDia(r.data_vencimento);
    return { texto: dia ? `Acompanhar · vence ${dia}` : "Acompanhar" };
  }
  return null;
}

/** Busca da Base de clientes: CNPJ quando há (casa exato), senão o nome. */
function buscaCliente(r: { cliente: string | null; cpf_cnpj: string | null }): string {
  const digitos = (r.cpf_cnpj ?? "").replace(/\D/g, "");
  return digitos.length >= 11 ? digitos : (r.cliente ?? "");
}

function DataFiltro({
  valor,
  aoMudar,
  rotulo,
}: {
  valor: Date | undefined;
  aoMudar: (d: Date | undefined) => void;
  rotulo: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[160px] justify-start text-left font-normal",
            !valor && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 size-4" aria-hidden />
          {valor ? format(valor, "dd/MM/yyyy") : rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={valor}
          onSelect={aoMudar}
          initialFocus
          locale={ptBR}
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Contas a Receber (Fila de trabalho; contrato
 * `docs/design/contratos/receita-e-repasses.md` §3). Responde "quais faturas
 * estão em atraso, e de quem cobro?". Não há ação de cobrança no Ops, e nenhuma
 * foi inventada: a próxima ação de cada linha é abrir o cliente na Base.
 *
 * A consulta (`listContasReceber`) não mudou. A paginação dela ordena por
 * `data_vencimento`, que repete, e pode pular ou duplicar linhas entre páginas:
 * é defeito de dado registrado para o dono (contrato, "Defeitos" 2). Aqui só a
 * exibição é paginada, para não renderizar ~29 mil linhas de uma vez.
 */
function ContasReceberPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isLoading, error, refetch } = useContasReceber();
  const perms = usePermissions();
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // Sócio regional só enxerga a própria unidade. Recorta na origem para que
  // KPIs, resumo, faturas e gráficos herdem o escopo.
  const rows = useMemo(
    () =>
      perms.scopedToOwnUnit && perms.unidade
        ? allRows.filter((r) => unitMatches(perms.unidade, r.unidade))
        : allRows,
    [allRows, perms.scopedToOwnUnit, perms.unidade],
  );
  const escopoUnidade = perms.scopedToOwnUnit && !!perms.unidade;
  // /clientes mora em duas áreas: Base de clientes, ou Minha Unidade com a chave
  // view.clientes (a mesma regra do menu, em lib/areas.ts).
  const podeClientes =
    perms.temArea("clientes") || (perms.temArea("minha_unidade") && perms.can("view.clientes"));

  /** Grava na URL; valor vazio sai dela. `replace`: filtro não empilha histórico. */
  const mudar = (patch: Partial<Busca>) => {
    const limpo = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, v === "" || v === ALL ? undefined : v]),
    ) as Partial<Busca>;
    // Sem `?aba=` a aba vem do padrão, que depende dos filtros: grava a aba de
    // agora junto, para mudar filtro não pular do Resumo para as Faturas.
    if (!("aba" in limpo) && !search.aba) limpo.aba = aba;
    void navigate({
      search: (prev: Busca) => ({ ...prev, ...limpo }),
      replace: true,
      resetScroll: false,
    });
  };

  const unidade = search.unidade ?? ALL;
  const status = search.status && STATUS_VALIDOS.includes(search.status) ? search.status : ALL;
  const dataTipo: DataTipo =
    search.dataTipo && search.dataTipo in DATA_TIPO_FIELD
      ? (search.dataTipo as DataTipo)
      : "competencia";
  const dataIni = parseDate(search.dataIni) ?? undefined;
  const dataFim = parseDate(search.dataFim) ?? undefined;
  const q = search.q ?? "";
  const mesFiltro = ehMes(search.mesFiltro) ? search.mesFiltro : undefined;
  const usarSafraFato = !!mesFiltro;
  const modo: SafraFatoMode = search.modo === "safra" ? "safra" : "fato";

  // A busca digitada vai para a URL com uma pausa curta, não a cada tecla.
  // A URL só sobrescreve o campo quando muda por fora (link, "Limpar", "Ver
  // faturas"): a volta da própria gravação não apaga o que foi digitado depois.
  const [busca, setBusca] = useState(q);
  const buscaAtual = useRef(q);
  const gravada = useRef(q);
  const digitar = (v: string) => {
    buscaAtual.current = v;
    setBusca(v);
  };
  useEffect(() => {
    if (q === gravada.current) return;
    gravada.current = q;
    buscaAtual.current = q;
    setBusca(q);
  }, [q]);
  useEffect(() => {
    if (busca.trim() === gravada.current) return;
    const t = setTimeout(() => {
      // Grava o valor do campo NA HORA, não o do render que agendou.
      const v = buscaAtual.current.trim();
      if (v === gravada.current) return;
      gravada.current = v;
      mudar({ q: v || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const ini = dataIni ? startOfDay(dataIni).getTime() : null;
    const fim = dataFim
      ? new Date(
          dataFim.getFullYear(),
          dataFim.getMonth(),
          dataFim.getDate(),
          23,
          59,
          59,
          999,
        ).getTime()
      : null;
    let sfIni: number | null = null;
    let sfFim: number | null = null;
    if (mesFiltro) {
      const [y, m] = mesFiltro.split("-").map(Number);
      sfIni = new Date(y, m - 1, 1).getTime();
      sfFim = new Date(y, m, 1).getTime() - 1;
    }
    return rows.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (status === "NAO_RECEBIDO") {
        if (r.status_pagamento === "RECEBIDO" || r.status_pagamento === "CANCELADO") return false;
      } else if (status !== ALL && r.status_pagamento !== status) return false;
      if (mesFiltro) {
        // Safra: data_competencia. Fato: data_pagamento ?? data_vencimento.
        const d =
          modo === "safra"
            ? parseDate(r.data_competencia)
            : (parseDate(r.data_pagamento) ?? parseDate(r.data_vencimento));
        const t = d ? d.getTime() : null;
        if (t === null) return false;
        if (sfIni !== null && t < sfIni) return false;
        if (sfFim !== null && t > sfFim) return false;
      } else if (ini !== null || fim !== null) {
        const d = parseDate(r[DATA_TIPO_FIELD[dataTipo]]);
        const t = d ? d.getTime() : null;
        if (t === null) return false;
        if (ini !== null && t < ini) return false;
        if (fim !== null && t > fim) return false;
      }
      if (term) {
        const hay = [r.cliente, r.cpf_cnpj, r.num_documento]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        const digitosTermo = term.replace(/\D/g, "");
        const casaDigitos =
          digitosTermo.length >= 3 && (r.cpf_cnpj ?? "").replace(/\D/g, "").includes(digitosTermo);
        if (!hay.includes(term) && !casaDigitos) return false;
      }
      return true;
    });
    // As datas entram pela string da URL: `Date` novo a cada render não re-filtra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, unidade, status, search.dataIni, search.dataFim, dataTipo, mesFiltro, modo]);

  const faturasOrdenadas = useMemo(() => [...filtered].sort(ordemDeTrabalho), [filtered]);
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [filtered]);
  const totalPaginas = Math.max(1, Math.ceil(faturasOrdenadas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = faturasOrdenadas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const kpis = useMemo(() => {
    let aVencer = 0;
    let aVencerQtd = 0;
    let atrasado = 0;
    let atrasadoQtd = 0;
    let recebido = 0;
    let recebidoQtd = 0;
    let total = 0;
    for (const r of filtered) {
      const v = Number(r.valor ?? 0);
      total += v;
      if (r.status_pagamento === "A VENCER") {
        aVencer += v;
        aVencerQtd += 1;
      } else if (r.status_pagamento === "ATRASADO") {
        atrasado += v;
        atrasadoQtd += 1;
      } else if (r.status_pagamento === "RECEBIDO") {
        recebido += v;
        recebidoQtd += 1;
      }
    }
    const ticket = filtered.length ? total / filtered.length : null;
    return { aVencer, aVencerQtd, atrasado, atrasadoQtd, recebido, recebidoQtd, ticket };
  }, [filtered]);

  const porUnidade = useMemo(() => {
    const map = new Map<
      string,
      { qtd: number; total: number; atrasado: number; recebido: number; aVencer: number }
    >();
    for (const r of filtered) {
      const u = r.unidade ?? "—";
      const cur = map.get(u) ?? { qtd: 0, total: 0, atrasado: 0, recebido: 0, aVencer: 0 };
      const v = Number(r.valor ?? 0);
      cur.qtd += 1;
      cur.total += v;
      if (r.status_pagamento === "ATRASADO") cur.atrasado += v;
      else if (r.status_pagamento === "RECEBIDO") cur.recebido += v;
      else if (r.status_pagamento === "A VENCER") cur.aVencer += v;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => ({ unidade, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const inadimplenciaUnidade = useMemo(() => {
    return porUnidade
      .map((u) => ({
        unidade: u.unidade,
        pct: u.total > 0 ? (u.atrasado / u.total) * 100 : 0,
        atrasado: u.atrasado,
      }))
      .filter((u) => u.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [porUnidade]);

  const evolucaoMensal = useMemo(() => {
    const map = new Map<
      string,
      { mes: string; recebido: number; aVencer: number; atrasado: number }
    >();
    for (const r of filtered) {
      const d = parseDate(r.data_competencia) ?? parseDate(r.data_vencimento);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = map.get(key) ?? { mes: key, recebido: 0, aVencer: 0, atrasado: 0 };
      const v = Number(r.valor ?? 0);
      if (r.status_pagamento === "RECEBIDO") cur.recebido += v;
      else if (r.status_pagamento === "A VENCER") cur.aVencer += v;
      else if (r.status_pagamento === "ATRASADO") cur.atrasado += v;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((p) => ({ ...p, rotulo: rotuloMesCurto(p.mes) }));
  }, [filtered]);

  // De quem cobro primeiro: o maior valor em atraso por cliente, no recorte.
  const topAtrasados = useMemo(() => {
    const map = new Map<
      string,
      { cliente: string; cpf_cnpj: string | null; valor: number; qtd: number }
    >();
    for (const r of filtered) {
      if (r.status_pagamento !== "ATRASADO") continue;
      const k = r.cliente ?? "—";
      const cur = map.get(k) ?? { cliente: k, cpf_cnpj: r.cpf_cnpj, valor: 0, qtd: 0 };
      cur.valor += Number(r.valor ?? 0);
      cur.qtd += 1;
      map.set(k, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }, [filtered]);

  const hasFilters =
    q !== "" ||
    unidade !== ALL ||
    status !== ALL ||
    dataIni !== undefined ||
    dataFim !== undefined ||
    usarSafraFato;
  const clearFilters = () => {
    digitar("");
    mudar({
      q: undefined,
      unidade: undefined,
      status: undefined,
      dataIni: undefined,
      dataFim: undefined,
      dataTipo: undefined,
      mesFiltro: undefined,
      modo: undefined,
    });
  };

  // Sem `?aba=`: quem chega com filtro (o Funil de Receita linka assim) cai
  // nas Faturas; sem filtro, no Resumo. A aba escolhida é gravada sempre, para
  // não pular de aba quando o filtro muda.
  const abaPadrao: Aba = search.unidade || search.status || search.dataIni ? "faturas" : "resumo";
  const aba: Aba =
    search.aba === "resumo" || search.aba === "faturas" || search.aba === "mensalidades"
      ? search.aba
      : abaPadrao;
  const irParaFaturas = (patch: Partial<Busca>) => mudar({ ...patch, aba: "faturas" });

  const regua = mesFiltro
    ? modo === "safra"
      ? "competência"
      : "pagamento (ou vencimento, se em aberto)"
    : dataIni || dataFim
      ? DATA_TIPO_LABEL[dataTipo].toLowerCase()
      : "todo o histórico";

  const descricao = isLoading ? (
    "Faturas emitidas pelas unidades no Omie."
  ) : hasFilters ? (
    <>
      <span className="num">{num(filtered.length)}</span> de{" "}
      <span className="num">{num(rows.length)}</span> faturas no recorte · títulos das unidades no
      Omie, valor bruto do título · os cards somam só o recorte.
    </>
  ) : (
    <>
      <span className="num">{num(rows.length)}</span> faturas · títulos das unidades no Omie, valor
      bruto do título · <strong>sem filtro, os cards somam todo o histórico</strong>.
    </>
  );

  const filtros = (
    <>
      <label className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Checkbox
          checked={usarSafraFato}
          onCheckedChange={(c) =>
            mudar(c ? { mesFiltro: mesCorrente() } : { mesFiltro: undefined, modo: undefined })
          }
        />
        Filtrar por mês
      </label>
      {usarSafraFato && mesFiltro && (
        <SafraFatoFilter
          mode={modo}
          mes={mesFiltro}
          onModeChange={(m) => mudar({ modo: m === "fato" ? undefined : m })}
          onMesChange={(m) => mudar({ mesFiltro: m })}
        />
      )}
      <div className="h-6 w-px bg-border" aria-hidden />

      <div className="relative min-w-[240px] flex-1">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Buscar cliente, CNPJ ou documento..."
          aria-label="Buscar cliente, CNPJ ou documento"
          value={busca}
          onChange={(e) => digitar(e.target.value)}
          className="pl-9"
        />
      </div>
      {escopoUnidade ? (
        <Badge variant="secondary" className="h-9 px-3">
          {perms.unidade}
        </Badge>
      ) : (
        <Select value={unidade} onValueChange={(v) => mudar({ unidade: v })}>
          <SelectTrigger className="w-[180px]" aria-label="Unidade">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {unidade !== ALL && !unidades.includes(unidade) && (
              <SelectItem value={unidade}>{unidade}</SelectItem>
            )}
            {unidades.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={status} onValueChange={(v) => mudar({ status: v })}>
        <SelectTrigger className="w-[160px]" aria-label="Status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os status</SelectItem>
          <SelectItem value="A VENCER">A vencer</SelectItem>
          <SelectItem value="ATRASADO">Atrasado</SelectItem>
          <SelectItem value="RECEBIDO">Recebido</SelectItem>
          <SelectItem value="NAO_RECEBIDO">Não recebido (a vencer + atrasado)</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={dataTipo}
        onValueChange={(v) => mudar({ dataTipo: v === "competencia" ? undefined : v })}
      >
        <SelectTrigger className="w-[150px]" aria-label="Tipo de data">
          <SelectValue placeholder="Tipo de data" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DATA_TIPO_LABEL) as DataTipo[]).map((k) => (
            <SelectItem key={k} value={k}>
              {DATA_TIPO_LABEL[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DataFiltro
        valor={dataIni}
        aoMudar={(d) => mudar({ dataIni: d ? format(d, "yyyy-MM-dd") : undefined })}
        rotulo={`${DATA_TIPO_LABEL[dataTipo]} de`}
      />
      <DataFiltro
        valor={dataFim}
        aoMudar={(d) => mudar({ dataFim: d ? format(d, "yyyy-MM-dd") : undefined })}
        rotulo={`${DATA_TIPO_LABEL[dataTipo]} até`}
      />
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="ml-auto text-muted-foreground"
        >
          <X className="size-4" aria-hidden /> Limpar filtros
        </Button>
      )}
    </>
  );

  return (
    <MolduraReceita
      titulo="Contas a Receber"
      pergunta="Quais faturas estão em atraso, e de quem cobro?"
      descricao={descricao}
      procedencia={{ fonte: "Omie · contas_receber", regua }}
      acoes={<OmieLastSync />}
      filtros={filtros}
    >
      <div className="space-y-6 p-4 md:p-6">
        {error ? (
          <ErroDaConsulta erro={error} chaves={CHAVES} tentarNovamente={() => void refetch()} />
        ) : isLoading ? (
          <>
            <Carregando variante="kpis" />
            <Carregando variante="tabela" />
          </>
        ) : (
          <>
            {/* Os cards somam as faturas do recorte; a aba Mensalidades tem outra base. */}
            {aba !== "mensalidades" && (
              <KpiGrade colunas={4}>
                <KpiCard
                  rotulo="Em atraso (filtro)"
                  valor={brlOuTraco(kpis.atrasado)}
                  nota={`${num(kpis.atrasadoQtd)} fatura(s) vencida(s) e não paga(s)`}
                  tom={kpis.atrasado > 0 ? "perigo" : undefined}
                  abrir={
                    kpis.atrasadoQtd > 0
                      ? {
                          onClick: () => irParaFaturas({ status: "ATRASADO" }),
                          rotulo: "Ver faturas",
                        }
                      : undefined
                  }
                />
                <KpiCard
                  rotulo="A vencer (filtro)"
                  valor={brlOuTraco(kpis.aVencer)}
                  nota={`${num(kpis.aVencerQtd)} fatura(s) em aberto no prazo`}
                  abrir={
                    kpis.aVencerQtd > 0
                      ? {
                          onClick: () => irParaFaturas({ status: "A VENCER" }),
                          rotulo: "Ver faturas",
                        }
                      : undefined
                  }
                />
                <KpiCard
                  rotulo="Recebido (filtro)"
                  valor={brlOuTraco(kpis.recebido)}
                  nota={`${num(kpis.recebidoQtd)} fatura(s) paga(s)`}
                  abrir={
                    kpis.recebidoQtd > 0
                      ? {
                          onClick: () => irParaFaturas({ status: "RECEBIDO" }),
                          rotulo: "Ver faturas",
                        }
                      : undefined
                  }
                />
                <KpiCard
                  rotulo="Ticket médio (filtro)"
                  valor={brlOuTraco(kpis.ticket)}
                  estado={kpis.ticket === null ? "nao-apurado" : "ok"}
                  nota={
                    kpis.ticket === null
                      ? "nenhuma fatura no recorte"
                      : "valor ÷ faturas do recorte"
                  }
                />
              </KpiGrade>
            )}

            <Tabs value={aba} onValueChange={(v) => mudar({ aba: v })} className="w-full">
              <TabsList>
                <TabsTrigger value="faturas">
                  Faturas <span className="num">({num(filtered.length)})</span>
                </TabsTrigger>
                <TabsTrigger value="resumo">Resumo por unidade</TabsTrigger>
                <TabsTrigger value="mensalidades">Mensalidades</TabsTrigger>
              </TabsList>

              <TabsContent value="resumo" className="space-y-6">
                <Secao
                  titulo="De quem cobro primeiro?"
                  descricao="Os cinco clientes com mais valor em atraso no recorte."
                >
                  {topAtrasados.length === 0 ? (
                    <EstadoVazio titulo="Nenhuma fatura em atraso no recorte" />
                  ) : (
                    <div className="overflow-auto rounded-xl border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="text-right">Faturas em atraso</TableHead>
                            <TableHead className="text-right">Em atraso</TableHead>
                            <TableHead className="text-right">Próxima ação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {topAtrasados.map((c) => (
                            <TableRow key={c.cliente}>
                              <TableCell className="font-medium">{c.cliente}</TableCell>
                              <TableCell className="num text-right">{num(c.qtd)}</TableCell>
                              <TableCell className="num text-right font-medium text-danger">
                                {brlOuTraco(c.valor)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const alvo = buscaCliente(c);
                                      digitar(alvo);
                                      irParaFaturas({ q: alvo, status: "ATRASADO" });
                                    }}
                                  >
                                    Ver faturas
                                  </Button>
                                  <AbrirCliente busca={buscaCliente(c)} pode={podeClientes} />
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Secao>

                <Secao
                  titulo="Quanto cada unidade tem a receber, em atraso e recebido?"
                  descricao="Clique na unidade para abrir as faturas dela."
                >
                  {porUnidade.length === 0 ? (
                    <EstadoVazio titulo="Nenhuma fatura no recorte" total={rows.length} />
                  ) : (
                    <div className="overflow-auto rounded-xl border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unidade</TableHead>
                            <TableHead className="text-right">Faturas</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">A vencer</TableHead>
                            <TableHead className="text-right">Em atraso</TableHead>
                            <TableHead className="text-right">Recebido</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {porUnidade.map((u) => (
                            <TableRow key={u.unidade}>
                              <TableCell>
                                {u.unidade === "—" ? (
                                  <span className="text-muted-foreground">Sem unidade</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded-sm font-medium underline-offset-2 hover:text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    onClick={() => irParaFaturas({ unidade: u.unidade })}
                                  >
                                    {u.unidade}
                                  </button>
                                )}
                              </TableCell>
                              <TableCell className="num text-right">{num(u.qtd)}</TableCell>
                              <TableCell className="num text-right">
                                {brlOuTraco(u.total)}
                              </TableCell>
                              <TableCell className="num text-right">
                                {brlOuTraco(u.aVencer)}
                              </TableCell>
                              <TableCell className="num text-right text-danger">
                                {brlOuTraco(u.atrasado)}
                              </TableCell>
                              <TableCell className="num text-right">
                                {brlOuTraco(u.recebido)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Secao>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Secao
                    titulo="Onde a inadimplência pesa mais?"
                    descricao="% do valor do recorte em atraso, dez maiores unidades."
                  >
                    <div className="rounded-xl border bg-card p-4">
                      {inadimplenciaUnidade.length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                          Sem inadimplência no filtro atual.
                        </p>
                      ) : (
                        <ResponsiveContainer
                          width="100%"
                          height={Math.max(220, inadimplenciaUnidade.length * 32)}
                        >
                          <BarChart
                            data={inadimplenciaUnidade}
                            layout="vertical"
                            margin={{ left: 8, right: 16 }}
                          >
                            <CartesianGrid {...gradeProps} vertical horizontal={false} />
                            <XAxis
                              type="number"
                              {...eixoProps}
                              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                            />
                            <YAxis type="category" dataKey="unidade" {...eixoProps} width={90} />
                            <Tooltip
                              {...tooltipProps}
                              formatter={(value: number, _name, item) => [
                                `${value.toFixed(1)}% (${brlOuTraco(item?.payload?.atrasado)})`,
                                "Em atraso",
                              ]}
                            />
                            <Bar dataKey="pct" fill={COR_NEGATIVO} radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Secao>

                  <Secao
                    titulo="Como o recebido e o atraso evoluíram por mês?"
                    descricao="R$ por mês de competência (ou vencimento, se a fatura não tem competência)."
                  >
                    <div className="rounded-xl border bg-card p-4">
                      {evolucaoMensal.length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                          Sem dados para o filtro atual.
                        </p>
                      ) : (
                        <ResponsiveContainer width="100%" height={260}>
                          <LineChart data={evolucaoMensal} margin={{ left: 8, right: 16 }}>
                            <CartesianGrid {...gradeProps} />
                            <XAxis dataKey="rotulo" {...eixoProps} />
                            <YAxis {...eixoProps} tickFormatter={eixoMoeda} />
                            <Tooltip cursor={tooltipProps.cursor} content={<TooltipMoeda />} />
                            <Legend {...legendaProps} />
                            <Line
                              type="monotone"
                              dataKey="recebido"
                              name="Recebido"
                              stroke={CORES_SERIE[0]}
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="aVencer"
                              name="A vencer"
                              stroke={CORES_SERIE[1]}
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="atrasado"
                              name="Em atraso"
                              stroke={COR_NEGATIVO}
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Secao>
                </div>
              </TabsContent>

              <TabsContent value="faturas" className="space-y-3">
                {faturasOrdenadas.length === 0 ? (
                  <EstadoVazio
                    titulo="Nenhuma fatura encontrada"
                    total={rows.length}
                    acao={
                      hasFilters ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Limpar filtros
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="overflow-hidden rounded-xl border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm">
                      <span>
                        <span className="num font-medium">{num(faturasOrdenadas.length)}</span>{" "}
                        fatura(s) · em atraso primeiro, a mais antiga no topo
                      </span>
                      <Paginacao
                        pagina={paginaAtual}
                        total={totalPaginas}
                        linhas={faturasOrdenadas.length}
                        aoMudar={setPagina}
                      />
                    </div>
                    <div className="relative max-h-[calc(100vh-340px)] overflow-auto">
                      <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
                        <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                          <TableRow>
                            <TableHead className="bg-card">Status</TableHead>
                            <TableHead className="bg-card">Cliente</TableHead>
                            <TableHead className="bg-card">Unidade</TableHead>
                            <TableHead className="bg-card">Documento</TableHead>
                            <TableHead className="bg-card">Competência</TableHead>
                            <TableHead className="bg-card">Vencimento</TableHead>
                            <TableHead className="bg-card">Pagamento</TableHead>
                            <TableHead className="bg-card text-right">Valor</TableHead>
                            <TableHead className="bg-card text-right">Atraso (dias)</TableHead>
                            <TableHead className="bg-card">Próxima ação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visiveis.map((r) => {
                            const atraso =
                              r.status_pagamento === "ATRASADO"
                                ? diasAtraso(r.data_vencimento)
                                : null;
                            const acao = proximaAcao(r);
                            return (
                              <TableRow key={r.id}>
                                <TableCell>{statusBadge(r.status_pagamento)}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{r.cliente || "—"}</div>
                                  {r.cpf_cnpj && (
                                    <div className="font-mono text-xs text-muted-foreground">
                                      {r.cpf_cnpj}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {r.unidade ? <Badge variant="secondary">{r.unidade}</Badge> : "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {r.num_documento || "—"}
                                </TableCell>
                                <TableCell className="num">{date(r.data_competencia)}</TableCell>
                                <TableCell className="num">{date(r.data_vencimento)}</TableCell>
                                <TableCell className="num">{date(r.data_pagamento)}</TableCell>
                                <TableCell className="num whitespace-nowrap text-right">
                                  {brlOuTraco(r.valor)}
                                </TableCell>
                                <TableCell className="num text-right">
                                  {atraso != null ? (
                                    <span className="font-medium text-danger">{atraso}</span>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {acao && (
                                      <span
                                        className={cn(
                                          "whitespace-nowrap text-[13px]",
                                          acao.tom === "perigo"
                                            ? "text-danger"
                                            : "text-muted-foreground",
                                        )}
                                      >
                                        {acao.texto}
                                      </span>
                                    )}
                                    {(r.cliente || r.cpf_cnpj) && (
                                      <AbrirCliente
                                        busca={buscaCliente(r)}
                                        pode={podeClientes}
                                        className="ml-auto"
                                      />
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </table>
                    </div>
                    {totalPaginas > 1 && (
                      <div className="flex justify-end border-t px-4 py-2">
                        <Paginacao
                          pagina={paginaAtual}
                          total={totalPaginas}
                          linhas={faturasOrdenadas.length}
                          aoMudar={setPagina}
                        />
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="mensalidades" className="space-y-4">
                <DataProvider>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Defeito de dado 1 do contrato: o DataProvider lê contas_receber com
                        limit(50000), cortado em 1.000 pelo PostgREST. Até o dono corrigir a
                        consulta, a tela avisa em vez de parecer completa (N2). */}
                    <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                      Os recebimentos são lidos em até 1.000 títulos: “Sem recebimento” pode estar
                      errado.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Base:
                      </span>
                      <BaseFilterSelect />
                      <RefreshButton />
                    </div>
                  </div>
                  <MensalidadesTab />
                </DataProvider>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </MolduraReceita>
  );
}

function Paginacao({
  pagina,
  total,
  linhas,
  aoMudar,
}: {
  pagina: number;
  total: number;
  linhas: number;
  aoMudar: (p: number) => void;
}) {
  if (total <= 1) return null;
  const de = (pagina - 1) * POR_PAGINA + 1;
  const ate = Math.min(pagina * POR_PAGINA, linhas);
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span className="num">
        {num(de)}–{num(ate)} de {num(linhas)}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => aoMudar(pagina - 1)}
        disabled={pagina <= 1}
        aria-label="Página anterior"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <span className="num">
        {pagina} / {total}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => aoMudar(pagina + 1)}
        disabled={pagina >= total}
        aria-label="Próxima página"
      >
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Próxima ação da linha: abrir o cliente na Base. Sem acesso a /clientes o
 * botão fica desabilitado e diz por quê (N8), em vez de sumir ou levar a uma
 * tela de "sem permissão".
 */
function AbrirCliente({
  busca,
  pode,
  className,
}: {
  busca: string;
  pode: boolean;
  className?: string;
}) {
  if (!pode) {
    const motivo = "Sem acesso à Base de clientes (área Base de clientes ou chave view.clientes)";
    return (
      <span
        tabIndex={0}
        title={motivo}
        aria-label={`Abrir cliente indisponível: ${motivo}`}
        className={cn(
          "inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Button variant="ghost" size="sm" disabled tabIndex={-1} aria-hidden>
          <Building2 className="size-4" aria-hidden />
          Abrir cliente
        </Button>
      </span>
    );
  }
  return (
    <Button variant="ghost" size="sm" asChild className={className}>
      <Link to="/clientes" search={{ q: busca }}>
        <Building2 className="size-4" aria-hidden />
        Abrir cliente
      </Link>
    </Button>
  );
}
