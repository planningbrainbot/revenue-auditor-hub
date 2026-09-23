import { ESTADOS, formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { Estado, UnidadeContagem } from "@/lib/cockpit-ceo/contrato";
import { COBERTURAS } from "@/lib/cockpit-ceo/perguntas";
import type { Cobertura } from "@/lib/cockpit-ceo/perguntas";

const COR_ESTADO: Record<Estado, string> = {
  disponivel: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  parcial: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  nao_apurado: "border-border bg-muted text-muted-foreground",
  fonte_indisponivel: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  acesso_insuficiente: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${COR_ESTADO[estado]}`}
    >
      {ESTADOS[estado]}
    </span>
  );
}

const COR_COBERTURA: Record<Cobertura, string> = {
  verificada: COR_ESTADO.disponivel,
  implementada_nao_homologada: COR_ESTADO.parcial,
  depende_dado: COR_ESTADO.nao_apurado,
  depende_decisao: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

export function CoberturaBadge({ cobertura }: { cobertura: Cobertura }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${COR_COBERTURA[cobertura]}`}
    >
      {COBERTURAS[cobertura]}
    </span>
  );
}

export function SinteticoBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300">
      Dados sintéticos
    </span>
  );
}

const compacto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 1,
});

/** No cartão, reais grandes em forma curta; a composição mostra o valor inteiro. */
export function valorCurto(valor: number | null, unidade: UnidadeContagem): string {
  if (valor !== null && unidade === "reais" && Math.abs(valor) >= 100_000)
    return compacto.format(valor).replace(/\u00a0/g, " ");
  return formatarNumero(valor, unidade);
}
