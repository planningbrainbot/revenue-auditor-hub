import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { DreCaixaPagina } from "@/components/receita/dre-caixa";
import { Carregando } from "@/components/planning";
import { AREA_BI_FINANCEIRO } from "@/lib/bi-financeiro-acesso";

export const Route = createFileRoute("/_authenticated/bi-financeiro")({
  head: () => ({
    meta: [
      { title: "BI Financeiro – Planning" },
      {
        name: "description",
        content:
          "Resultado da Planning Partners contra o Forecast Oficial, DRE, caixa e fôlego sem o investidor, mês a mês.",
      },
    ],
  }),
  component: BiFinanceiroRota,
});

/** Área BI Financeiro. Contrato: docs/design/contratos/bi-financeiro.md. O assunto vem de `?aba=`. */
function BiFinanceiroRota() {
  useAuth();
  const { temArea, loading } = usePermissions();

  if (loading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="kpis" />
      </div>
    );
  if (!temArea(AREA_BI_FINANCEIRO)) return <SemAcessoArea area="BI Financeiro" />;

  return <DreCaixaPagina />;
}
