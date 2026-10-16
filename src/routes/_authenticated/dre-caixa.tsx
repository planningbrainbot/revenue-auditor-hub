import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { DreCaixaPagina } from "@/components/receita/dre-caixa";
import { Carregando } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/dre-caixa")({
  head: () => ({
    meta: [
      { title: "BI Financeiro – Planning" },
      {
        name: "description",
        content:
          "DRE e fluxo de caixa da Planning Partners mês a mês: a ponte entre resultado e caixa, o que mudou contra o mês anterior e o que falta conferir.",
      },
    ],
  }),
  component: DreCaixaRota,
});

/** BI Financeiro da Partners. Contrato: docs/design/contratos/dre-caixa.md. */
function DreCaixaRota() {
  useAuth();
  const { temArea, loading } = usePermissions();

  if (loading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="kpis" />
      </div>
    );
  if (!temArea("receita")) return <SemAcessoArea area="Receita e Repasses" />;

  return <DreCaixaPagina />;
}
