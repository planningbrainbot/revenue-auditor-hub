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

  const permsLoading =
    authPending ||
    !userId ||
    (q.fetchStatus !== "idle" && !q.data) ||
    (!!userId && !q.data && !q.isError);

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

// `normalizeUnitName`/`unitMatches` moraram aqui, mas o escopo por unidade
// também roda no servidor — o código puro foi para `@/lib/unit-names` e é
// re-exportado para manter os imports existentes funcionando.
export { normalizeUnitName, unitMatches } from "@/lib/unit-names";
