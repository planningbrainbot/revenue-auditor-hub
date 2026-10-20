import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Carregando,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  SelecaoMultipla,
  Secao,
  StatusBadge,
  type EstadoKpi,
} from "@/components/planning";
import { SeletorMes } from "@/components/receita/moldura";
import { CORES_SERIE } from "@/lib/planning/grafico";
import { useAuth } from "@/hooks/use-auth";
import { useContextoFaturamento, useResumoFaturamento } from "@/hooks/use-faturamento";
import { desembrulhar, valeTentarDeNovo } from "@/lib/faturamento/erros";
import { carregarPedidosFaturamento } from "@/lib/faturamento/faturamento.functions";
import {
  buscaDoFiltro,
  hrefPedidos,
  idsDasEmissoras,
  type BuscaMeuFaturamento,
} from "@/lib/faturamento/filtro";
import {
  contagem,
  dinheiro,
  listaNomes,
  mesCorrenteSP,
  rotuloMes,
} from "@/lib/faturamento/formato";
import {
  ETAPAS_EM_ABERTO,
  fraseRecorte,
  podePedir,
  procedenciaFaturamento,
  linhasDeAtencao,
  linhasDeNovidades,
  rotuloSituacao,
  tipoRecorteDoContexto,
  type LinhaAtencao,
} from "@/lib/faturamento/rotulos";
import type { Contexto, EmissoraRef, NumeroResumo, Resumo } from "@/lib/faturamento/tipos";
import { AREA_FATURAMENTO, BotaoNovoPedido, ErroDaArea, PaginaFaturamento } from "./moldura";

/**
 * Meu faturamento (`/faturamento`), arquétipo Visão geral. Contrato `docs/design/contratos/faturamento.md`
 * §2: "O que eu pedi já virou nota, e o cliente pagou?".
 *
 * Agrega e direciona (N10): quatro números, a caixa do que pede atenção e as etapas dos pedidos em aberto.
 * Nenhuma tabela linha a linha: a lista mora em Pedidos, que é o destino de todo número daqui, com o filtro
 * que o próprio banco devolve junto do número (a soma de lá bate, N2). Nada é somado no navegador.
 */

const TITULO = "Meu faturamento";
const PERGUNTA = "O que eu pedi já virou nota, e o cliente pagou?";

const UNIDADE: Record<NumeroResumo["unidade"], [string, string]> = {
  pedido: ["pedido", "pedidos"],
  nota: ["nota", "notas"],
  parcela: ["parcela", "parcelas"],
};

export function MeuFaturamento({
  busca,
  aoMudar,
}: {
  busca: BuscaMeuFaturamento;
  aoMudar: (proxima: BuscaMeuFaturamento) => void;
}) {
  const contexto = useContextoFaturamento();
  const ctx = contexto.data;
  const mes = busca.mes ?? mesCorrenteSP();

  const refs: EmissoraRef[] = (ctx?.emissoras ?? []).map((e) => ({ id: e.id, apelido: e.apelido }));
  const { ids, desconhecidas } = idsDasEmissoras(busca.emissora, refs);
  const semPapel =
    !!ctx && ctx.emissoras.length === 0 && !ctx.papeis.tesouraria && !ctx.papeis.controladoria;
  const foraDoRecorte = !!busca.emissora && ids.length === 0 && desconhecidas.length > 0;

  const resumo = useResumoFaturamento(
    `${mes}-01`,
    ids.length ? ids : null,
    !!ctx && !semPapel && !foraDoRecorte,
  );
  const r = resumo.data;

  const apelidos = ids.length
    ? refs.filter((e) => ids.includes(e.id)).map((e) => e.apelido)
    : (r?.recorte.emissoras ?? refs).map((e) => e.apelido);
  const recorte = ctx
    ? fraseRecorte(r?.recorte.tipo ?? tipoRecorteDoContexto(ctx), apelidos)
    : null;

  const cabecalho = (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao={
        recorte ? (
          <>
            {recorte} · mês de {rotuloMes(mes)} (vale para Faturado e Recebido; A faturar e Em
            atraso são de agora) · R$ por pedido, nota ou parcela
          </>
        ) : undefined
      }
      procedencia={procedenciaFaturamento(ctx)}
      acoes={<BotaoNovoPedido contexto={ctx} emissora={busca.emissora} />}
      filtros={
        ctx && !semPapel ? (
          <>
            <SeletorMes
              mes={mes}
              maximo={mesCorrenteSP()}
              aoMudar={(m) => aoMudar({ ...busca, mes: m === mesCorrenteSP() ? undefined : m })}
            />
            {refs.length > 1 && (
              <SelecaoMultipla
                rotulo="Empresa"
                opcoes={refs.map((e) => ({ valor: e.apelido, rotulo: e.apelido }))}
                valor={ids.length ? apelidos : []}
                aoMudar={(v) => aoMudar({ ...busca, emissora: v.length ? v.join(",") : undefined })}
                todos="Todas as empresas"
                plural="empresas"
              />
            )}
          </>
        ) : undefined
      }
    />
  );

  if (contexto.isPending)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <Carregando variante="kpis" />
        <Carregando variante="grafico" />
      </PaginaFaturamento>
    );

  if (contexto.error || !ctx)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <ErroDaArea erro={contexto.error} tentarNovamente={() => void contexto.refetch()} />
      </PaginaFaturamento>
    );

  if (semPapel)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <EstadoVazio
          titulo="Você ainda não pede nem aprova faturamento em nenhuma empresa."
          descricao="Quem cadastra é a controladoria (Ana Carvalhais)."
        />
      </PaginaFaturamento>
    );

  if (foraDoRecorte)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <EstadoVazio
          titulo={`${listaNomes(desconhecidas)} não ${desconhecidas.length === 1 ? "está" : "estão"} no seu recorte.`}
          descricao="O link pede uma empresa em que você não pede, não aprova nem confere faturamento."
          acao={
            <Button
              variant="outline"
              size="sm"
              onClick={() => aoMudar({ ...busca, emissora: undefined })}
            >
              Ver todas as minhas empresas
            </Button>
          }
        />
      </PaginaFaturamento>
    );

  return (
    <PaginaFaturamento>
      {cabecalho}
      {resumo.isPending ? (
        <>
          <Carregando variante="kpis" />
          <Carregando variante="grafico" />
        </>
      ) : resumo.error || !r ? (
        <ErroDaArea erro={resumo.error} tentarNovamente={() => void resumo.refetch()} />
      ) : (
        <>
          <Numeros resumo={r} refs={refs} emissora={busca.emissora} />
          <OQuePedeAtencao contexto={ctx} ids={ids} />
          {ctx.papeis.pede && <Novidades contexto={ctx} ids={ids} />}
          <Etapas resumo={r} refs={refs} emissora={busca.emissora} contexto={ctx} />
        </>
      )}
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ os quatro números

function estadoDoNumero(n: NumeroResumo, semPedido: boolean): EstadoKpi {
  if (semPedido || n.estado === "nao_apurado") return "nao-apurado";
  return n.estado === "parcial" ? "parcial" : "ok";
}

function notaDoNumero(n: NumeroResumo, semPedido: boolean): string {
  if (semPedido) return "nenhum pedido ainda";
  if (n.estado === "nao_apurado") return "Omie em simulação";
  const [um, varios] = UNIDADE[n.unidade] ?? [n.unidade, `${n.unidade}s`];
  return contagem(n.quantidade, um, varios);
}

function Numeros({
  resumo,
  refs,
  emissora,
}: {
  resumo: Resumo;
  refs: EmissoraRef[];
  emissora?: string;
}) {
  const todas = [...refs, ...resumo.recorte.emissoras];
  const card = (rotulo: string, n: NumeroResumo, abrirRotulo: string) => (
    <KpiCard
      rotulo={rotulo}
      valor={dinheiro(n.valor)}
      nota={notaDoNumero(n, resumo.sem_pedido)}
      estado={estadoDoNumero(n, resumo.sem_pedido)}
      abrir={
        resumo.sem_pedido
          ? undefined
          : { href: hrefPedidos(buscaDoFiltro(n.filtro, todas, { emissora })), rotulo: abrirRotulo }
      }
    />
  );
  // Dois são estoque de agora (A faturar, Em atraso) e dois são fluxo do mês (Faturado, Recebido): o
  // rótulo carrega a régua, e a `descricao` do cabeçalho diz que o mês só mexe nos dois do meio.
  return (
    <KpiGrade colunas={4}>
      {card("A faturar", resumo.numeros.a_faturar, "Ver os pedidos")}
      {card("Faturado no mês", resumo.numeros.faturado_no_mes, "Ver os pedidos")}
      {card("Recebido no mês", resumo.numeros.recebido_no_mes, "Ver as parcelas")}
      {card("Em atraso", resumo.numeros.em_atraso, "Ver as parcelas")}
    </KpiGrade>
  );
}

// ------------------------------------------------------------------ o que pede atenção

const TOM_ATENCAO: Record<LinhaAtencao["chave"], "perigo" | "atencao" | "info"> = {
  erro_omie: "perigo",
  ok_a_dar: "atencao",
  devolvidos: "atencao",
  para_faturar: "info",
};

/**
 * Caixa com borda, uma linha por pendência, cada uma com o botão de destino (contrato §2, item 3). As
 * contagens são de `fat_contexto` (todas as minhas empresas), então o destino vai sem o filtro de empresa
 * da tela, para o total bater. O "Erro no Omie" de quem é só tesouraria abre a Fila em "Todas" com a
 * higiene "Erro no Omie" (`linhasDeAtencao`).
 */
function OQuePedeAtencao({ contexto, ids }: { contexto: Contexto; ids: string[] }) {
  const { user } = useAuth();
  const pedidosFn = useServerFn(carregarPedidosFaturamento);
  const refs = contexto.emissoras.map((e) => ({ id: e.id, apelido: e.apelido }));
  const todas = linhasDeAtencao(contexto);
  // Com o filtro de empresa, as pendências também ficam só dessas empresas (contrato §2: o filtro "afeta
  // tudo"). `fat_contexto` conta todas; aqui o total de cada uma vem de `fat_pedidos` com o mesmo filtro e as
  // empresas escolhidas, que segue as mesmas regras de pendência (API.md §1.3), e o destino bate.
  const recortadas = useQueries({
    queries: todas.map((l) => ({
      queryKey: ["faturamento", "atencao", user?.id, l.chave, ids],
      enabled: ids.length > 0 && !!user?.id,
      queryFn: async () =>
        desembrulhar(
          await pedidosFn({
            data: { filtro: { ...l.filtro, emissoras: ids, por_pagina: 1, pagina: 1 } },
          }),
        ).total,
      staleTime: 60_000,
      retry: valeTentarDeNovo,
    })),
  });
  const comRecorte = ids.length > 0;
  const umaSo = ids.length === 1 ? refs.find((e) => e.id === ids[0])?.apelido : undefined;
  const carregando = comRecorte && recortadas.some((q) => q.isPending);
  const linhas = todas
    .map((l, i) => (comRecorte ? { ...l, quantidade: recortadas[i]?.data ?? 0 } : l))
    .filter((l) => l.quantidade > 0);
  return (
    <section aria-labelledby="fat-atencao" className="space-y-3">
      <h2 id="fat-atencao" className="text-base font-semibold text-foreground">
        O que pede atenção?
      </h2>
      <div className="rounded-xl border bg-card">
        {carregando ? (
          <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
            Contando as pendências das empresas escolhidas…
          </p>
        ) : linhas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nada pede sua atenção agora.</p>
        ) : (
          <ul className="divide-y">
            {linhas.map((l) => (
              <li
                key={l.chave}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{l.titulo}</span>
                  <StatusBadge tom={TOM_ATENCAO[l.chave]}>
                    {contagem(l.quantidade, "pedido")}
                  </StatusBadge>
                </span>
                <Button asChild variant="outline" size="sm">
                  {/* A Fila mostra uma empresa ou todas: com uma empresa escolhida ela vai junto; com duas ou
                   * mais, o destino é Pedidos, que recorta pelas mesmas empresas e bate com a contagem. */}
                  {l.fila && (!comRecorte || umaSo) ? (
                    <Link
                      to="/faturamento/tesouraria"
                      search={umaSo ? { ...l.fila, emissora: umaSo } : l.fila}
                    >
                      {l.acao}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  ) : (
                    <Link
                      to="/faturamento/pedidos"
                      search={buscaDoFiltro(
                        comRecorte ? { ...l.filtro, emissoras: ids } : l.filtro,
                        refs,
                      )}
                    >
                      {comRecorte && l.fila ? "Ver os pedidos" : l.acao}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ o que virou nota e o que atrasou

/**
 * RF-P12 na tela (o e-mail é da T6): para quem pede, a mesma caixa com borda do que pede atenção, uma linha
 * por novidade com o botão até a lista. "Viraram nota" é o mês corrente, não "desde a última visita" (ver
 * `linhasDeNovidades`). A contagem é o `total` de `fat_pedidos` com o mesmo filtro do destino: bate.
 */
function Novidades({ contexto, ids }: { contexto: Contexto; ids: string[] }) {
  const { user } = useAuth();
  const pedidosFn = useServerFn(carregarPedidosFaturamento);
  const refs = contexto.emissoras.map((e) => ({ id: e.id, apelido: e.apelido }));
  const linhas = linhasDeNovidades(mesCorrenteSP(), ids);
  const contagens = useQueries({
    queries: linhas.map((l) => ({
      queryKey: ["faturamento", "novidades", user?.id, l.filtro],
      enabled: !!user?.id,
      queryFn: async () =>
        desembrulhar(
          await pedidosFn({ data: { filtro: { ...l.filtro, por_pagina: 1, pagina: 1 } } }),
        ).total,
      staleTime: 60_000,
      retry: valeTentarDeNovo,
    })),
  });
  const carregando = contagens.some((q) => q.isPending);
  const falhou = contagens.some((q) => q.isError);
  const comItem = linhas
    .map((l, i) => ({ ...l, quantidade: contagens[i]?.data ?? 0 }))
    .filter((l) => l.quantidade > 0);
  return (
    <section aria-labelledby="fat-novidades" className="space-y-3">
      <h2 id="fat-novidades" className="text-base font-semibold text-foreground">
        O que virou nota, e o que atrasou?
      </h2>
      <div className="rounded-xl border bg-card">
        {carregando ? (
          <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
            Contando as notas do mês e as parcelas em atraso…
          </p>
        ) : falhou ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Não deu para contar agora.{" "}
            <button
              type="button"
              className="text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => contagens.forEach((q) => q.isError && void q.refetch())}
            >
              Tentar de novo
            </button>
          </p>
        ) : comItem.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Nenhuma nota emitida neste mês e nenhuma parcela em atraso.
          </p>
        ) : (
          <ul className="divide-y">
            {comItem.map((l) => (
              <li
                key={l.chave}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{l.titulo}</span>
                  <StatusBadge tom={l.tom}>{contagem(l.quantidade, "pedido")}</StatusBadge>
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link to="/faturamento/pedidos" search={buscaDoFiltro(l.filtro, refs)}>
                    {l.acao}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ etapas

/**
 * "Em que etapa estão os pedidos em aberto?": barra horizontal por etapa, na ordem do ciclo, uma cor só
 * (série 1). Cada barra abre Pedidos com a situação (N2). As sete etapas aparecem sempre: etapa sem pedido
 * é zero de verdade (contagem de agora), não ausência de dado.
 */
function Etapas({
  resumo,
  refs,
  emissora,
  contexto,
}: {
  resumo: Resumo;
  refs: EmissoraRef[];
  emissora?: string;
  contexto: Contexto;
}) {
  const todas = [...refs, ...resumo.recorte.emissoras];
  const linhas = ETAPAS_EM_ABERTO.map((situacao) => {
    const daApi = resumo.por_situacao.find((p) => p.situacao === situacao);
    return {
      situacao,
      quantidade: daApi?.quantidade ?? 0,
      busca: buscaDoFiltro(daApi?.filtro ?? { situacao: [situacao] }, todas, { emissora }),
    };
  });
  const maximo = Math.max(1, ...linhas.map((l) => l.quantidade));

  return (
    <Secao
      titulo="Em que etapa estão os pedidos em aberto?"
      descricao="Pedidos em aberto agora, por situação · pedido"
      acoes={
        <Button asChild variant="link" size="sm" className="px-0">
          <Link to="/faturamento/pedidos" search={buscaDoFiltro({}, todas, { emissora })}>
            Ver todos os pedidos <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      }
    >
      {resumo.sem_pedido ? (
        <EstadoVazio
          titulo="Nenhum pedido ainda."
          descricao={
            podePedir(contexto)
              ? "O primeiro pedido aparece aqui assim que for enviado."
              : "Os pedidos aparecem aqui quando os donos das empresas começarem a pedir."
          }
          acao={
            podePedir(contexto) ? (
              <BotaoNovoPedido contexto={contexto} emissora={emissora} />
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-1 rounded-xl border bg-card p-2">
          {linhas.map((l) => (
            <li key={l.situacao}>
              <Link
                to="/faturamento/pedidos"
                search={l.busca}
                aria-label={`${rotuloSituacao(l.situacao)}: ${contagem(l.quantidade, "pedido")}. Abrir os pedidos.`}
                className="grid grid-cols-[minmax(7rem,11rem)_1fr_3rem] items-center gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors duration-[120ms] ease-out hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate text-sm text-foreground">
                  {rotuloSituacao(l.situacao)}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(l.quantidade / maximo) * 100}%`,
                      background: CORES_SERIE[0],
                    }}
                  />
                </span>
                <span className="num text-right text-sm font-medium text-foreground">
                  {l.quantidade}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}
