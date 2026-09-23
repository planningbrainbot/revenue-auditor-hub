import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/meus-royalties")({
  head: () => ({ meta: [{ title: "Meus Royalties – Planning" }] }),
  component: MeusRoyaltiesPage,
});

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtData = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

type UnidadeRegras = {
  nome_da_praca: string | null;
  data_inauguracao: string | null;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  midia_mensal: number | null;
};

type Repasse = { competencia: string; tipo: string; valor_recebido: number | null };

function tempoDeCasa(d: string | null): string {
  if (!d) return "—";
  const ini = new Date(d);
  const hoje = new Date();
  const meses = (hoje.getFullYear() - ini.getFullYear()) * 12 + (hoje.getMonth() - ini.getMonth());
  if (meses < 12) return `${meses} mês(es)`;
  return `${Math.floor(meses / 12)}a ${meses % 12}m`;
}

function MeusRoyaltiesPage() {
  const { unidade: userUnidade, loading: permLoading } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [regras, setRegras] = useState<UnidadeRegras | null>(null);
  const [historico, setHistorico] = useState<{ mes: string; mrrBase: number; royaltiesPrev: number; cscPrev: number; midia: number; totalPrev: number; recebido: number | null }[]>([]);

  useEffect(() => {
    if (permLoading || !userUnidade) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const { data: unidadesData } = await supabase
        .from("unidades")
        .select("nome_da_praca,data_inauguracao,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,midia_mensal")
        .limit(200);
      const minhaUnidade = (unidadesData ?? []).find((u) => unitMatches(userUnidade, u.nome_da_praca));

      // últimos 12 meses
      const hoje = new Date();
      const meses: { iso: string; label: string }[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        meses.push({
          iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
        });
      }

      // Esperado por mês via RPC billing_esperado
      const esperadoPorMes: Record<string, { mrr: number; royalties: number; csc: number; midia: number; total: number }> = {};
      await Promise.all(
        meses.map(async (m) => {
          const { data } = await supabase.rpc("billing_esperado", { mes_ref: m.iso });
          const linha = (data ?? []).find((r: any) => unitMatches(userUnidade, r.unidade));
          if (linha) {
            esperadoPorMes[m.iso] = {
              mrr: Number(linha.mrr_base ?? 0),
              royalties: Number(linha.royalties_esp ?? 0),
              csc: Number(linha.csc_fixo ?? 0),
              midia: Number(linha.midia_mensal ?? 0),
              total: Number(linha.total_esperado ?? 0),
            };
          }
        }),
      );

      // Recebido (repasses_unidade) - filtra pela unidade
      const { data: repassesData } = await supabase
        .from("repasses_unidade")
        .select("competencia,tipo,valor_recebido,unidade")
        .gte("competencia", meses[meses.length - 1].iso)
        .limit(1000);
      const recebidoPorMes: Record<string, number> = {};
      (repassesData ?? []).forEach((r: any) => {
        if (!unitMatches(userUnidade, r.unidade)) return;
        const key = String(r.competencia).slice(0, 7) + "-01";
        recebidoPorMes[key] = (recebidoPorMes[key] ?? 0) + Number(r.valor_recebido ?? 0);
      });

      if (!alive) return;
      setRegras(minhaUnidade ?? null);
      setHistorico(
        meses.map((m) => {
          const esp = esperadoPorMes[m.iso] ?? { mrr: 0, royalties: 0, csc: 0, midia: 0, total: 0 };
          const recebido = recebidoPorMes[m.iso] ?? null;
          return {
            mes: m.label,
            mrrBase: esp.mrr,
            royaltiesPrev: esp.royalties,
            cscPrev: esp.csc,
            midia: esp.midia,
            totalPrev: esp.total,
            recebido,
          };
        }),
      );
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [permLoading, userUnidade]);

  function situacao(prev: number, rec: number | null) {
    if (rec == null) return <Badge variant="outline">—</Badge>;
    if (rec >= prev * 0.99) return <Badge variant="sucesso">Pago</Badge>;
    if (rec > 0) return <Badge variant="atencao">Parcial</Badge>;
    return <Badge variant="destructive">Em aberto</Badge>;
  }

  return (
    <AppShell title="Meus Royalties" subtitle="Obrigações financeiras com a matriz">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info label="Royalties" value={regras?.royalties_percentual != null ? `${regras.royalties_percentual}%` : "—"} />
          <Info label="CSC (fixo)" value={fmtBRL(regras?.csc_valor_fixo ?? null)} sub={regras?.csc_percentual_base_antiga ? `Base antiga: ${regras.csc_percentual_base_antiga}%` : undefined} />
          <Info label="Mídia mensal" value={fmtBRL(regras?.midia_mensal ?? null)} />
          <Info label="Tempo de casa" value={tempoDeCasa(regras?.data_inauguracao ?? null)} sub={`Inauguração: ${fmtData(regras?.data_inauguracao ?? null)}`} />
        </div>

        <Card className="overflow-hidden">
          <div className="border-b px-4 py-3 text-sm font-semibold">Histórico mensal — últimos 12 meses</div>
          {loading ? (
            <div className="p-4"><Skeleton className="h-64 w-full" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">MRR Base</TableHead>
                  <TableHead className="text-right">Royalties</TableHead>
                  <TableHead className="text-right">CSC</TableHead>
                  <TableHead className="text-right">Mídia</TableHead>
                  <TableHead className="text-right">Total Previsto</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((h) => (
                  <TableRow key={h.mes}>
                    <TableCell className="font-medium capitalize">{h.mes}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(h.mrrBase)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(h.royaltiesPrev)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(h.cscPrev)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(h.midia)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(h.totalPrev)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(h.recebido)}</TableCell>
                    <TableCell>{situacao(h.totalPrev, h.recebido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
