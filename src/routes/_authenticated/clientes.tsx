import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { ClientesBase } from "@/components/clientes/base-unica";
export const Route = createFileRoute("/_authenticated/clientes")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => ({
    view: typeof s.view === "string" ? s.view : s.status ? "contratos" : "empresas",
    status: typeof s.status === "string" ? s.status : "",
    unidade: typeof s.unidade === "string" ? s.unidade : "",
    q: typeof s.q === "string" ? s.q : "",
    origem: typeof s.origem === "string" ? s.origem : "",
    gate: typeof s.gate === "string" && ["cnpj", "contato", "ecd"].includes(s.gate) ? s.gate : "",
  }),
  component: ClientesBase,
});
