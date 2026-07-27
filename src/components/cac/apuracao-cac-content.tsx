import { useMemo, useState } from "react";
import { Ban, Pencil, Plus, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { brl } from "@/components/audit/format";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAddItemCac,
  useAtualizarCnpjContratoCac,
  useCacTodasUnidades,
  useDeleteItemCac,
  useExcluirItemCac,
  useForcarAtualizacaoCac,
  useReincluirItemCac,
  useUpdateItemCac,
} from "@/hooks/use-cac";
import { cn } from "@/lib/utils";

type ItemCac = {
  id: number;
  unidade_id: number;
  unidade_nome: string;
  cnpj: string | null;
  razao_social: string;
  contrato_id: number | null;
  valor_cac_total: number;
  valor_parcela_1: number;
  valor_parcela_2: number;
  data_assinatura_contrato: string | null;
  prazo_parcela_1: string | null;
  data_envio_parcela_1: string | null;
  data_pagamento_parcela_1: string | null;
  status_parcela_1: string;
  data_recebimento_cliente: string | null;
  prazo_parcela_2: string | null;
  data_envio_parcela_2: string | null;
  data_pagamento_parcela_2: string | null;
  status_parcela_2: string;
  fonte: string;
  status_match: string | null;
  observacao: string | null;
  excluido_em: string | null;
  motivo_exclusao: string | null;
  mes_referencia: string;
};

function formatMesLabel(mes: string) {
  if (!mes) return "—";
  const [y, m] = mes.slice(0, 7).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatMesCurto(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

function fmtData(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR") : "—";
}

const PARCELA_BADGE: Record<string, { label: string; cls: string }> = {
  pendente: {
    label: "Pendente",
    cls: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  },
  atrasado: {
    label: "Atrasado",
    cls: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  },
  pago: {
    label: "Pago",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  },
  cobrado: {
    label: "Boleto enviado",
    cls: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  },
  aguardando_cliente: {
    label: "Aguardando cliente",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
};

// Quanto ainda falta a unidade repassar pra matriz: parcela 1 até ser paga, e
// parcela 2 a partir do momento em que o cliente já pagou (deixa de ser
// "aguardando_cliente" e passa a ser uma dívida real da unidade).
function valorAReceber(it: ItemCac): number {
  let v = 0;
  if (it.status_parcela_1 !== "pago") v += Number(it.valor_parcela_1 ?? 0);
  if (["pendente", "cobrado", "atrasado"].includes(it.status_parcela_2))
    v += Number(it.valor_parcela_2 ?? 0);
  return v;
}

type TimelineMes = {
  mes: string;
  label: string;
  recebido: number;
  projetado: number;
};

// Joga cada parcela no mês em que ela foi (ou deveria ser) recebida: mês do
// pagamento se já paga, mês do prazo se ainda em aberto (inclusive já
// vencida). Parcela 2 que ainda espera o cliente pagar a unidade não tem
// data nenhuma pra projetar — essas entram à parte, em "sem previsão".
function bucketParcela(
  mapa: Map<string, TimelineMes>,
  status: string,
  prazo: string | null,
  dataPagamento: string | null,
  valor: number,
) {
  const mesKey = status === "pago" ? dataPagamento : prazo;
  if (!mesKey) return false;
  const mes = mesKey.slice(0, 7);
  const atual = mapa.get(mes) ?? {
    mes,
    label: formatMesCurto(mes),
    recebido: 0,
    projetado: 0,
  };
  if (status === "pago") atual.recebido += valor;
  else atual.projetado += valor;
  mapa.set(mes, atual);
  return true;
}

export function ApuracaoCacContent() {
  const { isAdmin, loading } = usePermissions();
  const { data, isLoading } = useCacTodasUnidades();
  const updateItem = useUpdateItemCac();
  const addItem = useAddItemCac();
  const deleteItem = useDeleteItemCac();
  const excluirItem = useExcluirItemCac();
  const reincluirItem = useReincluirItemCac();
  const atualizarCnpj = useAtualizarCnpjContratoCac();
  const forcar = useForcarAtualizacaoCac();

  const [unidadeFiltro, setUnidadeFiltro] = useState<string>("todas");
  const [mostrarExcluidos, setMostrarExcluidos] = useState(false);

  const unidades = data?.unidades ?? [];

  const filtrados = useMemo(() => {
    const itens = (data?.itens ?? []) as ItemCac[];
    return itens.filter((it) => {
      if (unidadeFiltro !== "todas" && String(it.unidade_id) !== unidadeFiltro) return false;
      if (!mostrarExcluidos && it.excluido_em) return false;
      return true;
    });
  }, [data, unidadeFiltro, mostrarExcluidos]);

  const kpis = useMemo(() => {
    let vendido = 0;
    let recebido = 0;
    let aReceber = 0;
    for (const it of filtrados) {
      if (it.excluido_em) continue;
      vendido += Number(it.valor_cac_total ?? 0);
      if (it.status_parcela_1 === "pago") recebido += Number(it.valor_parcela_1 ?? 0);
      if (it.status_parcela_2 === "pago") recebido += Number(it.valor_parcela_2 ?? 0);
      aReceber += valorAReceber(it);
    }
    return { vendido, recebido, aReceber };
  }, [filtrados]);

  const timeline = useMemo(() => {
    const mapa = new Map<string, TimelineMes>();
    let semPrevisaoValor = 0;
    let semPrevisaoQtd = 0;
    for (const it of filtrados) {
      if (it.excluido_em) continue;
      bucketParcela(
        mapa,
        it.status_parcela_1,
        it.prazo_parcela_1,
        it.data_pagamento_parcela_1,
        it.valor_parcela_1,
      );
      const teveMes = bucketParcela(
        mapa,
        it.status_parcela_2,
        it.prazo_parcela_2,
        it.data_pagamento_parcela_2,
        it.valor_parcela_2,
      );
      if (!teveMes) {
        semPrevisaoValor += Number(it.valor_parcela_2 ?? 0);
        semPrevisaoQtd += 1;
      }
    }
    const meses = [...mapa.keys()].sort();
    return { data: meses.map((m) => mapa.get(m)!), semPrevisaoValor, semPrevisaoQtd };
  }, [filtrados]);

  const forcarAtualizacao = async () => {
    try {
      await forcar.mutateAsync();
      toast.success("Apuração de CAC atualizada.");
    } catch {
      // erro já tratado pelo onError padrão dos hooks
    }
  };

  const handleSalvarCnpj = async (it: ItemCac, cnpj: string) => {
    if (!it.contrato_id) return;
    try {
      await atualizarCnpj.mutateAsync({ contrato_id: it.contrato_id, cnpj });
      await forcar.mutateAsync();
      toast.success(`CNPJ salvo para ${it.razao_social} — apuração atualizada.`);
    } catch {
      // erro já tratado pelo onError padrão dos hooks
    }
  };

  const handleExcluir = (it: ItemCac, motivo: string) => {
    excluirItem.mutate(
      { item_id: it.id, motivo },
      { onSuccess: () => toast.success(`${it.razao_social} excluído.`) },
    );
  };

  const handleReincluir = (it: ItemCac) => {
    reincluirItem.mutate(
      { item_id: it.id },
      { onSuccess: () => toast.success(`${it.razao_social} reincluído.`) },
    );
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin)
    return (
      <div className="p-6 text-sm text-muted-foreground">Acesso restrito a usuários admin.</div>
    );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">CAC por unidade</h1>
            <p className="text-sm text-muted-foreground">
              Repasse de CAC por cliente novo — a regra varia por unidade (mês de atribuição, 7 dias
              após a assinatura, ou excedente mensal). Lista contínua, sempre editável — o que
              importa é se cada parcela já foi paga.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={forcar.isPending}
          onClick={forcarAtualizacao}
          title="Reprocessa contratos ganhos e recebimentos do Omie em todas as unidades, mantendo pagamentos já marcados."
        >
          <RefreshCw className={cn("h-3.5 w-3.5", forcar.isPending && "animate-spin")} />
          Forçar atualização
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={unidadeFiltro} onValueChange={setUnidadeFiltro}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as unidades</SelectItem>
              {unidades.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.nome_da_praca}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={mostrarExcluidos}
              onCheckedChange={(v) => setMostrarExcluidos(!!v)}
            />
            Mostrar excluídos
          </label>
        </div>
        <AddItemDialog unidades={unidades} onAdd={(payload) => addItem.mutate(payload)} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            CAC vendido {unidadeFiltro === "todas" ? "(rede)" : ""}
          </div>
          <div className="text-2xl font-bold">{brl(kpis.vendido)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            CAC recebido {unidadeFiltro === "todas" ? "(rede)" : ""}
          </div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
            {brl(kpis.recebido)}
          </div>
        </Card>
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="text-xs text-muted-foreground">
            CAC a receber {unidadeFiltro === "todas" ? "(rede)" : ""}
          </div>
          <div className="text-2xl font-bold">{brl(kpis.aReceber)}</div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">Projeção de recebimento por mês</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Cada parcela entra no mês em que já foi paga ou, se ainda em aberto, no mês do prazo.
        </p>
        {timeline.data.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Sem dados para exibir.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline.data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip formatter={(v: number) => brl(v)} />
                <Legend />
                <Bar dataKey="recebido" name="Recebido" stackId="cac" fill="#10b981" />
                <Bar dataKey="projetado" name="A receber" stackId="cac" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {timeline.semPrevisaoQtd > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            + {brl(timeline.semPrevisaoValor)} em {timeline.semPrevisaoQtd} parcela
            {timeline.semPrevisaoQtd > 1 ? "s" : ""} de 2ª parcela sem previsão (cliente ainda não
            pagou a unidade).
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando clientes…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Unidade</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">CNPJ</th>
                  <th className="px-3 py-2 text-left">Assinatura</th>
                  <th className="px-3 py-2 text-left">Mês</th>
                  <th className="px-3 py-2 text-right">Valor total</th>
                  <th className="px-3 py-2 text-right">Parcela 1 (7d pós assinatura)</th>
                  <th className="px-3 py-2 text-right">Parcela 2 (pós recebimento)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((it) => (
                  <tr
                    key={it.id}
                    className={cn("border-t align-top", it.excluido_em && "opacity-60")}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{it.unidade_nome}</td>
                    <td className="px-3 py-2">{it.razao_social}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {it.cnpj ? (
                        it.cnpj
                      ) : it.contrato_id != null && !it.excluido_em ? (
                        <EditarCnpjButton
                          it={it}
                          pending={atualizarCnpj.isPending}
                          onSave={(cnpj) => handleSalvarCnpj(it, cnpj)}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtData(it.data_assinatura_contrato)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground capitalize whitespace-nowrap">
                      {formatMesLabel(it.mes_referencia)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {brl(it.valor_cac_total)}
                    </td>
                    <td className="px-3 py-2 min-w-[160px]">
                      {it.excluido_em ? (
                        <div className="text-right text-xs text-muted-foreground">
                          {brl(it.valor_parcela_1)}
                        </div>
                      ) : (
                        <ParcelaCell
                          valor={it.valor_parcela_1}
                          prazo={it.prazo_parcela_1}
                          status={it.status_parcela_1}
                          dataEnvio={it.data_envio_parcela_1}
                          dataPagamento={it.data_pagamento_parcela_1}
                          onMarcarEnviado={(data) =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_1: data })
                          }
                          onDesmarcarEnviado={() =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_1: null })
                          }
                          onMarcarPago={(data) =>
                            updateItem.mutate({ id: it.id, data_pagamento_parcela_1: data })
                          }
                          onDesmarcar={() =>
                            updateItem.mutate({ id: it.id, data_pagamento_parcela_1: null })
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[160px]">
                      {it.excluido_em ? (
                        <div className="text-right text-xs text-muted-foreground">
                          {brl(it.valor_parcela_2)}
                        </div>
                      ) : (
                        <ParcelaCell
                          valor={it.valor_parcela_2}
                          prazo={it.prazo_parcela_2}
                          status={it.status_parcela_2}
                          dataEnvio={it.data_envio_parcela_2}
                          dataPagamento={it.data_pagamento_parcela_2}
                          onMarcarEnviado={(data) =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_2: data })
                          }
                          onDesmarcarEnviado={() =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_2: null })
                          }
                          onMarcarPago={(data) =>
                            updateItem.mutate({ id: it.id, data_pagamento_parcela_2: data })
                          }
                          onDesmarcar={() =>
                            updateItem.mutate({ id: it.id, data_pagamento_parcela_2: null })
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {it.excluido_em ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={reincluirItem.isPending}
                          onClick={() => handleReincluir(it)}
                        >
                          Reincluir
                        </Button>
                      ) : it.fonte === "manual" ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => deleteItem.mutate({ id: it.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <ExcluirItemButton
                          it={it}
                          pending={excluirItem.isPending}
                          onConfirm={(motivo) => handleExcluir(it, motivo)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ParcelaCell({
  valor,
  prazo,
  status,
  dataEnvio,
  dataPagamento,
  onMarcarEnviado,
  onDesmarcarEnviado,
  onMarcarPago,
  onDesmarcar,
}: {
  valor: number;
  prazo: string | null;
  status: string;
  dataEnvio: string | null;
  dataPagamento: string | null;
  onMarcarEnviado: (data: string) => void;
  onDesmarcarEnviado: () => void;
  onMarcarPago: (data: string) => void;
  onDesmarcar: () => void;
}) {
  const badge = PARCELA_BADGE[status] ?? { label: status, cls: "" };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1.5">
        <span className="font-medium">{brl(valor)}</span>
        <Badge className={cn("text-[10px] px-1.5 py-0", badge.cls)}>{badge.label}</Badge>
      </div>
      <div className="text-right text-[10px] text-muted-foreground">
        {dataPagamento
          ? `Pago em ${fmtData(dataPagamento)}`
          : dataEnvio
            ? `Boleto enviado em ${fmtData(dataEnvio)}`
            : prazo
              ? `Prazo: ${fmtData(prazo)}`
              : "—"}
      </div>
      <div className="flex flex-col items-end gap-1">
        {dataPagamento ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
            onClick={onDesmarcar}
          >
            <X className="h-3 w-3" /> Desfazer
          </Button>
        ) : (
          <>
            {dataEnvio ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                onClick={onDesmarcarEnviado}
              >
                <X className="h-3 w-3" /> Desfazer envio
              </Button>
            ) : (
              <MarcarDataButton
                label="Marcar boleto enviado"
                dialogTitle="Marcar boleto como enviado"
                fieldLabel="Data de envio"
                onConfirm={onMarcarEnviado}
              />
            )}
            <MarcarDataButton
              label="Marcar como pago"
              dialogTitle="Marcar parcela como paga"
              fieldLabel="Data do repasse"
              onConfirm={onMarcarPago}
            />
          </>
        )}
      </div>
    </div>
  );
}

function MarcarDataButton({
  label,
  dialogTitle,
  fieldLabel,
  onConfirm,
}: {
  label: string;
  dialogTitle: string;
  fieldLabel: string;
  onConfirm: (data: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-1.5 text-xs">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>{fieldLabel}</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm(data);
              setOpen(false);
            }}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirItemButton({
  it,
  onConfirm,
  pending,
}: {
  it: ItemCac;
  onConfirm: (motivo: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  const submit = () => {
    if (!motivo.trim()) {
      toast.error("Informe o motivo da exclusão.");
      return;
    }
    onConfirm(motivo.trim());
    setOpen(false);
    setMotivo("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-amber-600 hover:text-amber-700 dark:text-amber-400"
          title="Excluir da apuração"
        >
          <Ban className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir da apuração — {it.razao_social}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Motivo</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Excluindo…" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarCnpjButton({
  it,
  onSave,
  pending,
}: {
  it: ItemCac;
  onSave: (cnpj: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const digitsOnly = cnpj.replace(/\D/g, "");
  const valido = digitsOnly.length === 14;

  const submit = () => {
    if (!valido) {
      toast.error("CNPJ precisa ter 14 dígitos.");
      return;
    }
    onSave(digitsOnly);
    setOpen(false);
    setCnpj("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> —
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar CNPJ — {it.razao_social}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>CNPJ</Label>
          <Input
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !valido}>
            {pending ? "Salvando…" : "Salvar e atualizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({
  unidades,
  onAdd,
}: {
  unidades: { id: number; nome_da_praca: string }[];
  onAdd: (payload: {
    unidade_id: number;
    razao_social: string;
    cnpj?: string;
    valor_cac_total: number;
    observacao?: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [unidadeId, setUnidadeId] = useState<string>("");
  const [razao, setRazao] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");

  const podeSalvar = !!unidadeId && !!razao.trim() && !!valor;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Adicionar cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar cliente manualmente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Unidade *</Label>
            <Select value={unidadeId} onValueChange={setUnidadeId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {unidades.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.nome_da_praca}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Razão social *</Label>
            <Input value={razao} onChange={(e) => setRazao(e.target.value)} />
          </div>
          <div>
            <Label>CNPJ</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div>
            <Label>Valor total do CAC *</Label>
            <Input
              type="number"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div>
            <Label>Observação</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!podeSalvar}
            onClick={() => {
              onAdd({
                unidade_id: Number(unidadeId),
                razao_social: razao.trim(),
                cnpj: cnpj.trim() || undefined,
                valor_cac_total: Number(valor),
                observacao: obs.trim() || undefined,
              });
              setUnidadeId("");
              setRazao("");
              setCnpj("");
              setValor("");
              setObs("");
              setOpen(false);
            }}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
