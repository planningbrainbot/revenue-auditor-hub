import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/planning";
import { DreProjetadaView } from "@/components/financeiro-partners/dre-projetada";
import { FxcView } from "@/components/financeiro-partners/fxc-view";
import { DreRealizadaView } from "@/components/financeiro-partners/dre-realizada-view";
import { ContasReceberView } from "@/components/financeiro-partners/contas-receber-view";
import { PagamentosView } from "@/components/financeiro-partners/pagamentos-view";

type TabId = "dre" | "dre-realizada" | "fcx" | "contas-receber" | "pagamentos";

export const Route = createFileRoute("/_authenticated/financeiro-partners")({
  head: () => ({
    meta: [
      { title: "Financeiro Partners · Planning Brain" },
      {
        name: "description",
        content:
          "Visão consolidada: DRE projetada, DRE realizada, FCx (fluxo de caixa realizado), contas a receber e recebimentos da Planning Partners.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => {
    const t = search.tab;
    const valid: TabId[] = ["dre", "dre-realizada", "fcx", "contas-receber", "pagamentos"];
    return { tab: (valid.includes(t as TabId) ? (t as TabId) : "dre") };
  },
  component: FinanceiroPartnersPage,
});

const TABS = [
  { id: "dre", label: "DRE Projetada" },
  { id: "dre-realizada", label: "DRE Realizada" },
  { id: "fcx", label: "FCx" },
  { id: "contas-receber", label: "Contas a Receber" },
  { id: "pagamentos", label: "Recebimentos" },
] as const;

function FinanceiroPartnersPage() {
  const { tab } = useSearch({ from: "/_authenticated/financeiro-partners" });

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          titulo="Financeiro Partners"
          pergunta="Como está o dinheiro da Planning Partners, projetado e realizado?"
          descricao={
            <>
              Tela fora do menu desde 14/09/2026: a área Partners foi dissolvida, a DRE e o fluxo de
              caixa vivem no cockpit do Financeiro e o resto foi para{" "}
              <Link
                to="/receita-overview"
                className="rounded-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Receita e Repasses › Visão geral
              </Link>
              . Continua aberta por link direto.
            </>
          }
        />
      </div>
      <div className="border-b bg-card/50 px-4 pt-2">
        <nav className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <Link
                key={t.id}
                to="/financeiro-partners"
                search={{ tab: t.id }}
                className={cn(
                  "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex-1">
        {tab === "dre" && <DreProjetadaView />}
        {tab === "dre-realizada" && <DreRealizadaView />}
        {tab === "fcx" && <FxcView />}
        {tab === "contas-receber" && <ContasReceberView />}
        {tab === "pagamentos" && <PagamentosView />}
      </div>
    </div>
  );
}
