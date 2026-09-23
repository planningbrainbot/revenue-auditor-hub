import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { listPageValidations, setPageValidation } from "@/lib/page-validations.functions";

export const Route = createFileRoute("/_authenticated/admin/validacao")({
  ssr: false,
  head: () => ({ meta: [{ title: "Validação de páginas – Planning Expansão" }] }),
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
  component: ValidationAdminPage,
});

function ValidationAdminPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = usePermissions();
  const qc = useQueryClient();
  const listFn = useServerFn(listPageValidations);
  const saveFn = useServerFn(setPageValidation);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const q = useQuery({
    queryKey: ["page-validations"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const mut = useMutation({
    mutationFn: (vars: { page_key: string; validated: boolean }) => saveFn({ data: vars }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["page-validations"] });
    },
  });

  if (loading || !isAdmin) return null;

  const pages = q.data?.pages ?? [];
  const map = new Map((q.data?.rows ?? []).map((r) => [r.page_key, r]));

  return (
    <AppShell title="Validação de páginas" subtitle="Marque quais páginas já tiveram seus dados conferidos">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-warning">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div className="text-sm">
            <p className="font-semibold">Como funciona</p>
            <p className="mt-1">
              Páginas marcadas como <strong>não validadas</strong> exibem um aviso fixo no topo
              informando que os dados ainda estão em conferência. Marque como validada apenas
              quando os números forem conferidos.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Página</th>
                <th className="px-4 py-2 text-left">Rota</th>
                <th className="px-4 py-2 text-center w-32">Status</th>
                <th className="px-4 py-2 text-center w-28">Validada</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const row = map.get(p.key);
                const validated = row?.validated ?? false;
                return (
                  <tr key={p.key} className="border-t">
                    <td className="px-4 py-3 font-medium">{p.label}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.key}</td>
                    <td className="px-4 py-3 text-center">
                      {validated ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3 w-3" /> Validada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                          <AlertTriangle className="h-3 w-3" /> Em validação
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={validated}
                        disabled={mut.isPending}
                        onChange={(e) =>
                          mut.mutate({ page_key: p.key, validated: e.target.checked })
                        }
                        className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
