import { createFileRoute } from "@tanstack/react-router";
import { IduView } from "@/components/idu/idu-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/idu")({
  head: () => ({ meta: [{ title: "IDU – Planning" }] }),
  component: IduPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function IduPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="IDU"
        descricao="Índice de Desempenho da Unidade — a nota do trimestre e o percentual do forecast que ela libera"
      />
      <IduView />
    </div>
  );
}
