import { createFileRoute, redirect } from "@tanstack/react-router";

// Página migrada para dentro de Unidades (agora "Receitas Partners") como
// aba "Histórico" — ver src/components/royalties/royalties-historico-content.tsx.
export const Route = createFileRoute("/_authenticated/royalties/")({
  beforeLoad: () => {
    throw redirect({ to: "/unidades", search: { tab: "historico" } });
  },
  component: () => null,
});
