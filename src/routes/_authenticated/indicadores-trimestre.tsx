import { createFileRoute } from "@tanstack/react-router";
import { IndicadoresTrimestreView } from "@/components/indicadores-trimestre/indicadores-trimestre-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/indicadores-trimestre")({
  head: () => ({ meta: [{ title: "Indicadores do Trimestre – Planning" }] }),
  component: IndicadoresTrimestrePage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function IndicadoresTrimestrePage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Indicadores do Trimestre"
        descricao="Os dois slides do deck de Expansão — financeiro e comercial — por unidade"
      />
      <IndicadoresTrimestreView />
    </div>
  );
}
