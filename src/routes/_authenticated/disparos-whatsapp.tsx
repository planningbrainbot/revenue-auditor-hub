import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Send } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsExecucaoTab } from "@/components/nps/nps-execucao-tab";
import { CustosTab } from "@/components/whatsapp/custos-tab";

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

function DisparosWhatsappPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Send className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Disparos de WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhamento de campanhas de disparo em massa — hoje só NPS, mas a estrutura é genérica pra
            qualquer campanha futura.
          </p>
        </div>
      </div>

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
