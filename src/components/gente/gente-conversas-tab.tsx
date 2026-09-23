import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, MessageSquarePlus, Lock, AlertCircle, Send } from "lucide-react";
import {
  listConversas,
  salvarUmAUm,
  enviarFeedback,
  type UmAUmRow,
  type FeedbackRow,
} from "@/lib/gente-conversas.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const TIPO_LABEL: Record<string, string> = {
  elogio: "Elogio",
  ponto_atencao: "Ponto de atenção",
  pedido: "Pedido",
};

const VISIBILIDADE_LABEL: Record<string, string> = {
  destinatario: "Só quem recebe",
  gestor: "Quem recebe e o gestor",
  publico: "A unidade",
};

const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : NA;

function SemCadastro() {
  return (
    <Card className="flex items-start gap-3 p-6">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <div className="font-medium">Seu usuário não está no cadastro de gente da rede.</div>
        <p className="mt-1 text-muted-foreground">
          1:1 e feedback dependem de saber quem é seu gestor e quem é seu time. Peça para incluírem
          você em Gente da Rede.
        </p>
      </div>
    </Card>
  );
}

// "eu" mostra só os 1:1 em que sou liderado; "time" mostra a cobertura, o
// formulário de registrar e os 1:1 em que sou gestor.
export type EscopoUmAUm = "eu" | "time" | "tudo";

export function GenteUmAUmTab({ escopo = "tudo" }: { escopo?: EscopoUmAUm } = {}) {
  const fn = useServerFn(listConversas);
  const salvarFn = useServerFn(salvarUmAUm);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["gente-conversas"], queryFn: () => fn(), staleTime: 30_000 });

  const [lideradoId, setLideradoId] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [pauta, setPauta] = useState("");
  const [notas, setNotas] = useState("");
  const [proximosPassos, setProximosPassos] = useState("");
  const [notaPrivada, setNotaPrivada] = useState("");
  const [status, setStatus] = useState("realizado");

  const salvar = useMutation({
    mutationFn: async () =>
      salvarFn({
        data: {
          lideradoId: Number(lideradoId),
          data,
          pauta,
          notas,
          proximosPassos,
          status,
          notaPrivada,
        },
      }),
    onSuccess: () => {
      toast.success("1:1 registrado.");
      setPauta("");
      setNotas("");
      setProximosPassos("");
      setNotaPrivada("");
      qc.invalidateQueries({ queryKey: ["gente-conversas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  }
  if (!q.data?.podeUmAUm) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">Você não tem acesso aos 1:1.</div>
          <p className="mt-1 text-muted-foreground">
            Peça a chave <code className="text-xs">view.gente.um_a_um</code> em Admin, Permissões.
          </p>
        </div>
      </Card>
    );
  }
  if (!q.data?.minhaPessoaId) return <SemCadastro />;

  const mostraTime = escopo !== "eu";
  const time = mostraTime ? q.data.meuTime : [];
  const cobertura = q.data.cobertura.filter((c) => c.pessoaId !== q.data?.minhaPessoaId);
  const conversas =
    escopo === "eu"
      ? q.data.umAUm.filter((c) => !c.souGestor)
      : escopo === "time"
        ? q.data.umAUm.filter((c) => c.souGestor)
        : q.data.umAUm;

  return (
    <div className="space-y-4">
      {time.length ? (
        <Card className="p-4">
          <h2 className="mb-1 text-base font-semibold">Quem está há mais tempo sem 1:1</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Lista de trabalho, não ranking. Quem nunca teve vem primeiro.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Último 1:1</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                  <TableHead className="text-right">Realizados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cobertura.map((c) => (
                  <TableRow key={c.pessoaId}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-sm">{fmtData(c.ultimo1a1)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.diasSem1a1 == null ? (
                        <Badge variant="destructive" className="text-xs">
                          nunca teve
                        </Badge>
                      ) : (
                        <span className={c.diasSem1a1 > 45 ? "font-semibold text-destructive" : ""}>
                          {c.diasSem1a1}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.totalRealizados}</TableCell>
                  </TableRow>
                ))}
                {!cobertura.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Ninguém no seu time ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}

      {time.length ? (
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <CalendarClock className="h-4 w-4 text-primary-text" />
            Registrar um 1:1
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="1a1-pessoa">Com quem</Label>
              <Select value={lideradoId} onValueChange={setLideradoId}>
                <SelectTrigger id="1a1-pessoa">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {time.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nome}
                      {p.cargo ? ` · ${p.cargo}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="1a1-data">Data</Label>
              <Input
                id="1a1-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="1a1-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="1a1-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="realizado">Realizado</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="1a1-pauta">Pauta</Label>
              <Textarea
                id="1a1-pauta"
                rows={2}
                value={pauta}
                onChange={(e) => setPauta(e.target.value)}
                placeholder="O que vocês combinaram de conversar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="1a1-passos">Próximos passos</Label>
              <Textarea
                id="1a1-passos"
                rows={2}
                value={proximosPassos}
                onChange={(e) => setProximosPassos(e.target.value)}
                placeholder="O que fica combinado até o próximo"
              />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="1a1-notas">Notas compartilhadas</Label>
            <Textarea
              id="1a1-notas"
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="As duas pessoas releem isto"
            />
          </div>

          <div className="mt-3 space-y-1.5 rounded-md border border-dashed p-3">
            <Label htmlFor="1a1-privada" className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Nota privada
            </Label>
            <p className="text-xs text-muted-foreground">
              Só você lê. Não aparece para a pessoa, nem para o seu gestor, nem para quem administra
              o cadastro. Isso é garantido no banco, não na tela.
            </p>
            <Textarea
              id="1a1-privada"
              rows={2}
              value={notaPrivada}
              onChange={(e) => setNotaPrivada(e.target.value)}
            />
          </div>

          <div className="mt-3 flex justify-end">
            <Button onClick={() => salvar.mutate()} disabled={!lideradoId || salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Registrar 1:1"}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">
          Histórico
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {conversas.length} registro(s)
          </span>
        </h2>
        <div className="space-y-3">
          {conversas.map((c: UmAUmRow) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {c.souGestor ? (c.lideradoNome ?? "liderado") : (c.gestorNome ?? "gestor")}
                </span>
                <Badge variant="outline" className="text-xs">
                  {c.souGestor ? "você é o gestor" : "você é o liderado"}
                </Badge>
                <Badge
                  variant={c.status === "realizado" ? "default" : "secondary"}
                  className="text-xs"
                >
                  {c.status}
                </Badge>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                  {fmtData(c.data)}
                </span>
              </div>
              {c.pauta ? <p className="mt-2 text-sm">{c.pauta}</p> : null}
              {c.notas ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{c.notas}</p>
              ) : null}
              {c.proximosPassos ? (
                <p className="mt-1 text-sm">
                  <span className="font-medium">Próximos passos: </span>
                  {c.proximosPassos}
                </p>
              ) : null}
              {c.notaPrivada ? (
                <p className="mt-2 flex items-start gap-2 rounded bg-muted/50 p-2 text-sm">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="whitespace-pre-wrap">{c.notaPrivada}</span>
                </p>
              ) : null}
            </div>
          ))}
          {!conversas.length ? (
            <p className="py-6 text-center text-muted-foreground">Nenhum 1:1 registrado ainda.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

export function GenteFeedbackTab() {
  const fn = useServerFn(listConversas);
  const enviarFn = useServerFn(enviarFeedback);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["gente-conversas"], queryFn: () => fn(), staleTime: 30_000 });

  const [paraId, setParaId] = useState("");
  const [tipo, setTipo] = useState("elogio");
  const [visibilidade, setVisibilidade] = useState("gestor");
  const [texto, setTexto] = useState("");

  const enviar = useMutation({
    mutationFn: async () =>
      enviarFn({ data: { paraId: Number(paraId), tipo, texto, visibilidade } }),
    onSuccess: () => {
      toast.success("Feedback enviado.");
      setTexto("");
      qc.invalidateQueries({ queryKey: ["gente-conversas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pessoas = useMemo(() => q.data?.pessoasDaUnidade ?? [], [q.data]);

  if (q.isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  }
  if (!q.data?.podeFeedback) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">Você não tem acesso ao feedback.</div>
          <p className="mt-1 text-muted-foreground">
            Peça a chave <code className="text-xs">view.gente.feedback</code> em Admin, Permissões.
          </p>
        </div>
      </Card>
    );
  }
  if (!q.data?.minhaPessoaId) return <SemCadastro />;

  const lista = (itens: FeedbackRow[], vazio: string, mostrarDe: boolean) => (
    <div className="space-y-3">
      {itens.map((f) => (
        <div key={f.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{mostrarDe ? (f.deNome ?? NA) : (f.paraNome ?? NA)}</span>
            <Badge
              variant={f.tipo === "ponto_atencao" ? "destructive" : "default"}
              className="text-xs"
            >
              {TIPO_LABEL[f.tipo] ?? f.tipo}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {VISIBILIDADE_LABEL[f.visibilidade] ?? f.visibilidade}
            </Badge>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {fmtData(f.criadoEm)}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{f.texto}</p>
        </div>
      ))}
      {!itens.length ? <p className="py-6 text-center text-muted-foreground">{vazio}</p> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <MessageSquarePlus className="h-4 w-4 text-primary-text" />
          Dar feedback
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fb-pessoa">Para quem</Label>
            <Select value={paraId} onValueChange={setParaId}>
              <SelectTrigger id="fb-pessoa">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nome}
                    {p.cargo ? ` · ${p.cargo}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-tipo">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="fb-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="elogio">Elogio</SelectItem>
                <SelectItem value="ponto_atencao">Ponto de atenção</SelectItem>
                <SelectItem value="pedido">Pedido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-visib">Quem enxerga</Label>
            <Select value={visibilidade} onValueChange={setVisibilidade}>
              <SelectTrigger id="fb-visib">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="destinatario">Só quem recebe</SelectItem>
                <SelectItem value="gestor">Quem recebe e o gestor dele</SelectItem>
                <SelectItem value="publico">A unidade</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="fb-texto">Feedback</Label>
          <Textarea
            id="fb-texto"
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Específico ajuda mais que genérico: o que a pessoa fez e que efeito teve."
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => enviar.mutate()}
            disabled={!paraId || texto.trim().length < 3 || enviar.isPending}
          >
            <Send className="mr-2 h-4 w-4" />
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
        {!pessoas.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Ninguém da sua unidade está no cadastro ainda, então não há para quem enviar.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold">
            Recebidos
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {q.data.feedbackRecebido.length}
            </span>
          </h2>
          {lista(q.data.feedbackRecebido, "Nada recebido ainda.", true)}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold">
            Enviados
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {q.data.feedbackEnviado.length}
            </span>
          </h2>
          {lista(q.data.feedbackEnviado, "Você ainda não enviou nenhum.", false)}
        </Card>
      </div>
    </div>
  );
}
