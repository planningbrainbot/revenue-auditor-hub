import { createFileRoute } from "@tanstack/react-router";
import { EbitOperacionalView } from "@/components/ebit-operacional/ebit-operacional-view";
import { MolduraReceita } from "@/components/receita/moldura";

export const Route = createFileRoute("/_authenticated/ebit-operacional")({
  head: () => ({
    meta: [{ title: "EBIT Operacional – Planning" }],
  }),
  component: EbitOperacionalPage,
});

function EbitOperacionalPage() {
  return (
    <MolduraReceita
      titulo="EBIT Operacional"
      pergunta="O que foi vendido cobre o custo operacional do mês?"
      descricao="Meta: zerar o custo operacional do time vendendo serviços internos às unidades. Custo do mês corrente contra o MRR das vendas de serviço confirmadas hoje."
      procedencia={{
        fonte: "Pipe de vendas de serviços às unidades (Pipefy) · planilha Controle de Gastos Geral",
        regua: "custo do mês corrente × MRR vendido hoje",
      }}
    >
      <EbitOperacionalView />
    </MolduraReceita>
  );
}
