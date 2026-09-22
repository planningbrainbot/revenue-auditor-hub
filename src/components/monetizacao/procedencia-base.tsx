import { PROCEDENCIAS, PROCEDENCIA_EXPLICACAO, procedencia } from "@/lib/monetizacao/portfolio";
import type { Procedencia } from "@/lib/monetizacao/portfolio";
import type { Conta } from "@/lib/monetizacao/types";
import { number } from "./common";

/**
 * O rodapé de procedência da carteira — mesmo papel que o `ProcedenciaFooter` da fila do Cella:
 * a tela declara de onde conhece o que mostra, em vez de afirmar censo.
 *
 * Existe porque enriquecer faturamento (22/09) expôs um vazio que o número sozinho esconde: a
 * régua de cada produto pergunta porte, regime e faturamento, e **não** pergunta se a empresa é
 * cliente. Como 6.162 das 9.992 contas entraram pelo ERP Omie da unidade — cadastro que inclui
 * quem a unidade paga —, a régua aprova fornecedor grande com a mesma naturalidade com que
 * aprova cliente.
 *
 * Não é um alerta. Lacuna de fonte é assunto da tela de auditoria (decisão de 22/09); aqui é
 * informação de origem, na cor do texto comum.
 */
export function ProcedenciaBase({ accounts }: { accounts: Conta[] }) {
  const n = accounts.reduce(
    (acc, a) => ({ ...acc, [procedencia(a)]: (acc[procedencia(a)] ?? 0) + 1 }),
    {} as Record<Procedencia, number>,
  );
  const ordem: Procedencia[] = ["ecd", "contrato", "pipefy", "omie"];
  return (
    <div className="space-y-1 rounded-lg border px-4 py-3 text-xs text-muted-foreground">
      <p>
        <strong className="font-medium text-foreground">Por onde estas empresas entraram.</strong>{" "}
        {ordem
          .filter((p) => n[p])
          .map((p) => `${PROCEDENCIAS[p]} ${number(n[p])}`)
          .join(" · ")}
        .
      </p>
      <p>
        As portas não valem o mesmo. {PROCEDENCIA_EXPLICACAO.omie} Por isso essas aparecem
        separadas na lista de cada produto, e não entram na contagem de aptas.
      </p>
      <p>
        Estar no Pipefy também não decide: a base tem hotel e operadora de telefonia cadastrados
        lá, e tem cliente de verdade que só aparece pela escrituração contábil. Quem sabe dizer é
        a unidade.
      </p>
    </div>
  );
}
