import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsExecucaoTab } from "@/components/nps/nps-execucao-tab";
import { CustosTab } from "@/components/whatsapp/custos-tab";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/disparos-whatsapp")({
  ssr: false,
  // Bloqueada desde 17/09/2026: só quem tem `send.whatsapp` (perfil Super admin)
  // abre. Sem isto, o link direto abria a página mesmo fora do menu.
  beforeLoad: async () => {
    const { data } = await supabase.rpc("can", { _key: "send.whatsapp" });
    if (!data) throw redirect({ to: "/" });
  },
  component: DisparosWhatsappPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function DisparosWhatsappPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Disparos de WhatsApp"
        descricao="Acompanhamento de campanhas de disparo em massa — hoje só NPS, mas a estrutura é genérica pra qualquer campanha futura."
      />

      <Tabs defaultValue="execucao">
        <TabsList>
          <TabsTrigger value="execucao">Execução</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>
        <TabsContent value="execucao" className="mt-4">
          <NpsExecucaoTab />
        </TabsContent>
        <TabsContent value="custos" className="mt-4">
          <CustosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
