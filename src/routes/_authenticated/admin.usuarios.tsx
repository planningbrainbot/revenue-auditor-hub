import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCreateUser,
  adminDeleteUser,
  adminGrantGrowthAccess,
  adminListGrowthAccess,
  adminListUsers,
  adminResetPassword,
  adminRevokeGrowthAccess,
  adminUpdateUser,
} from "@/lib/admin-users.functions";
import { getSocioUnidadeByEmail } from "@/lib/permissions.functions";
import { listRoles } from "@/lib/roles.functions";
import { generatePassword } from "@/lib/password-utils";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  ssr: false,
  head: () => ({ meta: [{ title: "Usuários – Ops Board Planning Expansão" }] }),
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
  component: UsersPage,
});

type Role = string;

const SYSTEM_ROLE_PILL: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  diretor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  socio: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  head: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  auditor: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  socio_franqueado: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
};
const CUSTOM_ROLE_PILL = "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";

// Papéis e departamentos do Growth — espelham os CHECK de public.membros lá.
const GROWTH_PAPEIS = ["admin", "gestao", "operacional"] as const;
const GROWTH_DEPARTAMENTOS = ["comercial", "diretoria", "marketing", "backoffice", "parcerias"] as const;
const GROWTH_PILL: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  gestao: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  operacional: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
};

type GrowthAlvo = {
  email: string;
  nome: string;
  papel: string;
  departamento: string;
  jaTemAcesso: boolean;
};

function UsersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = usePermissions();
  const qc = useQueryClient();

  const listFn = useServerFn(adminListUsers);
  const createFn = useServerFn(adminCreateUser);
  const resetFn = useServerFn(adminResetPassword);
  const deleteFn = useServerFn(adminDeleteUser);
  const updateFn = useServerFn(adminUpdateUser);
  const lookupFn = useServerFn(getSocioUnidadeByEmail);
  const rolesFn = useServerFn(listRoles);
  const growthListFn = useServerFn(adminListGrowthAccess);
  const growthGrantFn = useServerFn(adminGrantGrowthAccess);
  const growthRevokeFn = useServerFn(adminRevokeGrowthAccess);

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate({ to: "/" });
  }, [roleLoading, isAdmin, navigate]);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const rolesQuery = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => rolesFn(),
    enabled: isAdmin,
  });
  const roles = rolesQuery.data ?? [];

  const unidadesQuery = useQuery({
    queryKey: ["admin-unidades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unidades")
        .select("nome_da_praca")
        .eq("tipo", "regional")
        .order("nome_da_praca");
      if (error) throw error;
      return (data ?? []).map((u) => u.nome_da_praca as string);
    },
    enabled: isAdmin,
  });
  const unidades = unidadesQuery.data ?? [];
  const growthQuery = useQuery({
    queryKey: ["admin-growth-access"],
    queryFn: () => growthListFn(),
    enabled: isAdmin,
  });
  const growthConfigurado = growthQuery.data?.configured ?? false;
  const growthPorEmail = new Map(
    (growthQuery.data?.membros ?? []).map((m) => [String(m.email).toLowerCase(), m]),
  );

  const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label ?? key;
  const rolePill = (key: string) => SYSTEM_ROLE_PILL[key] ?? CUSTOM_ROLE_PILL;

  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("diretor");
  const [credential, setCredential] = useState<{ email: string; password: string; unidade?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socioUnidade, setSocioUnidade] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [unidadeSel, setUnidadeSel] = useState("");

  // Preview da unidade quando role=socio + email digitado
  useEffect(() => {
    if (role !== "socio" || !email.includes("@")) {
      setSocioUnidade(null);
      return;
    }
    let cancel = false;
    setLookingUp(true);
    const t = setTimeout(async () => {
      try {
        const res = await lookupFn({ data: { email } });
        if (!cancel) setSocioUnidade(res.unidade);
      } finally {
        if (!cancel) setLookingUp(false);
      }
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [email, role, lookupFn]);

  const [growthAlvo, setGrowthAlvo] = useState<GrowthAlvo | null>(null);
  const [growthSenha, setGrowthSenha] = useState("");

  const growthGrantMut = useMutation({
    mutationFn: (input: { email: string; nome: string; papel: string; departamento: string; password?: string }) =>
      growthGrantFn({ data: input }),
    onSuccess: (res, variables) => {
      if (res.loginCriado && variables.password) {
        setCredential({ email: `${res.email} (Growth)`, password: variables.password });
      }
      setGrowthAlvo(null);
      setGrowthSenha("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao conceder acesso no Growth"),
  });

  const growthRevokeMut = useMutation({
    mutationFn: (email: string) => growthRevokeFn({ data: { email } }),
    onSuccess: () => {
      setGrowthAlvo(null);
      setGrowthSenha("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao revogar acesso no Growth"),
  });

  const createMut = useMutation({
    mutationFn: (input: { nome: string; email: string; role: Role; password: string; unidade?: string }) => createFn({ data: input }),
    onSuccess: (res, variables) => {
      setCredential({ email: res.email, password: variables.password, unidade: res.unidade });
      setNome("");
      setEmail("");
      setRole("diretor");
      setSocioUnidade(null);
      setUnidadeSel("");
      setShowForm(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao criar usuário"),
  });

  const resetMut = useMutation({
    mutationFn: ({ user_id, password }: { user_id: string; password: string }) => resetFn({ data: { user_id, password } }),
    onSuccess: (res, variables) => setCredential({ email: res.email, password: variables.password }),
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao resetar senha"),
  });

  const deleteMut = useMutation({
    mutationFn: (user_id: string) => deleteFn({ data: { user_id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao excluir"),
  });

  const updateMut = useMutation({
    mutationFn: (input: { user_id: string; nome: string }) => updateFn({ data: input }),
    onSuccess: () => {
      setEditingId(null);
      setEditingNome("");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");

  function copyCred() {
    if (!credential) return;
    const text = `Email: ${credential.email}\nSenha: ${credential.password}`;
    navigator.clipboard?.writeText(text);
  }

  if (roleLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!isAdmin) return null;

  return (
    <AppShell title="Gerenciar usuários" subtitle="Cadastre admins, diretores e sócios">
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">

        {credential && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Credenciais geradas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Copie e envie para o usuário por um canal seguro. Esta senha só aparece uma vez.
                </p>
                <div className="mt-3 rounded-lg bg-background px-3 py-2 font-mono text-sm">
                  <div><span className="text-muted-foreground">Email:</span> {credential.email}</div>
                  <div><span className="text-muted-foreground">Senha:</span> {credential.password}</div>
                  {credential.unidade !== undefined && (
                    <div><span className="text-muted-foreground">Unidade:</span> {credential.unidade ?? "—"}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={copyCred} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                  Copiar
                </button>
                <button onClick={() => setCredential(null)} className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Usuários ({usersQuery.data?.length ?? 0})</h2>
          <button
            onClick={() => { setShowForm((s) => !s); setError(null); }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {showForm ? "Cancelar" : "Novo usuário"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate({
                nome,
                email,
                role,
                password: generatePassword(12),
                unidade: role === "socio_franqueado" ? unidadeSel : undefined,
              });
            }}
            className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-4"
          >
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">Nome</label>
              <input required value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground">Email</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              {role === "socio" && email.includes("@") && (
                <p className="mt-1 text-xs">
                  {lookingUp ? (
                    <span className="text-muted-foreground">Buscando unidade…</span>
                  ) : socioUnidade ? (
                    <span className="text-emerald-700 dark:text-emerald-300">
                      Unidade vinculada: <strong>{socioUnidade}</strong>
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">
                      Email não encontrado na tabela de sócios. O acesso será criado, mas a unidade ficará vazia.
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">Papel</label>
              <select
                value={role}
                onChange={(e) => { setRole(e.target.value as Role); setUnidadeSel(""); }}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                    {!r.is_system ? " (customizado)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {role === "socio_franqueado" && (
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-foreground">Unidade</label>
                <select
                  required
                  value={unidadeSel}
                  onChange={(e) => setUnidadeSel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="" disabled>Selecione…</option>
                  {unidades.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="sm:col-span-4 flex justify-end">
              <button type="submit" disabled={createMut.isPending} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {createMut.isPending ? "Criando..." : "Criar e gerar senha"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Papel</th>
                <th className="px-4 py-2">Unidade</th>
                <th className="px-4 py-2">Growth</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {usersQuery.data?.map((u) => (
                <tr key={u.user_id} className="border-t">
                  <td className="px-4 py-2 text-foreground">
                    {editingId === u.user_id ? (
                      <input
                        autoFocus
                        value={editingNome}
                        onChange={(e) => setEditingNome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editingNome.trim()) updateMut.mutate({ user_id: u.user_id, nome: editingNome.trim() });
                          if (e.key === "Escape") { setEditingId(null); setEditingNome(""); }
                        }}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      />
                    ) : (
                      u.nome || "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-foreground">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rolePill(u.role)}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {u.role === "socio" || u.role === "socio_franqueado"
                      ? (u.unidade ?? <span className="text-amber-600">não vinculada</span>)
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {(() => {
                      if (!growthConfigurado) return <span className="text-xs text-muted-foreground">—</span>;
                      const m = growthPorEmail.get(u.email.toLowerCase());
                      if (!m) return <span className="text-xs text-muted-foreground">sem acesso</span>;
                      return (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            GROWTH_PILL[String(m.papel)] ?? CUSTOM_ROLE_PILL
                          }`}
                          title={`Departamento: ${m.departamento ?? "—"}`}
                        >
                          {String(m.papel)}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {editingId === u.user_id ? (
                      <>
                        <button
                          onClick={() => editingNome.trim() && updateMut.mutate({ user_id: u.user_id, nome: editingNome.trim() })}
                          disabled={updateMut.isPending || !editingNome.trim()}
                          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditingNome(""); }}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditingId(u.user_id); setEditingNome(u.nome || ""); }}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Editar
                        </button>
                        {growthConfigurado && (
                          <button
                            onClick={() => {
                              const m = growthPorEmail.get(u.email.toLowerCase());
                              setGrowthSenha("");
                              setGrowthAlvo({
                                email: u.email,
                                nome: u.nome || u.email,
                                papel: String(m?.papel ?? "operacional"),
                                departamento: String(m?.departamento ?? "comercial"),
                                jaTemAcesso: Boolean(m),
                              });
                            }}
                            className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                          >
                            Growth
                          </button>
                        )}
                        <button
                          onClick={() => resetMut.mutate({ user_id: u.user_id, password: generatePassword(12) })}
                          disabled={resetMut.isPending}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          Resetar senha
                        </button>
                        {u.user_id !== user?.id && (
                          <button
                            onClick={() => { if (confirm(`Excluir ${u.email}?`)) deleteMut.mutate(u.user_id); }}
                            disabled={deleteMut.isPending}
                            className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {usersQuery.data && usersQuery.data.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nenhum usuário.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {growthAlvo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-foreground">Acesso ao Growth</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {growthAlvo.nome} · {growthAlvo.email}
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Papel no Growth</label>
                  <select
                    value={growthAlvo.papel}
                    onChange={(e) => setGrowthAlvo({ ...growthAlvo, papel: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  >
                    {GROWTH_PAPEIS.map((pp) => (
                      <option key={pp} value={pp}>{pp}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">Departamento</label>
                  <select
                    value={growthAlvo.departamento}
                    onChange={(e) => setGrowthAlvo({ ...growthAlvo, departamento: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  >
                    {GROWTH_DEPARTAMENTOS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">
                    Senha do Growth {growthAlvo.jaTemAcesso && <span className="font-normal text-muted-foreground">(opcional)</span>}
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={growthSenha}
                      onChange={(e) => setGrowthSenha(e.target.value)}
                      placeholder={growthAlvo.jaTemAcesso ? "deixe vazio para não alterar" : "senha inicial"}
                      className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setGrowthSenha(generatePassword(12))}
                      className="shrink-0 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-accent"
                    >
                      Gerar
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    O Growth é um login separado — a pessoa entra lá com este e-mail e senha.
                  </p>
                </div>
              </div>

              {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

              <div className="mt-6 flex items-center justify-between">
                {growthAlvo.jaTemAcesso ? (
                  <button
                    onClick={() => {
                      if (confirm(`Revogar o acesso de ${growthAlvo.email} ao Growth?`)) {
                        growthRevokeMut.mutate(growthAlvo.email);
                      }
                    }}
                    disabled={growthRevokeMut.isPending}
                    className="rounded-full border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Revogar acesso
                  </button>
                ) : (
                  <span />
                )}

                <div className="space-x-2">
                  <button
                    onClick={() => { setGrowthAlvo(null); setGrowthSenha(""); setError(null); }}
                    className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground hover:bg-accent"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() =>
                      growthGrantMut.mutate({
                        email: growthAlvo.email,
                        nome: growthAlvo.nome,
                        papel: growthAlvo.papel,
                        departamento: growthAlvo.departamento,
                        password: growthSenha.trim() || undefined,
                      })
                    }
                    disabled={growthGrantMut.isPending}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {growthGrantMut.isPending ? "Salvando..." : growthAlvo.jaTemAcesso ? "Salvar" : "Conceder acesso"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
