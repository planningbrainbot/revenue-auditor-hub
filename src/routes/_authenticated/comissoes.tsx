import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { ComissoesContent } from "@/components/page-content/comissoes-content";

type BuscaComissoes = { q?: string; closer?: string; sdr?: string; status?: string; base?: string };

const texto = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authenticated/comissoes")({
  // Busca, Closer, SDR, status do 1º pagamento e base moram na URL (N7).
  validateSearch: (search: Record<string, unknown>): BuscaComissoes => {
    const out: BuscaComissoes = {};
    for (const k of ["q", "closer", "sdr", "status", "base"] as const) {
      const v = texto(search[k]);
      if (v) out[k] = v;
    }
    return out;
  },
  head: () => ({
    meta: [{ title: "Comissões · Planning Brain" }],
  }),
  component: ComissoesPage,
});

function ComissoesPage() {
  useAuth();
  // O cabeçalho (MolduraReceita) mora no conteúdo: o "Atualizar" das ações
  // depende do DataProvider.
  return <ComissoesContent />;
}
