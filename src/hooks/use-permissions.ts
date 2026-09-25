import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import {
  getMyPermissions,
  type AppRole,
  type EscopoDoUsuario,
  type VerComoAtivo,
} from "@/lib/permissions.functions";
import { useAuth } from "@/hooks/use-auth";

export interface PermissionsState {
  loading: boolean;
  roles: AppRole[];
  /** Áreas que o papel abriu. É o nível 1 do acesso. */
  areas: Set<string>;
  /**
   * As chaves que essas áreas carregam.
   *
   * Continua existindo porque as 96 policies de RLS falam em chave, e porque
   * as telas que já checam `can(...)` não precisaram mudar quando o modelo
   * virou por área. Para decidir se um MENU aparece, use `temArea`.
   */
  permissions: Set<string>;
  unidade: string | null;
  can: (key: string) => boolean;
  temArea: (slug: string) => boolean;
  /** Áreas em que a pessoa é admin ou sócio. Super admin fica de fora: usa a Administração. */
  administra: string[];
  /** Áreas em que a pessoa é ADMIN (não sócio). */
  adminDe: string[];
  /** Nível 2: o filtro de unidade e de empresa desta pessoa. */
  escopo: EscopoDoUsuario;
  scopedToOwnUnit: boolean;
  primaryRole: AppRole | null;
  isAdmin: boolean;
  /**
   * A simulação de unidade em curso, quando existe.
   *
   * Tudo o mais neste objeto já vem TROCADO quando ela está ligada: papéis,
   * áreas, chaves, escopo e unidade são os do sócio simulado, e é por isso que
   * nenhuma tela precisou saber que a simulação existe. Este campo serve para
   * a moldura — a tarja do topo e o botão de sair —, nunca para decidir acesso.
   */
  verComo: VerComoAtivo | null;
}

const ESCOPO_VAZIO: EscopoDoUsuario = {
  todas_unidades: false,
  todas_empresas: false,
  unidades: [],
  empresas: [],
};

/**
 * @param userIdOverride Pass the already-resolved user id (e.g. from a route's
 * `beforeLoad` context) to start the permissions query on first render instead
 * of waiting for this hook's own `useAuth()` effect to resolve.
 */
export function usePermissions(userIdOverride?: string): PermissionsState {
  const { user, loading: authLoading } = useAuth();
  const userId = userIdOverride ?? user?.id;
  const authPending = userIdOverride ? false : authLoading;
  const fn = useServerFn(getMyPermissions);
  const q = useQuery({
    queryKey: ["my-perms", userId],
    queryFn: () => fn(),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const permsLoading = authPending || !userId || (q.fetchStatus !== "idle" && !q.data) || (!!userId && !q.data && !q.isError);

  return useMemo<PermissionsState>(() => {
    const roles = (q.data?.roles ?? []) as AppRole[];
    const perms = new Set(q.data?.permissions ?? []);
    const primary: AppRole | null = roles.includes("admin")
      ? "admin"
      : roles.includes("diretor")
        ? "diretor"
        : roles.includes("head")
          ? "head"
          : roles.includes("auditor")
            ? "auditor"
            : roles.includes("socio_regional")
              ? "socio_regional"
              : roles.includes("socio")
                ? "socio"
                : (roles[0] ?? null);
    const areas = new Set(q.data?.areas ?? []);
    const escopo = q.data?.escopo ?? ESCOPO_VAZIO;
    return {
      loading: permsLoading,
      roles,
      areas,
      permissions: perms,
      unidade: q.data?.unidade ?? null,
      can: (key: string) => perms.has(key),
      temArea: (slug: string) => areas.has(slug),
      administra: q.data?.administra ?? [],
      adminDe: q.data?.adminDe ?? [],
      escopo,
      // Deixou de ser chave concedida em papel: agora é a ausência de "todas as
      // unidades" no escopo da pessoa. O nome fica porque as 8 policies que
      // perguntam isso ainda falam `data.scope.own_unit_only`.
      scopedToOwnUnit: !escopo.todas_unidades,
      primaryRole: primary,
      // Durante a simulação `roles` já é o do sócio, então isto é falso — e as
      // telas que escondem botão de admin escondem sozinhas.
      isAdmin: roles.includes("admin"),
      verComo: q.data?.verComo ?? null,
    };
  }, [q.data, q.isError, permsLoading]);
}

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
  "sao luis": ["sao luís"],
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
