import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, MoreVertical, X } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ItemFormDialog } from "./item-form-dialog";
import { excluirItem, setValorCustomizado, excluirValorMes } from "./data";
import { BRL, Cadastro, CategoriaRow, Granularidade, Item, MESES_LABEL, Natureza, RateioPartners, Valor, agruparMeses, pctPartnersFor } from "./types";
import { toast } from "sonner";
import {
  categoriaVemDaApuracao,
  valorDaApuracao,
  type RoyaltiesPorUnidadeInfo,
} from "@/hooks/use-royalties";

interface Props {
  natureza: Natureza;
  cenarioId: string | null;
  ano: number;
  itens: Item[];
  valores: Valor[];
  categorias: CategoriaRow[];
  departamentos: Cadastro[];
  tiposRateio: Cadastro[];
  onChanged: () => void;
  modoPartners?: boolean;
  rateio?: RateioPartners;
  granularidade?: Granularidade;
  /** Mês (1..12) para filtrar a exibição a uma única coluna. `undefined`/`null` = todos os meses. */
  mesFiltro?: number | null;
  /** Royalties/CSC/CAC/Verba de mídia/Outras vêm daqui em vez de valor_base/overrides — só preenchido nas visões Base. */
  royaltiesMap?: Map<string, RoyaltiesPorUnidadeInfo>;
}

const TIPO_LABEL: Record<string, string> = {
  fixo: "Fixo",
  fixo_variavel: "Fixo Var.",
  parcelado: "Parcelado",
  pontual: "Pontual",
};

export function ItensView({
  natureza, cenarioId, ano, itens, valores, categorias, departamentos, tiposRateio, onChanged,
  modoPartners = false, rateio, granularidade = "mensal", mesFiltro, royaltiesMap,
}: Props) {
  const agrupar = (vals: number[]) => agruparMeses(vals, granularidade, mesFiltro);
  const readonly = modoPartners && natureza === "despesa";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  // "Da apuração" = item de unidade regional (CSC/Royalties/CAC/Mídia/Outras)
  // cujo valor vem direto de royalties_apuracao — não é mais editável aqui.
  const isDaApuracao = (i: Item) =>
    i.cenario_id === null && !!royaltiesMap && categoriaVemDaApuracao(i.categoria);

  const valoresPorItem = useMemo(() => {
    const out = new Map<string, number[]>();
    // primeiro override (mes) por item, no ano corrente
    const primeiroOv = new Map<string, number>();
    valores.forEach((v) => {
      const cur = primeiroOv.get(v.item_id);
      if (cur === undefined || v.mes < cur) primeiroOv.set(v.item_id, v.mes);
    });
    itens.forEach((i) => {
      const arr = Array(12).fill(0);
      if (isDaApuracao(i)) {
        for (let m = 1; m <= 12; m++) {
          const info = royaltiesMap!.get(`${i.unidade}|${String(m).padStart(2, "0")}`);
          arr[m - 1] = valorDaApuracao(info, i.categoria)?.valor ?? 0;
        }
        out.set(i.id, arr);
        return;
      }
      const inicio = Math.max(1, Math.min(12, i.mes_inicio || 1));
      const base = Number(i.valor_base) || 0;
      if (i.tipo === "fixo" || i.tipo === "fixo_variavel") {
        const ov = primeiroOv.get(i.id);
        const inicioEf = ov !== undefined ? Math.max(inicio, ov) : inicio;
        for (let m = inicioEf; m <= 12; m++) arr[m - 1] = base;
      } else if (i.tipo === "parcelado") {
        const n = Math.max(1, i.parcelas ?? 1);
        for (let k = 0; k < n; k++) { const m = inicio + k; if (m >= 1 && m <= 12) arr[m - 1] = base; }
      } else if (i.tipo === "pontual") {
        (i.meses_pontuais ?? []).forEach((m) => { if (m >= 1 && m <= 12) arr[m - 1] = base; });
      }
      out.set(i.id, arr);
    });
    valores.forEach((v) => {
      const item = itens.find((i) => i.id === v.item_id);
      if (item && isDaApuracao(item)) return; // vem da apuração — ignora overrides manuais
      const arr = out.get(v.item_id);
      if (arr) arr[v.mes - 1] = Number(v.valor) || 0;
    });
    if (readonly && rateio) {
      itens.forEach((i) => {
        const arr = out.get(i.id);
        if (!arr) return;
        for (let k = 0; k < 12; k++) {
          const pct = pctPartnersFor(i.nome, k + 1, rateio);
          if (pct !== 1) arr[k] = arr[k] * pct;
        }
      });
    }
    return out;
  }, [itens, valores, readonly, rateio, royaltiesMap]);

  function pctLabel(item: Item): string | null {
    if (!readonly || !rateio) return null;
    // mostra a média do ano (referência) — pct mensal real é aplicado nas células
    let soma = 0;
    for (let k = 1; k <= 12; k++) soma += pctPartnersFor(item.nome, k, rateio);
    return `${Math.round((soma / 12) * 100)}%`;
  }


  const customSet = useMemo(() => {
    const s = new Set<string>();
    valores.filter((v) => v.customizado).forEach((v) => s.add(`${v.item_id}:${v.mes}`));
    return s;
  }, [valores]);

  async function handleDeleteAll(id: string) {
    if (!confirm("Excluir este item em TODOS os meses? Esta ação remove o cadastro inteiro.")) return;
    try { await excluirItem(id, natureza); toast.success("Item excluído"); onChanged(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function handleDeleteMes(item: Item, mes: number) {
    if (!confirm(`Apagar o valor de ${MESES_LABEL[mes - 1]}/${ano} para "${item.nome}"?`)) return;
    try {
      await excluirValorMes(item.id, natureza, mes, ano);
      toast.success("Valor do mês apagado");
      onChanged();
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleCellEdit(item: Item, mes: number, raw: string) {
    const valor = Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
    try {
      await setValorCustomizado(item.id, natureza, mes, valor, ano);
      onChanged();
    } catch (e: any) { toast.error(e.message); }
  }

  const totalGeral = useMemo(
    () => itens.reduce((acc, i) => acc + (valoresPorItem.get(i.id)?.reduce((a, b) => a + b, 0) ?? 0), 0),
    [itens, valoresPorItem],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {itens.length} {itens.length === 1 ? "item" : "itens"} · Total anual: <strong className="text-foreground">{BRL(totalGeral)}</strong>
        </div>
        {!readonly && (
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova {natureza === "receita" ? "receita" : "despesa"}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="text-left p-2 sticky left-0 bg-muted/50 z-10 min-w-[180px]">Descrição</th>
              <th className="text-left p-2">Categoria</th>
              <th className="text-left p-2">Departamento</th>
              <th className="text-left p-2">Rateio</th>
              <th className="text-left p-2">Tipo</th>
              {agrupar(Array(12).fill(0)).map((b) => (
                <th key={b.label} className="text-right p-2 min-w-[80px]">{b.label}</th>
              ))}
              <th className="text-right p-2 min-w-[100px]">Total</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr><td colSpan={19} className="text-center p-6 text-muted-foreground">Nenhum item cadastrado.</td></tr>
            )}
            {itens.map((item) => {
              const vals = valoresPorItem.get(item.id) ?? Array(12).fill(0);
              const total = vals.reduce((a, b) => a + b, 0);
              const isSintetico = item.id.startsWith("av:");
              const buckets = agrupar(vals);
              const badge = pctLabel(item);
              return (
                <tr key={item.id} className="border-t hover:bg-muted/30 group">
                  <td className="p-2 sticky left-0 bg-background z-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span>{item.nome}</span>
                      {badge && (
                        <span className="text-xs px-1 rounded bg-primary/10 text-primary tabular-nums" title="% Partners">
                          {badge}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">{item.categoria ?? "—"}</td>
                  <td className="p-2">{item.departamento ?? "—"}</td>
                  <td className="p-2">{item.tipo_rateio ?? "—"}</td>
                  <td className="p-2">{TIPO_LABEL[item.tipo]}</td>
                  {buckets.map((b, bi) => {
                    const isSingleMonth = b.meses.length === 1;
                    const mes = b.meses[0];
                    const v = b.valor;
                    const isCustom = isSingleMonth && customSet.has(`${item.id}:${mes}`);
                    const editable = isSingleMonth && !readonly && !isSintetico && item.tipo === "fixo_variavel" && !isDaApuracao(item);
                    return (
                      <td key={bi} className={"p-1 text-right tabular-nums relative group/cell " + (isCustom && !readonly ? "bg-warning-soft/40" : "")}>
                        {editable ? (
                          <input
                            defaultValue={v ? v.toFixed(2).replace(".", ",") : ""}
                            className="w-full bg-transparent text-right outline-none focus:ring-1 focus:ring-primary rounded px-1"
                            onBlur={(e) => {
                              const newVal = Number(e.target.value.replace(/\./g, "").replace(",", ".")) || 0;
                              if (newVal !== v) handleCellEdit(item, mes, e.target.value);
                            }}
                          />
                        ) : (
                          v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—"
                        )}
                        {isSingleMonth && !readonly && !isSintetico && !isDaApuracao(item) && v > 0 && (
                          <button
                            type="button"
                            title={`Apagar ${MESES_LABEL[mes - 1]}/${ano}`}
                            onClick={() => handleDeleteMes(item, mes)}
                            className="absolute top-1/2 -translate-y-1/2 right-0.5 opacity-0 group-hover/cell:opacity-100 transition rounded hover:bg-destructive/15 text-destructive p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-semibold tabular-nums">{BRL(total)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {!readonly && !isSintetico && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreVertical className="h-3.5 w-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditing(item); setOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteAll(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir em todos os meses
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/20">
          {readonly
            ? <>Visão somente leitura — valores exibidos correspondem à fatia Partners do rateio. Alterne para <em>Base — Total</em> para editar.</>
            : <>Dica: passe o mouse sobre uma célula mensal e clique no <X className="inline h-3 w-3" /> para apagar somente aquele mês.</>}
        </div>
      </div>

      <ItemFormDialog
        open={open}
        onOpenChange={setOpen}
        natureza={natureza}
        cenarioId={cenarioId}
        item={editing}
        categorias={categorias}
        departamentos={departamentos}
        tiposRateio={tiposRateio}
        onSaved={onChanged}
      />
    </div>
  );
}
