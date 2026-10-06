import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { FinanceiroSemanal } from "@/components/receita/financeiro-semanal";
import { Carregando } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/financeiro-semanal")({
  head: () => ({
    meta: [
      { title: "Financeiro semanal – Planning" },
      {
        name: "description",
        content:
          "Caixa da Planning Partners na semana e no mês, vencido a receber, resultado mês a mês e despesas por categoria.",
      },
    ],
  }),
  component: FinanceiroSemanalPage,
});

/**
 * O reporte financeiro semanal do CEO, que até 06/10/2026 só existia como artifact no claude.ai
 * lendo um Google Doc. O portão vem antes da consulta, como no resto da área.
 */
function FinanceiroSemanalPage() {
  useAuth();
  const { temArea, loading } = usePermissions();

  if (loading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="kpis" />
      </div>
    );
  if (!temArea("receita")) return <SemAcessoArea area="Receita e Repasses" />;

  return <FinanceiroSemanal />;
}
