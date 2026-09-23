import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ShieldCheck, Users } from "lucide-react";
import { listAdministradoresPorArea, listRoleAreas, upsertRoleArea } from "@/lib/permissions.functions";
import { AppShell } from "@/components/app-shell";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Permissões por ÁREA.
 *
 * Esta tela tinha 66 linhas por 10 colunas, uma linha por chave, e crescia uma
 * linha a cada página nova. Ninguém conseguia responder "o que o CS vê?" sem
 * ler 66 caixinhas, e sete chaves tinham escapado da lista e viraram acesso
 * que não dava para conceder por aqui.
 *
 * Desde 15/09/2026 a unidade de concessão é a ÁREA: 10 linhas, e quem tem a
 * área tem todas as páginas dela. As chaves continuam existindo embaixo (as 96
 * policies de RLS falam nelas) e aparecem ao abrir a área, como leitura.
 *
 * O segundo nível, QUAIS unidades e empresas cada pessoa enxerga, é por
 * usuário e mora em /admin/usuarios.
 */
export const Route = createFileRoute("/_authenticated/admin/permissoes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Permissões – Planning" }] }),
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

const ROTULO_ESCOPO: Record<string, string> = {
  unidade: "filtra por unidade",
  empresa: "filtra por empresa",
  nenhum: "sem filtro",
};

function PermissionsPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = usePermissions();
  const qc = useQueryClient();
  const listFn = useServerFn(listRoleAreas);
  const upsertFn = useServerFn(upsertRoleArea);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const q = useQuery({ queryKey: ["role-areas"], queryFn: () => listFn(), enabled: isAdmin });

  // Quem administra cada área (admin ou sócio). Nomear é na tela de Usuários,
  // botão "Acessos": aqui é só a leitura, ao lado da matriz de papéis.
  const adminsFn = useServerFn(listAdministradoresPorArea);
  const adminsQ = useQuery({ queryKey: ["area-admins"], queryFn: () => adminsFn(), enabled: isAdmin });
  const adminsPorArea = useMemo(() => {
    const map = new Map<string, { nome: string; nivel: "admin" | "socio" }[]>();
    for (const l of adminsQ.data ?? []) {
      const lista = map.get(l.area) ?? [];
      lista.push({ nome: l.nome, nivel: l.nivel });
      map.set(l.area, lista);
    }
    for (const lista of map.values())
      lista.sort((x, y) => (x.nivel === y.nivel ? x.nome.localeCompare(y.nome, "pt-BR") : x.nivel === "admin" ? -1 : 1));
    return map;
  }, [adminsQ.data]);

  const concedida = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const g of q.data?.grants ?? []) map.set(`${g.role}__${g.area}`, g.allowed);
    return map;
  }, [q.data]);

  // O que cada área carrega, para a linha que abre.
  const chavesPorArea = useMemo(() => {
    const dicionario = new Map((q.data?.dicionario ?? []).map((d) => [d.key, d]));
    const map = new Map<string, { key: string; label: string }[]>();
    for (const c of q.data?.chaves ?? []) {
      const lista = map.get(c.area) ?? [];
      lista.push({ key: c.permission_key, label: dicionario.get(c.permission_key)?.label ?? c.permission_key });
      map.set(c.area, lista);
    }
    for (const lista of map.values()) lista.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return map;
  }, [q.data]);

  const [pending, setPending] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (vars: { role: string; area: string; allowed: boolean }) => upsertFn({ data: vars }),
    onMutate: (vars) => setPending((p) => new Set(p).add(`${vars.role}__${vars.area}`)),
    onSettled: (_d, _e, vars) => {
      setPending((p) => {
        const n = new Set(p);
        n.delete(`${vars.role}__${vars.area}`);
        return n;
      });
      qc.invalidateQueries({ queryKey: ["role-areas"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
    },
  });

  if (loading || !isAdmin) return null;

  const areas = q.data?.areas ?? [];
  const roles = q.data?.roles ?? [];

  return (
    <AppShell
      title="Permissões por área"
      subtitle="O papel abre as áreas. O filtro de unidade e de empresa é por pessoa, em Usuários."
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-text" />
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-semibold">Como funciona</p>
            <p className="text-muted-foreground">
              Marque a área para o papel. Quem tem a área tem <strong>todas</strong> as páginas e
              ações dela, e quem não tem não enxerga a área nem no menu. Clique no nome da área para
              ver o que ela carrega. Salva sozinho e vale para todos do papel no próximo
              carregamento.
            </p>
            <p className="text-muted-foreground">
              Página nova não precisa de permissão nova: ela herda a área em que mora.
            </p>
          </div>
        </div>

        <div className="grid gap-3 text-center text-xs sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r.key} className="rounded-lg border bg-card px-3 py-2">
              <p className="font-semibold text-foreground">
                {r.label}{" "}
                {!r.is_system && <span className="font-normal text-muted-foreground">(customizado)</span>}
              </p>
              <p className="mt-0.5 text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </div>

        {q.isLoading && <div className="text-sm text-muted-foreground">Carregando...</div>}

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="sticky top-[var(--app-header-h)] z-10 border-b bg-card px-4 py-2 text-left">
                  Área
                </th>
                {roles.map((r) => (
                  <th
                    key={r.key}
                    className="sticky top-[var(--app-header-h)] z-10 w-24 border-b bg-card px-3 py-2 text-center font-medium"
                  >
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => {
                const chaves = chavesPorArea.get(a.slug) ?? [];
                const expandida = aberta === a.slug;
                return (
                  // Fragment com key: a linha da área e a linha que expande são
                  // irmãs na tabela, e <> não aceita key.
                  <Fragment key={a.slug}>
                    <tr className="border-t">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setAberta(expandida ? null : a.slug)}
                          className="flex items-start gap-1.5 text-left"
                        >
                          {expandida ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span>
                            <span className="font-medium text-foreground">{a.nome}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {chaves.length} {chaves.length === 1 ? "permissão" : "permissões"} ·{" "}
                              {ROTULO_ESCOPO[a.escopo] ?? a.escopo}
                            </span>
                            <span className="block text-xs text-muted-foreground">{a.descricao}</span>
                            <span className="mt-1 block text-xs">
                              {(adminsPorArea.get(a.slug) ?? []).length === 0 ? (
                                <span className="text-muted-foreground">Administra: só o super admin</span>
                              ) : (
                                <span className="text-foreground">
                                  Administra:{" "}
                                  {(adminsPorArea.get(a.slug) ?? [])
                                    .map((x) => `${x.nome} (${x.nivel === "admin" ? "admin" : "sócio"})`)
                                    .join(", ")}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </td>
                      {roles.map((r) => {
                        const k = `${r.key}__${a.slug}`;
                        const allowed = concedida.get(k) ?? false;
                        const busy = pending.has(k);
                        return (
                          <td key={r.key} className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={allowed}
                              onChange={(e) =>
                                mut.mutate({ role: r.key, area: a.slug, allowed: e.target.checked })
                              }
                              className={cn(
                                "h-4 w-4 cursor-pointer rounded border-input accent-primary",
                                busy && "cursor-not-allowed opacity-40",
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {expandida && (
                      <tr className="border-t bg-muted/30">
                        <td colSpan={roles.length + 1} className="px-4 py-3">
                          <p className="mb-2 text-xs text-muted-foreground">
                            O que esta área carrega. É leitura: a concessão é da área inteira.
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {chaves.map((c) => (
                              <span
                                key={c.key}
                                title={c.key}
                                className="rounded border bg-card px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                {c.label}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-semibold">Segundo nível: quem vê o quê dentro da área</p>
            <p className="mt-1 text-muted-foreground">
              Unidades da rede e empresas do grupo são filtro <strong>por pessoa</strong>, não por
              papel: dois analistas com o mesmo papel podem cuidar de unidades diferentes. Isso se
              edita em{" "}
              <a href="/admin/usuarios" className="font-medium text-primary-text hover:underline">
                Usuários
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
