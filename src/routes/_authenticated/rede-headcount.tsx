import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
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
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { chaveMes, rotuloMes } from "@/lib/rede/mes";

// Contrato da tela: docs/design/contratos/rede-headcount.md (arquétipo
// Lista/Relatório). Em 24/09/2026 `headcount_mensal` tem 0 linhas: em
// produção a tela mostra o estado vazio até o super admin lançar.

type BuscaHeadcount = { mes?: string };

const RE_CHAVE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validarBusca(s: Record<string, unknown>): BuscaHeadcount {
  return typeof s.mes === "string" && RE_CHAVE.test(s.mes) ? { mes: s.mes } : {};
}

export const Route = createFileRoute("/_authenticated/rede-headcount")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: RedeHeadcountPage,
});

type HeadcountRow = {
  unidade: string;
  mes: string;
  headcount: number;
  admissoes: number;
  demissoes: number;
};

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  num_contratos: number | null;
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

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const fmtInt = (v: number) => v.toLocaleString("pt-BR");

// Turnover sem headcount não é 0%: é não apurado.
const turnoverDe = (demissoes: number, headcount: number) =>
  headcount > 0 ? (demissoes / headcount) * 100 : null;

function RedeHeadcountPage() {
  const [rows, setRows] = useState<HeadcountRow[]>([]);
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableExists, setTableExists] = useState(true);
  const [erroHc, setErroHc] = useState<string | null>(null);
  const [erroRecon, setErroRecon] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [mesUrl, setMesUrl] = useFiltroNaUrl("mes", "");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const [h, r] = await Promise.all([
        (supabase as any).from("headcount_mensal").select("unidade,mes,headcount,admissoes,demissoes").order("mes"),
        supabase.from("v_reconciliacao_mensal").select("mes,unidade,mrr_contratado,num_contratos").order("mes"),
      ]);
      if (!mounted) return;
      if (h.error?.code === "42P01" || h.error?.message?.includes("does not exist")) {
        setTableExists(false);
        setErroHc(null);
      } else {
        setTableExists(true);
        setErroHc(h.error ? h.error.message : null);
        setRows((h.data ?? []) as HeadcountRow[]);
      }
      setErroRecon(r.error ? r.error.message : null);
      setReconcRows((r.data ?? []) as ReconcRow[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [recarga]);

  const tentarDeNovo = () => setRecarga((n) => n + 1);

  // Mês normalizado: `date` da tabela e `timestamptz` da view viram "aaaa-mm"
  // e casam (antes o MRR por pessoa saía vazio).
  const linhas = useMemo(
    () =>
      rows
        .map((r) => ({ ...r, chave: chaveMes(r.mes) }))
        .filter((r): r is HeadcountRow & { chave: string } => !!r.chave),
    [rows],
  );

  const byMes = useMemo(() => {
    const map = new Map<
      string,
      { headcount: number; admissoes: number; demissoes: number; unidades: Set<string> }
    >();
    for (const r of linhas) {
      const cur =
        map.get(r.chave) ?? { headcount: 0, admissoes: 0, demissoes: 0, unidades: new Set<string>() };
      cur.headcount += r.headcount;
      cur.admissoes += r.admissoes;
      cur.demissoes += r.demissoes;
      cur.unidades.add(r.unidade);
      map.set(r.chave, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        label: rotuloMes(mes),
        headcount: v.headcount,
        admissoes: v.admissoes,
        demissoes: v.demissoes,
        lancaram: v.unidades.size,
        turnover: turnoverDe(v.demissoes, v.headcount),
      }));
  }, [linhas]);

  const reconcByMes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reconcRows) {
      const m = chaveMes(r.mes);
      if (!m) continue;
      map.set(m, (map.get(m) ?? 0) + (r.mrr_contratado ?? 0));
    }
    return map;
  }, [reconcRows]);

  const combinedChart = useMemo(
    () =>
      byMes.map((r) => {
        const mrr = reconcByMes.get(r.mes) ?? null;
        const receitaPerHead = mrr && r.headcount > 0 ? mrr / r.headcount : null;
        return { ...r, mrr, receitaPerHead };
      }),
    [byMes, reconcByMes],
  );

  const mesesLancados = byMes.map((m) => m.mes);
  // Padrão: o último mês lançado.
  const mesRef =
    mesUrl && mesesLancados.includes(mesUrl) ? mesUrl : mesesLancados[mesesLancados.length - 1];
  const doMes = combinedChart.find((m) => m.mes === mesRef);

  const totalUnidades = useMemo(() => {
    const s = new Set<string>();
    for (const r of linhas) s.add(r.unidade);
    for (const r of reconcRows) if (r.unidade) s.add(r.unidade);
    return s.size;
  }, [linhas, reconcRows]);

  // Última linha de cada unidade até o mês de referência, com o mês dela.
  const byUnidade = useMemo(() => {
    const map = new Map<string, HeadcountRow & { chave: string }>();
    for (const r of linhas) {
      if (mesRef && r.chave > mesRef) continue;
      const cur = map.get(r.unidade);
      if (!cur || r.chave > cur.chave) map.set(r.unidade, r);
    }
    return Array.from(map.values()).sort((a, b) => b.headcount - a.headcount);
  }, [linhas, mesRef]);

  const rotuloRef = mesRef ? rotuloMes(mesRef) : "—";

  const cabecalho = (
    <PageHeader
      titulo="Headcount"
      pergunta="Quantas pessoas cada unidade tem, e quanto o time gira?"
      descricao={`Unidades que lançaram headcount · ${mesRef ? rotuloRef : "sem mês lançado"} · pessoas, admissões e demissões lançadas à mão`}
      procedencia={{
        fonte: "headcount_mensal · v_reconciliacao_mensal",
        regua: "turnover = demissões ÷ headcount do mês",
      }}
      filtros={
        mesesLancados.length > 0 ? (
          <Select value={mesRef} onValueChange={(v) => setMesUrl(v)}>
            <SelectTrigger className="h-9 w-[140px]" aria-label="Mês de referência">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...mesesLancados].reverse().map((m) => (
                <SelectItem key={m} value={m}>
                  {rotuloMes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
    />
  );

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        {cabecalho}
        <Carregando variante="kpis" />
        <Carregando variante="grafico" />
      </div>
    );
  }

  if (!tableExists) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        {cabecalho}
        <EstadoErro
          titulo="A tabela de headcount não existe neste banco"
          detalhe="headcount_mensal não foi encontrada. Avise quem administra o Brain."
          tentarNovamente={tentarDeNovo}
        />
      </div>
    );
  }

  if (erroHc) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        {cabecalho}
        <EstadoErro detalhe={`headcount_mensal: ${erroHc}`} tentarNovamente={tentarDeNovo} />
      </div>
    );
  }

  if (byMes.length === 0) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        {cabecalho}
        <EstadoVazio
          titulo="Nenhuma unidade lançou headcount ainda."
          descricao="O lançamento é feito pelo super admin."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {cabecalho}

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo={`Headcount em ${rotuloRef}`}
          valor={doMes ? fmtInt(doMes.headcount) : "—"}
          unidade="pessoas"
          nota={doMes ? `${doMes.lancaram} de ${totalUnidades} unidades lançaram` : undefined}
          estado={doMes ? "ok" : "nao-apurado"}
        />
        <KpiCard
          rotulo={`Turnover em ${rotuloRef}`}
          valor={fmtPct(doMes?.turnover)}
          nota="demissões ÷ headcount"
          estado={doMes?.turnover != null ? "ok" : "nao-apurado"}
        />
        <KpiCard
          rotulo={`Admissões em ${rotuloRef}`}
          valor={doMes ? fmtInt(doMes.admissoes) : "—"}
          unidade="pessoas"
          estado={doMes ? "ok" : "nao-apurado"}
        />
        <KpiCard
          rotulo={`Demissões em ${rotuloRef}`}
          valor={doMes ? fmtInt(doMes.demissoes) : "—"}
          unidade="pessoas"
          estado={doMes ? "ok" : "nao-apurado"}
        />
      </KpiGrade>

      <div className="grid gap-6 lg:grid-cols-2">
        <Secao titulo="Quantas pessoas a rede tem por mês? (pessoas)" descricao="Soma das unidades que lançaram o mês.">
          <Card className="p-4">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={combinedChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gradeProps} />
                  <XAxis dataKey="label" {...eixoProps} />
                  <YAxis allowDecimals={false} width={48} {...eixoProps} />
                  <Tooltip {...tooltipProps} formatter={(v: number) => `${fmtInt(v)} pessoas`} />
                  <Bar dataKey="headcount" name="Headcount" fill={CORES_SERIE[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Secao>

        <Secao titulo="Quanto o time gira por mês? (%)" descricao="Demissões ÷ headcount. Mês com headcount 0 fica sem ponto.">
          <Card className="p-4">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={combinedChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gradeProps} />
                  <XAxis dataKey="label" {...eixoProps} />
                  <YAxis
                    width={56}
                    tickFormatter={(v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                    {...eixoProps}
                  />
                  <Tooltip {...tooltipProps} formatter={(v: number) => fmtPct(v)} />
                  <Line type="monotone" dataKey="turnover" name="Turnover" stroke={CORES_SERIE[0]} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Secao>

        <Secao titulo="Quantas pessoas entraram e saíram? (pessoas)" descricao="Admissões e demissões lançadas no mês.">
          <Card className="p-4">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={combinedChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gradeProps} />
                  <XAxis dataKey="label" {...eixoProps} />
                  <YAxis allowDecimals={false} width={48} {...eixoProps} />
                  <Tooltip {...tooltipProps} formatter={(v: number) => `${fmtInt(v)} pessoas`} />
                  <Legend {...legendaProps} />
                  <Bar dataKey="admissoes" name="Admissões" fill={CORES_SERIE[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="demissoes" name="Demissões" fill={CORES_SERIE[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Secao>

        <Secao titulo="Quanto MRR cada pessoa sustenta? (R$)" descricao="MRR por pessoa: MRR contratado da rede ÷ headcount do mês.">
          {erroRecon ? (
            <EstadoErro
              titulo="Fonte indisponível"
              detalhe={`v_reconciliacao_mensal: ${erroRecon}`}
              tentarNovamente={tentarDeNovo}
            />
          ) : (
            <Card className="p-4">
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combinedChart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="label" {...eixoProps} />
                    <YAxis width={80} tickFormatter={(v: number) => fmtBRLCompacto(v)} {...eixoProps} />
                    <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                    <Line type="monotone" dataKey="receitaPerHead" name="MRR por pessoa" stroke={CORES_SERIE[0]} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </Secao>
      </div>

      <Secao
        titulo={`Qual unidade gira mais? (até ${rotuloRef})`}
        descricao="Última linha lançada de cada unidade até o mês de referência, com o mês dela."
      >
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Headcount</TableHead>
                <TableHead className="text-right">Admissões</TableHead>
                <TableHead className="text-right">Demissões</TableHead>
                <TableHead className="text-right">Turnover</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byUnidade.map((r) => {
                const t = turnoverDe(r.demissoes, r.headcount);
                return (
                  <TableRow key={r.unidade}>
                    <TableCell className="font-medium">{r.unidade}</TableCell>
                    <TableCell>{rotuloMes(r.chave)}</TableCell>
                    <TableCell className="num text-right">{fmtInt(r.headcount)}</TableCell>
                    <TableCell className="num text-right">{fmtInt(r.admissoes)}</TableCell>
                    <TableCell className="num text-right">{fmtInt(r.demissoes)}</TableCell>
                    <TableCell className="num text-right">
                      {t == null ? <span className="text-muted-foreground">não apurado</span> : fmtPct(t)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </Secao>
    </div>
  );
}
