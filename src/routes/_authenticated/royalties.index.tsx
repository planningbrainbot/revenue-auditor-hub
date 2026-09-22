import { createFileRoute, redirect } from "@tanstack/react-router";

// Esta URL apontava para o Histórico de Royalties, removido em 22/09/2026 a
// pedido do usuário. O link antigo segue de pé e cai na Apuração de Royalties,
// que é onde o número por mês e por cliente é conferido hoje.
export const Route = createFileRoute("/_authenticated/royalties/")({
  beforeLoad: () => {
    throw redirect({ to: "/unidades/royalties" });
  },
  component: () => null,
});
