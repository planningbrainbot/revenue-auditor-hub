import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import { RedeContent } from "@/components/page-content/rede-content";
import { ApuracaoRoyaltiesContent } from "@/components/royalties/apuracao-royalties-content";
import { RoyaltiesHistoricoContent } from "@/components/royalties/royalties-historico-content";
import { ApuracaoCacContent } from "@/components/cac/apuracao-cac-content";

type Tab = "regras" | "royalties" | "historico" | "cac";

const ALL_TABS: { key: Tab; label: string; permission: string }[] = [
  { key: "regras", label: "Regras", permission: "view.unidades_rede" },
  { key: "royalties", label: "Royalties", permission: "view.unidades_rede" },
  { key: "historico", label: "Histórico", permission: "view.royalties_historico" },
  { key: "cac", label: "CAC", permission: "view.unidades_rede" },
];

export const Route = createFileRoute("/_authenticated/unidades")({
  head: () => ({
    meta: [
      { title: "Receitas Partners – Planning" },
      {
        name: "description",
        content: "Regras da rede, apuração e histórico de royalties, e CAC por unidade.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab: Tab } => {
    const t = search.tab;
    const valid: Tab[] = ["regras", "royalties", "historico", "cac"];
    return { tab: valid.includes(t as Tab) ? (t as Tab) : "regras" };
  },
  component: UnidadesRoute,
});

function UnidadesRoute() {
  useAuth();
  const { tab } = useSearch({ from: "/_authenticated/unidades" });
  const navigate = useNavigate();
  const { can, loading: permLoading } = usePermissions();

  // Cada aba tem sua própria permissão herdada das duas páginas que deram
  // origem a esta: "Histórico" veio de view.royalties_historico (ex-página
  // /royalties), as outras três exigem view.unidades_rede (página Unidades
  // original) — mantém o acesso de cada perfil idêntico ao de antes da fusão.
  const tabsVisiveis = useMemo(() => ALL_TABS.filter((t) => can(t.permission)), [can]);
  const idsVisiveis = useMemo(() => new Set(tabsVisiveis.map((t) => t.key)), [tabsVisiveis]);

  useEffect(() => {
    if (permLoading || tabsVisiveis.length === 0) return;
    if (!idsVisiveis.has(tab)) {
      navigate({ to: "/unidades", search: { tab: tabsVisiveis[0].key }, replace: true });
    }
  }, [permLoading, tabsVisiveis, idsVisiveis, tab, navigate]);

  return (
    <AppShell
      title="Receitas Partners"
      subtitle="Regras da rede, apuração e histórico de royalties, e CAC"
    >
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex flex-wrap gap-1">
            {tabsVisiveis.map((t) => (
              <Link
                key={t.key}
                to="/unidades"
                search={{ tab: t.key }}
                className={cn(
                  "rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {!permLoading && (
        <>
          {tab === "regras" && idsVisiveis.has("regras") && <RedeContent />}
          {tab === "royalties" && idsVisiveis.has("royalties") && <ApuracaoRoyaltiesContent />}
          {tab === "historico" && idsVisiveis.has("historico") && <RoyaltiesHistoricoContent />}
          {tab === "cac" && idsVisiveis.has("cac") && <ApuracaoCacContent />}
        </>
      )}
    </AppShell>
  );
}
