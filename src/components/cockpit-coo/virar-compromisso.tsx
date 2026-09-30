import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { criarCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import { verificarDuplicidade } from "@/lib/cockpit-coo/triagem.functions";
import type { OpcoesCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import { ORDEM_TEMAS, TEMAS } from "@/lib/cockpit-coo/contrato";
import type { AlertaCoo, Tema } from "@/lib/cockpit-coo/contrato";
import { proximaReuniao } from "@/lib/cockpit-coo/escrita";

// "Virar compromisso": o alerta vira tarefa no ClickUp com dono único, prazo, tema e unidade, e a
// chave do alerta no campo "Origem no Brain" (é ela que impede a mesma tarefa duas vezes).
// Prazo padrão: a próxima reunião do mesmo tema.

export function VirarCompromisso({
  alerta,
  tema,
  hoje,
  opcoes,
  onFechar,
}: {
  alerta: AlertaCoo | null;
  tema: Tema;
  hoje: string;
  opcoes: OpcoesCompromisso | undefined;
  onFechar: () => void;
}) {
  const client = useQueryClient();
  const criar = useServerFn(criarCompromisso);
  const conferir = useServerFn(verificarDuplicidade);
  // Aviso de duplicidade (Jev): não impede criar; a pessoa confirma "criar mesmo assim".
  const [parecida, setParecida] = useState<{ nome: string; url?: string } | null>(null);
  const [conferido, setConferido] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [dono, setDono] = useState("");
  const [prazo, setPrazo] = useState("");
  const [temaEscolhido, setTema] = useState<Tema>(tema);
  const [unidade, setUnidade] = useState("Rede");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alerta) return;
    setTitulo(alerta.titulo);
    setDono("");
    setPrazo(proximaReuniao(tema, hoje));
    setTema(tema);
    setUnidade(alerta.unidade ?? "Rede");
    setErro(null);
    setParecida(null);
    setConferido(false);
  }, [alerta, tema, hoje]);

  const m = useMutation({
    mutationFn: async () => {
      if (!conferido) {
        setConferido(true);
        const r = await conferir({ data: { titulo, tema: temaEscolhido } }).catch(() => ({ parecida: null }));
        if (r.parecida) {
          setParecida(r.parecida);
          return { ok: false, mensagem: "", aguardando: true } as const;
        }
      }
      return criar({
        data: {
          titulo,
          contexto: alerta ? `${alerta.titulo}\nRegra: ${alerta.limiar}` : undefined,
          donoId: Number(dono),
          prazo,
          tema: temaEscolhido,
          unidade,
          chaveAlerta: alerta?.chave ?? null,
          linkBrain: typeof window !== "undefined" ? window.location.href : null,
        },
      });
    },
    onSuccess: (r) => {
      if ("aguardando" in r) return;
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      toast.success(r.mensagem);
      client.invalidateQueries({ queryKey: ["cockpit-coo", "base"] });
      onFechar();
    },
    onError: (e) => setErro((e as Error).message),
  });

  const conectado = !!opcoes?.conectado;
  return (
    <Dialog open={!!alerta} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Virar compromisso</DialogTitle>
          <DialogDescription>
            Cria uma tarefa na lista Compromissos da rotina do ClickUp, com um dono e um prazo. Ela volta para a
            pauta de {TEMAS[temaEscolhido].diaRotulo.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>
        {!conectado ? (
          <p className="text-sm text-muted-foreground">{opcoes?.motivo ?? "Carregando o ClickUp…"}</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setErro(null);
              m.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="coo-titulo">O que precisa ser feito</Label>
              <Input id="coo-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="coo-dono">Dono</Label>
                <Select value={dono} onValueChange={setDono}>
                  <SelectTrigger id="coo-dono">
                    <SelectValue placeholder="Escolha uma pessoa" />
                  </SelectTrigger>
                  <SelectContent>
                    {(opcoes?.membros ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.username ?? p.email ?? p.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="coo-prazo">Prazo</Label>
                <Input id="coo-prazo" type="date" min={hoje} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="coo-tema">Tema da rotina</Label>
                <Select value={temaEscolhido} onValueChange={(v) => setTema(v as Tema)}>
                  <SelectTrigger id="coo-tema">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDEM_TEMAS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TEMAS[t].menu}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="coo-unidade">Unidade</Label>
                <Select value={unidade} onValueChange={setUnidade}>
                  <SelectTrigger id="coo-unidade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(opcoes?.unidades ?? ["Rede"]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {parecida && (
              <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
                Parece já existir um compromisso aberto sobre isso:{" "}
                {parecida.url ? (
                  <a href={parecida.url} target="_blank" rel="noreferrer" className="underline">
                    {parecida.nome}
                  </a>
                ) : (
                  parecida.nome
                )}
                . Se for outra coisa, clique em criar de novo.
              </p>
            )}
            {erro && <p className="text-sm text-danger">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={m.isPending || !dono || !prazo || !titulo.trim()}>
                {m.isPending ? "Criando…" : parecida ? "Criar mesmo assim" : "Criar no ClickUp"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
