import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { ProdutosEListas } from "@/components/monetizacao/produtos-listas";
import { validarBuscaClientes } from "@/components/clientes/busca";

// Listas da Base de clientes (15/10/2026): a construção de listas mora na Base, liberada só para quem tem a área
// Monetização (pedido do Pedro). Mesma URL de filtros da Base (`components/clientes/busca.ts`).
export const Route = createFileRoute("/_authenticated/clientes_/listas")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaClientes(s),
  head: () => ({ meta: [{ title: "Listas · Base de clientes · Planning Brain" }] }),
  component: Pagina,
});

function Pagina() {
  const search = Route.useSearch();
  return <ProdutosEListas tela="listas" search={search} />;
}
