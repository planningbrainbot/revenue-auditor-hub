import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoErro, EstadoVazio, PageHeader } from "@/components/planning";

// Porta do sócio para a ficha da própria unidade. O menu precisa de um caminho
// fixo, e a ficha mora em /unidades/$unidadeId: aqui se descobre qual é a
// unidade (ops.minhas_unidades, que na simulação responde pela unidade vestida)
// e se vai para ela. Quem tem mais de uma escolhe.
export const Route = createFileRoute("/_authenticated/minha-unidade")({
  ssr: false,
  head: () => ({ meta: [{ title: "Ficha da unidade – Planning" }] }),
  component: MinhaUnidadePage,
});

function MinhaUnidadePage() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["minhas-unidades-ficha"],
    queryFn: async () => {
      // minhas_unidades não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ids, error } = await (supabase as any).rpc("minhas_unidades");
      if (error) throw error;
      const lista = ((ids ?? []) as unknown[]).map(Number);
      if (lista.length <= 1) return lista.map((id) => ({ id, nome: null as string | null }));
      const { data, error: e2 } = await supabase
        .from("unidades")
        .select("id,nome_da_praca")
        .in("id", lista)
        .order("nome_da_praca");
      if (e2) throw e2;
      return (data ?? []).map((u) => ({ id: u.id, nome: u.nome_da_praca }));
    },
  });

  const unica = q.data?.length === 1 ? q.data[0].id : null;
  useEffect(() => {
    if (unica != null) {
      navigate({ to: "/unidades/$unidadeId", params: { unidadeId: String(unica) }, replace: true });
    }
  }, [unica, navigate]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      {q.isLoading || unica != null ? (
        <Carregando variante="pagina" />
      ) : q.isError ? (
        <EstadoErro
          titulo="Não foi possível descobrir a sua unidade"
          detalhe={(q.error as Error)?.message}
          tentarNovamente={() => q.refetch()}
        />
      ) : !q.data?.length ? (
        <EstadoVazio
          titulo="Sua conta não está ligada a nenhuma unidade"
          descricao="Peça a quem administra os acessos para ligar a sua conta à unidade."
        />
      ) : (
        <>
          <PageHeader titulo="Ficha da unidade" pergunta="De qual unidade você quer ver a ficha?" />
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {q.data.map((u) => (
              <li key={u.id}>
                <Link
                  to="/unidades/$unidadeId"
                  params={{ unidadeId: String(u.id) }}
                  className="block rounded-xl border bg-card p-3 font-medium hover:bg-muted/40"
                >
                  {u.nome ?? `Unidade ${u.id}`}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
