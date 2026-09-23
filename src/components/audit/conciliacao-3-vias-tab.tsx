import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileQuestion, Link2, Loader2, Search } from "lucide-react";
import { useData } from "./data-context";
import { useContasReceber } from "@/hooks/use-contas-receber";
import { buildReconciliation, daysSince, type Bucket, type GrupoFilialLink, type ReconRow } from "./conciliacao-calc";
import { brl, date, num } from "./format";
import { unitMatches, usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as KpiCardPlanning, tomDoLegado } from "@/components/planning";


type SubTab = "vendido_sem_faturar" | "faturado_sem_crm" | "cadastro_orfao" | "matriz";

const BUCKET_LABEL: Record<Bucket, string> = {
  completo: "OK (3 vias)",
  vendido_sem_faturar: "Vendido, sem fatura",
  faturado_sem_crm: "Faturado, sem CRM",
  faturado_sem_cadastro: "Faturado, sem cadastro",
  vendido_sem_cadastro: "Vendido, sem cadastro",
  cadastro_orfao: "Cadastro órfão",
  outro: "Outro",
};

const BUCKET_TONE: Record<Bucket, string> = {
  completo: "bg-success-soft text-success",
  vendido_sem_faturar: "bg-warning-soft text-warning",
  faturado_sem_crm: "bg-info-soft text-info",
  faturado_sem_cadastro: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
  vendido_sem_cadastro: "bg-warning-soft text-warning",
  cadastro_orfao: "bg-muted text-foreground",
  outro: "bg-muted text-muted-foreground",
};

export function Conciliacao3ViasTab() {
  const { empresas, contratos, origemFilter } = useData();
  const { scopedToOwnUnit, unidade: userUnidade } = usePermissions();
  const cr = useContasReceber();

  const [sub, setSub] = useState<SubTab>("vendido_sem_faturar");
  const [q, setQ] = useState("");
  const [unidadeFilter, setUnidadeFilter] = useState("");

  const [grupos, setGrupos] = useState<GrupoFilialLink[]>([]);
  useEffect(() => {
    let alive = true;
    supabase
      .from("contrato_omie_grupos")
      .select("contrato_id,cpf_cnpj")
      .then(({ data }) => {
        if (alive && data) setGrupos(data as GrupoFilialLink[]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo<ReconRow[]>(() => {
    if (!cr.data) return [];
    return buildReconciliation(empresas, contratos, cr.data.rows, new Date(), grupos);
  }, [empresas, contratos, cr.data, grupos]);


  const scoped = useMemo(() => {
    let r = rows;
    if (scopedToOwnUnit && userUnidade) {
      r = r.filter((x) => x.unidade && unitMatches(userUnidade, x.unidade));
    }
    if (origemFilter) {
      r = r.filter((x) => {
        const o = x.origemBase ?? null;
        if (origemFilter === "sem") return !o;
        return o === origemFilter;
      });
    }
    return r;
  }, [rows, scopedToOwnUnit, userUnidade, origemFilter]);

  const unidades = useMemo(
    () => Array.from(new Set(scoped.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [scoped],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scoped.filter((r) => {
      if (unidadeFilter && r.unidade !== unidadeFilter) return false;
      if (!term) return true;
      const hay = `${r.razaoSocial ?? ""} ${r.cnpj} ${r.cnpjFmt ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [scoped, q, unidadeFilter]);

  const q1 = useMemo(
    () => filtered.filter((r) => r.bucket === "vendido_sem_faturar" || r.bucket === "vendido_sem_cadastro"),
    [filtered],
  );
  const q2 = useMemo(
    () => filtered.filter((r) => r.bucket === "faturado_sem_crm" && r.origemBase === "Base Nova"),
    [filtered],
  );
  const q3 = useMemo(() => filtered.filter((r) => r.bucket === "cadastro_orfao"), [filtered]);

  const valorEmRisco = useMemo(() => q1.reduce((s, r) => s + r.mrrContratado, 0), [q1]);

  if (cr.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando contas a receber…
      </div>
    );
  }
  if (cr.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Erro ao carregar contas a receber: {(cr.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          tone="orange"
          icon={<AlertCircle className="h-5 w-5" />}
          label="Q1 · Contratos sem recebimento"
          value={num(q1.length)}
          hint={`Vendidos no Pipedrive sem fatura RECEBIDA nos últimos 60 dias. MRR em risco: ${brl(valorEmRisco)}`}
        />
        <KpiCard
          tone="sky"
          icon={<FileQuestion className="h-5 w-5" />}
          label="Q2 · Base Nova fora do CRM"
          value={num(q2.length)}
          hint="Faturados (Omie) e cadastrados como Base Nova, mas sem deal no Pipedrive."
        />
        <KpiCard
          tone="slate"
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Q3 · Cadastros órfãos"
          value={num(q3.length)}
          hint="Empresas cadastradas que não têm contrato no Pipedrive nem fatura no Omie."
        />
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
              placeholder="Buscar por razão social ou CNPJ…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={unidadeFilter}
            onChange={(e) => setUnidadeFilter(e.target.value)}
          >
            <option value="">Todas unidades</option>
            {unidades.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {([
          ["vendido_sem_faturar", `Q1 · Vendidos não faturados (${q1.length})`],
          ["faturado_sem_crm", `Q2 · Faturados sem CRM (${q2.length})`],
          ["cadastro_orfao", `Q3 · Cadastros órfãos (${q3.length})`],
          ["matriz", `Matriz completa (${filtered.length})`],
        ] as [SubTab, string][]).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSub(k)}
            className={
              "rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors " +
              (sub === k
                ? "border-primary text-primary-text"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {l}
          </button>
        ))}
      </nav>

      {sub === "vendido_sem_faturar" && (
        <ReconTable
          rows={q1}
          emptyMsg="Nenhum contrato vendido sem recebimento — tudo conciliado."
          showMrr
          showUltimaFatura
        />
      )}
      {sub === "faturado_sem_crm" && (
        <ReconTable
          rows={q2}
          emptyMsg="Nenhum recebimento de Base Nova fora do CRM."
          showUltimaFatura
          showTotal60d
        />
      )}
      {sub === "cadastro_orfao" && (
        <ReconTable
          rows={q3}
          emptyMsg="Nenhum cadastro órfão."
          showOrigem
        />
      )}
      {sub === "matriz" && (
        <ReconTable
          rows={filtered}
          emptyMsg="Sem dados."
          showBucket
          showMrr
          showUltimaFatura
        />
      )}
    </div>
  );
}

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN
// §1.6). O ícone sai; o `tone` vira o `tom` do KpiCard (orange → atenção,
// sky → info, slate → neutro), com ícone de status junto da cor (V7).
function KpiCard({
  tone,
  label,
  value,
  hint,
}: {
  tone: "orange" | "sky" | "slate";
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return <KpiCardPlanning rotulo={label} valor={value} nota={hint} tom={tomDoLegado(tone)} />;
}

function ReconTable({
  rows,
  emptyMsg,
  showBucket,
  showMrr,
  showOrigem,
  showUltimaFatura,
  showTotal60d,
}: {
  rows: ReconRow[];
  emptyMsg: string;
  showBucket?: boolean;
  showMrr?: boolean;
  showOrigem?: boolean;
  showUltimaFatura?: boolean;
  showTotal60d?: boolean;
}) {
  const now = new Date();
  return (
    <div className="rounded-lg border bg-card">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Razão social</th>
              <th className="px-3 py-2">CNPJ</th>
              <th className="px-3 py-2">Unidade</th>
              <th className="px-3 py-2">Base</th>
              {showBucket && <th className="px-3 py-2">Situação</th>}
              {showMrr && <th className="px-3 py-2 text-right">MRR contratado</th>}
              {showUltimaFatura && <th className="px-3 py-2 text-right">Última fatura recebida</th>}
              {showTotal60d && <th className="px-3 py-2 text-right">Recebido 60d</th>}
              {!showOrigem && <th className="px-3 py-2">Sinais</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = daysSince(r.contratoMaisRecente, now);
              const isNovo = d != null && d < 30;
              return (
                <tr key={r.cnpj} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.razaoSocial ?? "—"}</div>
                    {isNovo && (
                      <span className="ml-0 inline-block rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">
                        contrato novo ({d}d)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.cnpjFmt ?? r.cnpj}</td>
                  <td className="px-3 py-2">{r.unidade ?? "—"}</td>
                  <td className="px-3 py-2">{r.origemBase ?? "—"}</td>
                  {showBucket && (
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${BUCKET_TONE[r.bucket]}`}>
                        {BUCKET_LABEL[r.bucket]}
                      </span>
                    </td>
                  )}
                  {showMrr && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">{brl(r.mrrContratado)}</td>
                  )}
                  {showUltimaFatura && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.ultimaFaturaRecebida
                        ? `${date(r.ultimaFaturaRecebida.data_pagamento)} · ${brl(r.ultimaFaturaRecebida.valor)}`
                        : r.temOmieQualquer
                          ? <span className="text-warning">sem RECEBIDO &lt; 60d</span>
                          : <span className="text-muted-foreground">sem registro</span>}
                    </td>
                  )}
                  {showTotal60d && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {brl(r.totalRecebido60d)}{" "}
                      <span className="text-xs text-muted-foreground">({r.qtdFaturasRecente})</span>
                    </td>
                  )}
                  {!showOrigem && (
                    <td className="px-3 py-2">
                      <Signals row={r} />
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {emptyMsg}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Signals({ row }: { row: ReconRow }) {
  const dot = (on: boolean, label: string, title: string) => (
    <span
      title={title}
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold " +
        (on
          ? "bg-success-soft text-success"
          : "bg-muted text-muted-foreground")
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + (on ? "bg-success" : "bg-muted-foreground/40")} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {dot(row.temEmpresa, "Cadastro", "Existe em empresas (Pipefy)")}
      {dot(row.temContrato, "CRM", "Existe em contratos (Pipedrive)")}
      {dot(row.temOmieRecente, "Omie 60d", "Tem fatura RECEBIDA nos últimos 60 dias")}
      {row.viaGrupo && (
        <span
          title="Match via filial vinculada (grupo)"
          className="inline-flex items-center gap-1 rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info"
        >
          <Link2 className="h-2.5 w-2.5" />
          via grupo
        </span>
      )}
    </div>
  );
}

