import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AREA_TESOURARIA, PortaoFaturamento } from "@/components/faturamento/moldura";
import { ListaDoCorte } from "@/components/faturamento/lista-corte";
import { lerBuscaCorte } from "@/lib/faturamento/recorrente";

// Lista do corte (Fila de trabalho). Contrato: docs/design/contratos/faturamento-corte.md.
// Só a área Faturamento · Tesouraria abre; as empresas no recorte quem confere é `ops.fat_corte`.
// Dia, empresa, filtros e o contrato aberto moram na URL (N7).
export const Route = createFileRoute("/_authenticated/faturamento/corte")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaCorte(s),
  head: () => ({ meta: [{ title: "Lista do corte · Planning Brain" }] }),
  component: ListaDoCortePagina,
});

function ListaDoCortePagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento
      area={AREA_TESOURARIA}
      oQueFalta="Faturamento · Tesouraria"
      titulo="Lista do corte"
      pergunta="Quais contratos eu faturo neste corte, e com qual valor?"
      carregando="tabela"
    >
      <ListaDoCorte busca={busca} />
    </PortaoFaturamento>
  );
}
