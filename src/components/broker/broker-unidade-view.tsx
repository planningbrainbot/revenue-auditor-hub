import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  RefreshCw,
  ShoppingCart,
  Timer,
  CheckCircle2,
  Wallet,
  Info,
  Tag,
  History as HistoryIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  carregarBrokerUnidade,
  reservarParaMinhaUnidade,
  liberarMinhaReserva,
  pedirFatura,
  precificarOportunidade,
  cancelarFatura,
  type BrokerUnidadeData,
  type FilaUnidadeRow,
  type HistoricoPrecoRow,
} from "@/lib/broker.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/planning";

const NA = "—";

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const cb = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} CB`;

const dataCurta = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : NA;

/** Quanto falta para o prazo de precificar vencer. */
function prazo(ate: string | null) {
  if (!ate) return null;
  const ms = new Date(ate).getTime() - Date.now();
  const dias = Math.floor(ms / 86400000);
  const horas = Math.floor(ms / 3600000);
  if (ms <= 0) return { txt: "prazo vencido", venceu: true, urgente: true };
  if (horas < 24) return { txt: `${horas}h restantes`, venceu: false, urgente: true };
  return {
    txt: `${dias} dia${dias === 1 ? "" : "s"} restantes`,
    venceu: false,
    urgente: dias <= 2,
  };
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="truncate text-sm" title={valor}>
        {valor}
      </p>
    </div>
  );
}

/** Texto da IA. O aviso de conferir vem do próprio Planning Brain e fica visível. */
function NotaIa({
  titulo,
  texto,
  quando,
}: {
  titulo: string;
  texto: string | null;
  quando: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  if (!texto) return null;
  const corpo = texto.replace(/^.*confira antes de usar\s*/i, "").trim();
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium"
      >
        <span>{titulo}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {quando ? dataCurta(quando) : ""} · {aberto ? "esconder" : "ler"}
        </span>
      </button>
      <p className="mt-1 text-xs text-warning">Gerado por IA — confira antes de usar.</p>
      {aberto ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{corpo}</p>
      ) : null}
    </div>
  );
}

/** Trâmite do preço: o que mudou, de quanto para quanto, e por quem. */
function HistoricoPreco({ linhas }: { linhas: HistoricoPrecoRow[] }) {
  const [aberto, setAberto] = useState(false);
  if (linhas.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium"
      >
        <HistoryIcon className="h-3.5 w-3.5" />
        <span>Histórico de preço</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {linhas.length} altera{linhas.length === 1 ? "ção" : "ções"} ·{" "}
          {aberto ? "esconder" : "ver"}
        </span>
      </button>
      {aberto ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {linhas.map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {new Date(h.criado_em).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="tabular-nums">
                {h.preco_cb_anterior === null ? (
                  <>
                    precificado em <b>{cb(h.preco_cb)}</b>
                  </>
                ) : (
                  <>
                    {cb(h.preco_cb_anterior)} <span className="text-muted-foreground">→</span>{" "}
                    <b>{cb(h.preco_cb)}</b>
                  </>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{h.origem ?? ""}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN §1.6).
function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return <KpiCard rotulo={rotulo} valor={valor} nota={nota} />;
}

/**
 * Cada seção é uma página do menu do Broker. Até 23/09/2026 eram abas desta
 * tela; viraram rotas porque o Broker ganhou menu próprio no seletor de
 * produtos (NAVEGACAO.md N6: nada de aba que troca de assunto). A carga e as
 * ações continuam aqui, numa view só, para as cinco páginas lerem a mesma
 * query e uma reserva feita numa aparecer na outra sem nova busca.
 */
export type SecaoBroker = "oportunidades" | "reservas" | "movimentacoes" | "faturas" | "cac";

export function BrokerUnidadeView({ secao }: { secao: SecaoBroker }) {
  const qc = useQueryClient();
  // Durante "ver como", o banco devolve os dados da unidade vestida e recusa
  // qualquer escrita (gatilho `ver_como_somente_leitura`). O botão precisa
  // saber disso antes de o erro voltar: prometer reserva e entregar 42501 é
  // pior do que dizer de cara que a visão é de leitura.
  const { verComo } = usePermissions();
  const simulando = !!verComo?.ativo;
  const motivoSimulacao = `Você está vendo como ${verComo?.unidade ?? "outra unidade"}. A visão é só de leitura.`;
  const carregar = useServerFn(carregarBrokerUnidade);
  const fnReservar = useServerFn(reservarParaMinhaUnidade);
  const fnLiberar = useServerFn(liberarMinhaReserva);

  const { data, isLoading, error } = useQuery<BrokerUnidadeData>({
    // A unidade simulada entra na chave porque ela muda a resposta do servidor.
    // Sem isso, entrar ou sair de "ver como" reaproveita por 30s (o staleTime
    // global) a resposta da identidade anterior, e quem estava parado no /broker
    // quando ligou a simulação continua lendo "sem vínculo" sem nada refazer a
    // busca. `recarregar` segue funcionando: invalidar pelo prefixo alcança
    // todas as chaves que começam com ele.
    queryKey: ["broker-unidade", verComo?.unidade_id ?? null],
    queryFn: () => carregar(),
  });

  const [busca, setBusca] = useState("");
  const [comprando, setComprando] = useState(false);
  const [precificando, setPrecificando] = useState<FilaUnidadeRow | null>(null);
  const [mrr, setMrr] = useState("");
  const [valorCompra, setValorCompra] = useState("");
  const [confirmando, setConfirmando] = useState<FilaUnidadeRow | null>(null);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["broker-unidade"] });
  const aoFalhar = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falhou.");

  const mReservar = useMutation({
    mutationFn: (d: { oportunidade_id: number }) => fnReservar({ data: d }),
    onSuccess: () => {
      toast.success("Cliente reservado. O valor ficou bloqueado no seu saldo.");
      setConfirmando(null);
      recarregar();
    },
    onError: aoFalhar,
  });
  const fnPedir = useServerFn(pedirFatura);
  const fnCancelar = useServerFn(cancelarFatura);

  const mPedir = useMutation({
    mutationFn: (d: { valor_cb: number }) => fnPedir({ data: d }),
    onSuccess: (r: { erro?: string }) => {
      if (r?.erro) {
        toast.warning(`Fatura criada, mas a cobrança não foi gerada: ${r.erro}`);
      } else {
        toast.success("Fatura gerada. O crédito entra quando o pagamento for confirmado.");
      }
      setComprando(false);
      setValorCompra("");
      recarregar();
    },
    onError: aoFalhar,
  });
  const mCancelar = useMutation({
    mutationFn: (d: { fatura_id: number }) => fnCancelar({ data: d }),
    onSuccess: () => {
      toast.success("Fatura cancelada.");
      recarregar();
    },
    onError: aoFalhar,
  });

  const fnPrecificar = useServerFn(precificarOportunidade);
  const mPrecificar = useMutation({
    mutationFn: (d: { oportunidade_id: number; mrr_mensal: number }) => fnPrecificar({ data: d }),
    onSuccess: () => {
      toast.success("Cliente precificado. O valor foi bloqueado no seu saldo.");
      setPrecificando(null);
      setMrr("");
      recarregar();
    },
    onError: aoFalhar,
  });

  const mLiberar = useMutation({
    mutationFn: (d: { oportunidade_id: number }) => fnLiberar({ data: d }),
    onSuccess: () => {
      toast.success("Reserva liberada. O valor voltou para o seu saldo.");
      recarregar();
    },
    onError: aoFalhar,
  });

  const { disponiveis, minhas, compradas } = useMemo(() => {
    const f = data?.fila ?? [];
    const termo = busca.trim().toLowerCase();
    const casa = (r: FilaUnidadeRow) =>
      !termo ||
      (r.empresa ?? "").toLowerCase().includes(termo) ||
      (r.segmento ?? "").toLowerCase().includes(termo);
    return {
      disponiveis: f.filter((r) => r.status === "disponivel" && casa(r)),
      minhas: f.filter((r) => r.status === "reservado" && r.minha_reserva),
      compradas: f.filter((r) => r.status === "comprado" && r.minha_reserva),
    };
  }, [data?.fila, busca]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (error)
    return (
      <Card className="border-destructive/40 p-4">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Falha ao carregar."}
        </p>
      </Card>
    );
  if (!data) return null;

  if (data.semVinculo)
    return (
      <Card className="p-5">
        <p className="font-medium">Seu usuário ainda não está vinculado a uma unidade.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sem esse vínculo não dá para mostrar o seu saldo nem reservar cliente. Peça à matriz para
          fazer a ligação do seu login com a unidade.
        </p>
      </Card>
    );

  const s = data.saldo;
  const cacSaldo = data.cacSaldo;
  // Saldo negativo é crédito da unidade: ela pagou mais do que foi cobrada.
  const cacDevendo = (cacSaldo?.a_pagar ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{s?.nome ?? "Minha unidade"}</Badge>
        {/* O `title` do botão desabilitado não abre no Chrome, então o motivo
            precisa estar escrito na tela. */}
        {simulando ? (
          <span className="text-xs text-muted-foreground">
            Visão de leitura: reservar, precificar e comprar crédito ficam desligados enquanto você
            vê como {verComo?.unidade}.
          </span>
        ) : null}
        <Button variant="outline" size="sm" className="ml-auto" onClick={recarregar}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {/* O saldo só aparece onde o crédito é gasto. Movimentações já é o extrato. */}
      {secao === "oportunidades" || secao === "reservas" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Disponível</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{cb(s?.disponivel)}</p>
            <div className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
              <p className="flex justify-between gap-2">
                <span>Crédito recebido</span>
                <span className="tabular-nums">{cb(s?.credito_recebido)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span>Crédito comprado</span>
                <span className="tabular-nums">{cb(s?.credito_comprado)}</span>
              </p>
            </div>
          </Card>
          <Kpi rotulo="Reservado" valor={cb(s?.bloqueado)} nota={`${minhas.length} cliente(s)`} />
          <Kpi
            rotulo="Investido"
            valor={cb(s?.investido)}
            nota={`${compradas.length} fechado(s)`}
          />
        </div>
      ) : null}

      {secao === "oportunidades" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Buscar por empresa ou segmento"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="max-w-sm"
            />
            <span className="text-sm text-muted-foreground">
              {disponiveis.length} cliente(s) disponível(is)
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disponiveis.map((o) => (
              <Card key={o.id} className="flex flex-col gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={o.empresa ?? ""}>
                    {o.empresa ?? NA}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[o.segmento, o.estado].filter(Boolean).join(" · ") || "sem segmento"} · entrou{" "}
                    {dataCurta(o.entrou_em)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-y py-2">
                  <Campo rotulo="Faturamento anual" valor={o.faturamento_anual} />
                  <Campo rotulo="Regime tributário" valor={o.regime_tributario} />
                  <Campo rotulo="Usa ERP" valor={o.usa_erp} />
                  <Campo rotulo="Canal" valor={o.canal} />
                  <Campo rotulo="Conduziu a reunião" valor={o.condutor_reuniao} />
                </div>

                <div className="mt-auto flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Preço</p>
                    <p className="text-lg font-bold tabular-nums">
                      {o.preco_cb === null ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          aguardando precificação
                        </span>
                      ) : (
                        cb(o.preco_cb)
                      )}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={simulando}
                    title={simulando ? motivoSimulacao : undefined}
                    onClick={() => setConfirmando(o)}
                  >
                    <ShoppingCart className="mr-1.5 h-3.5 w-3.5" /> Reservar
                  </Button>
                </div>
              </Card>
            ))}
            {disponiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {busca ? "Nada encontrado com esse termo." : "Nenhum cliente disponível agora."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {secao === "reservas" ? (
        <div className="space-y-4">
          {minhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Você não tem cliente reservado.</p>
          ) : (
            <p className="text-sm text-muted-foreground">{minhas.length} cliente(s) reservado(s)</p>
          )}

          {minhas.map((o) => {
            const p = prazo(o.precificar_ate);
            return (
              <Card key={o.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{o.empresa ?? NA}</p>
                    <p className="text-xs text-muted-foreground">
                      {[o.segmento, o.estado].filter(Boolean).join(" · ")}
                      {o.reservado_em ? ` · reservado ${dataCurta(o.reservado_em)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Preço</p>
                    <p className="font-bold tabular-nums">
                      {o.preco_cb === null ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          a precificar
                        </span>
                      ) : (
                        cb(o.preco_cb)
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {o.preco_cb === null ? (
                      <Button
                        size="sm"
                        disabled={simulando}
                        title={simulando ? motivoSimulacao : undefined}
                        onClick={() => setPrecificando(o)}
                      >
                        <Tag className="mr-1.5 h-3.5 w-3.5" /> Precificar
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={simulando}
                      title={simulando ? motivoSimulacao : undefined}
                      onClick={() => mLiberar.mutate({ oportunidade_id: o.id })}
                    >
                      Liberar
                    </Button>
                  </div>
                </div>

                {p ? (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                      p.urgente
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Timer className="h-4 w-4 shrink-0" />
                    <span>
                      <b>{p.txt}</b> para precificar
                      {p.venceu
                        ? " — a matriz pode devolver este cliente para a fila."
                        : ". Enquanto não houver preço, nada é bloqueado no seu saldo."}
                    </span>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  <Campo rotulo="Faturamento anual" valor={o.faturamento_anual} />
                  <Campo rotulo="Regime tributário" valor={o.regime_tributario} />
                  <Campo rotulo="Usa ERP" valor={o.usa_erp} />
                  <Campo rotulo="Canal" valor={o.canal} />
                  <Campo rotulo="Conduziu a reunião" valor={o.condutor_reuniao} />
                </div>

                <HistoricoPreco
                  linhas={(data.historicoPreco ?? []).filter((h) => h.oportunidade_id === o.id)}
                />

                <div className="space-y-2">
                  <NotaIa
                    titulo="🤖 Qualificação por IA (Planning Brain)"
                    texto={o.qualificacao_ia}
                    quando={o.qualificacao_ia_em}
                  />
                  <NotaIa
                    titulo="🎯 Direcionamento de FUP por IA (Planning Brain)"
                    texto={o.fup_ia}
                    quando={o.fup_ia_em}
                  />
                </div>
              </Card>
            );
          })}

          {compradas.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Já fechados</p>
              <Card className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {compradas.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">
                          <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-success" />
                          {o.empresa ?? NA}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{cb(o.preco_cb)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      {secao === "movimentacoes" ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Movimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.extrato.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dataCurta(m.criado_em)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{m.tipo}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{cb(m.valor_cb)}</TableCell>
                  <TableCell className="text-muted-foreground">{m.observacao ?? NA}</TableCell>
                </TableRow>
              ))}
              {data.extrato.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Nenhum movimento ainda.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {secao === "faturas" ? (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Comprar CashBrain</p>
              <p className="text-sm text-muted-foreground">
                1 CashBrain = R$ 1,00. O crédito entra no saldo quando o pagamento é confirmado —
                pedir a fatura ainda não muda o seu disponível.
              </p>
            </div>
            <Button
              disabled={simulando}
              title={simulando ? motivoSimulacao : undefined}
              onClick={() => setComprando(true)}
            >
              <Wallet className="mr-1.5 h-4 w-4" /> Comprar crédito
            </Button>
          </Card>

          {data.instrucoesPagamento ? (
            <Card className="flex gap-3 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Como pagar</p>
                <p className="text-sm text-muted-foreground">{data.instrucoesPagamento}</p>
              </div>
            </Card>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">Faturas</p>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fatura</TableHead>
                    <TableHead>Pedida em</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.faturas.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">#{f.id}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {dataCurta(f.pedida_em)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.vence_em ? dataCurta(f.vence_em) : NA}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(f.valor_brl)}{" "}
                        <span className="text-muted-foreground">· {cb(f.valor_cb)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn(
                            f.status === "paga" && "bg-success/10 text-success",
                            f.status === "aberta" && "bg-warning/10 text-warning",
                          )}
                        >
                          {f.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {f.status === "aberta" ? (
                          <div className="flex justify-end gap-1">
                            {f.link_pagamento ? (
                              <Button size="sm" asChild>
                                <a
                                  href={f.link_pagamento}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Pagar
                                </a>
                              </Button>
                            ) : null}
                            {f.pix_copia_cola ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  navigator.clipboard?.writeText(f.pix_copia_cola ?? "");
                                  toast.success("Pix copiado.");
                                }}
                              >
                                Pix
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={simulando}
                              title={simulando ? motivoSimulacao : undefined}
                              onClick={() => mCancelar.mutate({ fatura_id: f.id })}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.faturas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Nenhuma fatura ainda.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Card>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Extrato de pagamentos</p>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pago em</TableHead>
                    <TableHead>Fatura</TableHead>
                    <TableHead>Meio</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.faturas
                    .filter((f) => f.status === "paga")
                    .map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-muted-foreground">
                          {dataCurta(f.paga_em)}
                        </TableCell>
                        <TableCell>#{f.id}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {f.meio_pagamento ?? NA}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {brl(f.valor_brl)}
                        </TableCell>
                      </TableRow>
                    ))}
                  {data.faturas.filter((f) => f.status === "paga").length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Nenhum pagamento registrado.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Card>
          </div>
        </div>
      ) : null}

      {/* CAC pós-pago. Moeda diferente do aquário: aqui é real, não CashBrain.
          Unidade que não paga CAC não tem linha em v_broker_cac_saldo. O item de
          menu aparece para todas (a lateral não sabe disso sem consultar), então a
          página diz que a régua não se aplica, em vez de mostrar zeros que
          afirmariam que a unidade não deve nada. */}
      {secao === "cac" && !cacSaldo ? (
        <Card className="flex gap-3 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            A régua de CAC não se aplica à sua unidade. Ela vale para unidades que recebem clientes
            entregues pela matriz com cobrança de CAC pós-paga.
          </p>
        </Card>
      ) : null}
      {secao === "cac" && cacSaldo ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              rotulo="Cobrado"
              valor={brl(cacSaldo.cobrado)}
              nota="clientes entregues pela matriz"
            />
            <Kpi rotulo="Pago" valor={brl(cacSaldo.pago)} nota="baixas registradas" />
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {cacDevendo ? "A pagar" : "A seu favor"}
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold tabular-nums",
                  cacDevendo ? "text-destructive" : "text-success",
                )}
              >
                {brl(Math.abs(cacSaldo.a_pagar))}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cacDevendo
                  ? "cobrado menos o que já entrou"
                  : "você pagou mais do que foi cobrado"}
              </p>
            </Card>
          </div>

          <Card className="flex gap-3 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Cada linha de cobrança nasce de um cliente que a matriz entregou. Os pagamentos vêm
              das baixas na conta da Partners. Clientes já atribuídos mas ainda não cobrados ficam
              na lista de baixo e <strong>não entram neste saldo</strong>.
            </p>
          </Card>

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cacExtrato.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dataCurta(m.criado_em)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.tipo === "pagamento" ? "default" : "secondary"}>
                        {m.tipo === "pagamento" ? "pagamento" : "cobrança"}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.cliente ?? m.observacao ?? NA}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        m.tipo === "pagamento" && "text-success",
                      )}
                    >
                      {m.tipo === "pagamento" ? "−" : ""}
                      {brl(m.valor_cb)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.cacExtrato.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Nenhuma cobrança de CAC lançada ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>

          {data.cacFila.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Ainda não cobrados{" "}
                <span className="font-normal text-muted-foreground">
                  · {data.cacFila.length} cliente(s) ·{" "}
                  {brl(data.cacFila.reduce((t, r) => t + (r.valor ?? 0), 0))}
                </span>
              </p>
              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.cacFila.map((r) => (
                      <TableRow key={`${r.unidade_id}-${r.cliente}-${r.mes_referencia}`}>
                        <TableCell>{r.cliente ?? NA}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dataCurta(r.mes_referencia)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(r.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={!!precificando}
        onOpenChange={(o) => {
          if (!o) {
            setPrecificando(null);
            setMrr("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Precificar {precificando?.empresa}</DialogTitle>
            <DialogDescription>
              Informe o MRR mensal contratado. Ele define o preço deste cliente, que passa a ficar
              bloqueado no seu saldo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>MRR mensal</Label>
            <Input
              type="number"
              min={1}
              step={100}
              value={mrr}
              onChange={(e) => setMrr(e.target.value)}
              placeholder="3500"
            />
            <p className="text-xs text-muted-foreground">
              {mrr && Number(mrr) > 0 ? `${brl(Number(mrr))} por mês` : "Valor mensal."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrecificando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!mrr || Number(mrr) <= 0 || mPrecificar.isPending}
              onClick={() =>
                precificando &&
                mPrecificar.mutate({
                  oportunidade_id: precificando.id,
                  mrr_mensal: Number(mrr),
                })
              }
            >
              Precificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={comprando} onOpenChange={(o) => !o && setComprando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comprar CashBrain</DialogTitle>
            <DialogDescription>
              Gera uma fatura no valor pedido. O crédito só entra no saldo depois que a matriz
              confirmar o pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Quanto quer comprar</Label>
            <Input
              type="number"
              min={1}
              step={100}
              value={valorCompra}
              onChange={(e) => setValorCompra(e.target.value)}
              placeholder="10000"
            />
            <p className="text-xs text-muted-foreground">
              {valorCompra && Number(valorCompra) > 0
                ? `${cb(Number(valorCompra))} · ${brl(Number(valorCompra))}`
                : "1 CashBrain = R$ 1,00"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComprando(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!valorCompra || Number(valorCompra) <= 0 || mPedir.isPending}
              onClick={() => mPedir.mutate({ valor_cb: Number(valorCompra) })}
            >
              Gerar fatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmando} onOpenChange={(o) => !o && setConfirmando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reservar {confirmando?.empresa}</DialogTitle>
            <DialogDescription>
              {confirmando?.preco_cb === null
                ? "Este cliente ainda não tem preço. A reserva segura o cliente para você agora, e o valor é bloqueado assim que a precificação sair."
                : `${cb(confirmando?.preco_cb)} ficam bloqueados no seu saldo enquanto a reserva estiver de pé. Se não fechar, você libera e o valor volta.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={mReservar.isPending}
              onClick={() => confirmando && mReservar.mutate({ oportunidade_id: confirmando.id })}
            >
              Reservar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
