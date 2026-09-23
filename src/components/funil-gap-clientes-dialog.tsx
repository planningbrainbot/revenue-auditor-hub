import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useContasReceber } from "@/hooks/use-contas-receber";
import { brl } from "@/components/audit/format";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

type ContratoRow = { cnpj: string | null; titulo: string | null; mrr_mensal: number | null };

export function FunilGapClientesDialog({
  unidade,
  mes,
  gap,
  open,
  onOpenChange,
}: {
  unidade: string;
  mes: string; // YYYY-MM
  gap: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const contratosQuery = useQuery({
    queryKey: ["contratos-ativos-unidade", unidade],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contratos")
        .select("cnpj, titulo, mrr_mensal")
        .eq("unidade", unidade)
        .eq("status_contrato", "Ativo")
        .eq("tipo_unidade", "franquia")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ContratoRow[];
    },
    enabled: open,
  });

  const { data: contasData, isLoading: contasLoading } = useContasReceber();

  const rows = useMemo(() => {
    const porCliente = new Map<string, { cnpj: string; titulo: string; mrr: number; faturado: number }>();
    for (const c of contratosQuery.data ?? []) {
      const cnpj = onlyDigits(c.cnpj);
      if (!cnpj) continue;
      const cur = porCliente.get(cnpj) ?? { cnpj, titulo: c.titulo ?? "—", mrr: 0, faturado: 0 };
      cur.mrr += Number(c.mrr_mensal ?? 0);
      porCliente.set(cnpj, cur);
    }
    for (const f of contasData?.rows ?? []) {
      if (f.unidade !== unidade) continue;
      if (!f.data_competencia || !f.data_competencia.startsWith(mes)) continue;
      if (f.status_pagamento === "CANCELADO") continue;
      const cnpj = onlyDigits(f.cpf_cnpj);
      const cur = porCliente.get(cnpj);
      if (!cur) continue;
      cur.faturado += Number(f.valor ?? 0);
    }
    return Array.from(porCliente.values())
      .map((c) => ({ ...c, diferenca: c.mrr - c.faturado }))
      .filter((c) => c.diferenca > 0.01)
      .sort((a, b) => b.diferenca - a.diferenca);
  }, [contratosQuery.data, contasData, unidade, mes]);

  const totalDiferenca = rows.reduce((s, r) => s + r.diferenca, 0);
  const loading = contratosQuery.isLoading || contasLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clientes sem fatura completa — {unidade}</DialogTitle>
          <DialogDescription>
            Contratos ativos cujo faturamento no mês (Omie) ficou abaixo do MRR contratado.
            Lista aproximada — cruza `contratos` × `contas_receber` por CNPJ.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">MRR contratado</TableHead>
                <TableHead className="text-right">Faturado no mês</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.cnpj}>
                  <TableCell>{r.titulo}</TableCell>
                  <TableCell className="text-right">{brl(r.mrr)}</TableCell>
                  <TableCell className="text-right">{brl(r.faturado)}</TableCell>
                  <TableCell className="text-right font-medium text-danger">{brl(r.diferenca)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Nenhum cliente com gap identificado.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total (aproximado)</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right font-semibold">{brl(totalDiferenca)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
        {!loading && Math.abs(totalDiferenca - gap) > 1 && (
          <p className="text-xs text-muted-foreground">
            Gap Faturamento da tabela: {brl(gap)}. A diferença em relação ao total acima costuma vir de
            contratos sem CNPJ cadastrado ou faturas com CNPJ divergente do contrato.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
