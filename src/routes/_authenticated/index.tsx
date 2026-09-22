import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { usePermissions } from "@/hooks/use-permissions";
import { partesDoLink, primeiraTelaAcessivel } from "@/lib/areas";
import { meuAcessoGrowth } from "@/lib/produtos.functions";
import { lerProdutoPadrao } from "./inicio";

export const Route = createFileRoute("/_authenticated/")({
  component: RootRedirect,
});

/**
 * Decide a primeira tela depois do login.
 *
 * Regra, nesta ordem:
 *
 * 1. Sócio regional vai direto para o painel da unidade dele, como sempre foi.
 * 2. Quem fixou um produto ("sempre começar por aqui", no /inicio) vai para ele.
 * 3. Quem tem mais de um produto escolhe em /inicio.
 * 4. Quem só tem o Ops vai direto para a PRIMEIRA TELA QUE ELE ABRE — seletor
 *    de uma opção é pedágio, não porta. Era `/rede-overview` fixo, e quem não
 *    tem a área Rede (o caso de quem só tem Planning People) começava o produto
 *    numa tela de erro.
 */
function RootRedirect() {
  const { can, temArea, primaryRole, loading } = usePermissions();

  const acessoGrowthFn = useServerFn(meuAcessoGrowth);
  const growth = useQuery({
    queryKey: ["meu-acesso-growth"],
    queryFn: () => acessoGrowthFn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (loading || growth.isLoading) return null;

  if (primaryRole === "socio_regional") {
    return <Navigate to="/painel-unidade" replace />;
  }

  const padrao = lerProdutoPadrao();
  if (padrao === "growth" && growth.data?.temAcesso) {
    // Outra aplicação no mesmo domínio: navegação de verdade, não rota interna.
    if (typeof window !== "undefined") window.location.href = "/growth";
    return null;
  }
  if (padrao === "financeiro" && can("view.brain_financeiro")) {
    if (typeof window !== "undefined") window.location.href = "/financeiro";
    return null;
  }
  const primeira = primeiraTelaAcessivel(temArea, can);
  const destino = primeira ? partesDoLink(primeira) : null;

  if (padrao === "ops") {
    return destino ? (
      <Navigate to={destino.to} search={destino.search} replace />
    ) : (
      <Navigate to="/inicio" replace />
    );
  }

  const temOutroProduto = Boolean(growth.data?.temAcesso) || can("view.brain_financeiro");
  if (temOutroProduto) {
    return <Navigate to="/inicio" replace />;
  }

  return destino ? (
    <Navigate to={destino.to} search={destino.search} replace />
  ) : (
    <Navigate to="/inicio" replace />
  );
}
