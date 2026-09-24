import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  definirEscoposFinanceiro,
  listarAcessosFinanceiro,
  listarCandidatosFinanceiro,
  revogarAcessoFinanceiro,
} from "@/lib/acessos-financeiro.functions";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { supabase } from "@/integrations/supabase/client";

// TELA "ACESSOS DO FINANCEIRO".
//
// PEDIDO DO DONO, verbatim (15/09/2026):
//   "Preciso que faça essa gestão dentro do módulo de administração. Só que a
//    ana por exemplo consegue gerir admin só do módulo financeiro."
//   "Preciso modularizar os acessos também, por exemplo: quero dar acesso só à
//    partners para o eliezek. ou só à Marox para o roney. Daí administro
//    certinho."
//
// A GUARDA AQUI É POR CHAVE, NÃO POR PAPEL — e essa é a diferença que faz a
// tela existir. As outras seis telas de Administração fazem
// `user_roles.eq('role','admin')` no beforeLoad, o que barraria a Ana (papel
// `financeiro`). Aqui o beforeLoad chama `ops.can('admin.acessos.financeiro')`,
// a mesma chave que o servidor confere em cada server fn. Molde:
// `assertAdminIntegracoes` em integracoes-segredos.functions.ts.
//
// DS v2 (24/09/2026): a moldura segue o arquétipo Configuração
// (docs/design/ARQUETIPOS.md §5). Revogar confirma em AlertDialog com o efeito,
// e toda escrita dá toast de sucesso e de erro, além do aviso na tela.
export const Route = createFileRoute("/_authenticated/admin/acessos-financeiro")({
  ssr: false,
  head: () => ({ meta: [{ title: "Acessos do Financeiro – Planning Brain" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    // `can` e não `user_roles`: quem administra isto pode não ser admin global.
    const { data: pode } = await supabase.rpc("can", {
      _key: "admin.acessos.financeiro",
    } as never);
    if (!pode) throw redirect({ to: "/" });
  },
  component: AcessosFinanceiroPage,
});

/** Busca sem acento e sem caixa: "joao" acha "João". */
function normalizar(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

interface Rascunho {
  userId: string;
  email: string;
  nome: string | null;
  unidades: string[];
  novo: boolean;
}

function AcessosFinanceiroPage() {
  const navigate = useNavigate();
  const { can, loading: permLoading } = usePermissions();
  const qc = useQueryClient();

  const listar = useServerFn(listarAcessosFinanceiro);
  const candidatosFn = useServerFn(listarCandidatosFinanceiro);
  const definir = useServerFn(definirEscoposFinanceiro);
  const revogar = useServerFn(revogarAcessoFinanceiro);

  const acessos = useQuery({ queryKey: ["acessos-financeiro"], queryFn: () => listar() });
  const candidatos = useQuery({
    queryKey: ["acessos-financeiro-candidatos"],
    queryFn: () => candidatosFn(),
  });

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [avisar, setAvisar] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revogarAlvo, setRevogarAlvo] = useState<{
    userId: string;
    email: string;
    nome: string | null;
    unidades: number;
    todas: boolean;
  } | null>(null);
  const [busca, setBusca] = useFiltroNaUrl("q", "");

  useEffect(() => {
    if (!permLoading && !can("admin.acessos.financeiro")) navigate({ to: "/" });
  }, [permLoading, can, navigate]);

  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      definir({ data: { userId: r.userId, unidades: r.unidades, avisarPorEmail: avisar } }),
    onSuccess: (res: { unidades: string[]; emailEnviado: boolean }, r) => {
      setErro(null);
      const msg =
        res.unidades.length === 0
          ? `${r.email} continua entrando no Financeiro, mas sem nenhuma unidade liberada — ela não verá número nenhum.`
          : `${r.email} agora abre ${res.unidades.length} unidade(s).` +
            (avisar ? (res.emailEnviado ? " E-mail enviado." : " O e-mail NÃO saiu — avise por outro canal.") : "");
      setAviso(msg);
      if (avisar && !res.emailEnviado) toast.warning(msg);
      else toast.success(msg);
      setRascunho(null);
      qc.invalidateQueries({ queryKey: ["acessos-financeiro"] });
      qc.invalidateQueries({ queryKey: ["acessos-financeiro-candidatos"] });
    },
    onError: (e: Error) => {
      setErro(e.message);
      toast.error(`Não foi possível salvar: ${e.message}`);
    },
  });

  const tirar = useMutation({
    mutationFn: (alvo: { userId: string; email: string }) => revogar({ data: { userId: alvo.userId } }),
    onSuccess: (res: { sincronizado: boolean }, alvo) => {
      setErro(null);
      const msg = res.sincronizado
        ? `Acesso de ${alvo.email} revogado e já aplicado no cockpit.`
        : `Acesso de ${alvo.email} revogado aqui. A pessoa ainda não tinha conta no cockpit, então não havia o que revogar lá.`;
      setAviso(msg);
      toast.success(msg);
      setRevogarAlvo(null);
      qc.invalidateQueries({ queryKey: ["acessos-financeiro"] });
      qc.invalidateQueries({ queryKey: ["acessos-financeiro-candidatos"] });
    },
    onError: (e: Error) => {
      setErro(e.message);
      toast.error(`Não foi possível revogar: ${e.message}`);
    },
  });

  const unidades = acessos.data?.unidades ?? [];
  const pessoas = acessos.data?.pessoas ?? [];
  const rotulo = useMemo(
    () => new Map(unidades.map((u) => [u.id, u.rotulo])),
    [unidades],
  );
  const veemTudo = pessoas.filter((p) => p.todas).length;
  const visiveis = useMemo(() => {
    const t = normalizar(busca);
    if (!t) return pessoas;
    return pessoas.filter((p) => normalizar(`${p.nome ?? ""} ${p.email}`).includes(t));
  }, [busca, pessoas]);

  const titulo = "Acessos do Financeiro";
  const pergunta = "Quem acessa o Financeiro, e de quais empresas?";

  if (permLoading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="pagina" />
      </div>
    );
  if (!can("admin.acessos.financeiro"))
    return (
      <AppShell title={titulo} pergunta={pergunta}>
        <div className="mx-auto max-w-7xl px-4 py-6">
          <EstadoSemAcesso oQueFalta="admin.acessos.financeiro (Administração do Financeiro)" />
        </div>
      </AppShell>
    );

  return (
    <AppShell
      title={titulo}
      pergunta={pergunta}
      subtitle={
        <>
          {acessos.data
            ? `${pessoas.length} ${pessoas.length === 1 ? "pessoa" : "pessoas"} · ${unidades.length} unidades · `
            : ""}
          Salvar reescreve a concessão no Brain Financeiro na hora; quem está com o cockpit aberto vê
          a mudança na próxima requisição. O e-mail só sai quando “avisar por e-mail” está marcado.
        </>
      }
    >
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {aviso && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-success/40 bg-success/5 p-4">
            <p className="text-sm text-foreground">{aviso}</p>
            <button
              onClick={() => setAviso(null)}
              className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
            >
              Fechar
            </button>
          </div>
        )}
        {erro && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm text-foreground">{erro}</p>
            <button
              onClick={() => setErro(null)}
              className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
            >
              Fechar
            </button>
          </div>
        )}

        {/* A ressalva mais importante da tela, e ela é sobre TEMPO, não sobre
            permissão: a concessão viaja para o cockpit no app_metadata, que é
            reescrito aqui na hora — mas quem estiver com a tela do cockpit
            aberta só vê a mudança na próxima requisição. */}
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          <p className="mb-1 font-semibold text-foreground">Como isto chega no cockpit</p>
          <p>
            Salvar aqui reescreve a concessão no Brain Financeiro na mesma hora. Quem estiver com a
            tela de lá aberta continua vendo o que já estava carregado até a próxima requisição —
            recarregar resolve. Tirar todas as unidades de alguém <strong>não</strong> tira a pessoa
            do produto: ela entra e não vê número nenhum. Para tirar de vez, use Revogar.
          </p>
        </div>

        {veemTudo > 0 && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">
              {veemTudo} pessoa(s) marcadas como "vê todas"
            </p>
            <p>
              Elas estão com <code>todas_empresas</code> ligada, e isso é diferente de ter as 9
              unidades marcadas: quando uma empresa nova for cadastrada, elas passam a enxergá-la
              sozinhas. Quem tem recorte não passa — e é isso que se quer dos dois lados.
            </p>
          </div>
        )}

        <section className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {pessoas.length} pessoa(s) com acesso
            </h2>
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar nome ou e-mail"
                aria-label="Buscar nome ou e-mail"
                className="h-8 w-[220px] pl-8"
              />
            </div>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value=""
              onChange={(e) => {
                const c = (candidatos.data?.candidatos ?? []).find((x) => x.userId === e.target.value);
                if (c) {
                  setRascunho({ ...c, unidades: [], novo: true });
                  setAvisar(true);
                }
              }}
            >
              <option value="">+ Dar acesso a alguém…</option>
              {(candidatos.data?.candidatos ?? []).map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.nome ? `${c.nome} · ${c.email}` : c.email}
                </option>
              ))}
            </select>
            </div>
          </div>

          {acessos.isLoading ? (
            <div className="p-4">
              <Carregando variante="tabela" />
            </div>
          ) : acessos.isError ? (
            <div className="p-4">
              <EstadoErro
                titulo="Não foi possível carregar os acessos do Financeiro"
                detalhe={(acessos.error as Error)?.message}
                tentarNovamente={() => acessos.refetch()}
              />
            </div>
          ) : pessoas.length === 0 ? (
            <div className="p-4">
              <EstadoVazio
                titulo="Ninguém tem acesso ao Financeiro"
                descricao="Use “+ Dar acesso a alguém…” para liberar a primeira pessoa."
              />
            </div>
          ) : visiveis.length === 0 ? (
            <div className="p-4">
              <EstadoVazio
                titulo="Nenhuma pessoa com esse nome ou e-mail"
                total={pessoas.length}
                acao={
                  <Button variant="outline" size="sm" onClick={() => setBusca("")}>
                    Limpar busca
                  </Button>
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Pessoa</th>
                  <th className="px-4 py-2 font-medium">Perfil no Ops</th>
                  <th className="px-4 py-2 font-medium">Unidades que abre</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.userId} className="border-b border-border/60 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.nome ?? p.email}</div>
                      {p.nome && <div className="text-xs text-muted-foreground">{p.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.papeis.length ? p.papeis.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.todas ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-foreground">
                          todas as unidades
                        </span>
                      ) : p.unidades.length === 0 ? (
                        <span className="text-xs text-muted-foreground">nenhuma</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.unidades.map((e: string) => (
                            <span
                              key={e}
                              className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"
                            >
                              {rotulo.get(e) ?? e}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setRascunho({
                            userId: p.userId,
                            email: p.email,
                            nome: p.nome,
                            // Herdado abre com TUDO marcado: é o que ela vê hoje.
                            // Abrir vazio faria parecer que ela não tem nada.
                            unidades: p.todas ? unidades.map((u) => u.id) : p.unidades,
                            novo: false,
                          });
                          setAvisar(false);
                        }}
                        className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                      >
                        Editar unidades
                      </button>
                      <button
                        onClick={() =>
                          setRevogarAlvo({
                            userId: p.userId,
                            email: p.email,
                            nome: p.nome,
                            unidades: p.unidades.length,
                            todas: p.todas,
                          })
                        }
                        className="ml-2 rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {rascunho && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5">
            <h3 className="text-sm font-semibold text-foreground">
              {rascunho.novo ? "Dar acesso ao Financeiro" : "Unidades que esta pessoa abre"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {rascunho.nome ? `${rascunho.nome} · ` : ""}
              {rascunho.email}
            </p>

            <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
              {unidades.map((u) => {
                const marcada = rascunho.unidades.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() =>
                        setRascunho({
                          ...rascunho,
                          unidades: marcada
                            ? rascunho.unidades.filter((x) => x !== u.id)
                            : [...rascunho.unidades, u.id],
                        })
                      }
                    />
                    <span className="text-sm text-foreground">{u.rotulo}</span>
                    {u.tipo && (
                      <span className="text-xs text-muted-foreground">({u.tipo})</span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() =>
                  setRascunho({
                    ...rascunho,
                    unidades:
                      rascunho.unidades.length === unidades.length ? [] : unidades.map((u) => u.id),
                  })
                }
                className="text-xs text-muted-foreground underline"
              >
                {rascunho.unidades.length === unidades.length ? "desmarcar todas" : "marcar todas"}
              </button>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={avisar}
                  onChange={(e) => setAvisar(e.target.checked)}
                />
                avisar por e-mail
              </label>
            </div>

            {/* O consolidado exige TODAS as unidades. Sem este aviso, tirar uma
                unidade de alguém tiraria também a visão consolidada dela, sem
                que quem concedeu tivesse pedido isso. */}
            {rascunho.unidades.length > 0 && rascunho.unidades.length < unidades.length && (
              <p className="mt-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Com recorte parcial esta pessoa <strong>não vê o Consolidado</strong> — ele soma
                todas as unidades, e mostrá-lo a quem não abre todas entregaria justamente o que o
                recorte está negando.
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRascunho(null)}
                className="rounded-full border border-border px-4 py-1.5 text-xs hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => salvar.mutate(rascunho)}
                disabled={salvar.isPending}
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!revogarAlvo} onOpenChange={(o) => !o && setRevogarAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Tirar {revogarAlvo?.nome ?? revogarAlvo?.email} do Brain Financeiro?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa deixa de entrar no produto
              {revogarAlvo?.todas
                ? ", que hoje ela abre em todas as unidades"
                : revogarAlvo?.unidades
                  ? `, que hoje ela abre em ${revogarAlvo.unidades} unidade(s)`
                  : ""}
              . Se estiver com o cockpit aberto, sai na próxima requisição. O acesso dela ao Ops e às
              unidades da rede não muda. Para voltar, é preciso dar o acesso de novo aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={tirar.isPending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                if (revogarAlvo) tirar.mutate({ userId: revogarAlvo.userId, email: revogarAlvo.email });
              }}
            >
              {tirar.isPending ? "Revogando…" : "Revogar acesso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
