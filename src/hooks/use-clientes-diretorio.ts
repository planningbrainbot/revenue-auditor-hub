import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClientesDiretorio } from "@/lib/clientes.functions";

// Diretório unificado de clientes (v_clientes_diretorio) pra tela /clientes.
// Mesmo padrão de useClientesPrePlanning: uma busca só, ~11 mil linhas, cache
// de 5 min — filtros, ordenação e paginação são client-side.
//
// O id do usuário entra na chave porque o retorno é escopado por unidade no
// servidor: sem isso, um segundo login na mesma aba receberia do cache o
// diretório do usuário anterior.
//
// Recebe o id em vez de chamar useAuth() por dentro — mesmo motivo documentado
// em usePermissions: o `beforeLoad` de /_authenticated já resolveu o usuário, e
// esperar o efeito do useAuth adiaria a busca de 11 mil linhas para o segundo
// render. Pior: com a query desabilitada no primeiro render, `isLoading` é false
// no react-query v5 (é `isPending && isFetching`), então a tela chegaria a
// renderizar "Nenhum cliente encontrado." antes de a busca começar.
export function useClientesDiretorio(userId: string) {
  const fn = useServerFn(listClientesDiretorio);
  return useQuery({
    queryKey: ["clientes-diretorio", userId],
    queryFn: () => fn(),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}
