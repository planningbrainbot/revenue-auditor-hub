import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Wallet, Search, X, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
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
import { brl, date, num } from "@/components/audit/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataProvider, BaseFilterSelect, RefreshButton } from "@/components/audit/data-context";
import { OmieLastSync } from "@/components/omie-last-sync";
import { SafraFatoFilter } from "@/components/safra-fato-filter";
import { useSafraFato } from "@/hooks/use-safra-fato";
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

const ALL = "__all__";

export const Route = createFileRoute("/_authenticated/contas-receber")({
  validateSearch: (search: Record<string, unknown>) => ({
    unidade: typeof search.unidade === "string" ? search.unidade : "",
    status: typeof search.status === "string" ? search.status : "",
    dataIni: typeof search.dataIni === "string" ? search.dataIni : "",
    dataFim: typeof search.dataFim === "string" ? search.dataFim : "",
    dataTipo: typeof search.dataTipo === "string" ? search.dataTipo : "",
  }),
  component: ContasReceberPage,
});

type StatusKey = "RECEBIDO" | "ATRASADO" | "A VENCER";

type DataTipo = "competencia" | "vencimento" | "pagamento";

const DATA_TIPO_FIELD: Record<DataTipo, "data_competencia" | "data_vencimento" | "data_pagamento"> = {
  competencia: "data_competencia",
  vencimento: "data_vencimento",
  pagamento: "data_pagamento",
};

const DATA_TIPO_LABEL: Record<DataTipo, string> = {
  competencia: "Competência",
  vencimento: "Vencimento",
  pagamento: "Pagamento",
};

function statusBadge(s: string | null) {
  if (s === "RECEBIDO")
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200">Recebido</Badge>;
  if (s === "ATRASADO")
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-200">Atrasado</Badge>;
  if (s === "A VENCER")
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

function parseSearchDate(s: string): Date | undefined {
  if (!s) return undefined;
  const d = parseISO(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function ContasReceberPage() {
  const search = Route.useSearch();
  const { data, isLoading } = useContasReceber();
  const perms = usePermissions();
  const allRows = data?.rows ?? [];
  // Sócio franqueado só enxerga a própria unidade. Recorta na origem para que
  // KPIs, resumo, faturas e gráficos herdem o escopo.
  const rows = useMemo(
    () =>
      perms.scopedToOwnUnit && perms.unidade
        ? allRows.filter((r) => unitMatches(perms.unidade, r.unidade))
        : allRows,
    [allRows, perms.scopedToOwnUnit, perms.unidade],
  );
  const escopoUnidade = perms.scopedToOwnUnit && !!perms.unidade;

  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(search.unidade || ALL);
  const [status, setStatus] = useState(search.status || ALL);
  const [dataIni, setDataIni] = useState<Date | undefined>(parseSearchDate(search.dataIni));
  const [dataFim, setDataFim] = useState<Date | undefined>(parseSearchDate(search.dataFim));
  const [dataTipo, setDataTipo] = useState<DataTipo>(
    (search.dataTipo as DataTipo) || "competencia",
  );
  const [defaultTab] = useState(search.unidade || search.status || search.dataIni ? "faturas" : "resumo");
  const sf = useSafraFato();
  const [usarSafraFato, setUsarSafraFato] = useState(false);

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const ini = dataIni ? new Date(dataIni.getFullYear(), dataIni.getMonth(), dataIni.getDate()).getTime() : null;
    const fim = dataFim ? new Date(dataFim.getFullYear(), dataFim.getMonth(), dataFim.getDate(), 23, 59, 59, 999).getTime() : null;
    const sfIni = usarSafraFato ? sf.range.start.getTime() : null;
    const sfFim = usarSafraFato ? sf.range.end.getTime() - 1 : null;
    return rows.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (status === "NAO_RECEBIDO") {
        if (r.status_pagamento === "RECEBIDO" || r.status_pagamento === "CANCELADO") return false;
      } else if (status !== ALL && r.status_pagamento !== status) return false;
      if (usarSafraFato) {
        // Safra: data_competencia. Fato: data_pagamento ?? data_vencimento.
        const d =
          sf.mode === "safra"
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
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, unidade, status, dataIni, dataFim, dataTipo, usarSafraFato, sf.mode, sf.range]);

  const kpis = useMemo(() => {
    let aVencer = 0;
    let atrasado = 0;
    let atrasadoQtd = 0;
    let recebido = 0;
    let total = 0;
    for (const r of filtered) {
      const v = Number(r.valor ?? 0);
      total += v;
      if (r.status_pagamento === "A VENCER") aVencer += v;
      else if (r.status_pagamento === "ATRASADO") {
        atrasado += v;
        atrasadoQtd += 1;
      } else if (r.status_pagamento === "RECEBIDO") recebido += v;
    }
    const ticket = filtered.length ? total / filtered.length : 0;
    return { aVencer, atrasado, atrasadoQtd, recebido, ticket };
  }, [filtered]);

  const porUnidade = useMemo(() => {
    const map = new Map<
      string,
      { qtd: number; total: number; atrasado: number; recebido: number; aVencer: number }
    >();
    for (const r of filtered) {
      const u = r.unidade ?? "—";
      const cur =
        map.get(u) ?? { qtd: 0, total: 0, atrasado: 0, recebido: 0, aVencer: 0 };
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
    const map = new Map<string, { mes: string; recebido: number; aVencer: number; atrasado: number }>();
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
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  const topAtrasados = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (r.status_pagamento !== "ATRASADO") continue;
      const k = r.cliente ?? "—";
      map.set(k, (map.get(k) ?? 0) + Number(r.valor ?? 0));
    }
    return Array.from(map.entries())
      .map(([cliente, valor]) => ({ cliente, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }, [filtered]);

  const hasFilters =
    q !== "" || unidade !== ALL || status !== ALL || dataIni !== undefined || dataFim !== undefined;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setStatus(ALL);
    setDataIni(undefined);
    setDataFim(undefined);
    setDataTipo("competencia");
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contas a Receber</h1>
            <p className="text-sm text-muted-foreground">
              Faturas emitidas pelas unidades — origem: Omie.
            </p>
          </div>
        </div>
        <OmieLastSync className="pt-1" />
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
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Checkbox
            checked={usarSafraFato}
            onCheckedChange={(c) => setUsarSafraFato(Boolean(c))}
          />
          Filtrar por mês
        </label>
        {usarSafraFato && (
          <SafraFatoFilter
            mode={sf.mode}
            mes={sf.mes}
            onModeChange={sf.setMode}
            onMesChange={sf.setMes}
          />
        )}
        <div className="h-6 w-px bg-border" />

        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, CNPJ ou documento..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        {escopoUnidade ? (
          <Badge variant="secondary" className="h-9 px-3">{perms.unidade}</Badge>
        ) : (
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as unidades</SelectItem>
              {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
        <Select value={dataTipo} onValueChange={(v) => setDataTipo(v as DataTipo)}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tipo de data" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(DATA_TIPO_LABEL) as DataTipo[]).map((k) => (
              <SelectItem key={k} value={k}>{DATA_TIPO_LABEL[k]}</SelectItem>
            ))}
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
              {dataIni ? format(dataIni, "dd/MM/yyyy") : `${DATA_TIPO_LABEL[dataTipo]} de`}
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
              {dataFim ? format(dataFim, "dd/MM/yyyy") : `${DATA_TIPO_LABEL[dataTipo]} até`}
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

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo por unidade</TabsTrigger>
          <TabsTrigger value="faturas">
            Faturas {isLoading ? "" : `(${num(filtered.length)})`}
          </TabsTrigger>
          <TabsTrigger value="mensalidades">Mensalidades</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b px-4 py-3 text-sm font-medium">Resumo por unidade</div>
            <div className="overflow-auto">
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
                      <TableCell><Badge variant="secondary">{u.unidade}</Badge></TableCell>
                      <TableCell className="text-right">{num(u.qtd)}</TableCell>
                      <TableCell className="text-right">{brl(u.total)}</TableCell>
                      <TableCell className="text-right">{brl(u.aVencer)}</TableCell>
                      <TableCell className="text-right text-red-700 dark:text-red-300">{brl(u.atrasado)}</TableCell>
                      <TableCell className="text-right text-emerald-700 dark:text-emerald-300">{brl(u.recebido)}</TableCell>
                    </TableRow>
                  ))}
                  {porUnidade.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                        Sem dados para o filtro atual.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 text-sm font-medium">Inadimplência por unidade (% em atraso)</div>
              {inadimplenciaUnidade.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Sem inadimplência no filtro atual.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, inadimplenciaUnidade.length * 32)}>
                  <BarChart data={inadimplenciaUnidade} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <YAxis type="category" dataKey="unidade" stroke="hsl(var(--muted-foreground))" fontSize={12} width={90} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                      formatter={(value: number, _name, item) => [
                        `${value.toFixed(1)}% (${brl(item?.payload?.atrasado ?? 0)})`,
                        "Em atraso",
                      ]}
                    />
                    <Bar dataKey="pct" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-3 text-sm font-medium">Evolução mensal</div>
              {evolucaoMensal.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Sem dados para o filtro atual.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={evolucaoMensal} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => brl(v).replace("R$", "")} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                      formatter={(value: number) => brl(value)}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="recebido" name="Recebido" stroke="hsl(var(--chart-2, 142 71% 45%))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="aVencer" name="A vencer" stroke="hsl(var(--chart-4, 38 92% 50%))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="atrasado" name="Em atraso" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="faturas">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">
                {isLoading ? "Carregando..." : `${num(filtered.length)} fatura(s)`}
              </span>
            </div>
            <div className="relative max-h-[calc(100vh-340px)] overflow-auto">
              <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="bg-card">Status</TableHead>
                    <TableHead className="bg-card">Documento</TableHead>
                    <TableHead className="bg-card">Cliente</TableHead>
                    <TableHead className="bg-card">Unidade</TableHead>
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
                        <TableCell>
                          {r.unidade ? <Badge variant="secondary">{r.unidade}</Badge> : "—"}
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
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        Nenhuma fatura encontrada.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="mensalidades" className="space-y-4">
          <DataProvider>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base:</span>
              <BaseFilterSelect />
              <RefreshButton />
            </div>
            <MensalidadesTab />
          </DataProvider>
        </TabsContent>
      </Tabs>
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
