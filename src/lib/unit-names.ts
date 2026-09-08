// Normalização e comparação de nomes de unidade (praça).
//
// Estas funções eram exportadas por `@/hooks/use-permissions`, um módulo de
// cliente (importa React/react-query). O escopo por unidade também precisa
// rodar no servidor (server functions), então elas vivem aqui, puras e sem
// dependência de React. `use-permissions.ts` re-exporta as duas para não
// quebrar os imports existentes.

/** Normaliza nome de unidade para comparação tolerante (case, acentos, espaços). */
export function normalizeUnitName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapeia nomes equivalentes entre socios.unidade e roas/auditoria. */
const UNIT_ALIASES: Record<string, string[]> = {
  "rio de janeiro": ["sudeste (rj)", "rj"],
  "goiania / matriz": ["matriz", "goiania"],
  // "sao luis": ["sao luís"] saiu daqui: normalizeUnitName tira o acento dos
  // dois lados antes da comparação, então "São Luís" e "São Luis" já casam no
  // `t === c` e a entrada era inalcançável.
};

export function unitMatches(target: string | null, candidate: string | null | undefined): boolean {
  const t = normalizeUnitName(target);
  const c = normalizeUnitName(candidate);
  if (!t || !c) return false;
  if (t === c) return true;
  const aliases = UNIT_ALIASES[t] ?? [];
  if (aliases.includes(c)) return true;
  const revAliases = UNIT_ALIASES[c] ?? [];
  if (revAliases.includes(t)) return true;
  return false;
}
