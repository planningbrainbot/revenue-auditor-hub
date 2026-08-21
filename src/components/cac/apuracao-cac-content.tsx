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
  valor_pago_parcela_1: number | null;
  status_parcela_1: string;
  data_recebimento_cliente: string | null;
  prazo_parcela_2: string | null;
  data_envio_parcela_2: string | null;
  data_pagamento_parcela_2: string | null;
  valor_pago_parcela_2: number | null;
  estimativa_parcela_2: string | null;
  status_parcela_2: string;
  fonte: string;
  status_match: string | null;
  observacao: string | null;
  excluido_em: string | null;
  motivo_exclusao: string | null;
  mes_referencia: string;
  // Data real de assinatura do contrato (Pipefy) — distinta de
  // data_assinatura_contrato, que na verdade é a data da venda ganha
  // (Pipedrive) e só serve pro cálculo do prazo da parcela 1.
  contrato_assinado_em: string | null;
};

// "Disponível pra cobrar": tem algo pendente e o contrato já foi assinado de
// fato (ou é item manual, sem contrato vinculado — não passa por esse gate).
// Achado 21/08/2026: venda ganha (ganho_em) != contrato assinado; a apuração
// gera o item já no mês da venda, mas cobrar a unidade antes da assinatura
// real não tem base contratual.
function contratoAssinado(it: ItemCac): boolean {
  return it.contrato_id == null || !!it.contrato_assinado_em;
}

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

// Valor real de uma parcela paga: o repasse às vezes não bate com o
// pré-fixado (metade do MRR) — quando isso é corrigido manualmente, o
// valor_pago_parcela_X prevalece sobre o previsto.
function valorEfetivo(valorPrevisto: number, valorPago: number | null): number {
  return valorPago ?? Number(valorPrevisto ?? 0);
}

// Tudo que ainda não foi pago — inclusive a 2ª parcela "aguardando_cliente"
// (contratada, mas o cliente ainda nem pagou a unidade). Por construção,
// vendido = recebido + a receber sempre fecha, item a item.
function valorAReceber(it: ItemCac): number {
  let v = 0;
  if (it.status_parcela_1 !== "pago") v += Number(it.valor_parcela_1 ?? 0);
  if (it.status_parcela_2 !== "pago") v += Number(it.valor_parcela_2 ?? 0);
  return v;
}

type TimelineMes = {
  mes: string;
  label: string;
  recebido: number;
  projetado: number;
  estimado: number;
};

function addAoMes(
  mapa: Map<string, TimelineMes>,
  dataISO: string,
  campo: "recebido" | "projetado" | "estimado",
  valor: number,
) {
  const mes = dataISO.slice(0, 7);
  const atual = mapa.get(mes) ?? {
    mes,
    label: formatMesCurto(mes),
    recebido: 0,
    projetado: 0,
    estimado: 0,
  };
  atual[campo] += valor;
  mapa.set(mes, atual);
}

function diasEntreISO(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function addDiasISO(dateStr: string, dias: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
}

type Medianas = { porUnidade: Map<string, number>; global: number | null };

// Mediana de dias entre assinatura do contrato e 1º pagamento do cliente —
// por unidade (com amostra mínima de 3, senão o outlier vira a "regra"), com
// fallback pra mediana da rede inteira. Usada só pra estimar quando a 2ª
// parcela provavelmente vira caixa pra quem ainda está "aguardando cliente".
function calcularMedianas(itens: ItemCac[]): Medianas {
  const porUnidadeAmostras = new Map<string, number[]>();
  const todasAmostras: number[] = [];
  for (const it of itens) {
    if (!it.data_assinatura_contrato || !it.data_recebimento_cliente) continue;
    const dias = diasEntreISO(it.data_assinatura_contrato, it.data_recebimento_cliente);
    if (dias < 0) continue;
    todasAmostras.push(dias);
    const lista = porUnidadeAmostras.get(it.unidade_nome) ?? [];
    lista.push(dias);
    porUnidadeAmostras.set(it.unidade_nome, lista);
  }
  const porUnidade = new Map<string, number>();
  for (const [unidade, amostras] of porUnidadeAmostras) {
    if (amostras.length < 3) continue;
    const m = mediana(amostras);
    if (m != null) porUnidade.set(unidade, m);
  }
  return { porUnidade, global: mediana(todasAmostras) };
}

// Data provável da 2ª parcela pra quem ainda não tem prazo (cliente não
// pagou a unidade ainda). Override manual sempre vence; sem override, usa a
// mediana histórica da unidade (ou da rede, se a unidade não tem amostra
// suficiente). Sem assinatura nem mediana nenhuma, não dá pra estimar.
function estimarParcela2(
  it: ItemCac,
  medianas: Medianas,
): { data: string | null; manual: boolean } {
  if (it.estimativa_parcela_2) return { data: it.estimativa_parcela_2, manual: true };
  if (!it.data_assinatura_contrato) return { data: null, manual: false };
  const dias = medianas.porUnidade.get(it.unidade_nome) ?? medianas.global;
  if (dias == null) return { data: null, manual: false };
  return { data: addDiasISO(it.data_assinatura_contrato, Math.round(dias)), manual: false };
}

type ClassificacaoParcela = { mes: string; tipo: "recebido" | "projetado" | "estimado" };

// Em que mês cada parcela conta — mesma regra usada no gráfico de projeção,
// reaproveitada aqui pro filtro por mês: paga entra pelo mês do pagamento,
// em aberto com prazo definido entra pelo mês do prazo, 2ª parcela sem prazo
// nenhum entra pela estimativa (histórica ou manual).
function classificarParcela1(it: ItemCac): ClassificacaoParcela | null {
  if (it.status_parcela_1 === "pago" && it.data_pagamento_parcela_1) {
    return { mes: it.data_pagamento_parcela_1.slice(0, 7), tipo: "recebido" };
  }
  if (it.prazo_parcela_1) return { mes: it.prazo_parcela_1.slice(0, 7), tipo: "projetado" };
  return null;
}

function classificarParcela2(it: ItemCac, medianas: Medianas): ClassificacaoParcela | null {
  if (it.status_parcela_2 === "pago" && it.data_pagamento_parcela_2) {
    return { mes: it.data_pagamento_parcela_2.slice(0, 7), tipo: "recebido" };
  }
  if (it.prazo_parcela_2) return { mes: it.prazo_parcela_2.slice(0, 7), tipo: "projetado" };
  const estimativa = estimarParcela2(it, medianas);
  return estimativa.data ? { mes: estimativa.data.slice(0, 7), tipo: "estimado" } : null;
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
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [mesFiltro, setMesFiltro] = useState<string>("todos");
  const [mostrarExcluidos, setMostrarExcluidos] = useState(false);
  // Por padrão, contratos sem assinatura confirmada ficam fora da lista
  // principal (não há base pra cobrar a unidade ainda) — visíveis só ligando
  // este toggle. Ver contratoAssinado().
  const [mostrarAguardandoAssinatura, setMostrarAguardandoAssinatura] = useState(false);

  const unidades = data?.unidades ?? [];

  // Amostra vem sempre da base inteira (não da filtrada) — quanto mais
  // dados, melhor a mediana; o filtro por unidade já busca a mediana certa
  // dentro do mapa.
  const medianas = useMemo(() => calcularMedianas((data?.itens ?? []) as ItemCac[]), [data]);

  // Lista de meses do seletor vem da base inteira (não da já filtrada) —
  // trocar unidade/status não deve fazer meses desaparecerem do filtro.
  const mesesDisponiveis = useMemo(() => {
    const itens = (data?.itens ?? []) as ItemCac[];
    const set = new Set<string>();
    for (const it of itens) {
      if (it.excluido_em) continue;
      const c1 = classificarParcela1(it);
      if (c1) set.add(c1.mes);
      const c2 = classificarParcela2(it, medianas);
      if (c2) set.add(c2.mes);
    }
    return [...set].sort();
  }, [data, medianas]);

  // Contratos com algo pendente mas ainda sem assinatura confirmada — ocultos
  // da lista principal por padrão (banner abaixo mostra quantos/quanto, com
  // toggle pra revelar). Respeita o filtro de unidade, não os demais.
  const aguardandoAssinatura = useMemo(() => {
    const itens = (data?.itens ?? []) as ItemCac[];
    return itens.filter((it) => {
      if (it.excluido_em) return false;
      if (unidadeFiltro !== "todas" && String(it.unidade_id) !== unidadeFiltro) return false;
      return !contratoAssinado(it) && valorAReceber(it) > 0;
    });
  }, [data, unidadeFiltro]);

  const filtrados = useMemo(() => {
    const itens = (data?.itens ?? []) as ItemCac[];
    return itens.filter((it) => {
      if (unidadeFiltro !== "todas" && String(it.unidade_id) !== unidadeFiltro) return false;
      if (!mostrarExcluidos && it.excluido_em) return false;
      if (!it.excluido_em) {
        if (!mostrarAguardandoAssinatura && !contratoAssinado(it) && valorAReceber(it) > 0) return false;
        if (statusFiltro === "recebido" && valorAReceber(it) > 0) return false;
        if (statusFiltro === "a_receber" && valorAReceber(it) === 0) return false;
        if (mesFiltro !== "todos") {
          const c1 = classificarParcela1(it);
          const c2 = classificarParcela2(it, medianas);
          if (c1?.mes !== mesFiltro && c2?.mes !== mesFiltro) return false;
        }
      }
      return true;
    });
  }, [data, unidadeFiltro, statusFiltro, mesFiltro, mostrarExcluidos, mostrarAguardandoAssinatura, medianas]);

  const kpis = useMemo(() => {
    let vendido = 0;
    let recebido = 0;
    let aReceber = 0;
    for (const it of filtrados) {
      if (it.excluido_em) continue;
      vendido += Number(it.valor_cac_total ?? 0);
      if (it.status_parcela_1 === "pago")
        recebido += valorEfetivo(it.valor_parcela_1, it.valor_pago_parcela_1);
      if (it.status_parcela_2 === "pago")
        recebido += valorEfetivo(it.valor_parcela_2, it.valor_pago_parcela_2);
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

      const c1 = classificarParcela1(it);
      if (c1) {
        const valor1 =
          c1.tipo === "recebido"
            ? valorEfetivo(it.valor_parcela_1, it.valor_pago_parcela_1)
            : Number(it.valor_parcela_1 ?? 0);
        addAoMes(mapa, c1.mes, c1.tipo, valor1);
      }

      const c2 = classificarParcela2(it, medianas);
      if (c2) {
        const valor2 =
          c2.tipo === "recebido"
            ? valorEfetivo(it.valor_parcela_2, it.valor_pago_parcela_2)
            : Number(it.valor_parcela_2 ?? 0);
        addAoMes(mapa, c2.mes, c2.tipo, valor2);
      } else {
        semPrevisaoValor += Number(it.valor_parcela_2 ?? 0);
        semPrevisaoQtd += 1;
      }
    }
    const meses = [...mapa.keys()].sort();
    return { data: meses.map((m) => mapa.get(m)!), semPrevisaoValor, semPrevisaoQtd };
  }, [filtrados, medianas]);

  // Total específico do mês selecionado — mesmos números da barra
  // correspondente no gráfico, coerente com a lista de clientes abaixo.
  const resumoMes = mesFiltro !== "todos" ? timeline.data.find((d) => d.mes === mesFiltro) : null;

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
              importa é se cada parcela já foi paga. Clientes com venda ganha mas contrato ainda não
              assinado ficam fora da lista por padrão (sem base pra cobrar a unidade ainda) — use
              "Mostrar aguardando assinatura" pra ver esses casos.
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
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="recebido">CAC recebido</SelectItem>
              <SelectItem value="a_receber">CAC a receber</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mesFiltro} onValueChange={setMesFiltro}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {mesesDisponiveis.map((m) => (
                <SelectItem key={m} value={m} className="capitalize">
                  {formatMesLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={mostrarAguardandoAssinatura}
              onCheckedChange={(v) => setMostrarAguardandoAssinatura(!!v)}
            />
            Mostrar aguardando assinatura
          </label>
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

      {aguardandoAssinatura.length > 0 && !mostrarAguardandoAssinatura && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <span className="font-medium text-amber-800 dark:text-amber-300">
            {aguardandoAssinatura.length} cliente{aguardandoAssinatura.length > 1 ? "s" : ""}
          </span>{" "}
          com venda ganha mas contrato ainda não assinado (
          {brl(aguardandoAssinatura.reduce((s, it) => s + valorAReceber(it), 0))} em CAC não
          disponível pra cobrar ainda) — fora da lista abaixo.{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => setMostrarAguardandoAssinatura(true)}
          >
            Mostrar
          </button>
        </div>
      )}

      {resumoMes && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="font-medium capitalize">{formatMesLabel(mesFiltro)}</span>
          {" — "}
          Recebido:{" "}
          <span className="font-medium text-emerald-700 dark:text-emerald-300">
            {brl(resumoMes.recebido)}
          </span>
          {" · "}A receber:{" "}
          <span className="font-medium">{brl(resumoMes.projetado + resumoMes.estimado)}</span>
          {resumoMes.estimado > 0 && (
            <span className="text-muted-foreground">
              {" "}
              (sendo {brl(resumoMes.estimado)} estimado)
            </span>
          )}
          {" · "}
          {filtrados.filter((it) => !it.excluido_em).length} cliente(s)
        </div>
      )}

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
          Recebido é o mês em que a parcela foi paga. A receber é o mês do prazo já definido.
          Estimado (tracejado) é a 2ª parcela de quem ainda não pagou a unidade — sem prazo real
          ainda, projetada pela mediana histórica de dias até o 1º pagamento do cliente; ajustável
          por cliente na tabela abaixo.
        </p>
        {timeline.data.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Sem dados para exibir.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline.data}>
                <defs>
                  <pattern
                    id="cacEstimadoPattern"
                    patternUnits="userSpaceOnUse"
                    width="6"
                    height="6"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" fill="#f59e0b" fillOpacity={0.25} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth={2} />
                  </pattern>
                </defs>
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
                <Bar
                  dataKey="estimado"
                  name="Estimado"
                  stackId="cac"
                  fill="url(#cacEstimadoPattern)"
                  stroke="#f59e0b"
                  strokeWidth={1}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {timeline.semPrevisaoQtd > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            + {brl(timeline.semPrevisaoValor)} em {timeline.semPrevisaoQtd} parcela
            {timeline.semPrevisaoQtd > 1 ? "s" : ""} de 2ª parcela sem nenhuma base histórica pra
            estimar (unidade nova, sem cliente que já tenha pago ainda).
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
                  <th className="px-3 py-2 text-left">Venda ganha</th>
                  <th className="px-3 py-2 text-left">Assinatura do contrato</th>
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
                    className={cn(
                      "border-t align-top",
                      it.excluido_em && "opacity-60",
                      !it.excluido_em && !contratoAssinado(it) && "bg-amber-50/60 dark:bg-amber-950/10",
                    )}
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
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {it.contrato_assinado_em ? (
                        <span className="text-muted-foreground">{fmtData(it.contrato_assinado_em)}</span>
                      ) : it.contrato_id == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          Aguardando assinatura
                        </Badge>
                      )}
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
                          valorPago={it.valor_pago_parcela_1}
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
                          onMarcarPago={(data, valorPago) =>
                            updateItem.mutate({
                              id: it.id,
                              data_pagamento_parcela_1: data,
                              valor_pago_parcela_1: valorPago,
                            })
                          }
                          onDesmarcar={() =>
                            updateItem.mutate({
                              id: it.id,
                              data_pagamento_parcela_1: null,
                              valor_pago_parcela_1: null,
                            })
                          }
                          onEditarValor={(valorPago) =>
                            updateItem.mutate({ id: it.id, valor_pago_parcela_1: valorPago })
                          }
                          onEditarPrazo={(data) =>
                            updateItem.mutate({ id: it.id, prazo_parcela_1: data })
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
                          valorPago={it.valor_pago_parcela_2}
                          prazo={it.prazo_parcela_2}
                          status={it.status_parcela_2}
                          dataEnvio={it.data_envio_parcela_2}
                          dataPagamento={it.data_pagamento_parcela_2}
                          estimativa={estimarParcela2(it, medianas)}
                          onMarcarEnviado={(data) =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_2: data })
                          }
                          onDesmarcarEnviado={() =>
                            updateItem.mutate({ id: it.id, data_envio_parcela_2: null })
                          }
                          onMarcarPago={(data, valorPago) =>
                            updateItem.mutate({
                              id: it.id,
                              data_pagamento_parcela_2: data,
                              valor_pago_parcela_2: valorPago,
                            })
                          }
                          onDesmarcar={() =>
                            updateItem.mutate({
                              id: it.id,
                              data_pagamento_parcela_2: null,
                              valor_pago_parcela_2: null,
                            })
                          }
                          onEditarValor={(valorPago) =>
                            updateItem.mutate({ id: it.id, valor_pago_parcela_2: valorPago })
                          }
                          onEditarEstimativa={(data) =>
                            updateItem.mutate({ id: it.id, estimativa_parcela_2: data })
                          }
                          onEditarPrazo={(data) =>
                            updateItem.mutate({ id: it.id, prazo_parcela_2: data })
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
  valorPago,
  prazo,
  status,
  dataEnvio,
  dataPagamento,
  estimativa,
  onMarcarEnviado,
  onDesmarcarEnviado,
  onMarcarPago,
  onDesmarcar,
  onEditarValor,
  onEditarEstimativa,
  onEditarPrazo,
}: {
  valor: number;
  valorPago: number | null;
  prazo: string | null;
  status: string;
  dataEnvio: string | null;
  dataPagamento: string | null;
  estimativa?: { data: string | null; manual: boolean };
  onMarcarEnviado: (data: string) => void;
  onDesmarcarEnviado: () => void;
  onMarcarPago: (data: string, valorPago: number) => void;
  onDesmarcar: () => void;
  onEditarValor: (valorPago: number) => void;
  onEditarEstimativa?: (data: string | null) => void;
  onEditarPrazo?: (data: string) => void;
}) {
  const badge = PARCELA_BADGE[status] ?? { label: status, cls: "" };
  const valorExibido = valorPago ?? valor;
  const valorDivergente = valorPago != null && valorPago !== valor;
  const mostrarEstimativa = status === "aguardando_cliente" && estimativa;
  const mostrarPrazoEditavel = !dataPagamento && !dataEnvio && !!prazo;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1.5">
        <span className="font-medium">{brl(valorExibido)}</span>
        <Badge className={cn("text-[10px] px-1.5 py-0", badge.cls)}>{badge.label}</Badge>
        {dataPagamento && <EditarValorButton valorAtual={valorExibido} onSalvar={onEditarValor} />}
      </div>
      {valorDivergente && (
        <div className="text-right text-[10px] text-muted-foreground">Previsto: {brl(valor)}</div>
      )}
      <div className="flex items-center justify-end gap-1 text-right text-[10px] text-muted-foreground">
        <span>
          {dataPagamento
            ? `Pago em ${fmtData(dataPagamento)}`
            : dataEnvio
              ? `Boleto enviado em ${fmtData(dataEnvio)}`
              : prazo
                ? `Prazo: ${fmtData(prazo)}`
                : mostrarEstimativa && estimativa!.data
                  ? `${estimativa!.manual ? "Estimativa (manual)" : "Estimativa"}: ${fmtData(estimativa!.data)}`
                  : mostrarEstimativa
                    ? "Sem base pra estimar"
                    : "—"}
        </span>
        {mostrarPrazoEditavel && onEditarPrazo && (
          <EditarPrazoButton valorAtual={prazo!} onSalvar={onEditarPrazo} />
        )}
        {mostrarEstimativa && onEditarEstimativa && (
          <EditarEstimativaButton valorAtual={estimativa!.data} onSalvar={onEditarEstimativa} />
        )}
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
            <MarcarPagoButton valorPrevisto={valor} onConfirm={onMarcarPago} />
          </>
        )}
      </div>
    </div>
  );
}

function MarcarPagoButton({
  valorPrevisto,
  onConfirm,
}: {
  valorPrevisto: number;
  onConfirm: (data: string, valorPago: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [valor, setValor] = useState(() => String(valorPrevisto));
  const valorNumerico = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && !Number.isNaN(valorNumerico);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setValor(String(valorPrevisto));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-1.5 text-xs">
          Marcar como pago
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar parcela como paga</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Data do repasse</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Valor pago</Label>
            <Input
              type="number"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Previsto: {brl(valorPrevisto)}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valido}
            onClick={() => {
              onConfirm(data, valorNumerico);
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

function EditarValorButton({
  valorAtual,
  onSalvar,
}: {
  valorAtual: number;
  onSalvar: (valorPago: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [valor, setValor] = useState(() => String(valorAtual));
  const valorNumerico = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && !Number.isNaN(valorNumerico);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setValor(String(valorAtual));
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="Corrigir valor pago"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corrigir valor pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Valor pago</Label>
          <Input
            type="number"
            step="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valido}
            onClick={() => {
              onSalvar(valorNumerico);
              setOpen(false);
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarPrazoButton({
  valorAtual,
  onSalvar,
}: {
  valorAtual: string;
  onSalvar: (data: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => valorAtual);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setData(valorAtual);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="Corrigir prazo"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corrigir prazo da parcela</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Prazo</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} autoFocus />
          <p className="text-xs text-muted-foreground">
            O prazo padrão é calculado pela regra da unidade (dias após a assinatura, ou fim do
            mês). Ajuste aqui só se houve um acordo pontual diferente do padrão.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSalvar(data);
              setOpen(false);
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarEstimativaButton({
  valorAtual,
  onSalvar,
}: {
  valorAtual: string | null;
  onSalvar: (data: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => valorAtual ?? new Date().toISOString().slice(0, 10));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setData(valorAtual ?? new Date().toISOString().slice(0, 10));
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="Ajustar data estimada"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar data estimada da 2ª parcela</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Data provável do 1º pagamento do cliente</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Sem override, o valor é calculado pela mediana histórica de dias até o 1º pagamento do
            cliente na unidade. Ajuste se tiver uma previsão melhor pra este caso.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onSalvar(null);
              setOpen(false);
            }}
          >
            Usar estimativa automática
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSalvar(data);
              setOpen(false);
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
