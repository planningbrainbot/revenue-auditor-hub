import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { NpsExecucaoTab } from "@/components/nps/nps-execucao-tab";

export const Route = createFileRoute("/_authenticated/disparos-whatsapp")({
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

      <NpsExecucaoTab />
    </div>
  );
}
