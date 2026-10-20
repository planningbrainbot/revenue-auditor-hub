import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { FunilRecebidoContent } from "@/components/receita/funil-recebido-content";
import { MolduraReceita } from "@/components/receita/moldura";

type BuscaFunilRecebido = { visao?: string; unidade?: string; de?: string; ate?: string };

const MES = /^\d{4}-\d{2}$/;

export const Route = createFileRoute("/_authenticated/unidades/funil-recebido")({
  // Visão, unidade e período moram na URL (N7).
  validateSearch: (search: Record<string, unknown>): BuscaFunilRecebido => {
    const out: BuscaFunilRecebido = {};
    for (const k of ["visao", "unidade"] as const)
      if (typeof search[k] === "string" && search[k]) out[k] = search[k] as string;
    if (typeof search.de === "string" && MES.test(search.de)) out.de = search.de;
    if (typeof search.ate === "string" && MES.test(search.ate)) out.ate = search.ate;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Venda ao Recebido – Planning" },
      {
        name: "description",
        content:
          "Vendas, contratos e o que cada unidade já recebeu dos clientes; CAC adiantado contra o recebido.",
      },
    ],
  }),
  component: FunilRecebidoPage,
});

function FunilRecebidoPage() {
  useAuth();
  return (
    <MolduraReceita
      titulo="Venda ao Recebido"
      pergunta="Quanto cada unidade vendeu, contratou e já recebeu?"
      descricao="Todas as unidades, sem royalty. Sem split, o recebido vem das apurações de royalties; com split, depois da última apuração, dos boletos pagos no Omie da unidade. Nas unidades com CAC, o CAC cobrado contra o que os mesmos clientes já pagaram."
      procedencia={{
        fonte: "Pipedrive e Pipefy (contratos) · apurações de royalties e CAC · Omie da unidade",
        regua: "fluxo do mês; recebido pelo mês da apuração ou do vencimento do boleto",
      }}
    >
      {/* Chave própria, na área Receita: concedida pessoa a pessoa em Permissões. */}
      <GuardaUnidades permissao="view.funil_recebido" nome="o funil da venda ao recebido">
        <FunilRecebidoContent />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
