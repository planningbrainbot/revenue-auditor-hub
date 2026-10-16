import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { FunilRedeContent } from "@/components/receita/funil-rede-content";
import { MolduraReceita } from "@/components/receita/moldura";

type BuscaFunilRede = {
  visao?: string;
  unidade?: string;
  canal?: string;
  situacao?: string;
  de?: string;
  ate?: string;
  categoria?: string;
  regua?: string;
  carencia?: string;
};

const MES = /^\d{4}-\d{2}$/;
const TEXTO = ["visao", "unidade", "canal", "situacao", "categoria", "regua", "carencia"] as const;

export const Route = createFileRoute("/_authenticated/unidades/funil-rede")({
  // Visão, unidade, canal, situação, período e categoria moram na URL (N7).
  validateSearch: (search: Record<string, unknown>): BuscaFunilRede => {
    const out: BuscaFunilRede = {};
    for (const k of TEXTO)
      if (typeof search[k] === "string" && search[k]) out[k] = search[k] as string;
    if (typeof search.de === "string" && MES.test(search.de)) out.de = search.de;
    if (typeof search.ate === "string" && MES.test(search.ate)) out.ate = search.ate;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Funil da Rede – Planning" },
      {
        name: "description",
        content:
          "Da venda ao royalty nas unidades com split: funil, gap de royalty e conciliação de MRR.",
      },
    ],
  }),
  component: FunilRedePage,
});

function FunilRedePage() {
  useAuth();
  return (
    <MolduraReceita
      titulo="Funil da Rede"
      pergunta="Da venda ao royalty, onde a rede está perdendo dinheiro?"
      descricao="Só unidades com split ativo, cada uma a partir da data do split. Vendas dos pipes Sócios (Hunter) e Inside Sales, contratos, boletos do Omie da unidade e royalty retido pelo Asaas."
      procedencia={{
        fonte:
          "Pipedrive (contratos) · Pipefy (contratos e tratativas) · Omie da unidade · splits do Asaas",
        regua: "fluxo do mês, vencimento do boleto",
      }}
    >
      {/* Mesmo público do Split do Asaas. */}
      <GuardaUnidades permissao="view.royalties_split" nome="o Funil da Rede">
        <FunilRedeContent />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
