import { createFileRoute } from "@tanstack/react-router";
import { ABAS, DashboardMonetizacao } from "@/components/monetizacao/dashboard";
import type { Aba } from "@/components/monetizacao/dashboard";
export const Route = createFileRoute("/_authenticated/monetizacao")({
  validateSearch: (s: Record<string, unknown>) => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : ("operacao" as Aba),
  }),
  component: Page,
});
function Page() {
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DashboardMonetizacao
      aba={aba}
      setAba={(a) => navigate({ search: { aba: a }, replace: true })}
    />
  );
}
