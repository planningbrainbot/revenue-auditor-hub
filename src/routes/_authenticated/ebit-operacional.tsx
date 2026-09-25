import { createFileRoute } from "@tanstack/react-router";
import { EbitOperacionalView } from "@/components/ebit-operacional/ebit-operacional-view";

export const Route = createFileRoute("/_authenticated/ebit-operacional")({
  head: () => ({
    meta: [{ title: "EBIT Operacional – Planning" }],
  }),
  component: EbitOperacionalPage,
});

// O cabeçalho (MolduraReceita) mora na view: o "Forçar atualização" das ações
// depende da mutação dela.
function EbitOperacionalPage() {
  return <EbitOperacionalView />;
}
