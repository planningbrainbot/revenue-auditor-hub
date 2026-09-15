import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { RoyaltiesHistoricoContent } from "@/components/royalties/royalties-historico-content";

export const Route = createFileRoute("/_authenticated/unidades/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de Royalties – Planning" },
      {
        name: "description",
        content: "Série histórica de royalties por cliente e por unidade, rede toda.",
      },
    ],
  }),
  component: RoyaltiesHistoricoPage,
});

function RoyaltiesHistoricoPage() {
  useAuth();
  return (
    <AppShell
      title="Histórico de Royalties"
      subtitle="Evolução do valor apurado por cliente e por unidade ao longo dos meses"
    >
      <GuardaUnidades permissao="view.royalties_historico" nome="o Histórico de Royalties">
        <RoyaltiesHistoricoContent />
      </GuardaUnidades>
    </AppShell>
  );
}
