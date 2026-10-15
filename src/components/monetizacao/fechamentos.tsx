// Forecast da Monetização (`/monetizacao?aba=fechamentos`): "O que deve fechar hoje, na semana e no mês?" Pedido do
// Paulo na call de 14/10/2026 (PRD https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 4). Arquétipo Visão geral:
// os horizontes do forecast de resultado em cartões que abrem os cards, e o forecast de receita do mês por produto.
// Nada é calculado aqui: a régua mora em src/lib/monetizacao/fechamentos.ts.
import { KpiCard, KpiGrade, Secao } from "@/components/planning";
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
  forecastDeFechamento,
  type Horizonte,
  type PrevisaoJev,
} from "@/lib/monetizacao/fechamentos";
import { reaisCurto } from "@/lib/monetizacao/model";
import type { RecorteResponsavel } from "@/lib/monetizacao/responsavel";
import { NOMES, type Negocio, type Produto } from "@/lib/monetizacao/types";

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
  abrir,
}: {
  cards: Negocio[];
  stages: Etapa[];
  hoje: string;
  filtro: RecorteResponsavel & { product: Produto | "" };
  /** Previsão do Jev para os cards sem data esperada (vem da carga da Monetização). */
  previsoes?: PrevisaoJev[];
  abrir: Abrir;
}) {
  const fc = forecastDeFechamento(cards, stages, hoje, filtro, previsoes);
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
        titulo="O que deve fechar, e quando?"
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
