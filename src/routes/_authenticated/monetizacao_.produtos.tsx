import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { ProdutosEListas } from "@/components/monetizacao/produtos-listas";
import { validarBuscaClientes } from "@/components/clientes/busca";

// Produtos da Monetização (15/10/2026): saiu da Base de clientes (/clientes?view=produtos), com a mesma URL de
// filtros (`components/clientes/busca.ts`). O link antigo abre aqui.
export const Route = createFileRoute("/_authenticated/monetizacao_/produtos")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaClientes(s),
  head: () => ({ meta: [{ title: "Produtos · Monetização · Planning Brain" }] }),
  component: Pagina,
});

function Pagina() {
  const search = Route.useSearch();
  return <ProdutosEListas tela="produtos" search={search} />;
}
