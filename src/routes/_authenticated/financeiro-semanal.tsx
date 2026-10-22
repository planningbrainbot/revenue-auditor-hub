import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { Saidas } from "@/components/receita/saidas";
import { Carregando } from "@/components/planning";
import { AREA_BI_FINANCEIRO } from "@/lib/bi-financeiro-acesso";

export const Route = createFileRoute("/_authenticated/financeiro-semanal")({
  head: () => ({
    meta: [
      { title: "Previsibilidade de caixa – Planning" },
      {
        name: "description",
        content:
          "O que a Planning Partners tem a pagar nos próximos 7, 15 ou 30 dias, dia a dia, e se o saldo em conta cobre.",
      },
    ],
  }),
  component: SaidasPage,
});

/**
 * Saídas da Planning Partners pelo vencimento. Substituiu o "Caixa da semana" (reporte do CEO) em
 * 22/10/2026, trazendo para cá o artifact "Saídas Planning Partners". O portão vem antes da
 * consulta, como no resto da área.
 */
function SaidasPage() {
  useAuth();
  const { temArea, loading } = usePermissions();

  if (loading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="kpis" />
      </div>
    );
  if (!temArea(AREA_BI_FINANCEIRO)) return <SemAcessoArea area="BI Financeiro" />;

  return <Saidas />;
}
