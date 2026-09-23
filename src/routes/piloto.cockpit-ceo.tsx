import { useMemo } from "react";
import { createFileRoute, notFound, type SearchSchemaInput } from "@tanstack/react-router";
import { CockpitCeo, type MudarBusca } from "@/components/cockpit-ceo/cockpit-ceo";
import { ThemeToggle } from "@/components/theme-toggle";
import { fonteSintetica } from "@/lib/cockpit-ceo/fixture-sintetica";
import { montarCockpit } from "@/lib/cockpit-ceo/indicadores";
import { buscaDaUrl, resolverPeriodo, validarBusca } from "@/lib/cockpit-ceo/periodo";
import type { BuscaUrl } from "@/lib/cockpit-ceo/periodo";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";

// Preview do piloto do Cockpit do CEO, com FONTE SINTÉTICA.
//
// Fica fora do `_authenticated` de propósito: o piloto não tem login nem banco. Só existe no
// servidor de desenvolvimento (ou com VITE_COCKPIT_PILOTO=1); no build publicado responde 404.
// Nenhum dado real passa por aqui: a fonte é `fonteSintetica`, e os destinos não navegam.
const habilitado = () => import.meta.env.DEV || import.meta.env.VITE_COCKPIT_PILOTO === "1";

export const Route = createFileRoute("/piloto/cockpit-ceo")({
  ssr: false,
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => buscaDaUrl(s),
  beforeLoad: () => {
    if (!habilitado()) throw notFound();
  },
  component: Pagina,
});

function Pagina() {
  const busca = validarBusca(Route.useSearch());
  const navigate = Route.useNavigate();
  const hoje = hojeSaoPaulo();
  const periodo = useMemo(
    () => resolverPeriodo({ periodo: busca.periodo, de: busca.de, ate: busca.ate }, hoje),
    [busca.periodo, busca.de, busca.ate, hoje],
  );
  const cockpit = useMemo(
    () =>
      montarCockpit(fonteSintetica(hoje, new Date().toISOString()), {
        periodo,
        perimetro: busca.perimetro,
      }),
    [hoje, periodo, busca.perimetro],
  );
  const aoMudar: MudarBusca = (parcial) =>
    navigate({
      search: (s: BuscaUrl) => buscaDaUrl({ ...s, ...parcial }),
      replace: !parcial.indicador,
    });
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b bg-card px-4">
        <span className="text-sm font-semibold">Planning Brain</span>
        <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[11px] text-fuchsia-700 dark:text-fuchsia-300">
          Preview do piloto · fonte sintética · sem login e sem banco
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <CockpitCeo cockpit={cockpit} busca={busca} periodo={periodo} aoMudar={aoMudar} preview />
    </div>
  );
}
