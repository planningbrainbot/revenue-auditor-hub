// Pré-venda › Aderência: "Quem segue o script, e onde pula?" Arquétipo Visão geral (ARQUETIPOS.md §1): um cartão por
// pessoa e o da pergunta que mais fica de fora, a caixa de antipadrões (uma linha por antipadrão) e dois gráficos: o
// mapa de calor do script e a evolução semanal. Todo número abre as ligações que o compõem na Ficha (N2).
import { CircleCheck } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { EstadoVazio, KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import {
  aderencia,
  avaliadas,
  COMO_COMECA,
  faixa,
  FRENTES_PERGUNTA,
  NOME_FRENTE_LETRA,
  pessoasDoRecorte,
  primeiroNome,
  ROTULO_FAIXA,
  serie,
  type ChaveItem,
  type LinhaAvaliacao,
} from "@/lib/monetizacao/pre-venda";
import type { BuscaMonetizacao } from "./busca";
import {
  estadoDaLeitura,
  INT,
  LinhaAtencao,
  pct,
  plural,
  TOM_FAIXA,
  TOM_KPI_FAIXA,
  type Consulta,
} from "./pre-venda-comum";

type AbrirFicha = (patch: Partial<BuscaMonetizacao>) => void;

export function AderenciaPreVenda({
  avaliacoes,
  pessoa,
  quem,
  abrirFicha,
}: {
  avaliacoes: Consulta<LinhaAvaliacao[]>;
  pessoa?: number;
  quem: string;
  abrirFicha: AbrirFicha;
}) {
  const estado = estadoDaLeitura({
    consultas: [avaliacoes],
    fonte: "ligações avaliadas da pré-venda",
    variante: "kpis",
  });
  if (estado) return estado;
  const todas = avaliacoes.data!;
  const pessoas = pessoasDoRecorte(todas, pessoa);
  const a = aderencia(todas, pessoas);
  const naFila = todas.filter(
    (l) => l.status !== "avaliada" && (!pessoa || l.user_id === pessoa),
  ).length;

  if (!avaliadas(todas).length)
    return (
      <EstadoVazio
        titulo="Nenhuma ligação avaliada ainda"
        descricao={
          <>
            {COMO_COMECA}
            {naFila > 0 &&
              ` ${plural(naFila, "ligação está", "ligações estão")} na fila de avaliação.`}
          </>
        }
      />
    );
  if (!a.n)
    return (
      <EstadoVazio
        titulo={`Nenhuma ligação de ${quem} avaliada no período`}
        total={avaliadas(todas).length}
      />
    );

  const comPessoa = (id: number | "todos") => (id === "todos" ? undefined : id);

  return (
    <div className="space-y-6">
      <KpiGrade colunas={a.porPessoa.length > 1 ? 3 : 2}>
        {a.porPessoa.map(({ pessoa: p, n, media }) => {
          const f = media === null ? null : faixa(media);
          return (
            <KpiCard
              key={p.id}
              rotulo={p.nome}
              valor={media === null ? "—" : pct(media)}
              unidade={media === null ? undefined : "de aderência"}
              estado={media === null ? "nao-apurado" : "ok"}
              tom={f ? TOM_KPI_FAIXA[f] : undefined}
              tomRotulo={f ? ROTULO_FAIXA[f] : undefined}
              nota={
                n
                  ? plural(n, "ligação avaliada", "ligações avaliadas")
                  : "nenhuma ligação avaliada no período"
              }
              abrir={
                n
                  ? { onClick: () => abrirFicha({ responsavel: p.id }), rotulo: "Ver as ligações" }
                  : undefined
              }
            />
          );
        })}
        {a.maisFalta ? (
          <KpiCard
            rotulo="Mais fica de fora"
            valor={a.maisFalta.rotulo.split(" · ")[0]}
            unidade={a.maisFalta.titulo}
            tom="atencao"
            nota={`fora em ${INT.format(a.maisFalta.faltas)} de ${plural(a.maisFalta.n, "ligação", "ligações")}`}
            abrir={{
              onClick: () => abrirFicha({ responsavel: pessoa, falta: a.maisFalta!.chave }),
              rotulo: "Ver as ligações",
            }}
          />
        ) : (
          <KpiCard
            rotulo="Mais fica de fora"
            valor="Nenhuma"
            tom="sucesso"
            nota="as 4 perguntas em todas as ligações"
          />
        )}
      </KpiGrade>

      <section aria-labelledby="titulo-antipadroes" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3">
          <h2 id="titulo-antipadroes" className="text-sm font-semibold text-foreground">
            O que não podia ter sido dito
          </h2>
          <span className="text-[13px] text-muted-foreground">
            alerta na ficha; não desconta a nota
          </span>
        </div>
        <ul className="mt-1 divide-y">
          {a.antipadroes.length === 0 ? (
            <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <CircleCheck
                className="size-4 shrink-0 text-success"
                strokeWidth={1.75}
                aria-hidden
              />
              Nenhum antipadrão nas ligações avaliadas.
            </li>
          ) : (
            a.antipadroes.map((x) => (
              <LinhaAtencao
                key={x.chave}
                selo={
                  <StatusBadge tom="perigo" className="num">
                    {plural(x.n, "ligação", "ligações")}
                  </StatusBadge>
                }
                acao={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => abrirFicha({ responsavel: pessoa, antipadrao: x.chave })}
                  >
                    Ver as ligações
                  </Button>
                }
              >
                <span className="font-medium text-foreground">{x.titulo}</span>
              </LinhaAtencao>
            ))
          )}
        </ul>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Secao
          titulo="Onde o script pula?"
          descricao="Bloco: crédito médio (sim 1, parcial ½, não 0). Pergunta: % das ligações em que foi feita. Clique numa célula para ouvir onde faltou."
        >
          <MapaDeCalor
            a={a}
            abrir={(chave, id) => abrirFicha({ responsavel: comPessoa(id), falta: chave })}
          />
        </Secao>
        <Secao
          titulo="A aderência sobe semana a semana?"
          descricao="Média das notas por semana (segunda a domingo), uma linha por pessoa."
        >
          <EvolucaoSemanal a={a} />
        </Secao>
      </div>
    </div>
  );
}

/** Seis linhas (blocos e perguntas) × pessoas; a cor é a faixa e o número está sempre escrito, com ícone (V7). */
function MapaDeCalor({
  a,
  abrir,
}: {
  a: ReturnType<typeof aderencia>;
  abrir: (chave: ChaveItem, pessoa: number | "todos") => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="px-2 pb-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Bloco ou pergunta
              </th>
              {a.colunas.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="w-24 px-2 pb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {c.id === "todos" ? c.nome : primeiroNome(c.nome)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.mapa.map((linha) => (
              <tr key={linha.chave}>
                <th scope="row" className="px-2 py-1 text-left font-normal text-foreground">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn(linha.tipo === "bloco" && "font-medium")}>
                      {linha.rotulo}
                    </span>
                    {linha.tipo === "pergunta" && <Frentes chave={linha.chave} />}
                  </span>
                </th>
                {linha.celulas.map((c) => (
                  <td key={String(c.pessoa)} className="p-0">
                    <Celula
                      valor={c.valor}
                      faltas={c.faltas}
                      n={c.n}
                      rotulo={`${linha.rotulo}, ${c.pessoa === "todos" ? "os dois" : primeiroNome(a.colunas.find((x) => x.id === c.pessoa)?.nome ?? "")}`}
                      abrir={() => abrir(linha.chave, c.pessoa)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["bom", "atencao", "critico"] as const).map((f) => {
          const I = TOM_FAIXA[f].icone;
          return (
            <span key={f} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded",
                  TOM_FAIXA[f].celula,
                )}
              >
                <I className="size-3.5" strokeWidth={2} aria-hidden />
              </span>
              {f === "bom" ? "80% ou mais" : f === "atencao" ? "50% a 79%" : "abaixo de 50%"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Celula({
  valor,
  faltas,
  n,
  rotulo,
  abrir,
}: {
  valor: number | null;
  faltas: number;
  n: number;
  rotulo: string;
  abrir: () => void;
}) {
  const base =
    "flex h-10 w-full items-center justify-center gap-1.5 rounded-md px-2 text-sm font-semibold num";
  if (valor === null)
    return (
      <span
        className={cn(base, "bg-muted font-normal text-muted-foreground")}
        title="sem ligação avaliada"
      >
        —
      </span>
    );
  const f = faixa(valor);
  const I = TOM_FAIXA[f].icone;
  const conteudo = (
    <>
      <I className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      {pct(valor)}
      <span className="sr-only"> ({ROTULO_FAIXA[f]})</span>
    </>
  );
  if (!faltas)
    return (
      <span
        className={cn(base, TOM_FAIXA[f].celula)}
        title={`feito em ${INT.format(n)} de ${INT.format(n)}`}
      >
        {conteudo}
      </span>
    );
  const texto = `Abrir ${plural(faltas, "ligação", "ligações")} em que faltou: ${rotulo}`;
  return (
    <button
      type="button"
      onClick={abrir}
      aria-label={`${pct(valor)}, ${ROTULO_FAIXA[f]}. ${texto}`}
      title={`faltou em ${INT.format(faltas)} de ${INT.format(n)} · clique para ver`}
      className={cn(
        base,
        TOM_FAIXA[f].celula,
        "cursor-pointer outline-none transition-shadow duration-[120ms] hover:ring-2 hover:ring-input focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {conteudo}
    </button>
  );
}

/** As letras da frente que a pergunta alimenta: F Finance, J Cella, T todas. */
export function Frentes({ chave, letras }: { chave?: string; letras?: string[] }) {
  const ls = letras ?? (chave ? (FRENTES_PERGUNTA[chave] ?? []) : []);
  return (
    <span className="inline-flex gap-0.5">
      {ls.map((l) => (
        <abbr
          key={l}
          title={NOME_FRENTE_LETRA[l] ?? l}
          className="inline-flex size-5 items-center justify-center rounded border border-input text-xs font-semibold no-underline text-muted-foreground"
        >
          {l}
        </abbr>
      ))}
    </span>
  );
}

function EvolucaoSemanal({ a }: { a: ReturnType<typeof aderencia> }) {
  const pessoas = a.porPessoa.map((p) => p.pessoa);
  if (a.semanas.length < 2)
    return (
      <div className="rounded-xl border bg-card p-4 text-[13px] text-muted-foreground">
        Uma semana só com ligação avaliada no período. Amplie o período (30 dias ou mais) para ver a
        evolução.
      </div>
    );
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={a.semanas} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis {...eixoProps} dataKey="rotulo" />
            <YAxis
              {...eixoProps}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(r) => `semana de ${String(r)}`}
              formatter={(v, nome) => [v === null ? "sem ligação" : pct(Number(v)), nome]}
            />
            <Legend {...legendaProps} />
            {pessoas.map((p, i) => (
              <Line
                key={p.id}
                dataKey={serie(p.id)}
                name={primeiroNome(p.nome)}
                stroke={CORES_SERIE[i % 5]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
