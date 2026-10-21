import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AREA_CONTROLADORIA, PortaoFaturamento } from "@/components/faturamento/moldura";
import { ConfiguracaoFaturamento } from "@/components/faturamento/configuracao";
import { lerBuscaConfig } from "@/lib/faturamento/config";

// Configuração (arquétipo Configuração). Contrato: docs/design/contratos/faturamento-configuracao.md.
// Só a área Faturamento · Controladoria (`admin.faturamento`) abre. Ligar a gravação no Omie continua só do
// admin do Brain, conferido pelo banco (`fat_emissora_config`). Busca, inativas e a empresa aberta na URL.
export const Route = createFileRoute("/_authenticated/faturamento/configuracao")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaConfig(s),
  head: () => ({ meta: [{ title: "Configuração · Planning Brain" }] }),
  component: ConfiguracaoPagina,
});

function ConfiguracaoPagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento
      area={AREA_CONTROLADORIA}
      oQueFalta="Faturamento · Controladoria"
      titulo="Configuração"
      pergunta="Quem pede e aprova em cada empresa, e o que ela já manda ao Omie?"
      carregando="tabela"
    >
      <ConfiguracaoFaturamento busca={busca} />
    </PortaoFaturamento>
  );
}
