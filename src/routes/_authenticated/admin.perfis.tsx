import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { createRole, deleteRole, listRoles, slugifyRoleKey, updateRole } from "@/lib/roles.functions";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  StatusBadge,
} from "@/components/planning";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
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
  const [excluirAlvo, setExcluirAlvo] = useState<{ id: string; label: string; areas: string[] } | null>(null);

  const createMut = useMutation({
    mutationFn: (input: { key: string; label: string; description?: string }) => createFn({ data: input }),
    onSuccess: (_res, input) => {
      toast.success(`Perfil ${input.label} criado, sem área nenhuma. Marque as áreas dele em Permissões.`);
      setLabel("");
      setKey("");
      setKeyTouched(false);
      setDescription("");
      setShowForm(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao criar perfil";
      setError(msg);
      toast.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: string; label: string; description?: string }) => updateFn({ data: input }),
    onSuccess: (_res, input) => {
      // Nome e descrição não mexem em acesso: ninguém ganha nem perde área.
      toast.success(`Perfil ${input.label} atualizado. As áreas e as pessoas dele não mudam.`);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar perfil"),
  });

  const deleteMut = useMutation({
    mutationFn: (alvo: { id: string; label: string }) => deleteFn({ data: { id: alvo.id } }),
    onSuccess: (_res, alvo) => {
      toast.success(`Perfil ${alvo.label} excluído.`);
      setExcluirAlvo(null);
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir perfil"),
  });

  const titulo = "Perfis";
  const pergunta = "Quais perfis existem, e quem está em cada um?";

  if (roleLoading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="pagina" />
      </div>
    );
  if (!isAdmin)
    return (
      <AppShell title={titulo} pergunta={pergunta}>
        <div className="mx-auto max-w-5xl px-4 py-6">
          <EstadoSemAcesso oQueFalta="admin (Administração)" />
        </div>
      </AppShell>
    );

  const roles = rolesQuery.data ?? [];

  return (
    <AppShell
      title={titulo}
      pergunta={pergunta}
      subtitle={
        <>
          {rolesQuery.data ? `${roles.length} perfis · ` : ""}
          Cada perfil abre um conjunto de áreas para quem o recebe. Perfil novo nasce sem área; nome
          e descrição não mudam o acesso de ninguém.
        </>
      }
    >
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Info className="mt-0.5 h-5 w-5 text-primary-text" />
          <div className="flex-1 text-sm text-foreground">
            <p className="font-semibold">Como funciona</p>
            <p className="mt-1 text-muted-foreground">
              O perfil diz quais <strong>áreas</strong> a pessoa abre, e quais áreas cada perfil abre se ajusta em{" "}
              <Link to="/admin/permissoes" className="underline underline-offset-2">Permissões</Link>. Perfil novo nasce
              sem área nenhuma. O <strong>nível</strong> da pessoa em cada área (admin, sócio, usuário) não é perfil:
              fica em{" "}
              <Link to="/admin/niveis" className="underline underline-offset-2">Níveis de acesso</Link> (ou na pílula
              Ops, em Usuários) e soma ao que o perfil já abre. O perfil Super admin tem acesso total.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end">
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

        {rolesQuery.isLoading ? (
          <Carregando variante="tabela" />
        ) : rolesQuery.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar os perfis"
            detalhe={rolesQuery.error instanceof Error ? rolesQuery.error.message : undefined}
            tentarNovamente={() => rolesQuery.refetch()}
          />
        ) : roles.length === 0 ? (
          <EstadoVazio titulo="Nenhum perfil cadastrado" descricao="Use “Novo perfil” para criar o primeiro." />
        ) : (
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
                    {/* Tipo é categoria, não status: neutro nos dois, a palavra diz qual. */}
                    <StatusBadge tom="neutro" icone={false}>
                      {r.is_system ? "Sistema" : "Customizado"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.pessoas > 0 ? (
                      r.pessoas
                    ) : (
                      <span className="text-xs text-warning" title="Ninguém tem este perfil hoje">sem uso</span>
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
                          aria-describedby={!editingLabel.trim() ? `motivo-salvar-${r.id}` : undefined}
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
                        {!editingLabel.trim() && (
                          <p id={`motivo-salvar-${r.id}`} aria-live="polite" className="mt-1 text-xs text-muted-foreground">
                            Preencha o nome para salvar.
                          </p>
                        )}
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
                          onClick={() => setExcluirAlvo({ id: r.id, label: r.label, areas: r.areas })}
                          disabled={deleteMut.isPending || r.pessoas > 0}
                          aria-describedby={r.pessoas > 0 ? `motivo-excluir-${r.id}` : undefined}
                          className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                        {/* O servidor recusa excluir perfil em uso; o motivo fica visível. */}
                        {r.pessoas > 0 && (
                          <p id={`motivo-excluir-${r.id}`} className="mt-1 text-xs text-muted-foreground">
                            Em uso por {r.pessoas} {r.pessoas === 1 ? "pessoa" : "pessoas"}: troque o perfil delas em
                            Usuários antes de excluir.
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <AlertDialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o perfil {excluirAlvo?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ninguém tem este perfil hoje, então ninguém perde acesso.{" "}
              {excluirAlvo?.areas.length
                ? `A configuração de áreas dele (${excluirAlvo.areas.join(", ")}) se perde com ele.`
                : "Ele não abre área nenhuma."}{" "}
              Não dá para desfazer: para voltar, é preciso criar o perfil e marcar as áreas de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMut.isPending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                if (excluirAlvo) deleteMut.mutate({ id: excluirAlvo.id, label: excluirAlvo.label });
              }}
            >
              {deleteMut.isPending ? "Excluindo…" : "Excluir perfil"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
