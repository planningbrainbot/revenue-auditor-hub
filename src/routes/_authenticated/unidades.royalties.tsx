import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { ApuracaoRoyaltiesContent } from "@/components/royalties/apuracao-royalties-content";
import { MolduraReceita, SeletorMes, useMesNaUrl } from "@/components/receita/moldura";

export const Route = createFileRoute("/_authenticated/unidades/royalties")({
  // O mês mora na URL (N7): a Visão geral e a ficha voltam para cá com ?mes=,
  // e o total da origem bate com o desta lista (N2).
  validateSearch: (search: Record<string, unknown>): { mes?: string } =>
    typeof search.mes === "string" ? { mes: search.mes } : {},
  head: () => ({
    meta: [
      { title: "Apuração de Royalties – Planning" },
      {
        name: "description",
        content: "Apuração mensal de royalties por unidade, do rascunho ao fechamento.",
      },
    ],
  }),
  component: ApuracaoRoyaltiesPage,
});

function ApuracaoRoyaltiesPage() {
  useAuth();
  const [mes, setMes] = useMesNaUrl();
  return (
    <MolduraReceita
      titulo="Apuração de Royalties"
      pergunta="Qual unidade ainda não fechou, faturou ou pagou o repasse deste mês?"
      descricao="Uma apuração por unidade e mês, por caixa (o que o Omie baixou como recebido no mês). Abre no mês anterior, o último encerrado."
      procedencia={{
        fonte: "Apurações de royalties (Supabase) · faturas e títulos no Omie da Planning Partners",
        regua: "caixa",
      }}
      filtros={<SeletorMes mes={mes} aoMudar={setMes} />}
    >
      <GuardaUnidades permissao="view.unidades_rede" nome="a Apuração de Royalties">
        <ApuracaoRoyaltiesContent mes={mes} />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
