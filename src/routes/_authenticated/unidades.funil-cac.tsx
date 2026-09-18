import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { FunilCacContent } from "@/components/cac/funil-cac-content";

export const Route = createFileRoute("/_authenticated/unidades/funil-cac")({
  head: () => ({
    meta: [
      { title: "Funil de CAC – Planning" },
      {
        name: "description",
        content:
          "Da venda ganha à cobrança concluída: contrato assinado, card de cobrança, honorário lançado e o que falta cobrar.",
      },
    ],
  }),
  component: FunilCacPage,
});

function FunilCacPage() {
  useAuth();
  return (
    <AppShell
      title="Funil de CAC"
      subtitle="Da venda ganha à cobrança concluída, com o que vaza em cada etapa"
    >
      {/* Mesma chave de Regras da Rede e Apuração de Royalties: é o mesmo
          público, e a tela antiga de CAC também usava esta. */}
      <GuardaUnidades permissao="view.unidades_rede" nome="o Funil de CAC">
        <FunilCacContent />
      </GuardaUnidades>
    </AppShell>
  );
}
