import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { ComissoesContent } from "@/components/page-content/comissoes-content";
import { MolduraReceita } from "@/components/receita/moldura";

type BuscaComissoes = { q?: string; closer?: string; sdr?: string; status?: string; base?: string };

const texto = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authenticated/comissoes")({
  // Busca, Closer, SDR, status do 1º pagamento e base moram na URL (N7).
  validateSearch: (search: Record<string, unknown>): BuscaComissoes => {
    const out: BuscaComissoes = {};
    for (const k of ["q", "closer", "sdr", "status", "base"] as const) {
      const v = texto(search[k]);
      if (v) out[k] = v;
    }
    return out;
  },
  head: () => ({
    meta: [{ title: "Comissões · Planning Brain" }],
  }),
  component: ComissoesPage,
});

function ComissoesPage() {
  useAuth();
  return (
    <MolduraReceita
      titulo="Comissões"
      pergunta="Quais vendas já pagaram e têm closer e SDR para comissionar?"
      descricao="Vendas ganhas no Pipedrive (franquias) × 1º pagamento recebido no Omie, por Closer e SDR. Todo o histórico, sem recorte de mês."
      procedencia={{
        fonte:
          "Pipedrive (vendas e contratos) × contas a receber do Omie · os recebimentos são lidos em até 1.000 títulos; 'Sem pagamento' pode estar errado",
        regua: "1º pagamento (caixa)",
      }}
    >
      <ComissoesContent />
    </MolduraReceita>
  );
}
