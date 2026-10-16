import { useId, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type OpcaoSelecao = { valor: string; rotulo: string; dica?: string };

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** O que o botão diz: "Todos…" sem nada marcado, os nomes até caberem, depois "N {plural}". */
export function resumoDaSelecao(
  opcoes: OpcaoSelecao[],
  valor: string[],
  todos: string,
  plural: string,
): string {
  if (!valor.length) return todos;
  const nomes = opcoes.filter((o) => valor.includes(o.valor)).map((o) => o.rotulo);
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2 && nomes.join(" e ").length <= 26) return nomes.join(" e ");
  return `${nomes.length} ${plural}`;
}

/**
 * Seleção de várias opções na barra de filtros (16/10/2026, pedido do Pedro: "2 produtos + 1 SDR + 4 unidades +
 * data"). Nada marcado vale como todos; as opções marcadas somam entre si. Cada linha tem um atalho ("Só esta"), que troca a
 * escolha inteira por uma opção com um clique; acima de 7 opções a lista ganha busca. A mudança vale na hora: o
 * estado mora na URL de quem usa (N7), e o rodapé só limpa ou fecha.
 */
export function SelecaoMultipla({
  rotulo,
  opcoes,
  valor,
  aoMudar,
  todos,
  plural,
  so = "Só esta",
  className,
}: {
  /** Nome do filtro, acima do botão ("Produto"). */
  rotulo: string;
  opcoes: OpcaoSelecao[];
  valor: string[];
  aoMudar: (valor: string[]) => void;
  /** Texto sem nada marcado ("Todos os produtos"). */
  todos: string;
  /** Plural para o resumo com muitas marcadas ("produtos"). */
  plural: string;
  /** Rótulo do atalho que deixa só uma opção marcada ("Só este", "Só esta"). */
  so?: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false),
    [busca, setBusca] = useState("");
  const id = useId();
  const marcadas = new Set(valor);
  const resumo = resumoDaSelecao(opcoes, valor, todos, plural);
  const visiveis = busca
    ? opcoes.filter((o) => semAcento(o.rotulo).includes(semAcento(busca)))
    : opcoes;
  // A ordem é sempre a das opções, não a do clique: o mesmo recorte gera a mesma URL.
  const emOrdem = (s: Set<string>) => opcoes.map((o) => o.valor).filter((v) => s.has(v));
  const alternar = (v: string) => {
    const s = new Set(marcadas);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    aoMudar(emOrdem(s));
  };
  return (
    <div className={cn("grid gap-1", className)}>
      <span id={`${id}-rotulo`} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </span>
      <Popover
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o);
          if (!o) setBusca("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-labelledby={`${id}-rotulo ${id}-resumo`}
            className={cn(
              "flex h-9 min-w-44 max-w-64 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-[13px] font-medium text-foreground outline-none transition-colors duration-[120ms] hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              valor.length > 0 && "border-primary",
            )}
          >
            <span id={`${id}-resumo`} className="truncate">
              {resumo}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {valor.length > 1 && (
                <span className="num rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary-text">
                  {valor.length}
                </span>
              )}
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          {opcoes.length > 7 && (
            <div className="relative border-b p-2">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={`Buscar ${rotulo.toLowerCase()}`}
                aria-label={`Buscar em ${rotulo}`}
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
          <ul className="max-h-80 overflow-y-auto p-1" aria-label={rotulo}>
            {visiveis.map((o) => {
              const marcada = marcadas.has(o.valor);
              const idOpcao = `${id}-${o.valor}`;
              return (
                <li
                  key={o.valor}
                  className={cn(
                    "group flex min-h-10 items-center gap-3 rounded-md px-2.5 transition-colors duration-[120ms] hover:bg-muted",
                    marcada && "bg-muted/60",
                  )}
                >
                  <Checkbox
                    id={idOpcao}
                    checked={marcada}
                    onCheckedChange={() => alternar(o.valor)}
                  />
                  <label htmlFor={idOpcao} className="min-w-0 flex-1 cursor-pointer py-2 text-sm">
                    <span className={cn("block truncate", marcada && "font-medium")}>
                      {o.rotulo}
                    </span>
                    {o.dica && (
                      <span className="block truncate text-xs text-muted-foreground">{o.dica}</span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => aoMudar([o.valor])}
                    aria-label={`${so}: ${o.rotulo}`}
                    className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-primary-text opacity-0 outline-none transition-opacity duration-[120ms] hover:underline focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  >
                    {so}
                  </button>
                </li>
              );
            })}
            {!visiveis.length && (
              <li className="px-2.5 py-4 text-center text-sm text-muted-foreground">
                Nenhuma opção com "{busca}".
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <button
              type="button"
              disabled={!valor.length}
              onClick={() => aoMudar([])}
              className="rounded-md px-1.5 py-1 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              Limpar
            </button>
            <span className="num text-xs text-muted-foreground">
              {valor.length ? `${valor.length} de ${opcoes.length}` : todos}
            </span>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md px-1.5 py-1 text-[13px] font-semibold text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Concluir
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
