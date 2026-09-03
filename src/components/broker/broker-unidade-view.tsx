import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShoppingCart, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  carregarBrokerUnidade,
  reservarParaMinhaUnidade,
  liberarMinhaReserva,
  type BrokerUnidadeData,
  type FilaUnidadeRow,
} from "@/lib/broker.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NA = "—";

const cb = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} CB`;

const dataCurta = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : NA;

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Disponível" valor={cb(s?.disponivel)} nota="para reservar clientes agora" />
        <Kpi rotulo="Reservado" valor={cb(s?.bloqueado)} nota={`${minhas.length} cliente(s)`} />
        <Kpi rotulo="Investido" valor={cb(s?.investido)} nota={`${compradas.length} fechado(s)`} />
        <Kpi rotulo="Crédito recebido" valor={cb(s?.creditado)} />
      </div>

      <Tabs defaultValue="vitrine">
        <TabsList>
          <TabsTrigger value="vitrine">Disponíveis ({disponiveis.length})</TabsTrigger>
          <TabsTrigger value="minhas">Minhas reservas ({minhas.length})</TabsTrigger>
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
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
                  <p className="truncate font-medium">{o.empresa ?? NA}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.segmento ?? "Segmento não informado"} · entrou {dataCurta(o.entrou_em)}
                  </p>
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
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Reservado em</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {minhas.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.empresa ?? NA}</TableCell>
                    <TableCell className="text-muted-foreground">{o.segmento ?? NA}</TableCell>
                    <TableCell className="text-right tabular-nums">{cb(o.preco_cb)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <Clock className="mr-1 inline h-3.5 w-3.5" />
                      {dataCurta(o.reservado_em)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => mLiberar.mutate({ oportunidade_id: o.id })}
                      >
                        Liberar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {minhas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Você não tem cliente reservado.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>

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

        <TabsContent value="extrato" className="mt-3">
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
      </Tabs>

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
