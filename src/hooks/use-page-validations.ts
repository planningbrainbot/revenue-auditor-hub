import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { listPageValidations } from "@/lib/page-validations.functions";

export function usePageValidations() {
  const { user } = useAuth();
  const fn = useServerFn(listPageValidations);
  return useQuery({
    queryKey: ["page-validations"],
    queryFn: () => fn(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

export function useIsPageValidated(pageKey: string): boolean | null {
  const q = usePageValidations();
  if (!q.data) return null;
  const exata = q.data.rows.find((r) => r.page_key === pageKey);
  if (exata) return exata.validated;

  // Subpágina herda a marcação do caminho pai. /unidades era uma página só com
  // cinco abas; virou cinco páginas irmãs sob /unidades/*, e sem a herança
  // todas nasceriam "em validação" no dia do desmembramento, avisando de um
  // problema que não existe. A raiz "/" fica fora: é prefixo de tudo.
  const pai = q.data.rows
    .filter((r) => r.page_key !== "/" && pageKey.startsWith(r.page_key + "/"))
    .sort((a, b) => b.page_key.length - a.page_key.length)[0];
  return pai?.validated ?? false;
}
