import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertOctagon, CheckCircle2, ExternalLink, Sparkles, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EstadoVazio, KpiCard, KpiGrade, PageHeader, Procedencia, StatusBadge } from "@/components/planning";
import { ORDEM_TEMAS, TEMAS } from "@/lib/cockpit-coo/contrato";
import type { Tema } from "@/lib/cockpit-coo/contrato";
import { higiene, ordenarFila, revisaoDaSemana, taxaNoPrazo } from "@/lib/cockpit-coo/compromissos";
import type { Compromisso } from "@/lib/cockpit-coo/compromissos";
import { atualizarCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import type { AcaoCompromisso, OpcoesCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import type { SugestaoCoo } from "@/lib/cockpit-coo/triagem";
import { cn } from "@/lib/utils";

// Compromissos do COO (arquétipo Fila de trabalho, contrato docs/design/contratos/cockpit-coo.md).
// A ordem é a de trabalho (N5): vencidos primeiro, depois pelo prazo, sem prazo por último. Clicar
// na linha abre a ficha em `Sheet`, sem trocar de rota, com as ações que gravam no ClickUp.

export type Higiene = "sem-dono" | "sem-prazo" | "vencidos" | "parados" | "sem-tema" | "bloqueados";

export interface BuscaCompromissos {
  tema?: Tema;
  dono?: string;
  unidade?: string;
  status?: "abertos" | "concluidos" | "todos";
  higiene?: Higiene;
  tarefa?: string;
}

const dataBr = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";

export function CompromissosPagina({
  hoje,
  compromissos,
  sugestoes,
  conectado,
  motivo,
  sincronizadoEm,
  busca,
  aoMudar,
  opcoes,
  pedirOpcoes,
  confirmarSugestao,
}: {
  hoje: string;
  compromissos: Compromisso[];
  sugestoes: SugestaoCoo[];
  conectado: boolean;
  motivo: string | null;
  sincronizadoEm: string | null;
  busca: BuscaCompromissos;
  aoMudar: (p: Partial<BuscaCompromissos>) => void;
  opcoes: OpcoesCompromisso | undefined;
  pedirOpcoes: () => void;
  confirmarSugestao: (s: SugestaoCoo, aceitar: boolean) => void;
}) {
  const status = busca.status ?? "abertos";
  const bloqueadas = useMemo(
    () => new Set(sugestoes.filter((s) => s.pergunta === "bloqueio" && s.resposta === "true" && s.estado === "pendente").map((s) => s.tarefa_id)),
    [sugestoes],
  );
  const h = useMemo(() => higiene(compromissos), [compromissos]);
  const revisao = useMemo(() => revisaoDaSemana(compromissos, hoje), [compromissos, hoje]);
  const taxa = taxaNoPrazo(revisao);
  const donos = useMemo(
    () => [...new Map(compromissos.filter((c) => c.dono).map((c) => [c.dono!.id, c.dono!.nome ?? c.dono!.id])).entries()],
    [compromissos],
  );
  const unidades = useMemo(() => [...new Set(compromissos.map((c) => c.unidade).filter((u): u is string => !!u))].sort(), [compromissos]);

  const fila = useMemo(() => {
    let l = compromissos;
    if (status === "abertos") l = l.filter((c) => !c.concluida);
    if (status === "concluidos") l = l.filter((c) => c.concluida);
    if (busca.tema) l = l.filter((c) => c.tema === busca.tema);
    if (busca.dono) l = l.filter((c) => c.dono?.id === busca.dono);
    if (busca.unidade) l = l.filter((c) => c.unidade === busca.unidade);
    switch (busca.higiene) {
      case "sem-dono": l = l.filter((c) => !c.concluida && !c.dono); break;
      case "sem-prazo": l = l.filter((c) => !c.concluida && !c.prazo); break;
      case "vencidos": l = l.filter((c) => c.vencido); break;
      case "parados": l = l.filter((c) => c.parado); break;
      case "sem-tema": l = l.filter((c) => !c.concluida && !c.tema); break;
      case "bloqueados": l = l.filter((c) => !c.concluida && bloqueadas.has(c.id)); break;
    }
    return ordenarFila(l);
  }, [compromissos, status, busca.tema, busca.dono, busca.unidade, busca.higiene, bloqueadas]);

  const aberta = compromissos.find((c) => c.id === busca.tarefa) ?? null;

  const faixa: { chave: Higiene; rotulo: string; n: number }[] = [
    { chave: "vencidos", rotulo: "Vencidos", n: h.vencidos },
    { chave: "sem-dono", rotulo: "Sem dono", n: h.semDono },
    { chave: "sem-prazo", rotulo: "Sem prazo", n: h.semPrazo },
    { chave: "parados", rotulo: "Parados há 7 dias", n: h.parados },
    { chave: "sem-tema", rotulo: "Sem tema", n: h.semTema },
    { chave: "bloqueados", rotulo: "Possivelmente travados", n: bloqueadas.size },
  ];

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_coo"
        titulo="Compromissos"
        pergunta="O que foi combinado nas reuniões, quem está devendo e o que vence esta semana?"
        descricao="Tarefas da pasta Rotina Semanal do ClickUp · um dono e um prazo por compromisso"
      />

      {!conectado && (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <Unplug className="size-4 shrink-0" aria-hidden />
          {motivo}
        </p>
      )}

      <KpiGrade colunas={4}>
        <KpiCard area="cockpit_coo" rotulo="Abertos" valor={conectado ? String(compromissos.filter((c) => !c.concluida).length) : "—"} estado={conectado ? "ok" : "nao-apurado"} nota={conectado ? "na Rotina Semanal" : "ClickUp desconectado"} />
        <KpiCard area="cockpit_coo" rotulo="Vencidos" valor={conectado ? String(h.vencidos) : "—"} estado={conectado ? "ok" : "nao-apurado"} tom={h.vencidos ? "perigo" : undefined} nota="prazo passado e ainda aberto" />
        <KpiCard
          area="cockpit_coo"
          rotulo="Cumpridos no prazo (semana)"
          valor={taxa == null ? "—" : `${Math.round(taxa)}%`}
          estado={taxa == null ? "nao-apurado" : "ok"}
          nota={taxa == null ? "nenhum prazo nesta semana" : "dos que vencem de segunda a domingo"}
        />
        <KpiCard
          area="cockpit_coo"
          rotulo="Prazos empurrados"
          valor={conectado ? String(compromissos.filter((c) => !c.concluida && c.adiamentos > 0).length) : "—"}
          estado={conectado ? "ok" : "nao-apurado"}
          nota="abertos com o prazo adiado ao menos uma vez"
        />
      </KpiGrade>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Higiene da fila">
        {faixa.map((f) => (
          <Button
            key={f.chave}
            size="sm"
            variant={busca.higiene === f.chave ? "default" : "outline"}
            aria-pressed={busca.higiene === f.chave}
            onClick={() => aoMudar({ higiene: busca.higiene === f.chave ? undefined : f.chave })}
          >
            {f.chave === "bloqueados" && <Sparkles className="mr-1 size-3.5" aria-hidden />}
            {f.rotulo} ({f.n})
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => aoMudar({ status: v as BuscaCompromissos["status"] })}>
          <SelectTrigger className="h-8 w-40" aria-label="Situação"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="abertos">Abertos</SelectItem>
            <SelectItem value="concluidos">Concluídos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={busca.tema ?? "__todos"} onValueChange={(v) => aoMudar({ tema: v === "__todos" ? undefined : (v as Tema) })}>
          <SelectTrigger className="h-8 w-56" aria-label="Tema"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos">Todos os temas</SelectItem>
            {ORDEM_TEMAS.map((t) => <SelectItem key={t} value={t}>{TEMAS[t].menu}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={busca.dono ?? "__todos"} onValueChange={(v) => aoMudar({ dono: v === "__todos" ? undefined : v })}>
          <SelectTrigger className="h-8 w-48" aria-label="Dono"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos">Todos os donos</SelectItem>
            {donos.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={busca.unidade ?? "__todas"} onValueChange={(v) => aoMudar({ unidade: v === "__todas" ? undefined : v })}>
          <SelectTrigger className="h-8 w-48" aria-label="Unidade"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas">Todas as unidades</SelectItem>
            {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        {(busca.tema || busca.dono || busca.unidade || busca.higiene || status !== "abertos") && (
          <Button size="sm" variant="ghost" onClick={() => aoMudar({ tema: undefined, dono: undefined, unidade: undefined, higiene: undefined, status: undefined })}>
            Limpar
          </Button>
        )}
      </div>

      {fila.length === 0 ? (
        <EstadoVazio
          titulo={conectado ? "Nenhum compromisso neste recorte" : "Sem compromissos para mostrar"}
          descricao={conectado ? "Os compromissos nascem no botão \"Virar compromisso\" de cada alerta, ou direto na Rotina Semanal do ClickUp." : motivo ?? undefined}
          total={compromissos.length}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compromisso</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Tema</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fila.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => { pedirOpcoes(); aoMudar({ tarefa: c.id }); }}>
                  <TableCell className="max-w-[420px]">
                    <span className="flex items-center gap-2">
                      {c.vencido && <AlertOctagon className="size-4 shrink-0 text-danger" aria-label="vencido" />}
                      {c.concluida && <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="concluído" />}
                      <span className="truncate">{c.nome}</span>
                    </span>
                  </TableCell>
                  <TableCell className={cn(!c.dono && "text-danger")}>{c.dono?.nome ?? "sem dono"}{c.outrosDonos ? ` +${c.outrosDonos}` : ""}</TableCell>
                  <TableCell className={cn("num", c.vencido && "text-danger")}>
                    {dataBr(c.prazo)}{c.adiamentos ? ` · adiado ${c.adiamentos}×` : ""}
                  </TableCell>
                  <TableCell>{c.tema ? TEMAS[c.tema].diaRotulo : <span className="text-muted-foreground">sem tema</span>}</TableCell>
                  <TableCell>{c.unidade ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <StatusBadge tom={c.concluida ? "sucesso" : c.vencido ? "perigo" : c.parado ? "atencao" : "neutro"}>
                      {c.status}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Procedencia fonte="ClickUp · espelho do Brain a cada 10 minutos" atualizadoEm={sincronizadoEm} />

      <Ficha
        c={aberta}
        hoje={hoje}
        opcoes={opcoes}
        conectado={conectado}
        sugestoes={sugestoes.filter((s) => s.tarefa_id === aberta?.id)}
        confirmarSugestao={confirmarSugestao}
        onFechar={() => aoMudar({ tarefa: undefined })}
      />
    </main>
  );
}

function Ficha({
  c,
  hoje,
  opcoes,
  conectado,
  sugestoes,
  confirmarSugestao,
  onFechar,
}: {
  c: Compromisso | null;
  hoje: string;
  opcoes: OpcoesCompromisso | undefined;
  conectado: boolean;
  sugestoes: SugestaoCoo[];
  confirmarSugestao: (s: SugestaoCoo, aceitar: boolean) => void;
  onFechar: () => void;
}) {
  const client = useQueryClient();
  const fn = useServerFn(atualizarCompromisso);
  const [prazo, setPrazo] = useState("");
  const [dono, setDono] = useState("");
  const [comentario, setComentario] = useState("");
  const m = useMutation({
    mutationFn: (a: AcaoCompromisso) => fn({ data: a }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(r.mensagem);
        setComentario("");
        client.invalidateQueries({ queryKey: ["cockpit-coo", "base"] });
      } else toast.error(r.mensagem);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const semEscrita = !conectado ? "O ClickUp não está conectado." : null;
  const pendentes = sugestoes.filter((s) => s.estado === "pendente" && s.pergunta !== "bloqueio");
  const travada = sugestoes.find((s) => s.pergunta === "bloqueio" && s.resposta === "true" && s.estado === "pendente");
  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {c && (
          <>
            <SheetHeader>
              <SheetTitle>{c.nome}</SheetTitle>
              <SheetDescription>
                {c.status} · {c.dono?.nome ?? "sem dono"} · prazo {dataBr(c.prazo)}
                {c.adiamentos ? ` · adiado ${c.adiamentos}×` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5 text-sm">
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
                <dt className="text-muted-foreground">Tema</dt><dd>{c.tema ? TEMAS[c.tema].menu : c.temaTexto ?? "sem tema"}</dd>
                <dt className="text-muted-foreground">Unidade</dt><dd>{c.unidade ?? "—"}</dd>
                <dt className="text-muted-foreground">Criado em</dt><dd>{dataBr(c.criadaEm)}</dd>
                <dt className="text-muted-foreground">Última mudança</dt><dd>{dataBr(c.atualizadaEm)}</dd>
                {c.origem && (<><dt className="text-muted-foreground">Alerta de origem</dt><dd className="break-all font-mono">{c.origem}</dd></>)}
              </dl>
              <Button asChild size="sm" variant="outline">
                <a href={c.url} target="_blank" rel="noreferrer">Abrir no ClickUp <ExternalLink className="ml-1 size-3.5" aria-hidden /></a>
              </Button>

              {(pendentes.length > 0 || travada) && (
                <section className="space-y-2 rounded-lg border p-3">
                  <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="size-3.5" aria-hidden /> Sugestões do assistente
                  </h3>
                  {travada && <p className="text-xs">Pelos comentários, parece estar esperando outra pessoa ou área.</p>}
                  {pendentes.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>{s.pergunta === "tema" ? "Tema" : s.pergunta === "unidade" ? "Unidade" : "Duplicado de"}: <b>{s.rotulo}</b> {s.confianca != null && <span className="text-muted-foreground">(confiança {Math.round(s.confianca * 100)}%)</span>}</span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={!!semEscrita} onClick={() => confirmarSugestao(s, true)}>Confirmar</Button>
                        <Button size="sm" variant="ghost" onClick={() => confirmarSugestao(s, false)}>Descartar</Button>
                      </span>
                    </div>
                  ))}
                </section>
              )}

              {!c.concluida && (
                <section className="space-y-3">
                  <Button disabled={!!semEscrita || m.isPending} onClick={() => m.mutate({ tarefaId: c.id, acao: "concluir" })} title={semEscrita ?? undefined}>
                    <CheckCircle2 className="mr-1 size-4" aria-hidden /> Concluir
                  </Button>
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="coo-novo-prazo">Novo prazo</Label>
                      <Input id="coo-novo-prazo" type="date" min={hoje} value={prazo} onChange={(e) => setPrazo(e.target.value)} className="h-8" />
                    </div>
                    <Button size="sm" variant="outline" disabled={!!semEscrita || !prazo || m.isPending} onClick={() => m.mutate({ tarefaId: c.id, acao: "prazo", prazo })}>Mudar prazo</Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor="coo-novo-dono">Novo dono</Label>
                      <Select value={dono} onValueChange={setDono}>
                        <SelectTrigger id="coo-novo-dono" className="h-8"><SelectValue placeholder={opcoes?.conectado ? "Escolha" : "Carregando…"} /></SelectTrigger>
                        <SelectContent>
                          {(opcoes?.membros ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.username ?? p.email ?? p.id}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="outline" disabled={!!semEscrita || !dono || m.isPending} onClick={() => m.mutate({ tarefaId: c.id, acao: "dono", donoId: Number(dono) })}>Trocar</Button>
                  </div>
                </section>
              )}
              <section className="space-y-1">
                <Label htmlFor="coo-comentario">Comentário</Label>
                <Textarea id="coo-comentario" value={comentario} maxLength={2000} onChange={(e) => setComentario(e.target.value)} rows={3} />
                <Button size="sm" variant="outline" disabled={!!semEscrita || !comentario.trim() || m.isPending} onClick={() => m.mutate({ tarefaId: c.id, acao: "comentar", texto: comentario })}>Comentar no ClickUp</Button>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
