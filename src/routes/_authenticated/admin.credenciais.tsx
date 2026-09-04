import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { SegredosView } from "@/components/integracoes/segredos-view";

export const Route = createFileRoute("/_authenticated/admin/credenciais")({
  component: CredenciaisPage,
});

function CredenciaisPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Chaves de Integração</h1>
          <p className="text-sm text-muted-foreground">
            Credenciais dos serviços externos. O valor entra por aqui e não volta para a tela.
          </p>
        </div>
      </div>
      <SegredosView />
    </div>
  );
}
