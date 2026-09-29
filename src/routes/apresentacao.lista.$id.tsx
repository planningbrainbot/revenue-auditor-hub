import { useEffect } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { temSenhaProvisoria } from "@/lib/senha-provisoria";
import { lerApresentacaoLista } from "@/lib/monetizacao/functions";
import { NOMES_ENVIO } from "@/lib/monetizacao/types";
import { Button } from "@/components/ui/button";
import { Carregando, EstadoErro } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Apresentação de uma lista para o sócio da unidade (29/09: "abrir uma tela isolada em uma url da
// própria página ao invés de fazer o download"). Fica fora do `_authenticated` para não ter menu
// nem cabeçalho do app, mas exige a mesma sessão: o guarda abaixo repete o do layout, e a leitura
// passa pela RLS de listas, itens e contas com a sessão de quem abre. Clara de propósito: é para
// mostrar na tela ou salvar em PDF.
export const Route = createFileRoute("/apresentacao/lista/$id")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) throw redirect({ to: "/auth" });
    if (temSenhaProvisoria(data.session.user)) throw redirect({ to: "/redefinir-senha" });
  },
  component: ApresentacaoLista,
});

const SITUACAO: Record<string, string> = {
  draft: "Rascunho",
  validated: "Validada com o sócio",
  sent: "No Pipedrive",
};
const ORDEM = ["consultoria", "finance", "cella", "recon"] as const;
const dataBr = (d: string) => new Date(d).toLocaleDateString("pt-BR");

function ApresentacaoLista() {
  const { id } = Route.useParams();
  const ler = useServerFn(lerApresentacaoLista);
  const q = useQuery({
    queryKey: ["apresentacao-lista", id],
    queryFn: () => ler({ data: { id } }),
    staleTime: 60_000,
  });
  // A tela segue o tema claro enquanto está aberta e devolve o tema da pessoa ao sair.
  useEffect(() => {
    const html = document.documentElement;
    const escuro = html.classList.contains("dark");
    html.classList.remove("dark");
    return () => {
      if (escuro) html.classList.add("dark");
    };
  }, []);
  useEffect(() => {
    if (q.data) document.title = `${q.data.nome} · Caixa de Oportunidade`;
  }, [q.data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-[1100px] space-y-6 px-6 py-10 print:px-0 print:py-4">
        {q.isPending ? (
          <Carregando variante="pagina" />
        ) : q.error || !q.data ? (
          <EstadoErro
            titulo="Não foi possível abrir a apresentação"
            detalhe={(q.error as Error | null)?.message}
            tentarNovamente={() => q.refetch()}
          />
        ) : (
          <>
            <header className="space-y-4 border-b-2 border-primary pb-6">
              <img
                alt="Caixa de Oportunidade"
                width={235}
                src="/brand/caixa/assinatura-horizontal.svg"
              />
              <div>
                <p className="text-sm text-muted-foreground">
                  Planning · oportunidades da base da unidade
                </p>
                <h1 className="mt-1 text-3xl font-semibold">{q.data.nome}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {q.data.unidade} · {q.data.linhas.length} oportunidades em {q.data.contasUnicas}{" "}
                  empresas · {SITUACAO[q.data.status] ?? q.data.status} · atualizada em{" "}
                  {dataBr(q.data.atualizadaEm)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button size="sm" onClick={() => window.print()}>
                  <Printer className="mr-1 h-4 w-4" />
                  Imprimir ou salvar PDF
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/clientes" search={{ view: "listas", lista: id }}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Voltar à lista
                  </Link>
                </Button>
              </div>
            </header>

            <section aria-label="Oportunidades por produto" className="grid gap-3 sm:grid-cols-3">
              {ORDEM.filter(
                (p) => p !== "recon" || q.data!.linhas.some((l) => l.produto === "recon"),
              ).map((p) => (
                <div key={p} className="rounded-xl border bg-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {NOMES_ENVIO[p]}
                  </p>
                  <p className="num mt-1 text-2xl font-semibold">
                    {q.data!.linhas.filter((l) => l.produto === p).length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p === "consultoria"
                      ? "caixa em cerca de 3 meses"
                      : p === "finance"
                        ? "caixa em cerca de 8 meses"
                        : p === "cella"
                          ? "caixa em cerca de 24 meses"
                          : "conciliação para empresas acima de R$ 5 mi"}
                  </p>
                </div>
              ))}
            </section>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Faturamento</TableHead>
                  <TableHead>Segmento e regime</TableHead>
                  <TableHead>Próximo passo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.linhas.map((l, i) => (
                  <TableRow key={i} className="break-inside-avoid">
                    <TableCell className="align-top">
                      {/* Abre a ficha da conta na Base em outra aba; a apresentação continua aberta. */}
                      <Link
                        to="/clientes"
                        search={{ view: "monetizacao", item: l.item }}
                        target="_blank"
                        className="font-medium text-primary-text underline decoration-dotted underline-offset-4 hover:decoration-solid print:text-foreground print:no-underline"
                      >
                        {l.empresa}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {l.comContato ? "Com contato" : "Contato a obter com o sócio"}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      {NOMES_ENVIO[l.produto]}
                      {l.tambemFinance && (
                        <span className="block text-xs text-muted-foreground">
                          Também atende a Finance
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">{l.faturamento || "A confirmar"}</TableCell>
                    <TableCell className="align-top">
                      {l.segmento || "A confirmar"}
                      {l.regime && (
                        <span className="block text-xs text-muted-foreground">{l.regime}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">{l.proximoPasso}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <aside className="rounded-xl border p-4 text-sm text-muted-foreground">
              Uma empresa pode ter mais de uma oferta. Sócio que validou:{" "}
              {q.data.socio || "a registrar"}. Faturamento, segmento e regime são os do cadastro da
              base e podem ser corrigidos na conversa.
            </aside>
            <p className="text-xs text-muted-foreground">
              Gerado em {new Date().toLocaleString("pt-BR")} · uso interno Planning e unidade.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
