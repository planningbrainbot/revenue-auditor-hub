import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { SplitRoyaltiesContent } from "@/components/royalties/split-royalties-content";
import { MolduraReceita } from "@/components/receita/moldura";

// A visão do sócio regional sobre o Split do Asaas (/unidades/split), pedida em
// 08/10/2026. Não há filtro de unidade aqui: quem recorta é a própria view, que
// para a chave `view.meu_split` só devolve a unidade do usuário (migration
// 20261008180000). Unidade sem split ativo não vê o item no menu.
type BuscaMeuSplit = { etapa?: string; de?: string; ate?: string };

const MES = /^\d{4}-\d{2}$/;

export const Route = createFileRoute("/_authenticated/meu-split")({
  validateSearch: (search: Record<string, unknown>): BuscaMeuSplit => {
    const out: BuscaMeuSplit = {};
    if (typeof search.etapa === "string" && search.etapa) out.etapa = search.etapa;
    if (typeof search.de === "string" && MES.test(search.de)) out.de = search.de;
    if (typeof search.ate === "string" && MES.test(search.ate)) out.ate = search.ate;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Split do Asaas da unidade – Planning" },
      {
        name: "description",
        content:
          "Royalty retido na fonte pelo Asaas, só da sua unidade: boleto, valor retido e a cadeia da venda.",
      },
    ],
  }),
  component: MeuSplitPage,
});

function MeuSplitPage() {
  useAuth();
  const { unidade } = usePermissions();
  return (
    <MolduraReceita
      titulo="Split do Asaas"
      pergunta="Quanto de royalty o Asaas reteve dos boletos da minha unidade?"
      descricao={
        <>
          Boletos de {unidade ? <strong>{unidade}</strong> : "a unidade"} desde a ativação do split;
          uma linha por cliente, da venda ao crédito na matriz. Os totais são por caixa (extrato do
          Asaas).
        </>
      }
      procedencia={{
        fonte:
          "Splits do Asaas · títulos do Omie da unidade · vendas do Pipedrive (v_split_cliente, v_split_resumo)",
        regua: "caixa (crédito do split)",
      }}
    >
      <GuardaUnidades permissao="view.meu_split" nome="o Split do Asaas da unidade">
        <SplitRoyaltiesContent escopo="unidade" />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
