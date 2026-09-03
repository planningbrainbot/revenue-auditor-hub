import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShoppingCart, Timer, CheckCircle2, Wallet, Info } from "lucide-react";
import { toast } from "sonner";
import {
  carregarBrokerUnidade,
  reservarParaMinhaUnidade,
  liberarMinhaReserva,
  pedirFatura,
  cancelarFatura,
  type BrokerUnidadeData,
  type FilaUnidadeRow,
} from "@/lib/broker.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
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
      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
        Gerado por IA — confira antes de usar.
      </p>
      {aberto ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{corpo}</p>
      ) : null}
    </div>
  );
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {nota ? <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p> : null}
    </Card>
  );
}

export function BrokerUnidadeView() {
  const qc = useQueryClient();
  const carregar = useServerFn(carregarBrokerUnidade);
  const fnReservar = useServerFn(reservarParaMinhaUnidade);
  const fnLiberar = useServerFn(liberarMinhaReserva);

  const { data, isLoading, error } = useQuery<BrokerUnidadeData>({
    queryKey: ["broker-unidade"],
    queryFn: () => carregar(),
  });

  const [busca, setBusca] = useState("");
  const [comprando, setComprando] = useState(false);
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
    onSuccess: () => {
      toast.success("Fatura gerada. O crédito entra quando o pagamento for confirmado.");
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{s?.nome ?? "Minha unidade"}</Badge>
        <Button variant="outline" size="sm" className="ml-auto" onClick={recarregar}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

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
        <Kpi rotulo="Investido" valor={cb(s?.investido)} nota={`${compradas.length} fechado(s)`} />
      </div>

      <Tabs defaultValue="vitrine">
        <TabsList>
          <TabsTrigger value="vitrine">Disponíveis ({disponiveis.length})</TabsTrigger>
          <TabsTrigger value="minhas">Minhas reservas ({minhas.length})</TabsTrigger>
          <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          <TabsTrigger value="financeiro">Faturas e pagamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="vitrine" className="mt-3 space-y-3">
          <Input
            placeholder="Buscar por empresa ou segmento"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="max-w-sm"
          />
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
                  <Campo rotulo="Contato" valor={o.cliente_nome} />
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
                  <Button size="sm" onClick={() => setConfirmando(o)}>
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
        </TabsContent>

        <TabsContent value="minhas" className="mt-3 space-y-4">
          {minhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Você não tem cliente reservado.</p>
          ) : null}

          {minhas.map((o) => {
            const p = prazo(o.precificar_ate);
            return (
              <Card key={o.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{o.empresa ?? NA}</p>
                    <p className="text-xs text-muted-foreground">
                      {[o.cliente_nome, o.segmento, o.estado].filter(Boolean).join(" · ")}
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => mLiberar.mutate({ oportunidade_id: o.id })}
                  >
                    Liberar
                  </Button>
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
                          <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />
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
        </TabsContent>

        <TabsContent value="movimentacoes" className="mt-3">
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
        </TabsContent>
        <TabsContent value="financeiro" className="mt-3 space-y-4">
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Comprar CashBrain</p>
              <p className="text-sm text-muted-foreground">
                1 CashBrain = R$ 1,00. O crédito entra no saldo quando o pagamento é confirmado —
                pedir a fatura ainda não muda o seu disponível.
              </p>
            </div>
            <Button onClick={() => setComprando(true)}>
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
                            f.status === "paga" &&
                              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            f.status === "aberta" &&
                              "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                          )}
                        >
                          {f.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {f.status === "aberta" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => mCancelar.mutate({ fatura_id: f.id })}
                          >
                            Cancelar
                          </Button>
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
        </TabsContent>
      </Tabs>

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
