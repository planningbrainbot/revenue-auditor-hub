import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
import {
  useContextoFaturamento,
  useFichaPedido,
  useFilaTesouraria,
  useReler,
} from "@/hooks/use-faturamento";
import { desembrulhar, tipoDoErro } from "@/lib/faturamento/erros";
import {
  carregarFilaTesouraria,
  reenviarPedidoFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import {
  botaoDaLinha,
  emissoraPadrao,
  filtroDaFila,
  gruposPorDia,
  HIGIENES,
  hrefFila,
  ROTULO_BOTAO,
  SITUACOES_FILA,
  temFiltroFila,
  textoDocumento,
  textoOndeParou,
  textoProximaAcao,
  type BuscaFila,
} from "@/lib/faturamento/fila";
import { oQueIriaAoOmie, type AlvoPedido } from "@/lib/faturamento/ficha";
import {
  contagem,
  dataCompleta,
  diaMes,
  diaSP,
  dinheiro,
  documento,
  horaSP,
  rotuloMes,
} from "@/lib/faturamento/formato";
import { procedenciaFaturamento } from "@/lib/faturamento/rotulos";
import type { FilaTesouraria as Fila, ItemFila } from "@/lib/faturamento/tipos";
import { useAcaoPedido } from "@/hooks/use-acao-pedido";
import { BotoesDoPedido, DialogosDoPedido } from "./acoes-pedido";
import { LinhasDoOmie } from "./omie-linhas";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento, SeloSituacao } from "./moldura";

/**
 * Fila da tesouraria (`/faturamento/tesouraria`), arquétipo Fila de trabalho. Contrato
 * `docs/design/contratos/faturamento-tesouraria.md`: "Qual pedido eu confiro e faturo agora?".
 *
 * Por empresa e por dia de chegada à fila do Omie, o mais antigo em cima; dentro do dia, a ordem de trabalho
 * do banco (erro, cancelamento pedido, em conferência, OS criada, simulado, na fila). A linha abre um `Sheet`
 * com o pedido resumido e as ações, sem trocar de rota (N5); o pedido aberto mora na URL.
 */

const TITULO = "Fila da tesouraria";
const PERGUNTA = "Qual pedido eu confiro e faturo agora?";

function alvoDoItem(i: ItemFila): AlvoPedido {
  return {
    id: i.id,
    numero: i.numero,
    status: i.status,
    apelido: i.emissora.apelido,
    cliente: i.tomador.nome,
    valor: i.valor,
    parcelas: i.parcelas,
    simulacao: i.simulacao || i.status === "simulado",
    osCodigo: null,
    autor: null,
  };
}

export function FilaDaTesouraria({ busca }: { busca: BuscaFila }) {
  const navigate = useNavigate();
  const contexto = useContextoFaturamento();
  const ctx = contexto.data;
  const recorte = useMemo(() => (ctx?.emissoras ?? []).filter((e) => e.tesouraria), [ctx]);
  const escolhida =
    busca.emissora && busca.emissora !== "todas"
      ? recorte.find((e) => e.apelido === busca.emissora)
      : null;
  const foraDoRecorte = !!busca.emissora && busca.emissora !== "todas" && !!ctx && !escolhida;
  const filtro = useMemo(() => filtroDaFila(busca), [busca]);
  const fila = useFilaTesouraria(escolhida?.id ?? null, filtro, !!ctx && !foraDoRecorte);
  // O "Para faturar" de Meu faturamento conta também Em conferência: com `incluir`, a fila traz esse grupo à
  // parte, para os pedidos mostrados serem os mesmos do número clicado.
  const filtroConferencia = useMemo(
    () => ({ ...filtroDaFila({ ...busca, situacao: "em_conferencia" as const }) }),
    [busca],
  );
  const conferencia = useFilaTesouraria(
    escolhida?.id ?? null,
    filtroConferencia,
    !!ctx && !foraDoRecorte && busca.incluir === "em_conferencia",
  );

  const mudar = (parcial: Partial<BuscaFila>) =>
    void navigate({
      to: "/faturamento/tesouraria",
      search: { ...busca, ...parcial },
      replace: true,
      resetScroll: false,
    });

  // Sem empresa na URL, a fila abre na que tem mais trabalho (contrato, Filtros na URL).
  useEffect(() => {
    if (!busca.emissora && fila.data) mudar({ emissora: emissoraPadrao(fila.data.emissoras) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca.emissora, fila.data]);

  // A procedência fala das empresas da fila escolhida (contrato: "Omie da DOC lido às 14:00; próxima
  // leitura às 18:00 · DOC em simulação").
  const daFila = escolhida ? [escolhida] : recorte;
  const procedenciaDaFila = ctx
    ? procedenciaFaturamento({
        ...ctx,
        emissoras: daFila,
        simulacao: daFila.filter((e) => e.modo_omie === "simular").map((e) => e.apelido),
      })
    : procedenciaFaturamento(undefined);
  const descricao = `Pedidos que chegaram à tesouraria · ${escolhida ? escolhida.apelido : "todas as empresas do seu recorte"} · por dia de chegada · pedido`;
  const cabecalho = (acoes?: ReactNode) => (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao={ctx ? descricao : undefined}
      procedencia={procedenciaDaFila}
      acoes={acoes}
    />
  );

  if (contexto.isPending || (!foraDoRecorte && fila.isPending))
    return (
      <PaginaFaturamento>
        {cabecalho()}
        <Carregando variante="tabela" />
      </PaginaFaturamento>
    );
  if (contexto.error || !ctx)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        <ErroDaArea erro={contexto.error} tentarNovamente={() => void contexto.refetch()} />
      </PaginaFaturamento>
    );
  if (foraDoRecorte)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        <EstadoSemAcesso oQueFalta={`Faturamento · Tesouraria da ${busca.emissora}`} />
      </PaginaFaturamento>
    );
  if (fila.error || !fila.data)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        {tipoDoErro(fila.error) === "sem_acesso" ? (
          <EstadoSemAcesso oQueFalta="Faturamento · Tesouraria" />
        ) : (
          <ErroDaArea erro={fila.error} tentarNovamente={() => void fila.refetch()} />
        )}
      </PaginaFaturamento>
    );

  const f = fila.data;
  // Troca de filtro com a resposta do filtro anterior na mão: a tabela, os totais e as ações esperam.
  const atualizando =
    fila.isPlaceholderData || (busca.incluir === "em_conferencia" && conferencia.isPending);
  return (
    <PaginaFaturamento>
      {cabecalho(
        escolhida && f.higiene.erro > 0 && !fila.isPlaceholderData ? (
          <ReenviarErros emissoraId={escolhida.id} apelido={escolhida.apelido} n={f.higiene.erro} />
        ) : undefined,
      )}
      <SeletorEmpresa
        fila={f}
        atual={busca.emissora ?? "todas"}
        aoEscolher={(e) => mudar({ emissora: e, pedido: undefined })}
      />
      <Ritmo fila={f} busca={busca} mudar={mudar} />
      <Higiene fila={f} busca={busca} mudar={mudar} />
      <Filtros
        busca={busca}
        mudar={mudar}
        total={atualizando ? null : f.total}
        totalFila={f.total_fila}
        emConferencia={
          busca.incluir === "em_conferencia" ? (conferencia.data?.total ?? null) : null
        }
      />
      {atualizando ? (
        <Carregando variante="tabela" />
      ) : (
        <Tabela
          fila={f}
          extra={busca.incluir === "em_conferencia" ? (conferencia.data?.itens ?? []) : undefined}
          busca={busca}
          mostraEmpresa={!escolhida}
          abrir={(id) => mudar({ pedido: id })}
          limpar={() =>
            mudar({
              situacao: undefined,
              incluir: undefined,
              higiene: undefined,
              dia: undefined,
              busca: undefined,
            })
          }
        />
      )}
      <Procedencia fonte={procedenciaDaFila.fonte} atualizadoEm={f.lido_em} />
      <SheetDoPedido
        id={busca.pedido ?? null}
        volta={hrefFila(busca)}
        aoFechar={() => mudar({ pedido: undefined })}
      />
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ seletor de empresa

function SeletorEmpresa({
  fila,
  atual,
  aoEscolher,
}: {
  fila: Fila;
  atual: string;
  aoEscolher: (e: string) => void;
}) {
  if (fila.emissoras.length <= 1) return null;
  const ficha = (valor: string, rotulo: ReactNode, ativo: boolean) => (
    <button
      key={valor}
      type="button"
      aria-pressed={ativo}
      onClick={() => aoEscolher(valor)}
      className={
        ativo
          ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      {rotulo}
    </button>
  );
  return (
    <div role="group" aria-label="Empresa" className="flex flex-wrap items-center gap-2">
      {fila.emissoras.map((e) =>
        ficha(
          e.apelido,
          <>
            {e.apelido} <span className="num">{e.trabalho}</span>
            {e.omie.indisponivel && (
              <StatusBadge tom="perigo" className="ml-1">
                Omie indisponível
              </StatusBadge>
            )}
          </>,
          atual === e.apelido,
        ),
      )}
      {/* "Todas" com a contagem (contrato): a soma das contagens do banco por empresa, que não se sobrepõem. */}
      {ficha(
        "todas",
        <>
          Todas <span className="num">{fila.emissoras.reduce((n, e) => n + e.trabalho, 0)}</span>
        </>,
        atual === "todas",
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ritmo e higiene

function Ritmo({
  fila,
  busca,
  mudar,
}: {
  fila: Fila;
  busca: BuscaFila;
  mudar: (p: Partial<BuscaFila>) => void;
}) {
  const r = fila.ritmo;
  const card = (
    rotulo: string,
    c: Fila["ritmo"]["para_faturar"],
    ativo: boolean,
    aplicar: Partial<BuscaFila>,
  ) => (
    <KpiCard
      rotulo={rotulo}
      valor={c.quantidade}
      unidade={c.quantidade === 1 ? "pedido" : "pedidos"}
      nota={dinheiro(c.valor)}
      abrir={{
        onClick: () => mudar(ativo ? { situacao: undefined, dia: undefined } : aplicar),
        rotulo: ativo ? "Tirar filtro" : "Filtrar",
      }}
    />
  );
  return (
    <KpiGrade colunas={3}>
      {card("Para faturar", r.para_faturar, busca.situacao === "para_faturar", {
        situacao: "para_faturar",
        dia: undefined,
      })}
      {card("Em conferência", r.em_conferencia, busca.situacao === "em_conferencia", {
        situacao: "em_conferencia",
        dia: undefined,
      })}
      {card("Faturados hoje", r.faturados_hoje, busca.situacao === "faturado", {
        situacao: "faturado",
        dia: "hoje",
      })}
    </KpiGrade>
  );
}

function Higiene({
  fila,
  busca,
  mudar,
}: {
  fila: Fila;
  busca: BuscaFila;
  mudar: (p: Partial<BuscaFila>) => void;
}) {
  return (
    <div role="group" aria-label="Higiene da fila" className="flex flex-wrap items-center gap-2">
      {HIGIENES.map((h) => {
        const n = fila.higiene[h.valor];
        const ativo = busca.higiene === h.valor;
        return (
          <button
            key={h.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => mudar({ higiene: ativo ? undefined : h.valor })}
            className={
              ativo
                ? "inline-flex h-8 items-center gap-2 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                : "inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-sm text-foreground outline-none transition-colors duration-[120ms] hover:border-input focus-visible:ring-2 focus-visible:ring-ring"
            }
          >
            {h.rotulo}
            <StatusBadge
              tom={n > 0 ? (h.valor === "erro" ? "perigo" : "atencao") : "neutro"}
              icone={n > 0 ? undefined : false}
            >
              {n}
            </StatusBadge>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ filtros

function Filtros({
  busca,
  mudar,
  total,
  totalFila,
  emConferencia,
}: {
  busca: BuscaFila;
  mudar: (p: Partial<BuscaFila>) => void;
  /** `null` enquanto a resposta ainda é do filtro anterior. */
  total: number | null;
  totalFila: number;
  /** Com o grupo "Em conferência" (o "Para faturar" de Meu faturamento), a contagem dele. */
  emConferencia: number | null;
}) {
  const situacao = SITUACOES_FILA.find((s) => s.valor === busca.situacao);
  const higiene = HIGIENES.find((h) => h.valor === busca.higiene);
  return (
    <div className="space-y-2">
      <BarraFiltros
        aoLimpar={
          temFiltroFila(busca)
            ? () =>
                mudar({ situacao: undefined, higiene: undefined, dia: undefined, busca: undefined })
            : undefined
        }
      >
        <label className="relative">
          <span className="sr-only">Buscar por número, cliente, documento ou projeto</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            key={busca.busca ?? ""}
            defaultValue={busca.busca ?? ""}
            placeholder="Número, cliente, documento ou projeto"
            className="h-8 w-72 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter")
                mudar({ busca: (e.target as HTMLInputElement).value.trim() || undefined });
            }}
            onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== busca.busca) mudar({ busca: v });
            }}
          />
        </label>
        <Select
          value={busca.situacao ?? "todas"}
          onValueChange={(v) =>
            mudar({ situacao: v === "todas" ? undefined : (v as BuscaFila["situacao"]) })
          }
        >
          <SelectTrigger className="h-8 w-64" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda a fila, menos faturados</SelectItem>
            {SITUACOES_FILA.map((s) => (
              <SelectItem key={s.valor} value={s.valor}>
                {s.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Dia de chegada
          <Input
            type="date"
            value={
              busca.dia && busca.dia !== "hoje"
                ? busca.dia
                : busca.dia === "hoje"
                  ? (diaSP(new Date()) as string)
                  : ""
            }
            onChange={(e) => mudar({ dia: e.target.value || undefined })}
            className="num h-8 w-40"
          />
        </label>
      </BarraFiltros>
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {situacao && (
          <ChipFiltro
            rotulo="Situação"
            valor={
              busca.incluir === "em_conferencia"
                ? `${situacao.rotulo} + Em conferência`
                : situacao.rotulo
            }
            aoRemover={() => mudar({ situacao: undefined, incluir: undefined })}
          />
        )}
        {higiene && (
          <ChipFiltro
            rotulo="Higiene"
            valor={higiene.rotulo}
            aoRemover={() => mudar({ higiene: undefined })}
          />
        )}
        {busca.dia && (
          <ChipFiltro
            rotulo="Dia"
            valor={busca.dia === "hoje" ? "hoje" : (dataCompleta(busca.dia) ?? busca.dia)}
            aoRemover={() => mudar({ dia: undefined })}
          />
        )}
        {busca.busca && (
          <ChipFiltro
            rotulo="Busca"
            valor={busca.busca}
            aoRemover={() => mudar({ busca: undefined })}
          />
        )}
        {total !== null && (
          <span className="num ml-auto text-[13px] text-muted-foreground">
            {busca.incluir === "em_conferencia" && emConferencia !== null
              ? `${contagem(total, "pedido")} para faturar e ${emConferencia} em conferência, de ${totalFila} na fila`
              : `${contagem(total, "pedido")} de ${totalFila} na fila`}
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tabela

function Tabela({
  fila,
  extra,
  busca,
  mostraEmpresa,
  abrir,
  limpar,
}: {
  fila: Fila;
  /** O grupo "Em conferência" que vai junto do "Para faturar" de Meu faturamento. */
  extra?: ItemFila[];
  busca: BuscaFila;
  mostraEmpresa: boolean;
  abrir: (id: string) => void;
  limpar: () => void;
}) {
  const hoje = diaSP(new Date()) as string;
  const agora = new Date();
  const [pendente, setPendente] = useState<{
    acao: "faturar" | "confirmar_cancelamento";
    alvo: AlvoPedido;
  } | null>(null);
  const [focar, setFocar] = useState<string | null>(null);
  const todos = [...fila.itens, ...(extra ?? [])];
  const ordem = todos.map((i) => i.id);
  const acao = useAcaoPedido(
    () => setPendente(null),
    () => setPendente(null),
  );

  // "Depois de agir numa linha, o foco vai para a seguinte" (onde parei).
  useEffect(() => {
    if (!focar) return;
    const el = document.querySelector<HTMLElement>(`[data-linha-fila="${focar}"]`);
    el?.focus();
    setFocar(null);
  }, [focar, fila.itens]);

  const agir = (item: ItemFila, b: NonNullable<ReturnType<typeof botaoDaLinha>>) => {
    const alvo = alvoDoItem(item);
    const seguinte = ordem[ordem.indexOf(item.id) + 1] ?? null;
    if (b === "faturar" || b === "confirmar_cancelamento") return setPendente({ acao: b, alvo });
    acao.mutate({ acao: b, alvo }, { onSuccess: () => seguinte && setFocar(seguinte) });
  };

  if (fila.total_fila === 0 && !temFiltroFila(busca))
    return (
      <EstadoVazio
        titulo="Nada para conferir ou faturar agora."
        descricao={`Faturados hoje: ${fila.ritmo.faturados_hoje.quantidade}.`}
      />
    );
  if (todos.length === 0)
    return (
      <EstadoVazio
        titulo="Nenhum pedido encontrado"
        total={fila.total_fila}
        acao={
          <Button variant="outline" size="sm" onClick={limpar}>
            Limpar filtros
          </Button>
        }
      />
    );

  const grupos = [
    ...gruposPorDia(fila.itens, hoje),
    ...(extra?.length ? [{ dia: "em-conferencia", rotulo: "Em conferência", itens: extra }] : []),
  ];
  const colunas = mostraEmpresa ? 11 : 10;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Chegou</TableHead>
            <TableHead>Pedido</TableHead>
            {mostraEmpresa && <TableHead>Empresa</TableHead>}
            <TableHead>O quê</TableHead>
            <TableHead>Documento</TableHead>
            <TableHead className="num text-right">Valor</TableHead>
            <TableHead>1º vencimento</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Onde parou</TableHead>
            <TableHead>Próxima ação</TableHead>
            <TableHead>
              <span className="sr-only">Ação</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.flatMap((g) => [
            <TableRow key={`dia-${g.dia}`} className="bg-muted/40 hover:bg-muted/40">
              <TableCell
                colSpan={colunas}
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {g.rotulo}
              </TableCell>
            </TableRow>,
            ...g.itens.map((i) => {
              const b = botaoDaLinha(i);
              const ocupado = acao.isPending && acao.variables?.alvo.id === i.id;
              return (
                <TableRow
                  key={i.id}
                  tabIndex={0}
                  data-linha-fila={i.id}
                  className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => abrir(i.id)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && e.target === e.currentTarget && abrir(i.id)
                  }
                >
                  <TableCell className="num whitespace-nowrap">
                    {horaSP(i.chegou_em) ?? "—"}
                  </TableCell>
                  <TableCell className="min-w-[11rem]">
                    <span className="block font-medium text-foreground">{i.numero}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {i.tomador.nome ?? documento(i.tomador.documento) ?? "—"}
                    </span>
                    {!i.tomador.situacao_conferida && (
                      <span className="block text-[13px] text-muted-foreground">
                        situação não conferida
                      </span>
                    )}
                  </TableCell>
                  {mostraEmpresa && <TableCell>{i.emissora.apelido}</TableCell>}
                  <TableCell className="min-w-[12rem]">
                    {[i.servico?.descricao, i.projeto].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{textoDocumento(i)}</TableCell>
                  <TableCell className="num whitespace-nowrap text-right">
                    {dinheiro(i.valor)}
                  </TableCell>
                  <TableCell className="num whitespace-nowrap">
                    {diaMes(i.primeiro_vencimento) ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <SeloSituacao situacao={i.status} />
                      {i.simulacao && i.status !== "simulado" && (
                        <StatusBadge tom="info">em simulação</StatusBadge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-[12rem] text-[13px]">
                    {textoOndeParou(i, hoje)}
                  </TableCell>
                  <TableCell className="min-w-[10rem] text-[13px]">
                    {textoProximaAcao(i, hoje, agora)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {b && (
                      <Button
                        size="sm"
                        variant={b === "faturar" || b === "conferir" ? "default" : "outline"}
                        disabled={acao.isPending}
                        onClick={() => agir(i, b)}
                        title={
                          b === "reenviar"
                            ? "Reenviar não duplica: o Omie reconhece o pedido pelo número."
                            : undefined
                        }
                      >
                        {ocupado ? (b === "faturar" ? "Faturando…" : "Enviando…") : ROTULO_BOTAO[b]}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            }),
          ])}
        </TableBody>
      </Table>
      <DialogosDoPedido
        pendente={pendente}
        aoFechar={() => setPendente(null)}
        executar={(a, alvo, motivo) => {
          const seguinte = ordem[ordem.indexOf(alvo.id) + 1] ?? null;
          acao.mutate(
            { acao: a, alvo, motivo },
            { onSuccess: () => seguinte && setFocar(seguinte) },
          );
        }}
        executando={acao.isPending}
      />
    </div>
  );
}

// ------------------------------------------------------------------ reenviar os erros da empresa

function ReenviarErros({
  emissoraId,
  apelido,
  n,
}: {
  emissoraId: string;
  apelido: string;
  n: number;
}) {
  const [aberto, setAberto] = useState(false);
  const reler = useReler();
  const lerFila = useServerFn(carregarFilaTesouraria);
  const reenviar = useServerFn(reenviarPedidoFaturamento);
  const lote = useMutation({
    mutationFn: async () => {
      const f = desembrulhar(
        await lerFila({
          data: { emissora: emissoraId, filtro: { situacao: "erro_omie", limite: 1000 } },
        }),
      );
      let ok = 0;
      let falhou = 0;
      // Um a um: o banco confere cada pedido, e um que falha não segura os outros.
      for (const i of f.itens) {
        const r = await reenviar({ data: { id: i.id } });
        if (r.ok) ok++;
        else falhou++;
      }
      return { ok, falhou };
    },
    onSuccess: ({ ok, falhou }) => {
      toast.success(
        `${contagem(ok, "pedido")} reenviado${ok === 1 ? "" : "s"}${falhou ? `; ${falhou} não ${falhou === 1 ? "foi" : "foram"}` : ""}.`,
      );
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "O reenvio não foi feito."),
  });
  return (
    <>
      <Button variant="outline" size="sm" disabled={lote.isPending} onClick={() => setAberto(true)}>
        {lote.isPending ? "Reenviando…" : "Reenviar os erros desta empresa"}
      </Button>
      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reenviar {contagem(n, "pedido")} com erro da {apelido}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Use depois de a chave nova do Omie entrar. Reenviar não duplica: o Omie reconhece cada
              pedido pelo número.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => lote.mutate()}>Reenviar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------------------------------------------------------------------ sheet do pedido

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}

function SheetDoPedido({
  id,
  volta,
  aoFechar,
}: {
  id: string | null;
  volta: string;
  aoFechar: () => void;
}) {
  const ficha = useFichaPedido(id, !!id);
  const f = ficha.data;
  return (
    <Sheet open={!!id} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!f ? (
          <div className="pt-8">
            {ficha.error ? (
              tipoDoErro(ficha.error) === "sem_acesso" ? (
                <EstadoSemAcesso oQueFalta="Faturamento · Tesouraria desta empresa" />
              ) : (
                <ErroDaArea erro={ficha.error} tentarNovamente={() => void ficha.refetch()} />
              )
            ) : (
              <Carregando variante="tabela" linhas={4} />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {f.pedido.numero} <SeloSituacao situacao={f.pedido.status} />
              </SheetTitle>
              <SheetDescription>
                {[f.pedido.tomador.nome, f.pedido.emissora.apelido].filter(Boolean).join(" · ")}
              </SheetDescription>
              <Button asChild variant="link" size="sm" className="h-auto self-start px-0">
                <Link to="/faturamento/pedido/$id" params={{ id: f.pedido.id }} search={{ volta }}>
                  Abrir ficha completa
                </Link>
              </Button>
            </SheetHeader>
            <ResumoParaConferir f={f} />
            <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-2 border-t bg-surface-elevated px-6 py-3">
              <BotoesDoPedido ficha={f} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const DOC = { nf: "Nota fiscal", recibo: "Recibo", nd: "Nota de débito" } as const;

/** O que a tesouraria confere, em blocos curtos (contrato, `Sheet` do pedido). */
function ResumoParaConferir({ f }: { f: NonNullable<ReturnType<typeof useFichaPedido>["data"]> }) {
  const p = f.pedido;
  const t = p.tomador;
  const simulado = p.simulacao || p.status === "simulado";
  return (
    <div className="space-y-4">
      <Bloco titulo="Cliente">
        <p>{t.nome ?? "—"}</p>
        <p className="text-[13px] text-muted-foreground">
          {[documento(t.documento), t.municipio && `${t.municipio}${t.uf ? `/${t.uf}` : ""}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {t.situacao_conferida && t.situacao
            ? `Receita: ${t.situacao.toLowerCase()}`
            : "situação não conferida"}
        </p>
      </Bloco>
      <Bloco titulo="E-mails de envio">
        {p.emails_envio.length ? p.emails_envio.join(", ") : "—"}
      </Bloco>
      <Bloco titulo="Serviço">
        {p.servico
          ? `${p.servico.descricao}${p.servico.codigo_omie ? ` · código no Omie ${p.servico.codigo_omie}` : ""}`
          : "—"}
      </Bloco>
      <Bloco titulo="Descrição da nota">{p.descricao_nf ?? "—"}</Bloco>
      <Bloco titulo="Valor e parcelas">
        <p className="num">{dinheiro(p.valor)}</p>
        <ul className="num text-[13px] text-muted-foreground">
          {f.parcelas.map((x) => (
            <li key={x.n}>
              {x.n}ª · {dataCompleta(x.vencimento)} · {dinheiro(x.valor)}
            </li>
          ))}
        </ul>
      </Bloco>
      <Bloco titulo="Cobrança">
        {[
          p.documento ? DOC[p.documento] : null,
          p.meio === "pix" ? "Pix" : p.meio === "boleto" ? "Boleto" : null,
          p.competencia && `competência ${rotuloMes(p.competencia)}`,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      </Bloco>
      <Bloco titulo="Observações">
        <p>{p.observacoes ?? "—"}</p>
      </Bloco>
      <Bloco titulo="Dono e autor">
        {[
          p.dono?.nome && `dono: ${p.dono.nome}`,
          p.solicitante?.nome && `autor: ${p.solicitante.nome}`,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
        {p.confirmou_emissora && p.contratos_outra_emissora[0] && (
          <p className="text-[13px] text-muted-foreground">
            Empresa confirmada: o cliente tem contrato vigente na{" "}
            {p.contratos_outra_emissora[0].emissora.apelido}.
          </p>
        )}
      </Bloco>
      <Bloco titulo="No Omie">
        {simulado ? (
          <>
            <p>Simulado: nada foi gravado no Omie da {p.emissora.apelido}. Isto é o que iria:</p>
            <dl className="mt-1 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
              {oQueIriaAoOmie(f).map((l) => (
                <div key={l.rotulo} className="contents">
                  <dt className="text-muted-foreground">{l.rotulo}</dt>
                  <dd>{l.valor}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
        {/* O cliente no Omie (já existia ou cadastrado pelo portal), a OS e a nota: as linhas da Ficha. */}
        <div className="mt-2">
          <LinhasDoOmie ficha={f} compacto />
        </div>
      </Bloco>
    </div>
  );
}
