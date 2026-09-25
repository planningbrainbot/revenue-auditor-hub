import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bookmark,
  CircleStop,
  History,
  Loader2,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EstadoErro, EstadoVazio, Procedencia, StatusBadge } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  abrirVisao,
  excluirConversa,
  excluirVisao,
  executarVisaoFn,
  lerConversa,
  listarConversas,
  listarVisoes,
  renomearVisao,
  salvarVisao,
} from "@/lib/cockpit-ceo/conversa/conversa.functions";
import type { RespostaFinal } from "@/lib/cockpit-ceo/conversa/responder";
import type { BlocoResolvido, VisaoDefinicao } from "@/lib/cockpit-ceo/conversa/spec";
import { chavesDeFiltro } from "@/lib/cockpit-ceo/conversa/spec";
import type { Filtros, PeriodoFiltro } from "@/lib/cockpit-ceo/conversa/filtros";
import { ROTULO_BASE, ROTULO_LEITURA, ROTULO_PRODUTO } from "@/lib/cockpit-ceo/conversa/filtros";
import { Bloco } from "./blocos";

// "Perguntar ao Brain": conversa à esquerda, área visual à direita.
//
// A resposta chega em Server-Sent Events (rota /api/cockpit-ceo/conversa): estados da consulta,
// consultas feitas e, por fim, a resposta já conferida (texto + blocos com resultados). A área
// visual mostra os blocos da resposta escolhida; os controles de filtro refazem as mesmas consultas
// com outro recorte, sem passar pelo modelo. Histórico e visões salvas guardam só definições: ao
// reabrir, as consultas rodam de novo com o acesso de agora, e a tela diz quando foi consultado.

export const SUGESTOES = [
  "Quanto faturamos no último mês fechado e como estamos contra o mês anterior?",
  "Quais unidades mais explicam a mudança do faturamento?",
  "Onde estamos perdendo receita?",
  "O Growth está gerando vendas no ritmo necessário?",
  "O que está travado entre venda e ativação?",
  "Compare Curitiba e Belém nos últimos três meses.",
  "Monte uma tela com faturamento, aquisição e onboarding.",
];

const ETAPAS: Record<string, string> = {
  conversa: "Abrindo a conversa",
  classificando: "Entendendo a pergunta",
  pensando: "Escolhendo as consultas",
  consultando: "Consultando os dados",
  tentando_de_novo: "O provedor falhou; tentando mais uma vez",
  conferindo: "Conferindo os números do texto",
};

type Resposta = RespostaFinal & { historico?: boolean; criadaEm?: string };

interface PainelVisual {
  turno: string | null;
  definicao: VisaoDefinicao | null;
  blocos: BlocoResolvido[];
  filtros: Filtros;
  consultadoEm: string | null;
  origem: "resposta" | "historico" | "controles" | "salva";
  nome?: string;
  carregando?: boolean;
  erro?: string | null;
}

const PAINEL_VAZIO: PainelVisual = {
  turno: null,
  definicao: null,
  blocos: [],
  filtros: {},
  consultadoEm: null,
  origem: "resposta",
};

const respostaDe = (m: UIMessage): Resposta | null => {
  for (const p of m.parts) if (p.type === "data-resposta") return (p as { data: Resposta }).data;
  return null;
};
const textoDe = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ");
const consultasDe = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "data-consulta")
    .map((p) => (p as { data: { id: string; titulo: string; estado: string } }).data);

const hora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

async function cabecalhoDeSessao(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export function PerguntarAoBrain({
  conversaInicial,
  visaoInicial,
  aoMudarBusca,
}: {
  conversaInicial: string | null;
  visaoInicial: string | null;
  aoMudarBusca: (b: { conversa?: string; visao?: string }) => void;
}) {
  const qc = useQueryClient();
  const conversaRef = useRef<string | null>(conversaInicial);
  const [conversaId, setConversaId] = useState<string | null>(conversaInicial);
  const [etapa, setEtapa] = useState<{ etapa: string; detalhe?: string } | null>(null);
  const [painel, setPainel] = useState<PainelVisual>(PAINEL_VAZIO);
  const [texto, setTexto] = useState("");
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const lerConversaFn = useServerFn(lerConversa);
  const executarFn = useServerFn(executarVisaoFn);
  const abrirVisaoFn = useServerFn(abrirVisao);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/cockpit-ceo/conversa",
        headers: cabecalhoDeSessao,
        prepareSendMessagesRequest: async ({ messages }) => ({
          body: { conversaId: conversaRef.current, pergunta: textoDe(messages[messages.length - 1]) },
          headers: await cabecalhoDeSessao(),
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
    onData: (parte) => {
      if (parte.type !== "data-estado") return;
      const d = parte.data as { etapa: string; detalhe?: string };
      if (d.etapa === "conversa" && d.detalhe && !conversaRef.current) {
        conversaRef.current = d.detalhe;
        setConversaId(d.detalhe);
        aoMudarBusca({ conversa: d.detalhe, visao: undefined });
      } else setEtapa(d);
    },
    onFinish: () => {
      setEtapa(null);
      qc.invalidateQueries({ queryKey: ["cockpit-conversa", "lista"] });
    },
    onError: () => setEtapa(null),
  });
  const ocupado = status === "submitted" || status === "streaming";

  // Nova resposta com blocos: vira o conteúdo da área visual.
  const ultima = messages[messages.length - 1];
  const ultimaResposta = ultima?.role === "assistant" ? respostaDe(ultima) : null;
  useEffect(() => {
    if (!ultimaResposta || ultimaResposta.historico) return;
    if (ultimaResposta.definicao && ultimaResposta.blocos.length)
      setPainel({
        turno: ultima.id,
        definicao: ultimaResposta.definicao,
        blocos: ultimaResposta.blocos,
        filtros: ultimaResposta.filtros,
        consultadoEm: new Date().toISOString(),
        origem: "resposta",
      });
    if (ultimaResposta.visaoSalva) qc.invalidateQueries({ queryKey: ["cockpit-conversa", "visoes"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultima?.id, ultimaResposta?.estado]);

  const refazer = useCallback(
    async (definicao: VisaoDefinicao, extra: Partial<PainelVisual>, controles?: Filtros) => {
      setPainel((p) => ({ ...p, ...extra, definicao, carregando: true, erro: null }));
      try {
        const r = await executarFn({ data: { definicao, controles } });
        setPainel((p) => ({
          ...p,
          ...extra,
          definicao: r.definicao,
          blocos: r.blocos,
          filtros: r.filtros,
          consultadoEm: r.consultadoEm,
          carregando: false,
        }));
      } catch (e) {
        setPainel((p) => ({ ...p, carregando: false, erro: (e as Error).message }));
      }
    },
    [executarFn],
  );

  // Abrir conversa do histórico: mensagens vêm do banco; a visão da última resposta é consultada agora.
  const abrirConversa = useCallback(
    async (id: string) => {
      stop();
      setCarregandoHistorico(true);
      try {
        const c = await lerConversaFn({ data: { id } });
        conversaRef.current = c.id;
        setConversaId(c.id);
        const msgs: UIMessage[] = c.mensagens.map((m) =>
          m.papel === "usuario"
            ? { id: m.id, role: "user", parts: [{ type: "text", text: m.texto }] }
            : {
                id: m.id,
                role: "assistant",
                parts: [
                  {
                    type: "data-resposta",
                    data: {
                      ...(m.metadados as object),
                      conclusao: m.texto,
                      definicao: m.visao,
                      blocos: [],
                      historico: true,
                      criadaEm: m.criada_em,
                    },
                  } as never,
                ],
              },
        );
        setMessages(msgs);
        const ultimaComVisao = [...c.mensagens].reverse().find((m) => m.visao);
        if (ultimaComVisao?.visao)
          await refazer(ultimaComVisao.visao, { turno: ultimaComVisao.id, origem: "historico" });
        else setPainel(PAINEL_VAZIO);
      } catch {
        toast.error("Não foi possível abrir essa conversa.");
      } finally {
        setCarregandoHistorico(false);
      }
    },
    [lerConversaFn, refazer, setMessages, stop],
  );

  const abrirSalva = useCallback(
    async (id: string) => {
      setPainel((p) => ({ ...p, carregando: true, erro: null }));
      try {
        const v = await abrirVisaoFn({ data: { id } });
        setPainel({
          turno: null,
          definicao: v.definicao,
          blocos: v.blocos,
          filtros: v.filtros,
          consultadoEm: v.consultadoEm,
          origem: "salva",
          nome: v.nome,
        });
        aoMudarBusca({ visao: id });
      } catch {
        setPainel((p) => ({ ...p, carregando: false, erro: "Visão não encontrada ou sem acesso." }));
      }
    },
    [abrirVisaoFn, aoMudarBusca],
  );

  const iniciou = useRef(false);
  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    if (conversaInicial) void abrirConversa(conversaInicial);
    if (visaoInicial) void abrirSalva(visaoInicial);
  }, [abrirConversa, abrirSalva, conversaInicial, visaoInicial]);

  const novaConversa = () => {
    stop();
    conversaRef.current = null;
    setConversaId(null);
    setMessages([]);
    setPainel(PAINEL_VAZIO);
    clearError();
    aoMudarBusca({ conversa: undefined, visao: undefined });
  };

  const enviar = (pergunta: string) => {
    const t = pergunta.trim();
    if (!t || ocupado) return;
    clearError();
    setTexto("");
    void sendMessage({ text: t });
  };

  const selecionarTurno = (m: UIMessage) => {
    const r = respostaDe(m);
    if (!r?.definicao) return;
    if (r.blocos.length)
      setPainel({
        turno: m.id,
        definicao: r.definicao,
        blocos: r.blocos,
        filtros: r.filtros,
        consultadoEm: painel.turno === m.id ? painel.consultadoEm : null,
        origem: "resposta",
      });
    else void refazer(r.definicao, { turno: m.id, origem: "historico" });
  };

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(22rem,2fr)_3fr]">
      <section
        aria-label="Conversa"
        className="flex min-h-[32rem] flex-col rounded-xl border bg-card lg:h-[calc(100vh-13rem)]"
      >
        <BarraConversa conversaId={conversaId} aoAbrir={abrirConversa} aoNova={novaConversa} ocupado={ocupado} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          {carregandoHistorico && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Abrindo a conversa…
            </p>
          )}
          {!messages.length && !carregandoHistorico && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pergunte em linguagem comum. A resposta traz uma conclusão curta, o gráfico com os
                números das fontes do cockpit e caminhos para aprofundar.
              </p>
              <ul className="flex flex-col gap-2">
                {SUGESTOES.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => enviar(s)}
                      className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-[120ms] hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ml-8 rounded-lg bg-muted px-3 py-2 text-sm">
                {textoDe(m)}
              </p>
            ) : (
              <TurnoAssistente
                key={m.id}
                m={m}
                selecionado={painel.turno === m.id}
                emCurso={ocupado && m.id === ultima?.id}
                etapa={etapa}
                aoSelecionar={() => selecionarTurno(m)}
                aoPerguntar={enviar}
              />
            ),
          )}
          {ocupado && ultima?.role === "user" && <Progresso etapa={etapa} consultas={[]} />}
          {error && (
            <div className="space-y-2">
              <EstadoErro
                titulo="A conversa não respondeu"
                detalhe={mensagemDeErro(error)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const ultimaPergunta = [...messages].reverse().find((x) => x.role === "user");
                  if (ultimaPergunta) {
                    setMessages(messages.filter((x) => x.id !== ultimaPergunta.id));
                    enviar(textoDe(ultimaPergunta));
                  }
                }}
              >
                <RotateCcw className="size-4" aria-hidden /> Tentar de novo
              </Button>
            </div>
          )}
        </div>
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <Label htmlFor="pergunta-brain" className="sr-only">
            Sua pergunta
          </Label>
          <Textarea
            id="pergunta-brain"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            placeholder={messages.length ? "Refine: “agora só a base nova”, “e em Curitiba?”" : "Pergunte sobre a empresa"}
            rows={2}
            maxLength={2000}
            className="min-h-[2.75rem] resize-none"
          />
          {ocupado ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              <CircleStop className="size-4" aria-hidden /> Cancelar
            </Button>
          ) : (
            <Button type="submit" disabled={!texto.trim()}>
              <SendHorizontal className="size-4" aria-hidden /> Perguntar
            </Button>
          )}
        </form>
      </section>

      <AreaVisual
        painel={painel}
        conversaId={conversaId}
        aoMudarFiltros={(controles) =>
          painel.definicao &&
          refazer(painel.definicao, { origem: "controles", turno: painel.turno }, controles)
        }
        aoAbrirSalva={abrirSalva}
        aoPerguntar={enviar}
        ocupado={ocupado}
      />
    </div>
  );
}

function mensagemDeErro(e: Error): string {
  try {
    const j = JSON.parse(e.message) as { erro?: string };
    if (j.erro) return j.erro;
  } catch {
    /* não era JSON */
  }
  return "O servidor não conseguiu responder agora. Nenhum número foi mostrado.";
}

function Progresso({
  etapa,
  consultas,
}: {
  etapa: { etapa: string; detalhe?: string } | null;
  consultas: { id: string; titulo: string }[];
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed px-3 py-2 text-sm" role="status">
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {ETAPAS[etapa?.etapa ?? "classificando"] ?? "Trabalhando"}…
      </p>
      {consultas.length > 0 && (
        <ul className="space-y-0.5 pl-6 text-[13px] text-muted-foreground">
          {consultas.map((c) => (
            <li key={c.id}>✓ {c.titulo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SELO: Partial<Record<RespostaFinal["estado"], { tom: "atencao" | "perigo" | "info" | "neutro"; texto: string }>> = {
  erro: { tom: "perigo", texto: "Sem resposta" },
  cancelada: { tom: "neutro", texto: "Cancelada" },
  sem_orcamento: { tom: "atencao", texto: "IA pausada" },
  esclarecimento: { tom: "info", texto: "Preciso saber" },
  fora_do_escopo: { tom: "neutro", texto: "Fora do escopo" },
  salva: { tom: "info", texto: "Visão salva" },
};

function TurnoAssistente({
  m,
  selecionado,
  emCurso,
  etapa,
  aoSelecionar,
  aoPerguntar,
}: {
  m: UIMessage;
  selecionado: boolean;
  emCurso: boolean;
  etapa: { etapa: string; detalhe?: string } | null;
  aoSelecionar: () => void;
  aoPerguntar: (t: string) => void;
}) {
  const r = respostaDe(m);
  const consultas = consultasDe(m);
  if (!r) return emCurso ? <Progresso etapa={etapa} consultas={consultas} /> : null;
  const selo = SELO[r.estado];
  const temVisao = !!r.definicao;
  return (
    <article
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2.5",
        selecionado ? "border-input bg-muted/30" : "border-transparent",
      )}
    >
      {selo && <StatusBadge tom={selo.tom}>{selo.texto}</StatusBadge>}
      <p className="text-[15px] leading-relaxed">{r.conclusao}</p>
      {r.opcoes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.opcoes.map((o) => (
            <Button key={o} size="sm" variant="outline" onClick={() => aoPerguntar(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        {temVisao && (
          <button
            type="button"
            onClick={aoSelecionar}
            className="font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selecionado ? "Na área visual" : "Mostrar a visão"}
          </button>
        )}
        {r.consultas.length > 0 && <span>{r.consultas.length} consulta{r.consultas.length > 1 ? "s" : ""}</span>}
        {r.historico && r.criadaEm && <span>respondido em {hora(r.criadaEm)}</span>}
        {r.descartadas.length > 0 && (
          <span title={r.descartadas.join("\n")}>
            {r.descartadas.length} frase{r.descartadas.length > 1 ? "s" : ""} retirada
            {r.descartadas.length > 1 ? "s" : ""} por não conferir com os dados
          </span>
        )}
      </div>
      {r.proximas.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {r.proximas.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => aoPerguntar(p)}
              className="rounded-full border px-3 py-1 text-[13px] transition-colors duration-[120ms] hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function BarraConversa({
  conversaId,
  aoAbrir,
  aoNova,
  ocupado,
}: {
  conversaId: string | null;
  aoAbrir: (id: string) => void;
  aoNova: () => void;
  ocupado: boolean;
}) {
  const qc = useQueryClient();
  const listarFn = useServerFn(listarConversas);
  const excluirFn = useServerFn(excluirConversa);
  const lista = useQuery({ queryKey: ["cockpit-conversa", "lista"], queryFn: () => listarFn(), staleTime: 30_000 });
  const [apagar, setApagar] = useState<{ id: string; titulo: string } | null>(null);
  const atual = lista.data?.find((c) => c.id === conversaId);
  return (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 max-w-[70%] justify-start" disabled={ocupado}>
            <History className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{atual?.titulo ?? (conversaId ? "Conversa" : "Nova conversa")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel>Suas conversas (só você vê)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {lista.isLoading && <DropdownMenuItem disabled>Carregando…</DropdownMenuItem>}
          {lista.data?.length === 0 && <DropdownMenuItem disabled>Nenhuma conversa ainda.</DropdownMenuItem>}
          {lista.data?.map((c) => (
            <DropdownMenuItem key={c.id} className="flex items-start justify-between gap-2" onSelect={() => aoAbrir(c.id)}>
              <span className="min-w-0">
                <span className="block truncate">{c.titulo}</span>
                <span className="text-xs text-muted-foreground">{hora(c.atualizada_em)}</span>
              </span>
              <button
                type="button"
                aria-label={`Excluir a conversa ${c.titulo}`}
                className="rounded p-1 text-muted-foreground hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setApagar({ id: c.id, titulo: c.titulo });
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={aoNova} disabled={ocupado}>
        <MessageSquarePlus className="size-4" aria-hidden /> Nova conversa
      </Button>
      <AlertDialog open={!!apagar} onOpenChange={(o) => !o && setApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              “{apagar?.titulo}” e as mensagens dela somem do seu histórico. Visões salvas a partir
              dela continuam salvas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!apagar) return;
                try {
                  await excluirFn({ data: { id: apagar.id } });
                  toast.success("Conversa excluída.");
                  if (apagar.id === conversaId) aoNova();
                  qc.invalidateQueries({ queryKey: ["cockpit-conversa", "lista"] });
                } catch {
                  toast.error("Não foi possível excluir.");
                }
                setApagar(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PERIODOS: { chave: string; rotulo: string; valor: PeriodoFiltro }[] = [
  { chave: "mes", rotulo: "Mês atual", valor: { tipo: "mes" } },
  { chave: "mes_anterior", rotulo: "Mês anterior", valor: { tipo: "mes_anterior" } },
  { chave: "u3", rotulo: "Últimos 3 meses fechados", valor: { tipo: "ultimos_meses", meses: 3 } },
  { chave: "u6", rotulo: "Últimos 6 meses fechados", valor: { tipo: "ultimos_meses", meses: 6 } },
  { chave: "u12", rotulo: "Últimos 12 meses fechados", valor: { tipo: "ultimos_meses", meses: 12 } },
  { chave: "trimestre", rotulo: "Trimestre atual", valor: { tipo: "trimestre" } },
  { chave: "ano", rotulo: "Ano atual", valor: { tipo: "ano" } },
];
const chaveDoPeriodo = (p?: PeriodoFiltro) =>
  !p ? "" : p.tipo === "ultimos_meses" ? `u${p.meses ?? 6}` : p.tipo === "intervalo" ? "intervalo" : p.tipo;

function Controles({
  definicao,
  filtros,
  aoMudar,
  desabilitado,
}: {
  definicao: VisaoDefinicao;
  filtros: Filtros;
  aoMudar: (f: Filtros) => void;
  desabilitado: boolean;
}) {
  const aceitas = new Set(definicao.blocos.flatMap((b) => chavesDeFiltro(b.consulta.nome)));
  const [novaUnidade, setNovaUnidade] = useState("");
  if (!aceitas.size) return null;
  const unidades = filtros.unidades ?? [];
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 px-3 py-2.5" role="group" aria-label="Filtros da visão">
      {aceitas.has("periodo") && (
        <Campo rotulo="Período">
          <Select
            disabled={desabilitado}
            value={chaveDoPeriodo(filtros.periodo) || "padrao"}
            onValueChange={(v) => aoMudar({ periodo: PERIODOS.find((p) => p.chave === v)?.valor })}
          >
            <SelectTrigger className="h-8 w-[13.5rem]" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!filtros.periodo && <SelectItem value="padrao">Padrão da consulta</SelectItem>}
              {filtros.periodo?.tipo === "intervalo" && <SelectItem value="intervalo">Intervalo da pergunta</SelectItem>}
              {PERIODOS.map((p) => (
                <SelectItem key={p.chave} value={p.chave}>
                  {p.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      )}
      {aceitas.has("leitura") && (
        <Campo rotulo="Leitura">
          <Select
            disabled={desabilitado}
            value={filtros.leitura ?? "grupo"}
            onValueChange={(v) => aoMudar({ leitura: v as Filtros["leitura"] })}
          >
            <SelectTrigger className="h-8 w-[14rem]" aria-label="Leitura do faturamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_LEITURA) as (keyof typeof ROTULO_LEITURA)[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ROTULO_LEITURA[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      )}
      {aceitas.has("base") && (
        <Campo rotulo="Base">
          <Select
            disabled={desabilitado}
            value={filtros.base ?? "todas"}
            onValueChange={(v) => aoMudar({ base: v as Filtros["base"] })}
          >
            <SelectTrigger className="h-8 w-[11rem]" aria-label="Base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_BASE) as (keyof typeof ROTULO_BASE)[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ROTULO_BASE[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      )}
      {aceitas.has("produto") && (
        <Campo rotulo="Produto">
          <Select
            disabled={desabilitado}
            value={filtros.produto ?? "todos"}
            onValueChange={(v) => aoMudar({ produto: v === "todos" ? undefined : (v as Filtros["produto"]) })}
          >
            <SelectTrigger className="h-8 w-[10rem]" aria-label="Produto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(Object.keys(ROTULO_PRODUTO) as (keyof typeof ROTULO_PRODUTO)[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ROTULO_PRODUTO[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      )}
      {aceitas.has("unidades") && (
        <Campo rotulo="Unidades">
          <div className="flex flex-wrap items-center gap-1.5">
            {unidades.map((u) => (
              <span key={u} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[13px]">
                {u}
                <button
                  type="button"
                  disabled={desabilitado}
                  aria-label={`Tirar ${u}`}
                  onClick={() => {
                    const resto = unidades.filter((x) => x !== u);
                    aoMudar({ unidades: resto.length ? resto : undefined });
                  }}
                  className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const u = novaUnidade.trim();
                if (!u || unidades.length >= 8) return;
                setNovaUnidade("");
                aoMudar({ unidades: [...unidades, u] });
              }}
            >
              <Input
                value={novaUnidade}
                disabled={desabilitado || unidades.length >= 8}
                onChange={(e) => setNovaUnidade(e.target.value)}
                placeholder={unidades.length ? "+ unidade" : "Todas · + unidade"}
                aria-label="Acrescentar unidade"
                className="h-8 w-[9rem]"
              />
            </form>
          </div>
        </Campo>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      {children}
    </div>
  );
}

function AreaVisual({
  painel,
  conversaId,
  aoMudarFiltros,
  aoAbrirSalva,
  aoPerguntar,
  ocupado,
}: {
  painel: PainelVisual;
  conversaId: string | null;
  aoMudarFiltros: (f: Filtros) => void;
  aoAbrirSalva: (id: string) => void;
  aoPerguntar: (t: string) => void;
  ocupado: boolean;
}) {
  const qc = useQueryClient();
  const listarFn = useServerFn(listarVisoes);
  const salvarFn = useServerFn(salvarVisao);
  const renomearFn = useServerFn(renomearVisao);
  const excluirFn = useServerFn(excluirVisao);
  const visoes = useQuery({ queryKey: ["cockpit-conversa", "visoes"], queryFn: () => listarFn(), staleTime: 30_000 });
  const [dialogo, setDialogo] = useState<null | { modo: "salvar" } | { modo: "renomear"; id: string; nome: string }>(null);
  const [nome, setNome] = useState("");
  const [apagar, setApagar] = useState<{ id: string; nome: string } | null>(null);
  const d = painel.definicao;

  const confirmarNome = async () => {
    const n = nome.trim();
    if (!n || !dialogo) return;
    try {
      if (dialogo.modo === "salvar" && d) {
        await salvarFn({ data: { nome: n, definicao: d, conversaId } });
        toast.success(`Visão salva como “${n}”. Ao abrir, os números são consultados de novo.`);
      } else if (dialogo.modo === "renomear") {
        await renomearFn({ data: { id: dialogo.id, nome: n } });
        toast.success("Visão renomeada.");
      }
      qc.invalidateQueries({ queryKey: ["cockpit-conversa", "visoes"] });
      setDialogo(null);
    } catch {
      toast.error("Não foi possível gravar a visão.");
    }
  };

  const origem =
    painel.origem === "salva"
      ? `Visão salva “${painel.nome}” · consultada agora`
      : painel.origem === "historico"
        ? "Do histórico · números consultados agora"
        : painel.origem === "controles"
          ? "Filtros alterados · consultado agora"
          : "Resposta desta conversa";

  return (
    <section aria-label="Área visual" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{d?.titulo ?? "Área visual"}</h2>
          {d && (
            <p className="text-[13px] text-muted-foreground">
              {origem}
              {painel.consultadoEm ? ` · ${hora(painel.consultadoEm)}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Bookmark className="size-4" aria-hidden /> Visões salvas
                {visoes.data?.length ? <span className="num text-muted-foreground">({visoes.data.length})</span> : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Suas visões (só você vê)</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {visoes.data?.length === 0 && <DropdownMenuItem disabled>Nenhuma visão salva.</DropdownMenuItem>}
              {visoes.data?.map((v) => (
                <DropdownMenuItem key={v.id} className="flex items-center justify-between gap-2" onSelect={() => aoAbrirSalva(v.id)}>
                  <span className="min-w-0">
                    <span className="block truncate">{v.nome}</span>
                    <span className="text-xs text-muted-foreground">salva em {hora(v.atualizada_em)}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Renomear ${v.nome}`}
                      className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setNome(v.nome);
                        setDialogo({ modo: "renomear", id: v.id, nome: v.nome });
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir ${v.nome}`}
                      className="rounded p-1 text-muted-foreground hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setApagar({ id: v.id, nome: v.nome });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            disabled={!d || painel.carregando}
            onClick={() => {
              setNome(d?.titulo ?? "");
              setDialogo({ modo: "salvar" });
            }}
          >
            Salvar visão
          </Button>
        </div>
      </div>

      {d && <Controles definicao={d} filtros={painel.filtros} aoMudar={aoMudarFiltros} desabilitado={!!painel.carregando || ocupado} />}

      {painel.erro && <EstadoErro titulo="A visão não abriu" detalhe={painel.erro} />}
      {painel.carregando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Consultando com o seu acesso…
        </p>
      )}
      {!d && !painel.carregando && !painel.erro && (
        <EstadoVazio
          titulo="A resposta aparece aqui"
          descricao="Cada gráfico vem de uma consulta às fontes do cockpit, com a data e a fonte ao pé."
          acao={
            <Button variant="outline" size="sm" onClick={() => aoPerguntar(SUGESTOES[0])} disabled={ocupado}>
              {SUGESTOES[0]}
            </Button>
          }
        />
      )}
      {d && painel.blocos.length > 0 && (
        <div className={cn("grid gap-3 xl:grid-cols-2", painel.carregando && "opacity-60")}>
          {painel.blocos.map((b) => (
            <div
              key={b.id}
              className={cn(
                ["serie", "ponte", "tabela", "coorte", "acoes"].includes(b.tipo) || painel.blocos.length === 1
                  ? "xl:col-span-2"
                  : undefined,
              )}
            >
              <Bloco bloco={b} />
            </div>
          ))}
        </div>
      )}
      {d && (
        <Procedencia
          fonte="Mesmas fontes e regras do Cockpit do CEO, com o seu acesso"
          atualizadoEm={painel.consultadoEm}
          regua="salvar guarda a definição, não os números"
        />
      )}

      <Dialog open={!!dialogo} onOpenChange={(o) => !o && setDialogo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogo?.modo === "renomear" ? "Renomear visão" : "Salvar visão"}</DialogTitle>
            <DialogDescription>
              Guarda as consultas e os filtros. Ao abrir, os números são consultados de novo com o
              seu acesso daquele momento.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmarNome();
            }}
            className="space-y-2"
          >
            <Label htmlFor="nome-visao">Nome</Label>
            <Input id="nome-visao" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} autoFocus />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!nome.trim()}>
                {dialogo?.modo === "renomear" ? "Renomear" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!apagar} onOpenChange={(o) => !o && setApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a visão?</AlertDialogTitle>
            <AlertDialogDescription>“{apagar?.nome}” deixa de existir para você.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!apagar) return;
                try {
                  await excluirFn({ data: { id: apagar.id } });
                  toast.success("Visão excluída.");
                  qc.invalidateQueries({ queryKey: ["cockpit-conversa", "visoes"] });
                } catch {
                  toast.error("Não foi possível excluir.");
                }
                setApagar(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
