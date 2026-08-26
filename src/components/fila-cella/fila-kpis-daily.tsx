import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { KpisDaily } from "@/lib/fila-cella.types";

// Bloco C do §6.2 — os KRs que a daily das 13h30 lê.
//
// REGRA DURA: KR1 e KR2 no MESMO cartão, sempre. 40 abordagens com 0% de
// conversão é falha, não progresso — separá-los deixaria a falha parecer meta
// batida.
//
// Todo indicador mostra `—` quando não é apurável. Nunca `0`: zero é uma
// afirmação, e afirmar errado é o que spec-dash-funil-cella.md:49 proíbe.

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);

function Bloco({
  titulo,
  children,
  ajuda,
}: {
  titulo: string;
  children: React.ReactNode;
  ajuda?: string;
}) {
  const corpo = (
    <Card className="min-w-[180px] flex-1 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      <div className="mt-1">{children}</div>
    </Card>
  );
  if (!ajuda) return corpo;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{corpo}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{ajuda}</TooltipContent>
    </Tooltip>
  );
}

export function FilaKpisDaily({ kpis }: { kpis: KpisDaily | undefined }) {
  const k = kpis;
  const ok = k?.estado === "ok";
  const n = (v: number | null | undefined) => (ok && v != null ? v : "—");

  return (
    <div className="flex flex-wrap gap-3">
      <Bloco
        titulo="KR1 · abordagens  +  KR2 · conversão"
        ajuda="Os dois no mesmo cartão de propósito: 40 abordagens com 0% de conversão é falha, não progresso."
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl font-bold">
            {n(k?.kr1Abordadas)}
            <span className="text-base font-normal text-muted-foreground"> / {k?.kr1Meta ?? 40}</span>
          </span>
          <span className="text-sm text-muted-foreground">contas abordadas no mês</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-xl font-semibold">{ok ? pct(k?.kr2TaxaResposta ?? null) : "—"}</span>
          <span className="text-sm text-muted-foreground">
            resposta · {n(k?.kr2Reunioes)} reunião(ões)
          </span>
        </div>
      </Bloco>

      <Bloco titulo="KR3 · propostas" ajuda="Contas em '6 Proposta enviada' ou além.">
        <span className="text-2xl font-bold">
          {n(k?.kr3Propostas)}
          <span className="text-base font-normal text-muted-foreground"> / {k?.kr3Meta ?? 5}</span>
        </span>
      </Bloco>

      <Bloco
        titulo="Qualidade"
        ajuda="Fração das contas tocadas sem nenhuma das quatro pendências de higiene do playbook §5.6. A definição fechada do KR ainda não existe — se a daily fechar outra, é esta que muda."
      >
        <span className="text-2xl font-bold">{ok ? pct(k?.qualidade ?? null) : "—"}</span>
        <span className="ml-2 text-sm text-muted-foreground">etiquetagem</span>
      </Bloco>
    </div>
  );
}
