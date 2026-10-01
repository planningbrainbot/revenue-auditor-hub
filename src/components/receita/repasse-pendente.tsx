import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { CORES_SERIE } from "@/lib/planning/grafico";
import {
  carregarRepassePendente,
  type RepassePendente,
  type UnidadePendente,
} from "@/lib/repasse-pendente.functions";
import {
  brlOuTraco,
  ComoLer,
  ErroDaConsulta,
  rotuloDia,
  rotuloMesCurto,
  SeloRegua,
} from "./moldura";

/**
 * O que a rede deve à matriz hoje, de qualquer competência. Fica fora do
 * seletor de mês de propósito: o resto da abertura recomeça quando o mês vira,
 * e o título vencido de meses atrás não pode sumir junto.
 */

function seloDoTitulo(status: string, dias: number): { tom: TomStatus; texto: string } {
  if (dias > 0) return { tom: "perigo", texto: `${dias} dia(s) em atraso` };
  if (status === "VENCE HOJE") return { tom: "atencao", texto: "Vence hoje" };
  return { tom: "info", texto: "A vencer" };
}

function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const pct = maximo > 0 ? (valor / maximo) * 100 : 0;
  return (
    <div className="mt-1 h-2 w-full rounded-sm bg-muted" aria-hidden>
      <div
        className="h-full rounded-r-[4px]"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: CORES_SERIE[0] }}
      />
    </div>
  );
}

function Detalhe({ u }: { u: UnidadePendente }) {
  return (
    <div className="grid gap-4 py-2 lg:grid-cols-2">
      <div>
        <h5 className="mb-1 text-[13px] font-medium">Títulos em aberto na Partners</h5>
        {u.titulos.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhum.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {u.titulos.map((t, i) => {
              const selo = seloDoTitulo(t.status, t.diasAtraso);
              return (
                <li key={`${t.documento}-${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="num w-20 text-muted-foreground">{rotuloDia(t.vencimento)}</span>
                  <span className="min-w-0 flex-1">
                    {t.oQue}
                    {t.documento && (
                      <span className="text-muted-foreground"> · doc. {t.documento}</span>
                    )}
                  </span>
                  <StatusBadge tom={selo.tom}>{selo.texto}</StatusBadge>
                  <span className="num w-24 text-right font-medium">{brlOuTraco(t.valor)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <h5 className="mb-1 text-[13px] font-medium">Apurado × cobrado, mês a mês</h5>
        {u.primeiroMes ? (
          <p className="mb-1 text-[13px] text-muted-foreground">
            {rotuloMesCurto(u.primeiroMes)} a {rotuloMesCurto(u.ultimoMes!)}: apurado{" "}
            <span className="num">{brlOuTraco(u.apuradoAcumulado)}</span>, cobrado{" "}
            <span className="num">{brlOuTraco(u.cobradoAcumulado)}</span>.
            {u.mesesDivergentes.length > 0 &&
              " Meses em que o título do mês seguinte não bateu com a apuração (cobrança atrasada aparece como falta num mês e sobra no outro):"}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nenhuma apuração fechada.</p>
        )}
        {u.mesesDivergentes.length > 0 && (
          <ul className="space-y-0.5 text-[13px]">
            {u.mesesDivergentes.map((m) => {
              const dif = m.apurado - m.cobradoNoMesSeguinte;
              return (
                <li key={m.mes} className="flex gap-2">
                  <span className="w-16">{rotuloMesCurto(m.mes)}</span>
                  <span className="num flex-1 text-muted-foreground">
                    apurado {brlOuTraco(m.apurado)} · cobrado {brlOuTraco(m.cobradoNoMesSeguinte)}
                  </span>
                  <span className="num w-28 text-right">
                    {dif > 0 ? "falta " : "sobra "}
                    {brlOuTraco(Math.abs(dif))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RepassePendenteBloco({ destinoApuracao }: { destinoApuracao: string }) {
  const fn = useServerFn(carregarRepassePendente);
  const { data, isLoading, error, refetch } = useQuery<RepassePendente>({
    queryKey: ["repasse-pendente"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const [aberta, setAberta] = useState<number | null>(null);

  const r = useMemo(() => {
    const us = data?.unidades ?? [];
    const soma = (f: (u: UnidadePendente) => number) => us.reduce((s, u) => s + f(u), 0);
    const titulos = us.flatMap((u) => u.titulos);
    return {
      vencido: soma((u) => u.vencido),
      vencidoMais30: titulos.filter((t) => t.diasAtraso > 30).reduce((s, t) => s + t.valor, 0),
      qtdMais30: titulos.filter((t) => t.diasAtraso > 30).length,
      aVencer: soma((u) => u.aVencer),
      faltaCobrar: soma((u) => u.faltaCobrar),
      qtdFaltaCobrar: us.filter((u) => u.faltaCobrar > 0).length,
      maximo: Math.max(0, ...us.map((u) => u.vencido)),
      acima: us.filter((u) => u.acimaDoApurado > 0),
    };
  }, [data]);

  const hoje = data ? rotuloDia(data.hoje) : null;

  return (
    <Secao
      titulo="O que as unidades ainda devem à matriz, de qualquer mês?"
      descricao={`fotografia de ${hoje ?? "hoje"} · não muda com o seletor de mês · títulos da conta Partners no Omie e apurações fechadas`}
      acoes={
        <SeloRegua regua="estoque de hoje">
          O resto da página olha um mês. Este bloco olha tudo o que está em aberto hoje, venha de
          que competência vier: título vencido de junho continua aqui até ser baixado no Omie.
        </SeloRegua>
      }
    >
      {isLoading && <Carregando variante="kpis" />}
      {error && (
        <ErroDaConsulta
          erro={error}
          chaves="view.unidades_rede"
          tentarNovamente={() => void refetch()}
        />
      )}
      {data && (
        <>
          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="Vencido e não recebido"
              valor={brlOuTraco(r.vencido)}
              tom={r.vencido > 0 ? "perigo" : "sucesso"}
              tomRotulo={r.vencido > 0 ? "cobrar" : "em dia"}
              nota="Títulos da Partners já vencidos"
            />
            <KpiCard
              rotulo="Vencido há mais de 30 dias"
              valor={brlOuTraco(r.vencidoMais30)}
              tom={r.vencidoMais30 > 0 ? "perigo" : undefined}
              nota={`${r.qtdMais30} título(s): a pendência que o mês já esqueceu`}
            />
            <KpiCard
              rotulo="A vencer"
              valor={brlOuTraco(r.aVencer)}
              nota="Emitido, inclui o que vence hoje"
            />
            <KpiCard
              rotulo="Apurado e não faturado"
              valor={brlOuTraco(r.faltaCobrar)}
              tom={r.faltaCobrar > 0 ? "atencao" : undefined}
              nota={`${r.qtdFaltaCobrar} unidade(s) com apuração sem título que a cubra`}
              abrir={{ href: destinoApuracao, rotulo: "Abrir apuração" }}
            />
          </KpiGrade>

          <Card className="p-4">
            {data.unidades.length === 0 ? (
              <StatusBadge tom="sucesso">Nada em aberto</StatusBadge>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Unidade</TableHead>
                    <TableHead className="min-w-40">Vencido</TableHead>
                    <TableHead>Mais antigo</TableHead>
                    <TableHead className="text-right">A vencer</TableHead>
                    <TableHead className="text-right">Apurado e não faturado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unidades.map((u) => {
                    const expandida = aberta === u.unidade_id;
                    const maisAntigo = u.titulos.find((t) => t.diasAtraso > 0);
                    return (
                      <Fragment key={u.unidade_id}>
                        <TableRow>
                          <TableCell className="p-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-expanded={expandida}
                              aria-label={`${expandida ? "Fechar" : "Abrir"} o detalhe de ${u.unidade}`}
                              onClick={() => setAberta(expandida ? null : u.unidade_id)}
                            >
                              {expandida ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{u.unidade}</TableCell>
                          <TableCell>
                            <span className="num">{brlOuTraco(u.vencido || null)}</span>
                            {u.vencido > 0 && <Barra valor={u.vencido} maximo={r.maximo} />}
                          </TableCell>
                          <TableCell>
                            {maisAntigo ? (
                              <StatusBadge tom={maisAntigo.diasAtraso > 30 ? "perigo" : "atencao"}>
                                {rotuloDia(maisAntigo.vencimento)} · {maisAntigo.diasAtraso} dias
                              </StatusBadge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="num text-right">
                            {brlOuTraco(u.aVencer || null)}
                          </TableCell>
                          <TableCell className="num text-right">
                            {brlOuTraco(u.faltaCobrar || null)}
                          </TableCell>
                        </TableRow>
                        {expandida && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell />
                            <TableCell colSpan={5}>
                              <Detalhe u={u} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell className="num">{brlOuTraco(r.vencido)}</TableCell>
                    <TableCell />
                    <TableCell className="num text-right">{brlOuTraco(r.aVencer)}</TableCell>
                    <TableCell className="num text-right">{brlOuTraco(r.faltaCobrar)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}

            {r.acima.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <p className="text-[13px] text-muted-foreground">
                  <span className="font-medium text-foreground">Cobrado acima do apurado</span>,
                  para conferir e não para cobrar: títulos que nenhuma apuração fechada explica
                  (apuração reeditada para baixo depois da nota, mídia cobrada fora da apuração,
                  cobrança de mês sem apuração).
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.acima.map((u) => (
                    <Badge key={u.unidade_id} variant="outline" className="font-normal">
                      {u.unidade}
                      <span className="num ml-1 text-muted-foreground">
                        · {brlOuTraco(u.acimaDoApurado)}
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <ComoLer
            itens={[
              {
                rotulo: "Vencido e a vencer",
                texto:
                  "Títulos da conta Partners no Omie, para o CNPJ de uma unidade regional, que não estão RECEBIDO nem CANCELADO. A data é o vencimento do título, não a competência da apuração. Some daqui quando o Omie baixa o pagamento.",
              },
              {
                rotulo: "Apurado e não faturado",
                texto:
                  "Total das apurações fechadas da unidade, desde a primeira, menos o total dos títulos de repasse emitidos para ela (royalties, CSC, CAC, mídia, outras e ND da rotina) com vencimento do mês seguinte à primeira apuração até dois meses depois da última. A conta é acumulada porque a categoria do título mudou ao longo do ano; o mês a mês, no detalhe, aponta onde a diferença nasceu.",
              },
            ]}
          />
        </>
      )}
    </Secao>
  );
}
