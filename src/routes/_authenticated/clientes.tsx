import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { ClientesBase } from "@/components/clientes/base-unica";
import { validarBuscaClientes } from "@/components/clientes/busca";

// Visão, recorte do topo e filtros da tabela da Base moram na URL (N7): recarregar ou colar o
// link reproduz a tela. As chaves estão descritas em `components/clientes/busca.ts`.
export const Route = createFileRoute("/_authenticated/clientes")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaClientes(s),
  component: ClientesBase,
});
