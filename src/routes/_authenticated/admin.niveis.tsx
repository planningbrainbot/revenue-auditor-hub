import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AcessosUsuarioDialog } from "@/components/admin/acessos-usuario-dialog";
import { Carregando, EstadoErro, EstadoVazio } from "@/components/planning";
import { Input } from "@/components/ui/input";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { listNiveisDeAcesso } from "@/lib/permissions.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * O quadro do super admin: cada pessoa e o nível dela em cada área.
 *
 * Antes daqui, o nível só aparecia abrindo "Acessos" linha por linha em
 * Usuários, e o dono não achou a tela (17/09/2026). Clicar numa pessoa abre o
 * mesmo diálogo.
 */
export const Route = createFileRoute("/_authenticated/admin/niveis")({
  ssr: false,
  head: () => ({ meta: [{ title: "Níveis de acesso – Planning" }] }),
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
  component: NiveisPage,
});

type Nivel = "super_admin" | "admin" | "socio" | "usuario" | "perfil" | "bloqueado" | "nenhum";

const CELULA: Record<Nivel, { texto: string; classe: string }> = {
  super_admin: { texto: "total", classe: "bg-primary text-primary-foreground" },
  admin: { texto: "admin", classe: "bg-primary/80 text-primary-foreground" },
  socio: { texto: "sócio", classe: "bg-primary/25 text-foreground" },
  usuario: { texto: "usuário", classe: "bg-primary/10 text-primary-text" },
  perfil: { texto: "perfil", classe: "border border-border text-muted-foreground" },
  bloqueado: { texto: "bloqueada", classe: "bg-destructive/10 text-destructive" },
  nenhum: { texto: "", classe: "" },
};

function NiveisPage() {
  const listFn = useServerFn(listNiveisDeAcesso);
  const q = useQuery({ queryKey: ["niveis-acesso"], queryFn: () => listFn() });
  const [busca, setBusca] = useFiltroNaUrl("q", "");
  const [alvo, setAlvo] = useState<{ userId: string; nome: string } | null>(null);

  const pessoas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (q.data?.pessoas ?? []).filter(
      (p) => !t || p.nome.toLowerCase().includes(t) || p.email.toLowerCase().includes(t),
    );
  }, [q.data, busca]);

  const total = q.data?.pessoas.length ?? 0;
  const nAreas = q.data?.areas.length ?? 0;

  return (
    <AppShell
      title="Níveis de acesso"
      pergunta="Que nível cada pessoa tem em cada área?"
      subtitle={
        <>
          {q.data ? `${total} ${total === 1 ? "pessoa" : "pessoas"} · ${nAreas} áreas · ` : ""}
          Clique numa pessoa para mudar. O nível novo vale no próximo carregamento dela.
        </>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
          <div className="text-muted-foreground">
            <p>
              <strong className="text-foreground">total</strong> super admin ·{" "}
              <strong className="text-foreground">admin</strong> área inteira, todas as unidades, nomeia sócios ·{" "}
              <strong className="text-foreground">sócio</strong> área inteira nas unidades dele, convida a equipe ·{" "}
              <strong className="text-foreground">usuário</strong> só as páginas liberadas, só consulta ·{" "}
              <strong className="text-foreground">perfil</strong> entra pela área que o perfil abre ·{" "}
              <strong className="text-foreground">bloqueada</strong> o perfil abre, mas foi tirada desta pessoa.
            </p>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            aria-label="Buscar por nome ou e-mail"
            className="h-9 pl-8"
          />
        </div>

        {q.isLoading ? (
          <Carregando variante="tabela" />
        ) : q.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar os níveis de acesso"
            detalhe={(q.error as Error)?.message}
            tentarNovamente={() => q.refetch()}
          />
        ) : total === 0 ? (
          <EstadoVazio titulo="Nenhuma pessoa cadastrada" descricao="Quem é cadastrado em Usuários aparece aqui." />
        ) : pessoas.length === 0 ? (
          <EstadoVazio titulo="Ninguém com esse nome ou e-mail" total={total} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Pessoa</th>
                  <th className="px-3 py-2">Perfil</th>
                  {(q.data?.areas ?? []).map((a) => (
                    <th key={a.slug} className="px-2 py-2 text-center font-medium">
                      {a.nome}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pessoas.map((p) => (
                  <tr
                    key={p.userId}
                    onClick={() => setAlvo({ userId: p.userId, nome: p.nome })}
                    className="cursor-pointer border-t hover:bg-accent/40"
                  >
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        className="text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAlvo({ userId: p.userId, nome: p.nome });
                        }}
                      >
                        <span className="block font-medium text-foreground">{p.nome}</span>
                        <span className="block text-xs text-muted-foreground">{p.email}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.perfis.join(", ") || "sem perfil"}</td>
                    {(q.data?.areas ?? []).map((a) => {
                      const c = CELULA[p.niveis[a.slug]];
                      return (
                        <td key={a.slug} className="px-2 py-2 text-center">
                          {c.texto && (
                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase", c.classe)}>
                              {c.texto}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {alvo && (
        <AcessosUsuarioDialog
          userId={alvo.userId}
          nome={alvo.nome}
          onClose={() => {
            setAlvo(null);
            q.refetch();
          }}
        />
      )}
    </AppShell>
  );
}
