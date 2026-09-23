import { useState } from "react";
import { KpiCard as KpiCardPlanning, tomDoLegado } from "@/components/planning";

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  help?: string;
  tone?: "default" | "indigo" | "emerald" | "red" | "orange" | "purple";
  highlight?: boolean;
}

/**
 * Adaptador: mantém a assinatura antiga para não mexer nos chamadores e
 * desenha com o KpiCard do design system (DESIGN §1.6, "uma decisão, um
 * lugar"). O `tone` vira o `tom` do KpiCard (valor na cor, ícone de status e
 * filete lateral): emerald → sucesso, red → perigo, orange → atenção,
 * indigo → info; default e purple ficam neutros. O fundo colorido sai: cor
 * sozinha não é status (V7), mas o sinal tem de continuar lá.
 */
export function KpiCard({ label, value, sub, help, tone, highlight }: KpiCardProps) {
  const [showHelp, setShowHelp] = useState(false);
  const nota =
    sub || help ? (
      <>
        {sub}
        {help && (
          <>
            {sub && " · "}
            <button
              type="button"
              aria-expanded={showHelp}
              onClick={() => setShowHelp((s) => !s)}
              className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              O que significa?
            </button>
            {showHelp && <span className="mt-1 block leading-snug text-foreground">{help}</span>}
          </>
        )}
      </>
    ) : undefined;
  return (
    <KpiCardPlanning
      rotulo={label}
      valor={value}
      nota={nota}
      tom={tomDoLegado(tone)}
      className={highlight ? "ring-2 ring-primary" : undefined}
    />
  );
}
