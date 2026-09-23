import { createFileRoute } from "@tanstack/react-router";
import { EbitOperacionalView } from "@/components/ebit-operacional/ebit-operacional-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/ebit-operacional")({
  component: EbitOperacionalPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function EbitOperacionalPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="EBIT Operacional"
        descricao="Meta: zerar o custo operacional do time via venda de serviços internos para as unidades"
      />
      <EbitOperacionalView />
    </div>
  );
}
