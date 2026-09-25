import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  StatusBadge,
} from "@/components/planning";
import { Checkbox } from "@/components/ui/checkbox";
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

const TITULO = "Validação de páginas";
const PERGUNTA = "Quais páginas estão validadas para ir à main?";

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
    mutationFn: (vars: { page_key: string; validated: boolean; label: string }) =>
      saveFn({ data: { page_key: vars.page_key, validated: vars.validated } }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.validated
          ? `${vars.label} validada. A faixa "Dados em validação" sai dessa página para todos.`
          : `${vars.label} voltou para validação. A faixa "Dados em validação" volta a aparecer para todos.`,
      );
    },
    onError: (e, vars) =>
      toast.error(
        `Não foi possível ${vars.validated ? "validar" : "desmarcar"} ${vars.label}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["page-validations"] });
    },
  });

  if (loading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="pagina" />
      </div>
    );
  if (!isAdmin)
    return (
      <AppShell title={TITULO} pergunta={PERGUNTA}>
        <div className="mx-auto max-w-3xl px-4 py-6">
          <EstadoSemAcesso oQueFalta="admin (Administração)" />
        </div>
      </AppShell>
    );

  const pages = q.data?.pages ?? [];
  const map = new Map((q.data?.rows ?? []).map((r) => [r.page_key, r]));
  const validadas = pages.filter((p) => map.get(p.key)?.validated).length;
  // Mesma herança do useIsPageValidated (a faixa): subpágina sem marcação
  // própria segue a marcação do caminho pai mais longo; a raiz "/" fica fora.
  const paiValidado = (key: string) => {
    const pai = (q.data?.rows ?? [])
      .filter((r) => r.page_key !== "/" && key.startsWith(r.page_key + "/"))
      .sort((a, b) => b.page_key.length - a.page_key.length)[0];
    return pai?.validated ?? false;
  };

  return (
    <AppShell
      title={TITULO}
      pergunta={PERGUNTA}
      subtitle={
        <>
          {q.data ? `${validadas} de ${pages.length} páginas validadas · ` : ""}
          Página não validada mostra a faixa "Dados em validação" no topo (quem tem escopo só da
          própria unidade não a vê). Marcar tira a faixa para todos; desmarcar devolve. Subpágina sem marcação própria
          segue a da página pai.
        </>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {q.isLoading ? (
          <Carregando variante="tabela" />
        ) : q.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar as validações"
            detalhe={q.error instanceof Error ? q.error.message : undefined}
            tentarNovamente={() => q.refetch()}
          />
        ) : pages.length === 0 ? (
          <EstadoVazio titulo="Nenhuma página cadastrada para validação" />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Página</th>
                  <th className="px-4 py-2 text-left">Rota</th>
                  <th className="w-32 px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-left">Validada</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const propria = map.get(p.key);
                  const validated = propria?.validated ?? false;
                  const segueAPai = !propria && paiValidado(p.key);
                  const salvando = mut.isPending && mut.variables?.page_key === p.key;
                  const id = `validada-${p.key.replace(/[^a-z0-9]+/gi, "-")}`;
                  return (
                    <tr key={p.key} className="border-t hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{p.label}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.key}</td>
                      <td className="px-4 py-3 text-center">
                        {validated ? (
                          <StatusBadge tom="sucesso">Validada</StatusBadge>
                        ) : segueAPai ? (
                          <StatusBadge tom="neutro">Segue a pai</StatusBadge>
                        ) : (
                          <StatusBadge tom="info">Em validação</StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={id}
                            aria-label={`Validar ${p.label}`}
                            aria-describedby={`${id}-efeito`}
                            checked={validated}
                            disabled={mut.isPending}
                            onCheckedChange={(v) =>
                              mut.mutate({ page_key: p.key, validated: v === true, label: p.label })
                            }
                            className="mt-0.5"
                          />
                          <span id={`${id}-efeito`} className="text-xs text-muted-foreground">
                            {salvando
                              ? "Salvando…"
                              : validated
                                ? "Desmarcar devolve a faixa de validação"
                                : segueAPai
                                  ? "Sem faixa pela página pai; marcar fixa a validação desta"
                                  : "Marcar tira a faixa de validação para todos"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
