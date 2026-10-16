import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarraFiltros,
  Carregando,
  EstadoVazio,
  Secao,
  SelecaoMultipla,
} from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import {
  carregarHistoricoRepasse,
  type HistoricoRepasse,
} from "@/lib/royalties-repasse-historico.functions";
import {
  brlOuTraco,
  eixoMoeda,
  ErroDaConsulta,
  rotuloMes,
  rotuloMesCurto,
  TooltipMoeda,
} from "@/components/receita/moldura";

/**
 * "Do que o repasse é feito, mês a mês?" na Apuração de Royalties, com filtro
 * por unidade e por tipo de cobrança (16/10/2026). É o gráfico da Visão geral
 * da Receita aberto por unidade: sem filtro e sem mídia, as barras batem com
 * as de lá.
 */

const TIPOS = [
  { valor: "royalties", rotulo: "Royalties", cor: CORES_SERIE[0] },
  { valor: "csc", rotulo: "CSC", cor: CORES_SERIE[1] },
  { valor: "outras", rotulo: "Outras receitas", cor: CORES_SERIE[2] },
  { valor: "cac", rotulo: "CAC", cor: CORES_SERIE[3] },
  { valor: "midia", rotulo: "Mídia", cor: CORES_SERIE[4] },
] as const;
type Tipo = (typeof TIPOS)[number]["valor"];

/** Filtros do gráfico na URL (N7), em texto separado por vírgula: a rota só aceita string. */
export const CHAVES_FILTRO_HISTORICO = ["hist_unidades", "hist_tipos"] as const;

const lista = (v: string) => (v ? v.split(",").filter(Boolean) : []);

export function HistoricoRepasse({ mes }: { mes: string }) {
  const fn = useServerFn(carregarHistoricoRepasse);
  const { data, isLoading, error, refetch } = useQuery<HistoricoRepasse>({
    queryKey: ["royalties", "historico-repasse", mes],
    queryFn: () => fn({ data: { mes } }),
    staleTime: 60_000,
  });

  const [unidadesUrl, setUnidadesUrl] = useFiltroNaUrl("hist_unidades", "");
  const [tiposUrl, setTiposUrl] = useFiltroNaUrl("hist_tipos", "");
  const limpar = useLimparFiltrosNaUrl([...CHAVES_FILTRO_HISTORICO]);
  const unidadesSel = lista(unidadesUrl);
  const tiposSel = lista(tiposUrl);

  // Nada marcado vale como todos, igual à SelecaoMultipla.
  const tiposVisiveis = TIPOS.filter((t) => tiposSel.length === 0 || tiposSel.includes(t.valor));

  const opcoesUnidade = useMemo(
    () => (data?.unidades ?? []).map((u) => ({ valor: String(u.id), rotulo: u.nome })),
    [data],
  );

  const serie = useMemo(() => {
    if (!data) return [];
    const filtro = new Set(unidadesSel.map(Number));
    const porMes = new Map(
      data.meses.map((m) => [
        m,
        { mes: rotuloMesCurto(m), royalties: 0, csc: 0, outras: 0, cac: 0, midia: 0 },
      ]),
    );
    for (const l of data.linhas) {
      if (filtro.size > 0 && !filtro.has(l.unidade_id)) continue;
      const alvo = porMes.get(l.mes);
      if (!alvo) continue;
      for (const t of TIPOS) alvo[t.valor] += l[t.valor];
    }
    return [...porMes.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, unidadesUrl]);

  const totalPeriodo = serie.reduce(
    (s, m) => s + tiposVisiveis.reduce((t, tipo) => t + m[tipo.valor as Tipo], 0),
    0,
  );

  const nomeRecorte =
    unidadesSel.length === 0
      ? "toda a rede"
      : unidadesSel.length === 1
        ? (opcoesUnidade.find((o) => o.valor === unidadesSel[0])?.rotulo ?? "1 unidade")
        : `${unidadesSel.length} unidades`;

  const filtroAtivo = unidadesSel.length > 0 || tiposSel.length > 0;
  const ultimo = tiposVisiveis.length - 1;

  return (
    <Secao
      titulo="Do que o repasse é feito, mês a mês? (R$)"
      descricao="Royalties, CSC e outras pelo mês da apuração (caixa); CAC e mídia na competência da apuração. Sem filtro e sem mídia, bate com o gráfico da Visão geral da Receita."
    >
      {error ? (
        <ErroDaConsulta
          erro={error}
          chaves="view.auditoria.royalties"
          titulo="Não foi possível carregar o histórico do repasse"
          tentarNovamente={() => void refetch()}
        />
      ) : isLoading || !data ? (
        <Carregando variante="kpis" />
      ) : data.meses.length === 0 ? (
        <EstadoVazio titulo="Nenhuma apuração até este mês" />
      ) : (
        <>
          <BarraFiltros aoLimpar={filtroAtivo ? limpar : undefined} className="mb-3">
            <SelecaoMultipla
              rotulo="Unidade"
              opcoes={opcoesUnidade}
              valor={unidadesSel}
              aoMudar={(v) => setUnidadesUrl(v.join(","))}
              todos="Todas as unidades"
              plural="unidades"
              className="w-56"
            />
            <SelecaoMultipla
              rotulo="Tipo de cobrança"
              opcoes={TIPOS.map((t) => ({ valor: t.valor, rotulo: t.rotulo }))}
              valor={tiposSel}
              aoMudar={(v) => setTiposUrl(v.join(","))}
              todos="Todos os tipos"
              plural="tipos"
              so="Só este"
              className="w-56"
            />
          </BarraFiltros>
          <p className="mb-2 text-[13px] text-muted-foreground">
            {nomeRecorte} · {rotuloMes(data.meses[0])} a{" "}
            {rotuloMes(data.meses[data.meses.length - 1])} ·{" "}
            <span className="num font-medium text-foreground">{brlOuTraco(totalPeriodo)}</span> no
            período
          </p>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 4, right: 4, left: 4 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="mes" {...eixoProps} />
                <YAxis tickFormatter={eixoMoeda} {...eixoProps} width={44} />
                <Tooltip content={<TooltipMoeda />} cursor={tooltipProps.cursor} />
                <Legend {...legendaProps} />
                {/* stroke da cor da superfície = o respiro de 2px entre as
                    fatias empilhadas, que recharts não tem nativo. */}
                {tiposVisiveis.map((t, i) => (
                  <Bar
                    key={t.valor}
                    dataKey={t.valor}
                    stackId="r"
                    name={t.rotulo}
                    fill={t.cor}
                    stroke="var(--card)"
                    strokeWidth={2}
                    radius={i === ultimo ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Secao>
  );
}
