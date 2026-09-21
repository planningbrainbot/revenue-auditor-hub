import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normal } from "@/lib/monetizacao/model";
import { inputClass } from "./common";

export type OpcaoFiltro = { value: string; label: string; group?: string; hint?: string };

// Filtro de múltipla escolha: as opções marcadas somam entre si; nada marcado = sem restrição.
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  options: OpcaoFiltro[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const labels = new Map(options.map((o) => [o.value, o.label]));
  const name = (v: string) => labels.get(v) ?? v;
  const summary = !value.length
    ? placeholder
    : value.length === 1
      ? name(value[0])
      : `${name(value[0])} +${value.length - 1}`;
  const shown = query ? options.filter((o) => normal(o.label).includes(normal(query))) : options;
  const groups = [...new Set(shown.map((o) => o.group ?? ""))];
  const toggle = (v: string) =>
    onChange(
      value.includes(v)
        ? value.filter((x) => x !== v)
        : options.map((o) => o.value).filter((x) => x === v || value.includes(x)),
    );
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${label}: ${value.length ? value.map(name).join(", ") : placeholder}`}
          title={value.length ? value.map(name).join(" · ") : undefined}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className={`truncate ${value.length ? "" : "text-foreground/80"}`}>{summary}</span>
          <span className="flex shrink-0 items-center gap-1">
            {value.length > 1 && (
              <span className="rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                {value.length}
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2">
        {options.length > 8 && (
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              className={`${inputClass} pl-8`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar opção"
              aria-label={`Buscar em ${label}`}
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto" role="group" aria-label={label}>
          {groups.map((g) => (
            <div key={g || "_"}>
              {g && (
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  {g}
                </p>
              )}
              {shown
                .filter((o) => (o.group ?? "") === g)
                .map((o) => (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={value.includes(o.value)}
                      onChange={() => toggle(o.value)}
                    />
                    <span>
                      {o.label}
                      {o.hint && (
                        <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                      )}
                    </span>
                  </label>
                ))}
            </div>
          ))}
          {!shown.length && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhuma opção.</p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={!value.length}
            onClick={() => onChange([])}
          >
            Limpar
          </button>
          <button type="button" className="font-medium text-primary" onClick={() => setOpen(false)}>
            Concluir
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Rótulo visual do filtro sem <label>: o seletor é um botão com nome acessível próprio, e um
// <label> em volta faria o clique no texto fechar e reabrir a lista.
export function FieldMulti({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 text-xs font-medium text-muted-foreground">
      <span aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}
