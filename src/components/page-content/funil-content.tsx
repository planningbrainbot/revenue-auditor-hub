import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Receipt, Wallet, Target, AlertTriangle, AlertCircle, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/components/audit/format";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { FunilGapClientesDialog } from "@/components/funil-gap-clientes-dialog";
import { KpiCard, tomDoLegado } from "@/components/planning";

type FunilRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  contratos_ativos: number | null;
  faturado: number | null;
  faturas_emitidas: number | null;
  recebido: number | null;
  faturas_recebidas: number | null;
  conv_mrr_to_faturado_pct: number | null;
  conv_faturado_to_recebido_pct: number | null;
  conv_mrr_to_recebido_pct: number | null;
};

const N = (v: number | null | undefined) => Number(v ?? 0);

function defaultMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toneMrrFat(p: number) {
  if (p >= 90) return "emerald";
  if (p >= 70) return "amber";
  return "red";
}
function toneFatRec(p: number) {
  if (p >= 90) return "emerald";
  return "amber";
}

const TONE_BG: Record<string, string> = {
  emerald: "bg-success-soft border-success/40",
  amber: "bg-warning-soft border-warning/40",
  red: "bg-danger-soft border-danger/40",
  slate: "bg-card border-border",
};
const TONE_BADGE: Record<string, string> = {
  emerald: "bg-success-soft text-success",
  amber: "bg-warning-soft text-warning",
  red: "bg-danger-soft text-danger",
  slate: "bg-muted text-foreground",
};

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN
// §1.6). `source` era um selo solto e vira a procedência do número (N3); o
// fundo por `tone` vira o `tom` do KpiCard (emerald → sucesso, amber →
// atenção, red → perigo, slate → neutro), com ícone de status junto da cor
// (V7). "—" é conversão sem MRR contratado: não apurada, não zero (N4).
function FunilCard({
  label, value, sub, source, tone,
}: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: string; source?: string }) {
  return (
    <KpiCard
      rotulo={label}
      valor={value}
      estado={value === "—" ? "nao-apurado" : "ok"}
      nota={sub}
      procedencia={source ? { fonte: source } : undefined}
      tom={tomDoLegado(tone)}
      className="flex-1"
    />
  );
}

function ConvArrow({ pct, tone }: { pct: number | null; tone: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-2">
      <ArrowRight className="h-5 w-5 text-muted-foreground" />
      <Badge className={cn("mt-1 text-xs", TONE_BADGE[tone])}>
        {pct === null ? "—" : `${pct.toFixed(1)}%`}
      </Badge>
    </div>
  );
}

function nextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthBounds(mes: string): { dataIni: string; dataFim: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0);
  return {
    dataIni: `${mes}-01`,
    dataFim: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`,
  };
}

function CellLink({ to, search, className, children }: {
  to: string;
  search: Record<string, string>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={cn("underline-offset-2 hover:underline hover:text-primary-text", className)}
    >
      {children}
    </Link>
  );
}

export function FunilContent() {
  const { can, loading: permLoading, scopedToOwnUnit, unidade: userUnidade } = usePermissions();
  const [mes, setMes] = useState<string>(defaultMes());
  const [unidadesSel, setUnidadesSel] = useState<string[] | null>(null);
  const [gapDialog, setGapDialog] = useState<{ unidade: string; mes: string; gap: number } | null>(null);

  const meses = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ value: v, label: monthLabel(v) });
    }
    return out;
  }, []);

  const mesIso = `${mes}-01`;

  const q = useQuery({
    queryKey: ["v_funil_mensal", mesIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_funil_mensal")
        .select("*")
        .gte("mes", mesIso)
        .lt("mes", nextMonth(mesIso))
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as FunilRow[];
    },
    enabled: !permLoading && (can("view.funil_receita") || can("view.auditoria")),
  });

  // Sócio regional enxerga só a própria unidade — o recorte vem antes da
  // lista de unidades, para que o seletor também não revele a rede.
  const escopoUnidade = scopedToOwnUnit && !!userUnidade;
  const baseRows = useMemo(
    () =>
      escopoUnidade
        ? (q.data ?? []).filter((r) => unitMatches(userUnidade, r.unidade))
        : (q.data ?? []),
    [q.data, escopoUnidade, userUnidade],
  );

  const allUnidades = useMemo(
    () => Array.from(new Set(baseRows.map((r) => r.unidade ?? "").filter(Boolean))).sort(),
    [baseRows],
  );

  const selected = unidadesSel ?? allUnidades;
  const rows = baseRows.filter((r) => selected.includes(r.unidade ?? ""));

  const totals = rows.reduce(
    (a, r) => {
      a.mrr += N(r.mrr_contratado);
      a.contratos += N(r.contratos_ativos);
      a.faturado += N(r.faturado);
      a.faturas += N(r.faturas_emitidas);
      a.recebido += N(r.recebido);
      a.recebidas += N(r.faturas_recebidas);
      return a;
    },
    { mrr: 0, contratos: 0, faturado: 0, faturas: 0, recebido: 0, recebidas: 0 },
  );

  const convMF = totals.mrr > 0 ? (totals.faturado / totals.mrr) * 100 : null;
  const convFR = totals.faturado > 0 ? (totals.recebido / totals.faturado) * 100 : null;
  const convMR = totals.mrr > 0 ? (totals.recebido / totals.mrr) * 100 : null;

  const insights: { kind: "warn" | "critical"; text: string }[] = [];
  for (const r of rows) {
    const unit = r.unidade ?? "—";
    const mrr = N(r.mrr_contratado);
    const fat = N(r.faturado);
    const rec = N(r.recebido);
    const mf = r.conv_mrr_to_faturado_pct == null ? null : Number(r.conv_mrr_to_faturado_pct);
    const fr = r.conv_faturado_to_recebido_pct == null ? null : Number(r.conv_faturado_to_recebido_pct);
    if (mrr > 0 && fat === 0) {
      insights.push({ kind: "critical", text: `🔴 ${unit}: tem MRR de ${brl(mrr)} mas zero faturas no Omie` });
      continue;
    }
    if (mf !== null && mf < 80) {
      insights.push({
        kind: "warn",
        text: `⚠ ${unit}: apenas ${mf.toFixed(1)}% do MRR foi faturado — ${brl(mrr - fat)} não cobrado`,
      });
    }
    if (fr !== null && fr < 85) {
      insights.push({
        kind: "warn",
        text: `⚠ ${unit}: ${brl(fat - rec)} faturado ainda não recebido`,
      });
    }
  }

  if (permLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!can("view.funil_receita") && !can("view.auditoria")) {
    return <div className="p-6 text-sm text-muted-foreground">Você não tem permissão para visualizar esta página.</div>;
  }

  const loading = q.isLoading;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mês:</span>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {meses.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className={cn("flex items-center gap-2", escopoUnidade && "hidden")}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unidades:</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[12rem] justify-start">
                {unidadesSel === null || unidadesSel.length === allUnidades.length
                  ? `Todas (${allUnidades.length})`
                  : `${unidadesSel.length} selecionada(s)`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="mb-2 flex justify-between">
                <Button variant="ghost" size="sm" onClick={() => setUnidadesSel(null)}>Todas</Button>
                <Button variant="ghost" size="sm" onClick={() => setUnidadesSel([])}>Nenhuma</Button>
              </div>
              <div className="max-h-64 space-y-1 overflow-auto">
                {allUnidades.map((u) => {
                  const checked = selected.includes(u);
                  return (
                    <label key={u} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const base = unidadesSel ?? allUnidades;
                          setUnidadesSel(c ? Array.from(new Set([...base, u])) : base.filter((x) => x !== u));
                        }}
                      />
                      <span className="text-sm">{u}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          {/* Aviso de cobertura parcial quando há unidades sem dados Omie */}
          {rows.some((r) => N(r.mrr_contratado) > 0 && N(r.faturado) === 0) && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Faturado e Recebido cobrem apenas unidades com dados no Omie.
                Unidades sem Omie aparecem com MRR mas sem faturamento.
              </span>
            </div>
          )}
          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
            <FunilCard
              icon={<FileText className="h-4 w-4" />}
              label="MRR Contratado"
              value={brl(totals.mrr)}
              sub={`${totals.contratos} contratos ativos`}
              source="contratos"
            />
            <ConvArrow pct={convMF} tone={convMF === null ? "slate" : toneMrrFat(convMF)} />
            <FunilCard
              icon={<Receipt className="h-4 w-4" />}
              label="Faturado"
              value={brl(totals.faturado)}
              sub={`${totals.faturas} faturas emitidas`}
              tone={convMF === null ? "slate" : toneMrrFat(convMF)}
              source="omie"
            />
            <ConvArrow pct={convFR} tone={convFR === null ? "slate" : toneFatRec(convFR)} />
            <FunilCard
              icon={<Wallet className="h-4 w-4" />}
              label="Recebido"
              value={brl(totals.recebido)}
              sub={`${totals.recebidas} faturas recebidas`}
              tone={convFR === null ? "slate" : toneFatRec(convFR)}
              source="omie"
            />
            <ConvArrow pct={convMR} tone={convMR === null ? "slate" : toneMrrFat(convMR)} />
            <FunilCard
              icon={<Target className="h-4 w-4" />}
              label="Conversão Total"
              value={convMR === null ? "—" : `${convMR.toFixed(1)}%`}
              sub="Recebido / MRR Contratado"
              tone={convMR === null ? "slate" : toneMrrFat(convMR)}
            />
          </div>
        </>
      )}

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Por unidade — {monthLabel(mes)}</h2>
        </header>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">MRR Contratado</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">Gap Faturamento</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Gap Cobrança</TableHead>
                <TableHead className="text-right">MRR→Fat</TableHead>
                <TableHead className="text-right">Fat→Rec</TableHead>
                <TableHead className="text-right">MRR→Rec</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const mrr = N(r.mrr_contratado), fat = N(r.faturado), rec = N(r.recebido);
                const gapF = mrr - fat;
                const gapC = fat - rec;
                const mf = r.conv_mrr_to_faturado_pct == null ? null : Number(r.conv_mrr_to_faturado_pct);
                const fr = r.conv_faturado_to_recebido_pct == null ? null : Number(r.conv_faturado_to_recebido_pct);
                const mr = r.conv_mrr_to_recebido_pct == null ? null : Number(r.conv_mrr_to_recebido_pct);
                const semDados = mrr > 0 && fat === 0;
                const unidadeStr = r.unidade ?? "";
                const { dataIni, dataFim } = monthBounds(mes);
                return (
                  <TableRow key={r.unidade}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.unidade}</span>
                        {semDados && (
                          <Badge className="bg-muted text-foreground">
                            Sem dados no Omie
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <CellLink to="/clientes" search={{ unidade: unidadeStr }}>{brl(mrr)}</CellLink>
                    </TableCell>
                    <TableCell className="text-right">
                      <CellLink to="/contas-receber" search={{ unidade: unidadeStr, dataIni, dataFim }}>{brl(fat)}</CellLink>
                    </TableCell>
                    <TableCell className={cn("text-right", gapF > 0 && "text-danger font-medium")}>
                      {Math.abs(gapF) < 0.01 ? (
                        brl(gapF)
                      ) : gapF > 0 ? (
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline hover:text-primary-text"
                          onClick={() => setGapDialog({ unidade: unidadeStr, mes, gap: gapF })}
                        >
                          {brl(gapF)}
                        </button>
                      ) : (
                        <CellLink to="/contas-receber" search={{ unidade: unidadeStr, dataIni, dataFim }}>{brl(gapF)}</CellLink>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <CellLink to="/contas-receber" search={{ unidade: unidadeStr, status: "RECEBIDO", dataIni, dataFim }}>{brl(rec)}</CellLink>
                    </TableCell>
                    <TableCell className={cn("text-right", gapC > 0 && "text-warning font-medium")}>
                      <CellLink to="/contas-receber" search={{ unidade: unidadeStr, status: "NAO_RECEBIDO", dataIni, dataFim }}>{brl(gapC)}</CellLink>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={cn(TONE_BADGE[mf === null ? "slate" : toneMrrFat(mf)])}>
                        {mf === null ? "—" : `${mf.toFixed(1)}%`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={cn(TONE_BADGE[fr === null ? "slate" : toneFatRec(fr)])}>
                        {fr === null ? "—" : `${fr.toFixed(1)}%`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={cn(TONE_BADGE[mr === null ? "slate" : toneMrrFat(mr)])}>
                        {mr === null ? "—" : `${mr.toFixed(1)}%`}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground">Sem dados para o mês.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.mrr)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.faturado)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.mrr - totals.faturado)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.recebido)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.faturado - totals.recebido)}</TableCell>
                  <TableCell className="text-right font-semibold">{convMF === null ? "—" : `${convMF.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-right font-semibold">{convFR === null ? "—" : `${convFR.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-right font-semibold">{convMR === null ? "—" : `${convMR.toFixed(1)}%`}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Insights automáticos</h2>
        </header>
        <div className="space-y-2 p-4">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : insights.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <Check className="h-4 w-4" /> Nenhum alerta para o filtro atual.
            </div>
          ) : (
            insights.map((it, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-3 text-sm",
                  it.kind === "critical"
                    ? "border-danger/40 bg-danger-soft text-danger"
                    : "border-warning/40 bg-warning-soft text-warning",
                )}
              >
                {it.kind === "critical" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{it.text}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {gapDialog && (
        <FunilGapClientesDialog
          unidade={gapDialog.unidade}
          mes={gapDialog.mes}
          gap={gapDialog.gap}
          open={!!gapDialog}
          onOpenChange={(o) => { if (!o) setGapDialog(null); }}
        />
      )}
    </div>
  );
}
