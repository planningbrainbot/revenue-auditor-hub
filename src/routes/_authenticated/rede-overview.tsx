import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { digits } from "@/lib/server-utils";
import { useRoyaltiesHistoricoRede } from "@/hooks/use-royalties";
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
// empresa_id + data_churn dão o corte de churn por CNPJ usado em
// `clientesAtivosSerieChart` (cliente ativo até a data de churn) — mrr entra
// no "Perdido" de `churnReceitaWaterfallChart` e no churn logo mensal usado
// pela fórmula de Lifetime (`ltvFormulaico`).
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
  status_contrato: string | null; // usado pra filtrar "Ativo" nas colunas Matriz/Hunter (MRR corrente, não só vendas do mês)
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

const pctVsPrev = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

// Índice absoluto de mês (ano×12+mês) — usado só pra calcular o "período
// anterior equivalente" ao range de data selecionado (mesma duração, logo
// antes do início do range), sem lidar com aritmética de Date/dia do mês.
const toMonthIndex = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};
const fromMonthIndex = (idx: number) => {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
};

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

  // Filtro de período — padrão: ano corrente. Todo gráfico/KPI de período na
  // aba Visão Geral respeita esse range (ver `inRange` abaixo); MRR/Clientes
  // Ativos continuam sendo "estado atual" e não são afetados por ele.
  const anoAtualNum = new Date().getFullYear();
  const [dataInicio, setDataInicio] = useState(`${anoAtualNum}-01-01`);
  const [dataFim, setDataFim] = useState(`${anoAtualNum}-12-31`);
  const rangeStartYm = dataInicio.slice(0, 7);
  const rangeEndYm = dataFim.slice(0, 7);
  const inRange = (mes: string | null | undefined) => {
    const ym = (mes ?? "").slice(0, 7);
    return ym >= rangeStartYm && ym <= rangeEndYm;
  };

  const perms = usePermissions();

  const { data: royaltiesData, error: royaltiesError } = useRoyaltiesHistoricoRede();
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
          .select("unidade,mrr_mensal,ganho_em,origem_pipeline,status_contrato,cnpj")
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

  // ---- MRR ativo por unidade, separado em Matriz vs. Hunter ----
  // Matriz = origem_pipeline='inside_sales' (pipeline 2, lead roteado pela
  // Matriz por "Unidade de Negócio"). Hunter = origem_pipeline='socios'
  // (pipeline 4, "Negociação - Sócios", venda fechada direto pela unidade) —
  // equivalência confirmada com o usuário em 11/08/2026, ver
  // outputs/2026-08-spec-painel-desempenho-unidade.md.
  //
  // Corrigido em 11/08/2026: a primeira versão somava só contratos ganhos no
  // mês corrente ("vendas do mês"), dando valores minúsculos e enganosos numa
  // tabela cujas outras colunas (MRR Atual, ARPA) são todas "estado atual" —
  // usuário reportou Belém com Matriz quase zero quando na prática a maior
  // parte do MRR Atual da unidade vem de conta roteada pela Matriz. Agora soma
  // `mrr_mensal` de **todo contrato `status_contrato='Ativo'`**, não só os
  // ganhos este mês — mesmo filtro que `v_reconciliacao_mensal.mrr_contratado`
  // usa pro MRR Atual, então Matriz + Hunter passa a bater com o MRR Atual da
  // linha (a menos do resíduo de contratos sem unidade, ver `vendasSemUnidade`).
  //
  // Cards do pipe Sócios sem "Unidade de Negócio" preenchida são ignorados no
  // ranking por unidade, por decisão explícita do usuário (não aparecem numa
  // linha "sem unidade" nem são rateados) — só ficam contabilizados em
  // `vendasSemUnidade` como nota de rodapé. Gap de preenchimento no Pipedrive,
  // não bug de sync — mas ao trocar pra "todo contrato Ativo" (não só os
  // ganhos no mês), o resíduo cresceu bastante: 130 de ~180 contratos Ativos
  // de origem Sócios (~92% do MRR Hunter) estão sem unidade atribuída (achado
  // de 11/08/2026, ver `outputs/2026-08-spec-painel-desempenho-unidade.md`
  // no wiki) — a coluna Hunter da tabela hoje mostra só a ponta visível do
  // volume real vendido pelas próprias unidades.
  const mesAtual = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const vendasMatrizPorUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if (c.status_contrato !== "Ativo" || !c.unidade) continue;
      if (c.origem_pipeline === "socios") continue;
      map.set(c.unidade, (map.get(c.unidade) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    return map;
  }, [scopedContratosNovos]);

  const vendasHunterPorUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if (c.status_contrato !== "Ativo" || !c.unidade) continue;
      if (c.origem_pipeline !== "socios") continue;
      map.set(c.unidade, (map.get(c.unidade) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    return map;
  }, [scopedContratosNovos]);

  // % do mix que é Hunter — mix mais Hunter é lido como positivo (unidade
  // autossuficiente, menos dependente do funil da Matriz), não como alerta.
  const mixHunterPct = (unidade: string) => {
    const matriz = vendasMatrizPorUnidade.get(unidade) ?? 0;
    const hunter = vendasHunterPorUnidade.get(unidade) ?? 0;
    const total = matriz + hunter;
    return total > 0 ? (hunter / total) * 100 : null;
  };

  // Ranking de Unidades por MRR Hunter (não MRR total) — mostra quem vende
  // mais por conta própria (pipe Sócios), não quem tem mais MRR de qualquer
  // origem. Lembrete: ~92% do MRR Hunter está sem unidade atribuída no
  // Pipedrive (ver `vendasSemUnidade`), então o ranking hoje só reflete a
  // fração com "Unidade de Negócio" preenchida.
  const rankingHunterData = useMemo(
    () =>
      unidades
        .map((u) => ({ unidade: u, hunter: vendasHunterPorUnidade.get(u) ?? 0 }))
        .sort((a, b) => b.hunter - a.hunter),
    [unidades, vendasHunterPorUnidade],
  );

  const vendasSemUnidade = useMemo(() => {
    let count = 0;
    let mrr = 0;
    for (const c of scopedContratosNovos) {
      if (c.status_contrato !== "Ativo" || c.unidade) continue;
      count++;
      mrr += Number(c.mrr_mensal ?? 0);
    }
    return { count, mrr };
  }, [scopedContratosNovos]);

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

  // ---- Receita Total e Booking Total (período selecionado vs. período anterior equivalente) ----
  // Antes era janela fixa de 12 meses; agora acompanha o filtro de data do
  // topo da página (`dataInicio`/`dataFim`, padrão ano corrente) — "anterior"
  // é a mesma duração, imediatamente antes do início do range selecionado.
  const periodoAnteriorRange = useMemo(() => {
    const rangeLen = toMonthIndex(rangeEndYm) - toMonthIndex(rangeStartYm) + 1;
    const prevEndYm = fromMonthIndex(toMonthIndex(rangeStartYm) - 1);
    const prevStartYm = fromMonthIndex(toMonthIndex(rangeStartYm) - rangeLen);
    return { prevStartYm, prevEndYm };
  }, [rangeStartYm, rangeEndYm]);

  const receitaTotalStats = useMemo(() => {
    const atual = byMes.filter((m) => inRange(m.mes)).reduce((s, m) => s + m.recebido, 0);
    const anterior = byMes
      .filter((m) => {
        const ym = (m.mes ?? "").slice(0, 7);
        return ym >= periodoAnteriorRange.prevStartYm && ym <= periodoAnteriorRange.prevEndYm;
      })
      .reduce((s, m) => s + m.recebido, 0);
    return { total: atual, pct: pctVsPrev(atual, anterior) };
  }, [byMes, rangeStartYm, rangeEndYm, periodoAnteriorRange]);

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
    const atual = bookingByMesArr.filter((m) => inRange(m.mes)).reduce((s, m) => s + m.booking, 0);
    const anterior = bookingByMesArr
      .filter((m) => m.mes >= periodoAnteriorRange.prevStartYm && m.mes <= periodoAnteriorRange.prevEndYm)
      .reduce((s, m) => s + m.booking, 0);
    return { total: atual, pct: pctVsPrev(atual, anterior) };
  }, [bookingByMesArr, rangeStartYm, rangeEndYm, periodoAnteriorRange]);

  // Variação mês a mês calculada sobre o histórico completo (precisa do mês
  // anterior mesmo fora do range pra comparar o 1º mês exibido) — o corte pro
  // período selecionado acontece só na hora de montar o `data` do gráfico.
  const bookingVariacaoChart = useMemo(
    () =>
      bookingByMesArr.map((m, i) => {
        const prev = i > 0 ? bookingByMesArr[i - 1].booking : null;
        const variacao = prev != null ? pctVsPrev(m.booking, prev) : null;
        return { mes: m.mes, label: m.label, variacao, booking: m.booking };
      }),
    [bookingByMesArr],
  );

  // ---- Receita (gráfico "Receita") — mesmo estilo do mockup: uma barra por
  // mês (Recebido) com valor e variação % vs. mês anterior rotulados acima.
  // Variação calculada sobre o histórico completo (precisa do mês anterior
  // mesmo fora do range) — o corte pro período selecionado só na exibição.
  const receitaChartData = useMemo(
    () =>
      byMes.map((m, i) => {
        const prev = i > 0 ? byMes[i - 1].recebido : null;
        return {
          mes: m.mes,
          label: m.label,
          recebido: m.recebido,
          pct: prev != null ? pctVsPrev(m.recebido, prev) : null,
        };
      }),
    [byMes],
  );

  // Cruza CNPJ (via empresas.id) com a data de churn conhecida — usado só pra
  // cortar `clientesAtivosSerieChart` (cliente sai da série ativa a partir do
  // mês de churn). O LTV em si não usa mais isso — ver `ltvFormulaico` abaixo.
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
        mes,
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
      mes,
      label: fmtMes(mes),
      ativos: base.filter((c) => c.ganhoMes <= mes && (!c.churnMes || c.churnMes > mes)).length,
    }));
  }, [scopedContratosNovos, unidadeFilter, cnpjChurnMes, mesAtual]);

  // ---- Lifetime (LTV) — fórmula padrão de SaaS: ARPA ÷ taxa de churn mensal ----
  // Decisão do usuário (11/08/2026): trocado do empírico (soma de
  // royalties_itens.valor_confirmado por cliente) pra essa fórmula, porque o
  // empírico só cobria meses com apuração de royalties já gerada — em vários
  // casos subestimava o LTV real (cliente antigo com pouco histórico apurado
  // dava LTV artificialmente baixo, ex: R$13k). A fórmula não depende desse
  // histórico: usa só o estado atual (ARPA) e a taxa de churn logo média
  // mensal do período selecionado no filtro de data do topo.
  //   Taxa de churn mensal = total de churn logo no período ÷ (clientes ativos
  //     médios no período × nº de meses do período) — aproximação padrão
  //     quando não se tem a taxa mês a mês exata.
  //   Lifetime médio (meses) = 1 ÷ taxa de churn mensal
  //   LTV = ARPA × lifetime médio
  const ltvFormulaico = useMemo(() => {
    const mesesPeriodo = crescimentoMensalChart.filter((d) => inRange(d.mes));
    const ativosPorMes = new Map(clientesAtivosSerieChart.map((d) => [d.mes, d.ativos]));
    if (mesesPeriodo.length === 0) return { churnMensalPct: null, lifetimeMeses: null, ltv: null };
    const totalChurn = mesesPeriodo.reduce((s, m) => s + m.churnLogo, 0);
    const ativosValues = mesesPeriodo
      .map((m) => ativosPorMes.get(m.mes) ?? 0)
      .filter((v) => v > 0);
    const mediaAtivos =
      ativosValues.length > 0 ? ativosValues.reduce((s, v) => s + v, 0) / ativosValues.length : 0;
    const churnMensal =
      mediaAtivos > 0 ? totalChurn / (mediaAtivos * mesesPeriodo.length) : null;
    const lifetimeMeses = churnMensal != null && churnMensal > 0 ? 1 / churnMensal : null;
    const arpaAtual = clientesAtivos > 0 ? kpis.mrr / clientesAtivos : null;
    const ltv = lifetimeMeses != null && arpaAtual != null ? arpaAtual * lifetimeMeses : null;
    return { churnMensalPct: churnMensal != null ? churnMensal * 100 : null, lifetimeMeses, ltv };
  }, [crescimentoMensalChart, clientesAtivosSerieChart, rangeStartYm, rangeEndYm, clientesAtivos, kpis.mrr]);

  // ---- Lifetime real dos concluídos (churn) — tempo de vida efetivo ----
  // Complementar ao `ltvFormulaico` acima (que é uma projeção a partir da taxa
  // de churn atual). Aqui é o dado real: pra cada cliente que já deu churn,
  // quanto tempo ele durou de verdade — primeira compra (`contratos.ganho_em`,
  // mínimo entre os contratos do CNPJ) até a data de churn
  // (`central_tratativas.data_churn`). Não depende de `royalties_itens`, então
  // não sofre do problema de cobertura que subestimava o LTV antigo.
  const lifetimeConcluidos = useMemo(() => {
    const primeiraCompraPorCnpj = new Map<string, string>();
    for (const c of scopedContratosNovos) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const d = digits(c.cnpj);
      const ganhoMes = (c.ganho_em ?? "").slice(0, 7);
      if (!d || !ganhoMes) continue;
      const atual = primeiraCompraPorCnpj.get(d);
      if (!atual || ganhoMes < atual) primeiraCompraPorCnpj.set(d, ganhoMes);
    }
    const duracoes: number[] = [];
    for (const c of scopedChurnCards) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      if (!c.empresa_id || !c.data_churn) continue;
      const d = empresaCnpjById.get(c.empresa_id);
      if (!d) continue;
      const ganhoMes = primeiraCompraPorCnpj.get(d);
      if (!ganhoMes) continue;
      const churnMes = c.data_churn.slice(0, 7);
      const dur = toMonthIndex(churnMes) - toMonthIndex(ganhoMes);
      if (dur >= 0) duracoes.push(dur);
    }
    if (duracoes.length === 0) return { mediaMeses: null, n: 0 };
    return {
      mediaMeses: duracoes.reduce((s, v) => s + v, 0) / duracoes.length,
      n: duracoes.length,
    };
  }, [scopedContratosNovos, scopedChurnCards, empresaCnpjById, unidadeFilter]);

  // ---- Novo vs. Perdido por Mês (MRR) ----
  // Simplificado a pedido do usuário (11/08/2026) — a primeira versão tentava
  // um waterfall completo (Novo/Expansão/Contração/Perdido) inferindo Perdido
  // de "cliente sumiu da apuração de royalties de um mês pro outro". Dois
  // problemas: (1) Expansão/Contração exigem receita confiável por contrato
  // mês a mês, granularidade que não existe ainda — removido até essa medição
  // existir. (2) Perdido inferido por ausência na apuração confundia "cliente
  // realmente deu churn" com "unidade ainda não gerou a apuração do mês
  // corrente" (itens são gerados sob demanda — ver comentário em
  // `royalties-historico.functions.ts`), inflando Perdido em centenas de
  // milhares sem nenhum churn real. Correção: **Perdido agora vem só de
  // `central_tratativas` (estágio Perdido/status lost, `data_churn` + `mrr`)**
  // — a mesma fonte única de churn que o resto da página já usa (`churnStats`,
  // `crescimentoMensalChart`), agrupada por mês. **Novo** = MRR de contratos
  // ganhos no mês (`contratos.ganho_em`/`mrr_mensal`), mesma fonte de
  // `newMrrByMes`.
  const churnReceitaWaterfallChart = useMemo(() => {
    const novoPorMes = new Map<string, number>();
    for (const c of scopedContratosNovos) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = (c.ganho_em ?? "").slice(0, 7);
      if (!mes) continue;
      novoPorMes.set(mes, (novoPorMes.get(mes) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    const perdidoPorMes = new Map<string, number>();
    for (const c of scopedChurnCards) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = (c.data_churn ?? "").slice(0, 7);
      if (!mes) continue;
      perdidoPorMes.set(mes, (perdidoPorMes.get(mes) ?? 0) + Number(c.mrr ?? 0));
    }
    const meses = new Set<string>([...novoPorMes.keys(), ...perdidoPorMes.keys()]);
    return Array.from(meses)
      .sort()
      .map((mes) => ({
        mes,
        label: fmtMes(mes),
        novo: novoPorMes.get(mes) ?? 0,
        perdido: -(perdidoPorMes.get(mes) ?? 0),
      }));
  }, [scopedContratosNovos, scopedChurnCards, unidadeFilter]);

  // ---- ARPA (Receita Média Cliente) ----
  const arpa = clientesAtivos > 0 ? kpis.mrr / clientesAtivos : null;

  // Recorte do gráfico "Receita" pro período selecionado — o índice aqui
  // precisa bater com o array passado em `data`, por isso o rótulo custom
  // (`ReceitaBarLabel`) indexa nesse mesmo array filtrado, não no completo.
  const receitaChartDataRange = receitaChartData.filter((d) => inRange(d.mes));

  // Rótulo por barra no mesmo estilo do mockup de referência: variação % (com
  // seta, cor por sinal) numa linha e o valor formatado (Mi/k) embaixo.
  const ReceitaBarLabel = (props: {
    x?: number;
    y?: number;
    width?: number;
    value?: number;
    index?: number;
  }) => {
    const { x = 0, y = 0, width = 0, value, index } = props;
    if (value == null || index == null) return null;
    const pct = receitaChartDataRange[index]?.pct;
    const arrow = pct == null ? "" : pct >= 0 ? "▲" : "▼";
    const pctColor =
      pct == null ? "hsl(0 0% 55%)" : pct >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)";
    const valorFmt =
      value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mi` : `${(value / 1000).toFixed(0)}k`;
    return (
      <g>
        {pct != null && (
          <text
            x={x + width / 2}
            y={y - 20}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={pctColor}
          >
            {arrow} {fmtPct(Math.abs(pct), 0)}
          </text>
        )}
        <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="hsl(0 0% 75%)">
          {valorFmt}
        </text>
      </g>
    );
  };

  // Recorte do gráfico "Variação do Booking %" pro período selecionado —
  // mesmo padrão de índice do `ReceitaBarLabel` acima.
  const bookingVariacaoChartRange = bookingVariacaoChart.filter((d) => inRange(d.mes));

  // Rótulo com o valor do Booking do mês (não só a %) — posicionado acima da
  // barra quando a variação é positiva/nula, abaixo quando é negativa (senão
  // fica em cima da própria barra vermelha, ilegível).
  const BookingVariacaoLabel = (props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    index?: number;
  }) => {
    const { x = 0, y = 0, width = 0, height = 0, index } = props;
    if (index == null) return null;
    const d = bookingVariacaoChartRange[index];
    if (!d) return null;
    const booking = d.booking;
    const valorFmt =
      booking >= 1_000_000
        ? `${(booking / 1_000_000).toFixed(1)} Mi`
        : `${(booking / 1000).toFixed(0)}k`;
    const negativo = d.variacao != null && d.variacao < 0;
    const textY = negativo ? y + height + 14 : y - 8;
    return (
      <text x={x + width / 2} y={textY} textAnchor="middle" fontSize={11} fill="hsl(0 0% 75%)">
        {valorFmt}
      </text>
    );
  };

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
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="Data inicial"
          />
          <span className="text-sm text-muted-foreground">até</span>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="Data final"
          />
        </div>
      </div>

      {loading && <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>}

      {loadError && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          Erro ao carregar dados: {loadError}
        </Card>
      )}

      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList>
          <TabsTrigger value="geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="vendas">Vendas &amp; Unidades</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="qualidade">Qualidade &amp; CS</TabsTrigger>
        </TabsList>

        {/* ---- Aba 1: Visão Geral — mesmo layout do mockup de referência ---- */}
        <TabsContent value="geral" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Receita Total</div>
              <div className="mt-1 text-xl font-bold">{fmtBRL(receitaTotalStats.total)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {receitaTotalStats.pct != null
                  ? `${receitaTotalStats.pct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(receitaTotalStats.pct))} vs. período anterior`
                  : "sem base de comparação"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Recebido no período</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Booking Total</div>
              <div className="mt-1 text-xl font-bold">{fmtBRL(bookingTotalStats.total)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {bookingTotalStats.pct != null
                  ? `${bookingTotalStats.pct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(bookingTotalStats.pct))} vs. período anterior`
                  : "sem base de comparação"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">MRR novo × 12 meses</div>
            </Card>
            <Card
              className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-primary/40"
              onClick={() => navigate({ to: "/clientes", search: { status: "", unidade: "" } })}
              title="Ver clientes ativos"
            >
              <div className="text-xs text-muted-foreground">Qtd Proj. Ativos</div>
              <div className="mt-1 text-2xl font-bold">{clientesAtivos}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">= Clientes Ativos</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Receita Média Cliente</div>
              <div className="mt-1 text-xl font-bold">{arpa != null ? fmtBRL(arpa) : "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">MRR ÷ clientes ativos</div>
            </Card>
            <Card
              className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-primary/40"
              onClick={() => navigate({ to: "/clientes", search: { status: "", unidade: "" } })}
              title="Ver clientes ativos"
            >
              <div className="text-xs text-muted-foreground">Qtd Clientes ativos</div>
              <div className="mt-1 text-2xl font-bold">{clientesAtivos}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {totalClientes > 0 ? `de ${totalClientes} cadastrados` : "sem dados"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Lifetime (LTV)</div>
              <div className="mt-1 text-xl font-bold">
                {ltvFormulaico.ltv != null ? fmtBRL(ltvFormulaico.ltv) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                ARPA ÷ churn mensal
                {ltvFormulaico.churnMensalPct != null
                  ? ` (${fmtPct(ltvFormulaico.churnMensalPct)} a.m., período selecionado)`
                  : ""}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-muted-foreground">Vida útil (projetada)</div>
                  <div className="text-sm font-bold tabular-nums">
                    {ltvFormulaico.lifetimeMeses != null
                      ? `${ltvFormulaico.lifetimeMeses.toFixed(1)} meses`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Vida útil (concluídos{lifetimeConcluidos.n > 0 ? `, ${lifetimeConcluidos.n}` : ""})
                  </div>
                  <div className="text-sm font-bold tabular-nums">
                    {lifetimeConcluidos.mediaMeses != null
                      ? `${lifetimeConcluidos.mediaMeses.toFixed(1)} meses`
                      : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Projetada = 1 ÷ churn mensal (estimativa). Concluídos = tempo real de vida de quem
                já deu churn (1ª compra até a data de churn).
              </div>
            </Card>
          </div>

          {!loading && byMes.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <div className="mb-2 text-sm font-medium">Receita</div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={receitaChartDataRange} margin={{ top: 28 }}>
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
                      <Bar dataKey="recebido" name="Recebido" fill="hsl(142 71% 45%)">
                        <LabelList dataKey="recebido" content={ReceitaBarLabel} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-4">
                <div className="mb-2 text-sm font-medium">Novo vs. Perdido por Mês (MRR)</div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={churnReceitaWaterfallChart.filter((d) => inRange(d.mes))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v: number) => fmtBRL(v)} labelFormatter={(l) => `Mês: ${l}`} />
                      <Legend />
                      <Bar dataKey="novo" name="Novo (MRR ganho)" fill="hsl(142 71% 45%)" />
                      <Bar dataKey="perdido" name="Perdido (MRR churn)" fill="hsl(0 72% 51%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Perdido = MRR de contratos com churn registrado em `central_tratativas` (mesma
                  fonte dos outros cards de churn da página). Novo = MRR de contratos ganhos no
                  mês. Expansão/Contração por contrato ficam de fora até existir uma medição
                  confiável de receita por contrato mês a mês.
                </div>
              </Card>

              <Card className="p-4">
                <div className="mb-2 text-sm font-medium">
                  Crescimento Mensal — Clientes Iniciaram vs. Churn Logo
                </div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={crescimentoMensalChart.filter((d) => inRange(d.mes))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip labelFormatter={(l) => `Mês: ${l}`} />
                      <Legend />
                      <Bar dataKey="iniciaram" name="Clientes Iniciaram" fill="hsl(142 71% 45%)" />
                      <Bar dataKey="churnLogo" name="Churn Logo" fill="var(--muted-foreground)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-4">
                <div className="mb-2 text-sm font-medium">Clientes Ativos (série temporal)</div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={clientesAtivosSerieChart.filter((d) => inRange(d.mes))}>
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
                <div className="mb-2 text-sm font-medium">Variação do Booking % (mês a mês)</div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bookingVariacaoChart.filter((d) => inRange(d.mes))}>
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
                                ? "var(--muted-foreground)"
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
            </div>
          )}
        </TabsContent>

        {/* ---- Aba 2: Vendas & Unidades — Matriz/Hunter, MRR, ranking por unidade ---- */}
        <TabsContent value="vendas" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
          </div>

          {!loading && rankingHunterData.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">Ranking de Unidades (MRR Hunter)</div>
              <div style={{ height: Math.max(180, rankingHunterData.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rankingHunterData}
                    layout="vertical"
                    margin={{ left: 8, right: 48 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="unidade"
                      width={110}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} labelFormatter={(l) => `${l}`} />
                    <Bar dataKey="hunter" name="MRR Hunter" fill="hsl(142 71% 45%)" radius={[0, 4, 4, 0]}>
                      <LabelList
                        dataKey="hunter"
                        position="right"
                        formatter={(v: number) => fmtBRL(v)}
                        style={{ fontSize: 11, fill: "hsl(0 0% 75%)" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Só a fração do MRR Hunter com "Unidade de Negócio" preenchida no Pipedrive — ver
                nota na tabela abaixo.
              </div>
            </Card>
          )}

          {/* Resumo por unidade — também é o ranking de melhores/piores unidades */}
          {!loading && (
            <Card className="overflow-x-auto">
              <div className="border-b p-3">
                <div className="text-sm font-semibold">Resumo por Unidade</div>
                <div className="text-xs text-muted-foreground">
                  Matriz/Hunter = MRR de contratos ativos hoje, por origem (Matriz = leads roteados
                  pelo Inside Sales; Hunter = vendas fechadas direto pela unidade, pipe Sócios) —
                  juntos devem bater com o MRR Atual da linha. Mix mais Hunter é lido como positivo
                  (autossuficiência comercial). Oportunidade/Contingência vêm da Auditoria Interna
                  (fiscal), ver{" "}
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
                            <span className="font-semibold text-emerald-600">{fmtPct(mix)}</span>
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
              {vendasSemUnidade.count > 0 &&
                (() => {
                  const hunterTotal =
                    Array.from(vendasHunterPorUnidade.values()).reduce((s, v) => s + v, 0) +
                    vendasSemUnidade.mrr;
                  const pctSemUnidade =
                    hunterTotal > 0 ? (vendasSemUnidade.mrr / hunterTotal) * 100 : null;
                  return (
                    <div className="border-t p-3 text-xs text-muted-foreground">
                      {vendasSemUnidade.count} contrato{vendasSemUnidade.count === 1 ? "" : "s"}{" "}
                      ativo{vendasSemUnidade.count === 1 ? "" : "s"} do pipe Sócios (
                      {fmtBRL(vendasSemUnidade.mrr)}
                      {pctSemUnidade != null ? `, ${fmtPct(pctSemUnidade, 0)} do MRR Hunter` : ""})
                      sem "Unidade de Negócio" preenchida no Pipedrive — ignorados nas colunas
                      Matriz/Hunter acima (decisão de 11/08/2026, não rateados nem mostrados numa
                      linha "sem unidade"). A coluna Hunter da tabela hoje só mostra a parte que
                      tem unidade atribuída — o volume real de vendas por sócio é maior. Precisa
                      corrigir direto no card do Pipedrive.
                    </div>
                  );
                })()}
            </Card>
          )}
        </TabsContent>

        {/* ---- Aba 3: Financeiro — MRR Novo vs. Royalties Recebido ---- */}
        <TabsContent value="financeiro" className="space-y-4">
          {!loading && byMes.length > 0 && (
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
                      stroke="hsl(217 91% 60%)"
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
          )}
        </TabsContent>

        {/* ---- Aba 4: Qualidade & CS — NPS, Saúde da Carteira, Churn, Auditoria ---- */}
        <TabsContent value="qualidade" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
