import type { ReactNode } from "react";
import { KpiCard, KpiGrade, type EstadoKpi } from "@/components/planning";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { KpisDaily } from "@/lib/fila-cella.types";

// Bloco C do §6.2 — os KRs que a daily das 13h30 lê.
//
// REGRA DURA: KR1 e KR2 no MESMO cartão, sempre. 40 abordagens com 0% de
// conversão é falha, não progresso — separá-los deixaria a falha parecer meta
// batida. No KpiCard, KR1 é o valor contra a meta e KR2 vem na nota do mesmo
// cartão (N13: KRs que se leem juntos ficam juntos).
//
// Todo indicador mostra `—` quando não é apurável. Nunca `0`: zero é uma
// afirmação, e afirmar errado é o que spec-dash-funil-cella.md:49 proíbe.

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);

function ComAjuda({ ajuda, children }: { ajuda?: string; children: ReactNode }) {
  if (!ajuda) return <>{children}</>;
  // O KpiCard não repassa ref; o gatilho do tooltip precisa de um elemento que repasse.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="h-full">{children}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{ajuda}</TooltipContent>
    </Tooltip>
  );
}

export function FilaKpisDaily({ kpis }: { kpis: KpisDaily | undefined }) {
  const k = kpis;
  const ok = k?.estado === "ok";
  const n = (v: number | null | undefined) => (ok && v != null ? v : "—");
  // Fonte não migrada ou nunca sincronizada é "fonte indisponível", não número
  // ausente; com a fonte ok, null é "não apurado". Enquanto a consulta não
  // volta (`kpis` undefined) segue o "—" de antes: carregando não é nenhum dos
  // dois estados.
  const estadoDe = (v: number | null | undefined): EstadoKpi =>
    !k ? "ok" : !ok ? "indisponivel" : v == null ? "nao-apurado" : "ok";

  return (
    <KpiGrade colunas={3}>
      <ComAjuda ajuda="Os dois no mesmo cartão de propósito: 40 abordagens com 0% de conversão é falha, não progresso.">
        <KpiCard
          rotulo="KR1 · abordagens  +  KR2 · conversão"
          valor={n(k?.kr1Abordadas)}
          unidade="contas abordadas no mês"
          estado={estadoDe(k?.kr1Abordadas)}
          meta={{ valor: k?.kr1Meta ?? 40 }}
          nota={
            <>
              <span className="num font-semibold text-foreground">
                {ok ? pct(k?.kr2TaxaResposta ?? null) : "—"}
              </span>{" "}
              resposta · {n(k?.kr2Reunioes)} reunião(ões)
            </>
          }
        />
      </ComAjuda>

      <ComAjuda ajuda="Contas em '6 Proposta enviada' ou além.">
        <KpiCard
          rotulo="KR3 · propostas"
          valor={n(k?.kr3Propostas)}
          estado={estadoDe(k?.kr3Propostas)}
          meta={{ valor: k?.kr3Meta ?? 5 }}
        />
      </ComAjuda>

      <ComAjuda ajuda="Fração das contas tocadas sem nenhuma das quatro pendências de higiene do playbook §5.6. A definição fechada do KR ainda não existe — se a daily fechar outra, é esta que muda.">
        <KpiCard
          rotulo="Qualidade"
          valor={ok ? pct(k?.qualidade ?? null) : "—"}
          unidade="etiquetagem"
          estado={estadoDe(k?.qualidade)}
        />
      </ComAjuda>
    </KpiGrade>
  );
}
