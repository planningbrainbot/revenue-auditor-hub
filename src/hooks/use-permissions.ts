import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getMyPermissions, type AppRole } from "@/lib/permissions.functions";
import { useAuth } from "@/hooks/use-auth";

export interface PermissionsState {
  loading: boolean;
  roles: AppRole[];
  permissions: Set<string>;
  unidade: string | null;
  can: (key: string) => boolean;
  scopedToOwnUnit: boolean;
  primaryRole: AppRole | null;
  isAdmin: boolean;
}

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
            : roles.includes("socio_franqueado")
              ? "socio_franqueado"
              : roles.includes("socio")
                ? "socio"
                : (roles[0] ?? null);
    return {
      loading: permsLoading,
      roles,
      permissions: perms,
      unidade: q.data?.unidade ?? null,
      can: (key: string) => perms.has(key),
      scopedToOwnUnit: perms.has("data.scope.own_unit_only"),
      primaryRole: primary,
      isAdmin: roles.includes("admin"),
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
