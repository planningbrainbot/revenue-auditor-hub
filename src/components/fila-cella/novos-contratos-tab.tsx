import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNovosDoMes } from "@/hooks/use-fila-cella";
import { BRL, dataBR } from "@/lib/fila-cella.types";
import { CurvaChips, EcdChip } from "@/components/fila-cella/badges";

/**
 * Bloco E do §6.2 — os novos contratos do mês.
 *
 * LISTA DISTINTA, não filtro da Fila: só 6 dos 45 chegam ao piso de R$ 25MM que
 * define a Fila. Tratar como filtro faria parecer que a Fila encolheu.
 */
export function NovosContratosTab() {
  const q = useNovosDoMes();
  const rows = q.data?.rows ?? [];
  const estado = q.data?.estado ?? "ok";

  if (q.isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  }
  if (q.error) {
    return (
      <Card className="border-red-300 p-6 text-sm text-red-600 dark:border-red-900">
        Falha ao ler <code>v_fila_cella</code>.
      </Card>
    );
  }
  if (estado !== "ok") {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {q.data?.aviso ?? "Sem dados de novos contratos."}
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <div className="border-b px-3 py-2 text-sm text-muted-foreground">
        {rows.length} contratos novos no mês. Funil de porte inteiro abaixo da Fila — a maioria não
        alcança o piso de R$ 25MM.
      </div>
      <div className="max-h-[calc(100vh-360px)] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm">
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Curva</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead>ECD</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Cliente desde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[260px] truncate font-medium">{r.titulo}</TableCell>
                <TableCell>
                  <CurvaChips
                    declarada={r.curva_declarada}
                    apurada={r.curva_ecd}
                    diverge={r.curva_diverge}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.segmento ?? "—"}
                  {r.segmento_prioritario && <span className="ml-1 text-amber-500">★</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{BRL(r.mrr)}</TableCell>
                <TableCell>
                  <EcdChip estado={r.ecd_estado} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.unidade ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{dataBR(r.cliente_desde)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum contrato novo neste mês.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
