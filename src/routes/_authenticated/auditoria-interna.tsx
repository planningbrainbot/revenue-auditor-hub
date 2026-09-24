import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ClipboardCheck,
  ExternalLink,
  Handshake,
  Landmark,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Search,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { syncAuditoriaInterna } from "@/lib/auditoria-interna.functions";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FiltroTexto,
  FiltroNumero,
  type DirOrdem,
  type FaixaNumerica,
  type Ordem,
} from "@/components/auditoria-interna/column-filter";
import { BotaoAtualizarPipefy } from "@/components/painel-cs/botao-atualizar";
import { cn } from "@/lib/utils";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
} from "@/components/planning";

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
  synced_at: string | null;
};

const NA = "—";
const FASES_CONCLUIDAS = new Set(["Projeto Concluído", "Reforma Tributária Concluida", "Solicitações Comerciais"]);
// Fase que caracteriza uma auditoria efetivamente realizada (pipe 307181077).
const FASE_AUDITORIA_REALIZADA = "Projeto Concluído";

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
  Auditoria: CORES_SERIE[0],
  "Contas Perdidas": CORES_SERIE[1],
  "Solicitações Comerciais": CORES_SERIE[2],
  "Reforma Tributária": CORES_SERIE[3],
};

const TIPO_ICON: Record<TipoKey, typeof ClipboardCheck> = {
  Auditoria: ClipboardCheck,
  "Contas Perdidas": Undo2,
  "Solicitações Comerciais": Handshake,
  "Reforma Tributária": Landmark,
};

// Aba na URL por slug: o valor do Pipefy tem espaço e acento.
const TIPO_SLUG: Record<TipoKey, string> = {
  Auditoria: "auditoria",
  "Contas Perdidas": "contas-perdidas",
  "Solicitações Comerciais": "solicitacoes-comerciais",
  "Reforma Tributária": "reforma-tributaria",
};
const ABAS = ["geral", ...TIPO_ORDER.map((t) => TIPO_SLUG[t])] as const;
type Aba = string;

function tipoDaAba(aba: Aba): TipoKey | null {
  return TIPO_ORDER.find((t) => TIPO_SLUG[t] === aba) ?? null;
}

// ============ Filtros da tabela de achados na URL (N7) ============

type ColunaAchado = "empresa" | "unidade" | "classificacao" | "oportunidade" | "contingencia" | "total";
const COLUNAS_ACHADO: ColunaAchado[] = ["empresa", "unidade", "classificacao", "oportunidade", "contingencia", "total"];
const COLUNAS_TEXTO = ["empresa", "unidade", "classificacao"] as const;
const COLUNAS_NUMERO = ["oportunidade", "contingencia", "total"] as const;
type ColunaTexto = (typeof COLUNAS_TEXTO)[number];
type ColunaNumero = (typeof COLUNAS_NUMERO)[number];

type FiltrosColunas = Partial<Record<ColunaTexto, string[]> & Record<ColunaNumero, FaixaNumerica>>;

function texto(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" ? v : String(v);
}

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Link colado à mão pode trazer qualquer coisa: o que não tiver o formato
// esperado cai fora, e filtro vazio sai da URL.
function lerColunas(v: unknown): FiltrosColunas | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const bruto = v as Record<string, unknown>;
  const out: FiltrosColunas = {};
  for (const c of COLUNAS_TEXTO) {
    const lista = bruto[c];
    if (Array.isArray(lista) && lista.length > 0) out[c] = lista.map(String);
  }
  for (const c of COLUNAS_NUMERO) {
    const f = bruto[c];
    if (f && typeof f === "object" && !Array.isArray(f)) {
      const { min, max } = f as Record<string, unknown>;
      const faixa = { min: numeroOuNulo(min), max: numeroOuNulo(max) };
      if (faixa.min != null || faixa.max != null) out[c] = faixa;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ORDEM_PADRAO: { coluna: ColunaAchado; dir: DirOrdem } = { coluna: "total", dir: "desc" };

function lerOrdem(v: unknown): string | undefined {
  const s = texto(v);
  if (!s) return undefined;
  const [coluna, dir] = s.split(":");
  if (!COLUNAS_ACHADO.includes(coluna as ColunaAchado) || (dir !== "asc" && dir !== "desc")) return undefined;
  return s;
}

export const Route = createFileRoute("/_authenticated/auditoria-interna")({
  // Todas as chaves são opcionais: os links que já apontam para a tela sem
  // search continuam valendo.
  // Tipo com chaves opcionais: sem isso todo <Link to="/auditoria-interna"> passaria a exigir `search`.
  validateSearch: (
    s: Record<string, unknown>,
  ): { aba?: Aba; busca?: string; colunas?: FiltrosColunas; ordem?: string } => ({
    aba: (ABAS as readonly string[]).includes(s.aba as string) && s.aba !== "geral" ? (s.aba as Aba) : undefined,
    busca: texto(s.busca),
    colunas: lerColunas(s.colunas),
    ordem: lerOrdem(s.ordem),
  }),
  component: AuditoriaInternaPage,
});

// ============ Formatação ============

/** Valor ausente é "—", não "R$ 0" (N4). Zero lido do relatório continua zero. */
function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return NA;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// Exposição costuma ser um percentual pequeno; abaixo de 10% ganha uma casa
// decimal para não achatar tudo em "0%".
function fmtPct(v: number) {
  const p = v * 100;
  return `${p.toLocaleString("pt-BR", { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;
}

// Data pura ("2026-09-01") é lida como dia local: o Date a trataria como
// meia-noite UTC e mostraria o dia anterior no Brasil.
function fmtDate(s: string | null) {
  if (!s) return NA;
  const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = soDia ? new Date(Number(soDia[1]), Number(soDia[2]) - 1, Number(soDia[3])) : new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09" → "set/26", sem passar por Date (fuso). */
function rotuloMes(chave: string) {
  const [a, m] = chave.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/** Chave "aaaa-mm" da data de conclusão, lida da string quando ela já vem assim. */
function chaveMes(s: string): string | null {
  const iso = /^(\d{4})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function semValor(n: number) {
  return `${n} ${n === 1 ? "projeto" : "projetos"} sem valor`;
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

/** Soma que sabe quantos ficaram de fora: `soma` é null quando ninguém tinha valor. */
type Soma = { soma: number | null; sem: number };
const SOMA_VAZIA: Soma = { soma: null, sem: 0 };
function somar(acc: Soma, v: number | null): Soma {
  if (v === null || v === undefined) return { ...acc, sem: acc.sem + 1 };
  return { soma: (acc.soma ?? 0) + v, sem: acc.sem };
}

function linkCard(id: string | null): ReactNode {
  if (!id) return NA;
  return (
    <a
      href={`https://app.pipefy.com/open-cards/${id}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-xs text-primary-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      ver card
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(abre o Pipefy em nova aba)</span>
    </a>
  );
}

const CABECALHO = "bg-background";

// ============ Blocos reutilizados entre a Visão Geral e as abas por tipo ============

function KpiCards({
  rows,
  labelTotal,
  irParaPrazos,
}: {
  rows: Auditoria[];
  labelTotal: string;
  /** Rola até "prazos vencidos" quando a aba tem esse bloco. */
  irParaPrazos?: () => void;
}) {
  const kpis = useMemo(() => {
    let concluidas = 0;
    let atrasadas = 0;
    let oportunidades = SOMA_VAZIA;
    let contingencias = SOMA_VAZIA;
    for (const r of rows) {
      if (isConcluida(r)) concluidas += 1;
      if (diasAtraso(r) != null) atrasadas += 1;
      oportunidades = somar(oportunidades, r.oportunidades_valor);
      contingencias = somar(contingencias, r.contingencias_valor);
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

  const notaValor = (s: Soma) =>
    s.soma === null
      ? "nenhum projeto com valor no relatório"
      : `Σ estimado dos relatórios${s.sem > 0 ? ` · ${semValor(s.sem)}` : ""}`;

  return (
    <KpiGrade colunas={6}>
      <KpiCard rotulo={labelTotal} valor={kpis.total} />
      <KpiCard rotulo="Em andamento" valor={kpis.emAndamento} />
      <KpiCard rotulo="Concluídos (flag ou fase final)" valor={kpis.concluidas} />
      <KpiCard
        rotulo="Prazos vencidos"
        valor={kpis.atrasadas}
        nota="em andamento, com prazo antes de hoje"
        tom={kpis.atrasadas > 0 ? "perigo" : undefined}
        tomRotulo={kpis.atrasadas > 0 ? "cobrar" : undefined}
        abrir={irParaPrazos && kpis.atrasadas > 0 ? { onClick: irParaPrazos, rotulo: "Ver projetos" } : undefined}
      />
      <KpiCard
        rotulo="Oportunidades identificadas"
        valor={fmtMoney(kpis.oportunidades.soma)}
        estado={kpis.oportunidades.soma === null ? "nao-apurado" : "ok"}
        nota={notaValor(kpis.oportunidades)}
      />
      <KpiCard
        rotulo="Contingências/riscos identificados"
        valor={fmtMoney(kpis.contingencias.soma)}
        estado={kpis.contingencias.soma === null ? "nao-apurado" : "ok"}
        nota={notaValor(kpis.contingencias)}
      />
    </KpiGrade>
  );
}

function ResumoPorUnidade({ rows }: { rows: Auditoria[] }) {
  const { porUnidade, semOport, semConting } = useMemo(() => {
    const map = new Map<string, { unidade: string; realizadas: number; oportunidades: Soma; contingencias: Soma }>();
    let semOport = 0;
    let semConting = 0;
    for (const r of rows) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, realizadas: 0, oportunidades: SOMA_VAZIA, contingencias: SOMA_VAZIA };
      if (r.fase_atual === FASE_AUDITORIA_REALIZADA) g.realizadas += 1;
      g.oportunidades = somar(g.oportunidades, r.oportunidades_valor);
      g.contingencias = somar(g.contingencias, r.contingencias_valor);
      if (r.oportunidades_valor == null) semOport += 1;
      if (r.contingencias_valor == null) semConting += 1;
      map.set(u, g);
    }
    return {
      porUnidade: Array.from(map.values()).sort((a, b) => b.realizadas - a.realizadas),
      semOport,
      semConting,
    };
  }, [rows]);

  const faltas = [
    semOport > 0 && `oportunidade: ${semValor(semOport)}`,
    semConting > 0 && `contingência: ${semValor(semConting)}`,
  ].filter(Boolean);

  return (
    <Secao
      titulo="Quanto cada unidade concluiu e achou?"
      descricao={
        <>
          Projetos em &ldquo;{FASE_AUDITORIA_REALIZADA}&rdquo; = cards nessa fase do Pipefy
          {faltas.length > 0 && ` · ${faltas.join(" · ")}`}
        </>
      }
    >
      <Card className="p-0 overflow-hidden">
        <div className="overflow-auto max-h-[320px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className={CABECALHO}>Unidade</TableHead>
                <TableHead className={cn(CABECALHO, "text-right")}>Projetos em &ldquo;{FASE_AUDITORIA_REALIZADA}&rdquo;</TableHead>
                <TableHead className={cn(CABECALHO, "text-right")}>Oportunidades</TableHead>
                <TableHead className={cn(CABECALHO, "text-right")}>Contingências</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porUnidade.map((u) => (
                <TableRow key={u.unidade}>
                  <TableCell className="font-medium">{u.unidade}</TableCell>
                  <TableCell className="num text-right">{u.realizadas}</TableCell>
                  <TableCell className="num text-right text-success">{fmtMoney(u.oportunidades.soma)}</TableCell>
                  <TableCell className="num text-right text-warning">{fmtMoney(u.contingencias.soma)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </Card>
    </Secao>
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

  const bloco = (
    titulo: string,
    rotulo: string,
    lista: { unidade: string; valor: number }[],
    cor: string,
    vazio: string,
  ) => (
    <Secao titulo={titulo} descricao="unidades com valor maior que zero, do maior para o menor">
      <Card className="p-0 overflow-hidden">
        {lista.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">{vazio}</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className={cn(CABECALHO, "w-10")}>#</TableHead>
                  <TableHead className={CABECALHO}>Unidade</TableHead>
                  <TableHead className={cn(CABECALHO, "text-right")}>{rotulo}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((u, i) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="num text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className={cn("num text-right font-semibold", cor)}>{fmtMoney(u.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
    </Secao>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {bloco(
        "Qual unidade achou mais oportunidade?",
        "Oportunidades",
        rankingOportunidade.map((u) => ({ unidade: u.unidade, valor: u.oportunidades })),
        "text-success",
        "Nenhuma oportunidade identificada ainda.",
      )}
      {bloco(
        "Qual unidade tem mais contingência?",
        "Contingências",
        rankingContingencia.map((u) => ({ unidade: u.unidade, valor: u.contingencias })),
        "text-warning",
        "Nenhuma contingência identificada ainda.",
      )}
    </div>
  );
}

const ID_PRAZOS = "auditoria-prazos-vencidos";

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
    <div id={ID_PRAZOS} tabIndex={-1} className="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <Secao
        titulo="Quais projetos estão com prazo vencido?"
        descricao="em andamento, com prazo do card antes de hoje · do mais atrasado para o menos"
      >
        <Card className="p-0 overflow-hidden">
          {atencao.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">Nenhum caso em andamento com prazo vencido.</div>
          ) : (
            <div className="overflow-auto max-h-[320px]">
              <table className="w-full text-sm">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow>
                    <TableHead className={CABECALHO}>Empresa</TableHead>
                    <TableHead className={CABECALHO}>Unidade</TableHead>
                    <TableHead className={CABECALHO}>Fase atual</TableHead>
                    <TableHead className={cn(CABECALHO, "text-right")}>Prazo</TableHead>
                    <TableHead className={cn(CABECALHO, "text-right")}>Dias em atraso</TableHead>
                    <TableHead className={CABECALHO}>Card</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atencao.map(({ r, dias }) => (
                    <TableRow key={r.pipefy_card_id}>
                      <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                      <TableCell>{r.unidade ?? NA}</TableCell>
                      <TableCell>{r.fase_atual ?? NA}</TableCell>
                      <TableCell className="num text-right">{fmtDate(r.prazo_atual)}</TableCell>
                      <TableCell className="num text-right text-danger font-semibold">{dias}d</TableCell>
                      <TableCell>{linkCard(r.pipefy_card_id)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </Card>
      </Secao>
    </div>
  );
}

function AchadosFiscais({ rows }: { rows: Auditoria[] }) {
  const { busca, colunas, ordem: ordemUrl } = Route.useSearch();
  const navigate = Route.useNavigate();
  const filtros: FiltrosColunas = useMemo(() => colunas ?? {}, [colunas]);
  const ordem: Ordem<ColunaAchado> = useMemo(
    () =>
      ordemUrl
        ? { coluna: ordemUrl.split(":")[0] as ColunaAchado, dir: ordemUrl.split(":")[1] as DirOrdem }
        : ORDEM_PADRAO,
    [ordemUrl],
  );

  const gravar = useCallback(
    (mudanca: { busca?: string | undefined; colunas?: FiltrosColunas | undefined; ordem?: string | undefined }) =>
      navigate({
        search: (prev) => ({ ...prev, ...mudanca }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );

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
          semTotal: r.oportunidades_valor == null && r.contingencias_valor == null,
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

  const faixaDe = (col: ColunaNumero): FaixaNumerica => filtros[col] ?? { min: null, max: null };
  const dirDe = (col: ColunaAchado) => (ordem?.coluna === col ? ordem.dir : null);
  const ordenarPor = (col: ColunaAchado) => (dir: DirOrdem) =>
    gravar({ ordem: col === ORDEM_PADRAO.coluna && dir === ORDEM_PADRAO.dir ? undefined : `${col}:${dir}` });
  const setTexto = (col: ColunaTexto) => (valores: string[]) =>
    gravar({ colunas: lerColunas({ ...filtros, [col]: valores }) });
  const setNumero = (col: ColunaNumero) => (faixa: FaixaNumerica) =>
    gravar({ colunas: lerColunas({ ...filtros, [col]: faixa }) });

  const algumFiltroAtivo = !!busca || Object.keys(filtros).length > 0;

  const maioresAchados = useMemo(() => {
    const q = (busca ?? "").trim().toLowerCase();
    const passaTexto = (col: ColunaTexto, valor: string) => {
      const sel = filtros[col] ?? [];
      return sel.length === 0 || sel.includes(valor);
    };
    const passaNumero = (col: ColunaNumero, valor: number) => {
      const { min, max } = filtros[col] ?? { min: null, max: null };
      if (min != null && valor < min) return false;
      if (max != null && valor > max) return false;
      return true;
    };

    const filtrados = base.filter(
      (b) =>
        (!q || b.empresa.toLowerCase().includes(q) || b.unidade.toLowerCase().includes(q)) &&
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
  }, [base, busca, filtros, ordem]);

  return (
    <Secao
      titulo="Quais são os achados de classificação Alta ou Média?"
      descricao={
        algumFiltroAtivo ? `${maioresAchados.length} de ${base.length} achados` : `${base.length} achados`
      }
      acoes={
        base.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={busca ?? ""}
                onChange={(e) => gravar({ busca: e.target.value || undefined })}
                placeholder="Buscar empresa ou unidade"
                aria-label="Buscar empresa ou unidade nos achados"
                className="h-8 w-60 pl-8"
              />
            </div>
            {algumFiltroAtivo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => gravar({ busca: undefined, colunas: undefined })}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        )
      }
    >
      {base.length === 0 ? (
        <EstadoVazio titulo="Nenhum apontamento classificado como Alta ou Média ainda" />
      ) : maioresAchados.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum achado com esses filtros"
          total={base.length}
          acao={
            <Button variant="outline" size="sm" onClick={() => gravar({ busca: undefined, colunas: undefined })}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  {COLUNAS_TEXTO.map((c) => (
                    <TableHead key={c} className={CABECALHO}>
                      <FiltroTexto
                        titulo={c === "empresa" ? "Empresa" : c === "unidade" ? "Unidade" : "Classificação"}
                        opcoes={opcoes[c]}
                        selecionados={filtros[c] ?? []}
                        onChange={setTexto(c)}
                        dirOrdem={dirDe(c)}
                        onOrdenar={ordenarPor(c)}
                      />
                    </TableHead>
                  ))}
                  {COLUNAS_NUMERO.map((c) => (
                    <TableHead key={c} className={cn(CABECALHO, "text-right")}>
                      <FiltroNumero
                        titulo={c === "oportunidade" ? "Oportunidade" : c === "contingencia" ? "Contingência" : "Total"}
                        faixa={faixaDe(c)}
                        onChange={setNumero(c)}
                        dirOrdem={dirDe(c)}
                        onOrdenar={ordenarPor(c)}
                      />
                    </TableHead>
                  ))}
                  <TableHead className={CABECALHO}>Card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maioresAchados.map((a) => (
                  <TableRow key={a.r.pipefy_card_id}>
                    <TableCell className="font-medium">{a.empresa}</TableCell>
                    <TableCell>{a.unidade}</TableCell>
                    <TableCell>{a.classificacao}</TableCell>
                    <TableCell className="num text-right text-success">{fmtMoney(a.r.oportunidades_valor)}</TableCell>
                    <TableCell className="num text-right text-warning">{fmtMoney(a.r.contingencias_valor)}</TableCell>
                    <TableCell className="num text-right font-semibold">{a.semTotal ? NA : fmtMoney(a.total)}</TableCell>
                    <TableCell>{linkCard(a.r.pipefy_card_id)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </Card>
      )}
    </Secao>
  );
}

function ExposicaoFiscalPorUnidade({ rows }: { rows: Auditoria[] }) {
  // A lista tem uma unidade por linha e não cabe em 320px — expandir tira o teto
  // de altura e mostra a carteira inteira de uma vez.
  const [expandido, setExpandido] = useState(false);
  const carteira = useMemo(() => {
    const map = new Map<
      string,
      {
        unidade: string;
        realizadas: number;
        comAchado: number;
        oportunidades: Soma;
        contingencias: Soma;
        faturamento: number;
        achadoComFat: number;
        semNenhum: number;
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
        oportunidades: SOMA_VAZIA,
        contingencias: SOMA_VAZIA,
        faturamento: 0,
        achadoComFat: 0,
        semNenhum: 0,
      };
      if (r.fase_atual === FASE_AUDITORIA_REALIZADA) {
        g.realizadas += 1;
        if ((r.oportunidades_valor ?? 0) > 0 || (r.contingencias_valor ?? 0) > 0) g.comAchado += 1;
      }
      g.oportunidades = somar(g.oportunidades, r.oportunidades_valor);
      g.contingencias = somar(g.contingencias, r.contingencias_valor);
      if (r.oportunidades_valor == null && r.contingencias_valor == null) g.semNenhum += 1;
      // Exposição só fecha se numerador e denominador vierem da mesma auditoria:
      // card sem "Faturamento do Período Analisado" fica de fora dos dois lados.
      if (r.faturamento_periodo != null) {
        g.faturamento += r.faturamento_periodo;
        g.achadoComFat += (r.oportunidades_valor ?? 0) + (r.contingencias_valor ?? 0);
      }
      map.set(u, g);
    }
    const lista = Array.from(map.values()).map((g) => {
      const oport = g.oportunidades.soma ?? 0;
      const conting = g.contingencias.soma ?? 0;
      const encontrado = oport + conting;
      return {
        ...g,
        oport,
        conting,
        // Nenhum projeto da unidade trouxe valor no relatório: ausência, não zero.
        semNenhumValor: g.oportunidades.soma === null && g.contingencias.soma === null,
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

  const maxEncontrado = useMemo(() => Math.max(0, ...carteira.map((c) => c.encontrado)), [carteira]);

  return (
    <Secao
      titulo="Exposição fiscal por unidade"
      descricao="Achado total (oportunidade + contingência) e quanto ele representa do faturamento auditado · só projetos do tipo Auditoria"
      className={cn(expandido && "lg:col-span-2")}
      acoes={
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          aria-label={expandido ? "Recolher a lista de unidades" : "Expandir para ver a carteira inteira"}
          title={expandido ? "Recolher" : "Expandir para ver a carteira inteira"}
        >
          {expandido ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </Button>
      }
    >
      <Card className="p-0 overflow-hidden">
        {carteira.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhuma unidade na carteira ainda.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: CORES_SERIE[0] }} />
                oportunidade
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: CORES_SERIE[1] }} />
                contingência
              </span>
              <span>comprimento da barra = achado total da unidade</span>
            </div>
            <div className={cn("divide-y", !expandido && "overflow-auto max-h-[320px]")}>
              {carteira.map((c) => {
                const largura = maxEncontrado > 0 ? (c.encontrado / maxEncontrado) * 100 : 0;
                const fatiaOport = c.encontrado > 0 ? (c.oport / c.encontrado) * 100 : 0;
                return (
                  <div key={c.unidade} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{c.unidade}</span>
                      <div className="flex shrink-0 items-baseline gap-2">
                        <div className="num text-sm font-semibold">
                          {c.semNenhumValor ? (
                            <span className="font-normal text-muted-foreground">sem valor</span>
                          ) : c.encontrado === 0 ? (
                            <span className="font-normal text-muted-foreground">sem achado</span>
                          ) : (
                            fmtMoney(c.encontrado)
                          )}
                        </div>
                        <div
                          className="num text-sm font-semibold text-foreground"
                          title="Exposição: achado fiscal dividido pelo faturamento do período analisado, contando só as auditorias com esse campo preenchido."
                        >
                          {c.exposicao == null ? (
                            <span className="text-xs font-normal text-muted-foreground">sem faturamento</span>
                          ) : (
                            <>
                              {fmtPct(c.exposicao)}
                              <span className="text-xs font-normal text-muted-foreground"> exposição</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Barra: comprimento = achado total; divisão = oportunidade x contingência. */}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="flex h-full" style={{ width: `${largura}%` }}>
                        <div className="h-full" style={{ width: `${fatiaOport}%`, background: CORES_SERIE[0] }} />
                        <div className="h-full" style={{ width: `${100 - fatiaOport}%`, background: CORES_SERIE[1] }} />
                      </div>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        <span className="num font-medium text-foreground">{c.realizadas}</span> em &ldquo;
                        {FASE_AUDITORIA_REALIZADA}&rdquo;
                      </span>
                      <span className="num">
                        {c.taxaAchado == null ? NA : `${Math.round(c.taxaAchado * 100)}% com achado`}
                      </span>
                      <span className="num">{fmtMoney(c.oportunidades.soma)} oport.</span>
                      <span className="num">{fmtMoney(c.contingencias.soma)} conting.</span>
                      {c.faturamento > 0 && <span className="num">{fmtMoney(c.faturamento)} faturamento auditado</span>}
                      {c.semNenhum > 0 && <span className="num">{semValor(c.semNenhum)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </Secao>
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
    <Secao titulo="Em que fase estão os projetos?" descricao="projetos por fase atual do Pipefy">
      <Card className="p-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={porFase} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid {...gradeProps} vertical horizontal={false} />
              <XAxis {...eixoProps} type="number" allowDecimals={false} />
              <YAxis {...eixoProps} type="category" dataKey="name" width={160} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="value" name="Projetos" fill={CORES_SERIE[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Secao>
  );
}

function CasosTable({ rows }: { rows: Auditoria[] }) {
  const casos = useMemo(
    () => [...rows].sort((a, b) => (a.empresa_auditada ?? "").localeCompare(b.empresa_auditada ?? "")),
    [rows],
  );

  return (
    <Secao titulo="Quais projetos deste tipo existem?" descricao="em ordem alfabética de empresa">
      {casos.length === 0 ? (
        <EstadoVazio titulo="Nenhum caso deste tipo ainda" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className={CABECALHO}>Empresa</TableHead>
                  <TableHead className={CABECALHO}>Unidade</TableHead>
                  <TableHead className={CABECALHO}>Fase atual</TableHead>
                  <TableHead className={CABECALHO}>Classificação</TableHead>
                  <TableHead className={cn(CABECALHO, "text-right")}>Oportunidade</TableHead>
                  <TableHead className={cn(CABECALHO, "text-right")}>Contingência</TableHead>
                  <TableHead className={cn(CABECALHO, "text-right")}>Conclusão</TableHead>
                  <TableHead className={CABECALHO}>Card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {casos.map((r) => (
                  <TableRow key={r.pipefy_card_id}>
                    <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                    <TableCell>{r.unidade ?? NA}</TableCell>
                    <TableCell>{r.fase_atual ?? NA}</TableCell>
                    <TableCell>{r.classificacao_apontamentos ?? NA}</TableCell>
                    <TableCell className="num text-right text-success">{fmtMoney(r.oportunidades_valor)}</TableCell>
                    <TableCell className="num text-right text-warning">{fmtMoney(r.contingencias_valor)}</TableCell>
                    <TableCell className="num text-right">{fmtDate(r.data_conclusao)}</TableCell>
                    <TableCell>{linkCard(r.pipefy_card_id)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </Card>
      )}
    </Secao>
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
    <Secao titulo="Quantos projetos há de cada tipo?" descricao="projetos do pipe, por tipo de projeto">
      <Card className="p-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid {...gradeProps} vertical horizontal={false} />
              <XAxis {...eixoProps} type="number" allowDecimals={false} />
              <YAxis {...eixoProps} type="category" dataKey="name" width={150} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="value" name="Projetos" radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Secao>
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
      const key = chaveMes(r.data_conclusao);
      if (!key) continue;
      comData += 1;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const data = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ name: rotuloMes(key), value }));
    return { data, semData: concluidas - comData };
  }, [rows]);

  return (
    <Secao
      titulo="Quantos projetos foram concluídos por mês?"
      descricao={
        semData > 0
          ? `concluídos (flag ou fase final), pela data de conclusão · ${semData} sem data de conclusão no Pipefy ficam fora do gráfico`
          : "concluídos (flag ou fase final), pela data de conclusão"
      }
    >
      <Card className="p-4">
        <div className="h-72">
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhum caso finalizado com data de conclusão registrada.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ left: 0, right: 8 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} dataKey="name" />
                <YAxis {...eixoProps} type="number" allowDecimals={false} width={32} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="value" name="Concluídos" fill={CORES_SERIE[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </Secao>
  );
}

// Rola sem animação para quem pediu menos movimento (V16) e leva o foco junto,
// para o leitor de tela e o teclado continuarem a partir da lista.
function irParaPrazos() {
  const alvo = document.getElementById(ID_PRAZOS);
  if (!alvo) return;
  const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  alvo.focus({ preventScroll: true });
}

function VisaoGeral({ rows, abrirTipo }: { rows: Auditoria[]; abrirTipo: (t: TipoKey) => void }) {
  return (
    <div className="space-y-6">
      <KpiCards rows={rows} labelTotal="Total de projetos" irParaPrazos={irParaPrazos} />

      <KpiGrade colunas={4}>
        {TIPO_ORDER.map((t) => (
          <KpiCard
            key={t}
            rotulo={TIPO_LABEL[t]}
            valor={rows.filter((r) => r.tipo_projeto === t).length}
            nota="projetos deste tipo"
            abrir={{ onClick: () => abrirTipo(t), rotulo: "Abrir aba" }}
          />
        ))}
      </KpiGrade>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProjetosPorTipo rows={rows} />
        <FinalizadasPorMes rows={rows} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResumoPorUnidade rows={rows} />
        <ExposicaoFiscalPorUnidade rows={rows} />
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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{TIPO_DESCRICAO[tipo]}</p>
      <KpiCards
        rows={filtradas}
        labelTotal={volumoso ? "Total de auditorias" : "Total de casos"}
        irParaPrazos={volumoso ? irParaPrazos : undefined}
      />
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
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const abaAtual: Aba = aba ?? "geral";
  const tipoAtual = tipoDaAba(abaAtual);

  const [rows, setRows] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("auditorias_internas")
      .select(
        "pipefy_card_id,empresa_auditada,unidade,fase_atual,tipo_projeto,complexidade_fiscal,tipo_empresa,setor_atuacao,equipe_designada,prazo_atual,data_conclusao,auditoria_finalizada,classificacao_apontamentos,oportunidades_valor,contingencias_valor,faturamento_periodo,synced_at",
      )
      .limit(5000);
    // Antes o erro era engolido e a tela mostrava zeros (N4).
    if (error) {
      setErro(error.message);
    } else {
      setErro(null);
      setRows((data ?? []) as Auditoria[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const tentarDeNovo = () => {
    setErro(null);
    setLoading(true);
    void carregar();
  };

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

  const ultimaSync = useMemo(() => {
    let max: string | null = null;
    for (const r of rows) if (r.synced_at && (!max || r.synced_at > max)) max = r.synced_at;
    return max;
  }, [rows]);

  const irPara = (proxima: Aba) =>
    navigate({
      search: (prev) => ({ ...prev, aba: proxima === "geral" ? undefined : proxima }),
      replace: true,
      resetScroll: false,
    });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Auditoria Interna"
        pergunta="Quais projetos fiscais estão atrasados, e quanto eles acharam por unidade?"
        descricao={`Projetos do pipe da Auditoria Interna · ${
          tipoAtual ? TIPO_LABEL[tipoAtual] : "todos os tipos"
        } · valores estimados pelos relatórios, em R$`}
        procedencia={{
          fonte: "Pipefy: pipe da Auditoria Interna (307181077)",
          atualizadoEm: loading || erro ? undefined : ultimaSync,
          regua: "concluído = flag de finalizada ou fase final",
        }}
        acoes={<BotaoAtualizarPipefy atualizando={sync.isPending} onClick={() => sync.mutate()} />}
      />

      {loading ? (
        <Carregando variante="kpis" />
      ) : erro ? (
        <EstadoErro
          titulo="Não foi possível carregar os projetos da Auditoria Interna"
          detalhe={erro}
          tentarNovamente={tentarDeNovo}
        />
      ) : rows.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum projeto sincronizado do Pipefy ainda"
          descricao="Um admin traz os cards com “Forçar atualização”."
        />
      ) : (
        <Tabs value={abaAtual} onValueChange={(v) => irPara(v)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="geral">
              <LayoutDashboard aria-hidden />
              Visão Geral
            </TabsTrigger>
            {TIPO_ORDER.map((t) => {
              const Icon = TIPO_ICON[t];
              return (
                <TabsTrigger key={t} value={TIPO_SLUG[t]}>
                  <Icon aria-hidden />
                  {TIPO_LABEL[t]} (<span className="num">{contagemPorTipo.get(t) ?? 0}</span>)
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="geral">
            <VisaoGeral rows={rows} abrirTipo={(t) => irPara(TIPO_SLUG[t])} />
          </TabsContent>
          {TIPO_ORDER.map((t) => (
            <TabsContent key={t} value={TIPO_SLUG[t]}>
              <TipoTab rows={rows} tipo={t} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
