import { createFileRoute, redirect } from "@tanstack/react-router";

// Página movida para dentro de Receitas Partners como aba "Split" — ver
// src/components/royalties/split-royalties-content.tsx. A rota fica de pé
// como redirecionamento porque o link /royalties/split já circulou, mesmo
// padrão que royalties.index.tsx usa desde a fusão anterior.
export const Route = createFileRoute("/_authenticated/royalties/split")({
  beforeLoad: () => {
    throw redirect({ to: "/unidades", search: { tab: "split" } });
  },
  component: () => null,
});
