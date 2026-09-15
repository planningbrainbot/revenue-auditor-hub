import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { ApuracaoRoyaltiesContent } from "@/components/royalties/apuracao-royalties-content";

export const Route = createFileRoute("/_authenticated/unidades/royalties")({
  head: () => ({
    meta: [
      { title: "Apuração de Royalties – Planning" },
      {
        name: "description",
        content: "Apuração mensal de royalties por unidade, do rascunho ao fechamento.",
      },
    ],
  }),
  component: ApuracaoRoyaltiesPage,
});

function ApuracaoRoyaltiesPage() {
  useAuth();
  return (
    <AppShell
      title="Apuração de Royalties"
      subtitle="Fechamento mensal por unidade: base apurada, percentual aplicado e valor a repassar"
    >
      <GuardaUnidades permissao="view.unidades_rede" nome="a Apuração de Royalties">
        <ApuracaoRoyaltiesContent />
      </GuardaUnidades>
    </AppShell>
  );
}
