import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import {
  listRolePermissions,
  upsertRolePermission,
} from "@/lib/permissions.functions";
import { AppShell } from "@/components/app-shell";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/permissoes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Permissões – Planning Expansão" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/" });
  },
  component: PermissionsPage,
});

function PermissionsPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = usePermissions();
  const qc = useQueryClient();
  const listFn = useServerFn(listRolePermissions);
  const upsertFn = useServerFn(upsertRolePermission);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const q = useQuery({
    queryKey: ["role-permissions"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const matrix = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const r of q.data?.rows ?? []) {
      map.set(`${r.role}__${r.permission_key}`, r.allowed);
    }
    return map;
  }, [q.data]);

  const [pending, setPending] = useState<Set<string>>(new Set());

  const mut = useMutation({
    mutationFn: (vars: { role: string; permission_key: string; allowed: boolean }) =>
      upsertFn({ data: vars }),
    onMutate: (vars) => {
      const k = `${vars.role}__${vars.permission_key}`;
      setPending((p) => new Set(p).add(k));
    },
    onSettled: (_d, _e, vars) => {
      const k = `${vars.role}__${vars.permission_key}`;
      setPending((p) => {
        const n = new Set(p);
        n.delete(k);
        return n;
      });
      qc.invalidateQueries({ queryKey: ["role-permissions"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
    },
  });

  if (loading || !isAdmin) return null;

  const permissions = q.data?.permissions ?? [];
  const roles = q.data?.roles ?? [];
  const groups = Array.from(new Set(permissions.map((p) => p.group)));

  return (
    <AppShell title="Permissões por papel" subtitle="Configure o que cada perfil pode ver">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1 text-sm text-foreground">
            <p className="font-semibold">Como funciona</p>
            <p className="mt-1 text-muted-foreground">
              Marque as caixas para liberar o que cada papel pode acessar. Mudanças são salvas automaticamente
              e aplicam-se a todos os usuários com aquele papel no próximo carregamento.
            </p>
          </div>
        </div>

        <div className="grid gap-3 text-center text-xs sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r.key} className="rounded-lg border bg-card px-3 py-2">
              <p className="font-semibold text-foreground">
                {r.label} {!r.is_system && <span className="font-normal text-muted-foreground">(customizado)</span>}
              </p>
              <p className="mt-0.5 text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </div>

        {q.isLoading && <div className="text-sm text-muted-foreground">Carregando...</div>}

        {groups.map((group) => (
          // overflow-clip (e não overflow-hidden) porque hidden cria um contexto
          // de rolagem e o cabeçalho sticky passaria a grudar na caixa, não na tela.
          <div key={group} className="overflow-clip rounded-xl border bg-card">
            <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="sticky top-[var(--app-header-h)] z-10 border-b bg-card px-4 py-2 text-left">
                    Permissão
                  </th>
                  {roles.map((r) => (
                    <th
                      key={r.key}
                      className="sticky top-[var(--app-header-h)] z-10 w-24 border-b bg-card px-3 py-2 text-center"
                    >
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <tr key={p.key} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.label}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </td>
                      {roles.map((r) => {
                        const k = `${r.key}__${p.key}`;
                        const allowed = matrix.get(k) ?? false;
                        const busy = pending.has(k);
                        const restrictedToSocio = p.key === "data.scope.own_unit_only" && r.key !== "socio";
                        return (
                          <td key={r.key} className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              disabled={busy || restrictedToSocio}
                              checked={allowed}
                              onChange={(e) =>
                                mut.mutate({ role: r.key, permission_key: p.key, allowed: e.target.checked })
                              }
                              className={cn(
                                "h-4 w-4 cursor-pointer rounded border-input accent-primary",
                                (busy || restrictedToSocio) && "cursor-not-allowed opacity-40",
                              )}
                              title={restrictedToSocio ? "Aplicável apenas ao papel Sócio" : undefined}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
