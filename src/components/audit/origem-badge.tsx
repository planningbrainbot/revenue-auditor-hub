import type { OrigemBase } from "./data-context";

export function OrigemBadge({ value }: { value: OrigemBase }) {
  if (value === "Base Antiga") {
    return (
      <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
        Base Antiga
      </span>
    );
  }
  if (value === "Base Nova") {
    return (
      <span className="inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
        Base Nova
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
      Sem cadastro
    </span>
  );
}

export type OrigemFilter = "" | "Base Nova" | "Base Antiga" | "sem";

export function groupByOrigem<T extends { cnpj: string | null }>(
  rows: T[],
  origemFor: (r: T) => OrigemBase,
): { nova: T[]; antiga: T[]; semCadastro: T[] } {
  const nova: T[] = [];
  const antiga: T[] = [];
  const semCadastro: T[] = [];
  for (const r of rows) {
    const o = origemFor(r);
    if (o === "Base Nova") nova.push(r);
    else if (o === "Base Antiga") antiga.push(r);
    else semCadastro.push(r);
  }
  return { nova, antiga, semCadastro };
}
