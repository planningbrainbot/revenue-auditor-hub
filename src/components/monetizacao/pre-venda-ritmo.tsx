// Pré-venda › Ritmo: "Quem está no ritmo da cadência?" Arquétipo Visão geral (ARQUETIPOS.md §1): quatro cartões de uma
// informação cada, a caixa de atenção (atrasados na cadência, uma linha por card) e dois gráficos. Sem meta (Paulo,
// 08/10): o tracejado das abordagens é a média do período.
import { useState } from "react";
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
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  listasDoRitmo,
  ordenarAtrasados,
  pessoasDoRecorte,
  primeiroNome,
  serie,
  serieAbordagens,
  serieAtividades,
  situacaoDaAtividade,
  type AtividadePreVenda,
  type Atrasado,
  type ListasRitmo,
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
  atividades,
  periodo,
  pessoa,
  quem,
}: {
  ritmo: Consulta<LinhaRitmo[]>;
  atrasados: Consulta<Atrasado[]>;
  /** Cada atividade por trás dos números, para a aba lateral; a prévia de captura não traz. */
  atividades?: Consulta<AtividadePreVenda[]>;
  periodo: { de: string; ate: string; hoje: string };
  pessoa?: number;
  quem: string;
}) {
  // Conferência numa aba lateral, sem rolar a tela (28/10/2026, pedido do Pedro).
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
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

  const conferir = (titulo: string, descricao: string, itens: Conferencia["itens"]) =>
    setConferencia({ titulo, descricao, itens });

  return (
    <div className="space-y-6">
      <ConferenciaAtividades
        conferencia={conferencia}
        atividades={atividades}
        pessoas={pessoas}
        periodo={periodo}
        fechar={() => setConferencia(null)}
      />
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
        {/* Pelo dia em que a atividade foi feita, de qualquer vencimento (28/10/2026); o gráfico da cadência segue
            pelo vencimento. */}
        <KpiCard
          rotulo="Atividades feitas"
          valor={INT.format(k.feitas)}
          nota={
            k.feitas === 0
              ? "nenhuma atividade da cadência feita no período"
              : k.feitasAtrasadas > 0
                ? `${INT.format(k.feitasAtrasadas)} estavam atrasadas`
                : "nenhuma atrasada"
          }
          abrir={{
            rotulo: "Conferir",
            onClick: () =>
              conferir(
                `Atividades feitas · ${quem}`,
                `feitas de ${periodoTexto}, pelo dia em que foram marcadas como feitas; o e-mail de apresentação do D0 sai sozinho e fica fora`,
                (l) => l.feitas,
              ),
          }}
        />
        <KpiCard
          rotulo="Vencidas agora"
          valor={INT.format(k.vencidasAgora)}
          tom={k.vencidasAgora > 0 ? "perigo" : "sucesso"}
          tomRotulo={k.vencidasAgora > 0 ? undefined : "em dia"}
          nota={k.vencidasAgora > 0 ? `em ${plural(k.cardsAtrasados, "card", "cards")}` : undefined}
          abrir={
            k.vencidasAgora > 0
              ? {
                  rotulo: "Conferir",
                  onClick: () =>
                    conferir(
                      `Vencidas agora · ${quem}`,
                      "atividades das cadências em curso que já venceram e não foram feitas, as mais antigas primeiro",
                      (l) => l.vencidasAgora,
                    ),
                }
              : undefined
          }
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
        descricao="Feitas: pelo dia em que foram feitas, de qualquer vencimento. Vencidas e a vencer hoje: pelo dia do vencimento. Clique num dia para conferir."
      >
        <LegendaAtividades />
        <div
          className={
            pessoas.length > 1 ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "grid grid-cols-1 gap-3"
          }
        >
          {pessoas.map((p) => (
            <AtividadesDaPessoa
              key={p.id}
              pessoa={p}
              linhas={linhas}
              periodo={periodo}
              abrirDia={(dia) =>
                conferir(
                  `${primeiroNome(p.nome)} · ${ddmm(dia)}`,
                  "feitas no dia, de qualquer vencimento, e as que venceram no dia e seguem abertas",
                  (l) => l.doDia(dia).filter((a) => a.user_id === p.id),
                )
              }
            />
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
}: {
  atrasados: Atrasado[];
  mostrarPessoa: boolean;
}) {
  const [todos, setTodos] = useState(false);
  const total = atrasados.reduce((s, a) => s + a.vencidas, 0);
  const visiveis = todos ? atrasados : atrasados.slice(0, VISIVEIS);
  return (
    <section aria-labelledby="titulo-atrasados" className="rounded-xl border bg-card">
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
  abrirDia,
}: {
  pessoa: Pessoa;
  linhas: LinhaRitmo[];
  periodo: { de: string; ate: string; hoje: string };
  abrirDia: (dia: string) => void;
}) {
  const pontos = serieAtividades(linhas, pessoa.id, periodo);
  const feitas = pontos.reduce((s, x) => s + x.feitas, 0);
  const vencidas = pontos.reduce((s, x) => s + x.vencidas, 0);
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={`Cadência de ${pessoa.nome}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{pessoa.nome}</h3>
        {pontos.length > 0 && (
          <span className="num text-[13px] text-muted-foreground">
            {plural(feitas, "feita", "feitas")} · {plural(vencidas, "vencida", "vencidas")}
          </span>
        )}
      </div>
      {pontos.length === 0 ? (
        <p className="mt-6 pb-6 text-center text-[13px] text-muted-foreground">
          Nenhuma atividade da cadência venceu nem foi feita no período.
        </p>
      ) : (
        <div className="mt-2 h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={pontos}
              margin={{ top: 8, right: 8, bottom: 0, left: -24 }}
              role="img"
              aria-label={`Cadência de ${pessoa.nome} por dia; clique num dia para conferir as atividades`}
              className="cursor-pointer"
              onClick={(e: { activePayload?: { payload?: { dia?: string } }[] }) => {
                const dia = e?.activePayload?.[0]?.payload?.dia;
                if (dia) abrirDia(dia);
              }}
            >
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

// ── Conferência ──────────────────────────────────────────────────────────────────────────────────────────────────

/** O que a aba lateral mostra: um número do Ritmo aberto em atividades, uma por linha. */
type Conferencia = {
  titulo: string;
  descricao: string;
  itens: (l: ListasRitmo) => AtividadePreVenda[];
};

const SITUACAO: Record<
  ReturnType<typeof situacaoDaAtividade>,
  { tom: TomStatus; rotulo: string }
> = {
  "feita-no-dia": { tom: "sucesso", rotulo: "Feita no dia" },
  "feita-antes": { tom: "sucesso", rotulo: "Feita antes" },
  "feita-atrasada": { tom: "atencao", rotulo: "Feita com atraso" },
  vencida: { tom: "perigo", rotulo: "Vencida" },
  "a-fazer": { tom: "neutro", rotulo: "A fazer" },
};

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
/** "26/10 14:34", no horário de São Paulo. */
const quando = (iso: string | null) => (iso ? QUANDO.format(new Date(iso)).replace(",", "") : "—");

/**
 * Aba lateral de conferência (28/10/2026, Pedro: "quero clicar em feitas hoje e poder auditar em uma aba lateral
 * direita"): as atividades por trás do número, com o card do Pipedrive, o vencimento e a hora em que foi feita.
 */
function ConferenciaAtividades({
  conferencia,
  atividades,
  pessoas,
  periodo,
  fechar,
}: {
  conferencia: Conferencia | null;
  atividades?: Consulta<AtividadePreVenda[]>;
  pessoas: Pessoa[];
  periodo: { de: string; ate: string };
  fechar: () => void;
}) {
  const agora = Date.now();
  const itens =
    conferencia && atividades?.data
      ? conferencia.itens(listasDoRitmo(atividades.data, pessoas, periodo, agora))
      : [];
  const mostrarPessoa = pessoas.length > 1;
  return (
    <Sheet open={!!conferencia} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-4xl">
        <SheetHeader className="pr-8">
          <SheetTitle>{conferencia?.titulo}</SheetTitle>
          <SheetDescription>
            {atividades?.data ? `${plural(itens.length, "atividade", "atividades")} · ` : ""}
            {conferencia?.descricao} · clique na empresa para abrir o card no Pipedrive
          </SheetDescription>
        </SheetHeader>
        {!atividades ? (
          <EstadoVazio titulo="A lista das atividades não vem nesta prévia" />
        ) : atividades.erro ? (
          <EstadoErro
            detalhe={`Fonte: atividades da cadência. ${atividades.erro.message}`}
            tentarNovamente={atividades.tentarNovamente}
          />
        ) : !atividades.data ? (
          <Carregando variante="tabela" />
        ) : !itens.length ? (
          <EstadoVazio titulo="Nenhuma atividade neste número" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                {mostrarPessoa && <TableHead>Pessoa</TableHead>}
                <TableHead>Atividade</TableHead>
                <TableHead className="text-right">Vencimento</TableHead>
                <TableHead className="text-right">Feita em</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((a, i) => {
                const sit = SITUACAO[situacaoDaAtividade(a, agora)];
                return (
                  <TableRow key={`${a.deal_id}-${a.vence}-${a.atividade}-${i}`}>
                    <TableCell className="max-w-[240px]">
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate">{a.empresa}</span>
                          <ExternalLink
                            className="size-4 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">{a.empresa}</span>
                      )}
                    </TableCell>
                    {mostrarPessoa && <TableCell>{primeiroNome(a.pessoa)}</TableCell>}
                    <TableCell>{a.atividade}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {quando(a.vence)}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {a.feita ? quando(a.feita_em) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tom={sit.tom}>{sit.rotulo}</StatusBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SheetContent>
    </Sheet>
  );
}
