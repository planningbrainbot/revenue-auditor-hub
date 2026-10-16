import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { MolduraReceita, brlOuTraco } from "@/components/receita/moldura";
import {
  carregarDreCaixa,
  type Conferencia,
  type DreCaixa,
  type LinhaDre,
} from "@/lib/dre-caixa.functions";

// BI Financeiro da Partners (rota /dre-caixa). Contrato: docs/design/contratos/dre-caixa.md.
// Tudo vem pronto do retrato `ops.dre_caixa` (séries mensais); a tela soma pelo período
// escolhido (?de=&ate=) e compara com o período anterior de mesma duração.
// Na DRE despesa é negativa: variação > 0 sempre melhora o resultado, < 0 sempre piora.

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const brlSinal = (v: number) => (v > 0 ? "+" : "") + brlOuTraco(v);
const mil = (v: number) =>
  Math.abs(v) < 500 ? "0" : `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
const corVariacao = (v: number) =>
  Math.abs(v) < 1 ? "text-muted-foreground" : v > 0 ? "text-success" : "text-danger";
const somaIdx = (v: number[], idx: number[]) => idx.reduce((s, i) => s + (v[i] ?? 0), 0);

export function DreCaixaPagina() {
  const fn = useServerFn(carregarDreCaixa);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dre-caixa"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });

  return (
    <MolduraReceita
      titulo="BI Financeiro"
      pergunta="Como está o resultado da Partners, por que ele é diferente do caixa e o que mudou?"
      descricao="Planning Partners · competência da Partners · DRE pelas réguas de 15/10/2026, caixa pelo extrato de conta corrente do Omie."
      procedencia={
        data
          ? {
              fonte: "Omie da Partners, apuração do Ops e planilha Financeiro - Planning Partners",
              atualizadoEm: data.gravadoEm,
            }
          : undefined
      }
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-6">
        {isLoading ? (
          <Carregando variante="pagina" />
        ) : error ? (
          <EstadoErro detalhe={(error as Error).message} tentarNovamente={() => refetch()} />
        ) : !data || data.payload.meses.length === 0 ? (
          <EstadoVazio
            titulo="O retrato da DRE ainda não foi gerado"
            descricao="Ele é gravado por tools/dre_caixa_payload.py depois de montar as abas DRE e FCX."
          />
        ) : (
          <Bi D={data.payload} />
        )}
      </div>
    </MolduraReceita>
  );
}

// ---------------------------------------------------------------- período e abas

function Bi({ D }: { D: DreCaixa }) {
  const meses = D.meses;
  const ultimoFechado =
    [...meses].reverse().find((m) => !(D.situacao[m] ?? "").includes("andamento")) ??
    meses[meses.length - 1];
  const [deUrl, setDe] = useFiltroNaUrl("de", meses[0]);
  const [ateUrl, setAte] = useFiltroNaUrl("ate", ultimoFechado);
  const [aba, setAba] = useFiltroNaUrl("aba", "geral");
  let de = meses.includes(deUrl) ? deUrl : meses[0];
  let ate = meses.includes(ateUrl) ? ateUrl : ultimoFechado;
  if (de > ate) [de, ate] = [ate, de];
  const idx = meses.map((m, i) => (m >= de && m <= ate ? i : -1)).filter((i) => i >= 0);
  const n = idx.length;
  const idxAnt = idx.map((i) => i - n).filter((i) => i >= 0);
  const temAnterior = idxAnt.length === n;

  const definir = (a: string, b: string) => {
    setDe(a);
    setAte(b);
  };
  const atalhos: { rotulo: string; de: string; ate: string }[] = [
    { rotulo: "Ano", de: meses.find((m) => m.startsWith(ultimoFechado.slice(0, 4))) ?? meses[0], ate: ultimoFechado },
    { rotulo: "Último trimestre", de: meses[Math.max(0, meses.indexOf(ultimoFechado) - 2)], ate: ultimoFechado },
    { rotulo: "Último mês", de: ultimoFechado, ate: ultimoFechado },
    { rotulo: "Tudo, com o mês aberto", de: meses[0], ate: meses[meses.length - 1] },
  ];
  const provisorios = idx.map((i) => meses[i]).filter((m) => !(D.situacao[m] ?? "").startsWith("fechado"));

  return (
    <>
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-medium">Período</span>
        <SeletorMesSimples meses={meses} valor={de} aoMudar={(v) => definir(v, ate < v ? v : ate)} />
        <span className="text-sm text-muted-foreground">até</span>
        <SeletorMesSimples meses={meses} valor={ate} aoMudar={(v) => definir(de > v ? v : de, v)} />
        <div className="flex flex-wrap gap-1.5">
          {atalhos.map((a) => (
            <Button
              key={a.rotulo}
              size="sm"
              variant={a.de === de && a.ate === ate ? "default" : "outline"}
              onClick={() => definir(a.de, a.ate)}
            >
              {a.rotulo}
            </Button>
          ))}
        </div>
        {provisorios.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tom="atencao">Provisório</StatusBadge>
            {provisorios.map(rot).join(", ")} ainda não fechado
          </span>
        )}
      </Card>

      <Tabs value={aba} onValueChange={(v) => setAba(v)}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="dre">DRE</TabsTrigger>
          <TabsTrigger value="ponte">DRE × Caixa</TabsTrigger>
          <TabsTrigger value="variacao">Variação</TabsTrigger>
          <TabsTrigger value="midia">Mídia</TabsTrigger>
          <TabsTrigger value="midia-cac">Mídia × CAC</TabsTrigger>
          <TabsTrigger value="eficiencia">Eficiência</TabsTrigger>
          <TabsTrigger value="caixa">Caixa</TabsTrigger>
          <TabsTrigger value="conferencias">Conferências</TabsTrigger>
        </TabsList>
        <TabsContent value="geral" className="mt-4 flex flex-col gap-5">
          <VisaoGeral D={D} idx={idx} idxAnt={temAnterior ? idxAnt : null} />
        </TabsContent>
        <TabsContent value="dre" className="mt-4">
          <TabelaDre D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="ponte" className="mt-4 flex flex-col gap-5">
          <PonteCaixa D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="variacao" className="mt-4">
          {temAnterior ? (
            <Variacao D={D} idx={idx} idxAnt={idxAnt} />
          ) : (
            <EstadoVazio
              titulo="Sem período anterior para comparar"
              descricao="Escolha um período que tenha a mesma quantidade de meses antes dele."
            />
          )}
        </TabsContent>
        <TabsContent value="midia" className="mt-4 flex flex-col gap-5">
          <Midia D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="midia-cac" className="mt-4 flex flex-col gap-5">
          <MidiaCac D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="eficiencia" className="mt-4 flex flex-col gap-5">
          <Eficiencia D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="caixa" className="mt-4 flex flex-col gap-5">
          <Caixa D={D} idx={idx} />
        </TabsContent>
        <TabsContent value="conferencias" className="mt-4">
          <Conferencias D={D} idx={idx} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SeletorMesSimples({
  meses,
  valor,
  aoMudar,
}: {
  meses: string[];
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <Select value={valor} onValueChange={aoMudar}>
      <SelectTrigger className="h-8 w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {meses.map((m) => (
          <SelectItem key={m} value={m}>
            {rot(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Secao({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

function Abrir({ aberto }: { aberto: boolean }) {
  const I = aberto ? ChevronDown : ChevronRight;
  return <I className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

// ---------------------------------------------------------------- séries comuns

function useSeries(D: DreCaixa) {
  return useMemo(() => {
    const zero = D.meses.map(() => 0);
    const n2 = (pref: string) =>
      D.dre.filter((l) => l.nivel === 2 && l.k.startsWith(pref)).reduce(
        (a, l) => a.map((x, i) => x + l.v[i]),
        zero,
      );
    const n1 = (k: string) => D.dre.find((l) => l.nivel === 1 && l.k === k)?.v ?? zero;
    const n0 = (pref: string) => D.dre.find((l) => l.nivel === 0 && l.k.startsWith(pref))?.v ?? zero;
    const fcx = (pref: string) => {
      const l = D.fcx.resumo.find((x) => x.k.startsWith(pref));
      return D.meses.map((m) => {
        const j = D.fcx.meses.indexOf(m);
        return l && j >= 0 ? l.v[j] : 0;
      });
    };
    const bruta = n0("(+) RECEITA OPERACIONAL BRUTA");
    const unidades = ["Royalties (ap", "CSC das unidades", "CAC (ap", "Reembolso de mídia das unidades", "Outras receitas das unidades"]
      .map(n2)
      .reduce((a, v) => a.map((x, i) => x + v[i]), zero);
    const rateio = ["Rateio CSC Comercial", "Rateio Comissões"].map(n2).reduce((a, v) => a.map((x, i) => x + v[i]), zero);
    const reembOutras = n2("Reembolso de mídia das outras");
    const midia = n2("Mídia paga");
    const csc = ["CSC Comercial · custo total", "Comissões · total"].map(n2).reduce((a, v) => a.map((x, i) => x + v[i]), zero);
    const comercial = n1("Despesa Comercial e Marketing");
    return {
      bruta,
      unidades,
      rateio,
      reembOutras,
      outrasReceitas: bruta.map((x, i) => x - unidades[i] - rateio[i] - reembOutras[i]),
      deducoes: n0("(-) DEDUÇÕES"),
      liquida: n0("(=) RECEITA LÍQUIDA"),
      midia,
      csc,
      outrasComerciais: comercial.map((x, i) => x - midia[i] - csc[i]),
      pessoal: n1("Despesas com Pessoal"),
      adm: n1("Despesas Administrativas"),
      viagens: n1("Despesas de Viagens"),
      financeiras: n1("Despesas Financeiras / Bancos"),
      diretas: n1("Despesas Diretas"),
      despesas: n0("(-) DESPESAS OPERACIONAIS"),
      ebit: n0("(=) RESULTADO OPERACIONAL"),
      naoOp: n0("(+/-) RESULTADO NÃO OPERACIONAL"),
      periodo: n0("(=) RESULTADO DO PERÍODO"),
      semInv: n0("(=) RESULTADO DO PERÍODO SEM O INVESTIDOR"),
      investidor: n0("(-) Aporte do investidor"),
      cac: n2("CAC (ap"),
      reembUnid: n2("Reembolso de mídia das unidades"),
      caixa: fcx("(=) Resultado do mês"),
      caixaSemInv: fcx("(=) Resultado do mês sem o investidor"),
      saldo: fcx("(=) Saldo em conta (fim do mês)"),
      entradas: fcx("(+) Entradas"),
      saidas: fcx("(-) Saídas"),
    };
  }, [D]);
}

// ---------------------------------------------------------------- visão geral

function VisaoGeral({ D, idx, idxAnt }: { D: DreCaixa; idx: number[]; idxAnt: number[] | null }) {
  const S = useSeries(D);
  const t = (v: number[]) => somaIdx(v, idx);
  const delta = (v: number[]) => {
    if (!idxAnt) return undefined;
    const a = somaIdx(v, idxAnt);
    return a ? { valor: ((t(v) - a) / Math.abs(a)) * 100, rotulo: "vs período anterior" } : undefined;
  };
  const margem = t(S.liquida) ? (t(S.ebit) / t(S.liquida)) * 100 : 0;
  const saldoMidia = t(S.midia) + t(S.cac) + t(S.reembUnid) + t(S.reembOutras);
  const ultimo = idx[idx.length - 1];

  const mensal = idx.map((i) => ({
    r: rot(D.meses[i]),
    dre: Math.round(S.periodo[i]),
    caixa: Math.round(S.caixa[i]),
    ebit: Math.round(S.ebit[i]),
  }));
  const ponte = [
    { k: "Receita das unidades", v: t(S.unidades) },
    { k: "Rateio CSC e comissões (outras empresas)", v: t(S.rateio) },
    { k: "Reembolso de mídia (outras empresas)", v: t(S.reembOutras) },
    { k: "Outras receitas e deduções", v: t(S.outrasReceitas) + t(S.deducoes) },
    { k: "Mídia paga", v: t(S.midia) },
    { k: "CSC Comercial e comissões (custo cheio)", v: t(S.csc) },
    { k: "Outras despesas comerciais", v: t(S.outrasComerciais) },
    { k: "Pessoal", v: t(S.pessoal) },
    { k: "Administrativas", v: t(S.adm) },
    { k: "Viagens, bancos e diretas", v: t(S.viagens) + t(S.financeiras) + t(S.diretas) },
  ].map((x) => ({ ...x, v: Math.round(x.v) }));

  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard rotulo="Receita operacional bruta" valor={brlOuTraco(t(S.bruta))} delta={delta(S.bruta)} />
        <KpiCard
          rotulo="EBIT"
          valor={brlOuTraco(t(S.ebit))}
          nota={`margem ${margem.toFixed(1).replace(".", ",")}%`}
          tom={t(S.ebit) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Resultado do período"
          valor={brlOuTraco(t(S.periodo))}
          nota={`sem o investidor ${brlOuTraco(t(S.semInv))}`}
          tom={t(S.periodo) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Resultado do caixa"
          valor={brlOuTraco(t(S.caixa))}
          nota={`sem o investidor ${brlOuTraco(t(S.caixaSemInv))}`}
          tom={t(S.caixa) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Saldo em conta no fim do período"
          valor={brlOuTraco(S.saldo[ultimo])}
          nota={rot(D.meses[ultimo])}
        />
        <KpiCard
          rotulo="Saldo da mídia"
          valor={brlOuTraco(saldoMidia)}
          nota="retorno (CAC e reembolsos) − mídia paga"
          tom={saldoMidia >= 0 ? "sucesso" : "perigo"}
        />
      </KpiGrade>

      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Resultado da DRE e do caixa por mês" sub="DRE pelo resultado do período; caixa pelo extrato.">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={mensal} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="r" {...eixoProps} />
                <YAxis {...eixoProps} tickFormatter={mil} width={64} />
                <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
                <Legend {...legendaProps} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="dre" name="DRE" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
                <Bar dataKey="caixa" name="Caixa" fill={CORES_SERIE[1]} radius={3} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>
        <Secao titulo="EBIT por mês" sub="Resultado operacional, antes do não operacional.">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={mensal} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="r" {...eixoProps} />
                <YAxis {...eixoProps} tickFormatter={mil} width={64} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [brlOuTraco(v), "EBIT"]} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="ebit" name="EBIT" radius={3} isAnimationActive={false}>
                  {mensal.map((d) => (
                    <Cell key={d.r} fill={d.ebit >= 0 ? CORES_SERIE[0] : "var(--danger)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>
      </div>

      <Secao
        titulo="De onde vem e para onde vai o resultado"
        sub="Cada barra é quanto a linha soma ou tira do EBIT no período. Verde soma, vermelho tira."
      >
        <div className="h-[360px]">
          <ResponsiveContainer>
            <BarChart data={ponte} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} horizontal={false} vertical />
              <XAxis type="number" {...eixoProps} tickFormatter={mil} />
              <YAxis type="category" dataKey="k" {...eixoProps} width={250} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [brlOuTraco(v), ""]} separator="" />
              <ReferenceLine x={0} stroke="var(--border)" />
              <Bar dataKey="v" radius={3} isAnimationActive={false}>
                {ponte.map((d) => (
                  <Cell key={d.k} fill={d.v >= 0 ? CORES_SERIE[0] : "var(--danger)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-sm">
          EBIT do período: <span className="font-semibold">{brlOuTraco(t(S.ebit))}</span>
        </p>
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------- DRE

function TabelaDre({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const visiveis: { l: LinhaDre; temFilho: boolean; chave: string }[] = [];
  let paiConta = "";
  let paiGrupo = "";
  for (let n = 0; n < D.dre.length; n++) {
    const l = D.dre[n];
    const prox = D.dre[n + 1];
    const temFilho = !!prox && prox.nivel > l.nivel && !l.conferencia;
    if (l.nivel <= 1) {
      paiGrupo = `${l.bloco}|${l.k}`;
      paiConta = "";
      visiveis.push({ l, temFilho, chave: paiGrupo });
    } else if (l.nivel === 2) {
      paiConta = `${paiGrupo}|${l.k}`;
      if (abertos.has(paiGrupo)) visiveis.push({ l, temFilho, chave: paiConta });
    } else if (abertos.has(paiGrupo) && abertos.has(paiConta)) {
      visiveis.push({ l, temFilho: false, chave: `${paiConta}|${l.k}` });
    }
  }
  const liquida = D.dre.find((l) => l.k.startsWith("(=) RECEITA LÍQUIDA"));
  const ebit = D.dre.find((l) => l.k.startsWith("(=) RESULTADO OPERACIONAL"));

  return (
    <Secao
      titulo="DRE do período"
      sub="Clique no bloco ou no grupo para abrir as contas, e na conta para abrir fornecedores, unidades, empresas ou plataformas."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="sticky left-0 bg-card py-2 text-left font-medium">Linha</th>
              {idx.map((i) => (
                <th key={i} className="px-2 py-2 text-right font-medium">
                  {rot(D.meses[i])}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total do período</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(({ l, temFilho, chave }) => {
              const tot = l.pct
                ? liquida && ebit
                  ? somaIdx(ebit.v, idx) / (somaIdx(liquida.v, idx) || 1)
                  : 0
                : somaIdx(l.v, idx);
              const fmt = (v: number) =>
                l.pct ? `${(v * 100).toFixed(1).replace(".", ",")}%` : brlOuTraco(v);
              return (
                <tr
                  key={chave}
                  className={cn(
                    "border-b",
                    temFilho && "cursor-pointer hover:bg-muted/50",
                    l.nivel === 0 && "font-semibold",
                    l.nivel === 1 && "font-medium",
                    l.nivel === 3 && "text-xs text-muted-foreground",
                    l.conferencia && "italic text-muted-foreground",
                  )}
                  onClick={temFilho ? () => alternar(chave) : undefined}
                >
                  <td
                    className="sticky left-0 min-w-[280px] bg-card py-1.5"
                    style={{ paddingLeft: `${l.nivel * 14}px` }}
                  >
                    <span className="flex items-center gap-1.5">
                      {temFilho ? <Abrir aberto={abertos.has(chave)} /> : <span className="w-4" />}
                      {l.k}
                    </span>
                  </td>
                  {idx.map((i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right">
                      {fmt(l.v[i])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">{fmt(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

// ---------------------------------------------------------------- DRE x caixa

function PonteCaixa({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const meses = idx.map((i) => D.meses[i]).filter((m) => D.ponte[m]);
  const ids: string[] = [];
  const agg = new Map<string, { rotulo: string; explica: string; dre: number; caixa: number; efeito: number }>();
  let rd = 0;
  let rc = 0;
  for (const m of meses) {
    const p = D.ponte[m];
    rd += p.resultado_dre;
    rc += p.resultado_caixa;
    for (const d of p.degraus) {
      if (!agg.has(d.id)) {
        ids.push(d.id);
        agg.set(d.id, { rotulo: d.rotulo, explica: d.explica, dre: 0, caixa: 0, efeito: 0 });
      }
      const a = agg.get(d.id)!;
      a.dre += d.dre;
      a.caixa += d.caixa;
      a.efeito += d.efeito;
    }
  }
  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard rotulo="Resultado da DRE" valor={brlOuTraco(rd)} tom={rd >= 0 ? "sucesso" : "perigo"} />
        <KpiCard rotulo="Resultado do caixa" valor={brlOuTraco(rc)} tom={rc >= 0 ? "sucesso" : "perigo"} />
        <KpiCard rotulo="Diferença DRE × caixa" valor={brlSinal(rc - rd)} nota="explicada degrau a degrau abaixo" />
      </KpiGrade>
      <Secao
        titulo="Por que o caixa é diferente da DRE?"
        sub="Do resultado da DRE ao resultado do caixa no período, um degrau por motivo. Efeito positivo: o caixa ficou melhor que a DRE. Clique para ler o motivo."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Degrau</th>
                <th className="py-2 text-right font-medium">Na DRE</th>
                <th className="py-2 text-right font-medium">No caixa</th>
                <th className="py-2 text-right font-medium">Efeito</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b font-semibold">
                <td className="py-2">Resultado da DRE</td>
                <td />
                <td />
                <td className="py-2 text-right">{brlOuTraco(rd)}</td>
              </tr>
              {ids.map((id) => {
                const d = agg.get(id)!;
                const ab = aberto === id;
                return (
                  <FragmentoDegrau key={id} d={d} aberto={ab} alternar={() => setAberto(ab ? null : id)} />
                );
              })}
              <tr className="font-semibold">
                <td className="py-2">Resultado do caixa</td>
                <td />
                <td />
                <td className="py-2 text-right">{brlOuTraco(rc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Secao>
      <Secao titulo="Efeito de cada degrau, mês a mês" sub="Quanto cada motivo levou da DRE ao caixa em cada mês do período.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Degrau</th>
                {meses.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium">
                    {rot(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => (
                <tr key={id} className="border-b">
                  <td className="py-1.5">{agg.get(id)!.rotulo}</td>
                  {meses.map((m) => {
                    const e = D.ponte[m].degraus.find((x) => x.id === id)?.efeito ?? 0;
                    return (
                      <td key={m} className={cn("whitespace-nowrap px-2 py-1.5 text-right", corVariacao(e))}>
                        {brlSinal(e)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    </>
  );
}

function FragmentoDegrau({
  d,
  aberto,
  alternar,
}: {
  d: { rotulo: string; explica: string; dre: number; caixa: number; efeito: number };
  aberto: boolean;
  alternar: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={alternar}>
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            <Abrir aberto={aberto} />
            {d.rotulo}
          </span>
        </td>
        <td className="py-2 text-right">{brlOuTraco(d.dre)}</td>
        <td className="py-2 text-right">{brlOuTraco(d.caixa)}</td>
        <td className={cn("py-2 text-right font-medium", corVariacao(d.efeito))}>{brlSinal(d.efeito)}</td>
      </tr>
      {aberto && (
        <tr className="border-b bg-muted/30">
          <td colSpan={4} className="px-6 py-2 text-xs text-muted-foreground">
            {d.explica}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- variação

function Variacao({ D, idx, idxAnt }: { D: DreCaixa; idx: number[]; idxAnt: number[] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const per = (a: number[]) => `${rot(D.meses[a[0]])}${a.length > 1 ? ` a ${rot(D.meses[a[a.length - 1]])}` : ""}`;
  const contas = useMemo(() => {
    const filhos = new Map<string, LinhaDre[]>();
    let atual = "";
    for (const l of D.dre) {
      if (l.nivel === 2) atual = l.k;
      else if (l.nivel === 3 && atual) filhos.set(atual, [...(filhos.get(atual) ?? []), l]);
      else if (l.nivel < 2) atual = "";
    }
    return D.dre
      .filter((l) => l.nivel === 2 && l.ebit && !l.conferencia && !l.pct)
      .map((l) => ({
        l,
        a: somaIdx(l.v, idxAnt),
        b: somaIdx(l.v, idx),
        filhos: filhos.get(l.k) ?? [],
      }))
      .map((x) => ({ ...x, d: x.b - x.a }))
      .filter((x) => Math.abs(x.d) >= 1)
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  }, [D, idx, idxAnt]);
  const ebit = D.dre.find((l) => l.k.startsWith("(=) RESULTADO OPERACIONAL"))!;
  const ea = somaIdx(ebit.v, idxAnt);
  const eb = somaIdx(ebit.v, idx);
  const top = contas.slice(0, 15);
  const demais = eb - ea - top.reduce((s, x) => s + x.d, 0);

  return (
    <Secao
      titulo={`O que mudou de ${per(idxAnt)} para ${per(idx)}?`}
      sub="As 15 contas que mais mexeram no EBIT contra o período anterior de mesma duração. Verde melhora o resultado, vermelho piora. Clique para abrir por fornecedor, unidade, empresa ou plataforma."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Conta</th>
              <th className="py-2 text-right font-medium">{per(idxAnt)}</th>
              <th className="py-2 text-right font-medium">{per(idx)}</th>
              <th className="py-2 text-right font-medium">Variação</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b font-semibold">
              <td className="py-2">EBIT do período anterior</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(ea)}</td>
            </tr>
            {top.map(({ l, a, b, d, filhos }) => {
              const ab = aberto === l.k;
              const subs = filhos
                .map((f) => ({ f, a: somaIdx(f.v, idxAnt), b: somaIdx(f.v, idx) }))
                .map((x) => ({ ...x, d: x.b - x.a }))
                .filter((x) => Math.abs(x.d) >= 1)
                .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
                .slice(0, 12);
              return (
                <FragmentoConta
                  key={l.k}
                  l={l}
                  a={a}
                  b={b}
                  d={d}
                  aberto={ab}
                  podeAbrir={subs.length > 0}
                  alternar={() => setAberto(ab ? null : l.k)}
                  subs={subs}
                />
              );
            })}
            {Math.abs(demais) >= 1 && (
              <tr className="border-b">
                <td className="py-2 pl-6 text-muted-foreground">Demais contas</td>
                <td />
                <td />
                <td className={cn("py-2 text-right", corVariacao(demais))}>{brlSinal(demais)}</td>
              </tr>
            )}
            <tr className="border-b font-semibold">
              <td className="py-2">EBIT do período</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(eb)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2">Variação do EBIT</td>
              <td />
              <td />
              <td className={cn("py-2 text-right", corVariacao(eb - ea))}>{brlSinal(eb - ea)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function FragmentoConta({
  l,
  a,
  b,
  d,
  aberto,
  podeAbrir,
  alternar,
  subs,
}: {
  l: LinhaDre;
  a: number;
  b: number;
  d: number;
  aberto: boolean;
  podeAbrir: boolean;
  alternar: () => void;
  subs: { f: LinhaDre; a: number; b: number; d: number }[];
}) {
  return (
    <>
      <tr
        className={cn("border-b", podeAbrir && "cursor-pointer hover:bg-muted/50")}
        onClick={podeAbrir ? alternar : undefined}
      >
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            {podeAbrir ? <Abrir aberto={aberto} /> : <span className="w-4" />}
            <span>
              {l.k}
              <span className="ml-2 text-xs text-muted-foreground">{l.grupo || l.bloco}</span>
            </span>
          </span>
        </td>
        <td className="py-2 text-right">{brlOuTraco(a)}</td>
        <td className="py-2 text-right">{brlOuTraco(b)}</td>
        <td className={cn("py-2 text-right font-medium", corVariacao(d))}>{brlSinal(d)}</td>
      </tr>
      {aberto &&
        subs.map((x) => (
          <tr key={x.f.k} className="border-b bg-muted/30 text-xs">
            <td className="py-1.5 pl-10 text-muted-foreground">{x.f.k}</td>
            <td className="py-1.5 text-right">{brlOuTraco(x.a)}</td>
            <td className="py-1.5 text-right">{brlOuTraco(x.b)}</td>
            <td className={cn("py-1.5 text-right", corVariacao(x.d))}>{brlSinal(x.d)}</td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- mídia

function Midia({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const S = useSeries(D);
  const plataformas = useMemo(() => {
    const i0 = D.dre.findIndex((l) => l.nivel === 2 && l.k.startsWith("Mídia paga"));
    const out: LinhaDre[] = [];
    for (let n = i0 + 1; n < D.dre.length && D.dre[n].nivel === 3; n++) out.push(D.dre[n]);
    return out;
  }, [D]);
  const linhas = idx.map((i) => {
    const retorno = S.cac[i] + S.reembUnid[i] + S.reembOutras[i];
    return {
      i,
      r: rot(D.meses[i]),
      midia: S.midia[i],
      cac: S.cac[i],
      ru: S.reembUnid[i],
      ro: S.reembOutras[i],
      retorno,
      saldo: S.midia[i] + retorno,
      ebit: S.ebit[i],
    };
  });
  const T = linhas.reduce(
    (a, x) => ({
      midia: a.midia + x.midia,
      cac: a.cac + x.cac,
      ru: a.ru + x.ru,
      ro: a.ro + x.ro,
      retorno: a.retorno + x.retorno,
      saldo: a.saldo + x.saldo,
      ebit: a.ebit + x.ebit,
    }),
    { midia: 0, cac: 0, ru: 0, ro: 0, retorno: 0, saldo: 0, ebit: 0 },
  );
  const pct = (r: number, m: number) => (m ? `${Math.round((r / -m) * 100)}%` : "—");
  const parte = T.ebit < 0 && T.saldo < 0 ? Math.round((T.saldo / T.ebit) * 100) : null;
  const grafico = linhas.map((x) => ({
    r: x.r,
    midia: Math.round(-x.midia),
    retorno: Math.round(x.retorno),
    saldo: Math.round(x.saldo),
  }));

  return (
    <>
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Mídia paga" valor={brlOuTraco(T.midia)} nota="Meta e Google, 100% do grupo" />
        <KpiCard rotulo="Retorno da mídia" valor={brlOuTraco(T.retorno)} nota={`${pct(T.retorno, T.midia)} da mídia`} />
        <KpiCard
          rotulo="Saldo da mídia"
          valor={brlOuTraco(T.saldo)}
          nota={parte !== null ? `${parte}% do EBIT negativo do período` : "retorno − mídia"}
          tom={T.saldo >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="EBIT sem o saldo da mídia"
          valor={brlOuTraco(T.ebit - T.saldo)}
          nota="o resto da operação"
          tom={T.ebit - T.saldo >= 0 ? "sucesso" : "perigo"}
        />
      </KpiGrade>
      <Secao
        titulo="A mídia se paga?"
        sub="Mídia paga contra o que volta dela (CAC e reembolsos de mídia das unidades e das outras empresas). A linha é o saldo do mês."
      >
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={grafico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="midia" name="Mídia paga" fill={CORES_SERIE[3]} radius={3} isAnimationActive={false} />
              <Bar dataKey="retorno" name="Retorno" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
              <Line dataKey="saldo" name="Saldo" stroke="var(--danger)" strokeWidth={2} dot isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Mês</th>
                <th className="py-2 text-right font-medium">Mídia paga</th>
                <th className="py-2 text-right font-medium">CAC</th>
                <th className="py-2 text-right font-medium">Reembolso unidades</th>
                <th className="py-2 text-right font-medium">Reembolso outras empresas</th>
                <th className="py-2 text-right font-medium">Cobertura</th>
                <th className="py-2 text-right font-medium">Saldo da mídia</th>
                <th className="py-2 text-right font-medium">EBIT</th>
                <th className="py-2 text-right font-medium">EBIT sem o saldo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((x) => (
                <tr key={x.r} className="border-b">
                  <td className="py-1.5">{x.r}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.midia)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.cac)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.ru)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.ro)}</td>
                  <td className="py-1.5 text-right">{pct(x.retorno, x.midia)}</td>
                  <td className={cn("py-1.5 text-right", corVariacao(x.saldo))}>{brlSinal(x.saldo)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.ebit)}</td>
                  <td className={cn("py-1.5 text-right", corVariacao(x.ebit - x.saldo))}>
                    {brlOuTraco(x.ebit - x.saldo)}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2">Período</td>
                <td className="py-2 text-right">{brlOuTraco(T.midia)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.cac)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.ru)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.ro)}</td>
                <td className="py-2 text-right">{pct(T.retorno, T.midia)}</td>
                <td className={cn("py-2 text-right", corVariacao(T.saldo))}>{brlSinal(T.saldo)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.ebit)}</td>
                <td className={cn("py-2 text-right", corVariacao(T.ebit - T.saldo))}>
                  {brlOuTraco(T.ebit - T.saldo)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Secao>
      {plataformas.length > 0 && (
        <Secao titulo="Mídia por plataforma" sub="Faturas no mês de emissão.">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Plataforma</th>
                {idx.map((i) => (
                  <th key={i} className="px-2 py-2 text-right font-medium">
                    {rot(D.meses[i])}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Período</th>
              </tr>
            </thead>
            <tbody>
              {plataformas.map((p) => (
                <tr key={p.k} className="border-b">
                  <td className="py-1.5">{p.k}</td>
                  {idx.map((i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right">
                      {brlOuTraco(p.v[i])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {brlOuTraco(somaIdx(p.v, idx))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}
    </>
  );
}

// ---------------------------------------------------------------- mídia × CAC

/**
 * Resultado ou exposição de caixa? A mídia própria da Expansão (mídia paga − reembolsos de
 * mídia das unidades e das outras empresas) contra o CAC que as vendas do mesmo mês geraram.
 * Na DRE o CAC só entra quando é cobrado, meses depois da mídia; o que já foi gerado e ainda
 * não foi cobrado é descasamento de prazo, não ineficiência.
 */
function MidiaCac({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const S = useSeries(D);
  if (!D.cac)
    return (
      <EstadoVazio
        titulo="O retrato ainda não tem o CAC por venda"
        descricao="Ele entra na próxima rodada de tools/dre_caixa_payload.py."
      />
    );
  let exposicao = 0;
  const linhas = idx.map((i) => {
    const m = D.meses[i];
    const c = D.cac?.[m] ?? { vendas: 0, cobrado: 0, a_cobrar: 0, estimado: 0, churn: 0 };
    const propria = -(S.midia[i] + S.reembUnid[i] + S.reembOutras[i]);
    const gerado = c.cobrado + c.a_cobrar + c.estimado;
    exposicao += propria - c.cobrado;
    return { m, r: rot(m), propria, ...c, gerado, exposicao };
  });
  const T = linhas.reduce(
    (a, x) => ({
      propria: a.propria + x.propria,
      vendas: a.vendas + x.vendas,
      cobrado: a.cobrado + x.cobrado,
      a_cobrar: a.a_cobrar + x.a_cobrar,
      estimado: a.estimado + x.estimado,
      gerado: a.gerado + x.gerado,
    }),
    { propria: 0, vendas: 0, cobrado: 0, a_cobrar: 0, estimado: 0, gerado: 0 },
  );
  const cobertura = T.propria > 0 ? Math.round((T.gerado / T.propria) * 100) : null;
  const aReceber = T.a_cobrar + T.estimado;
  // Decomposição do EBIT do período: saldo da mídia (DRE) e o resto da operação.
  const ebit = somaIdx(S.ebit, idx);
  const saldoMidia =
    somaIdx(S.midia, idx) + somaIdx(S.cac, idx) + somaIdx(S.reembUnid, idx) + somaIdx(S.reembOutras, idx);
  const prazo = saldoMidia < 0 ? Math.min(-saldoMidia, aReceber) : 0;
  const midiaSemCobertura = saldoMidia < 0 ? -saldoMidia - prazo : 0;
  const estrutura = ebit - saldoMidia;
  const grafico = linhas.map((x) => ({
    r: x.r,
    propria: Math.round(x.propria),
    cobrado: Math.round(x.cobrado),
    a_cobrar: Math.round(x.a_cobrar),
    estimado: Math.round(x.estimado),
    exposicao: Math.round(x.exposicao),
  }));

  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Mídia própria da Expansão"
          valor={brlOuTraco(T.propria)}
          nota="mídia paga − reembolsos de mídia das unidades e das outras empresas"
        />
        <KpiCard
          rotulo="CAC gerado pelas vendas"
          valor={brlOuTraco(T.gerado)}
          nota={`${T.vendas} vendas · ${cobertura !== null ? `${cobertura}% da mídia própria` : "—"}`}
          tom={cobertura !== null && cobertura >= 100 ? "sucesso" : "atencao"}
        />
        <KpiCard
          rotulo="CAC a receber"
          valor={brlOuTraco(aReceber)}
          nota={`${brlOuTraco(T.a_cobrar)} com card · ${brlOuTraco(T.estimado)} estimado pelo MRR`}
        />
      </KpiGrade>

      <Secao
        titulo="O problema é de resultado ou de caixa?"
        sub="O EBIT do período separado em três partes. A mídia que o CAC a receber ainda vai cobrir é prazo, e pesa no caixa. O resto pesa no resultado."
      >
        <table className="w-full text-sm tabular-nums">
          <tbody>
            <tr className="border-b">
              <td className="py-2">Saldo da mídia que o CAC a receber cobre</td>
              <td className="py-2 text-muted-foreground">exposição de caixa: o dinheiro sai antes e volta com a cobrança do CAC</td>
              <td className="py-2 text-right font-medium text-warning">{brlOuTraco(-prazo)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">Saldo da mídia sem CAC para cobrir</td>
              <td className="py-2 text-muted-foreground">resultado: mídia que não volta</td>
              <td className={cn("py-2 text-right font-medium", corVariacao(-midiaSemCobertura))}>
                {brlOuTraco(-midiaSemCobertura)}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-2">Resto da operação</td>
              <td className="py-2 text-muted-foreground">resultado: CSC, pessoal e administrativas contra royalties e CSC das unidades</td>
              <td className={cn("py-2 text-right font-medium", corVariacao(estrutura))}>{brlOuTraco(estrutura)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2">EBIT do período</td>
              <td />
              <td className="py-2 text-right">{brlOuTraco(ebit)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          O CAC a receber depende de o cliente pagar o 1º honorário (a 2ª parcela só é cobrada depois) e de não
          haver churn antes dele. O estimado usa o MRR da venda até o card ter o honorário.
        </p>
      </Secao>

      <Secao
        titulo="Mídia própria × CAC gerado, por mês"
        sub="Barras: a mídia do mês e o CAC das vendas do mês (cobrado, a cobrar e estimado). Linha: exposição de caixa acumulada (mídia própria − CAC já cobrado)."
      >
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={grafico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="propria" name="Mídia própria" fill={CORES_SERIE[3]} radius={3} isAnimationActive={false} />
              <Bar dataKey="cobrado" name="CAC cobrado" stackId="cac" fill={CORES_SERIE[0]} isAnimationActive={false} />
              <Bar dataKey="a_cobrar" name="CAC a cobrar" stackId="cac" fill={CORES_SERIE[1]} isAnimationActive={false} />
              <Bar dataKey="estimado" name="CAC estimado" stackId="cac" fill={CORES_SERIE[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line dataKey="exposicao" name="Exposição acumulada" stroke="var(--danger)" strokeWidth={2} dot isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Mês</th>
                <th className="py-2 text-right font-medium">Mídia própria</th>
                <th className="py-2 text-right font-medium">Vendas</th>
                <th className="py-2 text-right font-medium">CAC cobrado</th>
                <th className="py-2 text-right font-medium">A cobrar</th>
                <th className="py-2 text-right font-medium">Estimado</th>
                <th className="py-2 text-right font-medium">CAC gerado</th>
                <th className="py-2 text-right font-medium">Cobertura</th>
                <th className="py-2 text-right font-medium">Exposição acumulada</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((x) => (
                <tr key={x.m} className="border-b">
                  <td className="py-1.5">{x.r}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.propria)}</td>
                  <td className="py-1.5 text-right">{x.vendas}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.cobrado)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.a_cobrar)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.estimado)}</td>
                  <td className="py-1.5 text-right font-medium">{brlOuTraco(x.gerado)}</td>
                  <td className="py-1.5 text-right">
                    {x.propria > 0 ? `${Math.round((x.gerado / x.propria) * 100)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.exposicao)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2">Período</td>
                <td className="py-2 text-right">{brlOuTraco(T.propria)}</td>
                <td className="py-2 text-right">{T.vendas}</td>
                <td className="py-2 text-right">{brlOuTraco(T.cobrado)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.a_cobrar)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.estimado)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.gerado)}</td>
                <td className="py-2 text-right">{cobertura !== null ? `${cobertura}%` : "—"}</td>
                <td className="py-2 text-right">{brlOuTraco(linhas[linhas.length - 1]?.exposicao)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------- eficiência

/**
 * Onde está a ineficiência fora da mídia. Duas leituras:
 * 1. Receita recorrente (royalties, CSC fixo, outras) contra a estrutura que ela sustenta, em %.
 * 2. Custo pleno de aquisição (mídia própria + parte da Partners no CSC Comercial e nas
 *    comissões) contra o CAC que as vendas geram: o CAC é 1 honorário e cobre só a mídia;
 *    o time comercial fica na conta da receita recorrente.
 */
function Eficiencia({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const S = useSeries(D);
  const zero = D.meses.map(() => 0);
  const n2 = (pref: string) =>
    D.dre
      .filter((l) => l.nivel === 2 && l.k.startsWith(pref))
      .reduce((a, l) => a.map((x, i) => x + l.v[i]), zero);
  const soma = (...vs: number[][]) => zero.map((_, i) => vs.reduce((s, v) => s + v[i], 0));
  const royalties = n2("Royalties (ap");
  const cscFixo = n2("CSC das unidades");
  const outras = soma(n2("Outras receitas das unidades"), S.outrasReceitas, S.deducoes);
  const recorrente = soma(royalties, cscFixo, outras);
  const cscParte = soma(n2("CSC Comercial · custo total"), n2("Rateio CSC Comercial"));
  const comParte = soma(n2("Comissões · total"), n2("Rateio Comissões"));
  const vbd = soma(S.viagens, S.financeiras, S.diretas);
  const linhas: { k: string; v: number[]; grupo: "receita" | "aquisicao" | "operacao" }[] = [
    { k: "Royalties", v: royalties, grupo: "receita" },
    { k: "CSC fixo das unidades", v: cscFixo, grupo: "receita" },
    { k: "Outras receitas e deduções", v: outras, grupo: "receita" },
    { k: "CSC Comercial · parte da Partners", v: cscParte, grupo: "aquisicao" },
    { k: "Comissões · parte da Partners", v: comParte, grupo: "aquisicao" },
    { k: "Outras despesas comerciais", v: S.outrasComerciais, grupo: "aquisicao" },
    { k: "Pessoal", v: S.pessoal, grupo: "operacao" },
    { k: "Administrativas", v: S.adm, grupo: "operacao" },
    { k: "Viagens, bancos e diretas", v: vbd, grupo: "operacao" },
  ];
  const t = (v: number[]) => somaIdx(v, idx);
  const R = t(recorrente);
  const pct = (v: number) => (R ? `${Math.round((v / R) * 100)}%` : "—");
  const aquisicao = soma(cscParte, comParte, S.outrasComerciais);
  const operacao = soma(S.pessoal, S.adm, vbd);
  const semMidia = soma(recorrente, aquisicao, operacao);

  // Custo pleno de aquisição × CAC gerado
  const midiaPropria = zero.map((_, i) => -(S.midia[i] + S.reembUnid[i] + S.reembOutras[i]));
  const custoPleno = t(midiaPropria) - t(cscParte) - t(comParte) - t(S.outrasComerciais);
  const cac = idx.reduce(
    (a, i) => {
      const c = D.cac?.[D.meses[i]];
      return c ? { vendas: a.vendas + c.vendas, gerado: a.gerado + c.cobrado + c.a_cobrar + c.estimado } : a;
    },
    { vendas: 0, gerado: 0 },
  );
  const porVenda = (v: number) => (cac.vendas ? brlOuTraco(v / cac.vendas) : "—");

  const grafico = idx.map((i) => ({
    r: rot(D.meses[i]),
    recorrente: Math.round(recorrente[i]),
    aquisicao: Math.round(-aquisicao[i]),
    operacao: Math.round(-operacao[i]),
    resultado: Math.round(semMidia[i]),
  }));

  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard rotulo="Receita recorrente" valor={brlOuTraco(R)} nota="royalties, CSC fixo e outras" />
        <KpiCard
          rotulo="Máquina comercial paga pela Partners"
          valor={brlOuTraco(t(aquisicao))}
          nota={`${pct(-t(aquisicao))} da receita recorrente · CSC, comissões e outras comerciais`}
          tom="perigo"
        />
        <KpiCard
          rotulo="Operação da Partners"
          valor={brlOuTraco(t(operacao))}
          nota={`${pct(-t(operacao))} da receita recorrente · pessoal, administrativas e viagens`}
        />
      </KpiGrade>

      <Secao
        titulo="A receita recorrente sustenta a estrutura?"
        sub="Sem a mídia: o que entra de royalties e CSC fixo contra o que a Partners gasta com a máquina comercial (sua parte no CSC e nas comissões) e com a própria operação. % sobre a receita recorrente."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Linha</th>
                {idx.map((i) => (
                  <th key={i} className="px-2 py-2 text-right font-medium">
                    {rot(D.meses[i])}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Período</th>
                <th className="px-2 py-2 text-right font-medium">% da receita</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, n) => (
                <FragmentoEficiencia
                  key={l.k}
                  l={l}
                  idx={idx}
                  pct={pct(t(l.v))}
                  total={
                    n === 2
                      ? { k: "= Receita recorrente", v: recorrente, pct: "100%" }
                      : n === 5
                        ? { k: "= Máquina comercial", v: aquisicao, pct: pct(t(aquisicao)) }
                        : n === 8
                          ? { k: "= Operação", v: operacao, pct: pct(t(operacao)) }
                          : null
                  }
                />
              ))}
              <tr className="font-semibold">
                <td className="py-2">EBIT sem a mídia</td>
                {idx.map((i) => (
                  <td key={i} className={cn("whitespace-nowrap px-2 py-2 text-right", corVariacao(semMidia[i]))}>
                    {brlOuTraco(semMidia[i])}
                  </td>
                ))}
                <td className={cn("px-2 py-2 text-right", corVariacao(t(semMidia)))}>{brlOuTraco(t(semMidia))}</td>
                <td className="px-2 py-2 text-right">{pct(t(semMidia))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={grafico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="recorrente" name="Receita recorrente" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
              <Bar dataKey="aquisicao" name="Máquina comercial" stackId="c" fill={CORES_SERIE[3]} isAnimationActive={false} />
              <Bar dataKey="operacao" name="Operação" stackId="c" fill={CORES_SERIE[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line dataKey="resultado" name="EBIT sem a mídia" stroke="var(--danger)" strokeWidth={2} dot isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Secao>

      <Secao
        titulo="Quanto custa vender um cliente, e quanto o CAC devolve?"
        sub="Custo pleno de aquisição = mídia própria da Expansão + a parte da Partners no CSC Comercial e nas comissões. O CAC cobrado das unidades é 1 honorário por venda."
      >
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium" />
              <th className="py-2 text-right font-medium">Período</th>
              <th className="py-2 text-right font-medium">Por venda ({cac.vendas} vendas)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-2">Mídia própria da Expansão</td>
              <td className="py-2 text-right">{brlOuTraco(t(midiaPropria))}</td>
              <td className="py-2 text-right">{porVenda(t(midiaPropria))}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">CSC Comercial · parte da Partners</td>
              <td className="py-2 text-right">{brlOuTraco(-t(cscParte))}</td>
              <td className="py-2 text-right">{porVenda(-t(cscParte))}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">Comissões e outras comerciais · parte da Partners</td>
              <td className="py-2 text-right">{brlOuTraco(-t(comParte) - t(S.outrasComerciais))}</td>
              <td className="py-2 text-right">{porVenda(-t(comParte) - t(S.outrasComerciais))}</td>
            </tr>
            <tr className="border-b font-semibold">
              <td className="py-2">Custo pleno de aquisição</td>
              <td className="py-2 text-right">{brlOuTraco(custoPleno)}</td>
              <td className="py-2 text-right">{porVenda(custoPleno)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">CAC gerado pelas vendas (cobrado + a cobrar + estimado)</td>
              <td className="py-2 text-right">{brlOuTraco(cac.gerado)}</td>
              <td className="py-2 text-right">{porVenda(cac.gerado)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2">O CAC devolve</td>
              <td className="py-2 text-right">
                {custoPleno > 0 ? `${Math.round((cac.gerado / custoPleno) * 100)}% do custo pleno` : "—"}
              </td>
              <td className={cn("py-2 text-right", corVariacao(cac.gerado - custoPleno))}>
                {porVenda(cac.gerado - custoPleno)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          O CAC de 1 honorário cobre a mídia, mas não o time comercial. A diferença sai da receita recorrente. As vendas
          do período são as do funil de CAC (inside sales elegíveis, sem churn).
        </p>
      </Secao>
    </>
  );
}

function FragmentoEficiencia({
  l,
  idx,
  pct,
  total,
}: {
  l: { k: string; v: number[] };
  idx: number[];
  pct: string;
  total: { k: string; v: number[]; pct: string } | null;
}) {
  return (
    <>
      <tr className="border-b">
        <td className="py-1.5 pl-4">{l.k}</td>
        {idx.map((i) => (
          <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right">
            {brlOuTraco(l.v[i])}
          </td>
        ))}
        <td className="whitespace-nowrap px-2 py-1.5 text-right">{brlOuTraco(somaIdx(l.v, idx))}</td>
        <td className="px-2 py-1.5 text-right text-muted-foreground">{pct}</td>
      </tr>
      {total && (
        <tr className="border-b bg-muted/30 font-medium">
          <td className="py-1.5">{total.k}</td>
          {idx.map((i) => (
            <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right">
              {brlOuTraco(total.v[i])}
            </td>
          ))}
          <td className="whitespace-nowrap px-2 py-1.5 text-right">{brlOuTraco(somaIdx(total.v, idx))}</td>
          <td className="px-2 py-1.5 text-right">{total.pct}</td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- caixa

function Caixa({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const S = useSeries(D);
  const jIdx = idx.map((i) => D.fcx.meses.indexOf(D.meses[i])).filter((j) => j >= 0);
  const tot = (v: number[]) => jIdx.reduce((s, j) => s + (v[j] ?? 0), 0);
  const ultimo = idx[idx.length - 1];
  const grafico = idx.map((i) => ({
    r: rot(D.meses[i]),
    entradas: Math.round(S.entradas[i]),
    saidas: Math.round(-S.saidas[i]),
    saldo: Math.round(S.saldo[i]),
  }));
  const bloco = (titulo: string, linhas: { k: string; v: number[] }[], sinal: number) => {
    const ord = linhas
      .map((l) => ({ k: l.k, t: tot(l.v), v: l.v }))
      .filter((x) => Math.abs(x.t) >= 1)
      .sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
    return (
      <Secao titulo={titulo}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Categoria</th>
                {jIdx.map((j) => (
                  <th key={j} className="px-2 py-2 text-right font-medium">
                    {rot(D.fcx.meses[j])}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Período</th>
              </tr>
            </thead>
            <tbody>
              {ord.map((x) => (
                <tr key={x.k} className="border-b">
                  <td className="min-w-[240px] py-1.5">{x.k}</td>
                  {jIdx.map((j) => (
                    <td key={j} className="whitespace-nowrap px-2 py-1.5 text-right">
                      {brlOuTraco(sinal * x.v[j])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">{brlOuTraco(sinal * x.t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    );
  };
  return (
    <>
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Entradas" valor={brlOuTraco(somaIdx(S.entradas, idx))} />
        <KpiCard rotulo="Saídas" valor={brlOuTraco(somaIdx(S.saidas, idx))} />
        <KpiCard
          rotulo="Resultado do caixa"
          valor={brlOuTraco(somaIdx(S.caixa, idx))}
          nota={`sem o investidor ${brlOuTraco(somaIdx(S.caixaSemInv, idx))}`}
          tom={somaIdx(S.caixa, idx) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard rotulo="Saldo em conta no fim" valor={brlOuTraco(S.saldo[ultimo])} nota={rot(D.meses[ultimo])} />
      </KpiGrade>
      <Secao titulo="Entradas, saídas e saldo por mês" sub="Extrato de conta corrente; transferências entre contas próprias e lançamentos previstos fora.">
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={grafico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
              <Legend {...legendaProps} />
              <Bar dataKey="entradas" name="Entradas" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
              <Bar dataKey="saidas" name="Saídas" fill={CORES_SERIE[3]} radius={3} isAnimationActive={false} />
              <Line dataKey="saldo" name="Saldo em conta" stroke={CORES_SERIE[2]} strokeWidth={2} dot isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Secao>
      {bloco("Entradas por categoria", D.fcx.entradas, 1)}
      {bloco("Saídas por categoria", D.fcx.saidas, 1)}
    </>
  );
}

// ---------------------------------------------------------------- conferências

const TOM: Record<Conferencia["tom"], TomStatus> = { perigo: "perigo", atencao: "atencao", info: "info" };
const ORDEM = ["perigo", "atencao", "info"];

function Conferencias({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [verInfo, setVerInfo] = useState(false);
  const meses = [...idx].reverse().map((i) => D.meses[i]);
  return (
    <Secao
      titulo="O que falta conferir no período"
      sub="Pendências e lançamentos fora do lugar, do mês mais recente para o mais antigo. Clique para ver a lista."
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={verInfo} onChange={(e) => setVerInfo(e.target.checked)} />
        mostrar os informativos (o que saiu da DRE por já estar no CSC, nas comissões ou na mídia)
      </label>
      {meses.map((m) => {
        const itens = (D.conferencias[m] ?? [])
          .filter((c) => verInfo || c.tom !== "info")
          .sort((a, b) => ORDEM.indexOf(a.tom) - ORDEM.indexOf(b.tom));
        const sit = D.situacao[m] ?? "";
        return (
          <div key={m} className="border-t pt-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
              {rot(m)}
              <StatusBadge tom={sit.startsWith("fechado") ? "sucesso" : "atencao"}>
                {sit.startsWith("fechado") ? "fechado" : "provisório"}
              </StatusBadge>
              {!sit.startsWith("fechado") && (
                <span className="text-xs font-normal text-muted-foreground">{sit.replace(/^provisório:\s*/, "")}</span>
              )}
            </div>
            {itens.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada pendente.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {itens.map((c, n) => {
                  const chave = `${m}-${n}`;
                  return (
                    <li key={chave} className="py-2">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 text-left text-sm"
                        onClick={() => setAberto(aberto === chave ? null : chave)}
                      >
                        <span className="flex items-center gap-2">
                          <Abrir aberto={aberto === chave} />
                          <StatusBadge tom={TOM[c.tom]}>
                            {c.tom === "info" ? "Informativo" : c.tom === "perigo" ? "Falta" : "Conferir"}
                          </StatusBadge>
                          {c.titulo}
                        </span>
                        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {Math.abs(c.valor) >= 1 ? brlOuTraco(c.valor) : `${c.itens.length} itens`}
                        </span>
                      </button>
                      {aberto === chave && (
                        <div className="mt-2 pl-6">
                          {c.dono && <p className="mb-1 text-xs text-muted-foreground">Quem resolve: {c.dono}</p>}
                          <table className="w-full text-xs tabular-nums">
                            <tbody>
                              {c.itens.map((it, k) => (
                                <tr key={k} className="border-t">
                                  <td className="py-1">{it.nome}</td>
                                  <td className="py-1 text-muted-foreground">{it.obs}</td>
                                  <td className="py-1 text-right">
                                    {Math.abs(it.valor) >= 1 ? brlOuTraco(it.valor) : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </Secao>
  );
}
