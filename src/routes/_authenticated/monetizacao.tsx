import { createFileRoute } from "@tanstack/react-router";
import { ABAS, DashboardMonetizacao } from "@/components/monetizacao/dashboard";
import type { Aba, BuscaMonetizacao } from "@/components/monetizacao/dashboard";
import { PRODUTOS } from "@/lib/monetizacao/types";
import type { Produto } from "@/lib/monetizacao/types";
const iso = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
export const Route = createFileRoute("/_authenticated/monetizacao")({
  validateSearch: (s: Record<string, unknown>): BuscaMonetizacao => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : ("operacao" as Aba),
    de: iso(s.de),
    ate: iso(s.ate),
    produto: PRODUTOS.includes(s.produto as Produto) ? (s.produto as Produto) : undefined,
  }),
  component: Page,
});
function Page() {
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DashboardMonetizacao
      busca={busca}
      navegar={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
    />
  );
}
