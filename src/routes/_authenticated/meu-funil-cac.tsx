import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { FunilCacContent } from "@/components/cac/funil-cac-content";
import { MolduraReceita } from "@/components/receita/moldura";

// A visão do sócio regional sobre o Funil de CAC (/unidades/funil-cac), pedida
// em 05/10/2026. Não há filtro de unidade aqui: quem recorta é a própria
// `v_cac_funil`, que para a chave `view.meu_funil_cac` só devolve a unidade do
// usuário e só se ela paga CAC (migration 20261005120000). Unidade sem CAC não
// vê o item no menu nem linha nenhuma na tela.
type BuscaMeuFunilCac = { etapa?: string; churn?: boolean; de?: string; ate?: string };

const MES = /^\d{4}-\d{2}$/;

export const Route = createFileRoute("/_authenticated/meu-funil-cac")({
  validateSearch: (search: Record<string, unknown>): BuscaMeuFunilCac => {
    const out: BuscaMeuFunilCac = {};
    if (typeof search.etapa === "string" && search.etapa) out.etapa = search.etapa;
    if (search.churn === true || search.churn === "true") out.churn = true;
    if (typeof search.de === "string" && MES.test(search.de)) out.de = search.de;
    if (typeof search.ate === "string" && MES.test(search.ate)) out.ate = search.ate;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Funil de CAC da unidade – Planning" },
      {
        name: "description",
        content:
          "Da venda ganha à cobrança concluída, só da sua unidade: contrato assinado, card de cobrança, honorário lançado e o que falta cobrar.",
      },
    ],
  }),
  component: MeuFunilCacPage,
});

function MeuFunilCacPage() {
  useAuth();
  const { unidade } = usePermissions();
  return (
    <MolduraReceita
      titulo="Funil de CAC"
      pergunta="Quanto de CAC a minha unidade já pagou, e quanto falta?"
      descricao={
        <>
          Vendas do Inside Sales ganhas desde 01/02/2026 para{" "}
          {unidade ? <strong>{unidade}</strong> : "a unidade"}, da venda ao card de cobrança e ao
          que entrou. O grão é a venda; card sem venda aparece como etapa própria.
        </>
      }
      procedencia={{
        fonte:
          "Vendas e contratos do Ops × pipe Cobrança CAC (Pipefy) · v_cac_funil e v_cac_funil_resumo",
        regua: "venda ganha desde 01/02/2026",
      }}
    >
      <GuardaUnidades permissao="view.meu_funil_cac" nome="o Funil de CAC da unidade">
        <FunilCacContent escopo="unidade" />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
