import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { GenteView } from "@/components/gente/gente-view";

export const Route = createFileRoute("/_authenticated/gente")({
  component: GentePage,
});

function GentePage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Gente da Rede</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro único de pessoas das unidades, com hierarquia de gestor. Cada unidade enxerga
            só a sua.
          </p>
        </div>
      </div>
      <GenteView />
    </div>
  );
}
