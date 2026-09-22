import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { RedeContent } from "@/components/page-content/rede-content";

// Enquanto foram abas, as outras quatro telas viviam em /unidades?tab=X. Esses
// links já circularam em e-mail, favorito e notificação, então a URL antiga
// segue de pé e cai na página nova — mesmo tratamento que rede.tsx e
// royalties.index.tsx deram às páginas absorvidas na fusão anterior.
// `historico` caiu em 22/09/2026 junto com a página: manda pra Apuração de
// Royalties, mesmo destino de /royalties.
const DESTINO_DA_ABA = {
  royalties: "/unidades/royalties",
  historico: "/unidades/royalties",
  split: "/unidades/split",
} as const;

export const Route = createFileRoute("/_authenticated/unidades/")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" ? { tab: search.tab } : {},
  beforeLoad: ({ search }) => {
    const destino = DESTINO_DA_ABA[search.tab as keyof typeof DESTINO_DA_ABA];
    if (destino) throw redirect({ to: destino, replace: true });
    // ?tab=regras é esta mesma página: some com o parâmetro para não deixar
    // duas URLs equivalentes circulando.
    if (search.tab) throw redirect({ to: "/unidades", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Regras da Rede – Planning" },
      {
        name: "description",
        content: "Cadastro das unidades e as regras de royalties que valem para cada uma.",
      },
    ],
  }),
  component: RegrasDaRedePage,
});

function RegrasDaRedePage() {
  useAuth();
  return (
    <AppShell
      title="Regras da Rede"
      subtitle="Unidades da rede e o percentual de royalty que vale para cada contrato"
    >
      <GuardaUnidades permissao="view.unidades_rede" nome="as Regras da Rede">
        <RedeContent />
      </GuardaUnidades>
    </AppShell>
  );
}
