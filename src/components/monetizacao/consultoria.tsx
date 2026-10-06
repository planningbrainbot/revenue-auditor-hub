import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsultoriaEmpresa } from "./consultoria-empresa";
import { CruzamentoConsultoria } from "./cruzamento-consultoria";
import { HandoffConsultoria } from "./handoff-consultoria";
import type { BuscaMonetizacao } from "./busca";

// Tela Consultoria (`/monetizacao?aba=handoff-consultoria`): uma entrada na lateral e duas visões em abas,
// com a visão na URL (`visao`, N7). Pedido do dono em 06/10/2026: "Não quero duas telas, quero uma só. Pode
// colocar duas abas, mas na mesma tela."
//   Handoff e repasse     → handoff-consultoria.tsx (contrato monetizacao-handoff-consultoria.md)
//   Cruzamento com a call → cruzamento-consultoria.tsx (contrato monetizacao-cruzamento-consultoria.md)
//   Buscar empresa        → consultoria-empresa.tsx (contrato monetizacao-consultoria-empresa.md)
// Trocar de aba limpa a gaveta e os filtros da outra visão: cada uma tem os seus.

export function Consultoria({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const visao = busca.visao ?? "handoff";
  const abas = (
    <Tabs
      value={visao}
      onValueChange={(v) =>
        mudarBusca({
          visao: v === "cruzamento" || v === "empresa" ? v : undefined,
          q: undefined,
          empresa: undefined,
          grafico: undefined,
          regime: undefined,
          de: undefined,
          ate: undefined,
          unidade: undefined,
        })
      }
    >
      <TabsList className="w-full" aria-label="Visões da Consultoria">
        <TabsTrigger value="handoff">Handoff e repasse</TabsTrigger>
        <TabsTrigger value="cruzamento">Cruzamento com a call</TabsTrigger>
        <TabsTrigger value="empresa">Buscar empresa</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (visao === "empresa")
    return <ConsultoriaEmpresa busca={busca} mudarBusca={mudarBusca} abas={abas} />;
  return visao === "cruzamento" ? (
    <CruzamentoConsultoria busca={busca} mudarBusca={mudarBusca} abas={abas} />
  ) : (
    <HandoffConsultoria busca={busca} mudarBusca={mudarBusca} abas={abas} />
  );
}
