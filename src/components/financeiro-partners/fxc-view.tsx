import { useState, useMemo, useEffect, Fragment } from "react";
import { fetchFxcData, FxcData, FxcRecord, buildDre, DRE_GRUPOS } from "@/data/fxcData";

const OLIVE    = "#6b7c3a";
const OLIVE_BG = "#e8edcc";

const RECEITAS_DIRETAS_KEYS = ["csc_expansao", "royalties", "outras_rx_exp", "csc_trafego", "nao_classif", "devolucoes"];
const LUCRO_BRUTO_KEYS = [...RECEITAS_DIRETAS_KEYS, "outras_receitas", "repasses", "impostos", "folha", "desp_pessoal"];

const SECAO_HEADERS: Record<string, string> = {
  outras_receitas:  "Outras Receitas",
  custo_direto:     "Custos Diretos",
  desp_operacional: "Despesas Operacionais",
  extraordinario:   "Extraordinário / Financeiro",
  nao_classificado: "Não Classificado",
};

function fmtN(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

type SubRow = { name: string; meses: Record<string, number>; total: number };

function buildSubRows(grupo: typeof DRE_GRUPOS[number], records: FxcRecord[], unidades_map: Map<string, string>): SubRow[] {
  const map = new Map<string, Record<string, number>>();
  for (const r of records) {
    if (r.status !== "PAGO" && r.status !== "RECEBIDO") continue;
    if (!r.mes_caixa?.startsWith("2026")) continue;
    if (!grupo.match(r)) continue;
    const rs = r.razao_social || r.codigo_categoria || "—";
    const unidade = unidades_map.get(rs);
    const key = unidade ? `(${unidade}) ${rs}` : rs;
    if (!map.has(key)) map.set(key, {});
    const entry = map.get(key)!;
    const sinal = typeof grupo.sinal === "function" ? grupo.sinal(r) : grupo.sinal;
    entry[r.mes_caixa] = (entry[r.mes_caixa] ?? 0) + sinal * r.valor;
  }
  return [...map.entries()]
    .map(([name, meses]) => ({ name, meses, total: Object.values(meses).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function FxcView() {
  const [data, setData] = useState<FxcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchFxcData()
      .then(setData)
      .catch((e) => setError(e.message ?? "Erro desconhecido"))
      .finally(() => setLoading(false));
  }, []);

  const partnersRecords = useMemo(() => data ? data.records.filter((r) => r.unidade === "Partners") : [], [data]);
  const dre = useMemo(() => data ? buildDre(partnersRecords, data.saldos, "2026") : [], [partnersRecords, data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Carregando dados do Supabase…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="bg-white border border-danger/40 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-danger font-bold">Erro ao carregar dados</p>
          <p className="text-muted-foreground text-sm">{error ?? "Dados não encontrados"}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const temSaldo = dre.some((m) => m.saldo_final !== 0);
  const grandTotals: Record<string, number> = {};
  for (const g of DRE_GRUPOS) grandTotals[g.key] = dre.reduce((s, m) => s + (m.grupos[g.key] ?? 0), 0);
  const grandTotalGeral = dre.reduce((s, m) => s + m.grand_total, 0);
  const lastMes = dre[dre.length - 1];

  const receitasDiretasPorMes = dre.map((m) => ({ mes: m.mes, value: RECEITAS_DIRETAS_KEYS.reduce((s, k) => s + (m.grupos[k] ?? 0), 0) }));
  const receitasDiretasTotal  = RECEITAS_DIRETAS_KEYS.reduce((s, k) => s + (grandTotals[k] ?? 0), 0);
  const lucroBrutoPorMes      = dre.map((m) => ({ mes: m.mes, value: LUCRO_BRUTO_KEYS.reduce((s, k) => s + (m.grupos[k] ?? 0), 0) }));
  const lucroBrutoTotal       = LUCRO_BRUTO_KEYS.reduce((s, k) => s + (grandTotals[k] ?? 0), 0);
  const nCols = dre.length + 2;

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* KPIs de saldo */}
      {temSaldo && lastMes && (() => {
        const variation = lastMes.saldo_final - lastMes.saldo_inicial;
        return (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-border p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saldo em Caixa — {lastMes.label}/{lastMes.mes.slice(0,4)}</p>
              <p className="text-3xl font-black mt-1" style={{ color: lastMes.saldo_final < 5000 ? "#991b1b" : lastMes.saldo_final < 20000 ? "#b45309" : "#166534" }}>
                {fmtN(lastMes.saldo_final)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">conta corrente Partners</p>
            </div>
            <div className="bg-white rounded-2xl border border-border p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saldo Inicial — {lastMes.label}</p>
              <p className="text-3xl font-black mt-1 text-foreground">{fmtN(lastMes.saldo_inicial)}</p>
              <p className="text-xs text-muted-foreground mt-1">abertura do período</p>
            </div>
            <div className="bg-white rounded-2xl border border-border p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resultado — {lastMes.label}</p>
              <p className="text-3xl font-black mt-1" style={{ color: variation >= 0 ? "#166534" : "#991b1b" }}>
                {variation >= 0 ? "+" : ""}{fmtN(variation)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">variação de caixa no mês</p>
            </div>
          </div>
        );
      })()}

      {/* Card DRE */}
      <div className="space-y-0">

        {/* Header */}
        <div className="bg-white rounded-t-2xl border border-border px-6 py-5">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-4xl font-black text-foreground leading-none tracking-tight">FCx</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: "#5db89a" }}>Fluxo de Caixa Realizado</div>
              <div className="text-xs font-bold tracking-widest mt-0.5" style={{ color: "#5db89a" }}>CONTROLADORIA</div>
            </div>
            <div className="flex-1 rounded-lg px-5 py-3" style={{ background: OLIVE_BG }}>
              <h2 className="text-sm font-bold" style={{ color: OLIVE }}>Relatório: Fluxo de Caixa (FCx — Realizado)</h2>
              <p className="text-xs mt-0.5 opacity-80" style={{ color: OLIVE }}>Planning Partners · Omie Partners · sincronizado em {data.updated_at}</p>
            </div>
          </div>
        </div>

        {/* Saldo em destaque */}
        <div className="border-x border-border" style={{ background: OLIVE_BG }}>
          {!temSaldo ? (
            <div className="px-5 py-3">
              <p className="text-xs font-medium opacity-70" style={{ color: OLIVE }}>
                Saldo da conta corrente não sincronizado. Execute <code>sync_omie_saldo.py</code> e aplique a migration 15.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="py-2 px-5 text-left w-72" />
                    {dre.map((m) => (
                      <th key={m.mes} className="py-2 px-4 text-right text-xs font-bold uppercase whitespace-nowrap" style={{ color: OLIVE }}>{m.label}</th>
                    ))}
                    <th className="py-2 px-4 text-right text-xs font-bold uppercase" style={{ color: OLIVE }}>Grand Total</th>
                  </tr>
                </thead>
                <tbody>
                  {([ { label: "Saldo Inicial", val: (m: typeof dre[0]) => m.saldo_inicial }, { label: "Saldo Final", val: (m: typeof dre[0]) => m.saldo_final } ] as const).map(({ label, val }) => (
                    <tr key={label} className="border-t border-white/30">
                      <td className="py-2 px-5 text-xs font-bold uppercase tracking-wide" style={{ color: OLIVE }}>{label}</td>
                      {dre.map((m) => (
                        <td key={m.mes} className="py-2 px-4 text-right font-semibold whitespace-nowrap" style={{ color: OLIVE }}>{val(m) !== 0 ? fmtN(val(m)) : "—"}</td>
                      ))}
                      <td className="py-2 px-4 text-right font-bold" style={{ color: OLIVE }}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tabela DRE */}
        <div className="border border-t-0 border-border rounded-b-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="py-2 px-5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-80">Categoria</th>
                  {dre.map((m) => (
                    <th key={m.mes} className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{m.label}</th>
                  ))}
                  <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {DRE_GRUPOS.map((grupo, gi) => {
                  const isExpanded = expandedGroups.has(grupo.key);
                  const subRows = isExpanded ? buildSubRows(grupo, partnersRecords, data.unidades_map) : [];
                  const prevSecao = gi > 0 ? DRE_GRUPOS[gi - 1].secao : null;
                  const showSecaoHeader = grupo.secao !== "receita_direta" && grupo.secao !== prevSecao;
                  const isLastReceitaDireta = grupo.key === "devolucoes";
                  const isLastCustoDireto   = grupo.key === "desp_pessoal";

                  return (
                    <Fragment key={grupo.key}>
                      {showSecaoHeader && (
                        <tr className="bg-muted border-t border-border">
                          <td colSpan={nCols} className="py-1.5 px-5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                            {SECAO_HEADERS[grupo.secao] ?? grupo.secao}
                          </td>
                        </tr>
                      )}

                      <tr onClick={() => toggleGroup(grupo.key)} className="border-t border-border cursor-pointer select-none hover:bg-muted/80">
                        <td className="py-2.5 px-5 text-xs font-semibold leading-tight text-foreground">
                          <span className="mr-1.5 text-muted-foreground text-xs">{isExpanded ? "▾" : "▸"}</span>
                          {grupo.label}
                        </td>
                        {dre.map((m) => {
                          const v = m.grupos[grupo.key] ?? 0;
                          return (
                            <td key={m.mes} className={`py-2.5 px-4 text-right font-medium whitespace-nowrap ${v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground"}`}>
                              {v !== 0 ? fmtN(v) : "—"}
                            </td>
                          );
                        })}
                        <td className={`py-2.5 px-4 text-right font-bold whitespace-nowrap ${(grandTotals[grupo.key] ?? 0) > 0 ? "text-success" : (grandTotals[grupo.key] ?? 0) < 0 ? "text-danger" : "text-muted-foreground"}`}>
                          {(grandTotals[grupo.key] ?? 0) !== 0 ? fmtN(grandTotals[grupo.key] ?? 0) : "—"}
                        </td>
                      </tr>

                      {isExpanded && subRows.map((sub) => (
                        <tr key={sub.name} className="border-t border-border bg-indigo-50/40">
                          <td className="py-2 px-5 pl-10 text-xs text-muted-foreground max-w-xs truncate" title={sub.name}>{sub.name}</td>
                          {dre.map((m) => {
                            const v = sub.meses[m.mes] ?? 0;
                            return (
                              <td key={m.mes} className={`py-2 px-4 text-right text-xs whitespace-nowrap ${v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground"}`}>
                                {v !== 0 ? fmtN(v) : "—"}
                              </td>
                            );
                          })}
                          <td className={`py-2 px-4 text-right text-xs font-medium whitespace-nowrap ${sub.total > 0 ? "text-success" : sub.total < 0 ? "text-danger" : "text-muted-foreground"}`}>
                            {sub.total !== 0 ? fmtN(sub.total) : "—"}
                          </td>
                        </tr>
                      ))}

                      {isLastReceitaDireta && (
                        <tr className="border-t-2 border-info/40" style={{ background: "#eff6ff" }}>
                          <td className="py-2.5 px-5 text-xs font-black uppercase tracking-wide text-info">(=) Receitas Diretas</td>
                          {receitasDiretasPorMes.map(({ mes, value }) => (
                            <td key={mes} className={`py-2.5 px-4 text-right font-black whitespace-nowrap ${value >= 0 ? "text-info" : "text-danger"}`}>{fmtN(value)}</td>
                          ))}
                          <td className={`py-2.5 px-4 text-right font-black whitespace-nowrap ${receitasDiretasTotal >= 0 ? "text-info" : "text-danger"}`}>{fmtN(receitasDiretasTotal)}</td>
                        </tr>
                      )}

                      {isLastCustoDireto && (
                        <tr className="border-t-2 border-success/40" style={{ background: "#f0fdf4" }}>
                          <td className="py-3 px-5 text-xs font-black uppercase tracking-wide text-success">(=) LUCRO BRUTO</td>
                          {lucroBrutoPorMes.map(({ mes, value }) => (
                            <td key={mes} className={`py-3 px-4 text-right font-black whitespace-nowrap ${value >= 0 ? "text-success" : "text-danger"}`}>{fmtN(value)}</td>
                          ))}
                          <td className={`py-3 px-4 text-right font-black whitespace-nowrap ${lucroBrutoTotal >= 0 ? "text-success" : "text-danger"}`}>{fmtN(lucroBrutoTotal)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                <tr className="border-t-2 border-border font-bold" style={{ background: OLIVE_BG }}>
                  <td className="py-3 px-5 text-xs font-bold uppercase tracking-wide" style={{ color: OLIVE }}>Grand Total</td>
                  {dre.map((m) => (
                    <td key={m.mes} className="py-3 px-4 text-right whitespace-nowrap font-bold" style={{ color: m.grand_total >= 0 ? "#166534" : "#991b1b" }}>
                      {fmtN(m.grand_total)}
                    </td>
                  ))}
                  <td className="py-3 px-4 text-right whitespace-nowrap font-bold" style={{ color: grandTotalGeral >= 0 ? "#166534" : "#991b1b" }}>
                    {fmtN(grandTotalGeral)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        * Não considera Permuta ou Perda. Clique em qualquer linha para expandir os lançamentos individuais.
      </p>
    </div>
  );
}
