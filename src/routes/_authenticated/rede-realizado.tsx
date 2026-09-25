import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoVazio,
  PageHeader,
  Secao,
} from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  linhaZeroProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { DestinoLink } from "@/components/rede/destino-link";
import { chaveMes, mesCorrente, rotuloMes, somarMeses } from "@/lib/rede/mes";
import { cn } from "@/lib/utils";

// Contrato da tela: docs/design/contratos/rede-realizado.md (arquétipo
// Lista/Relatório, gráfico de comparação). Métrica, unidades e período moram na
// URL (N7). Fontes e fórmulas são as de antes; o que mudou é exibição: chave de
// mês normalizada (CAC e NPS casam com a view), mês sem título do Omie sem
// ponto em vez de R$ 0, e a foto de hoje (MRR, contratos, ARPA) em barra.

const METRICAS = ["receita", "mrr", "clientes", "arpa", "crescimento", "cac", "nps"] as const;
type Metrica = (typeof METRICAS)[number];

type BuscaRealizado = { metrica?: Metrica; unidades?: string[]; de?: string; ate?: string };

const RE_CHAVE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validarBusca(s: Record<string, unknown>): BuscaRealizado {
  const metrica =
    typeof s.metrica === "string" && (METRICAS as readonly string[]).includes(s.metrica)
      ? (s.metrica as Metrica)
      : undefined;
  const unidades = Array.isArray(s.unidades)
    ? s.unidades.filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 120)
    : typeof s.unidades === "string" && s.unidades
      ? [s.unidades]
      : undefined;
  const mes = (v: unknown) => (typeof v === "string" && RE_CHAVE.test(v) ? v : undefined);
  const busca: BuscaRealizado = {
    metrica,
    unidades: unidades && unidades.length > 0 ? unidades : undefined,
    de: mes(s.de),
    ate: mes(s.ate),
  };
  return Object.fromEntries(Object.entries(busca).filter(([, v]) => v)) as BuscaRealizado;
}

export const Route = createFileRoute("/_authenticated/rede-realizado")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: RedeRealizadoPage,
});

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  faturado: number | null;
  recebido: number | null;
  num_contratos: number | null;
};

type RoasUnitRow = {
  mes: string;
  unidade: string;
  cac: number | null;
  investimento_midia: number | null;
  deals: number | null;
  mrr_medio: number | null;
};

type NpsRow = {
  created_at: string | null;
  unidade: string | null;
  nps_recomendacao: string | null;
};

// As três leituras, pelo nome que aparece no aviso de erro.
type Fonte = "recon" | "roas" | "nps";
const NOME_FONTE: Record<Fonte, string> = {
  recon: "v_reconciliacao_mensal",
  roas: "roas_por_unidade",
  nps: "nps_pesquisas",
};

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtBRLCompacto = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

const fmtInt = (v: number) => Math.round(v).toLocaleString("pt-BR");

type DefMetrica = {
  key: Metrica;
  /** Rótulo da aba. */
  aba: string;
  forma: "linha" | "barra";
  fonte: Fonte;
  /** Título da Secao: pergunta com a unidade de medida. */
  titulo: string;
  descricao: string;
  formatar: (v: number) => string;
  eixo: (v: number) => string;
  destino?: { to: string; rotulo: string };
};

const METRICAS_DEF: DefMetrica[] = [
  {
    key: "receita",
    aba: "Recebido (competência)",
    forma: "linha",
    fonte: "recon",
    titulo: "Quanto cada unidade recebeu por mês? (R$)",
    descricao:
      "Títulos RECEBIDO do Omie pelo mês de competência. Mês sem título da unidade fica sem ponto, não R$ 0.",
    formatar: (v) => fmtBRL(v),
    eixo: fmtBRLCompacto,
    destino: { to: "/funil-receita", rotulo: "Abrir Funil de Receita" },
  },
  {
    key: "mrr",
    aba: "MRR hoje",
    forma: "barra",
    fonte: "recon",
    titulo: "Qual o MRR contratado de cada unidade hoje? (R$)",
    descricao: "Foto de hoje: não muda com o período. Contratos ativos, MRR ÷ 12 do contrato.",
    formatar: (v) => fmtBRL(v),
    eixo: fmtBRLCompacto,
  },
  {
    key: "clientes",
    aba: "Contratos ativos hoje",
    forma: "barra",
    fonte: "recon",
    titulo: "Quantos contratos ativos cada unidade tem hoje? (contratos)",
    descricao: "Foto de hoje: não muda com o período. Contagem de contratos com status Ativo.",
    formatar: (v) => `${fmtInt(v)} contratos`,
    eixo: fmtInt,
  },
  {
    key: "arpa",
    aba: "ARPA por contrato",
    forma: "barra",
    fonte: "recon",
    titulo: "Quanto vale, por mês, um contrato ativo de cada unidade? (R$)",
    descricao: "Foto de hoje: MRR contratado ÷ contratos ativos.",
    formatar: (v) => fmtBRL(v),
    eixo: fmtBRLCompacto,
  },
  {
    key: "crescimento",
    aba: "Crescimento do recebido %",
    forma: "linha",
    fonte: "recon",
    titulo: "Quanto o recebido de cada unidade variou sobre o mês anterior? (%)",
    descricao: "Variação do recebido pelo mês de competência contra o mês anterior da série.",
    formatar: (v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
    eixo: (v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`,
    destino: { to: "/funil-receita", rotulo: "Abrir Funil de Receita" },
  },
  {
    key: "cac",
    aba: "CAC",
    forma: "linha",
    fonte: "roas",
    titulo: "Quanto cada unidade gastou para ganhar um contrato? (R$)",
    descricao: "CAC por unidade e mês, de roas_por_unidade.",
    formatar: (v) => fmtBRL(v),
    eixo: fmtBRLCompacto,
    destino: { to: "/unidades/funil-cac", rotulo: "Abrir Funil de CAC" },
  },
  {
    key: "nps",
    aba: "NPS",
    forma: "linha",
    fonte: "nps",
    titulo: "Como o NPS de cada unidade evoluiu? (pontos, −100 a 100)",
    descricao:
      "Promotores (9–10) menos detratores (0–6) ÷ respostas, pelo mês de criação da pesquisa. Não é a régua do IDU.",
    formatar: (v) => `${fmtInt(v)} pontos`,
    eixo: fmtInt,
    destino: { to: "/nps", rotulo: "Abrir NPS" },
  },
];

const MAX_LINHAS = 5;

function RedeRealizadoPage() {
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [roasRows, setRoasRows] = useState<RoasUnitRow[]>([]);
  const [npsRows, setNpsRows] = useState<NpsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erros, setErros] = useState<Partial<Record<Fonte, string>>>({});
  const [recarga, setRecarga] = useState(0);

  const [metricaUrl, setMetrica] = useFiltroNaUrl("metrica", "receita");
  const [unidadesUrl, setUnidadesUrl] = useFiltroNaUrl<string[]>("unidades", []);

  // Período padrão: os últimos 12 meses (antes a série ia até 2021).
  const atePadrao = useMemo(mesCorrente, []);
  const dePadrao = useMemo(() => somarMeses(atePadrao, -11), [atePadrao]);
  const [deUrl, setDe] = useFiltroNaUrl("de", dePadrao);
  const [ateUrl, setAte] = useFiltroNaUrl("ate", atePadrao);
  const periodoValido = RE_CHAVE.test(deUrl) && RE_CHAVE.test(ateUrl) && deUrl <= ateUrl;
  const de = periodoValido ? deUrl : dePadrao;
  const ate = periodoValido ? ateUrl : atePadrao;
  const limpar = useLimparFiltrosNaUrl(["unidades", "de", "ate"]);

  const metrica: Metrica = (METRICAS as readonly string[]).includes(metricaUrl)
    ? (metricaUrl as Metrica)
    : "receita";

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const [rec, roas, nps] = await Promise.all([
        supabase
          .from("v_reconciliacao_mensal")
          .select("mes,unidade,mrr_contratado,faturado,recebido,num_contratos")
          .order("mes", { ascending: true }),
        supabase
          .from("roas_por_unidade")
          .select("mes,unidade,cac,investimento_midia,deals,mrr_medio")
          .order("mes", { ascending: true }),
        supabase
          .from("nps_pesquisas")
          .select("created_at,unidade,nps_recomendacao")
          .not("nps_recomendacao", "is", null),
      ]);
      if (!mounted) return;
      setReconcRows((rec.data ?? []) as ReconcRow[]);
      setRoasRows((roas.data ?? []) as RoasUnitRow[]);
      setNpsRows((nps.data ?? []) as NpsRow[]);
      const e: Partial<Record<Fonte, string>> = {};
      if (rec.error) e.recon = rec.error.message;
      if (roas.error) e.roas = roas.error.message;
      if (nps.error) e.nps = nps.error.message;
      setErros(e);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [recarga]);

  // Linhas da view com o mês normalizado: "timestamptz" vira "aaaa-mm", e é
  // essa chave que casa com o `date` de roas_por_unidade e com o NPS.
  const reconc = useMemo(
    () =>
      reconcRows
        .map((r) => ({ ...r, chave: chaveMes(r.mes) }))
        .filter((r): r is ReconcRow & { chave: string } => !!r.chave && !!r.unidade),
    [reconcRows],
  );

  const unidades = useMemo(
    () => Array.from(new Set(reconc.map((r) => r.unidade as string))).sort(),
    [reconc],
  );

  const meses = useMemo(
    () => Array.from(new Set(reconc.map((r) => r.chave))).sort(),
    [reconc],
  );

  const npsByMesUnidade = useMemo(() => {
    const map = new Map<string, Map<string, { p: number; d: number; total: number }>>();
    for (const r of npsRows) {
      if (!r.created_at || !r.unidade) continue;
      const mes = chaveMes(r.created_at);
      if (!mes) continue;
      const n = Number(r.nps_recomendacao);
      if (!Number.isFinite(n)) continue;
      if (!map.has(mes)) map.set(mes, new Map());
      const umap = map.get(mes)!;
      const cur = umap.get(r.unidade) ?? { p: 0, d: 0, total: 0 };
      if (n >= 9) cur.p++;
      else if (n <= 6) cur.d++;
      cur.total++;
      umap.set(r.unidade, cur);
    }
    return map;
  }, [npsRows]);

  const cacByMesUnidade = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of roasRows) {
      const mes = chaveMes(r.mes);
      if (!mes) continue;
      if (!map.has(mes)) map.set(mes, new Map());
      if (r.cac != null) map.get(mes)!.set(r.unidade, r.cac);
    }
    return map;
  }, [roasRows]);

  const porMesUnidade = useMemo(() => {
    const idx = new Map<string, ReconcRow & { chave: string }>();
    for (const r of reconc) idx.set(`${r.chave}|${r.unidade}`, r);
    // A view preenche com 0 (COALESCE) o mês em que a unidade não tem título
    // nenhum no Omie: esse mês fica sem valor, para o buraco aparecer.
    const recebidoDe = (row: ReconcRow | undefined) =>
      row && !((row.faturado ?? 0) === 0 && (row.recebido ?? 0) === 0) ? (row.recebido ?? null) : null;

    const result = new Map<string, Map<string, Record<Metrica, number | null>>>();
    meses.forEach((mes, i) => {
      const prevMes = meses[i - 1];
      const mesMap = new Map<string, Record<Metrica, number | null>>();
      for (const u of unidades) {
        const row = idx.get(`${mes}|${u}`);
        const prevRow = prevMes ? idx.get(`${prevMes}|${u}`) : undefined;
        const recebido = recebidoDe(row);
        const recebidoAnt = recebidoDe(prevRow);
        const mrr = row?.mrr_contratado ?? null;
        const clientes = row?.num_contratos ?? null;
        const arpa = mrr != null && clientes != null && clientes > 0 ? mrr / clientes : null;
        const crescimento =
          recebido != null && recebidoAnt != null && recebidoAnt > 0
            ? ((recebido - recebidoAnt) / recebidoAnt) * 100
            : null;
        const cac = cacByMesUnidade.get(mes)?.get(u) ?? null;
        const npsMap = npsByMesUnidade.get(mes)?.get(u);
        const nps =
          npsMap && npsMap.total > 0
            ? Math.round(((npsMap.p - npsMap.d) / npsMap.total) * 100)
            : null;
        mesMap.set(u, { receita: recebido, mrr, clientes, arpa, crescimento, cac, nps });
      }
      result.set(mes, mesMap);
    });
    return result;
  }, [meses, unidades, reconc, cacByMesUnidade, npsByMesUnidade]);

  const mesesNoPeriodo = useMemo(() => meses.filter((m) => m >= de && m <= ate), [meses, de, ate]);

  // Tamanho da unidade no período (recebido somado): decide quais 5 linhas
  // aparecem ligadas quando ninguém escolheu.
  const recebidoNoPeriodo = useMemo(() => {
    const map = new Map<string, number>();
    for (const mes of mesesNoPeriodo) {
      for (const u of unidades) {
        const v = porMesUnidade.get(mes)?.get(u)?.receita ?? 0;
        map.set(u, (map.get(u) ?? 0) + v);
      }
    }
    return map;
  }, [mesesNoPeriodo, unidades, porMesUnidade]);

  const escolhidas = unidadesUrl.filter((u) => unidades.includes(u));
  const def = METRICAS_DEF.find((m) => m.key === metrica)!;

  const perimetro =
    escolhidas.length > 0 ? `${escolhidas.length} de ${unidades.length} unidades` : "Unidades regionais";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Realizado Unidades"
        pergunta="Como cada unidade evoluiu mês a mês?"
        descricao={`${perimetro} · ${rotuloMes(de)}–${rotuloMes(ate)} · meses com título no Omie · recebido pelo mês de competência; MRR e contratos ativos são a foto de hoje`}
        procedencia={{
          fonte: "v_reconciliacao_mensal · roas_por_unidade · nps_pesquisas",
          regua: "recebido = títulos RECEBIDO do Omie pelo mês de competência",
        }}
      />

      <Filtros
        meses={meses}
        unidades={unidades}
        escolhidas={escolhidas}
        de={de}
        ate={ate}
        aoEscolher={(lista) => setUnidadesUrl(lista)}
        aoMudarDe={(v) => setDe(v)}
        aoMudarAte={(v) => setAte(v)}
        aoLimpar={escolhidas.length > 0 || deUrl !== dePadrao || ateUrl !== atePadrao ? limpar : undefined}
        foto={def.forma === "barra"}
      />

      <Tabs value={metrica} onValueChange={(v) => setMetrica(v)} className="w-full">
        <TabsList className="h-auto flex-wrap gap-1">
          {METRICAS_DEF.map((m) => (
            <TabsTrigger key={m.key} value={m.key}>
              {m.aba}
            </TabsTrigger>
          ))}
        </TabsList>

        {METRICAS_DEF.map((m) => {
          // CAC e NPS tiram unidades e meses de v_reconciliacao_mensal: se a
          // view cai, a aba também não tem como desenhar.
          const fonteCaida: Fonte | undefined = erros[m.fonte]
            ? m.fonte
            : m.fonte !== "recon" && erros.recon
              ? "recon"
              : undefined;
          return (
          <TabsContent key={m.key} value={m.key} className="mt-4">
            {loading ? (
              <Carregando variante="grafico" />
            ) : fonteCaida ? (
              <EstadoErro
                titulo="Fonte indisponível"
                detalhe={`${NOME_FONTE[fonteCaida]}: ${erros[fonteCaida]}${
                  fonteCaida !== m.fonte ? ` (esta aba usa as unidades e os meses dessa view)` : ""
                }`}
                tentarNovamente={() => setRecarga((n) => n + 1)}
              />
            ) : (
              <Secao
                titulo={m.titulo}
                descricao={m.descricao}
                acoes={m.destino && <DestinoLink {...m.destino} />}
              >
                {m.forma === "barra" ? (
                  <GraficoFoto
                    def={m}
                    unidades={escolhidas.length > 0 ? escolhidas : unidades}
                    mesFoto={atePadrao}
                    porMesUnidade={porMesUnidade}
                  />
                ) : (
                  <GraficoLinhas
                    def={m}
                    meses={mesesNoPeriodo}
                    unidades={unidades}
                    escolhidas={escolhidas}
                    tamanho={recebidoNoPeriodo}
                    porMesUnidade={porMesUnidade}
                    aoEscolher={(lista) => setUnidadesUrl(lista)}
                  />
                )}
              </Secao>
            )}
          </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function Filtros({
  meses,
  unidades,
  escolhidas,
  de,
  ate,
  aoEscolher,
  aoMudarDe,
  aoMudarAte,
  aoLimpar,
  foto,
}: {
  meses: string[];
  unidades: string[];
  escolhidas: string[];
  de: string;
  ate: string;
  aoEscolher: (lista: string[]) => void;
  aoMudarDe: (v: string) => void;
  aoMudarAte: (v: string) => void;
  aoLimpar?: () => void;
  foto: boolean;
}) {
  // O mês escolhido entra na lista mesmo que a série não o tenha, para o
  // Select não ficar em branco.
  const opcoes = Array.from(new Set([...meses, de, ate])).sort().reverse();
  const rotuloUnidades =
    escolhidas.length === 0
      ? "Todas as unidades"
      : escolhidas.length === 1
        ? escolhidas[0]
        : `${escolhidas.length} unidades`;
  return (
    <BarraFiltros aoLimpar={aoLimpar}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9" aria-label={`Unidades: ${rotuloUnidades}`}>
            {rotuloUnidades}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Unidades</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {unidades.map((u) => (
            <DropdownMenuCheckboxItem
              key={u}
              checked={escolhidas.includes(u)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(c) =>
                aoEscolher(c ? [...escolhidas, u] : escolhidas.filter((x) => x !== u))
              }
            >
              {u}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-sm text-muted-foreground">De</span>
      <Select value={de} onValueChange={aoMudarDe} disabled={foto}>
        <SelectTrigger className="h-9 w-[110px]" aria-label="Mês inicial">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes
            .filter((m) => m <= ate)
            .map((m) => (
              <SelectItem key={m} value={m}>
                {rotuloMes(m)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">até</span>
      <Select value={ate} onValueChange={aoMudarAte} disabled={foto}>
        <SelectTrigger className="h-9 w-[110px]" aria-label="Mês final">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes
            .filter((m) => m >= de)
            .map((m) => (
              <SelectItem key={m} value={m}>
                {rotuloMes(m)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {foto && (
        <span className="text-[13px] text-muted-foreground">foto de hoje: o período não se aplica</span>
      )}
      {escolhidas.length > 0 && (
        <span className="num text-[13px] text-muted-foreground">
          {escolhidas.length} de {unidades.length} unidades
        </span>
      )}
    </BarraFiltros>
  );
}

function GraficoLinhas({
  def,
  meses,
  unidades,
  escolhidas,
  tamanho,
  porMesUnidade,
  aoEscolher,
}: {
  def: DefMetrica;
  meses: string[];
  unidades: string[];
  escolhidas: string[];
  tamanho: Map<string, number>;
  porMesUnidade: Map<string, Map<string, Record<Metrica, number | null>>>;
  aoEscolher: (lista: string[]) => void;
}) {
  const comDado = unidades.filter((u) =>
    meses.some((m) => porMesUnidade.get(m)?.get(u)?.[def.key] != null),
  );
  // Ordem das unidades: as maiores pelo recebido no período primeiro.
  const ordem = [...comDado].sort((a, b) => (tamanho.get(b) ?? 0) - (tamanho.get(a) ?? 0));
  const ligadas = (escolhidas.length > 0 ? ordem.filter((u) => escolhidas.includes(u)) : ordem).slice(
    0,
    MAX_LINHAS,
  );
  const desligadas = ordem.filter((u) => !ligadas.includes(u));

  if (meses.length === 0 || comDado.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem dado desta métrica no período"
        descricao="Nenhuma unidade tem valor nos meses escolhidos. Amplie o período."
      />
    );
  }

  if (ligadas.length === 0) {
    return (
      <EstadoVazio
        titulo="As unidades escolhidas não têm dado desta métrica no período"
        total={comDado.length}
        descricao="O total conta as unidades com dado nesta métrica. Mostre as maiores ou mude o filtro de unidades."
        acao={
          <Button type="button" variant="outline" size="sm" onClick={() => aoEscolher([])}>
            Mostrar as 5 maiores
          </Button>
        }
      />
    );
  }

  const dados = meses.map((mes) => {
    const entrada: Record<string, string | number | null> = { mes, label: rotuloMes(mes) };
    for (const u of ligadas) entrada[u] = porMesUnidade.get(mes)?.get(u)?.[def.key] ?? null;
    return entrada;
  });

  // Ligar e desligar mexem no mesmo filtro `unidades` da barra.
  const base = escolhidas.length > 0 ? escolhidas : ligadas;
  const alternar = (u: string) => {
    if (ligadas.includes(u)) {
      if (ligadas.length === 1) return;
      aoEscolher(base.filter((x) => x !== u));
    } else if (ligadas.length < MAX_LINHAS) {
      aoEscolher([...base.filter((x) => x !== u), u]);
    }
  };
  const cheio = ligadas.length >= MAX_LINHAS;

  return (
    <Card className="p-4">
      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="label" {...eixoProps} />
            <YAxis tickFormatter={(v: number) => def.eixo(v)} width={80} {...eixoProps} />
            {def.key === "crescimento" && <ReferenceLine y={0} {...linhaZeroProps} />}
            <Tooltip
              {...tooltipProps}
              formatter={(v: number) => (v == null ? "sem dado" : def.formatar(v))}
            />
            {ligadas.map((u, i) => (
              <Line
                key={u}
                type="monotone"
                dataKey={u}
                name={u}
                stroke={CORES_SERIE[i]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legenda que liga e desliga: botões para funcionar no teclado (V12).
          Até 5 linhas ao mesmo tempo, uma cor da marca por linha, sem ciclar. */}
      <div role="group" className="mt-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Unidades no gráfico">
        {ligadas.map((u, i) => (
          <button
            key={u}
            type="button"
            aria-pressed
            onClick={() => alternar(u)}
            disabled={ligadas.length === 1}
            title={ligadas.length === 1 ? "Ao menos uma unidade fica ligada" : `Desligar ${u}`}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          >
            <span aria-hidden className="size-2 rounded-full" style={{ background: CORES_SERIE[i] }} />
            {u}
          </button>
        ))}
        {desligadas.length > 0 && (
          <>
            <span className="ml-1 text-muted-foreground">outras:</span>
            {desligadas.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={false}
                onClick={() => alternar(u)}
                disabled={cheio}
                title={cheio ? "Até 5 unidades ao mesmo tempo: desligue uma antes" : `Ligar ${u}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  cheio ? "cursor-not-allowed" : "hover:bg-muted hover:text-foreground",
                )}
              >
                <span aria-hidden className="size-2 rounded-full border border-current" />
                {u}
              </button>
            ))}
          </>
        )}
      </div>
      {desligadas.length > 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {escolhidas.length > 0
            ? "Até 5 unidades ao mesmo tempo."
            : "Ligadas: as 5 maiores pelo recebido no período. Clique numa unidade para ligar ou desligar (até 5)."}
        </p>
      )}
    </Card>
  );
}

function GraficoFoto({
  def,
  unidades,
  mesFoto,
  porMesUnidade,
}: {
  def: DefMetrica;
  unidades: string[];
  mesFoto: string;
  porMesUnidade: Map<string, Map<string, Record<Metrica, number | null>>>;
}) {
  // A view repete a foto de hoje em todos os meses e sempre inclui o mês
  // corrente (date_trunc de now()): vale a linha do mês de hoje.
  const dados = unidades
    .map((u) => ({ unidade: u, valor: porMesUnidade.get(mesFoto)?.get(u)?.[def.key] ?? null }))
    .filter((d): d is { unidade: string; valor: number } => d.valor != null)
    .sort((a, b) => b.valor - a.valor);

  if (dados.length === 0) {
    return <EstadoVazio titulo="Nenhuma unidade com contrato ativo hoje" />;
  }

  return (
    <Card className="p-4">
      <div style={{ height: Math.max(160, dados.length * 40 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid {...gradeProps} vertical horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => def.eixo(v)} {...eixoProps} />
            <YAxis type="category" dataKey="unidade" width={130} {...eixoProps} />
            <Tooltip {...tooltipProps} formatter={(v: number) => def.formatar(v)} />
            <Bar dataKey="valor" name={def.aba} fill={CORES_SERIE[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">Foto de {rotuloMes(mesFoto)}.</p>
    </Card>
  );
}
