import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Carregando } from "@/components/planning";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { FunilContent } from "@/components/page-content/funil-content";
import { AuditoriaFaturamentoContent } from "@/components/page-content/auditoria-faturamento-content";

export const Route = createFileRoute("/_authenticated/funil-receita")({
  head: () => ({
    meta: [
      { title: "Funil de Receita – Planning" },
      {
        name: "description",
        content:
          "Onde o MRR contratado deixa de virar faturado e recebido, por unidade e mês.",
      },
    ],
  }),
  component: FunilReceitaPage,
});

type Aba = "funil" | "esperado";

/**
 * Funil de Receita (Lista/Relatório; contrato
 * `docs/design/contratos/receita-e-repasses.md` §2).
 *
 * A aba mora na URL (`?aba=esperado`, N7): antes vivia em `useState` e voltava
 * para o Funil a cada recarga. O mês (`?mes=`) e as unidades (`?unidades=`)
 * também; cada aba desenha a própria moldura, porque o universo e a régua de
 * data de uma não são os da outra.
 */
function FunilReceitaPage() {
  useAuth();
  const { can, loading } = usePermissions();
  const [abaBruta, setAba] = useFiltroNaUrl("aba", "funil");
  // Esperado × Recebido é auditoria de rede: sem essa permissão a aba só
  // levaria a uma tela de "sem permissão".
  const podeAuditoria = can("view.roas") || can("view.auditoria");
  // "esperado-recebido" era a chave interna da aba; aceita também na URL.
  const pedida: Aba =
    abaBruta === "esperado" || abaBruta === "esperado-recebido" ? "esperado" : "funil";
  const aba: Aba = pedida === "esperado" && podeAuditoria ? "esperado" : "funil";

  if (loading) return <Carregando variante="pagina" className="p-4 md:p-6" />;

  const abas = podeAuditoria ? (
    <Tabs value={aba} onValueChange={(v) => setAba(v)}>
      <TabsList>
        <TabsTrigger value="funil">Funil</TabsTrigger>
        <TabsTrigger value="esperado">Esperado × Recebido</TabsTrigger>
      </TabsList>
    </Tabs>
  ) : null;

  return aba === "esperado" ? (
    <AuditoriaFaturamentoContent abas={abas} />
  ) : (
    <FunilContent abas={abas} />
  );
}
