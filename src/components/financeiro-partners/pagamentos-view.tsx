import { useEffect, useMemo, useState, type ComponentType } from "react";
import { CheckCircle2, CircleDollarSign, Clock, AlertTriangle, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { brl, date, num } from "@/components/audit/format";

const ALL = "__all__";

type StatusValidado = "pendente" | "confirmado_pago" | "confirmado_pendente";
type CategoriaKey = "royalties" | "csc_fixo" | "csc_base_antiga" | "cac_trafego" | "outras";

// Categorias correspondentes no plano de contas do Omie (conferido direto na
// API ListarCategorias em 17/07/2026 — a tabela categorias_omie do banco
// estava desatualizada e não tinha todas). "royalties" cobre tanto a fatura
// normal quanto os casos de base nova/não recorrente; cac e tráfego pago saem
// juntos no Omie sob uma única categoria (1.03.96), então são somados aqui.
const CATEGORIA_OMIE_CODES: Record<CategoriaKey, string[]> = {
  royalties: ["1.01.95", "1.04.95", "1.01.93"],
  csc_fixo: ["1.01.96"],
  csc_base_antiga: ["1.04.06"],
  cac_trafego: ["1.03.96"],
  outras: ["1.01.94"],
};

const CATEGORIA_LABEL: Record<CategoriaKey, string> = {
  royalties: "Royalties",
  csc_fixo: "CSC Expansão",
  csc_base_antiga: "Royalties base antiga (CSC)",
  cac_trafego: "CAC + Tráfego pago",
  outras: "Outras receitas",
};

const STATUS_LABEL: Record<StatusValidado, string> = {
  pendente: "Não conferido",
  confirmado_pago: "Confirmado — pago",
  confirmado_pendente: "Confirmado — pendente",
};

interface ApuracaoRow {
  id: number;
  unidade_id: number;
  mes_referencia: string;
  status: string;
  royalties_valor: number | null;
  csc_valor_fixo: number | null;
  csc_base_antiga_valor: number | null;
  cac_valor: number | null;
  csc_trafego_pago: number | null;
  outras_receitas: number | null;
  total_fatura: number | null;
  unidade: { nome_da_praca: string; razao_social: string | null } | null;
}

interface PagamentoRow {
  id: number;
  apuracao_id: number;
  categoria: CategoriaKey;
  status_validado: StatusValidado;
  validado_em: string | null;
  validado_por: string | null;
  observacao_validacao: string | null;
}

interface PfRow {
  razao_social: string | null;
  unidade: string | null;
  codigo_categoria: string | null;
  data_emissao: string | null;
  data_vencimento: string | null;
  valor_documento: number | null;
  status_titulo: string | null;
}

interface Linha {
  key: string;
  apuracaoId: number;
  unidade: string;
  mesReferencia: string;
  categoria: CategoriaKey;
  valor: number;
  pagamento: PagamentoRow | null;
  omieValor: number;
  omieStatus: "RECEBIDO" | "PARCIAL" | "ATRASADO" | "A VENCER" | null;
}

async function fetchApuracoesFechadas(): Promise<ApuracaoRow[]> {
  const { data, error } = await supabase
    .from("royalties_apuracao")
    .select(
      "id,unidade_id,mes_referencia,status,royalties_valor,csc_valor_fixo,csc_base_antiga_valor,cac_valor,csc_trafego_pago,outras_receitas,total_fatura,unidade:unidades(nome_da_praca,razao_social)",
    )
    .in("status", ["confirmado", "faturado"])
    .order("mes_referencia", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ApuracaoRow[];
}

async function fetchPagamentos(apuracaoIds: number[]): Promise<PagamentoRow[]> {
  if (apuracaoIds.length === 0) return [];
  const { data, error } = await supabase
    .from("royalties_apuracao_pagamentos")
    .select("id,apuracao_id,categoria,status_validado,validado_em,validado_por,observacao_validacao")
    .in("apuracao_id", apuracaoIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PagamentoRow[];
}

async function fetchPartnersFinanceiro(): Promise<PfRow[]> {
  const all: PfRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("partners_financeiro")
      .select("razao_social,unidade,codigo_categoria,data_emissao,data_vencimento,valor_documento,status_titulo")
      .eq("tipo", "RECEBER")
      .neq("status_titulo", "CANCELADO")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PfRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Comprovado empiricamente (RJ, junho/2026): a apuração fechada no mês M vira
// título no Omie com vencimento em M+1.
function mesSeguinte(mesReferencia: string): string {
  const [y, m] = mesReferencia.slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) + 1;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function normalizeNome(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function omieAgregado(rows: PfRow[]): { valor: number; status: Linha["omieStatus"] } {
  if (rows.length === 0) return { valor: 0, status: null };
  const valor = rows.reduce((acc, r) => acc + Number(r.valor_documento ?? 0), 0);
  const recebidoValor = rows
    .filter((r) => (r.status_titulo ?? "").toUpperCase() === "RECEBIDO")
    .reduce((acc, r) => acc + Number(r.valor_documento ?? 0), 0);
  let status: Linha["omieStatus"];
  if (recebidoValor >= valor - 0.01) status = "RECEBIDO";
  else if (recebidoValor > 0.01) status = "PARCIAL";
  else if (rows.some((r) => (r.status_titulo ?? "").toUpperCase() === "ATRASADO")) status = "ATRASADO";
  else status = "A VENCER";
  return { valor, status };
}

function omieStatusBadge(s: Linha["omieStatus"]) {
  if (s === "RECEBIDO")
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200">Recebido</Badge>;
  if (s === "PARCIAL")
    return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-200">Parcial</Badge>;
  if (s === "ATRASADO")
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-200">Atrasado</Badge>;
  if (s === "A VENCER")
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200">A vencer</Badge>;
  return <Badge variant="outline">Sem referência</Badge>;
}

function hasDivergencia(l: Linha): boolean {
  const statusValidado = l.pagamento?.status_validado ?? "pendente";
  if (statusValidado === "confirmado_pago") return l.omieStatus !== "RECEBIDO";
  if (statusValidado === "confirmado_pendente") return l.omieStatus === "RECEBIDO";
  return false;
}

function fmtMes(mesReferencia: string): string {
  const [y, m] = mesReferencia.slice(0, 7).split("-");
  return `${m}/${y}`;
}

export function PagamentosView() {
  const [apuracoes, setApuracoes] = useState<ApuracaoRow[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoRow[]>([]);
  const [pfRows, setPfRows] = useState<PfRow[]>([]);
  const [unidadeRazaoMap, setUnidadeRazaoMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [unidadeFilter, setUnidadeFilter] = useState(ALL);
  const [mesFilter, setMesFilter] = useState(ALL);
  const [categoriaFilter, setCategoriaFilter] = useState<CategoriaKey | typeof ALL>(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusValidado | typeof ALL>(ALL);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    (async () => {
      const apur = await fetchApuracoesFechadas();
      const [pag, pf, unidadesRows, unidadeMapRows] = await Promise.all([
        fetchPagamentos(apur.map((a) => a.id)),
        fetchPartnersFinanceiro(),
        supabase.from("unidades").select("nome_da_praca,razao_social").then(({ data }) => data ?? []),
        supabase.from("partners_financeiro_unidade_map").select("razao_social,unidade").then(({ data }) => data ?? []),
      ]);
      const razaoMap = new Map<string, string>();
      for (const u of unidadesRows as any[]) {
        for (const rs of String(u.razao_social ?? "").split("\n")) {
          if (rs.trim()) razaoMap.set(normalizeNome(rs), u.nome_da_praca);
        }
      }
      for (const m of unidadeMapRows as any[]) {
        razaoMap.set(normalizeNome(m.razao_social), m.unidade);
      }
      setApuracoes(apur);
      setPagamentos(pag);
      setPfRows(pf);
      setUnidadeRazaoMap(razaoMap);
    })()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resolveUnidade = (pf: PfRow) => {
    if (pf.unidade && pf.unidade !== "Partners") return pf.unidade;
    return unidadeRazaoMap.get(normalizeNome(pf.razao_social)) ?? pf.razao_social ?? pf.unidade ?? "—";
  };

  const linhas = useMemo(() => {
    const pagMap = new Map<string, PagamentoRow>();
    for (const p of pagamentos) pagMap.set(`${p.apuracao_id}|${p.categoria}`, p);

    const pfByUnidade = new Map<string, PfRow[]>();
    for (const pf of pfRows) {
      const u = resolveUnidade(pf);
      if (!pfByUnidade.has(u)) pfByUnidade.set(u, []);
      pfByUnidade.get(u)!.push(pf);
    }

    const out: Linha[] = [];
    for (const a of apuracoes) {
      const unidadeNome = a.unidade?.nome_da_praca ?? "—";
      const targetMes = mesSeguinte(a.mes_referencia);
      // royalties_apuracao usa colunas `numeric` — o PostgREST serializa como
      // string pra não perder precisão, então todo valor precisa passar por
      // Number(...) antes de qualquer soma (senão `total += valor` vira
      // concatenação de string em vez de adição).
      const toNum = (v: number | string | null) => (v == null ? null : Number(v));
      const candidatos: { categoria: CategoriaKey; valor: number | null }[] = [
        { categoria: "royalties", valor: toNum(a.royalties_valor) },
        { categoria: "csc_fixo", valor: toNum(a.csc_valor_fixo) },
        { categoria: "csc_base_antiga", valor: toNum(a.csc_base_antiga_valor) },
        {
          categoria: "cac_trafego",
          valor:
            a.cac_valor == null && a.csc_trafego_pago == null
              ? null
              : Number(a.cac_valor ?? 0) + Number(a.csc_trafego_pago ?? 0),
        },
        { categoria: "outras", valor: toNum(a.outras_receitas) },
      ];

      const pfUnidade = pfByUnidade.get(unidadeNome) ?? [];

      for (const c of candidatos) {
        if (c.valor == null || Math.abs(c.valor) < 0.005) continue;
        const codes = CATEGORIA_OMIE_CODES[c.categoria];
        const matches = pfUnidade.filter((pf) => {
          if (!pf.codigo_categoria || !codes.includes(pf.codigo_categoria)) return false;
          const mes = (pf.data_vencimento ?? pf.data_emissao ?? "").slice(0, 7);
          return mes === targetMes;
        });
        const { valor: omieValor, status: omieStatus } = omieAgregado(matches);
        out.push({
          key: `${a.id}|${c.categoria}`,
          apuracaoId: a.id,
          unidade: unidadeNome,
          mesReferencia: a.mes_referencia,
          categoria: c.categoria,
          valor: c.valor,
          pagamento: pagMap.get(`${a.id}|${c.categoria}`) ?? null,
          omieValor,
          omieStatus,
        });
      }
    }
    return out.sort((a, b) => b.mesReferencia.localeCompare(a.mesReferencia) || a.unidade.localeCompare(b.unidade));
  }, [apuracoes, pagamentos, pfRows, unidadeRazaoMap]);

  const unidadeOpcoes = useMemo(
    () => Array.from(new Set(apuracoes.map((a) => a.unidade?.nome_da_praca ?? "—"))).sort(),
    [apuracoes],
  );

  const mesOpcoes = useMemo(
    () => Array.from(new Set(apuracoes.map((a) => a.mes_referencia))).sort().reverse(),
    [apuracoes],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return linhas.filter((l) => {
      if (unidadeFilter !== ALL && l.unidade !== unidadeFilter) return false;
      if (mesFilter !== ALL && l.mesReferencia !== mesFilter) return false;
      if (categoriaFilter !== ALL && l.categoria !== categoriaFilter) return false;
      const statusValidado = l.pagamento?.status_validado ?? "pendente";
      if (statusFilter !== ALL && statusValidado !== statusFilter) return false;
      if (term) {
        const hay = [l.unidade, CATEGORIA_LABEL[l.categoria], l.pagamento?.observacao_validacao]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [linhas, q, unidadeFilter, mesFilter, categoriaFilter, statusFilter]);

  const kpis = useMemo(() => {
    let total = 0;
    let recebido = 0;
    let pendente = 0;
    let naoConferido = 0;
    let divergencias = 0;
    for (const l of filtered) {
      const statusValidado = l.pagamento?.status_validado ?? "pendente";
      total += l.valor;
      if (statusValidado === "confirmado_pago") recebido += l.valor;
      else pendente += l.valor;
      if (statusValidado === "pendente") naoConferido += l.valor;
      if (hasDivergencia(l)) divergencias += 1;
    }
    return { total, recebido, pendente, naoConferido, divergencias };
  }, [filtered]);

  const updateLinha = async (l: Linha, patch: Partial<Pick<PagamentoRow, "status_validado" | "observacao_validacao">>) => {
    setSavingKey(l.key);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      apuracao_id: l.apuracaoId,
      categoria: l.categoria,
      status_validado: l.pagamento?.status_validado ?? "pendente",
      observacao_validacao: l.pagamento?.observacao_validacao ?? null,
      ...patch,
      validado_em: new Date().toISOString(),
      validado_por: user?.email ?? null,
    };
    const { data, error: updErr } = await supabase
      .from("royalties_apuracao_pagamentos")
      .upsert(payload, { onConflict: "apuracao_id,categoria" })
      .select("id,apuracao_id,categoria,status_validado,validado_em,validado_por,observacao_validacao")
      .single();
    if (updErr) {
      setError(updErr.message);
    } else if (data) {
      setPagamentos((prev) => {
        const next = prev.filter((p) => !(p.apuracao_id === l.apuracaoId && p.categoria === l.categoria));
        next.push(data as unknown as PagamentoRow);
        return next;
      });
    }
    setSavingKey(null);
  };

  const hasFilters = q !== "" || unidadeFilter !== ALL || mesFilter !== ALL || categoriaFilter !== ALL || statusFilter !== ALL;
  const clearFilters = () => {
    setQ("");
    setUnidadeFilter(ALL);
    setMesFilter(ALL);
    setCategoriaFilter(ALL);
    setStatusFilter(ALL);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <CircleDollarSign className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recebimentos das Unidades</h1>
          <p className="text-sm text-muted-foreground">
            Faturas das apurações de royalties fechadas (confirmadas) — status do Omie como referência + validação manual contra o extrato bancário.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard icon={CircleDollarSign} label="Total a Receber" value={brl(kpis.total)} tone="slate" />
        <KpiCard icon={CheckCircle2} label="Recebido (validado)" value={brl(kpis.recebido)} tone="emerald" />
        <KpiCard icon={Clock} label="Pendente (validado)" value={brl(kpis.pendente)} tone="amber" />
        <KpiCard
          icon={AlertTriangle}
          label="Não conferido / divergências"
          value={brl(kpis.naoConferido)}
          hint={kpis.divergencias > 0 ? `${num(kpis.divergencias)} divergência(s) Omie x validação` : undefined}
          tone={kpis.divergencias > 0 ? "red" : "slate"}
        />
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar unidade, categoria ou observação..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={mesFilter} onValueChange={setMesFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Mês" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os meses</SelectItem>
            {mesOpcoes.map((m) => (
              <SelectItem key={m} value={m}>{fmtMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {unidadeOpcoes.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoriaFilter} onValueChange={(v) => setCategoriaFilter(v as CategoriaKey | typeof ALL)}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {(Object.keys(CATEGORIA_LABEL) as CategoriaKey[]).map((c) => (
              <SelectItem key={c} value={c}>{CATEGORIA_LABEL[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusValidado | typeof ALL)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status validado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            <SelectItem value="pendente">Não conferido</SelectItem>
            <SelectItem value="confirmado_pago">Confirmado — pago</SelectItem>
            <SelectItem value="confirmado_pendente">Confirmado — pendente</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" /> Limpar
          </Button>
        )}
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50 text-sm text-red-700">{error}</Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">
            {loading ? "Carregando..." : `${num(filtered.length)} fatura(s)`}
          </span>
        </div>
        <div className="relative max-h-[calc(100vh-420px)] overflow-auto">
          <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
              <TableRow>
                <TableHead className="bg-card">Mês</TableHead>
                <TableHead className="bg-card">Unidade</TableHead>
                <TableHead className="bg-card">Categoria</TableHead>
                <TableHead className="bg-card text-right">Valor (apuração)</TableHead>
                <TableHead className="bg-card">Omie</TableHead>
                <TableHead className="bg-card">Validação manual</TableHead>
                <TableHead className="bg-card">Obs.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => {
                const divergente = hasDivergencia(l);
                const statusValidado = l.pagamento?.status_validado ?? "pendente";
                return (
                  <TableRow key={l.key} className={divergente ? "bg-red-50/50 dark:bg-red-950/10" : undefined}>
                    <TableCell className="whitespace-nowrap">{fmtMes(l.mesReferencia)}</TableCell>
                    <TableCell className="font-medium">{l.unidade}</TableCell>
                    <TableCell>{CATEGORIA_LABEL[l.categoria]}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium">{brl(l.valor)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {omieStatusBadge(l.omieStatus)}
                        {divergente && <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
                      </div>
                      {l.omieStatus && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{brl(l.omieValor)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={statusValidado}
                        onValueChange={(v) => updateLinha(l, { status_validado: v as StatusValidado })}
                        disabled={savingKey === l.key}
                      >
                        <SelectTrigger className="w-[190px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pendente">{STATUS_LABEL.pendente}</SelectItem>
                          <SelectItem value="confirmado_pago">{STATUS_LABEL.confirmado_pago}</SelectItem>
                          <SelectItem value="confirmado_pendente">{STATUS_LABEL.confirmado_pendente}</SelectItem>
                        </SelectContent>
                      </Select>
                      {l.pagamento?.validado_em && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {date(l.pagamento.validado_em)} {l.pagamento.validado_por ? `· ${l.pagamento.validado_por}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ObservacaoCell
                        value={l.pagamento?.observacao_validacao ?? null}
                        onSave={(obs) => updateLinha(l, { observacao_validacao: obs })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma fatura encontrada.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ObservacaoCell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <Popover onOpenChange={(open) => !open && draft !== (value ?? "") && onSave(draft)}>
      <PopoverTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground underline decoration-dotted max-w-[160px] truncate text-left">
          {value ? value : "adicionar nota"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ex: conferido no extrato do dia 15/07, caiu na conta X"
          rows={3}
        />
      </PopoverContent>
    </Popover>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone: "amber" | "red" | "emerald" | "slate";
}) {
  const toneMap = {
    amber: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    red: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
    emerald: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
    slate: "border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
  } as const;
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneMap[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
