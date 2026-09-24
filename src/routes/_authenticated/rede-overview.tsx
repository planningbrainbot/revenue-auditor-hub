import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  type LabelProps,
} from "recharts";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { normalizeUnitName, unitMatches, usePermissions } from "@/hooks/use-permissions";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  type EstadoKpi,
} from "@/components/planning";
import {
  COR_NEGATIVO,
  COR_NEUTRA,
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { DestinoLink } from "@/components/rede/destino-link";
import { chaveMes, mesCorrente, mesesEntre, rotuloMes, somarMeses } from "@/lib/rede/mes";

// Contrato da tela: docs/design/contratos/rede-overview.md (arquétipo Visão
// geral). Todo card segue o mesmo padrão: número-resumo aqui, e o card ou o
// "Ver detalhe" leva para a tela dona daquele dado. Quando o total do destino
// não bate com o daqui, a nota do card diz isso (N2).
// "Ver detalhe →" de cada card, com foco visível: o DestinoLink da Rede.
const VerDetalheLink = DestinoLink;

// Célula de tabela cuja fonte caiu: diz isso em vez de R$ 0 (N4).
function CelulaIndisponivel() {
  return <span className="text-muted-foreground">fonte indisponível</span>;
}

const ABAS = ["geral", "vendas", "financeiro", "qualidade"] as const;
type Aba = (typeof ABAS)[number];

type BuscaOverview = { aba?: Aba; unidade?: string; de?: string; ate?: string };

// Aba, unidade e período moram na URL (N7): recarregar ou colar o link
// reproduz a tela. Só entram as chaves com valor, para o link limpo continuar
// sendo o da tela sem filtro.
function validarBusca(s: Record<string, unknown>): BuscaOverview {
  const texto = (v: unknown, max: number) =>
    typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
  const aba = texto(s.aba, 20);
  const busca: BuscaOverview = {
    aba: aba && (ABAS as readonly string[]).includes(aba) ? (aba as Aba) : undefined,
    unidade: texto(s.unidade, 120),
    de: texto(s.de, 10),
    ate: texto(s.ate, 10),
  };
  return Object.fromEntries(Object.entries(busca).filter(([, v]) => v)) as BuscaOverview;
}

export const Route = createFileRoute("/_authenticated/rede-overview")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: RedeOverviewGuard,
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

// As cinco leituras da tela, pelo nome que aparece no aviso de erro: a pessoa
// precisa saber qual fonte caiu, não só que "algo falhou".
type Fonte = "recon" | "empresas" | "tratativas" | "contratos" | "auditoria";
const NOME_FONTE: Record<Fonte, string> = {
  recon: "v_reconciliacao_mensal",
  empresas: "empresas",
  tratativas: "central_tratativas",
  contratos: "contratos",
  auditoria: "auditorias_internas",
};

const ALL = "__all__";

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtPct = (v: number | null | undefined, decimals = 1) =>
  v == null ? "—" : `${v.toFixed(decimals)}%`;

const fmtMil = (v: number) => `${(v / 1000).toFixed(0)}k`;

const pctVsPrev = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Quem não tem a área Rede não deve cair na página e ver erro de carregamento:
// a página consulta dezenas de tabelas que a RLS fecha para ela, e o resultado
// parecia defeito do sistema. O portão fica antes de qualquer hook de dado.
function RedeOverviewGuard() {
  const { temArea, loading } = usePermissions();
  if (loading) return null;
  if (!temArea("rede")) return <SemAcessoArea area="Rede" />;
  return <RedeOverviewPage />;
}

function RedeOverviewPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReconcRow[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [churnCards, setChurnCards] = useState<ChurnCardRow[]>([]);
  const [contratosNovos, setContratosNovos] = useState<ContratoNovoRow[]>([]);
  const [auditorias, setAuditorias] = useState<AuditoriaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erros, setErros] = useState<Partial<Record<Fonte, string>>>({});
  const [recarga, setRecarga] = useState(0);

  const [aba, setAba] = useFiltroNaUrl("aba", "geral");
  const [unidadeUrl, setUnidadeUrl] = useFiltroNaUrl("unidade", "");

  // Filtro de período — padrão: ano corrente. Todo gráfico/KPI de período na
  // aba Visão Geral respeita esse range (ver `inRange` abaixo); MRR/Clientes
  // Ativos continuam sendo "estado atual" e não são afetados por ele. Início
  // depois do fim (ou data ilegível na URL) cai no padrão.
  const anoAtualNum = new Date().getFullYear();
  const dePadrao = `${anoAtualNum}-01-01`;
  const atePadrao = `${anoAtualNum}-12-31`;
  const [deUrl, setDeUrl] = useFiltroNaUrl("de", dePadrao);
  const [ateUrl, setAteUrl] = useFiltroNaUrl("ate", atePadrao);
  const periodoValido = RE_DATA.test(deUrl) && RE_DATA.test(ateUrl) && deUrl <= ateUrl;
  const dataInicio = periodoValido ? deUrl : dePadrao;
  const dataFim = periodoValido ? ateUrl : atePadrao;
  const rangeStartYm = dataInicio.slice(0, 7);
  const rangeEndYm = dataFim.slice(0, 7);
  const inRange = (mes: string | null | undefined) => {
    const ym = (mes ?? "").slice(0, 7);
    return ym >= rangeStartYm && ym <= rangeEndYm;
  };

  const perms = usePermissions();

  // Sócio (data.scope.own_unit_only) vê só a própria unidade nesta página —
  // decisão de 11/08/2026 (reverte a permissividade anterior de "ranking sem
  // restrição"; ver DECISIONS.md). A unidade dele vale acima da URL, em vez de
  // deixar ALL selecionável e confiar só no Badge da UI.
  const unidadeFilter =
    perms.scopedToOwnUnit && perms.unidade ? perms.unidade : unidadeUrl || ALL;

  const {
    data: royaltiesData,
    error: royaltiesError,
    isLoading: royaltiesCarregando,
    refetch: recarregarRoyalties,
  } = useRoyaltiesHistoricoRede();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
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
          // status="lost" vem do id da fase (PHASE_STATUS), não do nome — robusto
          // a rename. Ver nota em clientes.tsx.
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
      // Cada resposta pode falhar (RLS, rede, etc.) sem lançar exceção. O erro
      // fica por fonte: o card que depende dela sai "fonte indisponível" em
      // vez de "R$ 0", e o aviso do topo diz qual fonte caiu.
      const novosErros: Partial<Record<Fonte, string>> = {};
      if (reconRes.error) novosErros.recon = reconRes.error.message;
      if (empRes.error) novosErros.empresas = empRes.error.message;
      if (tratRes.error) novosErros.tratativas = tratRes.error.message;
      if (contRes.error) novosErros.contratos = contRes.error.message;
      if (audRes.error) novosErros.auditoria = audRes.error.message;
      setErros(novosErros);
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
  }, [recarga]);

  // Só erro de permissão vira "sem acesso"; queda de rede ou de banco é erro
  // com "Tentar de novo". A server fn lança "Acesso negado" (assertAdmin) e o
  // PostgREST devolve 42501 / 403 / RLS.
  const royaltiesSemPermissao =
    !!royaltiesError &&
    /acesso negado|permission denied|42501|\b403\b|row-level security|\brls\b/i.test(
      royaltiesError.message ?? "",
    );

  const tentarDeNovo = () => {
    setRecarga((n) => n + 1);
    void recarregarRoyalties();
  };

  // Estado do card a partir das fontes de que ele depende: qualquer uma fora
  // do ar vira "fonte indisponível" com o nome dela, nunca zero (N4).
  const fontesComErro = (Object.keys(erros) as Fonte[]).filter((f) => erros[f]);
  const indisponivel = (...fontes: Fonte[]): { estado: EstadoKpi; nota: string } | null => {
    const caidas = fontes.filter((f) => erros[f]);
    if (caidas.length === 0) return null;
    return {
      estado: "indisponivel",
      nota: `falhou: ${caidas.map((f) => NOME_FONTE[f]).join(", ")}`,
    };
  };

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
    () => Array.from(new Set(scopedRows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
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
      const m = chaveMes(r.mes);
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
      .map(([mes, v]) => ({ mes, label: rotuloMes(mes), ...v }));
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
  const mesAtual = useMemo(mesCorrente, []);

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
      const mes = chaveMes(c.ganho_em) ?? "";
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
      const mes = chaveMes(p.mes_referencia);
      if (!mes) continue;
      map.set(mes, (map.get(mes) ?? 0) + p.royalties_apurado);
    }
    return map;
  }, [royaltiesData, unidadeFilter]);

  // Acumulado calculado sobre a série completa (não sobre o range filtrado),
  // senão o corte de data zeraria o acumulado no meio do histórico — o filtro
  // de data só corta o array na hora de montar `data` do gráfico.
  const mrrNovoRoyaltiesChart = useMemo(() => {
    const meses = new Set<string>([...newMrrByMes.keys(), ...royaltiesByMes.keys()]);
    let acumulado = 0;
    return Array.from(meses)
      .sort()
      .map((mes) => {
        const mrrNovo = newMrrByMes.get(mes) ?? 0;
        acumulado += mrrNovo;
        return {
          mes,
          label: rotuloMes(mes),
          mrrNovo,
          royaltiesRecebido: royaltiesByMes.get(mes) ?? 0,
          mrrAcumulado: acumulado,
        };
      });
  }, [newMrrByMes, royaltiesByMes]);

  // ---- Receita Total e Booking Total (período selecionado vs. período anterior equivalente) ----
  // Antes era janela fixa de 12 meses; agora acompanha o filtro de data do
  // topo da página (`dataInicio`/`dataFim`, padrão ano corrente) — "anterior"
  // é a mesma duração, imediatamente antes do início do range selecionado.
  const periodoAnteriorRange = useMemo(() => {
    // "Período anterior equivalente": mesma duração, logo antes do início.
    const rangeLen = mesesEntre(rangeStartYm, rangeEndYm) + 1;
    const prevEndYm = somarMeses(rangeStartYm, -1);
    const prevStartYm = somarMeses(rangeStartYm, -rangeLen);
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
      label: rotuloMes(mes),
      booking: (newMrrByMes.get(mes) ?? 0) * 12,
    }));
  }, [newMrrByMes]);

  const bookingTotalStats = useMemo(() => {
    const atual = bookingByMesArr.filter((m) => inRange(m.mes)).reduce((s, m) => s + m.booking, 0);
    const anterior = bookingByMesArr
      .filter(
        (m) => m.mes >= periodoAnteriorRange.prevStartYm && m.mes <= periodoAnteriorRange.prevEndYm,
      )
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
      const mes = chaveMes(c.data_churn) ?? "";
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
      const mes = chaveMes(c.ganho_em) ?? "";
      if (!mes) continue;
      iniciaramPorMes.set(mes, (iniciaramPorMes.get(mes) ?? 0) + 1);
    }
    const churnPorMes = new Map<string, number>();
    for (const c of scopedChurnCards) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = chaveMes(c.data_churn) ?? "";
      if (!mes) continue;
      churnPorMes.set(mes, (churnPorMes.get(mes) ?? 0) + 1);
    }
    const meses = new Set<string>([...iniciaramPorMes.keys(), ...churnPorMes.keys()]);
    return Array.from(meses)
      .sort()
      .map((mes) => ({
        mes,
        label: rotuloMes(mes),
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
        ganhoMes: chaveMes(c.ganho_em) ?? "",
        churnMes: (() => {
          const d = digits(c.cnpj);
          return d ? cnpjChurnMes.get(d) : undefined;
        })(),
      }));
    if (base.length === 0) return [];
    const primeiroMes = base.reduce(
      (min, c) => (c.ganhoMes < min ? c.ganhoMes : min),
      base[0].ganhoMes,
    );
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
      label: rotuloMes(mes),
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
    const ativosValues = mesesPeriodo.map((m) => ativosPorMes.get(m.mes) ?? 0).filter((v) => v > 0);
    const mediaAtivos =
      ativosValues.length > 0 ? ativosValues.reduce((s, v) => s + v, 0) / ativosValues.length : 0;
    const churnMensal = mediaAtivos > 0 ? totalChurn / (mediaAtivos * mesesPeriodo.length) : null;
    const lifetimeMeses = churnMensal != null && churnMensal > 0 ? 1 / churnMensal : null;
    const arpaAtual = clientesAtivos > 0 ? kpis.mrr / clientesAtivos : null;
    const ltv = lifetimeMeses != null && arpaAtual != null ? arpaAtual * lifetimeMeses : null;
    return { churnMensalPct: churnMensal != null ? churnMensal * 100 : null, lifetimeMeses, ltv };
  }, [
    crescimentoMensalChart,
    clientesAtivosSerieChart,
    rangeStartYm,
    rangeEndYm,
    clientesAtivos,
    kpis.mrr,
  ]);

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
      const ganhoMes = chaveMes(c.ganho_em) ?? "";
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
      const churnMes = chaveMes(c.data_churn) ?? "";
      const dur = mesesEntre(ganhoMes, churnMes);
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
      const mes = chaveMes(c.ganho_em) ?? "";
      if (!mes) continue;
      novoPorMes.set(mes, (novoPorMes.get(mes) ?? 0) + Number(c.mrr_mensal ?? 0));
    }
    const perdidoPorMes = new Map<string, number>();
    for (const c of scopedChurnCards) {
      if (unidadeFilter !== ALL && c.unidade !== unidadeFilter) continue;
      const mes = chaveMes(c.data_churn) ?? "";
      if (!mes) continue;
      perdidoPorMes.set(mes, (perdidoPorMes.get(mes) ?? 0) + Number(c.mrr ?? 0));
    }
    const meses = new Set<string>([...novoPorMes.keys(), ...perdidoPorMes.keys()]);
    return Array.from(meses)
      .sort()
      .map((mes) => ({
        mes,
        label: rotuloMes(mes),
        novo: novoPorMes.get(mes) ?? 0,
        perdido: -(perdidoPorMes.get(mes) ?? 0),
      }));
  }, [scopedContratosNovos, scopedChurnCards, unidadeFilter]);

  // ---- ARPA (Receita Média Cliente) ----
  const arpa = clientesAtivos > 0 ? kpis.mrr / clientesAtivos : null;

  // Unidade sem nenhum título do Omie na série inteira (São Luís, Fortaleza em
  // 24/09): o recebido 0 não é "não recebeu", é "não há o que medir".
  const semTitulosOmie =
    unidadeFilter !== ALL && byMes.every((m) => m.recebido === 0 && m.faturado === 0);

  // Recorte do gráfico "Receita" pro período selecionado — o índice aqui
  // precisa bater com o array passado em `data`, por isso o rótulo custom
  // indexa nesse mesmo array filtrado, não no completo.
  const receitaChartDataRange = receitaChartData.filter((d) => inRange(d.mes));

  // Rótulo por barra: variação % (seta e cor pelo sinal) numa linha e o valor
  // formatado (Mi/k) embaixo. Cores e corpo pelo tema (DESIGN.md §5).
  const receitaBarLabel = (props: LabelProps) => {
    const { index, value } = props;
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const width = Number(props.width ?? 0);
    if (value == null || index == null) return null;
    const v = Number(value);
    const pct = receitaChartDataRange[index]?.pct;
    const arrow = pct == null ? "" : pct >= 0 ? "▲" : "▼";
    const pctColor =
      pct == null ? "var(--muted-foreground)" : pct >= 0 ? "var(--success)" : COR_NEGATIVO;
    const valorFmt = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} Mi` : fmtMil(v);
    return (
      <g>
        {pct != null && (
          <text
            x={x + width / 2}
            y={y - 20}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill={pctColor}
          >
            {arrow} {fmtPct(Math.abs(pct), 0)}
          </text>
        )}
        <text
          x={x + width / 2}
          y={y - 6}
          textAnchor="middle"
          fontSize={12}
          fill="var(--muted-foreground)"
        >
          {valorFmt}
        </text>
      </g>
    );
  };

  const novoPerdidoRange = churnReceitaWaterfallChart.filter((d) => inRange(d.mes));
  const crescimentoRange = crescimentoMensalChart.filter((d) => inRange(d.mes));
  const contratosAtivosRange = clientesAtivosSerieChart.filter((d) => inRange(d.mes));
  // As cores das barras saem deste mesmo recorte: iterar a série inteira
  // desalinhava a cor da barra (correção 5 do contrato).
  const bookingVariacaoChartRange = bookingVariacaoChart.filter((d) => inRange(d.mes));
  const mrrNovoRoyaltiesRange = mrrNovoRoyaltiesChart.filter((d) => inRange(d.mes));

  const semMeses = <EstadoVazio titulo="Sem meses no período" />;

  // Bloco de gráfico: erro da fonte, vazio do período ou o gráfico.
  const blocoGrafico = (
    fontes: Fonte[],
    vazio: boolean,
    grafico: ReactNode,
    vazioTitulo?: string,
  ) => {
    const caidas = fontes.filter((f) => erros[f]);
    if (caidas.length > 0) {
      return (
        <EstadoErro
          titulo="Fonte indisponível"
          detalhe={caidas.map((f) => NOME_FONTE[f]).join(", ")}
          tentarNovamente={tentarDeNovo}
        />
      );
    }
    if (vazio) return vazioTitulo ? <EstadoVazio titulo={vazioTitulo} /> : semMeses;
    return grafico;
  };

  const perimetro = unidadeFilter === ALL ? "Rede inteira" : unidadeFilter;
  const abaAtual: Aba = (ABAS as readonly string[]).includes(aba) ? (aba as Aba) : "geral";

  const recebidoKpi = indisponivel("recon");
  const bookingKpi = indisponivel("contratos");
  const clientesKpi = indisponivel("empresas", "tratativas");
  const arpaKpi = indisponivel("recon", "empresas", "tratativas");
  const lifetimeKpi = indisponivel("recon", "empresas", "tratativas", "contratos");
  const churnKpi = indisponivel("recon", "empresas", "tratativas");
  const auditoriaKpi = indisponivel("auditoria");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Overview"
        pergunta="Quais unidades estão fora da curva em receita, clientes e retenção?"
        descricao={`${perimetro} · ${rotuloMes(rangeStartYm)}–${rotuloMes(rangeEndYm)} · receita pelo mês de competência; MRR e clientes são a foto de hoje e ignoram o período`}
        procedencia={{
          fonte:
            "v_reconciliacao_mensal · contratos · central_tratativas · empresas · auditorias_internas · apuração de royalties",
          regua: "recebido = títulos RECEBIDO do Omie pelo mês de competência",
        }}
        filtros={
          <>
            {perms.scopedToOwnUnit && perms.unidade ? (
              <Badge variant="secondary" className="h-9 px-3 text-sm">
                Unidade: {perms.unidade}
              </Badge>
            ) : (
              <Select
                value={unidadeFilter}
                onValueChange={(v) => setUnidadeUrl(v === ALL ? undefined : v)}
              >
                <SelectTrigger className="w-[200px]" aria-label="Unidade">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Rede inteira</SelectItem>
                  {unidades.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDeUrl(e.target.value || undefined)}
                className="h-9 w-auto"
                aria-label="Data inicial"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setAteUrl(e.target.value || undefined)}
                className="h-9 w-auto"
                aria-label="Data final"
              />
            </div>
          </>
        }
      />

      {!loading && fontesComErro.length > 0 && (
        <EstadoErro
          titulo="Parte dos dados não carregou"
          detalhe={fontesComErro.map((f) => `${NOME_FONTE[f]}: ${erros[f]}`).join(" · ")}
          tentarNovamente={tentarDeNovo}
        />
      )}

      <Tabs value={abaAtual} onValueChange={(v) => setAba(v)} className="space-y-6">
        <TabsList>
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="vendas">Vendas e unidades</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="qualidade">Qualidade e CS</TabsTrigger>
        </TabsList>

        {/* ---- Aba 1: Visão geral ---- */}
        <TabsContent value="geral" className="space-y-6">
          {loading ? (
            <Carregando variante="kpis" />
          ) : (
            // Cinco cards (N12): "Qtd Proj. Ativos" saiu, era o mesmo número de
            // "Clientes ativos" com outro rótulo (N11).
            <KpiGrade colunas={6} className="xl:grid-cols-5">
              <KpiCard
                rotulo="Recebido no período"
                valor={fmtBRL(receitaTotalStats.total)}
                estado={recebidoKpi?.estado ?? (semTitulosOmie ? "nao-apurado" : "ok")}
                delta={
                  receitaTotalStats.pct != null
                    ? { valor: receitaTotalStats.pct, rotulo: "vs. período anterior" }
                    : undefined
                }
                nota={
                  recebidoKpi?.nota ??
                  (semTitulosOmie
                    ? "sem títulos do Omie no período"
                    : `${receitaTotalStats.pct != null ? "" : "sem base de comparação · "}competência · o Funil de Receita usa outro recorte e não bate com este total`)
                }
                abrir={{ href: "/funil-receita", rotulo: "Abrir Funil de Receita" }}
              />
              <KpiCard
                rotulo="Booking"
                valor={fmtBRL(bookingTotalStats.total)}
                estado={bookingKpi?.estado ?? "ok"}
                delta={
                  bookingTotalStats.pct != null
                    ? { valor: bookingTotalStats.pct, rotulo: "vs. período anterior" }
                    : undefined
                }
                nota={
                  bookingKpi?.nota ??
                  (bookingTotalStats.pct != null
                    ? "MRR novo × 12 meses"
                    : "sem base de comparação · MRR novo × 12 meses")
                }
              />
              <KpiCard
                rotulo="Clientes ativos (empresas)"
                valor={clientesAtivos}
                estado={clientesKpi?.estado ?? (totalClientes > 0 ? "ok" : "nao-apurado")}
                nota={
                  clientesKpi?.nota ??
                  (totalClientes > 0
                    ? `de ${totalClientes} cadastradas · Contratos e churn conta contratos, outra régua: não bate`
                    : "nenhuma empresa cadastrada no recorte")
                }
                abrir={{
                  onClick: () =>
                    navigate({
                      to: "/clientes",
                      search: { view: "contratos", status: "", unidade: "" },
                    }),
                  rotulo: "Abrir Contratos e churn",
                }}
              />
              <KpiCard
                rotulo="Receita média por empresa"
                valor={arpa != null ? fmtBRL(arpa) : "—"}
                estado={arpaKpi?.estado ?? (arpa != null ? "ok" : "nao-apurado")}
                nota={arpaKpi?.nota ?? "MRR ÷ clientes ativos (empresas)"}
              />
              <KpiCard
                rotulo="Lifetime (ARPA ÷ churn)"
                valor={ltvFormulaico.ltv != null ? fmtBRL(ltvFormulaico.ltv) : "—"}
                estado={lifetimeKpi?.estado ?? (ltvFormulaico.ltv != null ? "ok" : "nao-apurado")}
                nota={
                  lifetimeKpi?.nota ?? (
                    <>
                      ARPA × 1 ÷ churn mensal
                      {ltvFormulaico.churnMensalPct != null
                        ? ` (${fmtPct(ltvFormulaico.churnMensalPct)} a.m., período selecionado)`
                        : ""}
                      <span className="mt-2 grid grid-cols-2 gap-2">
                        <span className="block">
                          <span className="block text-xs">Vida útil (projetada)</span>
                          <span className="num block text-sm font-bold text-foreground">
                            {ltvFormulaico.lifetimeMeses != null
                              ? `${ltvFormulaico.lifetimeMeses.toFixed(1)} meses`
                              : "—"}
                          </span>
                        </span>
                        <span className="block">
                          <span className="block text-xs">
                            Vida útil (concluídos
                            {lifetimeConcluidos.n > 0 ? `, ${lifetimeConcluidos.n}` : ""})
                          </span>
                          <span className="num block text-sm font-bold text-foreground">
                            {lifetimeConcluidos.mediaMeses != null
                              ? `${lifetimeConcluidos.mediaMeses.toFixed(1)} meses`
                              : "—"}
                          </span>
                        </span>
                      </span>
                      <span className="mt-1 block text-xs">
                        Projetada = 1 ÷ churn mensal (estimativa). Concluídos = tempo real de vida de
                        quem já deu churn (1ª compra até a data de churn).
                      </span>
                    </>
                  )
                }
              />
            </KpiGrade>
          )}

          {!loading && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Secao
                titulo="Quanto a rede recebeu por mês? (R$)"
                descricao="Títulos RECEBIDO do Omie pelo mês de competência; variação contra o mês anterior."
                acoes={<VerDetalheLink to="/funil-receita" />}
              >
                {blocoGrafico(
                  ["recon"],
                  receitaChartDataRange.length === 0 || semTitulosOmie,
                  <Card className="p-4">
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={receitaChartDataRange} margin={{ top: 28 }}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis tickFormatter={fmtMil} {...eixoProps} />
                          <Tooltip
                            {...tooltipProps}
                            formatter={(v: number) => fmtBRL(v)}
                            labelFormatter={(l) => `Mês: ${l}`}
                          />
                          <Bar dataKey="recebido" name="Recebido" fill={CORES_SERIE[0]}>
                            <LabelList dataKey="recebido" content={receitaBarLabel} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                  semTitulosOmie ? "Sem títulos do Omie no período" : undefined,
                )}
              </Secao>

              <Secao
                titulo="Quanto MRR entrou e quanto saiu por mês? (R$)"
                descricao="Novo = MRR de contratos ganhos no mês. Perdido = MRR com churn registrado em central_tratativas. Expansão e contração ficam de fora até existir receita confiável por contrato mês a mês."
              >
                {blocoGrafico(
                  ["contratos", "tratativas"],
                  novoPerdidoRange.length === 0,
                  <Card className="p-4">
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={novoPerdidoRange}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis tickFormatter={fmtMil} {...eixoProps} />
                          <Tooltip
                            {...tooltipProps}
                            formatter={(v: number) => fmtBRL(v)}
                            labelFormatter={(l) => `Mês: ${l}`}
                          />
                          <Legend {...legendaProps} />
                          <Bar dataKey="novo" name="Novo (MRR ganho)" fill={CORES_SERIE[0]} />
                          <Bar dataKey="perdido" name="Perdido (MRR churn)" fill={COR_NEGATIVO} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                )}
              </Secao>

              <Secao
                titulo="Quantos contratos começaram e quantos clientes saíram por mês?"
                descricao="Contratos iniciados = contratos ganhos no mês. Churn logo = cards de tratativa perdidos no mês."
              >
                {blocoGrafico(
                  ["contratos", "tratativas"],
                  crescimentoRange.length === 0,
                  <Card className="p-4">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={crescimentoRange}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis allowDecimals={false} {...eixoProps} />
                          <Tooltip {...tooltipProps} labelFormatter={(l) => `Mês: ${l}`} />
                          <Legend {...legendaProps} />
                          <Bar dataKey="iniciaram" name="Contratos iniciados" fill={CORES_SERIE[0]} />
                          <Bar dataKey="churnLogo" name="Churn logo" fill={CORES_SERIE[1]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                )}
              </Secao>

              <Secao
                titulo="Quantos contratos estavam ativos em cada mês?"
                descricao="Contratos ativos por mês, reconstruído por evento (ganho − churn acumulado por mês); não é snapshot salvo."
                acoes={<VerDetalheLink to="/clientes" search={{ view: "contratos", status: "", unidade: "" }} />}
              >
                {blocoGrafico(
                  ["contratos", "tratativas", "empresas"],
                  contratosAtivosRange.length === 0,
                  <Card className="p-4">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={contratosAtivosRange}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis allowDecimals={false} {...eixoProps} />
                          <Tooltip {...tooltipProps} labelFormatter={(l) => `Mês: ${l}`} />
                          <Area
                            type="monotone"
                            dataKey="ativos"
                            name="Contratos ativos"
                            stroke={CORES_SERIE[0]}
                            fill={CORES_SERIE[0]}
                            fillOpacity={0.15}
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                )}
              </Secao>

              <Secao
                titulo="Quanto o booking variou de um mês para o outro? (%)"
                descricao="Booking = MRR novo do mês × 12 (contrato assumido em 12 meses)."
                className="lg:col-span-2"
              >
                {blocoGrafico(
                  ["contratos"],
                  bookingVariacaoChartRange.length === 0,
                  <Card className="p-4">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bookingVariacaoChartRange}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis tickFormatter={(v) => `${v}%`} {...eixoProps} />
                          <Tooltip
                            {...tooltipProps}
                            formatter={(v: number) => (v == null ? "—" : `${v.toFixed(1)}%`)}
                            labelFormatter={(l) => `Mês: ${l}`}
                          />
                          <Bar dataKey="variacao" name="Variação">
                            {bookingVariacaoChartRange.map((d) => (
                              <Cell
                                key={d.mes}
                                fill={
                                  d.variacao == null
                                    ? COR_NEUTRA
                                    : d.variacao >= 0
                                      ? CORES_SERIE[0]
                                      : COR_NEGATIVO
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                )}
              </Secao>
            </div>
          )}
        </TabsContent>

        {/* ---- Aba 2: Vendas e unidades — MRR e ranking por unidade ---- */}
        <TabsContent value="vendas" className="space-y-6">
          {loading ? (
            <Carregando variante="kpis" />
          ) : (
            <>
              <KpiGrade colunas={4}>
                <KpiCard
                  rotulo="MRR"
                  valor={fmtBRL(kpis.mrr)}
                  estado={indisponivel("recon")?.estado ?? (ultimo ? "ok" : "nao-apurado")}
                  nota={
                    indisponivel("recon")?.nota ??
                    `foto de hoje${kpis.receita > 0 ? ` · ${fmtPct((kpis.mrr / kpis.receita) * 100)} do recebido de ${ultimo ? rotuloMes(ultimo.mes) : "—"}` : ""} · na Base de clientes, ATIVO é "pagou em 90 dias": não bate`
                  }
                  abrir={{
                    onClick: () =>
                      navigate({ to: "/clientes", search: { status: "ATIVO", unidade: "" } }),
                    rotulo: "Abrir contratos ativos",
                  }}
                />
              </KpiGrade>

              <Secao
                titulo="Quais unidades mais vendem por conta própria? (MRR Hunter, R$)"
                descricao={`Ignora o filtro de unidade: mostra todas as unidades do seu acesso. Só a fração do MRR Hunter com "Unidade de Negócio" preenchida no Pipedrive (ver nota da tabela na aba Financeiro).`}
              >
                {blocoGrafico(
                  ["contratos", "recon"],
                  rankingHunterData.length === 0,
                  <Card className="p-4">
                    <div style={{ height: Math.max(180, rankingHunterData.length * 40) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={rankingHunterData}
                          layout="vertical"
                          margin={{ left: 8, right: 48 }}
                        >
                          <CartesianGrid {...gradeProps} vertical horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtMil} {...eixoProps} />
                          <YAxis type="category" dataKey="unidade" width={110} {...eixoProps} />
                          <Tooltip
                            {...tooltipProps}
                            formatter={(v: number) => fmtBRL(v)}
                            labelFormatter={(l) => `${l}`}
                          />
                          <Bar
                            dataKey="hunter"
                            name="MRR Hunter"
                            fill={CORES_SERIE[0]}
                            radius={[0, 4, 4, 0]}
                          >
                            <LabelList
                              dataKey="hunter"
                              position="right"
                              formatter={(v: number) => fmtBRL(v)}
                              style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>,
                )}
              </Secao>
            </>
          )}
        </TabsContent>

        {/* ---- Aba 3: Financeiro — MRR novo × royalties e resumo por unidade ---- */}
        <TabsContent value="financeiro" className="space-y-6">
          {loading ? (
            <Carregando variante="grafico" />
          ) : (
            <>
              {/* Eram três eixos Y num gráfico só (V8). Agora são dois gráficos
                  de um eixo: o acumulado cresce numa escala que esmagava as
                  outras duas séries. */}
              <div className="grid gap-6 lg:grid-cols-2">
                <Secao
                  titulo="MRR novo e royalties recebidos por mês (R$)"
                  descricao="MRR novo = contratos ganhos no mês. Royalties = valor apurado por mês de referência."
                  acoes={<VerDetalheLink to="/unidades/royalties" />}
                >
                  {blocoGrafico(
                      ["contratos"],
                      mrrNovoRoyaltiesRange.length === 0,
                      <Card className="p-4">
                        <div className="h-[240px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={mrrNovoRoyaltiesRange}>
                              <CartesianGrid {...gradeProps} />
                              <XAxis dataKey="label" {...eixoProps} />
                              <YAxis tickFormatter={fmtMil} {...eixoProps} />
                              <Tooltip
                                {...tooltipProps}
                                formatter={(v: number) => fmtBRL(v)}
                                labelFormatter={(l) => `Mês: ${l}`}
                              />
                              <Legend {...legendaProps} />
                              <Line
                                type="monotone"
                                dataKey="mrrNovo"
                                name="MRR novo"
                                stroke={CORES_SERIE[0]}
                                strokeWidth={2}
                                dot={false}
                              />
                              {/* Sem acesso aos royalties a série não entra: seria
                                  uma linha de zeros no lugar de dado ausente. */}
                              {royaltiesData && (
                                <Line
                                  type="monotone"
                                  dataKey="royaltiesRecebido"
                                  name="Royalties recebidos"
                                  stroke={CORES_SERIE[1]}
                                  strokeWidth={2}
                                  dot={false}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>,
                  )}
                  {royaltiesCarregando && (
                    <p className="text-[13px] text-muted-foreground">Carregando royalties…</p>
                  )}
                  {royaltiesError &&
                    (royaltiesSemPermissao ? (
                      <EstadoSemAcesso oQueFalta="view.unidades_rede" />
                    ) : (
                      <EstadoErro
                        titulo="Royalties não carregaram"
                        detalhe={`apuração de royalties: ${royaltiesError.message}`}
                        tentarNovamente={() => void recarregarRoyalties()}
                      />
                    ))}
                </Secao>

                <Secao
                  titulo="Quanto MRR novo a rede acumulou? (R$)"
                  descricao="MRR acumulado: soma do MRR novo desde o primeiro contrato ganho, cortada no período."
                >
                  {blocoGrafico(
                    ["contratos"],
                    mrrNovoRoyaltiesRange.length === 0,
                    <Card className="p-4">
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={mrrNovoRoyaltiesRange}>
                            <CartesianGrid {...gradeProps} />
                            <XAxis dataKey="label" {...eixoProps} />
                            <YAxis tickFormatter={fmtMil} {...eixoProps} />
                            <Tooltip
                              {...tooltipProps}
                              formatter={(v: number) => fmtBRL(v)}
                              labelFormatter={(l) => `Mês: ${l}`}
                            />
                            <Line
                              type="monotone"
                              dataKey="mrrAcumulado"
                              name="MRR acumulado"
                              stroke={CORES_SERIE[0]}
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>,
                  )}
                </Secao>
              </div>

              {/* Resumo por unidade — também é o ranking de melhores/piores unidades */}
              <Secao
                titulo="Como cada unidade está hoje?"
                descricao={
                  <>
                    Foto de hoje: ignora o período. Matriz/Hunter = MRR de contratos ativos hoje,
                    por origem (Matriz = leads roteados pelo Inside Sales; Hunter = vendas fechadas
                    direto pela unidade, pipe Sócios) — juntos devem bater com o MRR atual da
                    linha. Mix mais Hunter é lido como positivo (autossuficiência comercial).
                    Oportunidade/Contingência vêm da Auditoria Interna (fiscal), ver{" "}
                    <Link to="/auditoria-interna" className="text-primary-text underline">
                      detalhe
                    </Link>
                    .
                  </>
                }
              >
                {erros.recon ? (
                  <EstadoErro
                    titulo="Fonte indisponível"
                    detalhe={NOME_FONTE.recon}
                    tentarNovamente={tentarDeNovo}
                  />
                ) : (
                  <Card className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unidade</TableHead>
                          <TableHead className="text-right">Contratos ativos</TableHead>
                          <TableHead className="text-right">MRR atual</TableHead>
                          <TableHead className="text-right">ARPA por contrato</TableHead>
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
                              <TableCell className="num text-right">{u.contratos || "—"}</TableCell>
                              <TableCell className="num text-right">{fmtBRL(u.mrr)}</TableCell>
                              <TableCell className="num text-right">
                                {u.contratos > 0 ? fmtBRL(u.mrr / u.contratos) : "—"}
                              </TableCell>
                              <TableCell className="num text-right">
                                {erros.contratos ? (
                                  <CelulaIndisponivel />
                                ) : (
                                  fmtBRL(vendasMatrizPorUnidade.get(u.unidade) ?? 0)
                                )}
                              </TableCell>
                              <TableCell className="num text-right">
                                {erros.contratos ? (
                                  <CelulaIndisponivel />
                                ) : (
                                  fmtBRL(vendasHunterPorUnidade.get(u.unidade) ?? 0)
                                )}
                              </TableCell>
                              <TableCell className="num text-right">
                                {erros.contratos ? (
                                  <CelulaIndisponivel />
                                ) : mix != null ? (
                                  <span className="font-semibold text-success">{fmtPct(mix)}</span>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="num text-right text-success">
                                {erros.auditoria ? (
                                  <CelulaIndisponivel />
                                ) : aud.oportunidade > 0 ? (
                                  fmtBRL(aud.oportunidade)
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="num text-right text-warning">
                                {erros.auditoria ? (
                                  <CelulaIndisponivel />
                                ) : aud.contingencia > 0 ? (
                                  fmtBRL(aud.contingencia)
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {byUnidade.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                              Nenhuma unidade com dado neste recorte.
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
                            {vendasSemUnidade.count} contrato
                            {vendasSemUnidade.count === 1 ? "" : "s"} ativo
                            {vendasSemUnidade.count === 1 ? "" : "s"} do pipe Sócios (
                            {fmtBRL(vendasSemUnidade.mrr)}
                            {pctSemUnidade != null ? `, ${fmtPct(pctSemUnidade, 0)} do MRR Hunter` : ""})
                            sem "Unidade de Negócio" preenchida no Pipedrive — ignorados nas colunas
                            Matriz/Hunter acima (decisão de 11/08/2026, não rateados nem mostrados
                            numa linha "sem unidade"). A coluna Hunter da tabela hoje só mostra a
                            parte que tem unidade atribuída — o volume real de vendas por sócio é
                            maior. Precisa corrigir direto no card do Pipedrive.
                          </div>
                        );
                      })()}
                  </Card>
                )}
              </Secao>
            </>
          )}
        </TabsContent>

        {/* ---- Aba 4: Qualidade e CS — churn e auditoria ---- */}
        <TabsContent value="qualidade" className="space-y-6">
          {loading ? (
            <Carregando variante="kpis" />
          ) : (
            // Churn sem tom fixo (N9): não há régua de churn declarada nesta
            // tela, então o número fica neutro. A auditoria fiscal, que era um
            // card local com dois valores, vira dois KpiCard.
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="Churn de receita"
                valor={churnStats.churnReceitaPct != null ? fmtPct(churnStats.churnReceitaPct) : "—"}
                estado={
                  churnKpi?.estado ?? (churnStats.churnReceitaPct != null ? "ok" : "nao-apurado")
                }
                nota={
                  churnKpi?.nota ??
                  `${fmtBRL(churnStats.churnedMrr)} em MRR perdido · o Painel de CS abre sem a unidade: não bate`
                }
                abrir={{ href: "/painel-cs", rotulo: "Abrir Painel de CS" }}
              />
              <KpiCard
                rotulo="Churn de logo"
                valor={churnStats.churnLogoPct != null ? fmtPct(churnStats.churnLogoPct) : "—"}
                estado={churnKpi?.estado ?? (churnStats.churnLogoPct != null ? "ok" : "nao-apurado")}
                nota={
                  churnKpi?.nota ??
                  `${churnStats.churnedCount} cliente${churnStats.churnedCount === 1 ? "" : "s"} perdido${churnStats.churnedCount === 1 ? "" : "s"} · base de todos os tempos · o Painel de CS abre sem a unidade: não bate`
                }
                abrir={{ href: "/painel-cs", rotulo: "Abrir Painel de CS" }}
              />
              <KpiCard
                rotulo="Oportunidade (auditoria interna)"
                valor={fmtBRL(auditoriaStats.oportunidade)}
                estado={auditoriaKpi?.estado ?? "ok"}
                nota={auditoriaKpi?.nota ?? "oportunidades fiscais apontadas nas auditorias"}
                abrir={{ href: "/auditoria-interna", rotulo: "Abrir Auditoria interna" }}
              />
              <KpiCard
                rotulo="Contingência (auditoria interna)"
                valor={fmtBRL(auditoriaStats.contingencia)}
                estado={auditoriaKpi?.estado ?? "ok"}
                nota={auditoriaKpi?.nota ?? "contingências fiscais apontadas nas auditorias"}
                abrir={{ href: "/auditoria-interna", rotulo: "Abrir Auditoria interna" }}
              />
            </KpiGrade>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
