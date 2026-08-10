import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Ban,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileDown,
  FileSpreadsheet,
  Info,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserX,
} from "lucide-react";
import { GruposFiliaisDialog } from "@/components/royalties/grupos-filiais-dialog";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { brl, date } from "@/components/audit/format";
import { usePermissions } from "@/hooks/use-permissions";
import {
  MOTIVOS_EXCLUSAO_ROYALTIES,
  type MotivoExclusaoRoyalties,
  MOTIVOS_CHURN,
  type MotivoChurn,
} from "@/lib/royalties.functions";
import {
  useAddItem,
  useAddOutraReceita,
  useApuracao,
  useAtualizarCnpjContrato,
  useDeleteItem,
  useDeleteOutraReceita,
  useExcluirItem,
  useFecharApuracao,
  useGerarItens,
  useGetOrCreate,
  useMarcarChurn,
  useReabrirApuracao,
  useReincluirItem,
  useUpdateApuracao,
  useUpdateItem,
  useUpdateOutraReceita,
} from "@/hooks/use-royalties";
import { useRegerarMatch } from "@/hooks/use-grupos-filiais";
import { cn } from "@/lib/utils";
import type { ApuracaoItem, OutraReceitaItem } from "@/lib/royalties.functions";
import {
  gerarDemonstrativoRoyaltiesPdf,
  gerarDemonstrativoRoyaltiesXlsx,
} from "@/lib/royalties-demonstrativo";

export const Route = createFileRoute("/_authenticated/royalties/$unidadeId/$mes")({
  component: ApuracaoPage,
});

function formatMesLabel(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isMesEmAndamento(mes: string): boolean {
  const d = new Date();
  const atual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return mes >= atual;
}

function formatCnpjCpf(v: string | null | undefined): string {
  if (!v) return "—";
  const d = v.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return v;
}

// Um item de royalties pode agregar mais de um título do Omie no mesmo mês
// (2ª fatura, ou filiais vinculadas ao mesmo contrato) — daí as duas colunas
// virem array em vez de data única.
function formatDatasPagamento(datas: string[] | null | undefined): string {
  if (!datas || datas.length === 0) return "—";
  return datas.map((d) => date(d)).join(", ");
}

function formatCompetencias(datas: string[] | null | undefined): string {
  if (!datas || datas.length === 0) return "—";
  return datas
    .map((d) => {
      const [y, m] = d.slice(0, 7).split("-");
      return `${m}/${y}`;
    })
    .join(", ");
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-slate-100 text-slate-800" },
  em_revisao: { label: "Em revisão", cls: "bg-amber-100 text-amber-800" },
  confirmado: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-800" },
  faturado: { label: "Faturado", cls: "bg-indigo-100 text-indigo-800" },
};

function ApuracaoPage() {
  const { unidadeId, mes } = Route.useParams();
  const navigate = useNavigate();
  const { isAdmin, loading } = usePermissions();
  const [apuracaoId, setApuracaoId] = useState<number | null>(null);
  const getOrCreate = useGetOrCreate();
  const gerar = useGerarItens();

  const unidadeIdNum = Number(unidadeId);
  const validUnidade = Number.isInteger(unidadeIdNum) && unidadeIdNum > 0;
  const validMes = /^\d{4}-\d{2}$/.test(mes);

  useEffect(() => {
    if (!isAdmin) return;
    if (!validUnidade || !validMes) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getOrCreate.mutateAsync({
          unidade_id: unidadeIdNum,
          mes,
        });
        if (cancelled) return;
        setApuracaoId(res.apuracao_id);
        await gerar.mutateAsync({ apuracao_id: res.apuracao_id });
      } catch (e: any) {
        if (!cancelled) toast.error(e.message ?? "Erro ao carregar apuração");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidadeIdNum, mes, isAdmin, validUnidade, validMes]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin)
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a admin.</div>;
  if (!validUnidade || !validMes)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        URL inválida. Volte para{" "}
        <Link to="/royalties" className="underline">
          Royalties
        </Link>
        .
      </div>
    );

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin)
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a admin.</div>;
  if (!apuracaoId)
    return <div className="p-6 text-sm text-muted-foreground">Preparando apuração…</div>;

  return (
    <ApuracaoLoaded
      apuracaoId={apuracaoId}
      mes={mes}
      unidadeId={unidadeId}
      onBack={() => navigate({ to: "/royalties" })}
    />
  );
}

function ApuracaoLoaded({
  apuracaoId,
  mes,
  unidadeId,
  onBack,
}: {
  apuracaoId: number;
  mes: string;
  unidadeId: string;
  onBack: () => void;
}) {
  const { data, isLoading } = useApuracao(apuracaoId);
  const updateItem = useUpdateItem(apuracaoId);
  const updateAp = useUpdateApuracao(apuracaoId);
  const fechar = useFecharApuracao(apuracaoId);
  const reabrir = useReabrirApuracao(apuracaoId);
  const addItem = useAddItem(apuracaoId);
  const deleteItem = useDeleteItem(apuracaoId);
  const gerar = useGerarItens();
  const regerar = useRegerarMatch();
  const marcarChurn = useMarcarChurn(apuracaoId);
  const atualizarCnpj = useAtualizarCnpjContrato(apuracaoId);
  const excluirItem = useExcluirItem(apuracaoId);
  const reincluirItem = useReincluirItem(apuracaoId);
  const addOutraReceita = useAddOutraReceita(apuracaoId);
  const updateOutraReceita = useUpdateOutraReceita(apuracaoId);
  const deleteOutraReceita = useDeleteOutraReceita(apuracaoId);

  const handleMarcarChurn = (it: ApuracaoItem, motivo: string, observacao: string, dataChurn: string) => {
    marcarChurn.mutate(
      { item_id: it.id, motivo, observacao, data_churn: dataChurn },
      {
        onSuccess: () => toast.success(`Churn registrado para ${it.razao_social}.`),
      },
    );
  };

  const handleExcluir = (it: ApuracaoItem, motivo: string) => {
    excluirItem.mutate(
      { item_id: it.id, motivo },
      {
        onSuccess: () => toast.success(`${it.razao_social} excluído da apuração deste mês.`),
      },
    );
  };

  const handleReincluir = (it: ApuracaoItem) => {
    reincluirItem.mutate(
      { item_id: it.id },
      {
        onSuccess: () => toast.success(`${it.razao_social} reincluído na apuração.`),
      },
    );
  };

  // Migra um cliente "só Omie" sem contrato entre os dois regimes de cobrança:
  // csc_base_antiga (entra só no CSC) ↔ royalties (sai do CSC, cobra % escolhido
  // — mesmo tratamento da base nova, incluindo o campo de % editável por item).
  const handleCobrarRoyalties = (it: ApuracaoItem) => {
    updateItem.mutate(
      { id: it.id, categoria: "royalties" },
      {
        onSuccess: () =>
          toast.success(`${it.razao_social} passou a cobrar royalties — ajuste o % na tabela acima.`),
      },
    );
  };

  const handleMoverBaseAntiga = (it: ApuracaoItem) => {
    updateItem.mutate(
      { id: it.id, categoria: "csc_base_antiga" },
      {
        onSuccess: () => toast.success(`${it.razao_social} voltou para a Base Antiga.`),
      },
    );
  };

  const forcarAtualizacao = async () => {
    try {
      // Remove primeiro os itens automáticos não confirmados (fonte pipedrive/omie);
      // sem isso o insert do gerarItensApuracao duplicaria os itens já existentes.
      await regerar.mutateAsync({ apuracao_id: apuracaoId });
      const res = await gerar.mutateAsync({ apuracao_id: apuracaoId, force: true });
      toast.success(`Apuração atualizada: ${res.created} item(ns) recalculado(s).`);
    } catch {
      // erro já tratado pelo onError padrão dos hooks
    }
  };

  const handleSalvarCnpj = async (it: ApuracaoItem, cnpj: string) => {
    if (!it.contrato_id) return;
    try {
      await atualizarCnpj.mutateAsync({ contrato_id: it.contrato_id, cnpj });
      // Mesmo fluxo do "Forçar atualização": regera o match com o CNPJ novo já salvo.
      await regerar.mutateAsync({ apuracao_id: apuracaoId });
      await gerar.mutateAsync({ apuracao_id: apuracaoId, force: true });
      toast.success(`CNPJ salvo para ${it.razao_social} — apuração atualizada.`);
    } catch {
      // erro já tratado pelo onError padrão dos hooks
    }
  };

  // optimistic local edits (debounced flush)
  const [localValor, setLocalValor] = useState<Record<number, string>>({});
  const [localMrr, setLocalMrr] = useState<Record<number, string>>({});
  const [localPct, setLocalPct] = useState<Record<number, string>>({});

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  const { apuracao, itens, outrasReceitasItens } = data;
  const u = apuracao.unidade;
  const readOnly = apuracao.status === "confirmado" || apuracao.status === "faturado";
  const isCscVariavel = u.csc_percentual_base_antiga != null;
  const pctPadrao = Number(u.royalties_percentual ?? 0);

  const ativos = itens.filter((i) => !i.excluido_em);
  const excluidos = itens.filter((i) => !!i.excluido_em);

  const planning = ativos.filter((i) => i.categoria === "royalties");
  const baseAntiga = ativos.filter((i) => i.categoria === "csc_base_antiga");

  const matched = planning.filter((i) => i.status_match === "matched");
  const soPipe = planning.filter((i) => i.status_match === "so_pipedrive");
  const soOmie = planning.filter((i) => i.status_match === "so_omie");
  const manual = planning.filter((i) => i.status_match === "manual");
  // Única tabela de conciliação (matched + só pipedrive + só omie) — a divisão em
  // situação vira uma coluna/filtro em vez de 3 cards com cabeçalho próprio, o que
  // permite manter um único <thead> fixo ao rolar a lista inteira. Em unidades com
  // CSC variável, "só Omie" normalmente nasce com categoria csc_base_antiga (por
  // isso já cai fora daqui via `planning`), mas um item migrado manualmente pra
  // "cobrar royalties" precisa continuar aparecendo aqui.
  const conciliacao = [...matched, ...soPipe, ...soOmie];

  const valorEfetivo = (it: ApuracaoItem): number => {
    const raw = localValor[it.id];
    if (raw !== undefined) {
      const n = Number(raw.replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    }
    return Number(it.valor_confirmado ?? 0);
  };

  const pctEfetivo = (it: ApuracaoItem): number => {
    const raw = localPct[it.id];
    if (raw !== undefined) {
      if (raw.trim() === "") return pctPadrao;
      const n = Number(raw.replace(",", "."));
      return Number.isFinite(n) ? n : pctPadrao;
    }
    return it.royalties_percentual_override != null
      ? Number(it.royalties_percentual_override)
      : pctPadrao;
  };

  // totals (live)
  let receitaBase = 0;
  let royaltiesValor = 0;
  let cacValor = 0;
  let receitaBaseAntiga = 0;
  let confirmadosCount = 0;
  for (const it of ativos) {
    if (!it.confirmado) continue;
    confirmadosCount += 1;
    const v = valorEfetivo(it);
    if (it.categoria === "royalties") {
      receitaBase += v;
      const computado = (v * pctEfetivo(it)) / 100;
      if (it.is_cac) cacValor += computado;
      else royaltiesValor += computado;
    } else if (it.categoria === "csc_base_antiga") {
      receitaBaseAntiga += v;
    }
  }
  const cscPctBaseAntiga = Number(u.csc_percentual_base_antiga ?? 0);
  const cscBaseAntigaValor = (receitaBaseAntiga * cscPctBaseAntiga) / 100;
  const cscFixo = u.csc_valor_fixo != null ? Number(u.csc_valor_fixo) : null;
  const cscEfetivo = cscFixo ?? (isCscVariavel ? cscBaseAntigaValor : 0);
  const outras = Number(apuracao.outras_receitas ?? 0);
  const trafegoPago = Number(apuracao.csc_trafego_pago ?? 0);
  const totalFatura = cscEfetivo + royaltiesValor + cacValor + outras + trafegoPago;
  const badge = STATUS_BADGE[apuracao.status] ?? { label: apuracao.status, cls: "" };

  const flushValor = (it: ApuracaoItem) => {
    const raw = localValor[it.id];
    if (raw === undefined) return;
    const n = raw === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && !Number.isFinite(n)) return;
    if (n === Number(it.valor_confirmado ?? 0)) return;
    updateItem.mutate({ id: it.id, valor_confirmado: n });
  };

  const flushMrr = (it: ApuracaoItem) => {
    const raw = localMrr[it.id];
    if (raw === undefined) return;
    const n = raw === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && !Number.isFinite(n)) return;
    if (n === Number(it.mrr_override ?? 0)) return;
    updateItem.mutate({ id: it.id, mrr_override: n });
  };

  const flushPct = (it: ApuracaoItem) => {
    const raw = localPct[it.id];
    if (raw === undefined) return;
    const n = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && !Number.isFinite(n)) return;
    const atual =
      it.royalties_percentual_override != null ? Number(it.royalties_percentual_override) : null;
    if (n === atual) return;
    updateItem.mutate({ id: it.id, royalties_percentual_override: n });
  };

  const toggleConfirm = (it: ApuracaoItem, checked: boolean) => {
    updateItem.mutate({ id: it.id, confirmado: checked });
  };

  const toggleCac = (it: ApuracaoItem, checked: boolean) => {
    updateItem.mutate({ id: it.id, is_cac: checked });
  };

  const toggleVendaSocios = (it: ApuracaoItem, checked: boolean) => {
    updateItem.mutate({ id: it.id, venda_socios: checked });
  };

  const buildDemonstrativoData = () => {
    const confirmados = ativos.filter((i) => i.confirmado);
    const itens = confirmados.map((i) => {
      const valor = Number(i.valor_confirmado ?? 0);
      const pct =
        i.categoria === "csc_base_antiga"
          ? cscPctBaseAntiga
          : i.royalties_percentual_override != null
            ? Number(i.royalties_percentual_override)
            : pctPadrao;
      return {
        razao_social: i.razao_social,
        cnpj: i.cnpj,
        data_ganho: i.data_ganho,
        valor_confirmado: valor,
        royalties_percentual: pct,
        royalties_item: (valor * pct) / 100,
        is_cac: i.is_cac,
        categoria: i.categoria as "royalties" | "csc_base_antiga",
      };
    });
    return {
      unidadeNome: u.nome_da_praca,
      mes,
      confirmadoEm: apuracao.confirmado_em,
      confirmadoPor: apuracao.confirmado_por,
      receitaBase,
      royaltiesPct: pctPadrao,
      royaltiesValor,
      cacValor,
      cscLabel: cscFixo != null ? "CSC fixo" : `CSC variável (${cscPctBaseAntiga}%)`,
      cscValor: cscEfetivo,
      trafegoPago: apuracao.csc_trafego_pago,
      outrasReceitas: outras,
      outrasReceitasItens: outrasReceitasItens.map((it) => ({ nome: it.nome, valor: Number(it.valor) })),
      totalFatura,
      itens,
    };
  };

  const handleGerarDemonstrativoPdf = async () => {
    await gerarDemonstrativoRoyaltiesPdf(buildDemonstrativoData());
  };

  const handleGerarDemonstrativoXlsx = () => {
    gerarDemonstrativoRoyaltiesXlsx(buildDemonstrativoData());
  };

  return (
    <div className="flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-[57px] z-10 border-b bg-card/95 backdrop-blur px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Royalties
            </Button>
            <div className="flex items-center gap-1">
              <Link to="/royalties/$unidadeId/$mes" params={{ unidadeId, mes: shiftMes(mes, -1) }}>
                <Button variant="outline" size="icon" className="h-7 w-7" title="Mês anterior">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <Link to="/royalties/$unidadeId/$mes" params={{ unidadeId, mes: shiftMes(mes, 1) }}>
                <Button variant="outline" size="icon" className="h-7 w-7" title="Próximo mês">
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            <div>
              <div className="text-base font-semibold flex items-center gap-2">
                {u.nome_da_praca} — <span className="capitalize">{formatMesLabel(mes)}</span>
                <Badge className={badge.cls}>{badge.label}</Badge>
                {!readOnly && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5"
                          disabled={regerar.isPending || gerar.isPending}
                          onClick={forcarAtualizacao}
                        >
                          <RefreshCw
                            className={cn(
                              "h-3.5 w-3.5",
                              (regerar.isPending || gerar.isPending) && "animate-spin",
                            )}
                          />
                          Forçar atualização
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Reprocessa contratos e recebimentos do Omie do zero, mantendo itens já
                        confirmados ou adicionados manualmente. Use quando um pagamento/contrato
                        recente não aparecer na lista.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {u.observacoes_financeiras && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">
                        <div className="text-xs whitespace-pre-wrap">
                          {u.observacoes_financeiras}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <Metric label="Confirmados" value={`${confirmadosCount} / ${ativos.length}`} />
            <Metric label="Base Planning" value={brl(receitaBase)} />
            <Metric label={`Royalties (${pctPadrao}%)`} value={brl(royaltiesValor)} />
            <Metric
              label="CSC"
              value={brl(cscFixo ?? cscBaseAntigaValor)}
              sub={cscFixo != null ? "fixo" : `${cscPctBaseAntiga}% base antiga`}
            />
            {cacValor > 0 && <Metric label="CAC" value={brl(cacValor)} />}
            <Metric label="Total fatura" value={brl(totalFatura)} highlight />
          </div>
        </div>
      </div>

      {isMesEmAndamento(mes) && (
        <div className="mx-6 mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Mês em andamento ou futuro — os valores aqui são projeção (gerada automaticamente a partir dos contratos
          ativos), não apuração real. A apuração só fecha depois que o mês termina.
        </div>
      )}

      {!u.tem_omie && (
        <div className="mx-6 mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Esta unidade ainda não está integrada ao Omie. Preencha os valores recebidos manualmente.
        </div>
      )}

      {readOnly && (
        <div className="mx-6 mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          Apuração de {formatMesLabel(mes)} confirmada em{" "}
          {apuracao.confirmado_em ? new Date(apuracao.confirmado_em).toLocaleString("pt-BR") : "—"}
          {apuracao.confirmado_por ? ` por ${apuracao.confirmado_por}` : ""}.
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
        {/* Coluna esquerda: seções */}
        <div className="space-y-6 min-w-0">
          <SecaoGrupo
            title="📊 Conciliação Pipedrive × Omie"
            description="Contratos ativos cruzados com recebimentos do Omie — filtre por situação abaixo."
            itens={conciliacao}
            showSituacao
            readOnly={readOnly}
            showMrr
            showRoyalties
            pctPadrao={pctPadrao}
            apuracaoId={apuracaoId}
            unidadeNome={u.nome_da_praca}
            temOmie={u.tem_omie}
            localValor={localValor}
            setLocalValor={setLocalValor}
            flushValor={flushValor}
            localMrr={localMrr}
            setLocalMrr={setLocalMrr}
            flushMrr={flushMrr}
            localPct={localPct}
            setLocalPct={setLocalPct}
            flushPct={flushPct}
            toggleConfirm={toggleConfirm}
            toggleCac={toggleCac}
            onDelete={(it) => deleteItem.mutate({ id: it.id })}
            onMarcarChurn={handleMarcarChurn}
            churnPending={marcarChurn.isPending}
            onEditarCnpj={handleSalvarCnpj}
            editarCnpjPending={atualizarCnpj.isPending || regerar.isPending || gerar.isPending}
            onExcluir={handleExcluir}
            excluirPending={excluirItem.isPending}
            onMoverBaseAntiga={isCscVariavel ? handleMoverBaseAntiga : undefined}
          />
          <SecaoGrupo
            title="➕ Adicionados manualmente"
            description="Itens criados pelo usuário."
            itens={manual}
            readOnly={readOnly}
            showMrr={false}
            showRoyalties
            pctPadrao={pctPadrao}
            apuracaoId={apuracaoId}
            unidadeNome={u.nome_da_praca}
            temOmie={u.tem_omie}
            localValor={localValor}
            setLocalValor={setLocalValor}
            flushValor={flushValor}
            localPct={localPct}
            setLocalPct={setLocalPct}
            flushPct={flushPct}
            toggleConfirm={toggleConfirm}
            toggleCac={toggleCac}
            toggleVendaSocios={toggleVendaSocios}
            onDelete={(it) => deleteItem.mutate({ id: it.id })}
            extraHeader={
              !readOnly && (
                <AddItemDialog
                  onAdd={(payload) => addItem.mutate({ apuracao_id: apuracaoId, ...payload })}
                />
              )
            }
          />

          {isCscVariavel && (
            <Card>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <div className="font-medium">
                    Base Antiga —{" "}
                    {cscFixo != null ? "CSC Fixo" : `CSC Variável (${cscPctBaseAntiga}%)`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Clientes pré-Planning. Recebimentos não entram em royalties — a menos que
                    "Cobrar royalties" seja marcado, movendo o cliente pra Conciliação com %
                    escolhido.
                  </div>
                </div>
                {!readOnly && (
                  <AddItemDialog
                    onAdd={(payload) =>
                      addItem.mutate({
                        apuracao_id: apuracaoId,
                        categoria: "csc_base_antiga",
                        ...payload,
                      })
                    }
                  />
                )}
              </div>
              <BaseAntigaTable
                itens={baseAntiga}
                readOnly={readOnly}
                apuracaoId={apuracaoId}
                unidadeNome={u.nome_da_praca}
                temOmie={u.tem_omie}
                localValor={localValor}
                setLocalValor={setLocalValor}
                flushValor={flushValor}
                toggleConfirm={toggleConfirm}
                onDelete={(it) => deleteItem.mutate({ id: it.id })}
                onExcluir={handleExcluir}
                excluirPending={excluirItem.isPending}
                onCobrarRoyalties={handleCobrarRoyalties}
              />
            </Card>
          )}

          <ExcluidosSection
            itens={excluidos}
            readOnly={readOnly}
            onReincluir={handleReincluir}
            pending={reincluirItem.isPending}
          />
        </div>

        {/* Sidebar de totais */}
        <Card className="p-4 space-y-4 h-fit sticky top-[140px]">
          <div className="text-sm font-semibold">Resumo da apuração</div>
          <ResumoLinha
            label="Clientes confirmados"
            value={`${confirmadosCount} / ${ativos.length}`}
          />
          <ResumoLinha label="Base Planning" value={brl(receitaBase)} />
          <ResumoLinha label={`Royalties (${pctPadrao}%)`} value={brl(royaltiesValor)} bold />
          {cacValor > 0 && <ResumoLinha label="CAC (itens marcados)" value={brl(cacValor)} bold />}
          <div className="border-t pt-3 space-y-2">
            {cscFixo != null ? (
              <ResumoLinha label="CSC fixo" value={brl(cscFixo)} bold />
            ) : (
              <>
                <ResumoLinha label="Base Antiga" value={brl(receitaBaseAntiga)} />
                <ResumoLinha
                  label={`CSC variável (${cscPctBaseAntiga}%)`}
                  value={brl(cscBaseAntigaValor)}
                  bold
                />
              </>
            )}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs">
              <Label className="text-xs text-muted-foreground">Tráfego pago</Label>
              <Input
                type="number"
                step="0.01"
                disabled={readOnly}
                defaultValue={apuracao.csc_trafego_pago ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== Number(apuracao.csc_trafego_pago ?? 0)) {
                    updateAp.mutate({ id: apuracaoId, csc_trafego_pago: v });
                  }
                }}
              />
            </div>
            <OutrasReceitasSection
              itens={outrasReceitasItens}
              total={outras}
              readOnly={readOnly}
              onAdd={(nome, valor) => addOutraReceita.mutate({ apuracao_id: apuracaoId, nome, valor })}
              onUpdateValor={(id, valor) => updateOutraReceita.mutate({ id, valor })}
              onDelete={(id) => deleteOutraReceita.mutate({ id })}
            />
          </div>
          <div className="border-t pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Total fatura</span>
              <span className="text-lg font-bold">{brl(totalFatura)}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              CSC + Royalties + CAC + Outras + Tráfego pago
            </div>
          </div>

          {!readOnly ? (
            <div className="space-y-2">
              <Button
                className="w-full"
                disabled={confirmadosCount === 0 || fechar.isPending}
                onClick={() => {
                  if (confirm("Fechar apuração? Após isso, edições ficam bloqueadas.")) {
                    fechar.mutate(undefined, {
                      onSuccess: () => toast.success("Apuração confirmada"),
                      onError: (e: any) => toast.error(e.message),
                    });
                  }
                }}
              >
                Fechar apuração
              </Button>
              <div className="text-[10px] text-center text-muted-foreground">
                Salvamento automático — não há rascunho manual.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleGerarDemonstrativoPdf}
              >
                <FileDown className="h-4 w-4" />
                Gerar demonstrativo (PDF)
              </Button>
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleGerarDemonstrativoXlsx}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Gerar demonstrativo (Excel)
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={reabrir.isPending}
                onClick={() => {
                  if (confirm("Reabrir apuração?")) {
                    reabrir.mutate(undefined, {
                      onSuccess: () => toast.success("Apuração reaberta"),
                      onError: (e: any) => toast.error(e.message),
                    });
                  }
                }}
              >
                Reabrir apuração
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={highlight ? "text-base font-bold" : "text-sm font-semibold"}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ResumoLinha({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}

// Cada unidade paga um conjunto diferente de softwares/serviços (Qulture.rocks,
// Pipedrive, Panda Pé, etc.) — em vez de um valor único digitado à mão, é uma
// lista itemizada; o backend soma os itens em outras_receitas automaticamente.
function OutrasReceitasSection({
  itens,
  total,
  readOnly,
  onAdd,
  onUpdateValor,
  onDelete,
}: {
  itens: OutraReceitaItem[];
  total: number;
  readOnly: boolean;
  onAdd: (nome: string, valor: number) => void;
  onUpdateValor: (id: number, valor: number) => void;
  onDelete: (id: number) => void;
}) {
  const [novoNome, setNovoNome] = useState("");
  const [novoValor, setNovoValor] = useState("");

  const handleAdd = () => {
    const nome = novoNome.trim();
    const valor = Number(novoValor.replace(",", "."));
    if (!nome || !Number.isFinite(valor)) return;
    onAdd(nome, valor);
    setNovoNome("");
    setNovoValor("");
  };

  return (
    <div className="text-xs space-y-1.5">
      <Label className="text-xs text-muted-foreground">Outras receitas</Label>
      {itens.length === 0 && (
        <div className="text-[11px] text-muted-foreground italic">
          Nenhum item — adicione abaixo.
        </div>
      )}
      {itens.map((it) => (
        <div key={it.id} className="flex items-center gap-1.5">
          <span className="flex-1 truncate" title={it.nome}>
            {it.nome}
          </span>
          <Input
            type="number"
            step="0.01"
            disabled={readOnly}
            defaultValue={it.valor}
            className="h-7 w-24 text-xs"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== Number(it.valor)) onUpdateValor(it.id, v);
            }}
          />
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => onDelete(it.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            placeholder="Software/serviço"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            className="h-7 flex-1 text-xs"
          />
          <Input
            type="number"
            step="0.01"
            placeholder="Valor"
            value={novoValor}
            onChange={(e) => setNovoValor(e.target.value)}
            className="h-7 w-24 text-xs"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={!novoNome.trim() || novoValor.trim() === ""}
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="flex items-baseline justify-between pt-1 border-t">
        <span className="text-muted-foreground">Total</span>
        <span className="font-semibold">{brl(total)}</span>
      </div>
    </div>
  );
}

interface GrupoProps {
  title: string;
  description: string;
  itens: ApuracaoItem[];
  showSituacao?: boolean;
  readOnly: boolean;
  showMrr: boolean;
  showRoyalties: boolean;
  pctPadrao: number;
  apuracaoId: number;
  unidadeNome: string;
  temOmie: boolean;
  localValor: Record<number, string>;
  setLocalValor: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  flushValor: (it: ApuracaoItem) => void;
  localMrr?: Record<number, string>;
  setLocalMrr?: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  flushMrr?: (it: ApuracaoItem) => void;
  localPct: Record<number, string>;
  setLocalPct: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  flushPct: (it: ApuracaoItem) => void;
  toggleConfirm: (it: ApuracaoItem, c: boolean) => void;
  toggleCac?: (it: ApuracaoItem, c: boolean) => void;
  toggleVendaSocios?: (it: ApuracaoItem, c: boolean) => void;
  onDelete: (it: ApuracaoItem) => void;
  extraHeader?: React.ReactNode;
  onMarcarChurn?: (it: ApuracaoItem, motivo: string, observacao: string, dataChurn: string) => void;
  churnPending?: boolean;
  onEditarCnpj?: (it: ApuracaoItem, cnpj: string) => void;
  editarCnpjPending?: boolean;
  onExcluir?: (it: ApuracaoItem, motivo: string) => void;
  excluirPending?: boolean;
  onMoverBaseAntiga?: (it: ApuracaoItem) => void;
}

function MarcarChurnButton({
  it,
  onConfirm,
  pending,
}: {
  it: ApuracaoItem;
  onConfirm: (motivo: string, observacao: string, dataChurn: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState<MotivoChurn | "">("");
  const [observacao, setObservacao] = useState("");
  const [dataChurn, setDataChurn] = useState(() => new Date().toISOString().slice(0, 10));

  const submit = () => {
    if (!motivo) {
      toast.error("Selecione o motivo do churn.");
      return;
    }
    onConfirm(motivo, observacao.trim(), dataChurn);
    setOpen(false);
    setMotivo("");
    setObservacao("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400"
          title="Marcar churn"
        >
          <UserX className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar churn — {it.razao_social}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Data do churn</Label>
            <Input type="date" value={dataChurn} onChange={(e) => setDataChurn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoChurn)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_CHURN.map((opcao) => (
                  <SelectItem key={opcao} value={opcao}>
                    {opcao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Observação</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Detalhes adicionais (opcional)"
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Isso cria um card no pipe Tratativas do Pipefy já na fase "Perdido". Não é possível
            desfazer por aqui.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Confirmar churn"}
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
  it: ApuracaoItem;
  onConfirm: (motivo: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState<MotivoExclusaoRoyalties | "">("");

  const submit = () => {
    if (!motivo) {
      toast.error("Selecione o motivo da exclusão.");
      return;
    }
    onConfirm(motivo);
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
          title="Excluir da apuração deste mês"
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
            <RadioGroup
              value={motivo}
              onValueChange={(v) => setMotivo(v as MotivoExclusaoRoyalties)}
              className="space-y-2 pt-1"
            >
              {MOTIVOS_EXCLUSAO_ROYALTIES.map((opcao) => (
                <label key={opcao} className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value={opcao} />
                  <span className="text-sm">{opcao}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <p className="text-xs text-muted-foreground">
            Remove este cliente só da apuração deste mês — não afeta meses anteriores/futuros nem os
            dados de origem (Pipedrive/Omie). Pode ser desfeito em "Excluídos deste mês".
          </p>
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
            {pending ? "Excluindo…" : "Excluir deste mês"}
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
  it: ApuracaoItem;
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
          title="Adicionar CNPJ"
        >
          <Pencil className="h-3 w-3" /> —
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar CNPJ — {it.razao_social}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>CNPJ</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ao salvar, a apuração é recalculada automaticamente — se o Omie já tiver um recebimento
            com esse CNPJ, o item sai de "Só no Pipedrive" e vira "Matched" na hora.
          </p>
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

function FiliaisCell({
  it,
  apuracaoId,
  unidadeNome,
  temOmie,
  readOnly,
}: {
  it: ApuracaoItem;
  apuracaoId: number;
  unidadeNome: string;
  temOmie: boolean;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Não exibir em itens manuais, sem contrato, sem omie na unidade, ou em apuração fechada
  if (!temOmie || readOnly || it.fonte === "manual" || it.contrato_id == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const count = it.filiais_count ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs"
        title={count > 0 ? `${count} filial(is) vinculada(s)` : "Vincular filiais Omie"}
      >
        {count > 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200">
            <Link2 className="h-3 w-3" />
            {count} filial{count > 1 ? "is" : ""}
          </span>
        ) : (
          <Link2 className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        )}
      </button>
      {open && (
        <GruposFiliaisDialog
          open={open}
          onOpenChange={setOpen}
          apuracaoId={apuracaoId}
          contratoId={it.contrato_id}
          razaoSocial={it.razao_social}
          cnpjPrincipal={it.cnpj}
          unidade={unidadeNome}
        />
      )}
    </>
  );
}

type SortDir = "asc" | "desc";

function useSort<T extends string>() {
  const [key, setKey] = useState<T | null>(null);
  const [dir, setDir] = useState<SortDir>("asc");
  const onSort = (k: T) => {
    if (key === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };
  return { key, dir, onSort };
}

function SortableTh<T extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: T;
  activeKey: T | null;
  dir: SortDir;
  onSort: (key: T) => void;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-3 py-2 hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

type ItemSortKey =
  | "cliente"
  | "situacao"
  | "cnpj"
  | "data_ganho"
  | "mrr"
  | "omie"
  | "confirmado"
  | "pct"
  | "royalties";

const SITUACAO_INFO: Record<string, { label: string; cls: string }> = {
  matched: {
    label: "✅ Matched",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  so_pipedrive: {
    label: "⚠️ Só Pipedrive",
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
  },
  so_omie: {
    label: "🔍 Só Omie",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  },
};

const SITUACAO_FILTROS = [
  { value: "todos", label: "Todos" },
  { value: "matched", label: "✅ Matched" },
  { value: "so_pipedrive", label: "⚠️ Só Pipedrive" },
  { value: "so_omie", label: "🔍 Só Omie" },
] as const;

function SituacaoBadge({ status }: { status: string | null | undefined }) {
  const info = status ? SITUACAO_INFO[status] : undefined;
  if (!info) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium", info.cls)}
    >
      {info.label}
    </span>
  );
}

function SecaoGrupo({
  title,
  description,
  itens,
  showSituacao,
  readOnly,
  showMrr,
  pctPadrao,
  apuracaoId,
  unidadeNome,
  temOmie,
  localValor,
  setLocalValor,
  flushValor,
  localMrr,
  setLocalMrr,
  flushMrr,
  localPct,
  setLocalPct,
  flushPct,
  toggleConfirm,
  toggleCac,
  toggleVendaSocios,
  onDelete,
  extraHeader,
  onMarcarChurn,
  churnPending,
  onEditarCnpj,
  editarCnpjPending,
  onExcluir,
  excluirPending,
  onMoverBaseAntiga,
}: GrupoProps) {
  const [open, setOpen] = useState(true);
  const [situacaoFiltro, setSituacaoFiltro] = useState<string>("todos");
  const [checkFiltro, setCheckFiltro] = useState<"todos" | "pendentes" | "confirmados">("todos");
  const { key: sortKey, dir: sortDir, onSort } = useSort<ItemSortKey>();

  const situacaoCounts = useMemo(() => {
    const counts: Record<string, number> = { todos: itens.length };
    for (const it of itens) {
      const k = it.status_match ?? "—";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [itens]);

  // Filtro de situação (Matched/Só Pipedrive/Só Omie) combina com o toggle de
  // pendentes — permite isolar, por exemplo, "Só Omie" que ainda não teve check.
  const itensPorSituacao = useMemo(() => {
    if (!showSituacao || situacaoFiltro === "todos") return itens;
    return itens.filter((it) => it.status_match === situacaoFiltro);
  }, [itens, showSituacao, situacaoFiltro]);

  const pendentesCount = useMemo(
    () => itensPorSituacao.filter((it) => !it.confirmado).length,
    [itensPorSituacao],
  );

  const confirmadosCount = useMemo(
    () => itensPorSituacao.filter((it) => it.confirmado).length,
    [itensPorSituacao],
  );

  const itensFiltrados = useMemo(() => {
    if (checkFiltro === "pendentes") return itensPorSituacao.filter((it) => !it.confirmado);
    if (checkFiltro === "confirmados") return itensPorSituacao.filter((it) => it.confirmado);
    return itensPorSituacao;
  }, [itensPorSituacao, checkFiltro]);

  const sortedItens = useMemo(() => {
    const itens = itensFiltrados;
    if (!sortKey) return itens;
    const dirMult = sortDir === "asc" ? 1 : -1;
    const getValorConfirmado = (it: ApuracaoItem) => {
      const localV = localValor[it.id];
      return localV !== undefined
        ? Number((localV || "0").replace(",", "."))
        : Number(it.valor_confirmado ?? 0);
    };
    const getPct = (it: ApuracaoItem) => {
      const localP = localPct[it.id];
      return localP !== undefined
        ? localP.trim() === ""
          ? pctPadrao
          : Number(localP.replace(",", ".")) || 0
        : it.royalties_percentual_override != null
          ? Number(it.royalties_percentual_override)
          : pctPadrao;
    };
    const withKey = itens.map((it) => {
      let v: string | number;
      switch (sortKey) {
        case "cliente":
          v = (it.razao_social ?? "").toLowerCase();
          break;
        case "situacao":
          v = it.status_match ?? "";
          break;
        case "cnpj":
          v = it.cnpj ?? "";
          break;
        case "data_ganho":
          v = it.data_ganho ?? "";
          break;
        case "mrr":
          v = Number(localMrr?.[it.id] ?? it.mrr_override ?? it.mrr_contratado ?? 0);
          break;
        case "omie":
          v = Number(it.valor_omie ?? 0);
          break;
        case "confirmado":
          v = getValorConfirmado(it);
          break;
        case "pct":
          v = getPct(it);
          break;
        case "royalties":
          v = (getValorConfirmado(it) * getPct(it)) / 100;
          break;
      }
      return { it, v };
    });
    withKey.sort((a, b) => {
      if (a.v < b.v) return -1 * dirMult;
      if (a.v > b.v) return 1 * dirMult;
      return 0;
    });
    return withKey.map((x) => x.it);
  }, [itensFiltrados, sortKey, sortDir, localValor, localPct, localMrr, pctPadrao]);

  if (itens.length === 0 && !extraHeader) return null;
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <CollapsibleTrigger className="flex-1 text-left">
            <div className="font-medium">
              {title} <span className="text-xs text-muted-foreground">({itens.length})</span>
            </div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </CollapsibleTrigger>
          {extraHeader}
        </div>
        {showSituacao && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
            {SITUACAO_FILTROS.map((f) => {
              const count = situacaoCounts[f.value] ?? 0;
              if (f.value !== "todos" && count === 0) return null;
              const active = situacaoFiltro === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setSituacaoFiltro(f.value)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-muted/70",
                  )}
                >
                  {f.label} ({count})
                </button>
              );
            })}
            {(pendentesCount > 0 || confirmadosCount > 0) && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                {pendentesCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCheckFiltro((v) => (v === "pendentes" ? "todos" : "pendentes"))
                    }
                    title="Combina com o filtro de situação acima — ex.: Só Omie + Pendentes"
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs transition-colors",
                      checkFiltro === "pendentes"
                        ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    ☐ Pendentes ({pendentesCount})
                  </button>
                )}
                {confirmadosCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCheckFiltro((v) => (v === "confirmados" ? "todos" : "confirmados"))
                    }
                    title="Combina com o filtro de situação acima — ex.: Só Omie + Confirmados"
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs transition-colors",
                      checkFiltro === "confirmados"
                        ? "bg-emerald-600 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    ☑ Confirmados ({confirmadosCount})
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <CollapsibleContent>
          {itens.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item.</div>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[6] bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <SortableTh
                      label="Cliente"
                      sortKey="cliente"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      className="sticky left-0 z-10 bg-muted"
                    />
                    <th className="px-3 py-2 text-center">Filiais</th>
                    {showSituacao && (
                      <SortableTh
                        label="Situação"
                        sortKey="situacao"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={onSort}
                      />
                    )}
                    <SortableTh
                      label="CNPJ"
                      sortKey="cnpj"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    <SortableTh
                      label="Ganho e Cadastro no Omie"
                      sortKey="data_ganho"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    {showMrr && (
                      <SortableTh
                        label="MRR"
                        sortKey="mrr"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                    )}
                    <SortableTh
                      label="Omie"
                      sortKey="omie"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      align="right"
                    />
                    <th
                      className="px-3 py-2 text-left"
                      title="Mês em que o título entrou no Omie como recebido — a apuração filtra por essa data, não pela competência"
                    >
                      Pagamento
                    </th>
                    <th
                      className="px-3 py-2 text-left"
                      title="Competência do(s) título(s) do Omie que geraram o valor ao lado — pode divergir do mês de pagamento em faturas atrasadas"
                    >
                      Competência
                    </th>
                    <SortableTh
                      label="Confirmado"
                      sortKey="confirmado"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTh
                      label="%"
                      sortKey="pct"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      align="right"
                    />
                    {toggleCac && <th className="px-3 py-2 text-center">CAC?</th>}
                    {toggleVendaSocios && (
                      <th className="px-3 py-2 text-center">Venda Sócio?</th>
                    )}
                    <SortableTh
                      label="Royalties"
                      sortKey="royalties"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      align="right"
                    />
                    <th className="px-3 py-2 text-center">✓</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItens.map((it) => {
                    const localV = localValor[it.id];
                    const valor =
                      localV !== undefined
                        ? Number((localV || "0").replace(",", "."))
                        : Number(it.valor_confirmado ?? 0);
                    const localP = localPct[it.id];
                    const pct =
                      localP !== undefined
                        ? localP.trim() === ""
                          ? pctPadrao
                          : Number(localP.replace(",", ".")) || 0
                        : it.royalties_percentual_override != null
                          ? Number(it.royalties_percentual_override)
                          : pctPadrao;
                    const royal = (valor * pct) / 100;
                    return (
                      <tr key={it.id} className="border-t">
                        <td className="sticky left-0 z-10 bg-card px-3 py-2">
                          {it.razao_social}
                          {it.churn_pipefy_card_id && (
                            <Badge className="ml-2 bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 text-[10px] px-1.5 py-0 align-middle">
                              churn
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <FiliaisCell
                            it={it}
                            apuracaoId={apuracaoId}
                            unidadeNome={unidadeNome}
                            temOmie={temOmie}
                            readOnly={readOnly}
                          />
                        </td>
                        {showSituacao && (
                          <td className="px-3 py-2">
                            <SituacaoBadge status={it.status_match} />
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {it.cnpj ? (
                            formatCnpjCpf(it.cnpj)
                          ) : !readOnly && it.contrato_id != null && onEditarCnpj ? (
                            <EditarCnpjButton
                              it={it}
                              pending={!!editarCnpjPending}
                              onSave={(cnpj) => onEditarCnpj(it, cnpj)}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {it.data_ganho
                            ? new Date(`${it.data_ganho}T00:00:00`).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        {showMrr && (
                          <td className="px-3 py-2 text-right">
                            {it.contrato_id == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Input
                                type="text"
                                inputMode="decimal"
                                disabled={readOnly}
                                title={
                                  it.mrr_override != null && it.mrr_contratado != null
                                    ? `Original do contrato: ${brl(it.mrr_contratado)}`
                                    : undefined
                                }
                                value={
                                  localMrr?.[it.id] ?? it.mrr_override ?? it.mrr_contratado ?? ""
                                }
                                onChange={(e) =>
                                  setLocalMrr?.((s) => ({ ...s, [it.id]: e.target.value }))
                                }
                                onBlur={() => flushMrr?.(it)}
                                className="h-8 w-28 text-right"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right">
                          {it.valor_omie != null ? brl(it.valor_omie) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDatasPagamento(it.data_pagamento_omie)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatCompetencias(it.data_competencia_omie)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            disabled={readOnly}
                            value={localV ?? it.valor_confirmado ?? ""}
                            onChange={(e) =>
                              setLocalValor((s) => ({ ...s, [it.id]: e.target.value }))
                            }
                            onBlur={() => flushValor(it)}
                            className="h-8 w-28 text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            disabled={readOnly}
                            placeholder={String(pctPadrao)}
                            title={
                              it.royalties_percentual_override != null
                                ? `Override — padrão da unidade é ${pctPadrao}%`
                                : `Usando padrão da unidade (${pctPadrao}%)`
                            }
                            value={localP ?? it.royalties_percentual_override ?? ""}
                            onChange={(e) =>
                              setLocalPct((s) => ({ ...s, [it.id]: e.target.value }))
                            }
                            onBlur={() => flushPct(it)}
                            className={cn(
                              "h-8 w-16 text-right",
                              it.royalties_percentual_override != null && "border-indigo-400",
                            )}
                          />
                        </td>
                        {toggleCac && (
                          <td className="px-3 py-2 text-center">
                            <Checkbox
                              checked={!!it.is_cac}
                              disabled={readOnly}
                              title="Marcar como CAC — o valor calculado entra na linha de CAC do resumo, não em Royalties"
                              onCheckedChange={(c) => toggleCac(it, Boolean(c))}
                            />
                          </td>
                        )}
                        {toggleVendaSocios && (
                          <td className="px-3 py-2 text-center">
                            <Checkbox
                              checked={!!it.venda_socios}
                              disabled={readOnly || !!it.pipedrive_deal_id_socios}
                              title={
                                it.pipedrive_deal_id_socios
                                  ? `Deal já criado no Pipedrive (id ${it.pipedrive_deal_id_socios}) — sincronizado automaticamente`
                                  : "Venda feita diretamente por um sócio — cria o deal correspondente no pipe Sócios do Pipedrive automaticamente"
                              }
                              onCheckedChange={(c) => toggleVendaSocios(it, Boolean(c))}
                            />
                          </td>
                        )}
                        <td
                          className={cn(
                            "px-3 py-2 text-right whitespace-nowrap",
                            it.is_cac
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-indigo-700 dark:text-indigo-300",
                          )}
                        >
                          {brl(royal)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Checkbox
                            checked={!!it.confirmado}
                            disabled={readOnly}
                            onCheckedChange={(c) => toggleConfirm(it, Boolean(c))}
                          />
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {!readOnly &&
                            it.status_match === "so_omie" &&
                            it.contrato_id == null &&
                            onMoverBaseAntiga && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Mover de volta pra Base Antiga (CSC) — desfaz a cobrança de royalties"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Mover ${it.razao_social} de volta pra Base Antiga? Ele deixa de cobrar royalties.`,
                                    )
                                  ) {
                                    onMoverBaseAntiga(it);
                                  }
                                }}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          {!readOnly &&
                            !it.churn_pipefy_card_id &&
                            it.contrato_id != null &&
                            onMarcarChurn && (
                              <MarcarChurnButton
                                it={it}
                                pending={!!churnPending}
                                onConfirm={(motivo, observacao, dataChurn) =>
                                  onMarcarChurn(it, motivo, observacao, dataChurn)
                                }
                              />
                            )}
                          {!readOnly && it.fonte === "manual" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => onDelete(it)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!readOnly && it.fonte !== "manual" && onExcluir && (
                            <ExcluirItemButton
                              it={it}
                              pending={!!excluirPending}
                              onConfirm={(motivo) => onExcluir(it, motivo)}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function BaseAntigaTable({
  itens,
  readOnly,
  apuracaoId,
  unidadeNome,
  temOmie,
  localValor,
  setLocalValor,
  flushValor,
  toggleConfirm,
  onDelete,
  onExcluir,
  excluirPending,
  onCobrarRoyalties,
}: {
  itens: ApuracaoItem[];
  readOnly: boolean;
  apuracaoId: number;
  unidadeNome: string;
  temOmie: boolean;
  localValor: Record<number, string>;
  setLocalValor: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  flushValor: (it: ApuracaoItem) => void;
  toggleConfirm: (it: ApuracaoItem, c: boolean) => void;
  onDelete: (it: ApuracaoItem) => void;
  onExcluir?: (it: ApuracaoItem, motivo: string) => void;
  excluirPending?: boolean;
  onCobrarRoyalties?: (it: ApuracaoItem) => void;
}) {
  const { key: sortKey, dir: sortDir, onSort } = useSort<ItemSortKey>();

  const sortedItens = useMemo(() => {
    if (!sortKey) return itens;
    const dirMult = sortDir === "asc" ? 1 : -1;
    const withKey = itens.map((it) => {
      let v: string | number;
      switch (sortKey) {
        case "cliente":
          v = (it.razao_social ?? "").toLowerCase();
          break;
        case "cnpj":
          v = it.cnpj ?? "";
          break;
        case "omie":
          v = Number(it.valor_omie ?? 0);
          break;
        case "confirmado":
          v =
            localValor[it.id] !== undefined
              ? Number((localValor[it.id] || "0").replace(",", "."))
              : Number(it.valor_confirmado ?? 0);
          break;
        default:
          v = "";
      }
      return { it, v };
    });
    withKey.sort((a, b) => {
      if (a.v < b.v) return -1 * dirMult;
      if (a.v > b.v) return 1 * dirMult;
      return 0;
    });
    return withKey.map((x) => x.it);
  }, [itens, sortKey, sortDir, localValor]);

  if (itens.length === 0)
    return <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item.</div>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <SortableTh
              label="Cliente"
              sortKey="cliente"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="sticky left-0 z-10 bg-muted"
            />
            <th className="px-3 py-2 text-center">Filiais</th>
            <SortableTh
              label="CNPJ"
              sortKey="cnpj"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <SortableTh
              label="Omie"
              sortKey="omie"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              align="right"
            />
            <th
              className="px-3 py-2 text-left"
              title="Mês em que o título entrou no Omie como recebido — a apuração filtra por essa data, não pela competência"
            >
              Pagamento
            </th>
            <th
              className="px-3 py-2 text-left"
              title="Competência do(s) título(s) do Omie que geraram o valor ao lado — pode divergir do mês de pagamento em faturas atrasadas"
            >
              Competência
            </th>
            <SortableTh
              label="Confirmado"
              sortKey="confirmado"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              align="right"
            />
            <th className="px-3 py-2 text-center">✓</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sortedItens.map((it) => (
            <tr key={it.id} className="border-t">
              <td className="sticky left-0 z-10 bg-card px-3 py-2">{it.razao_social}</td>
              <td className="px-3 py-2 text-center">
                <FiliaisCell
                  it={it}
                  apuracaoId={apuracaoId}
                  unidadeNome={unidadeNome}
                  temOmie={temOmie}
                  readOnly={readOnly}
                />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatCnpjCpf(it.cnpj)}</td>

              <td className="px-3 py-2 text-right">
                {it.valor_omie != null ? brl(it.valor_omie) : "—"}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {formatDatasPagamento(it.data_pagamento_omie)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {formatCompetencias(it.data_competencia_omie)}
              </td>
              <td className="px-3 py-2 text-right">
                <Input
                  type="text"
                  inputMode="decimal"
                  disabled={readOnly}
                  value={localValor[it.id] ?? it.valor_confirmado ?? ""}
                  onChange={(e) => setLocalValor((s) => ({ ...s, [it.id]: e.target.value }))}
                  onBlur={() => flushValor(it)}
                  className="h-8 w-28 text-right"
                />
              </td>
              <td className="px-3 py-2 text-center">
                <Checkbox
                  checked={!!it.confirmado}
                  disabled={readOnly}
                  onCheckedChange={(c) => toggleConfirm(it, Boolean(c))}
                />
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {!readOnly && onCobrarRoyalties && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                    title="Cobrar royalties deste cliente — move pra Conciliação com % escolhido"
                    onClick={() => {
                      if (
                        confirm(
                          `Passar ${it.razao_social} a cobrar royalties? Ele sai do CSC e vai pra Conciliação, onde você escolhe o %.`,
                        )
                      ) {
                        onCobrarRoyalties(it);
                      }
                    }}
                  >
                    <Coins className="h-3.5 w-3.5" />
                  </Button>
                )}
                {!readOnly && it.fonte === "manual" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => onDelete(it)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {!readOnly && it.fonte !== "manual" && onExcluir && (
                  <ExcluirItemButton
                    it={it}
                    pending={!!excluirPending}
                    onConfirm={(motivo) => onExcluir(it, motivo)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExcluidosSection({
  itens,
  readOnly,
  onReincluir,
  pending,
}: {
  itens: ApuracaoItem[];
  readOnly: boolean;
  onReincluir: (it: ApuracaoItem) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (itens.length === 0) return null;
  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between border-b px-4 py-3 text-left">
          <div>
            <div className="font-medium">
              🚫 Excluídos deste mês{" "}
              <span className="text-xs text-muted-foreground">({itens.length})</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Não entram no cálculo de royalties deste mês.
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">CNPJ</th>
                  <th className="px-3 py-2 text-left">Motivo</th>
                  <th className="px-3 py-2 text-left">Excluído em</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it) => (
                  <tr key={it.id} className="border-t text-muted-foreground">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">{it.razao_social}</td>
                    <td className="px-3 py-2 text-xs">{formatCnpjCpf(it.cnpj)}</td>
                    <td className="px-3 py-2 text-xs">{it.motivo_exclusao ?? "—"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {it.excluido_em ? new Date(it.excluido_em).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!readOnly && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => onReincluir(it)}
                          disabled={pending}
                        >
                          Reincluir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function AddItemDialog({
  onAdd,
}: {
  onAdd: (payload: {
    razao_social: string;
    cnpj?: string;
    valor_confirmado?: number;
    observacao?: string;
    venda_socios?: boolean;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [razao, setRazao] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [vendaSocios, setVendaSocios] = useState(false);

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
            <Label>Razão social *</Label>
            <Input value={razao} onChange={(e) => setRazao(e.target.value)} />
          </div>
          <div>
            <Label>CNPJ</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div>
            <Label>Valor confirmado</Label>
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
          <div className="flex items-center gap-2">
            <Checkbox
              id="venda-socios"
              checked={vendaSocios}
              onCheckedChange={(c) => setVendaSocios(Boolean(c))}
            />
            <Label htmlFor="venda-socios" className="font-normal cursor-pointer">
              Venda de sócio — cria o deal correspondente no pipe Sócios do Pipedrive
              automaticamente
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!razao.trim()}
            onClick={() => {
              onAdd({
                razao_social: razao.trim(),
                cnpj: cnpj.trim() || undefined,
                valor_confirmado: valor ? Number(valor) : undefined,
                observacao: obs.trim() || undefined,
                venda_socios: vendaSocios || undefined,
              });
              setRazao("");
              setCnpj("");
              setValor("");
              setObs("");
              setVendaSocios(false);
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
