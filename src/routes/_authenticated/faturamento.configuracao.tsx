import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import {
  AREA_CONTROLADORIA,
  AREA_FATURAMENTO,
  EmConstrucao,
  PaginaFaturamento,
  PortaoFaturamento,
} from "@/components/faturamento/moldura";

// Configuração (arquétipo Configuração). Contrato: docs/design/contratos/faturamento-configuracao.md.
// ESQUELETO da primeira metade da T4: só a área Faturamento · Controladoria (`admin.faturamento`) abre.
// Ligar a gravação no Omie continua só do admin do Brain, conferido pelo banco (`fat_emissora_config`).
export const Route = createFileRoute("/_authenticated/faturamento/configuracao")({
  head: () => ({ meta: [{ title: "Configuração · Planning Brain" }] }),
  component: ConfiguracaoPagina,
});

const PERGUNTA = "Quem pede e aprova em cada empresa, e o que ela já manda ao Omie?";

function ConfiguracaoPagina() {
  useAuth();
  return (
    <PortaoFaturamento
      area={AREA_CONTROLADORIA}
      oQueFalta="Faturamento · Controladoria"
      titulo="Configuração"
      pergunta={PERGUNTA}
      carregando="tabela"
    >
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo="Configuração" pergunta={PERGUNTA} />
        <EmConstrucao descricao="A configuração das empresas, pessoas e serviços entra na próxima entrega do Portal de Faturamento." />
      </PaginaFaturamento>
    </PortaoFaturamento>
  );
}
