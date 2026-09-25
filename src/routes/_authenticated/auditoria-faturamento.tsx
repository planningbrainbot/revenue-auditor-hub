import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/auditoria-faturamento")({
  beforeLoad: () => {
    // A tela antiga virou a aba Esperado × Recebido do Funil de Receita.
    throw redirect({ to: "/funil-receita", search: { aba: "esperado" } as never });
  },
  component: () => null,
});
