import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { digits } from "@/lib/server-utils";
import { useRoyaltiesHistoricoRede } from "@/hooks/use-royalties";
import { useNps } from "@/hooks/use-nps";
import { useSaudeCarteira } from "@/hooks/use-saude-carteira";
import { normalizeUnitName, unitMatches, usePermissions } from "@/hooks/use-permissions";

// Todo card do Overview segue o mesmo padrão: número-resumo aqui, "ver
// detalhe" leva pra página dona daquele dado. O Overview nunca duplica a
// tela de detalhe — só orienta pra onde ir.
function VerDetalheLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      Ver detalhe <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

export const Route = createFileRoute("/_authenticated/rede-overview")({
  component: RedeOverviewPage,
});

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  faturado: number | null;
  recebido: number | null;
  num_contratos: number | null;
};

type EmpresaRow = {
  id: number;
  pipedrive_id: string | null;
  unidade: string | null;
  cnpj: string | null;
};

// Cards de tratativa em estágio "Perdido" = churn confirmado (mesma fonte que
// royalties/CAC usam para excluir cliente da apuração — ver DATA-RULES.md).
// empresa_id + data_churn entraram pra dar o corte de LTV Finalizado (soma de
// pagamento até a data de churn) — ver `ltvStats` abaixo.
type ChurnCardRow = {
  pipedrive_deal_id: number | null;
  unidade: string | null;
  mrr: number | null;
  empresa_id: number | null;
  data_churn: string | null;
};

// MRR novo = deals ganhos no mês (contratos.ganho_em), não confundir com
// mrr_contratado de v_reconciliacao_mensal (esse é o MRR ativo atual, repetido
// em todos os meses — não serve pra série histórica de "novo por mês").
// origem_pipeline distingue Matriz (pipeline 2, Inside Sales) de Hunter
// (pipeline 4, "Negociação - Sócios") — ver DATA-RULES.md seção 6 e
// outputs/2026-08-spec-painel-desempenho-unidade.md no wiki.
type ContratoNovoRow = {
  unidade: string | null;
  mrr_mensal: number | null;
  ganho_em: string | null;
  origem_pipeline: string | null;
  cnpj: string | null; // usado só pra série temporal de Clientes Ativos (cruza com cnpjChurnMes)
};

// Pipe Pipefy "Auditoria Interna" (307181077) — audita empresas-cliente por
// exposição fiscal (ICMS/PIS-COFINS/Reforma Tributária), não a unidade em si.
// oportunidades_valor/contingencias_valor já vêm somados pelo sync a partir de
// texto livre no Pipefy (ver auditoria-interna.functions.ts). Detalhe completo
// em /auditoria-interna — aqui só o resumo por unidade.
type AuditoriaRow = {
  unidade: string | null;
  oportunidades_valor: number | null;
  contingencias_valor: number | null;
};

const ALL = "__all__";

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtPct = (v: number | null | undefined, decimals = 1) =>
  v == null ? "—" : `${v.toFixed(decimals)}%`;

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${mo}/${y?.slice(2)}`;
};

// Soma os últimos `months` valores da série, pulando `offsetFromEnd` a partir
// do fim — usado pra comparar janela móvel de 12 meses vs. os 12 anteriores.
const sumTrailing = (arr: number[], months: number, offsetFromEnd: number) => {
  const end = arr.length - offsetFromEnd;
  const start = Math.max(0, end - months);
  return arr.slice(start, end).reduce((s, v) => s + v, 0);
};

const pctVsPrev = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function RedeOverviewPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReconcRow[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [churnCards, setChurnCards] = useState<ChurnCardRow[]>([]);
  const [contratosNovos, setContratosNovos] = useState<ContratoNovoRow[]>([]);
  const [auditorias, setAuditorias] = useState<AuditoriaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unidadeFilter, setUnidadeFilter] = useState(ALL);

  const perms = usePermissions();

  const { data: royaltiesData, error: royaltiesError } = useRoyaltiesHistoricoRede();
  const { data: npsData } = useNps();
  const { data: saudeData } = useSaudeCarteira();

  // Sócio (data.scope.own_unit_only) vê só a própria unidade nesta página —
  // decisão de 11/08/2026 (reverte a permissividade anterior de "ranking sem
  // restrição"; ver DECISIONS.md). Trava o filtro assim que perms carregar,
  // em vez de deixar ALL selecionável e confiar só no Badge da UI.
  useEffect(() => {
    if (perms.scopedToOwnUnit && perms.unidade) setUnidadeFilter(perms.unidade);
  }, [perms.scopedToOwnUnit, perms.unidade]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [reconRes, empRes, tratRes, contRes, audRes] = await Promise.all([
        supabase
          .from("v_reconciliacao_mensal")
          .select("mes,unidade,mrr_contratado,faturado,recebido,num_contratos")
          .order("mes", { ascending: true }),
        supabase
          .from("empresas")
          .select("id,pipedrive_id,unidade,cnpj")
          .eq("tipo_unidade", "franquia")
          .limit(2000),
        supabase
          .from("central_tratativas")
          .select("pipedrive_deal_id,unidade,mrr,empresa_id,data_churn")
          .eq("estagio", "Perdido")
          .eq("status", "lost")
          .limit(2000),
        supabase
          .from("contratos")
          .select("unidade,mrr_mensal,ganho_em,origem_pipeline,cnpj")
          .not("ganho_em", "is", null)
          .limit(5000),
        supabase
          .from("auditorias_internas")
          .select("unidade,oportunidades_valor,contingencias_valor")
          .limit(5000),
      ]);
      if (!mounted) return;
      // Cada resposta pode falhar (RLS, rede, etc.) sem lançar exceção — se
      // sumir silenciosamente aqui, os cards viram "R$ 0"/"—" sem explicação
      // nenhuma, o que é pior do que mostrar o erro real.
      const errors = [
        reconRes.error && `Resumo por unidade: ${reconRes.error.message}`,
        empRes.error && `Clientes: ${empRes.error.message}`,
        tratRes.error && `Churn: ${tratRes.error.message}`,
        contRes.error && `Vendas: ${contRes.error.message}`,
        audRes.error && `Auditoria: ${audRes.error.message}`,
      ].filter(Boolean) as string[];
      setLoadError(errors.length > 0 ? errors.join(" · ") : null);
      setRows((reconRes.data ?? []) as ReconcRow[]);
      setEmpresas((empRes.data ?? []) as EmpresaRow[]);
      setChurnCards((tratRes.data ?? []) as ChurnCardRow[]);
      setContratosNovos((contRes.data ?? []) as ContratoNovoRow[]);
      setAuditorias((audRes.data ?? []) as AuditoriaRow[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Gate de escopo por unidade (sócio só vê a própria unidade). Usa
  // unitMatches em vez de igualdade estrita porque `perms.unidade` já provou
  // não bater caractere-a-caractere com `empresas.unidade` em /clientes (por
  // isso `unitMatches` existe) — o mesmo risco vale aqui pras outras tabelas.
  // Normaliza `unidade` pro valor de `perms.unidade` nas linhas que passam,
  // pra todo o resto do arquivo (que já compara por igualdade estrita contra
  // `unidadeFilter`) continuar funcionando sem precisar reescrever cada memo.
  function scopeRows<T extends { unidade: string | null }>(arr: T[]): T[] {
    if (!perms.scopedToOwnUnit || !perms.unidade) return arr;
    return arr
      .filter((r) => unitMatches(perms.unidade, r.unidade))
      .map((r) => ({ ...r, unidade: perms.unidade as string }));
  }

  const scopedRows = useMemo(() => scopeRows(rows), [rows, perms.scopedToOwnUnit, perms.unidade]);
  const scopedEmpresas = useMemo(
    () => scopeRows(empresas),
    [empresas, perms.scopedToOwnUnit, perms.unidade],
  );
  const scopedChurnCards = useMemo(
    () => scopeRows(churnCards),
    [churnCards, perms.scopedToOwnUnit, perms.unidade],
  );
  const scopedContratosNovos = useMemo(
    () => scopeRows(contratosNovos),
    [contratosNovos, perms.scopedToOwnUnit, perms.unidade],
  );
  const scopedAuditorias = useMemo(
    () => scopeRows(auditorias),
    [auditorias, perms.scopedToOwnUnit, perms.unidade],
  );

  const unidades = useMemo(
    () =>
      Array.from(new Set(scopedRows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [scopedRows],
  );

  const filtered = useMemo(
    () => scopedRows.filter((r) => unidadeFilter === ALL || r.unidade === unidadeFilter),
    [scopedRows, unidadeFilter],
  );

  const byMes = useMemo(() => {
    const map = new Map<
      string,
      { mrr: number; faturado: number; recebido: number; contratos: number }
    >();
    for (const r of filtered) {
      const m = r.mes ?? "";
      if (!m) continue;
      const cur = map.get(m) ?? { mrr: 0, faturado: 0, recebido: 0, contratos: 0 };
      cur.mrr += r.mrr_contratado ?? 0;
      cur.faturado += r.faturado ?? 0;
      cur.recebido += r.recebido ?? 0;
      cur.contratos += r.num_contratos ?? 0;
      map.set(m, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ mes, label: fmtMes(mes), ...v }));
  }, [filtered]);

  const ultimo = byMes[byMes.length - 1];
  const penultimo = byMes[byMes.length - 2];

  const kpis = useMemo(() => {
    if (!ultimo) return { receita: 0, mrr: 0, clientes: 0, nrr: null as number | null };
    const receita = ultimo.recebido;
    const mrr = ultimo.mrr;
    const clientes = ultimo.contratos;
    const nrr = penultimo && penultimo.mrr > 0 ? (mrr / penultimo.mrr) * 100 : null;
    return { receita, mrr, clientes, nrr };
  }, [ultimo, penultimo]);

  const byUnidade = useMemo(() => {
    const map = new Map<string, { mrr: number; recebido: number; contratos: number }>();
    for (const r of filtered) {
      const u = r.unidade ?? "—";
      const cur = map.get(u) ?? { mrr: 0, recebido: 0, contratos: 0 };
      cur.mrr = Math.max(cur.mrr, r.mrr_contratado ?? 0);
      cur.recebido += r.recebido ?? 0;
      cur.contratos = Math.max(cur.contratos, r.num_contratos ?? 0);
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => ({ unidade, ...v }))
      .sort((a, b) => b.mrr - a.mrr);
  }, [filtered]);

  // ---- Clientes ativos / churn (cards de tratativa em estágio Perdido) ----
  const empresasFiltradas = useMemo(
    () => scopedEmpresas.filter((e) => unidadeFilter === ALL || e.unidade === unidadeFilter),
    [scopedEmpresas, unidadeFilter],
  );
  const churnFiltrado = useMemo(
    () => scopedChurnCards.filter((c) => unidadeFilter === ALL || c.unidade === unidadeFilter),
    [scopedChurnCards, unidadeFilter],
  );
  const totalClientes = empresasFiltradas.length;
  const churnedIds = useMemo(
    () => new Set(churnFiltrado.map((c) => String(c.pipedrive_deal_id)).filter(Boolean)),
    [churnFiltrado],
  );
  const clientesAtivos = useMemo(
    () =>
      empresasFiltradas.filter((e) => !e.pipedrive_id || !churnedIds.has(String(e.pipedrive_id)))
        .length,
    [empresasFiltradas, churnedIds],
  );
  const churnStats = useMemo(() => {
    const churnedCount = Math.max(0, totalClientes - clientesAtivos);
    const churnedMrr = churnFiltrado.reduce((s, c) => s + Number(c.mrr ?? 0), 0);
    const churnLogoPct = totalClientes > 0 ? (churnedCount / totalClientes) * 100 : null;
    const baseReceita = kpis.mrr + churnedMrr;
    const churnReceitaPct = baseReceita > 0 ? (churnedMrr / baseReceita) * 100 : null;
    return { churnedCount, churnedMrr, churnLogoPct, churnReceitaPct };
  }, [totalClientes, clientesAtivos, churnFiltrado, kpis.mrr]);

  // ---- NPS da rede (resumo — detalhe fica em /painel-cs) ----
  // Mesma fórmula de painel-cs/nps-tab.tsx: (promotores − detratores) / respondidas × 100.
  const npsStats = useMemo(() => {
    const rows = (npsData?.rows ?? []).filter(
      (r) => unidadeFilter === ALL || r.unidade === unidadeFilter,
    );
    let promotores = 0;
    let detratores = 0;
    let respondidas = 0;
    for (const r of rows) {
      const n = Number(r.nps_recomendacao);
      if (r.nps_recomendacao == null || r.nps_recomendacao === "" || Number.isNaN(n)) continue;
      respondidas++;
      if (n >= 9) promotores++;
      else if (n < 7) detratores++;
    }
    const nps =
      respondidas > 0 ? Math.round(((promotores - detratores) / respondidas) * 100) : null;
    return { nps, respondidas };
  }, [npsData, unidadeFilter]);

  // ---- Saúde da carteira (resumo — detalhe fica em /painel-cs) ----
  const saudeStats = useMemo(() => {
    const rows = (saudeData?.rows ?? []).filter(
      (r) =>
        (unidadeFilter === ALL || r.unidade === unidadeFilter) &&
        !r.churn &&
        r.semaforo != null &&
        r.semaforo !== "sem_medicao",
    );
    const saudavel = rows.filter((r) => r.semaforo === "saudavel").length;
    const risco = rows.filter((r) => r.semaforo === "risco").length;
    const pctSaudavel = rows.length > 0 ? (saudavel / rows.length) * 100 : null;
    return { pctSaudavel, risco, total: rows.length };
  }, [saudeData, unidadeFilter]);

  // ---- Auditoria Interna: oportunidades/contingências fiscais por unidade ----
  // Pipe Pipefy "Auditoria Interna" (307181077) → tabela auditorias_internas,
  // já com página própria em /auditoria-interna. Aqui só o resumo por unidade
  // pro ranking, seguindo o padrão "resumo + link Ver detalhe". Chave
  // normalizada (normalizeUnitName) porque o campo vem de um pipe diferente
  // do de vendas — nome da unidade pode não bater caractere-a-caractere.
  const auditoriaPorUnidadeNorm = useMemo(() => {
    const map = new Map<string, { oportunidade: number; contingencia: number }>();
    for (const a of scopedAuditorias) {
      const key = normalizeUnitName(a.unidade);
      if (!key) continue;
      const cur = map.get(key) ?? { oportunidade: 0, contingencia: 0 };
      cur.oportunidade += Number(a.oportunidades_valor ?? 0);
      cur.contingencia += Number(a.contingencias_valor ?? 0);
      map.set(key, cur);
    }
    return map;
  }, [scopedAuditorias]);

  const auditoriaPorUnidade = (unidade: string) =>
    auditoriaPorUnidadeNorm.get(normalizeUnitName(unidade)) ?? { oportunidade: 0, contingencia: 0 };

  const auditoriaStats = useMemo(() => {
    const rows =
      unidadeFilter === ALL
        ? scopedAuditorias
        : scopedAuditorias.filter((a) => unitMatches(unidadeFilter, a.unidade));
    return rows.reduce(
      (acc, a) => ({
        oportunidade: acc.oportunidade + Number(a.oportunidades_valor ?? 0),
        contingencia: acc.contingencia + Number(a.contingencias_valor ?? 0),
      }),
      { oportunidade: 0, contingencia: 0 },
    );
  }, [scopedAuditorias, unidadeFilter]);

  // ---- Vendas no mês por unidade, separadas em Matriz vs. Hunter ----
  // Matriz = origem_pipeline='inside_sales' (pipeline 2, lead roteado pela
  // Matriz por "Unidade de Negócio"). Hunter = origem_pipeline='socios'
  // (pipeline 4, "Negociação - Sócios", venda fechada direto pela unidade) —
  // equivalência confirmada com o usuário em 11/08/2026, ver
  // outputs/2026-08-spec-painel-desempenho-unidade.md.
  //
  // Cards do pipe Sócios sem "Unidade de Negócio" preenchida (52/93 no
  // levantamento de 11/08/2026 — gap de preenchimento no Pipedrive, não bug
  // de sync) são ignorados no ranking por unidade, por decisão explícita do
  // usuário (não aparecem numa linha "sem unidade" nem são rateados) — só
  // ficam contabilizados em `vendasSemUnidade` como nota de rodapé.
  const mesAtual = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const vendasMatrizPorUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if ((c.ganho_em ?? "").slice(0, 7) !== mesAtual || !c.unidade) continue;
      if (c.origem_pipeline === "socios") continue;
      map.set(c.unidade, (map.get(c.unidade) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    return map;
  }, [scopedContratosNovos, mesAtual]);

  const vendasHunterPorUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if ((c.ganho_em ?? "").slice(0, 7) !== mesAtual || !c.unidade) continue;
      if (c.origem_pipeline !== "socios") continue;
      map.set(c.unidade, (map.get(c.unidade) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    return map;
  }, [scopedContratosNovos, mesAtual]);

  // % do mix que é Hunter — mix mais Hunter é lido como positivo (unidade
  // autossuficiente, menos dependente do funil da Matriz), não como alerta.
  const mixHunterPct = (unidade: string) => {
    const matriz = vendasMatrizPorUnidade.get(unidade) ?? 0;
    const hunter = vendasHunterPorUnidade.get(unidade) ?? 0;
    const total = matriz + hunter;
    return total > 0 ? (hunter / total) * 100 : null;
  };

  const vendasSemUnidade = useMemo(() => {
    let count = 0;
    let mrr = 0;
    for (const c of scopedContratosNovos) {
      if ((c.ganho_em ?? "").slice(0, 7) !== mesAtual || c.unidade) continue;
      count++;
      mrr += Number(c.mrr_mensal ?? 0);
    }
    return { count, mrr };
  }, [scopedContratosNovos, mesAtual]);

  // ---- MRR novo por mês (contratos.ganho_em) vs Royalties recebido por mês ----
  const newMrrByMes = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = (c.ganho_em ?? "").slice(0, 7);
      if (!mes) continue;
      map.set(mes, (map.get(mes) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    return map;
  }, [scopedContratosNovos, unidadeFilter]);

  const royaltiesByMes = useMemo(() => {
    const map = new Map<string, number>();
    if (!royaltiesData) return map;
    const unidadeId =
      unidadeFilter === ALL
        ? null
        : (royaltiesData.unidades.find((u) => u.nome === unidadeFilter)?.id ?? null);
    for (const p of royaltiesData.evolucao) {
      if (unidadeId != null && p.unidade_id !== unidadeId) continue;
      const mes = p.mes_referencia.slice(0, 7);
      map.set(mes, (map.get(mes) ?? 0) + p.royalties_apurado);
    }
    return map;
  }, [royaltiesData, unidadeFilter]);

  const mrrNovoRoyaltiesChart = useMemo(() => {
    const meses = new Set<string>([...newMrrByMes.keys(), ...royaltiesByMes.keys()]);
    return Array.from(meses)
      .sort()
      .map((mes) => ({
        label: fmtMes(mes),
        mrrNovo: newMrrByMes.get(mes) ?? 0,
        royaltiesRecebido: royaltiesByMes.get(mes) ?? 0,
      }));
  }, [newMrrByMes, royaltiesByMes]);

  // ---- Receita Total e Booking Total (últimos 12 meses vs. 12 meses anteriores) ----
  // "Vs LM" nos outros cards compara mês contra mês anterior; aqui o pedido era
  // um total de período, então usamos janela móvel de 12 meses (o mesmo padrão
  // do mockup de referência) em vez de acumulado desde sempre, que cresceria
  // indefinidamente e não seria comparável mês a mês.
  const receitaTotalStats = useMemo(() => {
    const serie = byMes.map((m) => m.recebido);
    const atual = sumTrailing(serie, 12, 0);
    const anterior = sumTrailing(serie, 12, 12);
    return { total: atual, pct: pctVsPrev(atual, anterior) };
  }, [byMes]);

  const bookingByMesArr = useMemo(() => {
    // Booking = MRR novo do mês × 12 (contrato assumido em 12 meses — definição
    // confirmada com o usuário em 11/08/2026, ver
    // outputs/2026-08-spec-painel-gestao-unidades-indicadores.md).
    const meses = Array.from(newMrrByMes.keys()).sort();
    return meses.map((mes) => ({
      mes,
      label: fmtMes(mes),
      booking: (newMrrByMes.get(mes) ?? 0) * 12,
    }));
  }, [newMrrByMes]);

  const bookingTotalStats = useMemo(() => {
    const serie = bookingByMesArr.map((m) => m.booking);
    const atual = sumTrailing(serie, 12, 0);
    const anterior = sumTrailing(serie, 12, 12);
    return { total: atual, pct: pctVsPrev(atual, anterior) };
  }, [bookingByMesArr]);

  const bookingVariacaoChart = useMemo(
    () =>
      bookingByMesArr.map((m, i) => {
        const prev = i > 0 ? bookingByMesArr[i - 1].booking : null;
        const variacao = prev != null ? pctVsPrev(m.booking, prev) : null;
        return { label: m.label, variacao };
      }),
    [bookingByMesArr],
  );

  // ---- Lifetime (LTV): soma de royalties_itens.valor_confirmado por cliente ----
  // Decisão do usuário (11/08/2026): LTV usa o valor já apurado/confirmado na
  // tela de royalties, não `contas_receber` bruto — é o mesmo valor que já
  // passou pelo fluxo de revisão manual da unidade.
  //   LTV Finalizado = soma paga pelo cliente até a data de churn (central_tratativas.data_churn)
  //   LTV Ativo       = soma paga pelo cliente até o mês atual, cliente sem churn
  //   LTV Geral        = média simples entre os dois médios acima (não pool ponderado)
  const empresaCnpjById = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of scopedEmpresas) {
      const d = digits(e.cnpj);
      if (d) map.set(e.id, d);
    }
    return map;
  }, [scopedEmpresas]);

  const cnpjChurnMes = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of scopedChurnCards) {
      if (!c.empresa_id || !c.data_churn) continue;
      const cnpjD = empresaCnpjById.get(c.empresa_id);
      if (!cnpjD) continue;
      const mes = c.data_churn.slice(0, 7);
      const atual = map.get(cnpjD);
      if (!atual || mes < atual) map.set(cnpjD, mes); // primeira data de churn conhecida
    }
    return map;
  }, [scopedChurnCards, empresaCnpjById]);

  const ltvStats = useMemo(() => {
    if (!royaltiesData) return { ativo: null, finalizado: null, geral: null, nAtivo: 0, nFinalizado: 0 };
    let somaAtivo = 0;
    let nAtivo = 0;
    let somaFinalizado = 0;
    let nFinalizado = 0;
    for (const c of royaltiesData.clientes) {
      if (unidadeFilter !== ALL && c.unidade_nome !== unidadeFilter) continue;
      const cnpjD = digits(c.cnpj);
      const churnMes = cnpjD ? cnpjChurnMes.get(cnpjD) : undefined;
      let total = 0;
      for (const [mes, item] of Object.entries(c.meses)) {
        if (item.categoria !== "royalties" || item.is_cac || item.excluido_em) continue;
        if (churnMes && mes.slice(0, 7) > churnMes) continue; // ignora pagamento pós-churn (ajuste/erro)
        total += item.valor_confirmado;
      }
      if (total <= 0) continue; // never_paid não entra na média de LTV
      if (churnMes) {
        somaFinalizado += total;
        nFinalizado++;
      } else {
        somaAtivo += total;
        nAtivo++;
      }
    }
    const ativo = nAtivo > 0 ? somaAtivo / nAtivo : null;
    const finalizado = nFinalizado > 0 ? somaFinalizado / nFinalizado : null;
    const geral = ativo != null || finalizado != null ? ((ativo ?? finalizado)! + (finalizado ?? ativo)!) / 2 : null;
    return { ativo, finalizado, geral, nAtivo, nFinalizado };
  }, [royaltiesData, unidadeFilter, cnpjChurnMes]);

  // ---- Crescimento Mensal: clientes iniciaram (won) vs. churn logo (contagem) ----
  const crescimentoMensalChart = useMemo(() => {
    const iniciaramPorMes = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = (c.ganho_em ?? "").slice(0, 7);
      if (!mes) continue;
      iniciaramPorMes.set(mes, (iniciaramPorMes.get(mes) ?? 0) + 1);
    }
    const churnPorMes = new Map<string, number>();
    for (const c of scopedChurnCards) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = (c.data_churn ?? "").slice(0, 7);
      if (!mes) continue;
      churnPorMes.set(mes, (churnPorMes.get(mes) ?? 0) + 1);
    }
    const meses = new Set<string>([...iniciaramPorMes.keys(), ...churnPorMes.keys()]);
    return Array.from(meses)
      .sort()
      .map((mes) => ({
        label: fmtMes(mes),
        iniciaram: iniciaramPorMes.get(mes) ?? 0,
        churnLogo: churnPorMes.get(mes) ?? 0,
      }));
  }, [scopedContratosNovos, scopedChurnCards, unidadeFilter]);

  // ---- Clientes Ativos — série temporal ----
  // Reconstrói por evento (não existe snapshot mensal salvo): pra cada mês
  // entre o primeiro `ganho_em` filtrado e o mês atual, conta contratos com
  // ganho_em <= mês e sem churn até esse mês (cruza por CNPJ com
  // `cnpjChurnMes`, mesma base usada no LTV). Cliente sem CNPJ cadastrado
  // nunca é corrigido por churn nesta série — fica sempre "ativo" (mesma
  // limitação dos outros cálculos que dependem de CNPJ pra cruzar churn).
  const clientesAtivosSerieChart = useMemo(() => {
    const base = scopedContratosNovos
      .filter((c) => (unidadeFilter === ALL || c.unidade === unidadeFilter) && c.ganho_em)
      .map((c) => ({
        ganhoMes: (c.ganho_em ?? "").slice(0, 7),
        churnMes: (() => {
          const d = digits(c.cnpj);
          return d ? cnpjChurnMes.get(d) : undefined;
        })(),
      }));
    if (base.length === 0) return [];
    const primeiroMes = base.reduce((min, c) => (c.ganhoMes < min ? c.ganhoMes : min), base[0].ganhoMes);
    const meses: string[] = [];
    let [y, m] = primeiroMes.split("-").map(Number);
    const [yEnd, mEnd] = mesAtual.split("-").map(Number);
    while (y < yEnd || (y === yEnd && m <= mEnd)) {
      meses.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return meses.map((mes) => ({
      label: fmtMes(mes),
      ativos: base.filter((c) => c.ganhoMes <= mes && (!c.churnMes || c.churnMes > mes)).length,
    }));
  }, [scopedContratosNovos, unidadeFilter, cnpjChurnMes, mesAtual]);

  // ---- Churn de Receita por mês: waterfall Novo / Expansão / Contração / Perdido ----
  // Adaptação do "Perdido/Ganho/Variáveis/Exp. One Time" do mockup de
  // referência — esses 4 nomes não têm definição no vocabulário da Planning
  // (spec outputs/2026-08-spec-painel-gestao-unidades-indicadores.md), então
  // uso o waterfall de MRR padrão (Novo/Expansão/Contração/Perdido), que é
  // computável direto da mesma base de receita por cliente/mês já usada no
  // LTV (`royalties_itens.valor_confirmado`, categoria royalties, sem CAC).
  // Revenue Churn % = perdido ÷ receita total do mês anterior.
  const churnReceitaWaterfallChart = useMemo(() => {
    if (!royaltiesData) return [];
    const clientesFiltrados = royaltiesData.clientes.filter(
      (c) => unidadeFilter === ALL || c.unidade_nome === unidadeFilter,
    );
    const valoresPorMes = new Map<string, Map<string, number>>();
    const todosMeses = new Set<string>();
    for (const c of clientesFiltrados) {
      for (const [mes, item] of Object.entries(c.meses)) {
        if (item.categoria !== "royalties" || item.is_cac || item.excluido_em) continue;
        const mesCurto = mes.slice(0, 7);
        todosMeses.add(mesCurto);
        if (!valoresPorMes.has(mesCurto)) valoresPorMes.set(mesCurto, new Map());
        const porCliente = valoresPorMes.get(mesCurto)!;
        porCliente.set(c.chave, (porCliente.get(c.chave) ?? 0) + item.valor_confirmado);
      }
    }
    const mesesOrdenados = Array.from(todosMeses).sort();
    const out: {
      label: string;
      novo: number;
      expansao: number;
      contracao: number;
      perdido: number;
      churnPct: number | null;
    }[] = [];
    for (let i = 1; i < mesesOrdenados.length; i++) {
      const atual = valoresPorMes.get(mesesOrdenados[i])!;
      const anterior = valoresPorMes.get(mesesOrdenados[i - 1]) ?? new Map<string, number>();
      let novo = 0;
      let expansao = 0;
      let contracao = 0;
      let perdido = 0;
      for (const [chave, valorAtual] of atual) {
        const valorAnterior = anterior.get(chave) ?? 0;
        if (valorAnterior === 0 && valorAtual > 0) novo += valorAtual;
        else if (valorAtual > valorAnterior) expansao += valorAtual - valorAnterior;
        else if (valorAtual < valorAnterior) contracao += valorAnterior - valorAtual;
      }
      for (const [chave, valorAnterior] of anterior) {
        if (!atual.has(chave) && valorAnterior > 0) perdido += valorAnterior;
      }
      const baseAnterior = Array.from(anterior.values()).reduce((s, v) => s + v, 0);
      out.push({
        label: fmtMes(mesesOrdenados[i]),
        novo,
        expansao,
        contracao: -contracao,
        perdido: -perdido,
        churnPct: baseAnterior > 0 ? (perdido / baseAnterior) * 100 : null,
      });
    }
    return out;
  }, [royaltiesData, unidadeFilter]);

  // ---- ARPA (Receita Média Cliente) ----
  const arpa = clientesAtivos > 0 ? kpis.mrr / clientesAtivos : null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Overview — Gestão da Rede</h1>
            <p className="text-sm text-muted-foreground">Receita, clientes e retenção da rede</p>
          </div>
        </div>
        {perms.scopedToOwnUnit && perms.unidade ? (
          <Badge variant="secondary" className="h-9 px-3 text-sm">
            Unidade: {perms.unidade}
          </Badge>
        ) : (
          <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {unidades.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-primary/40"
          onClick={() => navigate({ to: "/clientes", search: { status: "ATIVO", unidade: "" } })}
          title="Ver contratos ativos"
        >
          <div className="text-xs text-muted-foreground">MRR</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.mrr)}</div>
          {kpis.receita > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {fmtPct((kpis.mrr / kpis.receita) * 100)} do recebido
            </div>
          )}
        </Card>
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-primary/40"
          onClick={() => navigate({ to: "/clientes", search: { status: "", unidade: "" } })}
          title="Ver clientes ativos"
        >
          <div className="text-xs text-muted-foreground">Clientes Ativos</div>
          <div className="mt-1 text-2xl font-bold">{clientesAtivos}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {totalClientes > 0 ? `de ${totalClientes} cadastrados` : "sem dados"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Churn Receita</div>
          <div className="mt-1 text-xl font-bold text-amber-600">
            {churnStats.churnReceitaPct != null ? fmtPct(churnStats.churnReceitaPct) : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {fmtBRL(churnStats.churnedMrr)} em MRR perdido
          </div>
          <VerDetalheLink to="/painel-cs" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Churn Logo</div>
          <div className="mt-1 text-xl font-bold text-amber-600">
            {churnStats.churnLogoPct != null ? fmtPct(churnStats.churnLogoPct) : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {churnStats.churnedCount} cliente{churnStats.churnedCount === 1 ? "" : "s"} perdido
            {churnStats.churnedCount === 1 ? "" : "s"}
          </div>
          <VerDetalheLink to="/painel-cs" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">KPI — NRR</div>
          <div
            className={`mt-1 text-xl font-bold ${kpis.nrr != null && kpis.nrr >= 100 ? "text-emerald-600" : "text-amber-600"}`}
          >
            {kpis.nrr != null ? `${kpis.nrr.toFixed(1)}%` : "—"}
          </div>
          {penultimo && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Retido: {fmtBRL(ultimo?.mrr)}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">NPS da Rede</div>
          <div
            className={`mt-1 text-xl font-bold ${npsStats.nps != null && npsStats.nps >= 50 ? "text-emerald-600" : "text-amber-600"}`}
          >
            {npsStats.nps != null ? npsStats.nps : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {npsStats.respondidas > 0 ? `${npsStats.respondidas} respostas` : "sem respostas"}
          </div>
          <VerDetalheLink to="/painel-cs" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Carteira Saudável</div>
          <div
            className={`mt-1 text-xl font-bold ${saudeStats.pctSaudavel != null && saudeStats.pctSaudavel >= 70 ? "text-emerald-600" : "text-amber-600"}`}
          >
            {saudeStats.pctSaudavel != null ? fmtPct(saudeStats.pctSaudavel) : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {saudeStats.risco} em risco de {saudeStats.total}
          </div>
          <VerDetalheLink to="/painel-cs" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Auditoria Interna (fiscal)</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] text-muted-foreground">Oportunidade</div>
              <div className="text-lg font-bold text-emerald-600">
                {fmtBRL(auditoriaStats.oportunidade)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Contingência</div>
              <div className="text-lg font-bold text-amber-600">
                {fmtBRL(auditoriaStats.contingencia)}
              </div>
            </div>
          </div>
          <VerDetalheLink to="/auditoria-interna" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Recebido (12 meses)</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(receitaTotalStats.total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {receitaTotalStats.pct != null
              ? `${receitaTotalStats.pct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(receitaTotalStats.pct))} vs. 12m anteriores`
              : "sem base de comparação"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Booking Total (12 meses)</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(bookingTotalStats.total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {bookingTotalStats.pct != null
              ? `${bookingTotalStats.pct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(bookingTotalStats.pct))} vs. 12m anteriores`
              : "sem base de comparação"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">MRR novo × 12 meses</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Receita Média Cliente (ARPA)</div>
          <div className="mt-1 text-xl font-bold">{arpa != null ? fmtBRL(arpa) : "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">MRR ÷ clientes ativos</div>
        </Card>
        <Card className="p-4 md:col-span-2">
          <div className="text-xs text-muted-foreground">Lifetime — receita acumulada por cliente</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] text-muted-foreground">Geral</div>
              <div className="text-lg font-bold">
                {ltvStats.geral != null ? fmtBRL(ltvStats.geral) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Ativo</div>
              <div className="text-lg font-bold">
                {ltvStats.ativo != null ? fmtBRL(ltvStats.ativo) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">{ltvStats.nAtivo} clientes</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Finalizado</div>
              <div className="text-lg font-bold">
                {ltvStats.finalizado != null ? fmtBRL(ltvStats.finalizado) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">{ltvStats.nFinalizado} clientes</div>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Soma de receita confirmada na apuração de royalties por cliente — Ativo até o mês
            atual, Finalizado até a data de churn.
          </div>
          <VerDetalheLink to="/royalties" />
        </Card>
      </div>

      {loading && <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>}

      {loadError && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          Erro ao carregar dados: {loadError}
        </Card>
      )}

      {!loading && byMes.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">MRR por Mês</div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byMes}>
                  <defs>
                    <linearGradient id="gradMrr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => fmtBRL(v)}
                    labelFormatter={(l) => `Mês: ${l}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="mrr"
                    name="MRR"
                    stroke="hsl(var(--primary))"
                    fill="url(#gradMrr)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="recebido"
                    name="Recebido"
                    stroke="hsl(142 71% 45%)"
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">
              MRR Novo vs Royalties Recebido (mês a mês)
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mrrNovoRoyaltiesChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => fmtBRL(v)}
                    labelFormatter={(l) => `Mês: ${l}`}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="mrrNovo"
                    name="MRR Novo"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="royaltiesRecebido"
                    name="Royalties Recebido"
                    stroke="hsl(142 71% 45%)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {royaltiesError && (
              <p className="mt-1 text-xs text-muted-foreground">
                Royalties indisponível para este usuário (requer acesso admin).
              </p>
            )}
            <VerDetalheLink to="/royalties" />
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">
              Crescimento Mensal — Clientes Iniciaram vs. Churn Logo
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={crescimentoMensalChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(l) => `Mês: ${l}`} />
                  <Legend />
                  <Bar dataKey="iniciaram" name="Clientes Iniciaram" fill="hsl(142 71% 45%)" />
                  <Bar dataKey="churnLogo" name="Churn Logo" fill="hsl(var(--muted-foreground))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">Variação do Booking % (mês a mês)</div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bookingVariacaoChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => (v == null ? "—" : `${v.toFixed(1)}%`)}
                    labelFormatter={(l) => `Mês: ${l}`}
                  />
                  <Bar dataKey="variacao" name="Variação">
                    {bookingVariacaoChart.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.variacao == null
                            ? "hsl(var(--muted-foreground))"
                            : d.variacao >= 0
                              ? "hsl(142 71% 45%)"
                              : "hsl(0 72% 51%)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Booking = MRR novo do mês × 12 (contrato assumido em 12 meses).
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">Clientes Ativos (série temporal)</div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={clientesAtivosSerieChart}>
                  <defs>
                    <linearGradient id="gradAtivos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(l) => `Mês: ${l}`} />
                  <Area
                    type="monotone"
                    dataKey="ativos"
                    name="Clientes Ativos"
                    stroke="hsl(142 71% 45%)"
                    fill="url(#gradAtivos)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Reconstruído por evento (ganho − churn acumulado por mês) — não é snapshot salvo.
            </div>
          </Card>

          <Card className="p-4 lg:col-span-2">
            <div className="mb-2 text-sm font-medium">
              Churn de Receita por Mês — Novo / Expansão / Contração / Perdido
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={churnReceitaWaterfallChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v, name) =>
                      name === "Revenue Churn %" ? `${Number(v).toFixed(1)}%` : fmtBRL(Number(v))
                    }
                    labelFormatter={(l) => `Mês: ${l}`}
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    stackId="mov"
                    dataKey="novo"
                    name="Novo"
                    fill="hsl(142 71% 45%)"
                  />
                  <Bar
                    yAxisId="left"
                    stackId="mov"
                    dataKey="expansao"
                    name="Expansão"
                    fill="hsl(142 45% 65%)"
                  />
                  <Bar
                    yAxisId="left"
                    stackId="mov"
                    dataKey="contracao"
                    name="Contração"
                    fill="hsl(38 92% 55%)"
                  />
                  <Bar
                    yAxisId="left"
                    stackId="mov"
                    dataKey="perdido"
                    name="Perdido"
                    fill="hsl(0 72% 51%)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="churnPct"
                    name="Revenue Churn %"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Baseado na receita confirmada na apuração de royalties por cliente/mês (mesma fonte
              do LTV). "Novo/Expansão/Contração/Perdido" é a adaptação da Planning pro waterfall de
              receita do mockup de referência — os rótulos originais (Variáveis/Exp. One Time) não
              têm definição própria aqui ainda.
            </div>
          </Card>
        </div>
      )}

      {/* Resumo por unidade — também é o ranking de melhores/piores unidades */}
      {!loading && (
        <Card className="overflow-x-auto">
          <div className="border-b p-3">
            <div className="text-sm font-semibold">Resumo por Unidade</div>
            <div className="text-xs text-muted-foreground">
              Matriz = leads roteados pelo Inside Sales. Hunter = vendas fechadas direto pela
              unidade (pipe Sócios) — mix mais Hunter é lido como positivo (autossuficiência
              comercial). Oportunidade/Contingência vêm da Auditoria Interna (fiscal), ver{" "}
              <Link to="/auditoria-interna" className="underline">
                detalhe
              </Link>
              .
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead className="text-right">MRR Atual</TableHead>
                <TableHead className="text-right">ARPA</TableHead>
                <TableHead className="text-right">Matriz</TableHead>
                <TableHead className="text-right">Hunter</TableHead>
                <TableHead className="text-right">% Hunter</TableHead>
                <TableHead className="text-right">Oportunidade</TableHead>
                <TableHead className="text-right">Contingência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byUnidade.map((u) => {
                const aud = auditoriaPorUnidade(u.unidade);
                const mix = mixHunterPct(u.unidade);
                return (
                  <TableRow key={u.unidade}>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right">{u.contratos || "—"}</TableCell>
                    <TableCell className="text-right">{fmtBRL(u.mrr)}</TableCell>
                    <TableCell className="text-right">
                      {u.contratos > 0 ? fmtBRL(u.mrr / u.contratos) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtBRL(vendasMatrizPorUnidade.get(u.unidade) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtBRL(vendasHunterPorUnidade.get(u.unidade) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {mix != null ? (
                        <span className="font-semibold text-emerald-600">
                          {fmtPct(mix)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600">
                      {aud.oportunidade > 0 ? fmtBRL(aud.oportunidade) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-amber-600">
                      {aud.contingencia > 0 ? fmtBRL(aud.contingencia) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {byUnidade.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                    Nenhum dado disponível.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {vendasSemUnidade.count > 0 && (
            <div className="border-t p-3 text-xs text-muted-foreground">
              {vendasSemUnidade.count} venda{vendasSemUnidade.count === 1 ? "" : "s"} do pipe Sócios
              este mês ({fmtBRL(vendasSemUnidade.mrr)}) sem "Unidade de Negócio" preenchida no
              Pipedrive — ignoradas nas colunas Matriz/Hunter acima (decisão de 11/08/2026, não
              rateadas nem mostradas numa linha "sem unidade"). Precisa corrigir direto no card do
              Pipedrive.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
