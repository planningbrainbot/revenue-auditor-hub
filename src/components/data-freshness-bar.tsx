import { Clock } from "lucide-react";
import { type DataFreshnessInfo, useDataFreshness } from "@/hooks/use-data-freshness";
import { cn } from "@/lib/utils";

type SourceDef = {
  key: keyof DataFreshnessInfo;
  label: string;
  prefix: string;
};

const SOURCES: SourceDef[] = [
  { key: "omie",       label: "Omie",        prefix: "dados de" },
  { key: "contratos",  label: "Pipedrive",   prefix: "sync" },
  { key: "tratativas", label: "Tratativas",  prefix: "manual" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtDateFull(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceChip({ label, prefix, dateIso }: { label: string; prefix: string; dateIso: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={dateIso ? `${label}: ${fmtDateFull(dateIso)}` : `${label}: sem dados`}
    >
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className={cn("text-xs", dateIso ? "text-muted-foreground" : "text-muted-foreground/40")}>
        {dateIso ? `${prefix} ${fmtDate(dateIso)}` : "—"}
      </span>
    </span>
  );
}

export function DataFreshnessBar() {
  const { data, isLoading } = useDataFreshness();

  if (isLoading || !data) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-1">
      <Clock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
        {SOURCES.map((s) => (
          <SourceChip
            key={s.key}
            label={s.label}
            prefix={s.prefix}
            dateIso={data[s.key]}
          />
        ))}
      </div>
    </div>
  );
}
