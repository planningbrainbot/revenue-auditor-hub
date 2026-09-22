import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { ReceitaOverviewContent } from "@/components/receita/receita-overview-content";

export const Route = createFileRoute("/_authenticated/receita-overview")({
  head: () => ({
    meta: [
      { title: "Receita e Repasses – Planning" },
      {
        name: "description",
        content:
          "Abertura da área: o repasse das unidades no mês, o que falta fechar, faturar e receber, e a receita da rede.",
      },
    ],
  }),
  component: ReceitaOverviewPage,
});

/**
 * A porta da área Receita e Repasses.
 *
 * O portão fica antes de qualquer consulta: as tabelas de apuração e de contas
 * a receber são fechadas por RLS, e quem não tem a área via "não carregou" no
 * lugar de "você não tem acesso" — o mesmo defeito que levou o
 * `SemAcessoArea` a existir no Overview da Rede.
 */
function ReceitaOverviewPage() {
  useAuth();
  const { temArea, loading } = usePermissions();

  if (loading) return null;
  if (!temArea("receita")) return <SemAcessoArea area="Receita e Repasses" />;

  return (
    <AppShell
      title="Receita e Repasses"
      subtitle="O repasse do mês, o que falta fechar e cobrar, e a receita da rede"
    >
      <ReceitaOverviewContent />
    </AppShell>
  );
}
