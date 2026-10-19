// Forecast da Monetização (`/monetizacao?aba=fechamentos`): "O que fazer hoje para o mês fechar?" Desde 19/10/2026 a
// tela abre pela fila do dia (Fila de trabalho): os números filtram e a fila agrupa os cards pelo próximo passo do Jev,
// com a última nota do dono. Embaixo ficam os horizontes e a receita do mês (Visão geral), pedidos pelo Paulo na call
// de 14/10 (PRD https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 4). Contrato:
// docs/design/contratos/monetizacao-fechamentos.md. Nada é calculado aqui: a régua mora em
// src/lib/monetizacao/fechamentos.ts.
import { ExternalLink } from "lucide-react";
import { EstadoVazio, KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Etapa } from "@/lib/monetizacao/funil-cumulativo";
import {
  FILTROS_FILA,
  filaDoDia,
  forecastDeFechamento,
  rotuloUrgencia,
  type FiltroFila,
  type Horizonte,
  type LinhaFila,
  type LinhaFilaJev,
  type PrevisaoJev,
} from "@/lib/monetizacao/fechamentos";
import { reaisCurto } from "@/lib/monetizacao/model";
import type { RecorteResponsavel } from "@/lib/monetizacao/responsavel";
import { NOMES, type Negocio, type Produto, type ProdutoDoRecorte } from "@/lib/monetizacao/types";

const INT = new Intl.NumberFormat("pt-BR");
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const contratos = (n: number) => `${INT.format(n)} ${n === 1 ? "contrato" : "contratos"}`;

type Abrir = (
  titulo: string,
  cards: Negocio[],
  opcoes?: { estoque?: boolean; recorte?: string },
) => void;

const TOM: Partial<Record<Horizonte, "perigo" | "atencao" | "sucesso">> = {
  atrasado: "perigo",
  semData: "atencao",
};

export function Fechamentos({
  cards,
  stages,
  hoje,
  filtro,
  previsoes = [],
  fila = null,
  filtroFila = "hoje",
  mudarFiltroFila,
  abrir,
}: {
  cards: Negocio[];
  stages: Etapa[];
  hoje: string;
  filtro: RecorteResponsavel & { product: ProdutoDoRecorte };
  /** Previsão do Jev para os cards sem data esperada (vem da carga da Monetização). */
  previsoes?: PrevisaoJev[];
  /** Fila do dia (`ops.monetizacao_forecast_fila()`); `null` = indisponível. */
  fila?: LinhaFilaJev[] | null;
  filtroFila?: FiltroFila;
  mudarFiltroFila?: (f: FiltroFila) => void;
  abrir: Abrir;
}) {
  const fc = forecastDeFechamento(cards, stages, hoje, filtro, previsoes);
  const dia = filaDoDia(fc, fila, filtroFila);
  const nomeDoFiltro = FILTROS_FILA.find((f) => f.chave === filtroFila)?.rotulo ?? "Fazer hoje";
  const estimados = fc.grupos.reduce((s, g) => s + g.estimados, 0);
  const recorte = `abertos hoje, ${ddmm(hoje)}`;
  const nota = (valor: number, semValor: number, n: number) =>
    !n
      ? "nenhum card"
      : `${valor ? `${reaisCurto(valor)} esperados` : "sem valor"}${semValor && valor ? ` · ${INT.format(semValor)} sem valor` : ""}`;
  const ganho = fc.receita.reduce((s, l) => s + l.receitaGanha, 0);
  const nGanhos = fc.receita.reduce((s, l) => s + l.ganhos.length, 0);
  const esperado = fc.receita.reduce((s, l) => s + l.receitaEsperada, 0);
  const nEsperados = fc.receita.reduce((s, l) => s + l.esperados.length, 0);
  const semValorMes = fc.receita.reduce((s, l) => s + l.esperadosSemValor, 0);
  return (
    <div className="space-y-6">
      <Secao
        titulo="O que fazer hoje"
        descricao={`${INT.format(dia.total)} ${dia.total === 1 ? "card aberto" : "cards abertos"} da Reunião de proposta em diante, sem o Stand by, agrupados pelo próximo passo que o Jev sugere de hora em hora pelas notas do card. Clique num número para filtrar a fila.${dia.semJev ? " As sugestões do Jev estão indisponíveis agora." : ""}`}
      >
        <KpiGrade colunas={6} className="xl:grid-cols-5">
          {FILTROS_FILA.map((f) => {
            const n = dia.contagem[f.chave];
            return (
              <KpiCard
                key={f.chave}
                rotulo={f.rotulo}
                valor={
                  f.chave === "semdata"
                    ? `${INT.format(n)} de ${INT.format(dia.total)}`
                    : INT.format(n)
                }
                nota={NOTA_FILTRO[f.chave]}
                tom={f.chave === "semdata" && n ? "atencao" : undefined}
                className={f.chave === filtroFila ? "ring-2 ring-foreground" : undefined}
                abrir={
                  mudarFiltroFila
                    ? {
                        onClick: () => mudarFiltroFila(f.chave),
                        rotulo: f.chave === filtroFila ? "Na fila abaixo" : "Ver na fila",
                      }
                    : undefined
                }
              />
            );
          })}
        </KpiGrade>
        {!dia.total ? (
          <EstadoVazio
            titulo="Nenhum card da Reunião de proposta em diante"
            descricao="Com esse responsável e esse produto, não há card aberto na reta final."
          />
        ) : !dia.filtradas ? (
          <EstadoVazio titulo={`Nenhum card em "${nomeDoFiltro}"`} total={dia.total} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {dia.grupos.map((g) => (
              <div key={g.passo ?? "sem"} className="border-t first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-muted/40 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    {g.rotulo}{" "}
                    <span className="num text-muted-foreground">
                      · {INT.format(g.linhas.length)}
                    </span>
                  </h3>
                  <p className="text-[13px] text-muted-foreground">{g.porque}</p>
                </div>
                <ul>
                  {g.linhas.map((l) => (
                    <LinhaDaFila key={l.item.card.id} linha={l} hoje={hoje} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Secao>

      <Secao
        titulo="Quando deve fechar"
        descricao={`${INT.format(fc.total)} ${fc.total === 1 ? "card aberto" : "cards abertos"} da Reunião de proposta em diante, sem o Stand by. Vale a data esperada do Pipedrive; sem ela, a previsão do Jev pelas notas do card${estimados ? ` (${INT.format(estimados)} hoje)` : ""}. A data é atualizada na daily.`}
      >
        <KpiGrade colunas={3}>
          {fc.grupos.map((g) => (
            <KpiCard
              key={g.chave}
              rotulo={
                g.chave === "semana"
                  ? `Até domingo, ${ddmm(fc.fimDaSemana)}`
                  : g.chave === "mes"
                    ? `Até ${ddmm(fc.fimDoMes)}`
                    : g.rotulo
              }
              valor={INT.format(g.itens.length)}
              nota={
                g.chave === "semData" && g.itens.length
                  ? "preencha a data esperada na daily"
                  : `${nota(g.valor, g.semValor, g.itens.length)}${g.estimados ? ` · ${INT.format(g.estimados)} pela previsão do Jev` : ""}`
              }
              tom={g.itens.length ? TOM[g.chave] : g.chave === "semData" ? "sucesso" : undefined}
              abrir={
                g.itens.length
                  ? {
                      onClick: () =>
                        abrir(
                          `Forecast · ${g.rotulo}`,
                          g.itens.map((i) => i.card),
                          { estoque: true, recorte },
                        ),
                      rotulo: "Ver os cards",
                    }
                  : undefined
              }
            />
          ))}
        </KpiGrade>
      </Secao>

      <Secao
        titulo="Quanto o mês fecha em receita?"
        descricao="Receita prevista total do contrato (Partners e unidade). Sem valor no card, vale o ticket médio dos contratos ganhos do produto no pipe 39; produto sem contrato ganho com valor fica sem ticket."
      >
        <KpiGrade colunas={3}>
          <KpiCard
            rotulo="Ganho no mês"
            valor={reaisCurto(ganho)}
            nota={contratos(nGanhos)}
            abrir={
              nGanhos
                ? {
                    onClick: () =>
                      abrir(
                        "Forecast · contratos ganhos no mês",
                        fc.receita.flatMap((l) => l.ganhos),
                        {
                          estoque: true,
                          recorte: `ganhos em ${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`,
                        },
                      ),
                    rotulo: "Ver os contratos",
                  }
                : undefined
            }
          />
          <KpiCard
            rotulo="Esperado até o fim do mês"
            valor={reaisCurto(esperado)}
            nota={`${contratos(nEsperados)}${semValorMes ? ` · ${INT.format(semValorMes)} sem valor` : ""}`}
            tom={nEsperados && semValorMes === nEsperados ? "atencao" : undefined}
            abrir={
              nEsperados
                ? {
                    onClick: () =>
                      abrir(
                        "Forecast · esperado até o fim do mês",
                        fc.receita.flatMap((l) => l.esperados.map((i) => i.card)),
                        { estoque: true, recorte },
                      ),
                    rotulo: "Ver os cards",
                  }
                : undefined
            }
          />
          <KpiCard
            rotulo="O mês fecha em"
            valor={reaisCurto(ganho + esperado)}
            nota="ganho mais esperado, se tudo fechar na data"
          />
        </KpiGrade>
        <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Ganhos no mês</TableHead>
                <TableHead className="text-right">Receita ganha</TableHead>
                <TableHead className="text-right">Esperados no mês</TableHead>
                <TableHead className="text-right">Receita esperada</TableHead>
                <TableHead>Ticket médio usado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fc.receita.map((l) => (
                <TableRow key={l.produto}>
                  <TableCell className="font-medium">{NOMES[l.produto]}</TableCell>
                  <TableCell className="num text-right">{INT.format(l.ganhos.length)}</TableCell>
                  <TableCell className="num text-right">{reaisCurto(l.receitaGanha)}</TableCell>
                  <TableCell className="num text-right">{INT.format(l.esperados.length)}</TableCell>
                  <TableCell className="num text-right">
                    {reaisCurto(l.receitaEsperada)}
                    {l.esperadosSemValor > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {INT.format(l.esperadosSemValor)} sem valor
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.ticket.valor === null
                      ? "sem contrato ganho com valor"
                      : `${reaisCurto(l.ticket.valor)}, média de ${contratos(l.ticket.contratos)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Secao>
    </div>
  );
}

const NOTA_FILTRO: Record<FiltroFila, string> = {
  hoje: "urgência do Jev: fazer hoje",
  semana: "urgência do Jev: nesta semana",
  mes: "pela data esperada; sem ela, pela previsão do Jev",
  semdata: "sem os dois, o mês não fecha conta: preencher na daily",
  consultoria: "cliente, contrato ou proposta na Consultoria",
};

const diasDesde = (dia: string | null | undefined, hoje: string) => {
  if (!dia) return null;
  const d = Math.floor(
    (Date.parse(hoje + "T12:00:00Z") - Date.parse(dia.slice(0, 10) + "T12:00:00Z")) / 86400000,
  );
  return Number.isFinite(d) ? Math.max(0, d) : null;
};

/** Uma linha da fila: o card, o passo do Jev, a última nota do dono, a próxima atividade e os selos. */
function LinhaDaFila({ linha, hoje }: { linha: LinhaFila; hoje: string }) {
  const { card } = linha.item;
  const jev = linha.jev;
  const dias = diasDesde(card.last_activity_date, hoje);
  return (
    <li className="grid gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]">
      <div className="min-w-0">
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-full items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span className="min-w-0 truncate">{card.org ?? card.title}</span>
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        </a>
        <p className="text-xs text-muted-foreground">
          {card.stage.replace(/^\d+\s*·\s*/, "")} ·{" "}
          {linha.item.produto === "sem_produto" ? "sem produto" : NOMES[linha.item.produto]} ·{" "}
          {card.owner.split(" ")[0]}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {!card.expected_close && <StatusBadge tom="atencao">sem data esperada</StatusBadge>}
          {linha.item.origem !== "card" && <StatusBadge tom="atencao">sem valor</StatusBadge>}
          {jev?.consultoria && (
            <span title={jev.consultoria}>
              <StatusBadge tom="info">na Consultoria</StatusBadge>
            </span>
          )}
        </div>
      </div>
      <div className="text-sm">
        <p className="font-medium text-foreground">
          {jev?.passo ? rotuloUrgencia(jev.urgencia) : "Definir na daily"}
        </p>
        {jev?.gerado_em && (
          <p className="text-xs text-muted-foreground">
            sugestão de {ddmm(jev.gerado_em.slice(0, 10))}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {jev?.nota ? (
          <>
            <span className="text-foreground">
              Última nota{jev.nota_em ? ` (${ddmm(jev.nota_em.slice(0, 10))})` : ""}:
            </span>{" "}
            {jev.nota.length > 240 ? `${jev.nota.slice(0, 240)}…` : jev.nota}
          </>
        ) : (
          "Sem nota do responsável no card."
        )}
      </p>
      <div className="text-sm">
        <p className="text-foreground">
          {card.next_activity
            ? `Próxima atividade ${ddmm(card.next_activity.slice(0, 10))}`
            : "Sem próxima atividade"}
        </p>
        <p className="text-xs text-muted-foreground">
          {dias === null
            ? "sem atividade registrada"
            : dias === 0
              ? "mexido hoje"
              : `sem atividade há ${INT.format(dias)} ${dias === 1 ? "dia" : "dias"}`}
        </p>
      </div>
    </li>
  );
}
