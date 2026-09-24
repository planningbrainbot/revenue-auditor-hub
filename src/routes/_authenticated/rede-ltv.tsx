import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COR_NEUTRA,
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  type EstadoKpi,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { DestinoLink } from "@/components/rede/destino-link";
import { chaveMes, mesesEntre, rotuloMes } from "@/lib/rede/mes";

// Contrato da tela: docs/design/contratos/rede-ltv.md (arquétipo
// Lista/Relatório). As fórmulas são as de antes; os rótulos passam a dizer
// qual é qual, porque "LT" tinha dois sentidos na mesma tela (N11): a idade
// real dos contratos ativos e os meses desde 07/2024 ÷ 2 da série mensal.

type BuscaLtv = { unidade?: string };

function validarBusca(s: Record<string, unknown>): BuscaLtv {
  const unidade =
    typeof s.unidade === "string" && s.unidade.length > 0 && s.unidade.length <= 120
      ? s.unidade
      : undefined;
  return unidade ? { unidade } : {};
}

export const Route = createFileRoute("/_authenticated/rede-ltv")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: RedeLtvPage,
});

type ContratoRow = {
  ganho_em: string | null;
  mrr_mensal: number | null;
  status_contrato: string | null;
  unidade: string | null;
};

type RoasMensalRow = {
  mes: string;
  cac: number | null;
  mrr_medio: number | null;
  deals_digital: number | null;
};

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  num_contratos: number | null;
};

type Fonte = "contratos" | "roas" | "recon";
const NOME_FONTE: Record<Fonte, string> = {
  contratos: "contratos",
  roas: "roas_mensal",
  recon: "v_reconciliacao_mensal",
};

const ALL = "__all__";
const SEM_UNIDADE = "sem unidade";

// Data inicial da série mensal: fixa no código desde a versão anterior da
// tela. O LT da série é (meses desde aqui) ÷ 2. Não é idade de contrato.
const INICIO_SERIE = "2024-07";

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

const fmtMeses = (v: number | null | undefined, casas = 1) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;

function monthDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function RedeLtvPage() {
  const [contratos, setContratos] = useState<ContratoRow[]>([]);
  const [roas, setRoas] = useState<RoasMensalRow[]>([]);
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erros, setErros] = useState<Partial<Record<Fonte, string>>>({});
  const [recarga, setRecarga] = useState(0);
  const [unidadeUrl, setUnidadeUrl] = useFiltroNaUrl("unidade", "");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const [c, r, rec] = await Promise.all([
        supabase
          .from("contratos")
          .select("ganho_em,mrr_mensal,status_contrato,unidade")
          .eq("tipo_unidade", "franquia")
          .not("ganho_em", "is", null),
        supabase
          .from("roas_mensal")
          .select("mes,cac,mrr_medio,deals_digital")
          .order("mes", { ascending: true }),
        supabase
          .from("v_reconciliacao_mensal")
          .select("mes,unidade,mrr_contratado,num_contratos")
          .order("mes", { ascending: true }),
      ]);
      if (!mounted) return;
      setContratos((c.data ?? []) as ContratoRow[]);
      setRoas((r.data ?? []) as RoasMensalRow[]);
      setReconcRows((rec.data ?? []) as ReconcRow[]);
      const e: Partial<Record<Fonte, string>> = {};
      if (c.error) e.contratos = c.error.message;
      if (r.error) e.roas = r.error.message;
      if (rec.error) e.recon = rec.error.message;
      setErros(e);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [recarga]);

  const tentarDeNovo = () => setRecarga((n) => n + 1);
  const hoje = useMemo(() => new Date(), []);

  const ativosRede = useMemo(
    () => contratos.filter((c) => c.status_contrato === "Ativo" && c.ganho_em),
    [contratos],
  );

  const unidades = useMemo(
    () => Array.from(new Set(ativosRede.map((c) => c.unidade ?? SEM_UNIDADE))).sort(),
    [ativosRede],
  );
  // Com contratos fora do ar não há lista para conferir: vale o que está na
  // URL (a série ainda filtra pela view). Com a lista carregada, unidade que
  // não existe sai da URL e a tela avisa, em vez de mostrar a rede calada.
  const unidadeInexistente =
    !loading && !erros.contratos && !!unidadeUrl && !unidades.includes(unidadeUrl);
  const unidade = unidadeUrl && (erros.contratos || unidades.includes(unidadeUrl)) ? unidadeUrl : ALL;
  const [descartada, setDescartada] = useState<string | null>(null);
  useEffect(() => {
    if (unidadeInexistente) {
      setDescartada(unidadeUrl);
      setUnidadeUrl(undefined);
    }
  }, [unidadeInexistente, unidadeUrl, setUnidadeUrl]);

  const ativos = useMemo(
    () => (unidade === ALL ? ativosRede : ativosRede.filter((c) => (c.unidade ?? SEM_UNIDADE) === unidade)),
    [ativosRede, unidade],
  );

  const kpis = useMemo(() => {
    if (ativos.length === 0) return { ltv: null, arpa: null, ltMedio: null };
    const totalMrr = ativos.reduce((s, c) => s + (c.mrr_mensal ?? 0), 0);
    const arpa = totalMrr / ativos.length;
    const ltMedio =
      ativos.reduce((s, c) => {
        const dt = new Date(c.ganho_em!);
        return s + Math.max(0, monthDiff(dt, hoje));
      }, 0) / ativos.length;
    const ltv = arpa * ltMedio;
    return { ltv, arpa, ltMedio };
  }, [ativos, hoje]);

  const ltvPorUnidade = useMemo(() => {
    const map = new Map<string, { mrr: number; count: number; ltTotal: number }>();
    for (const c of ativosRede) {
      const u = c.unidade ?? SEM_UNIDADE;
      const dt = new Date(c.ganho_em!);
      const lt = Math.max(0, monthDiff(dt, hoje));
      const cur = map.get(u) ?? { mrr: 0, count: 0, ltTotal: 0 };
      cur.mrr += c.mrr_mensal ?? 0;
      cur.count += 1;
      cur.ltTotal += lt;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([u, v]) => {
        const arpa = v.count > 0 ? v.mrr / v.count : 0;
        const lt = v.count > 0 ? v.ltTotal / v.count : 0;
        return { unidade: u, arpa, lt, ltv: arpa * lt };
      })
      .sort((a, b) => b.ltv - a.ltv);
  }, [ativosRede, hoje]);

  // Mês da view normalizado ("timestamptz" → "aaaa-mm"): antes a data ficava
  // inválida (LT = 1, LTV = ARPA) e o CAC não casava com roas_mensal.mes.
  const reconcByMes = useMemo(() => {
    const map = new Map<string, { mrr: number; contratos: number }>();
    for (const r of reconcRows) {
      const m = chaveMes(r.mes);
      if (!m) continue;
      if (unidade !== ALL && r.unidade !== unidade) continue;
      const cur = map.get(m) ?? { mrr: 0, contratos: 0 };
      cur.mrr += r.mrr_contratado ?? 0;
      cur.contratos += r.num_contratos ?? 0;
      map.set(m, cur);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [reconcRows, unidade]);

  const cacPorMes = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const r of roas) {
      const m = chaveMes(r.mes);
      if (m) map.set(m, r.cac ?? null);
    }
    return map;
  }, [roas]);

  const ltvChart = useMemo(() => {
    return reconcByMes.map(([mes, v]) => {
      // Mês sem contrato fica sem ponto (antes ARPA e LTV saíam 0).
      const arpa = v.contratos > 0 ? v.mrr / v.contratos : null;
      const ltCumMeses = mesesEntre(INICIO_SERIE, mes);
      const lt = ltCumMeses > 0 ? ltCumMeses / 2 : 1;
      const ltv = arpa != null ? arpa * lt : null;
      const cac = cacPorMes.get(mes) ?? null;
      return { mes, label: rotuloMes(mes), arpa, ltv, cac, lt, contratos: v.contratos };
    });
  }, [reconcByMes, cacPorMes]);

  const resumo = useMemo(() => ltvChart.slice(-12), [ltvChart]);

  const perimetro = unidade === ALL ? "Rede inteira" : unidade;
  const estadoKpi: EstadoKpi = erros.contratos
    ? "indisponivel"
    : ativos.length === 0
      ? "nao-apurado"
      : "ok";
  // Só a view derruba a série inteira; sem roas_mensal cai só o LTV × CAC.

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="LTV Estimado"
        pergunta="Quanto vale um contrato em cada unidade, e isso cobre o CAC?"
        descricao={`${perimetro} · contratos ativos hoje, franquias · ARPA por contrato × tempo de vida · CAC da rede por mês. Não compare com o LTV do Overview (ARPA ÷ churn) nem com a Receita bookada do Indicadores (MRR × 60): são réguas diferentes.`}
        procedencia={{
          fonte: "contratos · v_reconciliacao_mensal · roas_mensal",
          regua: "LTV = ARPA por contrato × idade média dos contratos ativos",
        }}
        filtros={
          <Select
            value={unidade}
            onValueChange={(v) => {
              setDescartada(null);
              setUnidadeUrl(v === ALL ? undefined : v);
            }}
            disabled={!!erros.contratos}
          >
            <SelectTrigger className="h-9 w-[200px]" aria-label="Unidade">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Rede inteira</SelectItem>
              {erros.contratos && unidade !== ALL && <SelectItem value={unidade}>{unidade}</SelectItem>}
              {unidades.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {descartada && (
        <EstadoVazio
          titulo={`A unidade "${descartada}" não tem contrato ativo de franquia`}
          descricao="O filtro saiu do link e a tela mostra a rede inteira."
        />
      )}

      {loading ? (
        <Carregando variante="kpis" />
      ) : erros.contratos ? (
        <EstadoErro
          titulo="Os números por contrato não carregaram"
          detalhe={`${NOME_FONTE.contratos}: ${erros.contratos}`}
          tentarNovamente={tentarDeNovo}
        />
      ) : (
        <KpiGrade colunas={4} className="lg:grid-cols-3">
          <KpiCard
            rotulo="LTV por contrato ativo"
            valor={fmtBRL(kpis.ltv)}
            nota="ARPA por contrato × idade média dos contratos ativos"
            estado={estadoKpi}
          />
          <KpiCard
            rotulo="ARPA por contrato"
            valor={fmtBRL(kpis.arpa)}
            nota={`Σ MRR ÷ ${ativos.length.toLocaleString("pt-BR")} contratos ativos`}
            estado={estadoKpi}
          />
          <KpiCard
            rotulo="Idade média dos contratos ativos"
            valor={fmtMeses(kpis.ltMedio)}
            unidade="meses"
            nota="média de meses entre o ganho e hoje, só dos ativos"
            estado={estadoKpi}
          />
        </KpiGrade>
      )}

      {loading ? (
        <Carregando variante="grafico" />
      ) : (
        <>
          <Secao
            titulo="Qual unidade tem o menor LTV por contrato? (R$)"
            descricao="Mesma fórmula dos cards, por unidade, sobre os contratos ativos de hoje."
            acoes={
              <>
                <DestinoLink
                  to="/rede-realizado"
                  search={unidade === ALL ? undefined : { unidades: [unidade] }}
                  rotulo={unidade === ALL ? "Abrir Realizado" : `Abrir Realizado de ${unidade}`}
                />
                <DestinoLink to="/unidades/funil-cac" rotulo="Abrir Funil de CAC" />
              </>
            }
          >
            {erros.contratos ? (
              <EstadoErro
                titulo="Fonte indisponível"
                detalhe={`${NOME_FONTE.contratos}: ${erros.contratos}`}
                tentarNovamente={tentarDeNovo}
              />
            ) : ltvPorUnidade.length === 0 ? (
              <EstadoVazio titulo="Nenhum contrato ativo de franquia hoje" />
            ) : (
              <Card className="p-4">
                <div style={{ height: Math.max(160, ltvPorUnidade.length * 36 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={ltvPorUnidade}
                      layout="vertical"
                      margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid {...gradeProps} vertical horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => fmtBRLCompacto(v)} {...eixoProps} />
                      <YAxis type="category" dataKey="unidade" width={130} {...eixoProps} />
                      <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                      <Bar dataKey="ltv" name="LTV por contrato" radius={[0, 4, 4, 0]}>
                        {ltvPorUnidade.map((d) => (
                          <Cell
                            key={d.unidade}
                            fill={unidade === ALL || d.unidade === unidade ? CORES_SERIE[0] : COR_NEUTRA}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </Secao>

          {erros.recon ? (
            <EstadoErro
              titulo="Série mensal indisponível"
              detalhe={`${NOME_FONTE.recon}: ${erros.recon}`}
              tentarNovamente={tentarDeNovo}
            />
          ) : ltvChart.length === 0 ? (
            <EstadoVazio
              titulo="Sem meses na série"
              descricao={
                unidade === ALL
                  ? "v_reconciliacao_mensal não trouxe nenhum mês."
                  : `${unidade} não aparece em v_reconciliacao_mensal (só unidades regionais com contrato ativo).`
              }
            />
          ) : (
            <>
              <Secao
                titulo="O LTV estimado cobre o CAC da rede, mês a mês? (R$)"
                descricao={`${unidade === ALL ? "" : `LTV de ${unidade} contra o CAC da rede inteira. `}ARPA da foto de hoje × LT da série (meses desde ${rotuloMes(INICIO_SERIE)} ÷ 2, data inicial fixa no código) contra o CAC da rede (roas_mensal). Não é um LTV histórico.`}
              >
                {erros.roas ? (
                  <EstadoErro
                    titulo="Fonte indisponível"
                    detalhe={`${NOME_FONTE.roas}: ${erros.roas}`}
                    tentarNovamente={tentarDeNovo}
                  />
                ) : (
                <Card className="p-4">
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ltvChart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid {...gradeProps} />
                        <XAxis dataKey="label" {...eixoProps} />
                        <YAxis tickFormatter={(v: number) => fmtBRLCompacto(v)} width={80} {...eixoProps} />
                        <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                        <Legend {...legendaProps} />
                        <Line type="monotone" dataKey="ltv" name="LTV estimado" stroke={CORES_SERIE[0]} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="cac" name="CAC da rede" stroke={CORES_SERIE[1]} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                )}
              </Secao>

              <div className="grid gap-6 lg:grid-cols-2">
                <Secao titulo="Quanto vale, por mês, um contrato ativo? (R$)" descricao="ARPA por contrato: MRR contratado ÷ contratos ativos da view.">
                  <Card className="p-4">
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={ltvChart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis tickFormatter={(v: number) => fmtBRLCompacto(v)} width={80} {...eixoProps} />
                          <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                          <Line type="monotone" dataKey="arpa" name="ARPA por contrato" stroke={CORES_SERIE[0]} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Secao>

                <Secao
                  titulo="Qual LT a série usa em cada mês? (meses)"
                  descricao={`LT da série: meses desde ${rotuloMes(INICIO_SERIE)} ÷ 2. Não é a idade dos contratos ativos.`}
                >
                  <Card className="p-4">
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={ltvChart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid {...gradeProps} />
                          <XAxis dataKey="label" {...eixoProps} />
                          <YAxis width={48} {...eixoProps} />
                          <Tooltip {...tooltipProps} formatter={(v: number) => `${fmtMeses(v)} meses`} />
                          <Line type="monotone" dataKey="lt" name="LT da série" stroke={CORES_SERIE[0]} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Secao>
              </div>

              <Secao titulo="Como a série fechou nos últimos 12 meses?" descricao="Contratos ativos e ARPA da view; LT da série desde 07/2024.">
                <Card className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mês</TableHead>
                        <TableHead className="text-right">Contratos ativos</TableHead>
                        <TableHead className="text-right">ARPA (R$)</TableHead>
                        <TableHead className="text-right">LT da série (meses)</TableHead>
                        <TableHead className="text-right">LTV (R$)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumo.map((r) => (
                        <TableRow key={r.mes}>
                          <TableCell>{rotuloMes(r.mes)}</TableCell>
                          <TableCell className="num text-right">{r.contratos.toLocaleString("pt-BR")}</TableCell>
                          <TableCell className="num text-right">{fmtBRL(r.arpa)}</TableCell>
                          <TableCell className="num text-right">{fmtMeses(r.lt, 2)}</TableCell>
                          <TableCell className="num text-right font-medium">{fmtBRL(r.ltv)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </Secao>
            </>
          )}
        </>
      )}
    </div>
  );
}
