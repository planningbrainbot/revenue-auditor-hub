import { createFileRoute } from "@tanstack/react-router";
import { NpsPainelTab } from "@/components/nps/nps-painel-tab";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/nps")({
  component: NpsPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function NpsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="NPS"
        descricao="Análise das respostas da pesquisa de satisfação — NPS/CSAT, evolução, por unidade e respostas"
      />

      <NpsPainelTab />
    </div>
  );
}
