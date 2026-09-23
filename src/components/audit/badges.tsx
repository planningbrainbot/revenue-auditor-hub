import { cn } from "@/lib/utils";

const pagamentoMap: Record<string, string> = {
  adimplente: "bg-success-soft text-success",
  inadimplente: "bg-danger-soft text-danger",
  recente: "bg-warning-soft text-warning",
  sem_dados: "bg-muted text-foreground",
};

const matchMap: Record<string, string> = {
  matched: "bg-info-soft text-info",
  deal_sem_planning: "bg-warning-soft text-warning",
  planning_sem_deal: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
};

const tipoMap: Record<string, string> = {
  Recorrente: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "Avulso (On-Time)": "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
};

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export const PagamentoBadge = ({ value }: { value: string }) => (
  <Pill className={pagamentoMap[value] ?? "bg-muted text-foreground"}>{value}</Pill>
);
const matchLabels: Record<string, string> = {
  matched: "Vinculado",
  deal_sem_planning: "Venda sem recebimento",
  planning_sem_deal: "Recebimento sem venda",
};
export const MatchBadge = ({ value }: { value: string }) => (
  <Pill className={matchMap[value] ?? "bg-muted text-foreground"}>{matchLabels[value] ?? value.replaceAll("_", " ")}</Pill>
);
export const TipoBadge = ({ value }: { value: string | null }) => (
  <Pill className={tipoMap[value ?? ""] ?? "bg-muted text-foreground"}>{value ?? "—"}</Pill>
);
