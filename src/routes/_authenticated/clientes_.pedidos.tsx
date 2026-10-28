import { createFileRoute } from "@tanstack/react-router";
import { PedidosDasUnidades } from "@/components/clientes/pedidos-unidades";

// Pedidos das unidades (28/10/2026): a fila do CS com o que os sócios pediram para mudar na Base. A aba fica na URL.
type Busca = { aba: "abertos" | "andamento" | "decididos" };
export const Route = createFileRoute("/_authenticated/clientes_/pedidos")({
  validateSearch: (s: Record<string, unknown>): Busca => ({
    aba: s.aba === "andamento" || s.aba === "decididos" ? s.aba : "abertos",
  }),
  head: () => ({ meta: [{ title: "Pedidos das unidades · Base de clientes · Planning Brain" }] }),
  component: Pagina,
});

function Pagina() {
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PedidosDasUnidades
      aba={aba}
      aoMudarAba={(a) => void navigate({ search: { aba: a }, replace: true })}
    />
  );
}
