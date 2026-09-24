import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Lock, Unlock, AlertTriangle, Landmark } from "lucide-react";
import { toast } from "sonner";
import {
  carregarBrokerAdmin,
  reservarOportunidade,
  liberarOportunidade,
  lancarMovimento,
  definirMultiplicadorAplicado,
  pagarFatura,
  definirMultiplicadorManual,
  type BrokerAdminData,
  type OportunidadeRow,
  type MultiplicadorRow,
  type FaturaRow,
} from "@/lib/broker.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  KpiCard,
  KpiGrade,
  Procedencia,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/gente/estados-gente";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";

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

// Status da oportunidade: ícone + palavra (V7). "matriz" era violet
// (V3-matiz) e passa a neutro, como "perdido".
type Situacao = { rotulo: string; tom: TomStatus };

const STATUS_OPORTUNIDADE: Record<string, Situacao> = {
  disponivel: { rotulo: "Disponível", tom: "sucesso" },
  reservado: { rotulo: "Reservada", tom: "atencao" },
  comprado: { rotulo: "Comprada", tom: "info" },
  perdido: { rotulo: "Perdida", tom: "neutro" },
  matriz: { rotulo: "Matriz", tom: "neutro" },
};

const STATUS_FATURA: Record<string, Situacao> = {
  aberta: { rotulo: "Aberta", tom: "atencao" },
  paga: { rotulo: "Paga", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

/** Valor fora do mapa aparece como veio, com inicial maiúscula, em neutro. */
const situacao = (mapa: Record<string, Situacao>, v: string): Situacao =>
  mapa[v] ?? { rotulo: v.charAt(0).toUpperCase() + v.slice(1), tom: "neutro" };

const ABAS = ["fila", "saldos", "extrato", "multiplicador", "faturas", "cac"] as const;
type Aba = (typeof ABAS)[number];

/** Limite local do extrato de CAC na tela (o servidor traz até 400). */
const CORTE_CAC = 120;
const LIMITE_SERVIDOR_CAC = 400;

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN §1.6).
function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return <KpiCard rotulo={rotulo} valor={valor} nota={nota} />;
}

export function BrokerAdminView() {
  const qc = useQueryClient();
  const carregar = useServerFn(carregarBrokerAdmin);
  const { data, isLoading, error, dataUpdatedAt } = useQuery<BrokerAdminData>({
    queryKey: ["broker-admin"],
    queryFn: () => carregar(),
  });

  const [reservando, setReservando] = useState<OportunidadeRow | null>(null);
  const [unidadeAlvo, setUnidadeAlvo] = useState<string>("");
  const [lancando, setLancando] = useState(false);
  const [editandoMult, setEditandoMult] = useState<MultiplicadorRow | null>(null);
  const [lancandoMult, setLancandoMult] = useState(false);
  const [liberando, setLiberando] = useState<OportunidadeRow | null>(null);
  const [baixando, setBaixando] = useState<FaturaRow | null>(null);

  // Aba na URL (N7): ?aba=saldos reabre em Saldos; valor desconhecido cai na Fila.
  const [abaUrl, setAba] = useFiltroNaUrl("aba", "fila");
  const aba: Aba = (ABAS as readonly string[]).includes(abaUrl) ? (abaUrl as Aba) : "fila";

  const recarregar = () => qc.invalidateQueries({ queryKey: ["broker-admin"] });
  const aoFalhar = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falhou.");

  const fnReservar = useServerFn(reservarOportunidade);
  const fnLiberar = useServerFn(liberarOportunidade);
  const fnLancar = useServerFn(lancarMovimento);
  const fnAplicado = useServerFn(definirMultiplicadorAplicado);
  const fnPagar = useServerFn(pagarFatura);
  const fnMultManual = useServerFn(definirMultiplicadorManual);

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
    onSettled: () => setLiberando(null),
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

  const mMultManual = useMutation({
    mutationFn: (d: {
      mes: string;
      unidade_id: number | null;
      aplicado: number;
      observacao: string;
    }) => fnMultManual({ data: d }),
    onSuccess: () => {
      toast.success("Multiplicador lançado.");
      setLancandoMult(false);
      recarregar();
    },
    onError: aoFalhar,
  });

  const mPagar = useMutation({
    mutationFn: (d: { fatura_id: number; meio: string }) => fnPagar({ data: d }),
    onSuccess: () => {
      toast.success("Fatura baixada. O crédito entrou no extrato da unidade.");
      recarregar();
    },
    onError: aoFalhar,
    onSettled: () => setBaixando(null),
  });

  const unidadePorId = useMemo(
    () => new Map((data?.unidades ?? []).map((u) => [u.id, u.nome])),
    [data?.unidades],
  );

  const pendenciaPorUnidade = useMemo(
    () => new Map((data?.cacPendencia ?? []).map((p) => [p.unidade_id, p])),
    [data?.cacPendencia],
  );

  const cacTotais = useMemo(() => {
    const rs = data?.cacSaldos ?? [];
    // "A receber" soma só quem deve. Crédito de unidade que pagou a mais é outra
    // conversa e abatê-lo aqui esconderia dívida atrás de crédito alheio.
    const devedoras = rs.filter((r) => r.a_pagar > 0);
    return {
      cobrado: rs.reduce((t, r) => t + r.cobrado, 0),
      pago: rs.reduce((t, r) => t + r.pago, 0),
      aPagar: devedoras.reduce((t, r) => t + r.a_pagar, 0),
      devedoras: devedoras.length,
      semNota: (data?.cacPendencia ?? []).reduce((t, p) => t + Math.max(p.sem_nota, 0), 0),
    };
  }, [data?.cacSaldos, data?.cacPendencia]);

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

  // Procedência (N3), visível também nos estados degradados.
  const procedencia = (
    <Procedencia
      fonte="Broker da matriz: fila (Pipedrive, sync a cada 15 min), extrato imutável, faturas e CAC pós-pago"
      atualizadoEm={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
      regua="fila e saldos em CashBrain (1 CB = R$ 1,00); CAC em R$"
    />
  );

  if (isLoading)
    return (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        {procedencia}
      </div>
    );
  if (error) {
    const msg = error instanceof Error ? error.message : "Falha ao carregar.";
    // O servidor recusa com "Acesso negado: …" quando falta view.broker_admin.
    return (
      <div className="space-y-4">
        {msg.startsWith("Acesso negado") ? (
          <EstadoSemAcesso oQueFalta="view.broker_admin" />
        ) : (
          <EstadoErro
            titulo="Não foi possível ler o Broker da matriz"
            detalhe={`Resposta do servidor: ${msg}`}
            tentarNovamente={recarregar}
          />
        )}
        {procedencia}
      </div>
    );
  }
  if (!data) return null;

  const somenteLeitura = !data.podeOperar;
  // N8: sem manage.broker o botão fica à vista, desabilitado, dizendo por quê.
  const motivoLeitura = somenteLeitura
    ? "Somente leitura: operar o Broker exige a permissão manage.broker."
    : null;
  const cacCortado = data.cacExtrato.length > CORTE_CAC;
  const nomeUnidade = (id: number) => unidadePorId.get(id) ?? `unidade ${id}`;
  // Efeito e valor da liberação (V6), ditos antes de confirmar.
  const efeitoLiberar = (o: OportunidadeRow) => {
    const quem = o.reservado_por ? nomeUnidade(o.reservado_por) : "a unidade";
    const saldo =
      o.preco_cb === null
        ? "Ainda não há preço, então nada está bloqueado no saldo."
        : `${cb(o.preco_cb)} bloqueados voltam para o saldo disponível de ${quem}.`;
    return `${saldo} A oportunidade deixa de estar reservada para ${quem}.`;
  };

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

      <KpiGrade colunas={4}>
        <Kpi
          rotulo="Na fila"
          valor={String(resumo.disponiveis)}
          nota={
            resumo.semPreco
              ? `${resumo.semPreco} ainda sem preço — a unidade não precificou`
              : "todas precificadas"
          }
        />
        <Kpi
          rotulo="Valor da fila (soma dos preços)"
          valor={cb(resumo.valorDisponivel)}
          nota={
            resumo.semPreco
              ? `${resumo.semPreco} sem preço ficam fora da soma`
              : "oportunidades disponíveis"
          }
        />
        {/* N11: aqui é contagem; o CashBrain bloqueado vai na nota. */}
        <Kpi
          rotulo="Reservadas (oportunidades)"
          valor={String(resumo.reservados)}
          nota={cb(resumo.valorReservado) + " bloqueados"}
        />
        <Kpi
          rotulo="Multiplicador aplicado"
          valor={mult(vigente?.aplicado)}
          nota={vigente ? `apurado ${mult(vigente.apurado)} · ${mesLongo(vigente.mes)}` : undefined}
        />
      </KpiGrade>

      <Tabs value={aba} onValueChange={(v) => setAba(v)}>
        <TabsList>
          <TabsTrigger value="fila">Fila</TabsTrigger>
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
          <TabsTrigger value="multiplicador">Multiplicador</TabsTrigger>
          <TabsTrigger value="faturas">Faturas</TabsTrigger>
          <TabsTrigger value="cac">CAC</TabsTrigger>
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
                      <StatusBadge tom={situacao(STATUS_OPORTUNIDADE, o.status).tom}>
                        {situacao(STATUS_OPORTUNIDADE, o.status).rotulo}
                      </StatusBadge>
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
                      {o.status === "disponivel" ? (
                        <BotaoComMotivo
                          size="sm"
                          variant="outline"
                          disabled={somenteLeitura}
                          motivo={motivoLeitura}
                          onClick={() => setReservando(o)}
                        >
                          Reservar
                        </BotaoComMotivo>
                      ) : o.status === "reservado" ? (
                        <BotaoComMotivo
                          size="sm"
                          variant="ghost"
                          disabled={somenteLeitura}
                          motivo={motivoLeitura}
                          onClick={() => setLiberando(o)}
                        >
                          Liberar
                        </BotaoComMotivo>
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
          <BotaoComMotivo
            size="sm"
            disabled={somenteLeitura}
            motivo={motivoLeitura}
            onClick={() => setLancando(true)}
          >
            Lançar crédito ou aporte
          </BotaoComMotivo>
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
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              O apurado vem do job mensal. O aplicado é ato humano e é o que a rede sente no preço.
            </p>
            <BotaoComMotivo
              size="sm"
              className="ml-auto"
              disabled={somenteLeitura}
              motivo={motivoLeitura}
              onClick={() => setLancandoMult(true)}
            >
              Lançar manualmente
            </BotaoComMotivo>
          </div>
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
                      <BotaoComMotivo
                        size="sm"
                        variant="ghost"
                        disabled={somenteLeitura}
                        motivo={motivoLeitura}
                        onClick={() => setEditandoMult(m)}
                      >
                        Definir
                      </BotaoComMotivo>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="faturas" className="mt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Dar baixa é o que credita a unidade — o movimento de aporte nasce do pagamento, não do
            pedido.
          </p>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fatura</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Pedida</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.faturas.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">#{f.id}</TableCell>
                    <TableCell>{unidadePorId.get(f.unidade_id) ?? f.unidade_id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dataCurta(f.pedida_em)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{cb(f.valor_cb)}</TableCell>
                    <TableCell>
                      <StatusBadge tom={situacao(STATUS_FATURA, f.status).tom}>
                        {situacao(STATUS_FATURA, f.status).rotulo}
                      </StatusBadge>
                      {f.meio_pagamento ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {f.meio_pagamento}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.status === "aberta" ? (
                        <BotaoComMotivo
                          size="sm"
                          variant="outline"
                          disabled={somenteLeitura}
                          motivo={motivoLeitura}
                          onClick={() => setBaixando(f)}
                        >
                          Dar baixa
                        </BotaoComMotivo>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {data.faturas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma fatura pedida ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* CAC pós-pago das unidades. Moeda é real, não CashBrain: o aquário é
            pré-pago e este saldo é dívida já contraída. */}
        <TabsContent value="cac" className="mt-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi rotulo="Cobrado" valor={brl(cacTotais.cobrado)} nota="na rede" />
            <Kpi rotulo="Recebido" valor={brl(cacTotais.pago)} nota="baixas na conta da Partners" />
            <Kpi
              rotulo="A receber"
              valor={brl(cacTotais.aPagar)}
              nota={`${cacTotais.devedoras} unidade(s) devendo`}
            />
            <Kpi
              rotulo="Cobrado sem nota"
              valor={brl(cacTotais.semNota)}
              nota="pendente de emissão"
            />
          </div>

          {cacTotais.semNota > 0 ? (
            <Card className="flex gap-3 border-warning/40 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm">
                <strong>{brl(cacTotais.semNota)}</strong> foram cobrados no pipe e não têm nota
                emitida no Omie. Isso não é inadimplência da unidade: é emissão que ainda não
                aconteceu, e ninguém vai pagar o que não foi pedido.
              </p>
            </Card>
          ) : null}

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Já tem nota</TableHead>
                  <TableHead className="text-right">Sem nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cacSaldos.map((r) => {
                  const p = pendenciaPorUnidade.get(r.unidade_id);
                  const devendo = r.a_pagar > 0;
                  return (
                    <TableRow key={r.unidade_id}>
                      <TableCell className="font-medium">{r.nome ?? r.unidade_id}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(r.cobrado)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(r.pago)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          devendo ? "text-destructive" : "text-success",
                        )}
                      >
                        {devendo ? "" : "−"}
                        {brl(Math.abs(r.a_pagar))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {brl(p?.ja_tem_nota ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(p?.sem_nota ?? 0) > 0 ? (
                          <span className="font-medium text-warning">{brl(p?.sem_nota)}</span>
                        ) : (
                          <span className="text-muted-foreground">{NA}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {data.cacSaldos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma unidade paga CAC hoje.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cacExtrato.slice(0, CORTE_CAC).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dataCurta(m.criado_em)}
                    </TableCell>
                    <TableCell>{m.nome ?? m.unidade_id}</TableCell>
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
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nenhum lançamento de CAC.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
          {cacCortado ? (
            <p className="text-[13px] text-muted-foreground">
              Mostrando <span className="num">{CORTE_CAC}</span> de{" "}
              <span className="num">{data.cacExtrato.length}</span> lançamentos de CAC (os mais
              recentes)
              {data.cacExtrato.length >= LIMITE_SERVIDOR_CAC
                ? `; a consulta traz no máximo ${LIMITE_SERVIDOR_CAC}, então pode haver mais antigos`
                : ""}
              .
            </p>
          ) : null}
        </TabsContent>
      </Tabs>

      {procedencia}

      <AlertDialog
        open={!!liberando}
        onOpenChange={(o) => !o && !mLiberar.isPending && setLiberando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Liberar a reserva de {liberando?.empresa ?? liberando?.titulo ?? "esta oportunidade"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {liberando ? efeitoLiberar(liberando) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mLiberar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={mLiberar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (liberando) mLiberar.mutate({ oportunidade_id: liberando.id });
              }}
            >
              {mLiberar.isPending ? "Liberando…" : "Liberar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!baixando}
        onOpenChange={(o) => !o && !mPagar.isPending && setBaixando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dar baixa na fatura #{baixando?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cb(baixando?.valor_cb)} ({brl(baixando?.valor_brl)}) entram como aporte no extrato de{" "}
              {baixando ? nomeUnidade(baixando.unidade_id) : ""} e ficam no saldo disponível, com
              pagamento por transferência. O extrato é imutável: desfazer só por estorno.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mPagar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={mPagar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (baixando) mPagar.mutate({ fatura_id: baixando.id, meio: "transferência" });
              }}
            >
              <Landmark className="mr-1.5 h-3.5 w-3.5" />
              {mPagar.isPending ? "Dando baixa…" : "Dar baixa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <FormMultManual
        aberto={lancandoMult}
        unidades={data.unidades}
        pendente={mMultManual.isPending}
        onFechar={() => setLancandoMult(false)}
        onEnviar={(d) => mMultManual.mutate(d)}
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

/**
 * Lançamento manual: mês futuro ou override de uma unidade. Só o aplicado —
 * o apurado continua sendo do job.
 */
function FormMultManual({
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
    mes: string;
    unidade_id: number | null;
    aplicado: number;
    observacao: string;
  }) => void;
}) {
  const proximoMes = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const [mes, setMes] = useState(proximoMes());
  const [escopo, setEscopo] = useState("geral");
  const [aplicado, setAplicado] = useState("");
  const [obs, setObs] = useState("");

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançar multiplicador à mão</DialogTitle>
          <DialogDescription>
            Para abrir um mês que o job ainda não apurou, ou dar a uma unidade um múltiplo diferente
            do geral. Existindo lançamento para o mesmo mês e escopo, ele é substituído.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Vigência</Label>
            <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Escopo</Label>
            <Select value={escopo} onValueChange={setEscopo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="geral">Toda a rede</SelectItem>
                {unidades.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O override de uma unidade vence o geral no mesmo mês.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Aplicado</Label>
            <Input
              type="number"
              step="0.001"
              min={1}
              value={aplicado}
              onChange={(e) => setAplicado(e.target.value)}
              placeholder="1,000"
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
            disabled={!mes || !aplicado || Number(aplicado) < 1 || !obs.trim() || pendente}
            onClick={() =>
              onEnviar({
                mes,
                unidade_id: escopo === "geral" ? null : Number(escopo),
                aplicado: Number(aplicado),
                observacao: obs.trim(),
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
