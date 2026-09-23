import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { matrizDeEvidencias } from "@/lib/cockpit-ceo/evidencias";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";

// Baixa a matriz de evidências (CSV). Gerada no navegador a partir do catálogo e dos estados; não
// passa por servidor e não leva dado de cliente.
export function ExportarEvidencias({ cockpit }: { cockpit: Cockpit }) {
  const baixar = () => {
    const agora = new Date().toISOString();
    const blob = new Blob(["﻿" + matrizDeEvidencias(cockpit, agora)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriz-evidencias-cockpit-${agora.slice(0, 10)}${cockpit.sintetico ? "-sintetico" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        Matriz de evidências: cada pergunta com cobertura, fonte, responsável, o que falta e o
        estado atual dos números. Só catálogo e estados, sem dado de cliente.
      </p>
      <Button size="sm" variant="outline" onClick={baixar}>
        <Download className="mr-1 h-3.5 w-3.5" />
        Exportar CSV
      </Button>
    </div>
  );
}
