import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardCheck, Send } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import {
  enviarAvd,
  liberarAvd360,
  listAvd,
  ROTULO_FORMULARIO,
  type EnviarAvdResult,
  type FormularioAvd,
} from "@/lib/gente-avd.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/planning";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BotaoComMotivo } from "./estados-gente";

// Avaliação de desempenho (AVD), decidida pelo RH da Expansão com o RH de Maceió em
// 29/10/2026. O RH escolhe o semestre, marca as pessoas e envia o 180° (autoavaliação e
// gestor) em lote. O 360° (mais pares e liderados) vai uma pessoa por vez e só na unidade
// que a Matriz liberou. Quem lidera alguém no cadastro recebe o formulário de Liderança;
// os demais, o de Colaboradores e especialistas. O RH pode trocar antes de enviar.

const TIPO_ROTULO: Record<string, string> = {
  gestor: "Gestor",
  auto: "Autoavaliação",
  par: "Par",
  liderado: "Liderado",
};

function semestres(): string[] {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const atual = hoje.getMonth() < 6 ? `1/${ano}` : `2/${ano}`;
  const anterior = hoje.getMonth() < 6 ? `2/${ano - 1}` : `1/${ano}`;
  const proximo = hoje.getMonth() < 6 ? `2/${ano}` : `1/${ano + 1}`;
  return [atual, proximo, anterior];
}

function avisarResultado(r: EnviarAvdResult) {
  const partes = [
    r.criadas
      ? `${r.criadas} avaliação(ões) enviada(s) para ${r.pessoas} pessoa(s)`
      : "Nada novo: essas avaliações já tinham sido enviadas",
    r.emailsEnviados ? `${r.emailsEnviados} aviso(s) por e-mail` : null,
  ].filter(Boolean);
  const avisos = [
    r.puladas.length
      ? `Ficaram de fora: ${r.puladas.map((p) => `${p.nome} (${p.motivo})`).join("; ")}.`
      : null,
    r.semLogin.length
      ? `Sem login ainda: ${r.semLogin.join(", ")}. A avaliação espera até a pessoa ganhar acesso.`
      : null,
  ].filter(Boolean);
  (r.criadas ? toast.success : toast.info)(`${partes.join(", ")}. ${avisos.join(" ")}`.trim(), {
    duration: avisos.length ? 20_000 : 5_000,
  });
}

function Envio360Dialog({
  pessoa,
  formulario,
  periodo,
  pessoas,
  aberto,
  aoFechar,
}: {
  pessoa: GentePessoaRow;
  formulario: FormularioAvd;
  periodo: string;
  pessoas: GentePessoaRow[];
  aberto: boolean;
  aoFechar: () => void;
}) {
  const fn = useServerFn(enviarAvd);
  const qc = useQueryClient();
  const time = pessoas.filter((x) => x.status === "ativo" && x.gestorId === pessoa.id);
  const colegas = pessoas.filter(
    (x) =>
      x.status === "ativo" &&
      x.id !== pessoa.id &&
      x.id !== pessoa.gestorId &&
      x.gestorId !== pessoa.id &&
      x.unidadeId === pessoa.unidadeId,
  );
  const [pares, setPares] = useState<number[]>([]);
  const [liderados, setLiderados] = useState<number[]>(() => time.map((t) => t.id));

  const enviar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          periodo,
          alcance: 360,
          envios: [{ pessoaId: pessoa.id, formulario }],
          pares,
          liderados,
        },
      }),
    onSuccess: (r) => {
      avisarResultado(r);
      aoFechar();
      qc.invalidateQueries({ queryKey: ["gente-avd"] });
      qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcar = (set: (f: (s: number[]) => number[]) => void, id: number) => (marcado: boolean) =>
    set((s) => (marcado ? [...s, id] : s.filter((x) => x !== id)));

  const lista = (
    titulo: string,
    gente: GentePessoaRow[],
    marcados: number[],
    set: (f: (s: number[]) => number[]) => void,
  ) => (
    <div className="grid gap-1.5">
      <Label>{titulo}</Label>
      <div className="max-h-40 overflow-auto rounded-md border p-2">
        {gente.length ? (
          gente.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={marcados.includes(c.id)}
                onChange={(e) => marcar(set, c.id)(e.target.checked)}
              />
              <span>{c.nomeCompleto}</span>
              {c.cargo ? (
                <span className="text-[13px] text-muted-foreground">{c.cargo}</span>
              ) : null}
              {!c.temLogin ? (
                <span className="text-[12px] text-muted-foreground">(sem login)</span>
              ) : null}
            </label>
          ))
        ) : (
          <p className="text-[13px] text-muted-foreground">Ninguém para escolher.</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={aberto} onOpenChange={(o) => (o ? null : aoFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AVD 360° de {pessoa.nomeCompleto}</DialogTitle>
          <DialogDescription>
            {ROTULO_FORMULARIO[formulario]} · {periodo}. Vão a autoavaliação, a do gestor e as dos
            colegas e liderados que você marcar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {time.length ? lista("Liderados que avaliam", time, liderados, setLiderados) : null}
          {lista("Pares que avaliam", colegas, pares, setPares)}
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <BotaoComMotivo
            onClick={() => enviar.mutate()}
            disabled={enviar.isPending || (!pares.length && !liderados.length)}
            motivo={[
              enviar.isPending && "Enviando…",
              !pares.length && !liderados.length && "Marque ao menos um par ou liderado.",
            ]}
          >
            {enviar.isPending ? "Enviando…" : "Enviar 360°"}
          </BotaoComMotivo>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AvdCard() {
  const opcoes = useMemo(semestres, []);
  const [periodo, setPeriodo] = useState(opcoes[0]);
  const genteFn = useServerFn(listGente);
  const avdFn = useServerFn(listAvd);
  const enviarFn = useServerFn(enviarAvd);
  const liberarFn = useServerFn(liberarAvd360);
  const qc = useQueryClient();
  const gente = useQuery({ queryKey: ["gente"], queryFn: () => genteFn(), staleTime: 60_000 });
  const avd = useQuery({
    queryKey: ["gente-avd", periodo],
    queryFn: () => avdFn({ data: { periodo } }),
  });
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [trocados, setTrocados] = useState<Record<number, FormularioAvd>>({});
  const [em360, setEm360] = useState<GentePessoaRow | null>(null);

  const pessoas = useMemo(() => gente.data?.pessoas ?? [], [gente.data]);
  const ativos = useMemo(
    () =>
      pessoas
        .filter((p) => p.status === "ativo" && p.unidadeId != null)
        .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR")),
    [pessoas],
  );
  const lideres = useMemo(
    () => new Set(pessoas.filter((p) => p.status === "ativo" && p.gestorId).map((p) => p.gestorId)),
    [pessoas],
  );
  const formularioDe = (p: GentePessoaRow): FormularioAvd =>
    avd.data?.envios[p.id]?.formulario ??
    trocados[p.id] ??
    (lideres.has(p.id) ? "avd_lider" : "avd_colab");

  const enviar180 = useMutation({
    mutationFn: () =>
      enviarFn({
        data: {
          periodo,
          alcance: 180,
          envios: [...selecionadas].map((id) => {
            const p = ativos.find((x) => x.id === id)!;
            return { pessoaId: id, formulario: formularioDe(p) };
          }),
        },
      }),
    onSuccess: (r) => {
      avisarResultado(r);
      setSelecionadas(new Set());
      qc.invalidateQueries({ queryKey: ["gente-avd"] });
      qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const liberar = useMutation({
    mutationFn: (v: { unidadeId: number; liberar: boolean }) => liberarFn({ data: v }),
    onSuccess: (_, v) => {
      toast.success(v.liberar ? "360° liberado para a unidade." : "360° travado para a unidade.");
      qc.invalidateQueries({ queryKey: ["gente-avd"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!avd.data?.podeEnviar) return null;
  const liberadas = new Set(avd.data.liberadas);
  const unidades = (gente.data?.unidades ?? [])
    .map((u) => ({ id: u.unidadeId, nome: u.unidade }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const todasMarcadas = ativos.length > 0 && ativos.every((p) => selecionadas.has(p.id));

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Avaliação de desempenho (AVD)</h3>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="avd-periodo" className="text-[13px] text-muted-foreground">
            Semestre
          </Label>
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger id="avd-periodo" className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Marque as pessoas e envie o 180°: autoavaliação e avaliação do gestor. O 360° (com pares e
        liderados) vai uma pessoa por vez e só na unidade liberada pela Matriz. Quem lidera alguém
        no cadastro recebe o formulário de Liderança. Todas as respostas pedem comentário. O
        resultado aparece nos ciclos abaixo, com o Liberar devolutiva.
      </p>

      {avd.data.podeLiberar360 && unidades.length ? (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">360° por unidade (só a Matriz libera)</p>
          <div className="flex flex-wrap gap-2">
            {unidades.map((u) => {
              const ok = liberadas.has(u.id);
              return (
                <Button
                  key={u.id}
                  size="sm"
                  variant={ok ? "default" : "outline"}
                  className="h-7 text-xs"
                  disabled={liberar.isPending}
                  onClick={() => liberar.mutate({ unidadeId: u.id, liberar: !ok })}
                >
                  {u.nome}: {ok ? "liberado (travar)" : "travado (liberar)"}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <BotaoComMotivo
          size="sm"
          onClick={() => enviar180.mutate()}
          disabled={enviar180.isPending || !selecionadas.size}
          motivo={[
            enviar180.isPending && "Enviando…",
            !selecionadas.size && "Marque ao menos uma pessoa na lista.",
          ]}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {enviar180.isPending
            ? "Enviando…"
            : `Enviar 180° (${selecionadas.size} selecionada${selecionadas.size === 1 ? "" : "s"})`}
        </BotaoComMotivo>
      </div>

      <div className="max-h-[480px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-0">
                <input
                  type="checkbox"
                  aria-label="Marcar todas"
                  checked={todasMarcadas}
                  onChange={(e) =>
                    setSelecionadas(e.target.checked ? new Set(ativos.map((p) => p.id)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>Pessoa</TableHead>
              <TableHead>Formulário</TableHead>
              <TableHead>Gestor</TableHead>
              <TableHead>Situação no semestre</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ativos.map((p) => {
              const envio = avd.data?.envios[p.id];
              const concluidas =
                envio?.avaliacoes.filter((a) => a.status === "concluida").length ?? 0;
              const liberada360 = p.unidadeId != null && liberadas.has(p.unidadeId);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Marcar ${p.nomeCompleto}`}
                      checked={selecionadas.has(p.id)}
                      onChange={(e) =>
                        setSelecionadas((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(p.id);
                          else n.delete(p.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{p.nomeCompleto}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {[p.cargo, p.unidade].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell>
                    {envio ? (
                      <span className="text-sm">{ROTULO_FORMULARIO[envio.formulario]}</span>
                    ) : (
                      <Select
                        value={formularioDe(p)}
                        onValueChange={(v) =>
                          setTrocados((t) => ({ ...t, [p.id]: v as FormularioAvd }))
                        }
                      >
                        <SelectTrigger className="h-8 w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="avd_colab">{ROTULO_FORMULARIO.avd_colab}</SelectItem>
                          <SelectItem value="avd_lider">{ROTULO_FORMULARIO.avd_lider}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.gestorNome ?? <span className="text-warning">sem gestor</span>}
                  </TableCell>
                  <TableCell>
                    {envio ? (
                      <div className="space-y-1">
                        <StatusBadge
                          tom={concluidas === envio.avaliacoes.length ? "sucesso" : "info"}
                        >
                          {concluidas} de {envio.avaliacoes.length} respondidas
                        </StatusBadge>
                        <div className="text-[12px] text-muted-foreground">
                          {envio.avaliacoes
                            .map(
                              (a) =>
                                `${TIPO_ROTULO[a.tipo] ?? a.tipo}${a.tipo === "auto" ? "" : `: ${a.avaliadorNome ?? "?"}`}${a.status === "concluida" ? " ✓" : ""}`,
                            )
                            .join(" · ")}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">não enviada</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <BotaoComMotivo
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEm360(p)}
                      disabled={!liberada360 || !p.gestorId}
                      motivo={[
                        !liberada360 && "O 360° precisa da liberação da Matriz para esta unidade.",
                        !p.gestorId && "Defina o gestor no Cadastro antes.",
                      ]}
                    >
                      360°
                    </BotaoComMotivo>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {em360 ? (
        <Envio360Dialog
          key={em360.id}
          pessoa={em360}
          formulario={formularioDe(em360)}
          periodo={periodo}
          pessoas={pessoas}
          aberto
          aoFechar={() => setEm360(null)}
        />
      ) : null}
    </Card>
  );
}
