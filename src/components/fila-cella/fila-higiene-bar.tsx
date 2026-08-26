import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { KpisDaily } from "@/lib/fila-cella.types";

// Bloco D do §6.2 — as regras do playbook §5.6 viradas em contador clicável.
// São o KR de QUALIDADE dito em quatro linhas, e a razão de a tela escrever.

export type FiltroHigiene =
  | "sem_proximo_passo"
  | "parados_15d"
  | "perdido_sem_motivo"
  | "passo_vencido";

export function FilaHigieneBar({
  kpis,
  filtro,
  onFiltrar,
}: {
  kpis: KpisDaily | undefined;
  filtro: FiltroHigiene | null;
  onFiltrar: (f: FiltroHigiene | null) => void;
}) {
  const ok = kpis?.estado === "ok";
  const h = kpis?.higiene;

  const itens: { chave: FiltroHigiene; valor: number | null | undefined; rotulo: string }[] = [
    { chave: "sem_proximo_passo", valor: h?.semProximoPasso, rotulo: "sem próximo passo" },
    { chave: "parados_15d", valor: h?.parados15d, rotulo: "parados > 15 dias" },
    { chave: "perdido_sem_motivo", valor: h?.perdidoSemMotivo, rotulo: "perdido sem motivo" },
    { chave: "passo_vencido", valor: h?.passoVencido, rotulo: "próximo passo vencido" },
  ];

  return (
    <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Higiene §5.6
      </span>
      {itens.map((i) => {
        const ativo = filtro === i.chave;
        const valor = ok && i.valor != null ? i.valor : null;
        return (
          <button
            key={i.chave}
            type="button"
            disabled={!ok || !valor}
            onClick={() => onFiltrar(ativo ? null : i.chave)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              ativo
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted disabled:cursor-default disabled:opacity-60",
              valor ? "font-medium" : "text-muted-foreground",
            )}
          >
            <span className="font-semibold">{valor ?? "—"}</span> {i.rotulo}
          </button>
        );
      })}
    </Card>
  );
}
