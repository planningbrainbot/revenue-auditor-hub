import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Filter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// Filtro de coluna no estilo Excel: ordenação + seleção de valores (colunas de
// texto) ou faixa mínima/máxima (colunas numéricas). Genérico de propósito —
// não conhece nada da Auditoria Interna, só recebe estado e devolve mudanças.

export type DirOrdem = "asc" | "desc";
export type Ordem<K extends string> = { coluna: K; dir: DirOrdem } | null;
export type FaixaNumerica = { min: number | null; max: number | null };

function Shell({
  titulo,
  ativo,
  dirOrdem,
  onOrdenar,
  onLimpar,
  alinharDireita,
  children,
}: {
  titulo: string;
  ativo: boolean;
  dirOrdem: DirOrdem | null;
  onOrdenar: (dir: DirOrdem) => void;
  onLimpar: () => void;
  alinharDireita?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-1", alinharDireita && "justify-end")}>
      <span>{titulo}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Filtrar e ordenar por ${titulo}`}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted",
              (ativo || dirOrdem) && "bg-primary/10 text-primary",
            )}
          >
            {dirOrdem === "asc" ? (
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
            ) : dirOrdem === "desc" ? (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            ) : (
              <Filter className={cn("h-3 w-3", ativo ? "opacity-100" : "opacity-50")} />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align={alinharDireita ? "end" : "start"} className="w-64 p-0">
          <div className="flex flex-col">
            <div className="flex items-center gap-1 border-b p-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 flex-1 justify-start px-2 text-xs font-normal"
                onClick={() => onOrdenar("asc")}
              >
                <ArrowUpNarrowWide className="mr-1.5 h-3.5 w-3.5" /> Crescente
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 flex-1 justify-start px-2 text-xs font-normal"
                onClick={() => onOrdenar("desc")}
              >
                <ArrowDownWideNarrow className="mr-1.5 h-3.5 w-3.5" /> Decrescente
              </Button>
            </div>
            {children}
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
                onClick={onLimpar}
                disabled={!ativo}
              >
                <X className="mr-1.5 h-3.5 w-3.5" /> Limpar filtro
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function FiltroTexto({
  titulo,
  opcoes,
  selecionados,
  onChange,
  dirOrdem,
  onOrdenar,
}: {
  titulo: string;
  opcoes: string[];
  // Lista vazia = nenhum filtro aplicado (mostra tudo), igual ao Excel.
  selecionados: string[];
  onChange: (valores: string[]) => void;
  dirOrdem: DirOrdem | null;
  onOrdenar: (dir: DirOrdem) => void;
}) {
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? opcoes.filter((o) => o.toLowerCase().includes(q)) : opcoes;
  }, [opcoes, busca]);

  const sel = new Set(selecionados);
  const ativo = selecionados.length > 0;
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((o) => sel.has(o));

  function alternar(valor: string) {
    const proximo = new Set(sel);
    if (proximo.has(valor)) proximo.delete(valor);
    else proximo.add(valor);
    // Marcar tudo equivale a não filtrar.
    onChange(proximo.size === opcoes.length ? [] : Array.from(proximo));
  }

  function alternarTodosVisiveis() {
    if (todosVisiveisMarcados) {
      const proximo = new Set(sel);
      for (const o of visiveis) proximo.delete(o);
      onChange(Array.from(proximo));
    } else {
      const proximo = new Set(sel);
      for (const o of visiveis) proximo.add(o);
      onChange(proximo.size === opcoes.length ? [] : Array.from(proximo));
    }
  }

  return (
    <Shell
      titulo={titulo}
      ativo={ativo}
      dirOrdem={dirOrdem}
      onOrdenar={onOrdenar}
      onLimpar={() => onChange([])}
    >
      <div className="p-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar..."
          className="h-7 text-xs"
        />
      </div>
      <div className="max-h-56 overflow-auto px-2 pb-2">
        {visiveis.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            Nenhum valor encontrado.
          </div>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs font-medium hover:bg-muted">
              <Checkbox checked={todosVisiveisMarcados} onCheckedChange={alternarTodosVisiveis} />
              <span>(Selecionar tudo)</span>
            </label>
            {visiveis.map((o) => (
              <label
                key={o}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted"
              >
                <Checkbox checked={!ativo || sel.has(o)} onCheckedChange={() => alternar(o)} />
                <span className="truncate" title={o}>
                  {o}
                </span>
              </label>
            ))}
          </>
        )}
      </div>
    </Shell>
  );
}

export function FiltroNumero({
  titulo,
  faixa,
  onChange,
  dirOrdem,
  onOrdenar,
}: {
  titulo: string;
  faixa: FaixaNumerica;
  onChange: (f: FaixaNumerica) => void;
  dirOrdem: DirOrdem | null;
  onOrdenar: (dir: DirOrdem) => void;
}) {
  const ativo = faixa.min != null || faixa.max != null;
  const paraNumero = (v: string) => {
    const limpo = v
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    if (!limpo) return null;
    const n = Number(limpo);
    return Number.isNaN(n) ? null : n;
  };

  return (
    <Shell
      titulo={titulo}
      ativo={ativo}
      dirOrdem={dirOrdem}
      onOrdenar={onOrdenar}
      onLimpar={() => onChange({ min: null, max: null })}
      alinharDireita
    >
      <div className="space-y-2 p-2">
        <div className="text-[11px] text-muted-foreground">Valor entre</div>
        <div className="flex items-center gap-1.5">
          <Input
            defaultValue={faixa.min ?? ""}
            onChange={(e) => onChange({ ...faixa, min: paraNumero(e.target.value) })}
            placeholder="mínimo"
            inputMode="decimal"
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">e</span>
          <Input
            defaultValue={faixa.max ?? ""}
            onChange={(e) => onChange({ ...faixa, max: paraNumero(e.target.value) })}
            placeholder="máximo"
            inputMode="decimal"
            className="h-7 text-xs"
          />
        </div>
      </div>
    </Shell>
  );
}
