import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/audit/kpi-card";
import { brl } from "@/components/audit/format";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-permissions";

type BillingEsperadoRow = {
  unidade: string;
  clientes_ativos: number;
  mrr_base: number;
  royalties_pct: number;
  royalties_esp: number;
  csc_fixo: number;
  midia_mensal: number;
  total_esperado: number;
  paga_cac: boolean;
  tem_base_antiga: boolean;
};

type FinRow = {
  codigo_categoria: string | null;
  valor_documento: number | null;
};

const CAT_ROYALTIES = "1.01.95";
const CAT_CSC = "1.01.96";
const CAT_MIDIA = "1.03.96";
const CAT_OUTRAS = "1.01.94";

function monthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    opts.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return opts;
}

function defaultMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(ym: string): { start: string; end: string; mesRef: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(y, m, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end, mesRef: start };
}

export function AuditoriaFaturamentoContent() {
  const { can, loading: permLoading } = usePermissions();
  const [mes, setMes] = useState<string>(defaultMes());
  const meses = useMemo(() => monthOptions(), []);
  const { start, end, mesRef } = useMemo(() => monthBounds(mes), [mes]);

  const esperadoQ = useQuery({
    queryKey: ["billing-esperado", mesRef],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_esperado", { mes_ref: mesRef });
      if (error) throw error;
      return (data ?? []) as BillingEsperadoRow[];
    },
    enabled: !permLoading && (can("view.roas") || can("view.auditoria")),
  });

  const recebidoQ = useQuery({
    queryKey: ["partners-financeiro-mes", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners_financeiro")
        .select("codigo_categoria,valor_documento,data_emissao,status_titulo")
        .eq("status_titulo", "RECEBIDO")
        .gte("data_emissao", start)
        .lt("data_emissao", end)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as FinRow[];
    },
    enabled: !permLoading && (can("view.roas") || can("view.auditoria")),
  });

  const totalEsperado = (esperadoQ.data ?? []).reduce((s, r) => s + Number(r.total_esperado ?? 0), 0);

  const recebidoPorCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recebidoQ.data ?? []) {
      const k = r.codigo_categoria ?? "__null__";
      map.set(k, (map.get(k) ?? 0) + Number(r.valor_documento ?? 0));
    }
    return map;
  }, [recebidoQ.data]);

  const totalRecebidoPrincipal =
    (recebidoPorCategoria.get(CAT_ROYALTIES) ?? 0) +
    (recebidoPorCategoria.get(CAT_CSC) ?? 0) +
    (recebidoPorCategoria.get(CAT_MIDIA) ?? 0);

  const delta = totalRecebidoPrincipal - totalEsperado;

  if (permLoading) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!can("view.roas") && !can("view.auditoria")) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">Você não tem permissão para visualizar esta página.</div>;
  }

  const loading = esperadoQ.isLoading || recebidoQ.isLoading;
  const esperado = esperadoQ.data ?? [];

  const totals = esperado.reduce(
    (acc, r) => {
      acc.clientes += Number(r.clientes_ativos ?? 0);
      acc.mrr += Number(r.mrr_base ?? 0);
      acc.royalties += Number(r.royalties_esp ?? 0);
      acc.csc += Number(r.csc_fixo ?? 0);
      acc.midia += r.paga_cac ? 0 : Number(r.midia_mensal ?? 0);
      acc.total += Number(r.total_esperado ?? 0);
      return acc;
    },
    { clientes: 0, mrr: 0, royalties: 0, csc: 0, midia: 0, total: 0 },
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mês:</span>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info-soft p-3 text-sm text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          O "Esperado" é calculado a partir dos contratos ativos no Pipedrive. Unidades com base antiga (Curitiba e Patos de Minas) têm uma parcela de CSC não calculável pelo Pipedrive — ela aparece como "Sem categoria" no Omie.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Total Esperado" value={loading ? "—" : brl(totalEsperado)} tone="indigo" />
        <KpiCard label="Recebido" value={loading ? "—" : brl(totalRecebidoPrincipal)} sub="Royalties + CSC + Mídia" />
        <KpiCard
          label="Delta (Recebido − Esperado)"
          value={loading ? "—" : brl(delta)}
          tone={delta >= 0 ? "emerald" : "red"}
        />
      </div>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Esperado por Unidade</h2>
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
                <TableHead className="text-right">Clientes ativos</TableHead>
                <TableHead className="text-right">MRR base</TableHead>
                <TableHead className="text-right">Royalties</TableHead>
                <TableHead className="text-right">CSC Expansão</TableHead>
                <TableHead className="text-right">Mídia / CAC</TableHead>
                <TableHead className="text-right">Total Esperado</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {esperado.map((r) => (
                <TableRow key={r.unidade}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.unidade}</span>
                      {r.paga_cac && (
                        <Badge className="bg-info-soft text-info hover:bg-info-soft">CAC</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.clientes_ativos}</TableCell>
                  <TableCell className="text-right">{brl(r.mrr_base)}</TableCell>
                  <TableCell className="text-right">
                    <div>{brl(r.royalties_esp)}</div>
                    <div className="text-xs text-muted-foreground">{Number(r.royalties_pct ?? 0)}%</div>
                  </TableCell>
                  <TableCell className="text-right">{brl(r.csc_fixo)}</TableCell>
                  <TableCell className="text-right">
                    {r.paga_cac ? <span className="text-muted-foreground">—</span> : brl(r.midia_mensal)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{brl(r.total_esperado)}</TableCell>
                  <TableCell>
                    {r.tem_base_antiga && (
                      <Badge className="gap-1 bg-warning-soft text-warning hover:bg-warning-soft">
                        <AlertTriangle className="h-3 w-3" />
                        Base antiga não calculada
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {esperado.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Sem dados para o mês.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {esperado.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{totals.clientes}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.mrr)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.royalties)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.csc)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.midia)}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(totals.total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Recebido no Omie (Mês)</h2>
        </header>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria Omie</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Valor recebido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { label: "Royalties", code: CAT_ROYALTIES, key: CAT_ROYALTIES },
                { label: "CSC Expansão", code: CAT_CSC, key: CAT_CSC },
                { label: "CSC Tráfego Pago (Mídia)", code: CAT_MIDIA, key: CAT_MIDIA },
                { label: "Outras Receitas", code: CAT_OUTRAS, key: CAT_OUTRAS },
                { label: "Sem categoria (base antiga)", code: "NULL", key: "__null__" },
              ].map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-muted-foreground">{row.code}</TableCell>
                  <TableCell className="text-right">{brl(recebidoPorCategoria.get(row.key) ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold">
                  {brl(Array.from(recebidoPorCategoria.values()).reduce((s, v) => s + v, 0))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </section>
    </div>
  );
}
