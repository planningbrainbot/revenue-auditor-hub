import { createFileRoute } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/use-permissions";
import { FilaTab } from "@/components/fila-cella/fila-tab";
import { NovosContratosTab } from "@/components/fila-cella/novos-contratos-tab";
import { LogToquesTab } from "@/components/fila-cella/log-toques-tab";
import { DicionarioTab } from "@/components/fila-cella/dicionario-tab";

export const Route = createFileRoute("/_authenticated/fila-cella")({
  component: FilaCellaPage,
});

function FilaCellaPage() {
  const { can, loading } = usePermissions();

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  // A tela checa permissão no componente de propósito: hoje base-contatos,
  // painel-cs, nps e funil-receita não checam, e uma URL digitada à mão abre a
  // tela em branco em vez de dizer o que falta.
  if (!can("view.fila_cella")) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Peça a um admin a permissão <code>view.fila_cella</code> para acessar a Fila Cella.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Fila Cella</h1>
            <p className="text-sm text-muted-foreground">
              Canal dedicado sobre a base instalada. Esta tela cobre o <strong>Funil B</strong> — a
              cadeia contratos → Tiago → análise não está aqui.
            </p>
          </div>
        </div>

        <Tabs defaultValue="fila" className="w-full">
          <TabsList>
            <TabsTrigger value="fila">Fila</TabsTrigger>
            <TabsTrigger value="novos">Novos do mês</TabsTrigger>
            <TabsTrigger value="log">Log de toques</TabsTrigger>
            <TabsTrigger value="dicionario">Dicionário &amp; Procedência</TabsTrigger>
          </TabsList>

          <TabsContent value="fila">
            <FilaTab />
          </TabsContent>
          <TabsContent value="novos">
            <NovosContratosTab />
          </TabsContent>
          <TabsContent value="log">
            <LogToquesTab />
          </TabsContent>
          <TabsContent value="dicionario">
            <DicionarioTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
