import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { ApuracaoCacContent } from "@/components/cac/apuracao-cac-content";

export const Route = createFileRoute("/_authenticated/unidades/cac")({
  head: () => ({
    meta: [
      { title: "Apuração de CAC – Planning" },
      {
        name: "description",
        content: "CAC por unidade: contratos assinados, custo de aquisição e o que é devido.",
      },
    ],
  }),
  component: ApuracaoCacPage,
});

function ApuracaoCacPage() {
  useAuth();
  return (
    <AppShell
      title="Apuração de CAC"
      subtitle="Custo de aquisição por unidade, com o gate de contrato assinado no Pipefy"
    >
      <GuardaUnidades permissao="view.unidades_rede" nome="a Apuração de CAC">
        <ApuracaoCacContent />
      </GuardaUnidades>
    </AppShell>
  );
}
