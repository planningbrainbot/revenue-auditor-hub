import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AREA_TESOURARIA, PortaoFaturamento } from "@/components/faturamento/moldura";
import { FilaDaTesouraria } from "@/components/faturamento/fila-tesouraria";
import { lerBuscaFila } from "@/lib/faturamento/fila";

// Fila da tesouraria (Fila de trabalho). Contrato: docs/design/contratos/faturamento-tesouraria.md.
// Só a área Faturamento · Tesouraria (`edit.faturamento_tesouraria`) abre; a empresa no recorte quem confere
// é `ops.fat_fila_tesouraria`. Empresa, situação, higiene, dia, busca e o pedido aberto moram na URL (N7).
export const Route = createFileRoute("/_authenticated/faturamento/tesouraria")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaFila(s),
  head: () => ({ meta: [{ title: "Fila da tesouraria · Planning Brain" }] }),
  component: FilaTesourariaPagina,
});

function FilaTesourariaPagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento
      area={AREA_TESOURARIA}
      oQueFalta="Faturamento · Tesouraria"
      titulo="Fila da tesouraria"
      pergunta="Qual pedido eu confiro e faturo agora?"
      carregando="tabela"
    >
      <FilaDaTesouraria busca={busca} />
    </PortaoFaturamento>
  );
}
