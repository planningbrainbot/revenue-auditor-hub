import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { FunilCacContent } from "@/components/cac/funil-cac-content";
import { MolduraReceita } from "@/components/receita/moldura";

type BuscaFunilCac = { unidade?: string; etapa?: string; churn?: boolean };

export const Route = createFileRoute("/_authenticated/unidades/funil-cac")({
  // Unidade, etapa e "só churn" moram na URL (N7): recarregar ou colar o link
  // reproduz o recorte.
  validateSearch: (search: Record<string, unknown>): BuscaFunilCac => {
    const out: BuscaFunilCac = {};
    if (typeof search.unidade === "string" && search.unidade) out.unidade = search.unidade;
    if (typeof search.etapa === "string" && search.etapa) out.etapa = search.etapa;
    if (search.churn === true || search.churn === "true") out.churn = true;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Funil de CAC – Planning" },
      {
        name: "description",
        content:
          "Da venda ganha à cobrança concluída: contrato assinado, card de cobrança, honorário lançado e o que falta cobrar.",
      },
    ],
  }),
  component: FunilCacPage,
});

function FunilCacPage() {
  useAuth();
  return (
    <MolduraReceita
      titulo="Funil de CAC"
      pergunta="Quanto de CAC a rede já cobrou, e quanto falta cobrar?"
      descricao="Vendas do Inside Sales ganhas desde 01/02/2026 (período fixo, sem seletor de mês), da venda ao card de cobrança e ao que entrou. O grão é a venda; card sem venda aparece como etapa própria."
      procedencia={{
        fonte: "Vendas e contratos do Ops × pipe Cobrança CAC (Pipefy) · v_cac_funil e v_cac_funil_resumo",
        regua: "venda ganha desde 01/02/2026",
      }}
    >
      {/* Mesma chave de Regras da Rede e Apuração de Royalties: é o mesmo
          público, e a tela antiga de CAC também usava esta. */}
      <GuardaUnidades permissao="view.unidades_rede" nome="o Funil de CAC">
        <FunilCacContent />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
