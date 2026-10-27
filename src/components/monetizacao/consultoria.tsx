import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsultoriaEmpresa } from "./consultoria-empresa";
import { ConsultoriaFila } from "./consultoria-fila";
import { ConsultoriaFunil } from "./consultoria-funil";
import { HandoffConsultoria } from "./handoff-consultoria";
import type { BuscaMonetizacao } from "./busca";

// Tela Consultoria (`/monetizacao?aba=handoff-consultoria`): uma entrada na lateral e as visões em abas, com a visão na
// URL (`visao`, N7). Pedido do dono em 06/10/2026: "Não quero duas telas, quero uma só."
//   Funil (padrão)        → consultoria-funil.tsx (contrato monetizacao-consultoria-funil.md), desde 16/10/2026
//   Fila de cobrança      → consultoria-fila.tsx (mesmo contrato)
//   Buscar empresa        → consultoria-empresa.tsx (contrato monetizacao-consultoria-empresa.md)
//   Handoff e repasse     → handoff-consultoria.tsx (contrato monetizacao-handoff-consultoria.md)
// O Cruzamento com a call saiu em 16/10/2026 (PRD de 07/10, D3): o Funil responde a mesma pergunta ao vivo, e o link
// antigo abre o Funil. Trocar de aba limpa os filtros da outra visão: cada uma tem os seus.

export function Consultoria({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const visao = busca.visao ?? "funil";
  const abas = (
    <Tabs
      value={visao}
      onValueChange={(v) =>
        mudarBusca({
          visao: v === "fila" || v === "empresa" || v === "handoff" ? v : undefined,
          q: undefined,
          empresa: undefined,
          grafico: undefined,
          regime: undefined,
          de: undefined,
          ate: undefined,
          unidade: undefined,
          origem: undefined,
          perfil: undefined,
          passo: undefined,
          grupo: undefined,
        })
      }
    >
      <TabsList className="w-full overflow-x-auto overflow-y-hidden" aria-label="Visões da Consultoria">
        <TabsTrigger value="funil">Funil</TabsTrigger>
        <TabsTrigger value="fila">Fila de cobrança</TabsTrigger>
        <TabsTrigger value="empresa">Buscar empresa</TabsTrigger>
        <TabsTrigger value="handoff">Handoff e repasse</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (visao === "empresa")
    return <ConsultoriaEmpresa busca={busca} mudarBusca={mudarBusca} abas={abas} />;
  if (visao === "fila") return <ConsultoriaFila busca={busca} mudarBusca={mudarBusca} abas={abas} />;
  if (visao === "handoff")
    return <HandoffConsultoria busca={busca} mudarBusca={mudarBusca} abas={abas} />;
  return <ConsultoriaFunil busca={busca} mudarBusca={mudarBusca} abas={abas} />;
}
