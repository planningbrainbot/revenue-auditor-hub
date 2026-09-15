import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, Plus, Send, ShieldCheck, Trash2, Lock } from "lucide-react";
import {
  listClima,
  criarPesquisa,
  mudarStatusPesquisa,
  dispararConvites,
} from "@/lib/gente-clima.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NA = "—";

const TIPOS = [
  { v: "escala_0_10", t: "Escala 0 a 10" },
  { v: "escala_1_5", t: "Escala 1 a 5" },
  { v: "texto", t: "Texto livre" },
];

type PerguntaNova = { enunciado: string; tipo: string; ehEnps: boolean };

const MODELO: PerguntaNova[] = [
  {
    enunciado:
      "Em uma escala de 0 a 10, o quanto você recomendaria a Planning como lugar para trabalhar?",
    tipo: "escala_0_10",
    ehEnps: true,
  },
  {
    enunciado: "Você tem clareza do que se espera do seu trabalho?",
    tipo: "escala_1_5",
    ehEnps: false,
  },
  {
    enunciado: "O que mudaria na sua unidade, se pudesse mudar uma coisa?",
    tipo: "texto",
    ehEnps: false,
  },
];

export function GenteClimaTab() {
  const fn = useServerFn(listClima);
  const criarFn = useServerFn(criarPesquisa);
  const statusFn = useServerFn(mudarStatusPesquisa);
  const dispararFn = useServerFn(dispararConvites);
  const qc = useQueryClient();

  const [pesquisaId, setPesquisaId] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["gente-clima", pesquisaId],
    queryFn: () => fn({ data: { pesquisaId: pesquisaId ?? undefined } }),
    staleTime: 30_000,
  });

  const [montando, setMontando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [rodada, setRodada] = useState("");
  const [perguntas, setPerguntas] = useState<PerguntaNova[]>(MODELO);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["gente-clima"] });

  const criar = useMutation({
    mutationFn: async () => criarFn({ data: { titulo, rodada, perguntas } }),
    onSuccess: (r) => {
      toast.success("Rodada criada como rascunho.");
      setMontando(false);
      setTitulo("");
      setRodada("");
      setPerguntas(MODELO);
      setPesquisaId(r.id);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudar = useMutation({
    mutationFn: async (v: { pesquisaId: number; status: string }) => statusFn({ data: v }),
    onSuccess: () => {
      toast.success("Status atualizado.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disparar = useMutation({
    mutationFn: async (id: number) => dispararFn({ data: { pesquisaId: id } }),
    onSuccess: (r) => {
      toast.success(
        `${r.enviados} convite(s) enviado(s)` +
          (r.falhas ? `, ${r.falhas} falharam` : "") +
          (r.semEmail ? `. ${r.semEmail} pessoa(s) sem e-mail ficaram de fora` : ""),
      );
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;

  if (!q.data?.podeVer) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">Você não tem acesso à pesquisa de clima.</div>
          <p className="mt-1 text-muted-foreground">
            Peça a chave <code className="text-xs">view.gente.clima</code> em Admin, Permissões.
          </p>
        </div>
      </Card>
    );
  }

  const d = q.data;
  const atual = d.pesquisas.find((p) => p.id === d.pesquisaId);
  const enps = d.resultado.find((r) => r.ehEnps);
  const totalEnviados = d.cobertura.reduce((s, c) => s + c.enviados, 0);
  const totalRespondidos = d.cobertura.reduce((s, c) => s + c.respondidos, 0);

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm">
          <div className="font-medium">A resposta é anônima, e isso é garantido pelo banco.</div>
          <p className="mt-1 text-muted-foreground">
            A resposta é gravada sem nenhum vínculo com a pessoa, e a tabela é ilegível até para
            quem administra. Todo recorte com menos de 5 respostas some daqui. Os convites saem por
            e-mail do servidor, então nem quem monta a rodada consegue abrir o link de alguém.
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={d.pesquisaId ? String(d.pesquisaId) : ""}
              onValueChange={(v) => setPesquisaId(Number(v))}
            >
              <SelectTrigger className="w-72" id="clima-rodada">
                <SelectValue placeholder="Nenhuma rodada ainda" />
              </SelectTrigger>
              <SelectContent>
                {d.pesquisas.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.titulo}
                    {p.rodada ? ` · ${p.rodada}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {atual ? (
              <Badge variant={atual.status === "aberta" ? "default" : "secondary"}>
                {atual.status}
              </Badge>
            ) : null}
          </div>

          {d.podeGerir ? (
            <div className="flex flex-wrap gap-2">
              {atual?.status === "rascunho" ? (
                <Button
                  variant="outline"
                  onClick={() => mudar.mutate({ pesquisaId: atual.id, status: "aberta" })}
                >
                  Abrir rodada
                </Button>
              ) : null}
              {atual?.status === "aberta" ? (
                <>
                  <Button onClick={() => disparar.mutate(atual.id)} disabled={disparar.isPending}>
                    <Send className="mr-2 h-4 w-4" />
                    {disparar.isPending ? "Enviando…" : "Enviar convites"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => mudar.mutate({ pesquisaId: atual.id, status: "encerrada" })}
                  >
                    Encerrar
                  </Button>
                </>
              ) : null}
              <Button variant="outline" onClick={() => setMontando((v) => !v)}>
                <Plus className="mr-2 h-4 w-4" />
                Nova rodada
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {montando && d.podeGerir ? (
        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold">Montar rodada</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clima-titulo">Título</Label>
              <Input
                id="clima-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Pesquisa de clima"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clima-periodo">Rodada</Label>
              <Input
                id="clima-periodo"
                value={rodada}
                onChange={(e) => setRodada(e.target.value)}
                placeholder="2026-T3"
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Label>Perguntas</Label>
            <p className="text-xs text-muted-foreground">
              As três abaixo são um ponto de partida. Apague, edite e acrescente o que fizer
              sentido: quem define o conteúdo é quem entende de gente, não o sistema.
            </p>
            {perguntas.map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
                <Input
                  id={`clima-q-${i}`}
                  className="min-w-[16rem] flex-1"
                  value={p.enunciado}
                  onChange={(e) =>
                    setPerguntas((v) =>
                      v.map((x, j) => (j === i ? { ...x, enunciado: e.target.value } : x)),
                    )
                  }
                />
                <Select
                  value={p.tipo}
                  onValueChange={(t) =>
                    setPerguntas((v) => v.map((x, j) => (j === i ? { ...x, tipo: t } : x)))
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.v} value={t.v}>
                        {t.t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant={p.ehEnps ? "default" : "outline"}
                  onClick={() =>
                    setPerguntas((v) => v.map((x, j) => ({ ...x, ehEnps: j === i && !x.ehEnps })))
                  }
                  title="Marca qual pergunta vira o eNPS"
                >
                  eNPS
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setPerguntas((v) => v.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPerguntas((v) => [...v, { enunciado: "", tipo: "escala_1_5", ehEnps: false }])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Acrescentar pergunta
            </Button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMontando(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar como rascunho"}
            </Button>
          </div>
        </Card>
      ) : null}

      {!d.pesquisaId ? (
        <Card className="p-6 text-center text-muted-foreground">Nenhuma rodada criada ainda.</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-2xl font-bold tabular-nums">
                {enps?.enps == null ? NA : enps.enps}
              </div>
              <div className="text-sm text-muted-foreground">eNPS</div>
              {enps ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {enps.promotores} promotores, {enps.detratores} detratores
                </div>
              ) : null}
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold tabular-nums">
                {totalEnviados ? `${Math.round((totalRespondidos / totalEnviados) * 100)}%` : NA}
              </div>
              <div className="text-sm text-muted-foreground">Taxa de resposta</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {totalRespondidos} de {totalEnviados}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold tabular-nums">{d.perguntas.length}</div>
              <div className="text-sm text-muted-foreground">Perguntas na rodada</div>
            </Card>
          </div>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">Cobertura por unidade</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="text-right">Enviados</TableHead>
                    <TableHead className="text-right">Responderam</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.cobertura.map((c) => (
                    <TableRow key={c.unidade ?? "sem"}>
                      <TableCell className="font-medium">{c.unidade ?? "Sem unidade"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.enviados}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.respondidos}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.taxa == null ? NA : `${c.taxa}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!d.cobertura.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        Nenhum convite enviado ainda.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 text-base font-semibold">Resultado por pergunta</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Pergunta com menos de 5 respostas não aparece aqui, de propósito.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pergunta</TableHead>
                    <TableHead className="text-right">Respostas</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                    <TableHead className="text-right">eNPS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.resultado.map((r) => (
                    <TableRow key={r.perguntaId}>
                      <TableCell className="max-w-md">{r.enunciado}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.respostas}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.media ?? NA}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.enps ?? NA}</TableCell>
                    </TableRow>
                  ))}
                  {!d.resultado.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        Ainda não há pergunta com 5 respostas ou mais.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </Card>

          {d.porUnidade.length ? (
            <Card className="p-4">
              <h2 className="mb-3 text-base font-semibold">Por unidade</h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Respostas</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">eNPS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.porUnidade.map((u, i) => (
                      <TableRow key={`${u.unidade}-${u.perguntaId}-${i}`}>
                        <TableCell className="font-medium">{u.unidade}</TableCell>
                        <TableCell className="max-w-sm text-sm">{u.enunciado}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.respostas}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.media ?? NA}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.enps ?? NA}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : null}

          {d.comentarios.length ? (
            <Card className="p-4">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Texto livre
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Sem unidade e sem departamento ao lado: comentário mais recorte pequeno identifica
                quem escreveu.
              </p>
              <div className="space-y-2">
                {d.comentarios.map((c, i) => (
                  <p key={i} className="rounded-md border p-3 text-sm">
                    {c.comentario}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
