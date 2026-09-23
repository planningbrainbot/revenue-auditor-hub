import { FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Comparacao, Indicador } from "@/lib/cockpit-ceo/contrato";
import { EstadoBadge, valorCurto } from "./estado";

const curto = (c: Comparacao, i: Indicador) => {
  const rotulo = c.rotulo.startsWith("Período anterior")
    ? "Anterior"
    : c.rotulo.replace("Ritmo esperado da", "Ritmo da");
  return `${rotulo} ${valorCurto(c.referencia, i.unidade)}`;
};

export function CartaoIndicador({
  indicador: i,
  onAbrir,
}: {
  indicador: Indicador;
  onAbrir: () => void;
}) {
  const comparacoes = i.comparacoes.filter(
    (c) => c.estado !== "nao_apurado" || c.referencia !== null,
  );
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`${i.titulo}: abrir composição`}
      className="group flex min-h-[132px] flex-col rounded-xl border bg-card p-4 text-left transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {FRENTES[i.frente].titulo}
        </span>
        {i.estado !== "disponivel" && <EstadoBadge estado={i.estado} />}
      </span>
      <span className="mt-1 text-sm font-medium leading-snug">{i.titulo}</span>
      <span className="mt-auto flex items-baseline gap-2 pt-2">
        <span className="text-3xl font-semibold tabular-nums">
          {valorCurto(i.valor, i.unidade)}
        </span>
        {i.unidade !== "reais" && i.valor !== null && (
          <span className="text-xs text-muted-foreground">{i.unidade}</span>
        )}
      </span>
      <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {i.valor === null && i.lacuna
          ? `Depende de: ${i.lacuna.responsavel}`
          : comparacoes.length
            ? comparacoes.map((c) => curto(c, i)).join(" · ")
            : i.periodo
              ? "Sem comparação disponível"
              : "Fotografia de agora"}
      </span>
    </button>
  );
}
