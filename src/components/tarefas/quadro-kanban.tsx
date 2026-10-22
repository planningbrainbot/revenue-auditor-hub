import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  criarTarefa,
  editarTarefa,
  type QuadroCompleto,
  type Tarefa,
} from "@/lib/tarefas/tarefas.functions";
import { ordemEntre } from "@/lib/tarefas/regras";
import { CHAVE, SeloPrazo, SeloPrioridade } from "./comum";

// O quadro em colunas (Fila de trabalho em forma de quadro). Arrastar muda a coluna e a ordem;
// a mesma mudança existe no campo Status da ficha, para quem não usa mouse.

export function QuadroKanban({
  dados,
  tarefas,
  hoje,
  eu,
  filtrando,
  aoAbrir,
}: {
  dados: QuadroCompleto;
  tarefas: Tarefa[];
  hoje: string;
  eu: string;
  filtrando: boolean;
  aoAbrir: (id: string) => void;
}) {
  const client = useQueryClient();
  const chave = [...CHAVE, "quadro", dados.quadro.id];
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<{ coluna: string; antesDe: string | null } | null>(null);
  const nomes = new Map(dados.membros.map((m) => [m.userId, m.nome]));

  const editarFn = useServerFn(editarTarefa);
  const mover = useMutation({
    mutationFn: (v: { id: string; colunaId: string; ordem: number }) =>
      editarFn({ data: { id: v.id, colunaId: v.colunaId, ordem: v.ordem } }),
    // Otimista: o cartão já está no lugar novo; se o banco recusar, volta e avisa.
    onMutate: async (v) => {
      await client.cancelQueries({ queryKey: chave });
      const antes = client.getQueryData<QuadroCompleto>(chave);
      const concluidas = new Set(dados.colunas.filter((c) => c.concluida).map((c) => c.id));
      client.setQueryData<QuadroCompleto>(
        chave,
        (q) =>
          q && {
            ...q,
            tarefas: q.tarefas.map((t) =>
              t.id === v.id
                ? {
                    ...t,
                    colunaId: v.colunaId,
                    ordem: v.ordem,
                    concluida: concluidas.has(v.colunaId),
                  }
                : t,
            ),
          },
      );
      return { antes };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.antes) client.setQueryData(chave, ctx.antes);
      toast.error(e.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: CHAVE }),
  });

  function soltar(colunaId: string, antesDe: string | null) {
    const id = arrastando;
    setArrastando(null);
    setAlvo(null);
    if (!id) return;
    const daColuna = dados.tarefas
      .filter((t) => t.colunaId === colunaId && t.id !== id)
      .sort((a, b) => a.ordem - b.ordem);
    const i = antesDe ? daColuna.findIndex((t) => t.id === antesDe) : daColuna.length;
    const pos = i < 0 ? daColuna.length : i;
    const ordem = ordemEntre(daColuna[pos - 1]?.ordem ?? null, daColuna[pos]?.ordem ?? null);
    const atual = dados.tarefas.find((t) => t.id === id);
    if (atual && atual.colunaId === colunaId && atual.ordem === ordem) return;
    mover.mutate({ id, colunaId, ordem });
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      <div className="flex min-w-max items-start gap-3">
        {dados.colunas.map((col) => {
          const doCol = tarefas
            .filter((t) => t.colunaId === col.id)
            .sort((a, b) => a.ordem - b.ordem);
          const total = dados.tarefas.filter((t) => t.colunaId === col.id).length;
          const ehAlvo = alvo?.coluna === col.id;
          return (
            <section
              key={col.id}
              aria-label={col.nome}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                ehAlvo && "border-primary",
              )}
              onDragOver={(e) => {
                if (!arrastando) return;
                e.preventDefault();
                if (alvo?.coluna !== col.id || alvo.antesDe !== null)
                  setAlvo({ coluna: col.id, antesDe: null });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                soltar(col.id, alvo?.coluna === col.id ? alvo.antesDe : null);
              }}
            >
              <header className="flex items-center justify-between px-3 pb-1 pt-3">
                <h2 className="text-sm font-semibold">{col.nome}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {filtrando && doCol.length !== total ? `${doCol.length} de ${total}` : total}
                </span>
              </header>
              {/* No topo, para criar sem rolar a coluna inteira; a tarefa nasce em primeiro. */}
              <NovaNaColuna
                dados={dados}
                colunaId={col.id}
                eu={eu}
                primeiraOrdem={primeiraOrdem(dados.tarefas, col.id)}
              />
              <ol className="flex min-h-16 flex-col gap-2 p-2">
                {doCol.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      setArrastando(t.id);
                    }}
                    onDragEnd={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    onDragOver={(e) => {
                      if (!arrastando || arrastando === t.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (alvo?.antesDe !== t.id) setAlvo({ coluna: col.id, antesDe: t.id });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      soltar(col.id, t.id);
                    }}
                    className={cn(
                      "rounded-lg",
                      alvo?.antesDe === t.id && "shadow-[0_-2px_0_0_var(--primary)]",
                      arrastando === t.id && "opacity-50",
                    )}
                  >
                    <Cartao
                      tarefa={t}
                      hoje={hoje}
                      eu={eu}
                      responsavel={t.responsavelId ? nomes.get(t.responsavelId) : undefined}
                      aoAbrir={aoAbrir}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Menor ordem da coluna contando todas as tarefas (não só as que o filtro mostra). */
function primeiraOrdem(tarefas: Tarefa[], colunaId: string): number | null {
  const ordens = tarefas.filter((t) => t.colunaId === colunaId).map((t) => t.ordem);
  return ordens.length ? Math.min(...ordens) : null;
}

function Cartao({
  tarefa,
  hoje,
  eu,
  responsavel,
  aoAbrir,
}: {
  tarefa: Tarefa;
  hoje: string;
  eu: string;
  responsavel?: string;
  aoAbrir: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => aoAbrir(tarefa.id)}
      className="w-full cursor-pointer space-y-2 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p
        className={cn(
          "text-sm font-medium leading-snug",
          tarefa.concluida && "text-muted-foreground line-through",
        )}
      >
        {tarefa.titulo}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tarefa.prioridade === "alta" && <SeloPrioridade prioridade="alta" />}
        <SeloPrazo prazo={tarefa.prazo} hoje={hoje} concluida={tarefa.concluida} />
        {tarefa.comentarios > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="size-3.5" aria-hidden />
            {tarefa.comentarios}
            <span className="sr-only">comentários</span>
          </span>
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {tarefa.responsavelId
          ? tarefa.responsavelId === eu
            ? "Você"
            : (responsavel ?? "Sem nome")
          : "Sem responsável"}
      </p>
    </button>
  );
}

/** Criar na coluna: título, prazo de entrega e responsável, os três obrigatórios (DECISIONS 22/10). */
function NovaNaColuna({
  dados,
  colunaId,
  eu,
  primeiraOrdem,
}: {
  dados: QuadroCompleto;
  colunaId: string;
  eu: string;
  primeiraOrdem: number | null;
}) {
  const client = useQueryClient();
  const [abrindo, setAbrindo] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [responsavelId, setResponsavelId] = useState(eu);
  const fechar = () => {
    setAbrindo(false);
    setTitulo("");
    setPrazo("");
    setResponsavelId(eu);
  };
  const criarFn = useServerFn(criarTarefa);
  const criar = useMutation({
    mutationFn: () =>
      criarFn({
        data: {
          quadroId: dados.quadro.id,
          colunaId,
          titulo,
          prazo,
          responsavelId,
          ordem: ordemEntre(null, primeiraOrdem),
        },
      }),
    onSuccess: () => {
      setTitulo("");
      setPrazo("");
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pronto = !!titulo.trim() && !!prazo && !!responsavelId;
  if (!abrindo)
    return (
      <button
        type="button"
        onClick={() => setAbrindo(true)}
        className="mx-2 mt-1 flex w-[calc(100%-1rem)] items-center gap-1 rounded-md border border-dashed px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden />
        Nova tarefa
      </button>
    );
  return (
    <form
      className="mx-2 mt-1 space-y-2 rounded-lg border bg-card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pronto) criar.mutate();
        else toast.error("Preencha título, prazo de entrega e responsável.");
      }}
      onKeyDown={(e) => e.key === "Escape" && fechar()}
    >
      <Input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título"
        aria-label="Título da nova tarefa"
        maxLength={200}
        disabled={criar.isPending}
      />
      <Input
        type="date"
        value={prazo}
        onChange={(e) => setPrazo(e.target.value)}
        aria-label="Prazo de entrega"
        required
        disabled={criar.isPending}
      />
      <Select value={responsavelId} onValueChange={setResponsavelId} disabled={criar.isPending}>
        <SelectTrigger aria-label="Responsável">
          <SelectValue placeholder="Responsável" />
        </SelectTrigger>
        <SelectContent>
          {dados.membros.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.userId === eu ? `${m.nome} (você)` : m.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={fechar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!pronto || criar.isPending}>
          {criar.isPending ? "Criando…" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
