import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Search,
  TriangleAlert,
  Users,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { exportRowsToXlsx } from "@/lib/xlsx-export";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { PrePlanningTab } from "@/components/clientes/pre-planning-tab";
import {
  ContatosClienteDialog,
  type ClienteSelecionado,
} from "@/components/clientes/contatos-cliente-dialog";
import { atualizarCliente, marcarChurnCliente } from "@/lib/clientes.functions";
import { MOTIVOS_CHURN, type MotivoChurn } from "@/lib/royalties.functions";
import { digits } from "@/lib/server-utils";

type StatusFinanceiro =
  "ATIVO" | "EM_ATRASO" | "INADIMPLENTE" | "SEM_ATIVIDADE" | "NUNCA_PAGOU" | "SEM_AR";

type Cliente = {
  id: number;
  razao_social: string | null;
  titulo: string | null;
  cnpj: string | null;
  uf: string | null;
  unidade: string | null;
  pipedrive_id: string | null;
  fonte_cadastro: string | null;
  status_financeiro: StatusFinanceiro | null;
  erp: string | null;
  segmento: string | null;
};

type ContratoInfo = {
  ganho_em: string | null;
  regime_tributario: string | null;
  entrada_contrato_assinado_em: string | null;
  closer: string | null;
};

// Cliente que existe no ERP (Omie) mas ainda não foi reconciliado em `empresas`
// (sem pipedrive_id/contrato vinculado) — não entra em cards, contagem ou MRR total.
type OmieMatch = {
  cnpj: string;
  razao_social: string | null;
  unidade: string | null;
};

// razao_social às vezes vem de um enriquecimento de CNPJ que grava placeholders
// em vez de deixar nulo quando não encontra a razão social oficial.
const GARBAGE_RAZAO_SOCIAL = new Set([
  ".",
  "0",
  "-",
  "--",
  "---",
  "n/a",
  "N/A",
  "NA",
  "o",
  "a",
  "n",
  "c",
  "cc",
  "xx",
]);
function displayName(r: Pick<Cliente, "razao_social" | "titulo">): string {
  const rs = r.razao_social?.trim();
  if (rs && !GARBAGE_RAZAO_SOCIAL.has(rs)) return rs;
  return r.titulo?.trim() || "";
}

const ALL = "__all__";

const STATUS_ORDER: StatusFinanceiro[] = [
  "ATIVO",
  "INADIMPLENTE",
  "NUNCA_PAGOU",
  "EM_ATRASO",
  "SEM_ATIVIDADE",
  "SEM_AR",
];

const STATUS_META: Record<
  StatusFinanceiro,
  { label: string; card: string; badge: string; description: string }
> = {
  ATIVO: {
    label: "Ativo",
    card: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-100",
    badge: "bg-emerald-500 text-white hover:bg-emerald-500",
    description: "Pagou nos últimos 90 dias",
  },
  EM_ATRASO: {
    label: "Em atraso",
    card: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-900 dark:text-amber-100",
    badge: "bg-amber-400 text-amber-950 hover:bg-amber-400",
    description: "Título vencido, mas pagou recentemente",
  },
  INADIMPLENTE: {
    label: "Inadimplente",
    card: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-900 dark:text-red-100",
    badge: "bg-red-600 text-white hover:bg-red-600",
    description: "Vencido + sem pagamento há mais de 90 dias",
  },
  SEM_ATIVIDADE: {
    label: "Sem atividade",
    card: "bg-orange-50 border-orange-200 text-orange-900 dark:bg-orange-950 dark:border-orange-900 dark:text-orange-100",
    badge: "bg-orange-500 text-white hover:bg-orange-500",
    description: "Sem pagamento >90 dias, sem título em aberto",
  },
  NUNCA_PAGOU: {
    label: "Nunca pagou",
    card: "bg-slate-700 border-slate-800 text-white dark:bg-slate-800 dark:border-slate-900",
    badge: "bg-slate-700 text-white hover:bg-slate-700",
    description: "Sem nenhum pagamento registrado",
  },
  SEM_AR: {
    label: "Sem AR",
    card: "bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200",
    badge: "bg-slate-300 text-slate-800 hover:bg-slate-300",
    description: "Sem histórico de faturamento (Pipedrive sem Omie)",
  },
};

export const Route = createFileRoute("/_authenticated/clientes")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? search.status : "",
    unidade: typeof search.unidade === "string" ? search.unidade : "",
  }),
  component: ClientesPage,
});

function ClientesPage() {
  const perms = usePermissions();
  const { status: statusParam, unidade: unidadeParam } = Route.useSearch();
  const [rows, setRows] = useState<Cliente[]>([]);
  const [mrrByPipedriveId, setMrrByPipedriveId] = useState<Map<string, number>>(new Map());
  const [contratoInfoByPipedriveId, setContratoInfoByPipedriveId] = useState<
    Map<string, ContratoInfo>
  >(new Map());
  const [churnedIds, setChurnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(unidadeParam || ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFinanceiro | null>(
    statusParam ? (statusParam as StatusFinanceiro) : null,
  );
  const [churnFilter, setChurnFilter] = useState<boolean | null>(null);
  const [erpFilter, setErpFilter] = useState(ALL);
  const [segmentoFilter, setSegmentoFilter] = useState(ALL);
  const [contratoAssinadoFilter, setContratoAssinadoFilter] = useState<boolean | null>(null);
  const [omieMatches, setOmieMatches] = useState<OmieMatch[]>([]);
  const [omieLoading, setOmieLoading] = useState(false);
  // Cliente cujo painel de contatos está aberto (null = fechado).
  const [contatoCliente, setContatoCliente] = useState<ClienteSelecionado | null>(null);
  // Quantos contatos cada empresa tem, pra sinalizar na linha antes do clique.
  const [contatosCount, setContatosCount] = useState<Map<number, number>>(new Map());
  type SortKey =
    | "razao_social"
    | "unidade"
    | "mrr"
    | "cnpj"
    | "uf"
    | "status_financeiro"
    | "pipedrive_id"
    | "fonte_cadastro"
    | "erp"
    | "segmento"
    | "ganho_em"
    | "regime_tributario"
    | "entrada_contrato_assinado_em"
    | "closer";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const atualizarClienteFn = useServerFn(atualizarCliente);
  const marcarChurnClienteFn = useServerFn(marcarChurnCliente);

  const salvarEdicaoCliente = async (
    r: Cliente,
    patch: { razao_social?: string; cnpj?: string },
  ) => {
    const res = await atualizarClienteFn({ data: { id: r.id, ...patch } });
    setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, ...patch } : row)));
    toast.success("Cliente atualizado.");
    return res;
  };

  const marcarChurnDoCliente = async (
    r: Cliente,
    motivo: string,
    observacao: string,
    dataChurn: string,
  ) => {
    await marcarChurnClienteFn({
      data: {
        pipedrive_id: r.pipedrive_id ?? "",
        razao_social: displayName(r),
        unidade: r.unidade ?? "",
        mrr: mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0,
        motivo,
        observacao,
        data_churn: dataChurn,
      },
    });
    setChurnedIds((prev) => new Set(prev).add(r.pipedrive_id ?? ""));
    toast.success("Churn registrado — pode levar até 15min pra refletir no Pipefy/Tratativas.");
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [unidadesRes, empRes, contRes, tratRes] = await Promise.all([
        supabase.from("unidades").select("nome_da_praca").eq("tipo", "regional"),
        supabase
          .from("empresas")
          .select(
            "id,razao_social,titulo,cnpj,uf,unidade,pipedrive_id,fonte_cadastro,status_financeiro,erp,segmento",
          )
          .eq("tipo_unidade", "franquia")
          .order("razao_social", { ascending: true })
          .limit(5000),
        supabase
          .from("contratos")
          .select(
            "mrr_mensal,pipedrive_deal_id,status_contrato,unidade,ganho_em,regime_tributario,entrada_contrato_assinado_em,closer",
          )
          .eq("status_contrato", "Ativo")
          .limit(20000),
        supabase
          .from("central_tratativas")
          .select("pipedrive_deal_id")
          // status="lost" é derivado do id da fase no Pipefy (ver PHASE_STATUS em
          // tratativas.functions.ts), não do nome — resiliente a rename de fase.
          // A fase "Perdido" virou "Churn Confirmado (Perdido)" em ago/2026 e um
          // filtro por nome (.eq("estagio","Perdido")) zerava o churn aqui.
          .eq("status", "lost")
          .limit(2000),
      ]);
      if (!mounted) return;
      // Unidades regionais ativas (fonte de verdade: tabela `unidades`, tipo='regional').
      // Alinha com v_funil_mensal / v_reconciliacao_mensal — exclui franquias desativadas
      // como Itaúna mesmo que ainda estejam marcadas tipo_unidade='franquia' em contratos/empresas.
      const regionais = new Set((unidadesRes.data ?? []).map((u) => u.nome_da_praca));
      if (empRes.data) {
        setRows((empRes.data as Cliente[]).filter((r) => regionais.has(r.unidade ?? "")));
      }
      const m = new Map<string, number>();
      const info = new Map<string, ContratoInfo>();
      for (const c of contRes.data ?? []) {
        if (!regionais.has(c.unidade ?? "")) continue;
        const id = c.pipedrive_deal_id != null ? String(c.pipedrive_deal_id) : null;
        if (!id) continue;
        // contratos.mrr_mensal já é o valor mensal (coluna gerada = mrr/12)
        m.set(id, (m.get(id) ?? 0) + Number(c.mrr_mensal ?? 0));
        // um pipedrive_deal_id não deveria ter mais de um contrato, mas por segurança
        // mantém o primeiro valor não nulo encontrado para cada campo
        const prev = info.get(id);
        info.set(id, {
          ganho_em: prev?.ganho_em ?? c.ganho_em ?? null,
          regime_tributario: prev?.regime_tributario ?? c.regime_tributario ?? null,
          entrada_contrato_assinado_em:
            prev?.entrada_contrato_assinado_em ?? c.entrada_contrato_assinado_em ?? null,
          closer: prev?.closer ?? c.closer ?? null,
        });
      }
      setMrrByPipedriveId(m);
      setContratoInfoByPipedriveId(info);
      const churned = new Set<string>(
        (tratRes.data ?? []).map((t) => String(t.pipedrive_deal_id)).filter(Boolean),
      );
      setChurnedIds(churned);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Contagem de contatos por empresa, carregada de uma vez só (a tabela toda é ~1k linhas).
  // Sem `view.contatos` a RLS devolve vazio — nesse caso nem consulta, e a linha não vira
  // clicável, pra não abrir um painel que sempre apareceria vazio.
  const podeVerContatos = perms.can("view.contatos");
  // Admin sempre pode; manage.clientes_churn libera "Marcar churn" pra outros papéis
  // sem dar acesso a editar razão social/CNPJ (que continua admin-only).
  const podeMarcarChurn = perms.isAdmin || perms.can("manage.clientes_churn");
  useEffect(() => {
    if (!podeVerContatos) {
      setContatosCount(new Map());
      return;
    }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("contatos")
        .select("empresa_id")
        .not("empresa_id", "is", null)
        .limit(20000);
      if (!mounted) return;
      const counts = new Map<number, number>();
      for (const c of data ?? []) {
        const id = c.empresa_id as number;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      setContatosCount(counts);
    })();
    return () => {
      mounted = false;
    };
  }, [podeVerContatos]);

  const cnpjsReconciliados = useMemo(
    () => new Set(rows.map((r) => digits(r.cnpj)).filter(Boolean)),
    [rows],
  );

  // Busca complementar na Omie (fonte: ERP, não Pipedrive) pra achar clientes que existem
  // no faturamento mas nunca foram reconciliados em `empresas` — não conta em nenhum card
  // nem no MRR total, é só um sinal pra reconciliação manual.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setOmieMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setOmieLoading(true);
      const termDigits = digits(term);
      const orParts = [`razao_social.ilike.%${term}%`];
      if (termDigits.length >= 3) orParts.push(`cnpj.ilike.%${termDigits}%`);
      // omie_clientes_cadastro (não omie_clientes) porque só ela tem policy de SELECT
      // pra role authenticated — omie_clientes é RLS-enabled sem nenhuma policy,
      // então fica inacessível pro client-side supabase mesmo logado.
      const { data } = await supabase
        .from("omie_clientes_cadastro")
        .select("cnpj,razao_social,unidade")
        .or(orParts.join(","))
        .limit(15);
      if (cancelled) return;
      const naoReconciliados = (data ?? []).filter((m) => !cnpjsReconciliados.has(digits(m.cnpj)));
      setOmieMatches(naoReconciliados);
      setOmieLoading(false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, cnpjsReconciliados]);

  const fmtBRL = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const fmtDate = (v: string | null | undefined) => {
    if (!v) return null;
    const [y, m, d] = v.split("-");
    return y && m && d ? `${d}/${m}/${y}` : v;
  };

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const erps = useMemo(
    () => Array.from(new Set(rows.map((r) => r.erp).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const segmentos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.segmento).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const visiveis = useMemo(() => {
    if (perms.scopedToOwnUnit && perms.unidade) {
      return rows.filter((r) => unitMatches(perms.unidade, r.unidade));
    }
    return rows;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  // churn status derived from central_tratativas (estagio=Perdido)
  const isChurn = (r: Cliente) => !!r.pipedrive_id && churnedIds.has(r.pipedrive_id);

  // Todos os filtros da UI (busca, unidade, ERP, segmento, status, contrato assinado)
  // exceto o próprio filtro de churn — serve de base tanto pros cards de resumo
  // (que precisam contar ativo/churn dentro do recorte atual) quanto pra tabela.
  const baseFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((r) => {
      if (statusFilter && r.status_financeiro !== statusFilter) return false;
      if (!perms.scopedToOwnUnit && unidade !== ALL && r.unidade !== unidade) return false;
      if (erpFilter !== ALL && r.erp !== erpFilter) return false;
      if (segmentoFilter !== ALL && r.segmento !== segmentoFilter) return false;
      if (contratoAssinadoFilter !== null) {
        const assinado = !!contratoInfoByPipedriveId.get(r.pipedrive_id ?? "")
          ?.entrada_contrato_assinado_em;
        if (contratoAssinadoFilter !== assinado) return false;
      }
      if (term) {
        const hay = [r.razao_social, r.titulo, r.cnpj]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [
    visiveis,
    q,
    unidade,
    statusFilter,
    erpFilter,
    segmentoFilter,
    contratoAssinadoFilter,
    perms.scopedToOwnUnit,
    contratoInfoByPipedriveId,
  ]);

  const churnCounts = useMemo(
    () => ({
      churn: baseFiltered.filter(isChurn).length,
      ativo: baseFiltered.filter((r) => !isChurn(r)).length,
    }),
    [baseFiltered, churnedIds],
  );

  const filtered = useMemo(() => {
    const out = baseFiltered.filter((r) => {
      // churn filter: null = all, true = only churn, false = only active
      if (churnFilter === true && !isChurn(r)) return false;
      if (churnFilter === false && isChurn(r)) return false;
      return true;
    });
    const rank = new Map<string, number>();
    STATUS_ORDER.forEach((s, i) => rank.set(s, i));
    const mrrOf = (r: Cliente) => mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0;
    const infoOf = (r: Cliente) => contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
    if (!sort) {
      return out.sort((a, b) => {
        const ra = rank.get(a.status_financeiro ?? "") ?? 99;
        const rb = rank.get(b.status_financeiro ?? "") ?? 99;
        if (ra !== rb) return ra - rb;
        return displayName(a).localeCompare(displayName(b), "pt-BR");
      });
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
      const av = a ?? "";
      const bv = b ?? "";
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      return av.localeCompare(bv, "pt-BR");
    };
    const cmpNum = (a: number, b: number) => a - b;
    return out.sort((a, b) => {
      let c = 0;
      switch (sort.key) {
        case "razao_social":
          c = cmpStr(displayName(a), displayName(b));
          break;
        case "unidade":
          c = cmpStr(a.unidade, b.unidade);
          break;
        case "mrr":
          c = cmpNum(mrrOf(a), mrrOf(b));
          break;
        case "cnpj":
          c = cmpStr(a.cnpj, b.cnpj);
          break;
        case "uf":
          c = cmpStr(a.uf, b.uf);
          break;
        case "status_financeiro": {
          const ra = rank.get(a.status_financeiro ?? "") ?? 99;
          const rb = rank.get(b.status_financeiro ?? "") ?? 99;
          c = ra - rb;
          break;
        }
        case "pipedrive_id":
          c = cmpNum(Number(a.pipedrive_id ?? 0), Number(b.pipedrive_id ?? 0));
          break;
        case "fonte_cadastro":
          c = cmpStr(a.fonte_cadastro, b.fonte_cadastro);
          break;
        case "erp":
          c = cmpStr(a.erp, b.erp);
          break;
        case "segmento":
          c = cmpStr(a.segmento, b.segmento);
          break;
        case "ganho_em":
          c = cmpStr(infoOf(a)?.ganho_em, infoOf(b)?.ganho_em);
          break;
        case "regime_tributario":
          c = cmpStr(infoOf(a)?.regime_tributario, infoOf(b)?.regime_tributario);
          break;
        case "entrada_contrato_assinado_em":
          c = cmpStr(
            infoOf(a)?.entrada_contrato_assinado_em,
            infoOf(b)?.entrada_contrato_assinado_em,
          );
          break;
        case "closer":
          c = cmpStr(infoOf(a)?.closer, infoOf(b)?.closer);
          break;
      }
      if (c !== 0) return c * dir;
      return (a.razao_social ?? "").localeCompare(b.razao_social ?? "", "pt-BR");
    });
  }, [baseFiltered, churnFilter, churnedIds, sort, mrrByPipedriveId, contratoInfoByPipedriveId]);

  const hasFilters =
    q !== "" ||
    unidade !== ALL ||
    statusFilter !== null ||
    churnFilter !== null ||
    erpFilter !== ALL ||
    segmentoFilter !== ALL ||
    contratoAssinadoFilter !== null;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setStatusFilter(null);
    setChurnFilter(null);
    setErpFilter(ALL);
    setSegmentoFilter(ALL);
    setContratoAssinadoFilter(null);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Diretório da rede com status financeiro consolidado.
          </p>
        </div>
      </div>

      <Tabs defaultValue="planning" className="space-y-6">
        <TabsList>
          <TabsTrigger value="planning">Base nova</TabsTrigger>
          <TabsTrigger value="pre-planning">Base Antiga</TabsTrigger>
        </TabsList>

        <TabsContent value="planning" className="space-y-6">
          {/* Status do Cliente (ativo vs churn) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setChurnFilter(churnFilter === false ? null : false);
                setStatusFilter(null);
              }}
              className={cn(
                "rounded-lg border p-4 text-left shadow-sm transition-all hover:shadow-md",
                "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-100",
                churnFilter === false && "ring-2 ring-offset-2 ring-primary",
              )}
            >
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                Clientes Ativos
              </div>
              <div className="mt-1 text-3xl font-bold">{churnCounts.ativo}</div>
              <div className="mt-1 text-[11px] opacity-75">Sem card de churn em tratativas</div>
            </button>
            <button
              type="button"
              onClick={() => {
                setChurnFilter(churnFilter === true ? null : true);
                setStatusFilter(null);
              }}
              className={cn(
                "rounded-lg border p-4 text-left shadow-sm transition-all hover:shadow-md",
                "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-900 dark:text-red-100",
                churnFilter === true && "ring-2 ring-offset-2 ring-primary",
              )}
            >
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">Churn</div>
              <div className="mt-1 text-3xl font-bold">{churnCounts.churn}</div>
              <div className="mt-1 text-[11px] opacity-75">Card "Perdido" em tratativas</div>
            </button>
          </div>

          {/* Filters */}
          <Card className="sticky top-0 z-20 flex flex-wrap items-center gap-2 p-3 shadow-sm">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por razão social ou CNPJ..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            {perms.scopedToOwnUnit && perms.unidade ? (
              <Badge variant="secondary" className="h-9 px-3 text-sm">
                Unidade: {perms.unidade}
              </Badge>
            ) : (
              <Select value={unidade} onValueChange={setUnidade}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as unidades</SelectItem>
                  {unidades.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={erpFilter} onValueChange={setErpFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="ERP" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os ERPs</SelectItem>
                {erps.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Segmento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os segmentos</SelectItem>
                {segmentos.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={
                contratoAssinadoFilter === null ? ALL : contratoAssinadoFilter ? "com" : "sem"
              }
              onValueChange={(v) =>
                setContratoAssinadoFilter(v === ALL ? null : v === "com")
              }
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Contrato Assinado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Contrato assinado: todos</SelectItem>
                <SelectItem value="com">Com data de assinatura</SelectItem>
                <SelectItem value="sem">Sem data de assinatura</SelectItem>
              </SelectContent>
            </Select>
            {statusFilter && (
              <Badge className={cn("gap-1", STATUS_META[statusFilter].badge)}>
                {STATUS_META[statusFilter].label}
                <button onClick={() => setStatusFilter(null)} aria-label="Limpar status">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" /> Limpar
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={loading || filtered.length === 0}
              onClick={() => {
                const data = filtered.map((r) => {
                  const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
                  return {
                    "Razão Social": displayName(r),
                    Unidade: r.unidade || "",
                    MRR: mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0,
                    CNPJ: r.cnpj || "",
                    Estado: r.uf || "",
                    "Status Financeiro": r.status_financeiro
                      ? STATUS_META[r.status_financeiro].label
                      : "",
                    "Pipedrive ID": r.pipedrive_id || "",
                    "Fonte Cadastro": r.fonte_cadastro || "",
                    ERP: r.erp || "",
                    Segmento: r.segmento || "",
                    "Regime Tributário": info?.regime_tributario || "",
                    "Data do Ganho": fmtDate(info?.ganho_em) || "",
                    "Contrato Assinado em": fmtDate(info?.entrada_contrato_assinado_em) || "",
                    Vendedor: info?.closer || "",
                  };
                });
                exportRowsToXlsx(
                  data,
                  "clientes-planning",
                  "Planning",
                  [40, 18, 14, 20, 10, 18, 14, 18, 18, 20, 20, 16, 18, 18],
                );
              }}
            >
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel
            </Button>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">
                {loading ? "Carregando..." : `${filtered.length} cliente(s)`}
              </span>
              {!loading && (
                <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">
                  MRR total:{" "}
                  {fmtBRL(
                    filtered.reduce(
                      (s, r) => s + (mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0),
                      0,
                    ),
                  )}
                </span>
              )}
            </div>
            <div className="max-h-[calc(100vh-360px)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableRow>
                    {(
                      [
                        { key: "razao_social", label: "Razão Social", align: "left" },
                        { key: "unidade", label: "Unidade", align: "left" },
                        { key: "mrr", label: "MRR", align: "right" },
                        { key: "cnpj", label: "CNPJ", align: "left" },
                        { key: "uf", label: "Estado", align: "left" },
                        { key: "status_financeiro", label: "Status Financeiro", align: "left" },
                        { key: "pipedrive_id", label: "Pipedrive ID", align: "left" },
                        { key: "fonte_cadastro", label: "Fonte Cadastro", align: "left" },
                        { key: "erp", label: "ERP", align: "left" },
                        { key: "segmento", label: "Segmento", align: "left" },
                        { key: "regime_tributario", label: "Regime Tributário", align: "left" },
                        { key: "ganho_em", label: "Data do Ganho", align: "left" },
                        {
                          key: "entrada_contrato_assinado_em",
                          label: "Contrato Assinado em",
                          align: "left",
                        },
                        { key: "closer", label: "Vendedor", align: "left" },
                      ] as { key: SortKey; label: string; align: "left" | "right" }[]
                    ).map((col) => {
                      const active = sort?.key === col.key;
                      const Icon = !active
                        ? ArrowUpDown
                        : sort?.dir === "asc"
                          ? ArrowUp
                          : ArrowDown;
                      return (
                        <TableHead
                          key={col.key}
                          className={cn(
                            "sticky top-0 bg-card/95 backdrop-blur-sm",
                            col.align === "right" && "text-right",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
                              col.align === "right" && "ml-auto",
                              active ? "text-foreground font-semibold" : "text-muted-foreground",
                            )}
                          >
                            {col.label}
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5",
                                active ? "text-primary" : "text-muted-foreground/60",
                              )}
                            />
                          </button>
                        </TableHead>
                      );
                    })}
                    {podeMarcarChurn && (
                      <TableHead className="sticky top-0 bg-card/95 backdrop-blur-sm text-right">
                        Ações
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const meta = r.status_financeiro ? STATUS_META[r.status_financeiro] : null;
                    const churned = isChurn(r);
                    const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(
                          churned && "opacity-60",
                          podeVerContatos && "cursor-pointer hover:bg-muted/50",
                        )}
                        onClick={
                          podeVerContatos
                            ? () =>
                                setContatoCliente({
                                  id: r.id,
                                  nome: displayName(r) || "—",
                                  unidade: r.unidade,
                                })
                            : undefined
                        }
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {displayName(r) || "—"}
                            {churned && (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
                                churn
                              </Badge>
                            )}
                            {podeVerContatos && (contatosCount.get(r.id) ?? 0) > 0 && (
                              <Badge
                                variant="secondary"
                                className="gap-1 px-1.5 py-0 text-[10px] font-normal"
                                title="Contatos vinculados — clique na linha para ver"
                              >
                                <Users className="h-3 w-3" />
                                {contatosCount.get(r.id)}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.unidade ? <Badge variant="secondary">{r.unidade}</Badge> : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {(() => {
                            const v = mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0;
                            return v > 0 ? (
                              fmtBRL(v)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.cnpj || "—"}</TableCell>
                        <TableCell>{r.uf || "—"}</TableCell>

                        <TableCell>
                          {meta ? <Badge className={meta.badge}>{meta.label}</Badge> : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.pipedrive_id ? (
                            <a
                              href={`https://app.pipedrive.com/deal/${r.pipedrive_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {r.pipedrive_id}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{r.fonte_cadastro || "—"}</TableCell>
                        <TableCell>{r.erp || "—"}</TableCell>
                        <TableCell>{r.segmento || "—"}</TableCell>
                        <TableCell>{info?.regime_tributario || "—"}</TableCell>
                        <TableCell>{fmtDate(info?.ganho_em) || "—"}</TableCell>
                        <TableCell>{fmtDate(info?.entrada_contrato_assinado_em) || "—"}</TableCell>
                        <TableCell>{info?.closer || "—"}</TableCell>
                        {podeMarcarChurn && (
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {perms.isAdmin && (
                                <EditarClienteButton r={r} onSave={salvarEdicaoCliente} />
                              )}
                              <MarcarChurnClienteButton
                                r={r}
                                churned={churned}
                                onConfirm={marcarChurnDoCliente}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={podeMarcarChurn ? 15 : 14}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Nenhum cliente encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {q.trim().length >= 3 && (omieLoading || omieMatches.length > 0) && (
            <Card className="border-amber-300 dark:border-amber-800">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <TriangleAlert className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium">
                  {omieLoading
                    ? "Buscando na Omie..."
                    : `${omieMatches.length} resultado(s) na Omie, não reconciliado(s) na Base Nova`}
                </span>
              </div>
              {!omieLoading && (
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Razão Social</TableHead>
                        <TableHead>Unidade (Omie)</TableHead>
                        <TableHead>CNPJ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {omieMatches.map((m) => (
                        <TableRow key={m.cnpj}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {m.razao_social || "—"}
                              <Badge
                                variant="outline"
                                className="border-amber-400 text-amber-700 dark:text-amber-300 text-[10px] px-1.5 py-0"
                              >
                                não reconciliado
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {m.unidade ? <Badge variant="secondary">{m.unidade}</Badge> : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{m.cnpj}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
                Encontrado no cadastro de clientes da Omie (ERP), mas sem vínculo com deal/contrato
                em `empresas`. Não conta nos cards, na contagem ou no MRR total acima — reconciliar
                manualmente se for um cliente ativo.
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pre-planning">
          <PrePlanningTab />
        </TabsContent>
      </Tabs>

      <ContatosClienteDialog
        cliente={contatoCliente}
        onOpenChange={(open) => {
          if (!open) setContatoCliente(null);
        }}
      />
    </div>
  );
}

function EditarClienteButton({
  r,
  onSave,
}: {
  r: Cliente;
  onSave: (r: Cliente, patch: { razao_social?: string; cnpj?: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [nome, setNome] = useState(displayName(r));
  const [cnpj, setCnpj] = useState(r.cnpj ?? "");

  const cnpjDigits = cnpj.replace(/\D/g, "");
  const nomeValido = nome.trim().length > 0;
  const cnpjValido = cnpjDigits.length === 0 || cnpjDigits.length === 14;
  const nomeMudou = nome.trim() !== (r.razao_social ?? "").trim();
  const cnpjMudou = cnpjDigits !== (r.cnpj ?? "").replace(/\D/g, "") && cnpjDigits.length === 14;

  const submit = async () => {
    if (!nomeValido) {
      toast.error("Razão social não pode ficar em branco.");
      return;
    }
    if (!cnpjValido) {
      toast.error("CNPJ precisa ter 14 dígitos.");
      return;
    }
    if (!nomeMudou && !cnpjMudou) {
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      const patch: { razao_social?: string; cnpj?: string } = {};
      if (nomeMudou) patch.razao_social = nome.trim();
      if (cnpjMudou) patch.cnpj = cnpjDigits;
      await onSave(r, patch);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar cliente");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setNome(displayName(r));
          setCnpj(r.cnpj ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Editar cliente"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente — {displayName(r)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Razão social</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label>CNPJ</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Este registro vem do sync automático (Pipedrive/Omie) — se o mesmo cliente for
            resincronizado, o valor pode ser sobrescrito novamente.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !nomeValido || !cnpjValido}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarcarChurnClienteButton({
  r,
  churned,
  onConfirm,
}: {
  r: Cliente;
  churned: boolean;
  onConfirm: (
    r: Cliente,
    motivo: string,
    observacao: string,
    dataChurn: string,
  ) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [motivo, setMotivo] = useState<MotivoChurn | "">("");
  const [observacao, setObservacao] = useState("");
  const [dataChurn, setDataChurn] = useState(() => new Date().toISOString().slice(0, 10));

  if (churned) return null;
  if (!r.pipedrive_id) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className="h-7 w-7 text-muted-foreground"
        title="Sem Pipedrive ID — não é possível vincular o churn"
      >
        <UserX className="h-3.5 w-3.5" />
      </Button>
    );
  }

  const submit = async () => {
    if (!motivo) {
      toast.error("Selecione o motivo do churn.");
      return;
    }
    setPending(true);
    try {
      await onConfirm(r, motivo, observacao.trim(), dataChurn);
      setOpen(false);
      setMotivo("");
      setObservacao("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar churn");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400"
          title="Marcar churn"
        >
          <UserX className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar churn — {displayName(r)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Data do churn</Label>
            <Input type="date" value={dataChurn} onChange={(e) => setDataChurn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoChurn)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_CHURN.map((opcao) => (
                  <SelectItem key={opcao} value={opcao}>
                    {opcao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Observação</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Detalhes adicionais (opcional)"
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Isso cria um card no pipe Tratativas do Pipefy já na fase "Perdido". Pode levar até
            15min pra refletir aqui depois do sync. Não é possível desfazer por aqui.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Confirmar churn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
