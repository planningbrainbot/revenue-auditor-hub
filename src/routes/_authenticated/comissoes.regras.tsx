import { createFileRoute } from "@tanstack/react-router";
import { EstadoSemAcesso } from "@/components/planning";
import { Pagina } from "@/components/comissoes/comum";
import { usePermissions } from "@/hooks/use-permissions";

// As regras do PRD wiki/prds/2026-10-comissoes-v1.md (seção 4) em linguagem do time comercial.

export const Route = createFileRoute("/_authenticated/comissoes/regras")({
  head: () => ({ meta: [{ title: "Regras das comissões · Planning Brain" }] }),
  component: Regras,
});

const REGRAS: { titulo: string; texto: string }[] = [
  {
    titulo: "Quem entra",
    texto: "Contratos do pipe Inside Sales, com o closer e o SDR registrados no Pipedrive.",
  },
  {
    titulo: "Valor",
    texto:
      "Não muda: closer de 2% a 10% do honorário mensal, conforme a meta do mês da venda, e SDR 5%. O valor é dividido em duas metades iguais.",
  },
  {
    titulo: "1ª metade",
    texto:
      "Sai quando a apuração da unidade fecha com a 1ª parcela daquele cliente. Não espera a unidade pagar a fatura.",
  },
  {
    titulo: "2ª metade",
    texto:
      "Sai quando a apuração fecha com a 2ª parcela, que só entra depois que o cliente paga o 1º honorário. Segue a mesma pessoa e o mesmo percentual da 1ª.",
  },
  {
    titulo: "Parcela integral",
    texto:
      "Quando o cliente já pagou na assinatura, a apuração fecha com a parcela inteira e as duas metades saem juntas.",
  },
  {
    titulo: "Recife",
    texto:
      "Sem adiantamento: a 1ª metade conta pela data da assinatura, registrada pelo financeiro, e a 2ª sai quando a apuração fecha com o cliente.",
  },
  {
    titulo: "Onde não há CAC",
    texto:
      "Unidades sem CAC, contratos da Matriz, de Goiânia e do BPO Financeiro e contratos abaixo do mínimo da unidade: a comissão inteira sai depois que o cliente paga o 1º honorário.",
  },
  {
    titulo: "Calendário",
    texto:
      "O financeiro fecha as apurações até o dia 5. Os líderes revisam até o dia 10 (ou o dia útil anterior); antes disso o valor aparece como Em revisão. O financeiro envia ao Departamento Pessoal até o dia 11 (ou o próximo dia útil), e o pagamento sai pelo iFood no dia 20.",
  },
  {
    titulo: "Depois do prazo",
    texto:
      "O que chega depois da liberação vai para o pagamento seguinte. Correção numa linha já liberada vira ajuste no próximo pagamento.",
  },
  {
    titulo: "Bônus",
    texto: "Não depende da apuração. Os líderes lançam com o motivo e ele sai no mesmo pagamento.",
  },
  {
    titulo: "Estorno",
    texto:
      "Se o cliente sai depois de uma metade paga, ela é descontada no pagamento seguinte e você vê o desconto. Se foi acordo da Partners com a unidade, não há desconto.",
  },
  {
    titulo: "Regra antiga",
    texto:
      "Vendas ganhas antes de 01/10/2026 foram pagas pela planilha. Só entram aqui se os líderes incluírem.",
  },
];

function Regras() {
  const perms = usePermissions();
  const titulo = "Regras";
  const pergunta = "Como a comissão é calculada e quando é paga?";
  if (!perms.loading && !perms.can("view.comissoes"))
    return (
      <Pagina titulo={titulo} pergunta={pergunta}>
        <EstadoSemAcesso oQueFalta="view.comissoes (área Comissões, concedida pela administração)" />
      </Pagina>
    );
  return (
    <Pagina
      titulo={titulo}
      pergunta={pergunta}
      descricao="Vale a partir do pagamento de novembro de 2026."
    >
      <dl className="grid gap-3 md:grid-cols-2">
        {REGRAS.map((r) => (
          <div key={r.titulo} className="space-y-1 rounded-lg border bg-card p-4">
            <dt className="font-semibold">{r.titulo}</dt>
            <dd className="text-muted-foreground">{r.texto}</dd>
          </div>
        ))}
      </dl>
    </Pagina>
  );
}
