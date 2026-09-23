import { Target, type LucideIcon } from "lucide-react";
import { AREAS } from "@/lib/areas";

/**
 * Cor, nome e ícone de cada área, para filete, anel e grade de círculos.
 *
 * A cor mora em `--area-<slug>` (src/styles.css) e troca com o tema; aqui só se
 * devolve a referência `var(--…)`, nunca o hex, para o componente não fixar
 * uma cor que o tema claro precisa escurecer (DESIGN.md §3.1).
 *
 * Existe um passo de "slug visual" porque `areaDoCaminho` devolve a área de
 * PERMISSÃO do item, e algumas páginas têm chave própria (`broker_matriz`,
 * `minha_unidade_financeiro`, `admin_financeiro`, `disparos_whatsapp`). Para a
 * cor, o que vale é a área do menu que contém a página.
 */
export const SLUGS_AREA = [
  "rede",
  "clientes",
  "receita",
  "people",
  "monetizacao",
  "broker",
  "minha_unidade",
  "estrategia",
  "admin",
] as const;

export type SlugArea = (typeof SLUGS_AREA)[number];

// `estrategia` existe no banco mas ainda não está em areas.ts (DESIGN.md §3.1).
const FORA_DO_MENU: Record<string, { nome: string; icone: LucideIcon }> = {
  estrategia: { nome: "Estratégia & Execução", icone: Target },
};

function ehSlugArea(s: string): s is SlugArea {
  return (SLUGS_AREA as readonly string[]).includes(s);
}

/** A área do menu que dá cor a um slug de área ou de permissão. */
export function slugVisual(slug: string | null | undefined): SlugArea | null {
  if (!slug) return null;
  if (ehSlugArea(slug)) return slug;
  for (const area of AREAS) {
    for (const grupo of area.grupos) {
      if (grupo.items.some((i) => i.area === slug) && ehSlugArea(area.slug)) return area.slug;
    }
  }
  return null;
}

/**
 * `var(--area-<slug>)`; sem área conhecida, o verde da marca (`--primary`).
 * Até a revisão final (M4) o fallback era `--muted-foreground`: como a casca
 * sempre define `--area-atual` com o que esta função devolve, o
 * `var(--area-atual, var(--primary))` dos componentes nunca caía no verde, e
 * em /admin, /equipe e outras telas fora de área o filete saía cinza.
 * Administração tem cor própria (`--area-admin`), então não depende disto.
 */
export function corDaArea(slug: string | null | undefined): string {
  const s = slugVisual(slug);
  return s ? `var(--area-${s})` : "var(--primary)";
}

export function nomeDaArea(slug: string | null | undefined): string | null {
  const s = slugVisual(slug);
  if (!s) return null;
  return AREAS.find((a) => a.slug === s)?.nome ?? FORA_DO_MENU[s]?.nome ?? null;
}

export function iconeDaArea(slug: string | null | undefined): LucideIcon | null {
  const s = slugVisual(slug);
  if (!s) return null;
  const area = AREAS.find((a) => a.slug === s);
  return (area?.icone as LucideIcon | undefined) ?? FORA_DO_MENU[s]?.icone ?? null;
}
