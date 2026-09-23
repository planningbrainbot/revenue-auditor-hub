import { AlertTriangle } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useIsPageValidated } from "@/hooks/use-page-validations";
import { usePermissions } from "@/hooks/use-permissions";

export function ValidationBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const validated = useIsPageValidated(pathname);
  const { scopedToOwnUnit } = usePermissions();

  // Sócios regionais não veem o banner de validação (controle interno da matriz).
  if (scopedToOwnUnit) return null;
  if (validated === null || validated === true) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-warning/40 bg-warning-soft text-warning">
      <div className="flex items-start gap-2 px-4 py-2 text-xs sm:text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Dados em validação:</span> as informações desta página
          ainda estão sendo conferidas e podem não estar 100% corretas.
        </p>
      </div>
    </div>
  );
}
