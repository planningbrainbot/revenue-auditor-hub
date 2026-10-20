// Forecast › Base nova (pipe 40). Visão geral: quanto está em jogo (honorário esperado da Jordana × probabilidade da
// etapa), quando deve fechar (prazo prometido + 7 dias de negociação), conversão e honorário médio por área, e o que já
// fechou no mês. Nenhuma premissa entra: sem produto no card, o card não soma receita. Régua em diagnostico.ts.
// Desde 20/10/2026 no molde do Forecast do pipe 39 (pedido do Pedro: o mesmo design nas duas bases): quadros em
// KpiCard por horizonte e as etapas com o ícone em rampa do funil da Operação.
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ExternalLink,
  FolderOpen,
  Presentation,
  Scale,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { EstadoVazio, KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  FILTROS_FILA_DIAG,
  NOME_AREA,
  NOME_DIAG,
  NOME_PESSOA_DIAG,
  NUMERO_DIAG,
  ORDEM_DIAG,
  ROTULO_HORIZONTE,
  fechamentoEsperado,
  filaDiagnostico,
  forecastDiagnostico,
  nomeDoCard,
  valorDoCard,
  type CardDiag,
  type EtapaDiag,
  type FiltroFilaDiag,
  type HorizonteDiag,
  type LinhaFilaDiag,
} from "@/lib/monetizacao/diagnostico";
import { Rampa } from "../funil-desenho";
import { BRL, INT, NumeroClicavel, ddmm, pctDiag, plural, type AbrirDiag } from "./comum";

/** O mesmo ícone da etapa no funil da Operação. */
const ICONES: Record<number, LucideIcon> = {
  293: Building2,
  294: BadgeCheck,
  296: FolderOpen,
  297: ScanSearch,
  298: ClipboardCheck,
  299: CalendarClock,
  300: Presentation,
  301: Scale,
};
const TOM: Partial<Record<HorizonteDiag, "perigo">> = { passou: "perigo" };
// ícone | cards | etapa | probabilidade | em jogo
const GRADE_ETAPA =
  "grid grid-cols-[1.5rem_3rem_minmax(0,1fr)_3.5rem_6.5rem] items-center gap-x-3 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_4rem_7.5rem]";

export function ForecastDiagnostico({
  cards,
  etapas,
  hoje,
  abrir,
  filtroFila = "hoje",
  mudarFiltroFila,
}: {
  cards: CardDiag[];
  etapas: EtapaDiag[];
  hoje: string;
  abrir: AbrirDiag;
  /** O número que filtra a fila do dia (`?fila=`, o mesmo parâmetro do pipe 39). */
  filtroFila?: FiltroFilaDiag;
  mudarFiltroFila?: (f: FiltroFilaDiag) => void;
}) {
  const f = forecastDiagnostico(cards, etapas, hoje);
  const fila = filaDiagnostico(cards, hoje);
  const grupos = fila.grupos(filtroFila);
  const nomeDoFiltro =
    FILTROS_FILA_DIAG.find((x) => x.chave === filtroFila)?.rotulo ?? "Fazer hoje";
  const nomeDaEtapa = (id: number) =>
    `${NUMERO_DIAG[id]} · ${etapas.find((e) => e.id === id)?.name ?? NOME_DIAG[id]}`;
  const valorGanho = f.ganhosMes.reduce((t, c) => t + valorDoCard(c), 0);
  const notaFechamento = (c: CardDiag) => `fecha por volta de ${ddmm(fechamentoEsperado(c))}`;
  const comProduto = f.porEtapa.flatMap((e) => e.comProduto);
  const abertos = f.porEtapa.reduce((t, e) => t + e.cards.length, 0);
  return (
    <div className="space-y-6">
      <Secao
        titulo="O que fazer hoje"
        descricao={`${plural(fila.total, "card aberto", "cards abertos")} no pipe 40, agrupados pela etapa, com a tarefa da régua que vence primeiro e a última nota de quem trabalha o card. Clique num número para filtrar a fila.`}
        acoes={
          fila.pausados.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                abrir("Pausados (fora da fila)", fila.pausados, (c) => c.pausa?.texto ?? "")
              }
              className="rounded-sm text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {plural(fila.pausados.length, "pausado fora da fila", "pausados fora da fila")}
            </button>
          ) : undefined
        }
      >
        <KpiGrade>
          {FILTROS_FILA_DIAG.map((x) => {
            const n = fila.contagem[x.chave];
            return (
              <KpiCard
                key={x.chave}
                rotulo={x.rotulo}
                valor={
                  x.chave === "semdata"
                    ? `${INT.format(n)} de ${INT.format(fila.total)}`
                    : INT.format(n)
                }
                nota={
                  x.chave === "semana"
                    ? `${x.nota}, ${ddmm(fila.fimDaSemana)}`
                    : x.chave === "mes"
                      ? `${x.nota}, ${ddmm(fila.fimDoMes)}`
                      : x.nota
                }
                tom={
                  x.chave === "hoje" && n
                    ? "atencao"
                    : x.chave === "semdata" && n
                      ? "atencao"
                      : undefined
                }
                className={x.chave === filtroFila ? "ring-2 ring-foreground" : undefined}
                abrir={
                  mudarFiltroFila
                    ? {
                        onClick: () => mudarFiltroFila(x.chave),
                        rotulo: x.chave === filtroFila ? "Na fila abaixo" : "Ver na fila",
                      }
                    : undefined
                }
              />
            );
          })}
        </KpiGrade>
        {!fila.total ? (
          <EstadoVazio
            titulo="Nenhum card aberto no pipe 40"
            descricao={
              fila.pausados.length
                ? "Os cards abertos estão pausados; voltam à fila quando a nota de pausa sair."
                : undefined
            }
          />
        ) : !grupos.length ? (
          <EstadoVazio titulo={`Nenhum card em "${nomeDoFiltro}"`} total={fila.total} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {grupos.map((g) => (
              <div key={g.etapa} className="border-t first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-muted/40 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    {nomeDaEtapa(g.etapa)}{" "}
                    <span className="num text-muted-foreground">
                      · {INT.format(g.linhas.length)}
                    </span>
                  </h3>
                </div>
                <ul>
                  {g.linhas.map((l) => (
                    <LinhaDaFila key={l.card.id} linha={l} hoje={hoje} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Secao>

      <Secao
        titulo="Quanto o diagnóstico deve fechar?"
        descricao={`${plural(abertos, "card aberto", "cards abertos")} no pipe 40, ${INT.format(comProduto.length)} com produto e honorário. Sem produto no card, o card não soma receita.`}
      >
        <KpiGrade>
          <KpiCard
            rotulo="Receita em jogo"
            valor={BRL.format(Math.round(f.ponderado))}
            nota="honorário esperado × probabilidade da etapa"
            abrir={
              comProduto.length
                ? {
                    onClick: () => abrir("Cards com produto e honorário", comProduto),
                    rotulo: "Ver os cards",
                  }
                : undefined
            }
          />
          <KpiCard
            rotulo="Honorário esperado"
            valor={BRL.format(Math.round(f.valor))}
            nota="soma dos produtos dos cards abertos, sem ponderar"
            abrir={
              comProduto.length
                ? {
                    onClick: () => abrir("Cards com produto e honorário", comProduto),
                    rotulo: "Ver os cards",
                  }
                : undefined
            }
          />
          <KpiCard
            rotulo="Ganhos no mês"
            valor={INT.format(f.ganhosMes.length)}
            nota={
              f.ganhosMes.length
                ? `${BRL.format(valorGanho)} · ${plural(f.parciais.length, "venda parcial", "vendas parciais")}`
                : "nenhum ainda"
            }
            abrir={
              f.ganhosMes.length
                ? {
                    onClick: () =>
                      abrir("Ganhos no mês", f.ganhosMes, (c) =>
                        c.nao_vendido ? `parcial: ${c.nao_vendido}` : "venda total",
                      ),
                    rotulo: "Ver os cards",
                  }
                : undefined
            }
          />
          <KpiCard
            rotulo="Perdas no mês"
            valor={INT.format(f.perdasMes.length)}
            nota="com o motivo de cada uma"
            tom={f.perdasMes.length ? "atencao" : undefined}
            abrir={
              f.perdasMes.length
                ? {
                    onClick: () =>
                      abrir("Perdas no mês", f.perdasMes, (c) => c.lost_reason ?? "sem motivo"),
                    rotulo: "Ver os cards",
                  }
                : undefined
            }
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo="Quando deve fechar?"
        descricao="Pelo prazo prometido ao cliente (apresentação) mais os 7 dias da negociação. Antes do D0 o card não tem data."
      >
        <KpiGrade colunas={6} className="xl:grid-cols-5">
          {f.horizontes.map((h) => (
            <KpiCard
              key={h.horizonte}
              rotulo={ROTULO_HORIZONTE[h.horizonte]}
              valor={INT.format(h.cards.length)}
              nota={
                !h.cards.length
                  ? "nenhum card"
                  : h.valor
                    ? `${BRL.format(Math.round(h.valor))} em jogo`
                    : "sem produto no card"
              }
              tom={h.cards.length ? TOM[h.horizonte] : undefined}
              abrir={
                h.cards.length
                  ? {
                      onClick: () =>
                        abrir(
                          `Forecast · ${ROTULO_HORIZONTE[h.horizonte]}`,
                          h.cards,
                          notaFechamento,
                        ),
                      rotulo: "Ver os cards",
                    }
                  : undefined
              }
            />
          ))}
        </KpiGrade>
      </Secao>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Em que etapa está a receita?</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Cards abertos em cada etapa e a receita em jogo. Probabilidade do pipe 40: 10% nas três
            primeiras, 15% na execução e 25% a 70% da conclusão à negociação.
          </p>
          <div className="mt-3">
            <div
              className={cn(
                GRADE_ETAPA,
                "h-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
              )}
            >
              <span className="col-span-2 text-right">Cards</span>
              <span>Etapa</span>
              <span className="text-right">Prob.</span>
              <span className="text-right">Em jogo</span>
            </div>
            {f.porEtapa.map((e, i) => (
              <div key={e.id} className={cn(GRADE_ETAPA, "h-10")}>
                <Rampa passo={i} total={f.porEtapa.length} icone={ICONES[e.id] ?? Building2} />
                <NumeroClicavel
                  cards={e.cards}
                  titulo={e.rotulo}
                  abrir={abrir}
                  className="text-right text-base"
                />
                <span className="truncate text-sm text-foreground" title={e.rotulo}>
                  {e.rotulo}
                </span>
                <span className="num text-right text-[13px] text-muted-foreground">
                  {pctDiag(e.probabilidade)}
                </span>
                <span className="num text-right text-[13px] font-semibold text-foreground">
                  {e.comProduto.length ? BRL.format(Math.round(e.ponderado)) : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="space-y-0.5 px-4 pt-4">
            <h2 className="text-base font-semibold text-foreground">
              Quanto cada área converte, e por quanto?
            </h2>
            <p className="text-[13px] text-muted-foreground">
              Apresentado: chegou à 07 com o produto no card. Vendido: ganho com o produto.
              Honorário médio: dos produtos vendidos. Venda parcial tira o produto não vendido do
              card, como manda o processo.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Área</TableHead>
                  <TableHead className="text-right">Apresentado</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                  <TableHead className="text-right">Honorário médio</TableHead>
                  <TableHead className="text-right">Em jogo agora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.produtos.map((p) => (
                  <TableRow key={p.area}>
                    <TableCell className="font-medium">{NOME_AREA[p.area]}</TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel
                        cards={p.apresentados}
                        titulo={`${NOME_AREA[p.area]} · apresentado`}
                        abrir={abrir}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel
                        cards={p.vendidos}
                        titulo={`${NOME_AREA[p.area]} · vendido`}
                        abrir={abrir}
                      />
                    </TableCell>
                    <TableCell className="num text-right">{pctDiag(p.conversao)}</TableCell>
                    <TableCell className="num text-right">
                      {p.honorarioMedio == null ? "—" : BRL.format(Math.round(p.honorarioMedio))}
                    </TableCell>
                    <TableCell className="num text-right">
                      {p.emJogo.length ? BRL.format(Math.round(p.ponderado)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Uma linha da fila: o card, a tarefa que vence primeiro, a última nota de quem trabalha o card e o relógio. */
function LinhaDaFila({ linha, hoje }: { linha: LinhaFilaDiag; hoje: string }) {
  const { card, tarefa } = linha;
  const passo = ORDEM_DIAG.indexOf(card.stage_id);
  const nota = card.ultima_nota;
  const autor = nota?.autor_id ? NOME_PESSOA_DIAG.get(nota.autor_id)?.split(" ")[0] : null;
  return (
    <li className="grid gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]">
      <div className="min-w-0">
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-full items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span className="min-w-0 truncate">{nomeDoCard(card)}</span>
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        </a>
        <p className="text-xs text-muted-foreground">
          {[card.unidade, card.regime_rotulo, card.owner?.split(" ")[0]]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {/* Só o que foge do processo: o D0 nasce na 04 e o produto entra da 06 em diante. */}
          {!linha.fechamento && passo >= ORDEM_DIAG.indexOf(297) && (
            <StatusBadge tom="atencao">sem D0</StatusBadge>
          )}
          {linha.semValor && passo >= ORDEM_DIAG.indexOf(299) && (
            <StatusBadge tom="atencao">sem produto</StatusBadge>
          )}
        </div>
      </div>
      <div className="text-sm">
        <p className="font-medium text-foreground">
          {linha.urgencia === "hoje"
            ? "Fazer hoje"
            : linha.urgencia === "semana"
              ? "Nesta semana"
              : "Depois"}
        </p>
        <p className="text-xs text-muted-foreground">{linha.porque ?? "nada vence nesta semana"}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {tarefa ? (
          <>
            <span className="text-foreground">{tarefa.subject.replace(/^Diagnóstico · /, "")}</span>{" "}
            · {ddmm(tarefa.due_date)}
            {tarefa.due_date && tarefa.due_date < hoje ? " (vencida)" : ""}
          </>
        ) : (
          "Sem tarefa aberta no card."
        )}
        {nota && (
          <span className="mt-1 block">
            <span className="text-foreground">
              Última nota{autor ? ` de ${autor}` : ""} ({ddmm(nota.em.slice(0, 10))}):
            </span>{" "}
            {nota.texto}
          </span>
        )}
      </p>
      <div className="text-sm">
        <p className="text-foreground">
          {linha.prazo
            ? `Prazo ${ddmm(linha.prazo)}`
            : linha.fechamento
              ? "Apresentado"
              : "Sem prazo ainda"}
        </p>
        <p className="text-xs text-muted-foreground">
          {linha.fechamento
            ? `fecha por volta de ${ddmm(linha.fechamento)}`
            : "o relógio começa na 04"}
        </p>
      </div>
    </li>
  );
}
