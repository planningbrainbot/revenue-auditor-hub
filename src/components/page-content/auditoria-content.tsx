import { useState } from "react";
import { DataProvider, BaseFilterSelect, RefreshButton } from "@/components/audit/data-context";
import { VendasPipedriveTab } from "@/components/audit/vendas-pipedrive-tab";
import { OmieSemPipedriveTab } from "@/components/audit/omie-sem-pipedrive-tab";
import { HistoricoMensalTab } from "@/components/audit/historico-mensal-tab";
import { OmieLastSync } from "@/components/omie-last-sync";
import { cn } from "@/lib/utils";

type Tab = "vendas" | "omie" | "historico";

const TABS: { key: Tab; label: string }[] = [
  { key: "vendas", label: "Vendas Pipedrive" },
  { key: "omie", label: "Omie sem Pipedrive" },
  { key: "historico", label: "Histórico Mensal" },
];

export function AuditoriaContent() {
  const [tab, setTab] = useState<Tab>("vendas");

  return (
    <DataProvider>
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-2 px-4">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-primary-text"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 pb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base:</span>
            <BaseFilterSelect />
            <RefreshButton />
            <OmieLastSync className="ml-2" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6">
        {tab === "vendas" && <VendasPipedriveTab />}
        {tab === "omie" && <OmieSemPipedriveTab />}
        {tab === "historico" && <HistoricoMensalTab />}
      </div>
    </DataProvider>
  );
}
