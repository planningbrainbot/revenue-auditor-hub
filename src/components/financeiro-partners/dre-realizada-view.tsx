import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Mesma paleta "oliva" da aba FCx — intencional, replica a identidade visual
// do relatório original da contadora (planilha Financeiro Partners).
const OLIVE = "#6b7c3a";
const OLIVE_BG = "#e8edcc";

interface DreRow {
  bloco: string;
  linha: string;
  mes: string; // "YYYY-MM-01"
  valor: number;
  qtd_lancamentos: number;
  arquivo_referencia: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Ordem de exibição dos blocos, igual ao "Painel 1" da planilha original.
// Qualquer bloco novo que não esteja nesta lista aparece no final, em ordem alfabética.
const BLOCO_ORDEM = [
  "(=) LUCRO BRUTO OU MARGEM DE CONTRIBUIÇÃO",
  "(-) DESPESAS COMERCIAIS E MARKETING",
  "(-) DESPESAS ADMINISTRATIVAS",
  "(-) DESPESAS PESQUISA E DESENVOLVIMENTO (P&D)",
  "(+/-) OUTRAS RECEITAS/DESPESAS NÃO OPERACIONAIS",
  "(+/-) RECEITAS/DESPESAS EXTRAORDINARIA",
].map(norm);

function blocoRank(bloco: string): number {
  const i = BLOCO_ORDEM.indexOf(norm(bloco));
  return i === -1 ? 999 : i;
}

// "1.10. (-) ..." deve vir depois de "1.5. (-) ...", não antes — ordenação
// numérica pelo prefixo, não alfabética.
function linhaRank(linha: string): [number, number] {
  const m = linha.match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [999, 999];
}

function fmtN(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function mesLabel(ym: string): string {
  const [, m] = ym.split("-");
  const MESES: Record<string, string> = {
    "01": "jan", "02": "fev", "03": "mar", "04": "abr", "05": "mai", "06": "jun",
    "07": "jul", "08": "ago", "09": "set", "10": "out", "11": "nov", "12": "dez",
  };
  return MESES[m] ?? m;
}

export function DreRealizadaView() {
  const [rows, setRows] = useState<DreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: DreRow[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("partners_dre_realizada_mensal")
          .select("bloco,linha,mes,valor,qtd_lancamentos,arquivo_referencia")
          .order("mes", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) { if (!cancelled) setError(error.message); return; }
        all.push(...((data ?? []) as DreRow[]));
        if ((data?.length ?? 0) < PAGE) break;
        offset += PAGE;
      }
      if (!cancelled) setRows(all);
    })();
    return () => { cancelled = true; };
  }, []);

  const { meses, blocos, arquivoReferencia } = useMemo(() => {
    if (!rows) return { meses: [] as string[], blocos: [] as { bloco: string; linhas: { linha: string; porMes: Record<string, number>; total: number }[]; porMes: Record<string, number>; total: number }[], arquivoReferencia: null as string | null };

    const mesesSet = new Set<string>();
    for (const r of rows) mesesSet.add(r.mes);
    const meses = [...mesesSet].sort();

    const blocoMap = new Map<string, Map<string, Record<string, number>>>();
    for (const r of rows) {
      if (!blocoMap.has(r.bloco)) blocoMap.set(r.bloco, new Map());
      const linhaMap = blocoMap.get(r.bloco)!;
      if (!linhaMap.has(r.linha)) linhaMap.set(r.linha, {});
      linhaMap.get(r.linha)![r.mes] = (linhaMap.get(r.linha)![r.mes] ?? 0) + r.valor;
    }

    const blocos = [...blocoMap.entries()]
      .map(([bloco, linhaMap]) => {
        const linhas = [...linhaMap.entries()]
          .map(([linha, porMes]) => ({
            linha, porMes,
            total: Object.values(porMes).reduce((s, v) => s + v, 0),
          }))
          .sort((a, b) => {
            const [am, an] = linhaRank(a.linha), [bm, bn] = linhaRank(b.linha);
            return am !== bm ? am - bm : an !== bn ? an - bn : a.linha.localeCompare(b.linha);
          });
        const porMes: Record<string, number> = {};
        for (const l of linhas) for (const [mes, v] of Object.entries(l.porMes)) porMes[mes] = (porMes[mes] ?? 0) + v;
        const total = linhas.reduce((s, l) => s + l.total, 0);
        return { bloco, linhas, porMes, total };
      })
      .sort((a, b) => {
        const ra = blocoRank(a.bloco), rb = blocoRank(b.bloco);
        return ra !== rb ? ra - rb : a.bloco.localeCompare(b.bloco);
      });

    const arquivoReferencia = rows[0]?.arquivo_referencia ?? null;
    return { meses, blocos, arquivoReferencia };
  }, [rows]);

  const grandTotalPorMes = useMemo(() => {
    const out: Record<string, number> = {};
    for (const mes of meses) out[mes] = blocos.reduce((s, b) => s + (b.porMes[mes] ?? 0), 0);
    return out;
  }, [blocos, meses]);
  const grandTotalGeral = useMemo(() => blocos.reduce((s, b) => s + b.total, 0), [blocos]);

  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  function toggle(bloco: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(bloco)) next.delete(bloco); else next.add(bloco);
      return next;
    });
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="bg-white border border-red-200 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-red-600 font-bold">Erro ao carregar dados</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Carregando dados do Supabase…</p>
        </div>
      </div>
    );
  }

  const nCols = meses.length + 2;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        DRE Realizada <strong className="text-foreground">oficial</strong> — usa a categorização De-Para feita pela
        contadora na planilha "Financeiro Partners" (não a aproximação por prefixo de categoria do Omie usada na aba{" "}
        <strong className="text-foreground">FCx</strong>). Os números foram conferidos linha a linha contra o Excel original.{" "}
        <strong className="text-foreground">Não é ao vivo</strong> — atualiza só quando alguém roda{" "}
        <code className="rounded bg-background px-1 py-0.5">tools/sync_partners_financeiro.py</code> com a planilha do mês.
        {arquivoReferencia && <> Fonte atual: planilha <strong className="text-foreground">{arquivoReferencia}</strong>.</>}
      </div>

      <div className="space-y-0">
        <div className="bg-white rounded-t-2xl border border-slate-200 px-6 py-5">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-4xl font-black text-slate-900 leading-none tracking-tight">DRE</div>
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: OLIVE }}>DRE Realizada (Regime de Caixa)</div>
              <div className="text-[9px] font-bold tracking-widest mt-0.5" style={{ color: OLIVE }}>CONTROLADORIA</div>
            </div>
            <div className="flex-1 rounded-lg px-5 py-3" style={{ background: OLIVE_BG }}>
              <h2 className="text-sm font-bold" style={{ color: OLIVE }}>Relatório: Fluxo de COM.Caixa (FCx Realizado)</h2>
              <p className="text-xs mt-0.5 opacity-80" style={{ color: OLIVE }}>
                Planning Partners · categorização oficial da contadora
              </p>
            </div>
          </div>
        </div>

        <div className="border border-t-0 border-slate-200 rounded-b-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-80">Categoria</th>
                  {meses.map((mes) => (
                    <th key={mes} className="py-2 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {mesLabel(mes)}
                    </th>
                  ))}
                  <th className="py-2 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Total Geral</th>
                </tr>
              </thead>
              <tbody>
                {blocos.map((b) => {
                  const isExpanded = expandidos.has(b.bloco);
                  return (
                    <Fragment key={b.bloco}>
                      <tr onClick={() => toggle(b.bloco)} className="border-t border-slate-100 cursor-pointer select-none hover:bg-slate-50/80">
                        <td className="py-2.5 px-5 text-xs font-semibold leading-tight text-slate-700">
                          <span className="mr-1.5 text-slate-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                          {b.bloco}
                        </td>
                        {meses.map((mes) => {
                          const v = b.porMes[mes] ?? 0;
                          return (
                            <td key={mes} className={`py-2.5 px-4 text-right font-medium whitespace-nowrap ${v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-slate-300"}`}>
                              {v !== 0 ? fmtN(v) : "—"}
                            </td>
                          );
                        })}
                        <td className={`py-2.5 px-4 text-right font-bold whitespace-nowrap ${b.total > 0 ? "text-emerald-700" : b.total < 0 ? "text-red-600" : "text-slate-300"}`}>
                          {b.total !== 0 ? fmtN(b.total) : "—"}
                        </td>
                      </tr>

                      {isExpanded && b.linhas.map((l) => (
                        <tr key={b.bloco + "|" + l.linha} className="border-t border-slate-100 bg-indigo-50/40">
                          <td className="py-2 px-5 pl-10 text-xs text-slate-600 max-w-xs truncate" title={l.linha}>{l.linha}</td>
                          {meses.map((mes) => {
                            const v = l.porMes[mes] ?? 0;
                            return (
                              <td key={mes} className={`py-2 px-4 text-right text-xs whitespace-nowrap ${v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-slate-300"}`}>
                                {v !== 0 ? fmtN(v) : "—"}
                              </td>
                            );
                          })}
                          <td className={`py-2 px-4 text-right text-xs font-medium whitespace-nowrap ${l.total > 0 ? "text-emerald-700" : l.total < 0 ? "text-red-600" : "text-slate-300"}`}>
                            {l.total !== 0 ? fmtN(l.total) : "—"}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}

                <tr className="border-t-2 border-slate-300 font-bold" style={{ background: OLIVE_BG }}>
                  <td className="py-3 px-5 text-xs font-bold uppercase tracking-wide" style={{ color: OLIVE }}>Total Geral</td>
                  {meses.map((mes) => (
                    <td key={mes} className="py-3 px-4 text-right whitespace-nowrap font-bold" style={{ color: (grandTotalPorMes[mes] ?? 0) >= 0 ? "#166534" : "#991b1b" }}>
                      {fmtN(grandTotalPorMes[mes] ?? 0)}
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

      {blocos.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum dado carregado ainda. Rode <code>tools/sync_partners_financeiro.py</code> no repo AI Projects.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Clique em qualquer linha pra expandir a categorização detalhada (Estrutura DRE).{" "}
        {nCols > 2 && `${meses.length} meses carregados.`}
      </p>
    </div>
  );
}
