import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { SplitRoyaltiesContent } from "@/components/royalties/split-royalties-content";

export const Route = createFileRoute("/_authenticated/unidades/split")({
  head: () => ({
    meta: [
      { title: "Split do Asaas – Planning" },
      {
        name: "description",
        content: "Royalty retido na fonte pelo Asaas: título, valor retido e a cadeia da venda.",
      },
    ],
  }),
  component: SplitRoyaltiesPage,
});

function SplitRoyaltiesPage() {
  useAuth();
  return (
    <AppShell
      title="Split do Asaas"
      subtitle="Royalty retido na fonte: título x valor retido e a cadeia da venda até o crédito na matriz"
    >
      <GuardaUnidades permissao="view.royalties_split" nome="o Split do Asaas">
        <SplitRoyaltiesContent />
      </GuardaUnidades>
    </AppShell>
  );
}
