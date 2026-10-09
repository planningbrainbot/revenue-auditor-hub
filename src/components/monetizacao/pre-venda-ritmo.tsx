// Pré-venda › Ritmo: "Quem está no ritmo da cadência?" Arquétipo Visão geral (ARQUETIPOS.md §1): quatro cartões de uma
// informação cada, a caixa de atenção (atrasados na cadência, uma linha por card) e dois gráficos. Sem meta (Paulo,
// 08/10): o tracejado das abordagens é a média do período.
import { useRef, useState } from "react";
import { CircleCheck, ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { EstadoVazio, KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import {
  CORES_SERIE,
  COR_NEGATIVO,
  COR_NEUTRA,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  RAIO_BARRA,
  tooltipProps,
} from "@/lib/planning/grafico";
import {
  ddmm,
  kpisRitmo,
  ordenarAtrasados,
  pessoasDoRecorte,
  primeiroNome,
  serie,
  serieAbordagens,
  serieAtividades,
  type Atrasado,
  type LinhaRitmo,
  type Pessoa,
} from "@/lib/monetizacao/pre-venda";
import {
  DEC1,
  estadoDaLeitura,
  INT,
  LinhaAtencao,
  pct,
  plural,
  type Consulta,
} from "./pre-venda-comum";

const VISIVEIS = 5;

export function RitmoPreVenda({
  ritmo,
  atrasados,
  periodo,
  pessoa,
  quem,
}: {
  ritmo: Consulta<LinhaRitmo[]>;
  atrasados: Consulta<Atrasado[]>;
  periodo: { de: string; ate: string; hoje: string };
  pessoa?: number;
  quem: string;
}) {
  const caixa = useRef<HTMLElement>(null);
  const estado = estadoDaLeitura({
    consultas: [ritmo, atrasados],
    fonte: "ritmo e atrasados da pré-venda",
    variante: "kpis",
  });
  if (estado) return estado;
  const linhas = ritmo.data!;
  const atr = atrasados.data!;
  const pessoas = pessoasDoRecorte([...linhas, ...atr], pessoa);
  const k = kpisRitmo(linhas, atr, pessoas, periodo);
  const abordagens = serieAbordagens(linhas, pessoas, periodo);
  const temHoje = periodo.de <= periodo.hoje && periodo.hoje <= periodo.ate;
  const periodoTexto = `${ddmm(periodo.de)} a ${ddmm(periodo.ate)}`;
  const nada =
    !atr.some((a) => pessoas.some((p) => p.id === a.user_id)) &&
    !linhas.some(
      (l) => pessoas.some((p) => p.id === l.user_id) && l.dia >= periodo.de && l.dia <= periodo.ate,
    );
  if (nada)
    return (
      <EstadoVazio
        titulo={`Nenhuma abordagem, atividade ou ligação de ${quem} em ${periodoTexto}`}
        descricao="A abordagem conta quando o card começa no pipe 39; a cadência, quando a função cria as atividades no card; a ligação, quando sai pelo ramal da Api4Com."
      />
    );

  const irParaCaixa = () => {
    caixa.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    caixa.current?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-6">
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Abordagens por dia útil"
          valor={k.porDiaUtil === null ? "—" : DEC1.format(k.porDiaUtil)}
          estado={k.porDiaUtil === null ? "nao-apurado" : "ok"}
          nota={
            k.porDiaUtil === null
              ? "nenhum dia útil no período até hoje"
              : `${INT.format(k.abordagens)} em ${plural(k.uteis, "dia útil", "dias úteis")}`
          }
        />
        <KpiCard
          rotulo="Feitas hoje"
          valor={INT.format(k.feitasHoje)}
          unidade={`de ${INT.format(k.previstasHoje)} previstas`}
          estado={temHoje ? "ok" : "nao-apurado"}
          nota={temHoje ? undefined : "o período não inclui hoje"}
        />
        <KpiCard
          rotulo="Vencidas agora"
          valor={INT.format(k.vencidasAgora)}
          tom={k.vencidasAgora > 0 ? "perigo" : "sucesso"}
          tomRotulo={k.vencidasAgora > 0 ? undefined : "em dia"}
          nota={k.vencidasAgora > 0 ? `em ${plural(k.cardsAtrasados, "card", "cards")}` : undefined}
          abrir={k.vencidasAgora > 0 ? { onClick: irParaCaixa, rotulo: "Ver os cards" } : undefined}
        />
        <KpiCard
          rotulo="Ligações atendidas"
          valor={k.taxaAtendidas === null ? "—" : pct(k.taxaAtendidas * 100)}
          estado={k.taxaAtendidas === null ? "nao-apurado" : "ok"}
          nota={
            k.taxaAtendidas === null
              ? "nenhuma ligação pelo ramal no período"
              : `${INT.format(k.atendidas)} de ${INT.format(k.discadas)} discadas`
          }
        />
      </KpiGrade>

      <CaixaAtrasados
        ref={caixa}
        atrasados={ordenarAtrasados(atr.filter((a) => pessoas.some((p) => p.id === a.user_id)))}
        mostrarPessoa={pessoas.length > 1}
      />

      <Secao
        titulo="Quantas abordagens por dia útil?"
        descricao="Cards do pipe 39 que começaram no dia, pelo dono do card. Tracejado: a média do período, que não é meta."
      >
        <div className="rounded-xl border bg-card p-4">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={abordagens.pontos}
                margin={{ top: 16, right: 12, bottom: 0, left: -20 }}
              >
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} dataKey="rotulo" minTickGap={8} />
                <YAxis {...eixoProps} allowDecimals={false} />
                <Tooltip
                  {...tooltipProps}
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  formatter={(v, nome) => [INT.format(Number(v)), nome]}
                  labelFormatter={(r, itens) => {
                    const p = itens?.[0]?.payload as { util?: boolean; total?: number } | undefined;
                    return `${String(r)}${p && !p.util ? " · fora de dia útil" : ""} · ${INT.format(p?.total ?? 0)} no total`;
                  }}
                />
                <Legend {...legendaProps} />
                {pessoas.map((p, i) => (
                  <Bar
                    key={p.id}
                    dataKey={serie(p.id)}
                    name={primeiroNome(p.nome)}
                    stackId="abordagens"
                    fill={CORES_SERIE[i % 5]}
                    radius={i === pessoas.length - 1 ? RAIO_BARRA : undefined}
                    maxBarSize={44}
                  />
                ))}
                {abordagens.media !== null && (
                  <ReferenceLine
                    y={abordagens.media}
                    {...linhaMetaProps}
                    ifOverflow="extendDomain"
                    label={{
                      value: `média ${DEC1.format(abordagens.media)}`,
                      position: "insideTopRight",
                      fill: "var(--muted-foreground)",
                      fontSize: 12,
                    }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Secao>

      <Secao
        titulo="A cadência está em dia?"
        descricao="Atividades da cadência pelo dia de vencimento: feitas, vencidas e as que ainda vencem hoje."
      >
        <LegendaAtividades />
        <div
          className={
            pessoas.length > 1 ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "grid grid-cols-1 gap-3"
          }
        >
          {pessoas.map((p) => (
            <AtividadesDaPessoa key={p.id} pessoa={p} linhas={linhas} periodo={periodo} />
          ))}
        </div>
      </Secao>
    </div>
  );
}

/** "Atrasados na cadência": um card por linha, mais vencidas primeiro, com o caminho para o card. */
function CaixaAtrasados({
  atrasados,
  mostrarPessoa,
  ref,
}: {
  atrasados: Atrasado[];
  mostrarPessoa: boolean;
  ref: React.Ref<HTMLElement>;
}) {
  const [todos, setTodos] = useState(false);
  const total = atrasados.reduce((s, a) => s + a.vencidas, 0);
  const visiveis = todos ? atrasados : atrasados.slice(0, VISIVEIS);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="titulo-atrasados"
      className="scroll-mt-4 rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3">
        <h2 id="titulo-atrasados" className="text-sm font-semibold text-foreground">
          Atrasados na cadência
        </h2>
        {atrasados.length > 0 && (
          <span className="num text-[13px] text-muted-foreground">
            {plural(atrasados.length, "card", "cards")} · {plural(total, "atividade", "atividades")}{" "}
            vencidas
          </span>
        )}
      </div>
      <ul className="mt-1 divide-y">
        {atrasados.length === 0 ? (
          <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <CircleCheck className="size-4 shrink-0 text-success" strokeWidth={1.75} aria-hidden />
            Nenhuma atividade vencida: a cadência está em dia.
          </li>
        ) : (
          visiveis.map((a) => (
            <LinhaAtencao
              key={a.deal_id}
              selo={
                <StatusBadge tom="perigo" className="num">
                  {plural(a.vencidas, "vencida", "vencidas")}
                </StatusBadge>
              }
              acao={
                a.url ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={a.url} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden /> Abrir o card
                    </a>
                  </Button>
                ) : undefined
              }
            >
              <div className="grid gap-x-6 gap-y-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground md:truncate">{a.empresa}</span>
                  <span className="num block text-[13px] text-muted-foreground">
                    {[
                      mostrarPessoa && primeiroNome(a.pessoa),
                      a.dia_cadencia !== null && `D${a.dia_cadencia} da cadência`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {a.proxima && (
                  <span className="min-w-0 self-center text-[13px] text-muted-foreground">
                    <span className="text-foreground">Próxima:</span>{" "}
                    {a.proxima.replace(/^Caixa · /, "")}
                  </span>
                )}
              </div>
            </LinhaAtencao>
          ))
        )}
      </ul>
      {atrasados.length > VISIVEIS && (
        <div className="border-t px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setTodos((x) => !x)}>
            {todos ? "Mostrar só os 5 primeiros" : `Mostrar mais ${atrasados.length - VISIVEIS}`}
          </Button>
        </div>
      )}
    </section>
  );
}

const SERIES_ATIVIDADE = [
  { chave: "feitas", nome: "Feitas", cor: CORES_SERIE[0] },
  { chave: "vencidas", nome: "Vencidas", cor: COR_NEGATIVO },
  { chave: "aVencer", nome: "A vencer hoje", cor: COR_NEUTRA },
] as const;

function LegendaAtividades() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
      {SERIES_ATIVIDADE.map((s) => (
        <span key={s.chave} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.cor }} />
          {s.nome}
        </span>
      ))}
    </div>
  );
}

/** Uma faixa por pessoa (small multiples): feitas, vencidas e a vencer empilhadas, no máximo três séries. */
function AtividadesDaPessoa({
  pessoa,
  linhas,
  periodo,
}: {
  pessoa: Pessoa;
  linhas: LinhaRitmo[];
  periodo: { de: string; ate: string; hoje: string };
}) {
  const pontos = serieAtividades(linhas, pessoa.id, periodo);
  const feitas = pontos.reduce((s, x) => s + x.feitas, 0);
  const previstas = pontos.reduce((s, x) => s + x.previstas, 0);
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={`Cadência de ${pessoa.nome}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{pessoa.nome}</h3>
        {previstas > 0 && (
          <span className="num text-[13px] text-muted-foreground">
            {INT.format(feitas)} de {INT.format(previstas)} feitas
          </span>
        )}
      </div>
      {pontos.length === 0 ? (
        <p className="mt-6 pb-6 text-center text-[13px] text-muted-foreground">
          Nenhuma atividade da cadência venceu no período.
        </p>
      ) : (
        <div className="mt-2 h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="rotulo" minTickGap={8} />
              <YAxis {...eixoProps} allowDecimals={false} />
              <Tooltip
                {...tooltipProps}
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                formatter={(v, nome) => [INT.format(Number(v)), nome]}
              />
              {SERIES_ATIVIDADE.map((s, i) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.nome}
                  stackId="atividades"
                  fill={s.cor}
                  radius={i === SERIES_ATIVIDADE.length - 1 ? RAIO_BARRA : undefined}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
