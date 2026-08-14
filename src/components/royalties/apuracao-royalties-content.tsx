import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Coins, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRoyaltiesUnidades } from "@/hooks/use-royalties";
import { brl } from "@/components/audit/format";
import { usePermissions } from "@/hooks/use-permissions";

function defaultMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isMesEmAndamento(mes: string): boolean {
  const d = new Date();
  const atual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return mes >= atual;
}

function formatMesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  em_revisao: { label: "Em revisão", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" },
  confirmado: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" },
  faturado: { label: "Faturado", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200" },
};

export function ApuracaoRoyaltiesContent() {
  const { isAdmin, loading } = usePermissions();
  const [mes, setMes] = useState(defaultMes());
  const { data, isLoading } = useRoyaltiesUnidades(mes);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const totais = useMemo(
    () =>
      rows.reduce(
        (acc, u) => {
          const ap = u.apuracao;
          if (!ap) return acc;
          acc.royalties += Number(ap.royalties_valor ?? 0);
          acc.csc += Number((ap.csc_valor_fixo ?? ap.csc_base_antiga_valor ?? 0) as number);
          acc.cac += Number(ap.cac_valor ?? 0);
          acc.midia += Number(ap.csc_trafego_pago ?? 0);
          acc.outras += Number(ap.outras_receitas ?? 0);
          acc.totalFatura += Number(ap.total_fatura ?? 0);
          acc.comApuracao += 1;
          return acc;
        },
        { royalties: 0, csc: 0, cac: 0, midia: 0, outras: 0, totalFatura: 0, comApuracao: 0 },
      ),
    [rows],
  );

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin)
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a usuários admin.</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Coins className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Apuração de Royalties</h1>
            <p className="text-sm text-muted-foreground">
              Gere a base de cobrança mensal de cada unidade.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMes(shiftMes(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[160px] rounded-md border bg-card px-3 py-1.5 text-center text-sm font-medium capitalize">
            {formatMesLabel(mes)}
          </div>
          <Button variant="outline" size="icon" onClick={() => setMes(shiftMes(mes, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isMesEmAndamento(mes) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Mês em andamento — a apuração só fecha depois que o mês termina. Use as setas para voltar ao mês anterior.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Total da rede</div>
            <div className="text-xs text-muted-foreground">
              {totais.comApuracao} de {rows.length} unidades com apuração
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <div className="text-xs text-muted-foreground">Royalties</div>
              <div className="font-medium">{brl(totais.royalties)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">CSC</div>
              <div className="font-medium">{brl(totais.csc)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">CAC</div>
              <div className="font-medium">{brl(totais.cac)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Mídia</div>
              <div className="font-medium">{brl(totais.midia)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Outras receitas</div>
              <div className="font-medium">{brl(totais.outras)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total fatura</div>
              <div className="text-base font-semibold">{brl(totais.totalFatura)}</div>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando unidades…</div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Royalties</TableHead>
                <TableHead className="text-right">CSC</TableHead>
                <TableHead className="text-right">CAC</TableHead>
                <TableHead className="text-right">Mídia</TableHead>
                <TableHead className="text-right">Outras</TableHead>
                <TableHead className="text-right">Total fatura</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => {
                const ap = u.apuracao;
                const statusKey = ap?.status ?? "nao_iniciada";
                const badge = STATUS_BADGE[statusKey];
                const cscModel = u.csc_percentual_base_antiga != null ? `${u.csc_percentual_base_antiga}% base antiga` : `CSC fixo ${brl(u.csc_valor_fixo ?? 0)}`;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome_da_praca}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Royalties {u.royalties_percentual ?? 0}% • {cscModel}
                    </TableCell>
                    <TableCell>
                      {badge ? (
                        <Badge className={badge.cls}>{badge.label}</Badge>
                      ) : (
                        <Badge variant="outline">Não iniciada</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{ap ? brl(ap.royalties_valor ?? 0) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {ap ? brl((ap.csc_valor_fixo ?? ap.csc_base_antiga_valor ?? 0) as number) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{ap ? brl(ap.cac_valor ?? 0) : "—"}</TableCell>
                    <TableCell className="text-right">{ap ? brl(ap.csc_trafego_pago ?? 0) : "—"}</TableCell>
                    <TableCell className="text-right">{ap ? brl(ap.outras_receitas ?? 0) : "—"}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {ap ? brl(ap.total_fatura ?? 0) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link to="/royalties/$unidadeId/$mes" params={{ unidadeId: String(u.id), mes }}>
                        <Button size="sm" variant={ap ? "outline" : "default"}>
                          {ap?.status === "confirmado" || ap?.status === "faturado"
                            ? "Ver apuração"
                            : ap
                              ? "Continuar"
                              : "Iniciar apuração"}
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
