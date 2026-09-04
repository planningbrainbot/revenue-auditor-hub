import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import { FunilContent } from "@/components/page-content/funil-content";
import { AuditoriaFaturamentoContent } from "@/components/page-content/auditoria-faturamento-content";

export const Route = createFileRoute("/_authenticated/funil-receita")({
  head: () => ({
    meta: [{ title: "Funil de Receita – Planning" }],
  }),
  component: FunilReceitaPage,
});

type Tab = "funil" | "esperado-recebido";

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "funil", label: "Funil" },
  { key: "esperado-recebido", label: "Esperado × Recebido" },
];

function FunilReceitaPage() {
  useAuth();
  const { can } = usePermissions();
  const [tab, setTab] = useState<Tab>("funil");
  // Esperado × Recebido é auditoria de rede: sem essa permissão a aba só
  // levaria a uma tela de "sem permissão".
  const podeAuditoria = can("view.roas") || can("view.auditoria");
  const TABS = ALL_TABS.filter((t) => t.key !== "esperado-recebido" || podeAuditoria);

  return (
    <AppShell title="Funil de Receita" subtitle="MRR contratado → Faturado → Recebido">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      {tab === "funil" && <FunilContent />}
      {tab === "esperado-recebido" && podeAuditoria && <AuditoriaFaturamentoContent />}
    </AppShell>
  );
}
