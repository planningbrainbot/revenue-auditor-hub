// Forecast › Base nova (pipe 40). Visão geral: quanto está em jogo (honorário esperado da Jordana × probabilidade da
// etapa), quando deve fechar (prazo prometido + 7 dias de negociação), conversão e honorário médio por área, e o que já
// fechou no mês. Nenhuma premissa entra: sem produto no card, o card não soma receita. Régua em diagnostico.ts.
import { KpiCard, Secao } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NOME_AREA,
  ROTULO_HORIZONTE,
  fechamentoEsperado,
  forecastDiagnostico,
  valorDoCard,
  type CardDiag,
  type EtapaDiag,
} from "@/lib/monetizacao/diagnostico";
import { BRL, Barra, INT, NumeroClicavel, ddmm, pctDiag, plural, type AbrirDiag } from "./comum";

export function ForecastDiagnostico({
  cards,
  etapas,
  hoje,
  abrir,
}: {
  cards: CardDiag[];
  etapas: EtapaDiag[];
  hoje: string;
  abrir: AbrirDiag;
}) {
  const f = forecastDiagnostico(cards, etapas, hoje);
  const maxEtapa = Math.max(1, ...f.porEtapa.map((e) => e.ponderado));
  const maxHorizonte = Math.max(1, ...f.horizontes.map((h) => h.valor));
  const valorGanho = f.ganhosMes.reduce((t, c) => t + valorDoCard(c), 0);
  const notaFechamento = (c: CardDiag) => `fecha por volta de ${ddmm(fechamentoEsperado(c))}`;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          rotulo="Receita em jogo"
          valor={BRL.format(Math.round(f.ponderado))}
          nota="honorário esperado × probabilidade da etapa"
          abrir={{
            onClick: () =>
              abrir(
                "Cards com produto e honorário",
                f.porEtapa.flatMap((e) => e.comProduto),
              ),
          }}
        />
        <KpiCard
          rotulo="Honorário esperado"
          valor={BRL.format(Math.round(f.valor))}
          nota="soma dos produtos dos cards abertos, sem ponderar"
          abrir={{
            onClick: () =>
              abrir(
                "Cards com produto e honorário",
                f.porEtapa.flatMap((e) => e.comProduto),
              ),
          }}
        />
        <KpiCard
          rotulo="Ganhos no mês"
          valor={INT.format(f.ganhosMes.length)}
          nota={
            f.ganhosMes.length
              ? `${BRL.format(valorGanho)} · ${plural(f.parciais.length, "venda parcial", "vendas parciais")}`
              : "nenhum ainda"
          }
          abrir={{
            onClick: () =>
              abrir("Ganhos no mês", f.ganhosMes, (c) =>
                c.nao_vendido ? `parcial: ${c.nao_vendido}` : "venda total",
              ),
          }}
        />
        <KpiCard
          rotulo="Perdas no mês"
          valor={INT.format(f.perdasMes.length)}
          nota="com o motivo de cada uma"
          abrir={{
            onClick: () =>
              abrir("Perdas no mês", f.perdasMes, (c) => c.lost_reason ?? "sem motivo"),
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Secao
          titulo="Em que etapa está a receita?"
          descricao="Probabilidade de cada etapa no pipe 40: 10% nas três primeiras, 15% na execução e 25% a 70% da conclusão à negociação."
        >
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Cards</TableHead>
                  <TableHead className="text-right">Prob.</TableHead>
                  <TableHead className="w-40" aria-label="Receita em jogo" />
                  <TableHead className="text-right">Em jogo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.porEtapa.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-foreground">{e.rotulo}</TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel cards={e.cards} titulo={e.rotulo} abrir={abrir} />
                    </TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {pctDiag(e.probabilidade)}
                    </TableCell>
                    <TableCell>
                      <Barra valor={e.ponderado} maximo={maxEtapa} />
                    </TableCell>
                    <TableCell className="num text-right">
                      {e.comProduto.length ? BRL.format(Math.round(e.ponderado)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Secao>

        <Secao
          titulo="Quando deve fechar?"
          descricao="Pelo prazo prometido ao cliente (apresentação) mais os 7 dias da negociação. Antes do D0 o card não tem data."
        >
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Horizonte</TableHead>
                  <TableHead className="text-right">Cards</TableHead>
                  <TableHead className="w-40" aria-label="Receita em jogo" />
                  <TableHead className="text-right">Em jogo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.horizontes.map((h) => (
                  <TableRow key={h.horizonte}>
                    <TableCell className="text-foreground">
                      {ROTULO_HORIZONTE[h.horizonte]}
                    </TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel
                        cards={h.cards}
                        titulo={ROTULO_HORIZONTE[h.horizonte]}
                        abrir={abrir}
                        nota={notaFechamento}
                      />
                    </TableCell>
                    <TableCell>
                      <Barra valor={h.valor} maximo={maxHorizonte} cor="bg-chart-2" />
                    </TableCell>
                    <TableCell className="num text-right">
                      {h.valor ? BRL.format(Math.round(h.valor)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Secao>
      </div>

      <Secao
        titulo="Quanto cada área converte, e por quanto?"
        descricao="Apresentado: chegou à 07 com o produto no card. Vendido: ganho com o produto. Honorário médio: dos produtos vendidos. Venda parcial tira o produto não vendido do card, como manda o processo."
      >
        <div className="rounded-xl border bg-card">
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
                  <TableCell className="text-foreground">{NOME_AREA[p.area]}</TableCell>
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
      </Secao>
    </div>
  );
}
