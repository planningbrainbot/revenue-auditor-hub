import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { MessageSquare, Paperclip, SquareKanban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoErro, formatarQuando } from "@/components/planning";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  apagarAnexo,
  apagarTarefa,
  carregarConversa,
  carregarQuadro,
  comentar,
  editarComentario,
  editarTarefa,
  linkAnexo,
  listarAnexos,
  registrarAnexo,
  type Anexo,
  type Comentario,
  type Evento,
  type QuadroCompleto,
  type Tarefa,
} from "@/lib/tarefas/tarefas.functions";
import {
  BUCKET_ANEXOS,
  caminhoDoAnexo,
  formatarTamanho,
  LIMITE_ANEXO,
  PRIORIDADES,
  ROTULO_PRIORIDADE,
  type Prioridade,
} from "@/lib/tarefas/regras";
import { CHAVE, NENHUM } from "./comum";

// A ficha de uma tarefa (arquétipo Ficha, em Sheet). O id fica na URL (`tarefa`), então o
// link da tarefa abre a ficha direto. As opções (colunas, membros, projetos) vêm do quadro
// da tarefa, carregado aqui, para a ficha servir igual em Minhas tarefas e no quadro.

export function FichaTarefa({
  tarefaId,
  quadroId,
  procurando = false,
  eu,
  aoFechar,
}: {
  tarefaId: string | undefined;
  quadroId: string | undefined;
  /** A tela ainda está descobrindo o quadro da tarefa (tarefa recém-criada). */
  procurando?: boolean;
  eu: string;
  aoFechar: () => void;
}) {
  const quadroFn = useServerFn(carregarQuadro);
  const quadro = useQuery({
    queryKey: [...CHAVE, "quadro", quadroId],
    enabled: !!quadroId,
    queryFn: () => quadroFn({ data: { quadroId: quadroId as string } }),
    retry: false,
  });
  const tarefa = quadro.data?.tarefas.find((t) => t.id === tarefaId);

  return (
    <Sheet open={!!tarefaId} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {quadro.isLoading || (!quadroId && procurando) ? (
          <>
            <SheetHeader>
              <SheetTitle>Tarefa</SheetTitle>
            </SheetHeader>
            <Carregando variante="pagina" />
          </>
        ) : quadro.isError ? (
          <EstadoErro
            detalhe={(quadro.error as Error).message}
            tentarNovamente={() => quadro.refetch()}
          />
        ) : !quadro.data || !tarefa ? (
          <SheetHeader>
            <SheetTitle>Tarefa não encontrada</SheetTitle>
            <SheetDescription>
              Ela foi apagada, ou você não é membro do quadro dela.
            </SheetDescription>
          </SheetHeader>
        ) : (
          <Conteudo
            key={tarefa.id}
            tarefa={tarefa}
            quadro={quadro.data}
            eu={eu}
            aoFechar={aoFechar}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  tarefa,
  quadro,
  eu,
  aoFechar,
}: {
  tarefa: Tarefa;
  quadro: QuadroCompleto;
  eu: string;
  aoFechar: () => void;
}) {
  const client = useQueryClient();
  const editarFn = useServerFn(editarTarefa);
  const editar = useMutation({
    mutationFn: (patch: Record<string, unknown>) => editarFn({ data: { id: tarefa.id, ...patch } }),
    onSuccess: () => client.invalidateQueries({ queryKey: CHAVE }),
    onError: (e: Error) => {
      toast.error(e.message);
      client.invalidateQueries({ queryKey: CHAVE });
    },
  });
  const apagarFn = useServerFn(apagarTarefa);
  const apagar = useMutation({
    mutationFn: () => apagarFn({ data: { id: tarefa.id } }),
    onSuccess: () => {
      toast.success("Tarefa apagada.");
      client.invalidateQueries({ queryKey: CHAVE });
      aoFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [titulo, setTitulo] = useState(tarefa.titulo);
  const [descricao, setDescricao] = useState(tarefa.descricao ?? "");
  useEffect(() => setTitulo(tarefa.titulo), [tarefa.titulo]);
  useEffect(() => setDescricao(tarefa.descricao ?? ""), [tarefa.descricao]);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  const souDono = quadro.quadro.meuPapel === "dono";
  const podeApagar = souDono || tarefa.criadoPor === eu;
  const projetos = quadro.projetos.filter((p) => !p.arquivado || p.id === tarefa.projetoId);
  const departamentos = quadro.departamentos.filter(
    (d) => d.ativo || d.id === tarefa.departamentoId,
  );

  return (
    <div className="space-y-6">
      <SheetHeader className="space-y-1 pr-8">
        <SheetDescription className="flex items-center gap-1.5">
          <SquareKanban className="size-4" aria-hidden />
          <Link
            to="/tarefas/quadros/$quadroId"
            params={{ quadroId: quadro.quadro.id }}
            className="underline-offset-4 hover:underline"
          >
            {quadro.quadro.nome}
          </Link>
        </SheetDescription>
        <SheetTitle className="sr-only">{tarefa.titulo}</SheetTitle>
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => {
            const t = titulo.trim();
            if (!t) return setTitulo(tarefa.titulo);
            if (t !== tarefa.titulo) editar.mutate({ titulo: t });
          }}
          maxLength={200}
          aria-label="Título"
          className="h-auto border-transparent px-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
        />
      </SheetHeader>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Campo rotulo="Status" id="f-status">
          <Select
            value={tarefa.colunaId}
            onValueChange={(v) => editar.mutate({ colunaId: v, ordem: Date.now() / 1000 })}
          >
            <SelectTrigger id="f-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quadro.colunas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Responsável" id="f-resp">
          <Select
            value={tarefa.responsavelId ?? undefined}
            onValueChange={(v) => editar.mutate({ responsavelId: v })}
          >
            {/* Sem responsável só acontece quando ele saiu do quadro: a tarefa espera alguém assumir. */}
            <SelectTrigger id="f-resp">
              <SelectValue placeholder="Escolha quem assume" />
            </SelectTrigger>
            <SelectContent>
              {quadro.membros.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.userId === eu ? `${m.nome} (você)` : m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Prazo de entrega" id="f-prazo">
          <Input
            id="f-prazo"
            type="date"
            defaultValue={tarefa.prazo ?? ""}
            key={tarefa.prazo ?? ""}
            required
            onBlur={(e) => {
              const v = e.target.value;
              if (!v) {
                e.target.value = tarefa.prazo ?? "";
                toast.error("O prazo de entrega não pode ficar vazio.");
                return;
              }
              if (v !== tarefa.prazo) editar.mutate({ prazo: v });
            }}
          />
        </Campo>
        <Campo rotulo="Prioridade" id="f-prio">
          <Select
            value={tarefa.prioridade}
            onValueChange={(v) => editar.mutate({ prioridade: v as Prioridade })}
          >
            <SelectTrigger id="f-prio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Projeto" id="f-proj">
          <Select
            value={tarefa.projetoId ?? NENHUM}
            onValueChange={(v) => editar.mutate({ projetoId: v === NENHUM ? null : v })}
          >
            <SelectTrigger id="f-proj">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Nenhum</SelectItem>
              {projetos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!projetos.length && (
            <p className="text-xs text-muted-foreground">
              {souDono
                ? "Crie projetos em Configurar quadro."
                : "O dono do quadro cria os projetos."}
            </p>
          )}
        </Campo>
        <Campo rotulo="Departamento" id="f-dep">
          <Select
            value={tarefa.departamentoId ?? NENHUM}
            onValueChange={(v) => editar.mutate({ departamentoId: v === NENHUM ? null : v })}
          >
            <SelectTrigger id="f-dep">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Nenhum</SelectItem>
              {departamentos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>

      <Campo rotulo="Descrição" id="f-desc">
        <Textarea
          id="f-desc"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          onBlur={() => {
            const d = descricao.trim();
            if (d !== (tarefa.descricao ?? "")) editar.mutate({ descricao: d || null });
          }}
          rows={4}
          placeholder="Detalhes, links, o que é estar pronto"
        />
      </Campo>

      <Anexos tarefa={tarefa} souDono={souDono} />

      <Conversa tarefaId={tarefa.id} />

      <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
        <span>Criada {formatarQuando(tarefa.criadoEm)}</span>
        {podeApagar && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmarApagar(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            Apagar tarefa
          </Button>
        )}
      </div>

      <AlertDialog open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{tarefa.titulo}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Os comentários e o histórico vão junto. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => apagar.mutate()}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Campo({
  rotulo,
  id,
  children,
}: {
  rotulo: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

const ROTULO_CAMPO: Record<string, string> = {
  status: "status",
  responsavel: "responsável",
  prazo: "prazo",
  prioridade: "prioridade",
};

function textoEvento(e: Evento): string {
  if (e.campo === "criada") return "criou a tarefa";
  if (e.campo === "anexo") return e.para ? `anexou ${e.para}` : `removeu o anexo ${e.de}`;
  const valor = (v: string | null) =>
    v == null ? "vazio" : e.campo === "prioridade" ? (ROTULO_PRIORIDADE[v as Prioridade] ?? v) : v;
  return `mudou ${ROTULO_CAMPO[e.campo] ?? e.campo} de ${valor(e.de)} para ${valor(e.para)}`;
}

/**
 * Anexos da tarefa. O arquivo sobe do navegador direto para o bucket (a policy do Storage
 * confere se é membro do quadro) e só depois vira linha; se o registro falhar, o arquivo
 * subido é apagado para não sobrar órfão.
 */
function Anexos({ tarefa, souDono }: { tarefa: Tarefa; souDono: boolean }) {
  const client = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const chave = [...CHAVE, "anexos", tarefa.id];
  const listarFn = useServerFn(listarAnexos);
  const anexos = useQuery({
    queryKey: chave,
    queryFn: () => listarFn({ data: { tarefaId: tarefa.id } }),
    retry: false,
  });
  const registrarFn = useServerFn(registrarAnexo);
  const linkFn = useServerFn(linkAnexo);
  const apagarFn = useServerFn(apagarAnexo);
  const [enviando, setEnviando] = useState(0);
  const [apagando, setApagando] = useState<Anexo | null>(null);

  async function enviar(arquivo: File) {
    if (arquivo.size > LIMITE_ANEXO) {
      toast.error(`${arquivo.name} passa de 25 MB.`);
      return;
    }
    const caminho = caminhoDoAnexo(tarefa.quadroId, tarefa.id, crypto.randomUUID(), arquivo.name);
    const { error } = await supabase.storage.from(BUCKET_ANEXOS).upload(caminho, arquivo, {
      contentType: arquivo.type || undefined,
    });
    if (error) {
      toast.error(`Não foi possível anexar ${arquivo.name}: ${error.message}`);
      return;
    }
    try {
      await registrarFn({
        data: {
          tarefaId: tarefa.id,
          quadroId: tarefa.quadroId,
          caminho,
          nome: arquivo.name,
          tamanho: arquivo.size,
          tipo: arquivo.type || null,
        },
      });
    } catch (e) {
      await supabase.storage.from(BUCKET_ANEXOS).remove([caminho]);
      toast.error((e as Error).message);
    }
  }

  async function escolher(arquivos: FileList | null) {
    const lista = Array.from(arquivos ?? []);
    if (!lista.length) return;
    setEnviando(lista.length);
    for (const a of lista) await enviar(a);
    setEnviando(0);
    if (entrada.current) entrada.current.value = "";
    client.invalidateQueries({ queryKey: CHAVE });
  }

  // A aba abre no clique (senão o navegador barra como pop-up) e recebe o link assinado depois.
  async function abrir(id: string) {
    const aba = window.open("", "_blank");
    try {
      const { url } = await linkFn({ data: { id } });
      if (aba) aba.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      aba?.close();
      toast.error((e as Error).message);
    }
  }
  const apagar = useMutation({
    mutationFn: (id: string) => apagarFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Anexo removido.");
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-3" aria-labelledby="anexos-titulo">
      <div className="flex items-center justify-between gap-2">
        <h3 id="anexos-titulo" className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4" aria-hidden />
          Anexos
        </h3>
        <input
          ref={entrada}
          type="file"
          multiple
          className="sr-only"
          id="f-anexo"
          onChange={(e) => escolher(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={enviando > 0}
          onClick={() => entrada.current?.click()}
        >
          {enviando > 0
            ? `Enviando ${enviando} arquivo${enviando > 1 ? "s" : ""}…`
            : "Anexar arquivo"}
        </Button>
      </div>
      {anexos.isLoading ? (
        <Carregando variante="tabela" linhas={2} />
      ) : anexos.isError ? (
        <EstadoErro
          detalhe={(anexos.error as Error).message}
          tentarNovamente={() => anexos.refetch()}
        />
      ) : !anexos.data?.length ? (
        <p className="text-xs text-muted-foreground">
          Nenhum arquivo. Até 25 MB cada, qualquer tipo.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {anexos.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-sm font-medium underline-offset-4 hover:underline"
                  onClick={() => abrir(a.id)}
                  title={a.nome}
                >
                  {a.nome}
                </button>
                <p className="text-xs text-muted-foreground">
                  {formatarTamanho(a.tamanho)} · {a.enviadoPor?.nome ?? "Alguém"} ·{" "}
                  {formatarQuando(a.criadoEm)}
                </p>
              </div>
              {(a.meu || souDono) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-danger"
                  aria-label={`Remover ${a.nome}`}
                  onClick={() => setApagando(a)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!apagando} onOpenChange={(v) => !v && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{apagando?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo sai da tarefa para todos do quadro. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => apagando && apagar.mutate(apagando.id)}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Comentários e histórico numa linha do tempo só, do mais antigo para o mais novo. */
function Conversa({ tarefaId }: { tarefaId: string }) {
  const client = useQueryClient();
  const conversaFn = useServerFn(carregarConversa);
  const conversa = useQuery({
    queryKey: [...CHAVE, "conversa", tarefaId],
    queryFn: () => conversaFn({ data: { tarefaId } }),
    retry: false,
  });
  const [texto, setTexto] = useState("");
  const comentarFn = useServerFn(comentar);
  const enviar = useMutation({
    mutationFn: () => comentarFn({ data: { tarefaId, texto } }),
    onSuccess: () => {
      setTexto("");
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type Item =
    { tipo: "c"; c: Comentario; quando: string } | { tipo: "e"; e: Evento; quando: string };
  const itens: Item[] = [
    ...(conversa.data?.comentarios ?? []).map((c) => ({
      tipo: "c" as const,
      c,
      quando: c.criadoEm,
    })),
    ...(conversa.data?.eventos ?? []).map((e) => ({ tipo: "e" as const, e, quando: e.criadoEm })),
  ].sort((a, b) => a.quando.localeCompare(b.quando));

  return (
    <section className="space-y-3" aria-labelledby="conversa-titulo">
      <h3 id="conversa-titulo" className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-4" aria-hidden />
        Comentários e histórico
      </h3>
      {conversa.isLoading ? (
        <Carregando variante="tabela" linhas={3} />
      ) : conversa.isError ? (
        <EstadoErro
          detalhe={(conversa.error as Error).message}
          tentarNovamente={() => conversa.refetch()}
        />
      ) : (
        <ol className="space-y-3">
          {itens.map((i) =>
            i.tipo === "e" ? (
              <li key={`e${i.e.id}`} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{i.e.autor?.nome ?? "Alguém"}</span>{" "}
                {textoEvento(i.e)} · {formatarQuando(i.e.criadoEm)}
              </li>
            ) : (
              <ComentarioItem key={`c${i.c.id}`} c={i.c} />
            ),
          )}
        </ol>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) enviar.mutate();
        }}
      >
        <Label htmlFor="novo-comentario" className="sr-only">
          Novo comentário
        </Label>
        <Textarea
          id="novo-comentario"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escreva um comentário"
          maxLength={5000}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!texto.trim() || enviar.isPending}>
            Comentar
          </Button>
        </div>
      </form>
    </section>
  );
}

function ComentarioItem({ c }: { c: Comentario }) {
  const client = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(c.texto);
  const editarFn = useServerFn(editarComentario);
  const salvar = useMutation({
    mutationFn: (v: { texto?: string; apagar?: boolean }) => editarFn({ data: { id: c.id, ...v } }),
    onSuccess: () => {
      setEditando(false);
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{c.autor.nome}</span> ·{" "}
          {formatarQuando(c.criadoEm)}
          {c.editadoEm && " · editado"}
        </span>
        {c.meu && !editando && (
          <span className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setEditando(true)}
            >
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => salvar.mutate({ apagar: true })}
            >
              Apagar
            </Button>
          </span>
        )}
      </div>
      {editando ? (
        <div className="space-y-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            aria-label="Editar comentário"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={!texto.trim()} onClick={() => salvar.mutate({ texto })}>
              Salvar
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
      )}
    </li>
  );
}
