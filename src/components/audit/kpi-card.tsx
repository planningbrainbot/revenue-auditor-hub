import { cn } from "@/lib/utils";
import { useState } from "react";

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  help?: string;
  tone?: "default" | "indigo" | "emerald" | "red" | "orange" | "purple";
  highlight?: boolean;
}

// Tons por papel (DESIGN §3–4). Os nomes antigos ficam para não mexer nos chamadores:
// emerald = positivo, red = erro, orange = atenção, indigo = informação, purple = neutro.
const tones: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-card text-card-foreground",
  indigo: "border-info/30 bg-info-soft text-info",
  emerald: "border-success/30 bg-success-soft text-success",
  red: "border-danger/30 bg-danger-soft text-danger",
  orange: "border-warning/30 bg-warning-soft text-warning",
  purple: "bg-muted text-foreground",
};

export function KpiCard({ label, value, sub, help, tone = "default", highlight }: KpiCardProps) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border p-4 shadow-sm transition-shadow",
        tones[tone],
        highlight && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
        {help && (
          <button
            type="button"
            aria-label="O que significa?"
            title="O que significa?"
            onClick={() => setShowHelp((s) => !s)}
            className="shrink-0 rounded-full border border-current/30 px-1.5 text-xs font-bold opacity-60 hover:opacity-100"
          >
            ?
          </button>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-75">{sub}</div>}
      {showHelp && help && (
        <div className="mt-2 rounded-md border border-current/20 bg-background/70 p-2 text-xs leading-snug opacity-90">
          {help}
        </div>
      )}
    </div>
  );
}
