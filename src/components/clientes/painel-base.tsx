// Painel da Base (Pedro, 15/10/2026: "dashboards lindos e sexys que vão mostrar a base por unidade e outros
// indicadores importantes, pra instagramar"). Tudo sai da regra de cliente gravada na ficha (`base.situacao`) e do
// cadastro da conta; nenhum número é recalculado aqui de outro jeito. Cada barra de unidade abre a lista filtrada.
import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard, KpiGrade, Secao } from "@/components/planning";
import { FOCO_VISIVEL, number } from "@/components/monetizacao/common";
import {
  CORES_SERIE,
  COR_NEUTRA,
  eixoProps,
  gradeProps,
  legendaProps,
  RAIO_BARRA_HORIZONTAL,
  tooltipProps,
} from "@/lib/planning/grafico";
import { ehCliente, ehExCliente } from "@/lib/clientes/regra-cliente";
import type { Conta } from "@/lib/monetizacao/types";

/** Os quatro graus, do mais certo ao menos, num verde só (a cor diz a certeza; a ordem, o grau). */
const GRAUS = [
  { chave: "g4", rotulo: "Pagamento visto", forca: 100 },
  { chave: "g3", rotulo: "Prova de cliente", forca: 72 },
  { chave: "g2", rotulo: "Base Antiga sem prova", forca: 48 },
  { chave: "g1", rotulo: "Base Nova sem prova", forca: 28 },
] as const;

type Unidade = { key: string; name: string; account_keys: string[] };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** As N maiores categorias e o resto em "Outros" (DESIGN.md §5: a 7ª série vira Outros). */
function topComOutros(contagem: Map<string, number>, n: number) {
  const ordem = [...contagem].sort((a, b) => b[1] - a[1]);
  const topo = ordem.slice(0, n).map(([nome, valor]) => ({ nome, valor }));
  const resto = ordem.slice(n).reduce((s, [, v]) => s + v, 0);
  return resto ? [...topo, { nome: "Outros", valor: resto }] : topo;
}

function Cartao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

export function PainelBase({
  contas,
  unidades,
  aoAbrirUnidade,
  aoAbrirContratos,
}: {
  contas: Conta[];
  unidades: Unidade[];
  aoAbrirUnidade: (u: { key: string; name: string }) => void;
  aoAbrirContratos: () => void;
}) {
  const dados = useMemo(() => {
    const clientes = contas.filter(ehCliente);
    const ex = contas.filter(ehExCliente);
    const porChave = new Map(contas.map((a) => [a.key, a]));
    const grau = (a: Conta) => a.base?.situacao?.grau ?? 0;
    const visto = clientes.filter((a) => grau(a) === 4).length;
    const antigas = clientes.filter((a) => a.base?.origin === "antiga").length;
    // Clientes por unidade, empilhados por grau. A conta de duas unidades conta nas duas (como no cadastro).
    const porUnidade = unidades
      .map((u) => {
        const doGrau = { g4: 0, g3: 0, g2: 0, g1: 0 } as Record<string, number>;
        let total = 0;
        let inativos = 0;
        for (const k of u.account_keys) {
          const a = porChave.get(k);
          if (!a) continue;
          if (ehExCliente(a)) inativos += 1;
          if (!ehCliente(a)) continue;
          doGrau[`g${grau(a) || 1}`] += 1;
          total += 1;
        }
        return { key: u.key, nome: u.name, total, inativos, ...doGrau };
      })
      .filter((l) => l.total > 0)
      .sort((a, b) => b.total - a.total);
    const regime = new Map<string, number>();
    const segmento = new Map<string, number>();
    const faixa = new Map<string, number>();
    const quemFatura = new Map<string, number>();
    for (const a of clientes) {
      const r = a.regime?.trim() || "Regime a confirmar";
      regime.set(r, (regime.get(r) ?? 0) + 1);
      const s = a.segment?.trim();
      if (s) segmento.set(s, (segmento.get(s) ?? 0) + 1);
      const f = a.band?.trim();
      if (f) faixa.set(f, (faixa.get(f) ?? 0) + 1);
      for (const e of a.base?.prova?.faturado_por ?? [])
        quemFatura.set(e, (quemFatura.get(e) ?? 0) + 1);
    }
    return {
      clientes: clientes.length,
      ex: ex.length,
      visto,
      antigas,
      novas: clientes.length - antigas,
      porUnidade,
      regime: topComOutros(regime, 5),
      segmento: topComOutros(segmento, 7),
      faixa: topComOutros(faixa, 6),
      quemFatura: topComOutros(quemFatura, 6),
      semSegmento: clientes.length - [...segmento.values()].reduce((s, v) => s + v, 0),
      semFaixa: clientes.length - [...faixa.values()].reduce((s, v) => s + v, 0),
    };
  }, [contas, unidades]);

  const alturaUnidades = Math.max(220, dados.porUnidade.length * 34 + 40);
  const barrasHorizontais = (linhas: { nome: string; valor: number }[], cor: string) => (
    <ResponsiveContainer width="100%" height={Math.max(180, linhas.length * 30 + 30)}>
      <BarChart data={linhas} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
        <CartesianGrid {...gradeProps} horizontal={false} vertical />
        <XAxis type="number" {...eixoProps} allowDecimals={false} />
        <YAxis type="category" dataKey="nome" {...eixoProps} width={170} interval={0} />
        <Tooltip {...tooltipProps} formatter={(v: number) => [number(v), "clientes"]} />
        <Bar
          dataKey="valor"
          radius={RAIO_BARRA_HORIZONTAL}
          label={{ position: "right", fill: "var(--foreground)", fontSize: 12 }}
        >
          {linhas.map((l) => (
            <Cell key={l.nome} fill={l.nome === "Outros" ? COR_NEUTRA : cor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div className="space-y-6">
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Clientes ativos"
          valor={number(dados.clientes)}
          nota="Clientes pela regra de cliente"
        />
        <KpiCard
          rotulo="Com pagamento visto"
          valor={`${pct(dados.visto, dados.clientes)}%`}
          nota={`${number(dados.visto)} com recebimento, contrato ativo ou faturamento recente`}
        />
        <KpiCard
          rotulo="Base Antiga · Base Nova"
          valor={`${number(dados.antigas)} · ${number(dados.novas)}`}
          nota={`${pct(dados.antigas, dados.clientes)}% dos clientes vêm da Base Antiga`}
        />
        <KpiCard
          rotulo="Inativos"
          valor={number(dados.ex)}
          nota="Distrato concluído na Central de Tratativas"
          abrir={{ rotulo: "Contratos e churn", onClick: aoAbrirContratos }}
        />
      </KpiGrade>

      <Secao
        titulo="Clientes por unidade"
        descricao="Cada barra é uma unidade; o verde mais escuro é o grau mais certo. Toque na barra para abrir a lista da unidade."
        acoes={
          <button
            type="button"
            onClick={aoAbrirContratos}
            className={`text-sm font-medium text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
          >
            Contratos, MRR e churn por unidade →
          </button>
        }
      >
        <div className="rounded-xl border bg-card p-4">
          <ResponsiveContainer width="100%" height={alturaUnidades}>
            <BarChart
              data={dados.porUnidade}
              layout="vertical"
              margin={{ left: 8, right: 48, top: 4, bottom: 4 }}
              onClick={(e) => {
                const l = (e as { activePayload?: { payload: { key: string; nome: string } }[] })
                  ?.activePayload?.[0]?.payload;
                if (l) aoAbrirUnidade({ key: l.key, name: l.nome });
              }}
            >
              <CartesianGrid {...gradeProps} horizontal={false} vertical />
              <XAxis type="number" {...eixoProps} allowDecimals={false} />
              <YAxis type="category" dataKey="nome" {...eixoProps} width={150} interval={0} />
              <Tooltip
                {...tooltipProps}
                formatter={(v: number, nome: string) => [number(v), nome]}
              />
              <Legend {...legendaProps} />
              {GRAUS.map((g, i) => (
                <Bar
                  key={g.chave}
                  dataKey={g.chave}
                  name={g.rotulo}
                  stackId="grau"
                  // A força do verde vai na própria cor (e não em fillOpacity): assim a legenda também a mostra.
                  fill={`color-mix(in srgb, ${CORES_SERIE[0]} ${g.forca}%, transparent)`}
                  radius={i === GRAUS.length - 1 ? RAIO_BARRA_HORIZONTAL : undefined}
                  cursor="pointer"
                >
                  {i === GRAUS.length - 1 && (
                    <LabelList
                      dataKey="total"
                      position="right"
                      fill="var(--foreground)"
                      fontSize={12}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Base Antiga × Base Nova" descricao="Origem dos clientes ativos no Pipefy">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={[
                  { nome: "Base Antiga", valor: dados.antigas },
                  { nome: "Base Nova ou a confirmar", valor: dados.novas },
                ]}
                dataKey="valor"
                nameKey="nome"
                innerRadius={62}
                outerRadius={96}
                paddingAngle={2}
                stroke="var(--card)"
              >
                <Cell fill={CORES_SERIE[0]} />
                <Cell fill={CORES_SERIE[1]} />
                <Label
                  value={`${pct(dados.antigas, dados.clientes)}% Base Antiga`}
                  position="center"
                  fill="var(--foreground)"
                  fontSize={14}
                  fontWeight={600}
                />
              </Pie>
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [number(v), n]} />
              <Legend {...legendaProps} />
            </PieChart>
          </ResponsiveContainer>
        </Cartao>
        <Cartao titulo="Regime tributário" descricao="Clientes ativos pelo regime do cadastro">
          {barrasHorizontais(dados.regime, CORES_SERIE[2])}
        </Cartao>
        <Cartao
          titulo="Segmentos"
          descricao={`Os maiores segmentos entre os clientes ativos${dados.semSegmento ? ` · ${number(dados.semSegmento)} sem segmento no cadastro` : ""}`}
        >
          {barrasHorizontais(dados.segmento, CORES_SERIE[1])}
        </Cartao>
        <Cartao
          titulo="Faixa de faturamento"
          descricao={`Faturamento anual declarado ou estimado${dados.semFaixa ? ` · ${number(dados.semFaixa)} sem faixa` : ""}`}
        >
          {barrasHorizontais(dados.faixa, CORES_SERIE[3])}
        </Cartao>
        <Cartao
          titulo="Quem fatura os clientes"
          descricao="Empresas do grupo que faturaram clientes da Base em 2026 (Financial Brain)"
        >
          {dados.quemFatura.length ? (
            barrasHorizontais(dados.quemFatura, CORES_SERIE[4])
          ) : (
            <p className="text-sm text-muted-foreground">Faturamento do grupo ainda não lido.</p>
          )}
        </Cartao>
      </div>
    </div>
  );
}
