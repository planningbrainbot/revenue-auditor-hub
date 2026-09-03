import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import {
  carregarBrokerAdmin,
  reservarOportunidade,
  liberarOportunidade,
  lancarMovimento,
  definirMultiplicadorAplicado,
  type BrokerAdminData,
  type OportunidadeRow,
  type MultiplicadorRow,
} from "@/lib/broker.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const NA = "—";

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const cb = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} CB`;

const mult = (v: number | null | undefined) =>
  v === null || v === undefined ? NA : v.toLocaleString("pt-BR", { minimumFractionDigits: 3 });

const dataCurta = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : NA;

const mesLongo = (v: string) =>
  new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

const STATUS_COR: Record<string, string> = {
  disponivel: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  reservado: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  comprado: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  perdido: "bg-muted text-muted-foreground",
  matriz: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {nota ? <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p> : null}
    </Card>
  );
}

export function BrokerAdminView() {
  const qc = useQueryClient();
  const carregar = useServerFn(carregarBrokerAdmin);
  const { data, isLoading, error } = useQuery<BrokerAdminData>({
    queryKey: ["broker-admin"],
    queryFn: () => carregar(),
  });

  const [reservando, setReservando] = useState<OportunidadeRow | null>(null);
  const [unidadeAlvo, setUnidadeAlvo] = useState<string>("");
  const [lancando, setLancando] = useState(false);
  const [editandoMult, setEditandoMult] = useState<MultiplicadorRow | null>(null);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["broker-admin"] });
  const aoFalhar = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falhou.");

  const fnReservar = useServerFn(reservarOportunidade);
  const fnLiberar = useServerFn(liberarOportunidade);
  const fnLancar = useServerFn(lancarMovimento);
  const fnAplicado = useServerFn(definirMultiplicadorAplicado);

  const mReservar = useMutation({
    mutationFn: (d: { oportunidade_id: number; unidade_id: number }) => fnReservar({ data: d }),
    onSuccess: () => {
      toast.success("Oportunidade reservada.");
      setReservando(null);
      setUnidadeAlvo("");
      recarregar();
    },
    onError: aoFalhar,
  });
  const mLiberar = useMutation({
    mutationFn: (d: { oportunidade_id: number }) => fnLiberar({ data: d }),
    onSuccess: () => {
      toast.success("Reserva liberada — o saldo bloqueado volta para a unidade.");
      recarregar();
    },
    onError: aoFalhar,
  });
  const mLancar = useMutation({
    mutationFn: (d: {
      unidade_id: number;
      tipo: "credito" | "aporte" | "estorno";
      valor_cb: number;
      observacao: string;
    }) => fnLancar({ data: d }),
    onSuccess: () => {
      toast.success("Movimento lançado no extrato.");
      setLancando(false);
      recarregar();
    },
    onError: aoFalhar,
  });
  const mAplicado = useMutation({
    mutationFn: (d: { id: number; aplicado: number; observacao: string }) =>
      fnAplicado({ data: d }),
    onSuccess: () => {
      toast.success("Multiplicador aplicado atualizado.");
      setEditandoMult(null);
      recarregar();
    },
    onError: aoFalhar,
  });

  const unidadePorId = useMemo(
    () => new Map((data?.unidades ?? []).map((u) => [u.id, u.nome])),
    [data?.unidades],
  );

  const resumo = useMemo(() => {
    const o = data?.oportunidades ?? [];
    const por = (s: string) => o.filter((x) => x.status === s);
    const soma = (rs: OportunidadeRow[]) => rs.reduce((t, r) => t + (r.preco_cb ?? 0), 0);
    const disp = por("disponivel");
    return {
      disponiveis: disp.length,
      valorDisponivel: soma(disp),
      semPreco: disp.filter((r) => r.preco_cb === null).length,
      reservados: por("reservado").length,
      valorReservado: soma(por("reservado")),
      comprados: por("comprado").length,
    };
  }, [data?.oportunidades]);

  const vigente = useMemo(
    () => (data?.multiplicadores ?? []).find((m) => m.unidade_id === null) ?? null,
    [data?.multiplicadores],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando o broker…</p>;
  if (error)
    return (
      <Card className="border-destructive/40 p-4">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Falha ao carregar."}
        </p>
      </Card>
    );
  if (!data) return null;

  const somenteLeitura = !data.podeOperar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {somenteLeitura ? (
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" /> Somente leitura
          </Badge>
        ) : null}
        <Badge variant="outline" className="gap-1">
          {data.bloqueioPorSaldo ? (
            <>
              <Lock className="h-3 w-3" /> Bloqueio por saldo ligado
            </>
          ) : (
            <>
              <Unlock className="h-3 w-3" /> Sem bloqueio por saldo
            </>
          )}
        </Badge>
        <Button variant="outline" size="sm" className="ml-auto" onClick={recarregar}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Na fila"
          valor={String(resumo.disponiveis)}
          nota={
            resumo.semPreco
              ? `${resumo.semPreco} ainda sem preço — a unidade não precificou`
              : "todas precificadas"
          }
        />
        <Kpi rotulo="Valor disponível" valor={cb(resumo.valorDisponivel)} />
        <Kpi
          rotulo="Reservado"
          valor={String(resumo.reservados)}
          nota={cb(resumo.valorReservado) + " bloqueados"}
        />
        <Kpi
          rotulo="Multiplicador aplicado"
          valor={mult(vigente?.aplicado)}
          nota={vigente ? `apurado ${mult(vigente.apurado)} · ${mesLongo(vigente.mes)}` : undefined}
        />
      </div>

      <Tabs defaultValue="fila">
        <TabsList>
          <TabsTrigger value="fila">Fila</TabsTrigger>
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
          <TabsTrigger value="multiplicador">Multiplicador</TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="mt-3">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entrou</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.oportunidades.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.empresa ?? o.titulo ?? NA}</TableCell>
                    <TableCell className="text-muted-foreground">{o.segmento ?? NA}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {brl(o.mrr_precificado)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.preco_cb === null ? (
                        <span className="text-muted-foreground">a precificar</span>
                      ) : (
                        cb(o.preco_cb)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn(STATUS_COR[o.status])}>
                        {o.status}
                      </Badge>
                      {o.reservado_por ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {unidadePorId.get(o.reservado_por) ?? `unidade ${o.reservado_por}`}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dataCurta(o.entrou_em)}
                    </TableCell>
                    <TableCell className="text-right">
                      {somenteLeitura ? null : o.status === "disponivel" ? (
                        <Button size="sm" variant="outline" onClick={() => setReservando(o)}>
                          Reservar
                        </Button>
                      ) : o.status === "reservado" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mLiberar.mutate({ oportunidade_id: o.id })}
                        >
                          Liberar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {data.oportunidades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      A fila está vazia. O sync roda a cada 15 min.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="saldos" className="mt-3 space-y-3">
          {somenteLeitura ? null : (
            <Button size="sm" onClick={() => setLancando(true)}>
              Lançar crédito ou aporte
            </Button>
          )}
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Creditado</TableHead>
                  <TableHead className="text-right">Bloqueado</TableHead>
                  <TableHead className="text-right">Investido</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.saldos.map((s) => (
                  <TableRow key={s.unidade_id}>
                    <TableCell className="font-medium">{s.nome ?? NA}</TableCell>
                    <TableCell className="text-right tabular-nums">{cb(s.creditado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{cb(s.bloqueado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{cb(s.investido)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {cb(s.disponivel)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="extrato" className="mt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Extrato imutável: não existe update nem delete. Correção só por estorno.
          </p>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead>Quem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.movimentos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dataCurta(m.criado_em)}
                    </TableCell>
                    <TableCell>{unidadePorId.get(m.unidade_id) ?? m.unidade_id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{m.tipo}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{cb(m.valor_cb)}</TableCell>
                    <TableCell className="text-muted-foreground">{m.observacao ?? NA}</TableCell>
                    <TableCell className="text-muted-foreground">{m.criado_por ?? NA}</TableCell>
                  </TableRow>
                ))}
                {data.movimentos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhum movimento ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="multiplicador" className="mt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            O apurado vem do job mensal. O aplicado é ato humano e é o que a rede sente no preço.
          </p>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead className="text-right">Mídia</TableHead>
                  <TableHead className="text-right">Time C&amp;M</TableHead>
                  <TableHead className="text-right">New MRR</TableHead>
                  <TableHead className="text-right">Apurado</TableHead>
                  <TableHead className="text-right">Aplicado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.multiplicadores.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {mesLongo(m.mes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.unidade_id === null
                        ? "geral"
                        : (unidadePorId.get(m.unidade_id) ?? m.unidade_id)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(m.midia)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(m.time_cm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(m.new_mrr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{mult(m.apurado)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {mult(m.aplicado)}
                    </TableCell>
                    <TableCell className="text-right">
                      {somenteLeitura ? null : (
                        <Button size="sm" variant="ghost" onClick={() => setEditandoMult(m)}>
                          Definir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!reservando} onOpenChange={(o) => !o && setReservando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reservar em nome de uma unidade</DialogTitle>
            <DialogDescription>
              {reservando?.empresa ?? reservando?.titulo} ·{" "}
              {reservando?.preco_cb === null
                ? "sem preço ainda — a reserva entra no extrato quando a unidade precificar"
                : cb(reservando?.preco_cb)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select value={unidadeAlvo} onValueChange={setUnidadeAlvo}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a unidade" />
              </SelectTrigger>
              <SelectContent>
                {data.unidades.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReservando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!unidadeAlvo || mReservar.isPending}
              onClick={() =>
                reservando &&
                mReservar.mutate({
                  oportunidade_id: reservando.id,
                  unidade_id: Number(unidadeAlvo),
                })
              }
            >
              Reservar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormMovimento
        aberto={lancando}
        unidades={data.unidades}
        pendente={mLancar.isPending}
        onFechar={() => setLancando(false)}
        onEnviar={(d) => mLancar.mutate(d)}
      />

      <FormAplicado
        registro={editandoMult}
        pendente={mAplicado.isPending}
        onFechar={() => setEditandoMult(null)}
        onEnviar={(d) => mAplicado.mutate(d)}
      />
    </div>
  );
}

function FormMovimento({
  aberto,
  unidades,
  pendente,
  onFechar,
  onEnviar,
}: {
  aberto: boolean;
  unidades: { id: number; nome: string }[];
  pendente: boolean;
  onFechar: () => void;
  onEnviar: (d: {
    unidade_id: number;
    tipo: "credito" | "aporte" | "estorno";
    valor_cb: number;
    observacao: string;
  }) => void;
}) {
  const [unidade, setUnidade] = useState("");
  const [tipo, setTipo] = useState<"credito" | "aporte" | "estorno">("credito");
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançar no extrato</DialogTitle>
          <DialogDescription>
            O lançamento não pode ser editado nem apagado depois. Errou, corrige por estorno.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select value={unidade} onValueChange={setUnidade}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a unidade" />
              </SelectTrigger>
              <SelectContent>
                {unidades.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credito">Crédito da matriz</SelectItem>
                <SelectItem value="aporte">Aporte da unidade</SelectItem>
                <SelectItem value="estorno">Estorno</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valor em CashBrain</Label>
            <Input
              type="number"
              min={1}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="10000"
            />
          </div>
          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="De onde veio este crédito"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!unidade || !valor || pendente}
            onClick={() =>
              onEnviar({
                unidade_id: Number(unidade),
                tipo,
                valor_cb: Number(valor),
                observacao: obs,
              })
            }
          >
            Lançar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormAplicado({
  registro,
  pendente,
  onFechar,
  onEnviar,
}: {
  registro: MultiplicadorRow | null;
  pendente: boolean;
  onFechar: () => void;
  onEnviar: (d: { id: number; aplicado: number; observacao: string }) => void;
}) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");

  return (
    <Dialog
      open={!!registro}
      onOpenChange={(o) => {
        if (!o) {
          setValor("");
          setObs("");
          onFechar();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Definir o multiplicador aplicado</DialogTitle>
          <DialogDescription>
            {registro ? `${mesLongo(registro.mes)} · apurado ${mult(registro.apurado)}` : null}
            {" — mexer aqui muda o preço que a rede vê."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Aplicado</Label>
            <Input
              type="number"
              step="0.001"
              min={1}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={registro?.apurado ? String(registro.apurado) : "1,000"}
            />
            <p className="text-xs text-muted-foreground">Piso do modelo: 1,000.</p>
          </div>
          <div className="space-y-2">
            <Label>Por quê</Label>
            <Textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="A razão fica no registro, junto com quem decidiu"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!valor || !obs.trim() || pendente}
            onClick={() =>
              registro &&
              onEnviar({ id: registro.id, aplicado: Number(valor), observacao: obs.trim() })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
