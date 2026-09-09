import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, RefreshCw, AlertTriangle, Gauge, Undo2, Handshake, Landmark } from "lucide-react";
import { toast } from "sonner";
import { syncAuditoriaInterna } from "@/lib/auditoria-interna.functions";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FiltroTexto,
  FiltroNumero,
  type DirOrdem,
  type FaixaNumerica,
  type Ordem,
} from "@/components/auditoria-interna/column-filter";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/auditoria-interna")({
  component: AuditoriaInternaPage,
});

type Auditoria = {
  pipefy_card_id: string;
  empresa_auditada: string | null;
  unidade: string | null;
  fase_atual: string | null;
  tipo_projeto: string | null;
  complexidade_fiscal: string | null;
  tipo_empresa: string | null;
  setor_atuacao: string | null;
  equipe_designada: string | null;
  prazo_atual: string | null;
  data_conclusao: string | null;
  auditoria_finalizada: boolean | null;
  classificacao_apontamentos: string | null;
  oportunidades_valor: number | null;
  contingencias_valor: number | null;
  faturamento_periodo: number | null;
};

const NA = "—";
const FASES_CONCLUIDAS = new Set(["Projeto Concluído", "Reforma Tributária Concluida", "Solicitações Comerciais"]);
// Fase que caracteriza uma auditoria efetivamente realizada (pipe 307181077).
const FASE_AUDITORIA_REALIZADA = "Projeto Concluído";
const FASE_COLORS = ["hsl(var(--primary))", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444"];

// Valor do campo "Tipo de Projeto" no Pipefy -> como apresentamos na tela e
// qual o objetivo de negócio de cada tipo (ver pipe 307181077, campo
// tipo_de_projeto). Ordem fixa — usada tanto nas abas quanto nas cores do
// gráfico "Projetos por tipo".
const TIPO_ORDER = ["Auditoria", "Contas Perdidas", "Solicitações Comerciais", "Reforma Tributária"] as const;
type TipoKey = (typeof TIPO_ORDER)[number];

const TIPO_LABEL: Record<TipoKey, string> = {
  Auditoria: "Auditoria",
  "Contas Perdidas": "Recuperação de Contas",
  "Solicitações Comerciais": "Apoio a Grandes Contas",
  "Reforma Tributária": "Reforma Tributária",
};

const TIPO_DESCRICAO: Record<TipoKey, string> = {
  Auditoria: "Auditoria fiscal dos projetos das unidades (ICMS, PIS/COFINS, Reforma Tributária).",
  "Contas Perdidas": "Apoio ao comercial para recuperar contas perdidas, trazendo um achado fiscal como gancho.",
  "Solicitações Comerciais": "Apoio ao comercial para fechar grandes contas, trazendo um insight fiscal.",
  "Reforma Tributária": "Execução do produto de Reforma Tributária para os clientes.",
};

const TIPO_COLOR: Record<TipoKey, string> = {
  Auditoria: "#6366f1",
  "Contas Perdidas": "#f59e0b",
  "Solicitações Comerciais": "#10b981",
  "Reforma Tributária": "#8b5cf6",
};

const TIPO_ICON: Record<TipoKey, typeof ClipboardCheck> = {
  Auditoria: ClipboardCheck,
  "Contas Perdidas": Undo2,
  "Solicitações Comerciais": Handshake,
  "Reforma Tributária": Landmark,
};

function fmtMoney(v: number | null | undefined) {
  if (!v) return fmtMoneyExato(0);
  return fmtMoneyExato(v);
}

function fmtMoneyExato(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// Exposição costuma ser um percentual pequeno; abaixo de 10% ganha uma casa
// decimal para não achatar tudo em "0%".
function fmtPct(v: number) {
  const p = v * 100;
  return `${p.toLocaleString("pt-BR", { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;
}

function fmtDate(s: string | null) {
  if (!s) return NA;
  const d = new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

function isConcluida(r: Auditoria): boolean {
  return !!r.auditoria_finalizada || FASES_CONCLUIDAS.has(r.fase_atual ?? "");
}

function diasAtraso(r: Auditoria): number | null {
  if (isConcluida(r) || !r.prazo_atual) return null;
  const prazo = new Date(r.prazo_atual).getTime();
  const agora = Date.now();
  if (isNaN(prazo) || prazo >= agora) return null;
  return Math.floor((agora - prazo) / (1000 * 60 * 60 * 24));
}

// ============ Blocos reutilizados entre a Visão Geral e as abas por tipo ============

function KpiCards({ rows, labelTotal }: { rows: Auditoria[]; labelTotal: string }) {
  const kpis = useMemo(() => {
    let concluidas = 0;
    let atrasadas = 0;
    let oportunidades = 0;
    let contingencias = 0;
    for (const r of rows) {
      if (isConcluida(r)) concluidas += 1;
      if (diasAtraso(r) != null) atrasadas += 1;
      oportunidades += r.oportunidades_valor ?? 0;
      contingencias += r.contingencias_valor ?? 0;
    }
    return {
      total: rows.length,
      emAndamento: rows.length - concluidas,
      concluidas,
      atrasadas,
      oportunidades,
      contingencias,
    };
  }, [rows]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">{labelTotal}</div>
        <div className="text-2xl font-bold">{kpis.total}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Em andamento</div>
        <div className="text-2xl font-bold">{kpis.emAndamento}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Concluídas</div>
        <div className="text-2xl font-bold text-emerald-600">{kpis.concluidas}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Prazos vencidos</div>
        <div className={cn("text-2xl font-bold", kpis.atrasadas > 0 && "text-destructive")}>{kpis.atrasadas}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Oportunidades identificadas</div>
        <div className="text-xl font-bold text-emerald-600">{fmtMoney(kpis.oportunidades)}</div>
        <div className="text-[11px] text-muted-foreground">estimado, extraído dos relatórios</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Contingências/riscos identificados</div>
        <div className="text-xl font-bold text-amber-600">{fmtMoney(kpis.contingencias)}</div>
        <div className="text-[11px] text-muted-foreground">estimado, extraído dos relatórios</div>
      </Card>
    </div>
  );
}

function ResumoPorUnidade({ rows }: { rows: Auditoria[] }) {
  const porUnidade = useMemo(() => {
    const map = new Map<string, { unidade: string; realizadas: number; oportunidades: number; contingencias: number }>();
    for (const r of rows) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, realizadas: 0, oportunidades: 0, contingencias: 0 };
      if (r.fase_atual === FASE_AUDITORIA_REALIZADA) g.realizadas += 1;
      g.oportunidades += r.oportunidades_valor ?? 0;
      g.contingencias += r.contingencias_valor ?? 0;
      map.set(u, g);
    }
    return Array.from(map.values()).sort((a, b) => b.realizadas - a.realizadas);
  }, [rows]);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Resumo por unidade</div>
        <div className="text-[11px] text-muted-foreground">
          Auditorias realizadas = cards na fase &ldquo;{FASE_AUDITORIA_REALIZADA}&rdquo; do Pipefy
        </div>
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-sm">
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              <TableHead className="bg-background">Unidade</TableHead>
              <TableHead className="bg-background text-right">Auditorias realizadas</TableHead>
              <TableHead className="bg-background text-right">Oportunidades</TableHead>
              <TableHead className="bg-background text-right">Contingências</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {porUnidade.map((u) => (
              <TableRow key={u.unidade}>
                <TableCell className="font-medium">{u.unidade}</TableCell>
                <TableCell className="text-right">{u.realizadas}</TableCell>
                <TableCell className="text-right text-emerald-600">{fmtMoney(u.oportunidades)}</TableCell>
                <TableCell className="text-right text-amber-600">{fmtMoney(u.contingencias)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </Card>
  );
}

function Rankings({ rows }: { rows: Auditoria[] }) {
  const porUnidade = useMemo(() => {
    const map = new Map<string, { unidade: string; oportunidades: number; contingencias: number }>();
    for (const r of rows) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, oportunidades: 0, contingencias: 0 };
      g.oportunidades += r.oportunidades_valor ?? 0;
      g.contingencias += r.contingencias_valor ?? 0;
      map.set(u, g);
    }
    return Array.from(map.values());
  }, [rows]);

  const rankingOportunidade = useMemo(
    () => porUnidade.filter((u) => u.oportunidades > 0).sort((a, b) => b.oportunidades - a.oportunidades),
    [porUnidade],
  );
  const rankingContingencia = useMemo(
    () => porUnidade.filter((u) => u.contingencias > 0).sort((a, b) => b.contingencias - a.contingencias),
    [porUnidade],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Ranking de unidades — maior volume de oportunidade</div>
        </div>
        {rankingOportunidade.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhuma oportunidade identificada ainda.</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background w-10">#</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background text-right">Oportunidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingOportunidade.map((u, i) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-semibold">{fmtMoney(u.oportunidades)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Ranking de unidades — maior volume de contingência</div>
        </div>
        {rankingContingencia.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhuma contingência identificada ainda.</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background w-10">#</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background text-right">Contingências</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingContingencia.map((u, i) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right text-amber-600 font-semibold">{fmtMoney(u.contingencias)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AtencaoPrazos({ rows }: { rows: Auditoria[] }) {
  const atencao = useMemo(
    () =>
      rows
        .map((r) => ({ r, dias: diasAtraso(r) }))
        .filter((x): x is { r: Auditoria; dias: number } => x.dias != null)
        .sort((a, b) => b.dias - a.dias),
    [rows],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        {atencao.length > 0 && <AlertTriangle className="h-4 w-4 text-destructive" />}
        <div className="text-sm font-semibold">Atenção — prazos vencidos</div>
      </div>
      {atencao.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum caso em andamento com prazo vencido.</div>
      ) : (
        <div className="overflow-auto max-h-[320px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Empresa</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Fase atual</TableHead>
                <TableHead className="bg-background text-right">Prazo</TableHead>
                <TableHead className="bg-background text-right">Dias em atraso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {atencao.map(({ r, dias }) => (
                <TableRow key={r.pipefy_card_id}>
                  <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{r.fase_atual ?? NA}</TableCell>
                  <TableCell className="text-right">{fmtDate(r.prazo_atual)}</TableCell>
                  <TableCell className="text-right text-destructive font-semibold">{dias}d</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

type ColunaAchado = "empresa" | "unidade" | "classificacao" | "oportunidade" | "contingencia" | "total";

function AchadosFiscais({ rows }: { rows: Auditoria[] }) {
  const [filtrosTexto, setFiltrosTexto] = useState<Record<string, string[]>>({});
  const [filtrosNumero, setFiltrosNumero] = useState<Record<string, FaixaNumerica>>({});
  const [ordem, setOrdem] = useState<Ordem<ColunaAchado>>({ coluna: "total", dir: "desc" });

  // Universo do bloco: só apontamentos classificados como Alta ou Média.
  const base = useMemo(
    () =>
      rows
        .filter((r) => {
          const c = (r.classificacao_apontamentos ?? "").toLowerCase();
          return c.includes("alta") || c.includes("média") || c.includes("media");
        })
        .map((r) => ({
          r,
          empresa: r.empresa_auditada ?? NA,
          unidade: r.unidade ?? NA,
          classificacao: r.classificacao_apontamentos ?? NA,
          oportunidade: r.oportunidades_valor ?? 0,
          contingencia: r.contingencias_valor ?? 0,
          total: (r.oportunidades_valor ?? 0) + (r.contingencias_valor ?? 0),
        })),
    [rows],
  );

  // As opções de cada filtro saem sempre da base inteira, para que desmarcar um
  // valor não faça as demais opções sumirem da lista.
  const opcoes = useMemo(() => {
    const coletar = (get: (b: (typeof base)[number]) => string) =>
      Array.from(new Set(base.map(get))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      empresa: coletar((b) => b.empresa),
      unidade: coletar((b) => b.unidade),
      classificacao: coletar((b) => b.classificacao),
    };
  }, [base]);

  const filtroTextoAtivo = (col: string) => (filtrosTexto[col] ?? []).length > 0;
  const faixaDe = (col: string): FaixaNumerica => filtrosNumero[col] ?? { min: null, max: null };
  const dirDe = (col: ColunaAchado) => (ordem?.coluna === col ? ordem.dir : null);
  const ordenarPor = (col: ColunaAchado) => (dir: DirOrdem) => setOrdem({ coluna: col, dir });
  const setTexto = (col: string) => (valores: string[]) =>
    setFiltrosTexto((f) => ({ ...f, [col]: valores }));
  const setNumero = (col: string) => (faixa: FaixaNumerica) =>
    setFiltrosNumero((f) => ({ ...f, [col]: faixa }));

  const algumFiltroAtivo =
    Object.values(filtrosTexto).some((v) => v.length > 0) ||
    Object.values(filtrosNumero).some((f) => f.min != null || f.max != null);

  const maioresAchados = useMemo(() => {
    const passaTexto = (col: "empresa" | "unidade" | "classificacao", valor: string) => {
      const sel = filtrosTexto[col] ?? [];
      return sel.length === 0 || sel.includes(valor);
    };
    const passaNumero = (col: "oportunidade" | "contingencia" | "total", valor: number) => {
      const { min, max } = filtrosNumero[col] ?? { min: null, max: null };
      if (min != null && valor < min) return false;
      if (max != null && valor > max) return false;
      return true;
    };

    const filtrados = base.filter(
      (b) =>
        passaTexto("empresa", b.empresa) &&
        passaTexto("unidade", b.unidade) &&
        passaTexto("classificacao", b.classificacao) &&
        passaNumero("oportunidade", b.oportunidade) &&
        passaNumero("contingencia", b.contingencia) &&
        passaNumero("total", b.total),
    );

    if (!ordem) return filtrados;
    const { coluna, dir } = ordem;
    const sinal = dir === "asc" ? 1 : -1;
    return [...filtrados].sort((a, b) => {
      const va = a[coluna];
      const vb = b[coluna];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sinal;
      return String(va).localeCompare(String(vb), "pt-BR") * sinal;
    });
  }, [base, filtrosTexto, filtrosNumero, ordem]);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Achados fiscais — classificação Alta ou Média</div>
          <div className="text-[11px] text-muted-foreground">
            {algumFiltroAtivo
              ? `${maioresAchados.length} de ${base.length} achados`
              : `${base.length} achados`}
          </div>
        </div>
        {algumFiltroAtivo && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setFiltrosTexto({});
              setFiltrosNumero({});
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
      {base.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum apontamento classificado como Alta ou Média ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">
                  <FiltroTexto
                    titulo="Empresa"
                    opcoes={opcoes.empresa}
                    selecionados={filtrosTexto.empresa ?? []}
                    onChange={setTexto("empresa")}
                    dirOrdem={dirDe("empresa")}
                    onOrdenar={ordenarPor("empresa")}
                  />
                </TableHead>
                <TableHead className="bg-background">
                  <FiltroTexto
                    titulo="Unidade"
                    opcoes={opcoes.unidade}
                    selecionados={filtrosTexto.unidade ?? []}
                    onChange={setTexto("unidade")}
                    dirOrdem={dirDe("unidade")}
                    onOrdenar={ordenarPor("unidade")}
                  />
                </TableHead>
                <TableHead className="bg-background">
                  <FiltroTexto
                    titulo="Classificação"
                    opcoes={opcoes.classificacao}
                    selecionados={filtrosTexto.classificacao ?? []}
                    onChange={setTexto("classificacao")}
                    dirOrdem={dirDe("classificacao")}
                    onOrdenar={ordenarPor("classificacao")}
                  />
                </TableHead>
                <TableHead className="bg-background text-right">
                  <FiltroNumero
                    titulo="Oportunidade"
                    faixa={faixaDe("oportunidade")}
                    onChange={setNumero("oportunidade")}
                    dirOrdem={dirDe("oportunidade")}
                    onOrdenar={ordenarPor("oportunidade")}
                  />
                </TableHead>
                <TableHead className="bg-background text-right">
                  <FiltroNumero
                    titulo="Contingência"
                    faixa={faixaDe("contingencia")}
                    onChange={setNumero("contingencia")}
                    dirOrdem={dirDe("contingencia")}
                    onOrdenar={ordenarPor("contingencia")}
                  />
                </TableHead>
                <TableHead className="bg-background text-right">
                  <FiltroNumero
                    titulo="Total"
                    faixa={faixaDe("total")}
                    onChange={setNumero("total")}
                    dirOrdem={dirDe("total")}
                    onOrdenar={ordenarPor("total")}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maioresAchados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum achado corresponde aos filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : (
                maioresAchados.map((a) => (
                  <TableRow key={a.r.pipefy_card_id}>
                    <TableCell className="font-medium">{a.empresa}</TableCell>
                    <TableCell>{a.unidade}</TableCell>
                    <TableCell>{a.classificacao}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmtMoney(a.r.oportunidades_valor)}</TableCell>
                    <TableCell className="text-right text-amber-600">{fmtMoney(a.r.contingencias_valor)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(a.total)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SaudeDaCarteira({ rows }: { rows: Auditoria[] }) {
  const carteira = useMemo(() => {
    const map = new Map<
      string,
      {
        unidade: string;
        realizadas: number;
        comAchado: number;
        oportunidades: number;
        contingencias: number;
        faturamento: number;
        achadoComFat: number;
      }
    >();
    for (const r of rows) {
      // Só auditoria fiscal entra aqui. Reforma Tributária, Apoio a Grandes Contas
      // e Recuperação de Contas são outros produtos e não entram no achado da carteira.
      if (r.tipo_projeto !== "Auditoria") continue;
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? {
        unidade: u,
        realizadas: 0,
        comAchado: 0,
        oportunidades: 0,
        contingencias: 0,
        faturamento: 0,
        achadoComFat: 0,
      };
      if (r.fase_atual === FASE_AUDITORIA_REALIZADA) {
        g.realizadas += 1;
        if ((r.oportunidades_valor ?? 0) > 0 || (r.contingencias_valor ?? 0) > 0) g.comAchado += 1;
      }
      g.oportunidades += r.oportunidades_valor ?? 0;
      g.contingencias += r.contingencias_valor ?? 0;
      // Exposição só fecha se numerador e denominador vierem da mesma auditoria:
      // card sem "Faturamento do Período Analisado" fica de fora dos dois lados.
      if (r.faturamento_periodo != null) {
        g.faturamento += r.faturamento_periodo;
        g.achadoComFat += (r.oportunidades_valor ?? 0) + (r.contingencias_valor ?? 0);
      }
      map.set(u, g);
    }
    const lista = Array.from(map.values()).map((g) => {
      const encontrado = g.oportunidades + g.contingencias;
      return {
        ...g,
        // O número da unidade é o achado total: oportunidade + contingência.
        encontrado,
        // Exposição: quanto do faturamento auditado virou achado fiscal.
        exposicao: g.faturamento > 0 ? g.achadoComFat / g.faturamento : null,
        taxaAchado: g.realizadas > 0 ? g.comAchado / g.realizadas : null,
      };
    });
    // Sem achado ainda vai para o fim — é backlog, não desempenho ruim.
    return lista.sort((a, b) => {
      if (a.encontrado === 0 && b.encontrado === 0) return a.unidade.localeCompare(b.unidade, "pt-BR");
      return b.encontrado - a.encontrado;
    });
  }, [rows]);

  const maxEncontrado = useMemo(
    () => Math.max(0, ...carteira.map((c) => c.encontrado)),
    [carteira],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Saúde da carteira</div>
        <div className="text-[11px] text-muted-foreground">
          Achado total (oportunidade + contingência) e quanto ele representa do faturamento auditado
        </div>
        <div className="text-[11px] text-muted-foreground">
          Só projetos do tipo Auditoria — Reforma Tributária e apoio comercial ficam de fora.
        </div>
      </div>
      {carteira.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhuma unidade na carteira ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[320px] divide-y">
          {carteira.map((c) => {
            const largura = maxEncontrado > 0 ? (c.encontrado / maxEncontrado) * 100 : 0;
            const fatiaOport = c.encontrado > 0 ? (c.oportunidades / c.encontrado) * 100 : 0;
            return (
              <div key={c.unidade} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{c.unidade}</span>
                  </div>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <div className="text-sm font-semibold">
                      {c.encontrado === 0 ? (
                        <span className="text-muted-foreground font-normal">sem achado</span>
                      ) : (
                        fmtMoney(c.encontrado)
                      )}
                    </div>
                    <div
                      className="text-sm font-semibold text-sky-600 tabular-nums"
                      title="Exposição: achado fiscal dividido pelo faturamento do período analisado, contando só as auditorias com esse campo preenchido."
                    >
                      {c.exposicao == null ? (
                        <span className="text-[11px] font-normal text-muted-foreground">sem faturamento</span>
                      ) : (
                        <>
                          {fmtPct(c.exposicao)}
                          <span className="text-[11px] font-normal text-muted-foreground"> exposição</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barra: comprimento = achado total; divisão = oportunidade x contingência. */}
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="flex h-full" style={{ width: `${largura}%` }}>
                    <div className="h-full bg-emerald-500" style={{ width: `${fatiaOport}%` }} />
                    <div className="h-full bg-amber-500" style={{ width: `${100 - fatiaOport}%` }} />
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">{c.realizadas}</span> realizadas
                  </span>
                  <span>
                    {c.taxaAchado == null ? "—" : `${Math.round(c.taxaAchado * 100)}% com achado`}
                  </span>
                  <span className="text-emerald-600">{fmtMoney(c.oportunidades)} oport.</span>
                  <span className="text-amber-600">{fmtMoney(c.contingencias)} conting.</span>
                  {c.faturamento > 0 && <span>{fmtMoney(c.faturamento)} faturamento auditado</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function PorFaseChart({ rows }: { rows: Auditoria[] }) {
  const porFase = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const f = r.fase_atual ?? NA;
      map.set(f, (map.get(f) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Projetos por fase</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={porFase} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {porFase.map((_, i) => (<Cell key={i} fill={FASE_COLORS[i % FASE_COLORS.length]} />))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CasosTable({ rows }: { rows: Auditoria[] }) {
  const casos = useMemo(
    () => [...rows].sort((a, b) => (a.empresa_auditada ?? "").localeCompare(b.empresa_auditada ?? "")),
    [rows],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Casos</div>
      </div>
      {casos.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum caso deste tipo ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Empresa</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Fase atual</TableHead>
                <TableHead className="bg-background">Classificação</TableHead>
                <TableHead className="bg-background text-right">Oportunidade</TableHead>
                <TableHead className="bg-background text-right">Contingência</TableHead>
                <TableHead className="bg-background text-right">Conclusão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {casos.map((r) => (
                <TableRow key={r.pipefy_card_id}>
                  <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{r.fase_atual ?? NA}</TableCell>
                  <TableCell>{r.classificacao_apontamentos ?? NA}</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmtMoney(r.oportunidades_valor)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmtMoney(r.contingencias_valor)}</TableCell>
                  <TableCell className="text-right">{fmtDate(r.data_conclusao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ============ Visão Geral ============

function ProjetosPorTipo({ rows }: { rows: Auditoria[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const t = r.tipo_projeto ?? NA;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return TIPO_ORDER.map((t) => ({ name: TIPO_LABEL[t], value: map.get(t) ?? 0, color: TIPO_COLOR[t] }));
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Projetos por tipo</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={150} />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((d) => (<Cell key={d.name} fill={d.color} />))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function FinalizadasPorMes({ rows }: { rows: Auditoria[] }) {
  const { data, semData } = useMemo(() => {
    const map = new Map<string, number>();
    let concluidas = 0;
    let comData = 0;
    for (const r of rows) {
      if (!isConcluida(r)) continue;
      concluidas += 1;
      if (!r.data_conclusao) continue;
      const d = new Date(r.data_conclusao);
      if (isNaN(d.getTime())) continue;
      comData += 1;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const data = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [y, m] = key.split("-");
        const name = new Date(Number(y), Number(m) - 1, 1)
          .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
          .replace(".", "");
        return { name, value };
      });
    return { data, semData: concluidas - comData };
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Finalizadas por mês</div>
      <div className="h-72">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum caso finalizado com data de conclusão registrada.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
              <Tooltip />
              <Bar dataKey="value" name="Finalizadas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {semData > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {semData} caso(s) concluído(s) sem data de conclusão registrada no Pipefy — não aparecem no gráfico.
        </div>
      )}
    </Card>
  );
}

function VisaoGeral({ rows }: { rows: Auditoria[] }) {
  return (
    <div className="space-y-4">
      <KpiCards rows={rows} labelTotal="Total de projetos" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIPO_ORDER.map((t) => {
          const Icon = TIPO_ICON[t];
          const total = rows.filter((r) => r.tipo_projeto === t).length;
          return (
            <Card key={t} className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {TIPO_LABEL[t]}
              </div>
              <div className="text-2xl font-bold">{total}</div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProjetosPorTipo rows={rows} />
        <FinalizadasPorMes rows={rows} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResumoPorUnidade rows={rows} />
        <SaudeDaCarteira rows={rows} />
      </div>

      <Rankings rows={rows} />
      <AtencaoPrazos rows={rows} />
      <AchadosFiscais rows={rows} />
    </div>
  );
}

function TipoTab({ rows, tipo }: { rows: Auditoria[]; tipo: TipoKey }) {
  const filtradas = useMemo(() => rows.filter((r) => r.tipo_projeto === tipo), [rows, tipo]);
  const volumoso = tipo === "Auditoria";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TIPO_DESCRICAO[tipo]}</p>
      <KpiCards rows={filtradas} labelTotal={volumoso ? "Total de auditorias" : "Total de casos"} />
      {volumoso ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PorFaseChart rows={filtradas} />
            <ResumoPorUnidade rows={filtradas} />
          </div>
          <Rankings rows={filtradas} />
          <AtencaoPrazos rows={filtradas} />
          <AchadosFiscais rows={filtradas} />
        </>
      ) : (
        <CasosTable rows={filtradas} />
      )}
    </div>
  );
}

function AuditoriaInternaPage() {
  const [rows, setRows] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("auditorias_internas")
      .select(
        "pipefy_card_id,empresa_auditada,unidade,fase_atual,tipo_projeto,complexidade_fiscal,tipo_empresa,setor_atuacao,equipe_designada,prazo_atual,data_conclusao,auditoria_finalizada,classificacao_apontamentos,oportunidades_valor,contingencias_valor,faturamento_periodo",
      )
      .limit(5000);
    if (data) setRows(data as Auditoria[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const syncFn = useServerFn(syncAuditoriaInterna);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      await carregar();
      toast.success(`Auditoria Interna atualizada do Pipefy: ${res.total} card(s).`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      toast.error(msg);
    },
  });

  const contagemPorTipo = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.tipo_projeto ?? NA, (map.get(r.tipo_projeto ?? NA) ?? 0) + 1);
    return map;
  }, [rows]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Auditoria Interna</h1>
            <p className="text-sm text-muted-foreground">
              Visão executiva dos projetos do time fiscal — auditoria, apoio ao comercial e reforma tributária
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
          Forçar atualização
        </Button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-16">Carregando…</div>
      ) : (
        <Tabs defaultValue="geral">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="geral" className="gap-1.5">
              <Gauge className="h-3.5 w-3.5" />
              Visão Geral
            </TabsTrigger>
            {TIPO_ORDER.map((t) => {
              const Icon = TIPO_ICON[t];
              return (
                <TabsTrigger key={t} value={t} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {TIPO_LABEL[t]} ({contagemPorTipo.get(t) ?? 0})
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="geral" className="mt-4">
            <VisaoGeral rows={rows} />
          </TabsContent>
          {TIPO_ORDER.map((t) => (
            <TabsContent key={t} value={t} className="mt-4">
              <TipoTab rows={rows} tipo={t} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
