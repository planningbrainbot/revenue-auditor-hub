import { useMemo } from "react";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { CockpitCeo, type MudarBusca } from "@/components/cockpit-ceo/cockpit-ceo";
import { LoadingState, Panel } from "@/components/monetizacao/common";
import { useMonetizacao } from "@/hooks/use-monetizacao";
import { usePermissions } from "@/hooks/use-permissions";
import { fonteDoBrain } from "@/lib/cockpit-ceo/adaptador-brain";
import { montarCockpit } from "@/lib/cockpit-ceo/indicadores";
import { buscaDaUrl, resolverPeriodo, validarBusca } from "@/lib/cockpit-ceo/periodo";
import type { BuscaUrl } from "@/lib/cockpit-ceo/periodo";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";

// Cockpit do CEO com dado real, somente leitura.
//
// A área `cockpit_ceo` decide se a página abre; a carga só é montada depois disso, então quem não
// tem a área não dispara consulta nenhuma. Os dados vêm da mesma carga de Base e Monetização, com
// as permissões e a RLS que já valem lá: o cockpit não abre dado novo para ninguém.
export const Route = createFileRoute("/_authenticated/cockpit-ceo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => buscaDaUrl(s),
  component: Pagina,
});

function Pagina() {
  const perms = usePermissions();
  if (perms.loading) return <LoadingState retry={() => undefined} />;
  if (!perms.temArea("cockpit_ceo"))
    return (
      <div className="p-6">
        <Panel title="Cockpit do CEO">
          <p className="text-sm text-muted-foreground">
            Seu acesso não inclui a área Cockpit do CEO. A administração da plataforma controla esse
            acesso.
          </p>
        </Panel>
      </div>
    );
  return <CockpitReal acessoBase={perms.can("view.aquario") || perms.can("view.clientes")} />;
}

function CockpitReal({ acessoBase }: { acessoBase: boolean }) {
  const busca = validarBusca(Route.useSearch());
  const navigate = Route.useNavigate();
  const q = useMonetizacao();
  const hoje = hojeSaoPaulo();
  const periodo = useMemo(
    () => resolverPeriodo({ periodo: busca.periodo, de: busca.de, ate: busca.ate }, hoje),
    [busca.periodo, busca.de, busca.ate, hoje],
  );
  const fonte = fonteDoBrain(q, acessoBase, hoje, new Date().toISOString());
  const cockpit = useMemo(
    () => montarCockpit(fonte, { periodo, perimetro: busca.perimetro }),
    // A fonte muda quando a consulta muda; `agora` não deve refazer o cálculo a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, q.error, q.isLoading, acessoBase, periodo, busca.perimetro],
  );
  const aoMudar: MudarBusca = (parcial) =>
    navigate({
      search: (s: BuscaUrl) => buscaDaUrl({ ...s, ...parcial }),
      // Abrir um número empilha no histórico: o "voltar" do navegador fecha a composição.
      replace: !parcial.indicador,
    });
  if (fonte.monetizacao.estado === "carregando")
    return <LoadingState retry={() => void q.refetch()} />;
  return <CockpitCeo cockpit={cockpit} busca={busca} periodo={periodo} aoMudar={aoMudar} />;
}
