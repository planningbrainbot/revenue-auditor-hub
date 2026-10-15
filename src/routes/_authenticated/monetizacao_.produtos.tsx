import { createFileRoute, redirect, type SearchSchemaInput } from "@tanstack/react-router";
import { validarBuscaClientes } from "@/components/clientes/busca";

// Produtos morou na Monetização por algumas horas em 15/10/2026 e voltou para a Base de clientes, liberada para quem tem a
// área Monetização (pedido do Pedro). O link antigo abre /clientes/produtos com os mesmos filtros.
export const Route = createFileRoute("/_authenticated/monetizacao_/produtos")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaClientes(s),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/clientes/produtos", search, replace: true });
  },
});
