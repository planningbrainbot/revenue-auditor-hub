import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { SplitRoyaltiesContent } from "@/components/royalties/split-royalties-content";
import { MolduraReceita } from "@/components/receita/moldura";

type BuscaSplit = { unidade?: string; etapa?: string };

export const Route = createFileRoute("/_authenticated/unidades/split")({
  // Unidade e etapa moram na URL (N7).
  validateSearch: (search: Record<string, unknown>): BuscaSplit => {
    const out: BuscaSplit = {};
    if (typeof search.unidade === "string" && search.unidade) out.unidade = search.unidade;
    if (typeof search.etapa === "string" && search.etapa) out.etapa = search.etapa;
    return out;
  },
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
    <MolduraReceita
      titulo="Split do Asaas"
      pergunta="Quanto de royalty o Asaas reteve e creditou?"
      descricao="Unidades com split ativo, desde a data de ativação de cada uma; uma linha por cliente, da venda ao crédito na matriz. Os totais são por caixa (extrato do Asaas)."
      procedencia={{
        fonte: "Splits do Asaas · títulos do Omie da unidade · vendas do Pipedrive (v_split_cliente, v_split_resumo)",
        regua: "caixa (crédito do split)",
      }}
    >
      <GuardaUnidades permissao="view.royalties_split" nome="o Split do Asaas">
        <SplitRoyaltiesContent />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
