import { createFileRoute } from "@tanstack/react-router";
import { SegredosView } from "@/components/integracoes/segredos-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/admin/credenciais")({
  component: CredenciaisPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function CredenciaisPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Chaves de Integração"
        descricao="Credenciais dos serviços externos. O valor entra por aqui e não volta para a tela."
      />
      <SegredosView />
    </div>
  );
}
