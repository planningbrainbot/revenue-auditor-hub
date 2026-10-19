import { createFileRoute, redirect } from "@tanstack/react-router";

// O BI Financeiro morou em /dre-caixa de 15/10 a 19/10/2026. Virou a área BI Financeiro, em
// /bi-financeiro; o endereço antigo leva para lá com os mesmos filtros (?aba=, ?de=, ?ate=), e a
// aba "geral" (a visão geral de antes) vira o item "Resultado do período".
export const Route = createFileRoute("/_authenticated/dre-caixa")({
  beforeLoad: ({ search }) => {
    const s = search as Record<string, string | undefined>;
    throw redirect({ to: "/bi-financeiro", search: { ...s, aba: s.aba ?? "geral" } });
  },
});
