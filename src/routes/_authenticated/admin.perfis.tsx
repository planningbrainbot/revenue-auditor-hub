import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";
import { createRole, deleteRole, listRoles, slugifyRoleKey, updateRole } from "@/lib/roles.functions";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/perfis")({
  ssr: false,
  head: () => ({ meta: [{ title: "Perfis de usuário – Planning Brain" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/" });
  },
  component: ProfilesPage,
});

function ProfilesPage() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = usePermissions();
  const qc = useQueryClient();

  const listFn = useServerFn(listRoles);
  const createFn = useServerFn(createRole);
  const updateFn = useServerFn(updateRole);
  const deleteFn = useServerFn(deleteRole);

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate({ to: "/" });
  }, [roleLoading, isAdmin, navigate]);

  const rolesQuery = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  const createMut = useMutation({
    mutationFn: (input: { key: string; label: string; description?: string }) => createFn({ data: input }),
    onSuccess: () => {
      setLabel("");
      setKey("");
      setKeyTouched(false);
      setDescription("");
      setShowForm(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao criar perfil"),
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: string; label: string; description?: string }) => updateFn({ data: input }),
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao atualizar perfil"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-roles"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao excluir perfil"),
  });

  if (roleLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!isAdmin) return null;

  const roles = rolesQuery.data ?? [];

  return (
    <AppShell title="Perfis de usuário" subtitle="Cada perfil é um modelo: abre um conjunto de áreas para quem o recebe">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Info className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1 text-sm text-foreground">
            <p className="font-semibold">Como funciona</p>
            <p className="mt-1 text-muted-foreground">
              O perfil diz quais <strong>áreas</strong> a pessoa abre, e quais áreas cada perfil abre se ajusta em{" "}
              <Link to="/admin/permissoes" className="underline underline-offset-2">Permissões</Link>. Perfil novo nasce
              sem área nenhuma. O <strong>nível</strong> da pessoa em cada área (admin, sócio, usuário) não é perfil:
              fica em Usuários, no botão Acessos, e soma ao que o perfil já abre. O perfil Super admin tem acesso total.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Perfis ({roles.length})</h2>
          <button
            onClick={() => { setShowForm((s) => !s); setError(null); }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {showForm ? "Cancelar" : "Novo perfil"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={(e) => { e.preventDefault(); createMut.mutate({ key, label, description }); }}
            className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-3"
          >
            <div>
              <label className="block text-xs font-medium text-foreground">Nome</label>
              <input
                required
                value={label}
                onChange={(e) => {
                  const v = e.target.value;
                  setLabel(v);
                  if (!keyTouched) setKey(slugifyRoleKey(v));
                }}
                placeholder="Financeiro"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground">Chave</label>
              <input
                required
                value={key}
                onChange={(e) => { setKey(slugifyRoleKey(e.target.value)); setKeyTouched(true); }}
                placeholder="financeiro"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground">Descrição (opcional)</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <button type="submit" disabled={createMut.isPending} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {createMut.isPending ? "Criando..." : "Criar perfil"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Chave</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2 text-right">Pessoas</th>
                <th className="px-4 py-2">Áreas que abre</th>
                <th className="px-4 py-2">Descrição</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rolesQuery.isLoading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {roles.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 text-foreground">
                    {editingId === r.id ? (
                      <input
                        autoFocus
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      />
                    ) : (
                      r.label
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.key}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        r.is_system
                          ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                          : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                      }`}
                    >
                      {r.is_system ? "Sistema" : "Customizado"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.pessoas > 0 ? (
                      r.pessoas
                    ) : (
                      <span className="text-xs text-amber-600" title="Ninguém tem este perfil hoje">sem uso</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.key === "admin" ? "todas" : r.areas.length ? r.areas.join(", ") : "nenhuma"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {editingId === r.id ? (
                      <input
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      />
                    ) : (
                      r.description || "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {editingId === r.id ? (
                      <>
                        <button
                          onClick={() => updateMut.mutate({ id: r.id, label: editingLabel, description: editingDescription })}
                          disabled={updateMut.isPending || !editingLabel.trim()}
                          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : r.is_system ? (
                      <span className="text-xs text-muted-foreground">Perfil de sistema</span>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditingId(r.id); setEditingLabel(r.label); setEditingDescription(r.description ?? ""); }}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => { if (confirm(`Excluir o perfil "${r.label}"?`)) deleteMut.mutate(r.id); }}
                          disabled={deleteMut.isPending}
                          className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
