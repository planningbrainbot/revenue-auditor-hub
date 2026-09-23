import { useEffect, useMemo, useState } from "react";
import { Wallet, Search, X, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { supabase } from "@/integrations/supabase/client";
import { brl, date, num } from "@/components/audit/format";

const ALL = "__all__";

interface ContaReceber {
  id: number;
  num_documento: string | null;
  data_vencimento: string | null;
  data_competencia: string | null;
  data_pagamento: string | null;
  status_pagamento: string | null;
  valor: number | null;
  cliente: string | null;
  cpf_cnpj: string | null;
}

function statusBadge(s: string | null) {
  if (s === "RECEBIDO")
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200">Recebido</Badge>;
  if (s === "ATRASADO")
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-200">Atrasado</Badge>;
  if (s === "A VENCER" || s === "VENCE HOJE")
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200">A vencer</Badge>;
  return <Badge variant="outline">{s ?? "—"}</Badge>;
}

function diasAtraso(venc: string | null): number | null {
  if (!venc) return null;
  const d = new Date(venc);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function parseDate(d: string | null): Date | null {
  if (!d) return null;
  try {
    const dt = parseISO(d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

export function ContasReceberView() {
  const [rows, setRows] = useState<ContaReceber[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [dataIni, setDataIni] = useState<Date | undefined>(undefined);
  const [dataFim, setDataFim] = useState<Date | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const pageSize = 1000;
      const { count } = await supabase
        .from("contas_receber")
        .select("id", { count: "exact", head: true })
        .eq("unidade", "Partners");
      const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
      const pages = await Promise.all(
        Array.from({ length: totalPages }, (_, i) =>
          supabase
            .from("contas_receber")
            .select(
              "id,num_documento,data_vencimento,data_competencia,data_pagamento,status_pagamento,valor,cliente,cpf_cnpj",
            )
            .eq("unidade", "Partners")
            .order("data_vencimento", { ascending: false })
            .range(i * pageSize, i * pageSize + pageSize - 1),
        ),
      );
      if (!mounted) return;
      const all: ContaReceber[] = [];
      for (const { data } of pages) all.push(...((data ?? []) as ContaReceber[]));
      setRows(all);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const ini = dataIni ? new Date(dataIni.getFullYear(), dataIni.getMonth(), dataIni.getDate()).getTime() : null;
    const fim = dataFim ? new Date(dataFim.getFullYear(), dataFim.getMonth(), dataFim.getDate(), 23, 59, 59, 999).getTime() : null;
    return rows.filter((r) => {
      if (status === "NAO_RECEBIDO") {
        if (r.status_pagamento === "RECEBIDO" || r.status_pagamento === "CANCELADO") return false;
      } else if (status !== ALL && r.status_pagamento !== status) return false;
      if (ini !== null || fim !== null) {
        const d = parseDate(r.data_competencia) ?? parseDate(r.data_vencimento);
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
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, status, dataIni, dataFim]);

  const kpis = useMemo(() => {
    let aVencer = 0;
    let atrasado = 0;
    let atrasadoQtd = 0;
    let recebido = 0;
    let total = 0;
    for (const r of filtered) {
      const v = Number(r.valor ?? 0);
      total += v;
      if (r.status_pagamento === "A VENCER" || r.status_pagamento === "VENCE HOJE") aVencer += v;
      else if (r.status_pagamento === "ATRASADO") {
        atrasado += v;
        atrasadoQtd += 1;
      } else if (r.status_pagamento === "RECEBIDO") recebido += v;
    }
    const ticket = filtered.length ? total / filtered.length : 0;
    return { aVencer, atrasado, atrasadoQtd, recebido, ticket };
  }, [filtered]);

  const hasFilters = q !== "" || status !== ALL || dataIni !== undefined || dataFim !== undefined;
  const clearFilters = () => {
    setQ("");
    setStatus(ALL);
    setDataIni(undefined);
    setDataFim(undefined);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Wallet className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contas a Receber — Partners</h1>
          <p className="text-sm text-muted-foreground">
            Faturas emitidas pela conta Omie da Partners (Matriz) — origem: Omie.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Recebido (filtro)" value={brl(kpis.recebido)} tone="emerald" />
        <KpiCard label="A vencer" value={brl(kpis.aVencer)} tone="amber" />
        <KpiCard
          label="Em atraso"
          value={brl(kpis.atrasado)}
          hint={`${num(kpis.atrasadoQtd)} fatura(s)`}
          tone="red"
        />
        <KpiCard label="Ticket médio" value={brl(kpis.ticket)} tone="slate" />
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, CNPJ ou documento..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            <SelectItem value="A VENCER">A vencer</SelectItem>
            <SelectItem value="ATRASADO">Atrasado</SelectItem>
            <SelectItem value="RECEBIDO">Recebido</SelectItem>
            <SelectItem value="NAO_RECEBIDO">Não recebido (a vencer + atrasado)</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[160px] justify-start text-left font-normal",
                !dataIni && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dataIni ? format(dataIni, "dd/MM/yyyy") : "Data inicial"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dataIni}
              onSelect={setDataIni}
              initialFocus
              locale={ptBR}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[160px] justify-start text-left font-normal",
                !dataFim && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dataFim ? format(dataFim, "dd/MM/yyyy") : "Data final"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dataFim}
              onSelect={setDataFim}
              initialFocus
              locale={ptBR}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" /> Limpar
          </Button>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">
            {loading ? "Carregando..." : `${num(filtered.length)} fatura(s)`}
          </span>
        </div>
        <div className="relative max-h-[calc(100vh-380px)] overflow-auto">
          <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
              <TableRow>
                <TableHead className="bg-card">Status</TableHead>
                <TableHead className="bg-card">Documento</TableHead>
                <TableHead className="bg-card">Cliente</TableHead>
                <TableHead className="bg-card">Competência</TableHead>
                <TableHead className="bg-card">Vencimento</TableHead>
                <TableHead className="bg-card">Pagamento</TableHead>
                <TableHead className="bg-card text-right">Valor</TableHead>
                <TableHead className="bg-card text-right">Atraso (dias)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const atraso = r.status_pagamento === "ATRASADO" ? diasAtraso(r.data_vencimento) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{statusBadge(r.status_pagamento)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.num_documento || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.cliente || "—"}</div>
                      {r.cpf_cnpj && <div className="text-xs text-muted-foreground font-mono">{r.cpf_cnpj}</div>}
                    </TableCell>
                    <TableCell>{date(r.data_competencia)}</TableCell>
                    <TableCell>{date(r.data_vencimento)}</TableCell>
                    <TableCell>{date(r.data_pagamento)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{brl(Number(r.valor ?? 0))}</TableCell>
                    <TableCell className="text-right">
                      {atraso != null ? (
                        <span className="text-red-700 dark:text-red-300 font-medium">{atraso}</span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
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

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
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
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
