import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Lock, Send } from "lucide-react";
import {
  listConversas,
  salvarUmAUm,
  enviarFeedback,
  type ConversasResult,
  type UmAUmRow,
  type FeedbackRow,
} from "@/lib/gente-conversas.functions";
import {
  AvisoCorte,
  BotaoComMotivo,
  ErroDaFonte,
  SemCadastroNaRede,
  dataSP,
} from "@/components/gente/estados-gente";
import {
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
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

// A consulta (`listConversas`) pede no máximo 200 linhas de 1:1 e 200 de
// feedback, as mais recentes. Com 200 devolvidas pode haver mais, e a tela diz.
const LIMITE_CONSULTA = 200;
const FONTE = "os 1:1 e feedbacks";
const PROCEDENCIA_FONTE = "Planning People: 1:1 e feedback";

const STATUS_1A1: Record<string, { tom: TomStatus; rotulo: string }> = {
  realizado: { tom: "sucesso", rotulo: "Realizado" },
  agendado: { tom: "info", rotulo: "Agendado" },
  cancelado: { tom: "neutro", rotulo: "Cancelado" },
};

// Régua da fila de 1:1: acima disto o atraso vira status (é a mesma régua que
// a tela já usava para pintar o número).
const DIAS_ALERTA_1A1 = 45;

const MOTIVO_SEM_REGISTRO =
  "Registrar 1:1 exige a permissão edit.gente.conversas. Peça a quem administra os acessos da sua área.";

function useConversas() {
  const fn = useServerFn(listConversas);
  return useQuery<ConversasResult>({
    queryKey: ["gente-conversas"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

// "eu" mostra só os 1:1 em que sou liderado; "time" mostra a cobertura, o
// formulário de registrar e os 1:1 em que sou gestor.
export type EscopoUmAUm = "eu" | "time" | "tudo";

export function GenteUmAUmTab({ escopo = "tudo" }: { escopo?: EscopoUmAUm } = {}) {
  const salvarFn = useServerFn(salvarUmAUm);
  const qc = useQueryClient();
  const q = useConversas();
  const formRef = useRef<HTMLDivElement>(null);

  // Filtro do histórico por pessoa, na URL (N7). Só na tela 1:1: dentro de
  // "Meu time" o bloco é um resumo e não leva filtro.
  const [pessoaUrl, setPessoaUrl] = useFiltroNaUrl("pessoa", "");
  const pessoaFiltro = escopo === "tudo" ? pessoaUrl : "";

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
    onError: (e: Error) => toast.error(`Não foi possível registrar o 1:1: ${e.message}`),
  });

  if (q.isLoading) return <Carregando variante="tabela" />;
  if (q.isError) return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  if (!q.data) return null;
  if (!q.data.podeUmAUm) return <EstadoSemAcesso oQueFalta="view.gente.um_a_um" />;
  if (!q.data.minhaPessoaId) return <SemCadastroNaRede oQueDepende="O 1:1" />;

  const d = q.data;
  const podeRegistrar = d.podeRegistrar;
  const mostraTime = escopo !== "eu";
  const time = mostraTime ? d.meuTime : [];
  const cobertura = d.cobertura.filter((c) => c.pessoaId !== d.minhaPessoaId);
  const doEscopo =
    escopo === "eu"
      ? d.umAUm.filter((c) => !c.souGestor)
      : escopo === "time"
        ? d.umAUm.filter((c) => c.souGestor)
        : d.umAUm;
  const conversas = pessoaFiltro
    ? doEscopo.filter((c) => String(c.souGestor ? c.lideradoId : c.gestorId) === pessoaFiltro)
    : doEscopo;

  // Pessoas que aparecem no histórico, para o filtro.
  const pessoasDoHistorico = new Map<string, string>();
  for (const c of doEscopo) {
    const id = String(c.souGestor ? c.lideradoId : c.gestorId);
    const nome = c.souGestor ? (c.lideradoNome ?? "liderado") : (c.gestorNome ?? "gestor");
    pessoasDoHistorico.set(id, nome);
  }
  const nomeFiltro = pessoaFiltro ? (pessoasDoHistorico.get(pessoaFiltro) ?? "pessoa") : null;

  const abrirRegistro = (id: number) => {
    setLideradoId(String(id));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      {time.length ? (
        <Secao
          titulo="Com quem você está há mais tempo sem 1:1?"
          descricao={`Lista de trabalho, não ranking: quem nunca teve vem primeiro. Acima de ${DIAS_ALERTA_1A1} dias o atraso é marcado.`}
        >
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Último 1:1</TableHead>
                  <TableHead className="text-right">Dias sem 1:1</TableHead>
                  <TableHead className="text-right">Realizados</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Ação</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cobertura.map((c) => (
                  <TableRow key={c.pessoaId}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-sm">{fmtData(c.ultimo1a1)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.diasSem1a1 == null ? (
                        <StatusBadge tom="perigo">Nunca teve</StatusBadge>
                      ) : c.diasSem1a1 > DIAS_ALERTA_1A1 ? (
                        <StatusBadge tom="atencao">
                          <span className="num">{c.diasSem1a1}</span> dias
                        </StatusBadge>
                      ) : (
                        c.diasSem1a1
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.totalRealizados}</TableCell>
                    <TableCell className="text-right">
                      <BotaoComMotivo
                        size="sm"
                        variant="outline"
                        disabled={!podeRegistrar}
                        motivo={podeRegistrar ? null : MOTIVO_SEM_REGISTRO}
                        onClick={() => abrirRegistro(c.pessoaId)}
                      >
                        Registrar 1:1
                      </BotaoComMotivo>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!cobertura.length ? (
              <EstadoVazio
                className="rounded-none border-0"
                titulo="Ninguém do seu time aparece na fila de 1:1 ainda"
                descricao="A fila lista as pessoas que têm você como gestor no cadastro."
              />
            ) : null}
          </Card>
        </Secao>
      ) : null}

      {time.length ? (
        <div ref={formRef} className="scroll-mt-4">
          <Secao titulo="Registrar um 1:1">
            <Card className="p-4">
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
                  <Lock className="size-4" aria-hidden />
                  Nota privada
                </Label>
                <p className="text-xs text-muted-foreground">
                  Só você lê. Não aparece para a pessoa, nem para o seu gestor, nem para quem
                  administra o cadastro. Isso é garantido no banco, não na tela.
                </p>
                <Textarea
                  id="1a1-privada"
                  rows={2}
                  value={notaPrivada}
                  onChange={(e) => setNotaPrivada(e.target.value)}
                />
              </div>

              <div className="mt-3 flex justify-end">
                <BotaoComMotivo
                  onClick={() => salvar.mutate()}
                  disabled={!podeRegistrar || !lideradoId || !data || salvar.isPending}
                  motivo={[
                    !podeRegistrar && MOTIVO_SEM_REGISTRO,
                    !lideradoId && "Escolha com quem foi o 1:1.",
                    !data && "Informe a data do 1:1.",
                  ]}
                >
                  <CalendarClock className="size-4" aria-hidden />
                  {salvar.isPending ? "Salvando…" : "Registrar 1:1"}
                </BotaoComMotivo>
              </div>
            </Card>
          </Secao>
        </div>
      ) : null}

      <Secao
        titulo="Que 1:1 já aconteceram?"
        descricao={
          pessoaFiltro
            ? `${conversas.length} de ${doEscopo.length} registro(s)`
            : `${doEscopo.length} registro(s), do mais recente ao mais antigo`
        }
        acoes={
          escopo === "tudo" && pessoasDoHistorico.size > 1 ? (
            <Select
              value={pessoaFiltro || "todas"}
              onValueChange={(v) => setPessoaUrl(v === "todas" ? undefined : v)}
            >
              <SelectTrigger className="h-8 w-56" aria-label="Filtrar histórico por pessoa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as pessoas</SelectItem>
                {[...pessoasDoHistorico].map(([id, nome]) => (
                  <SelectItem key={id} value={id}>
                    {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      >
        {nomeFiltro ? (
          <div>
            <ChipFiltro
              rotulo="Pessoa"
              valor={nomeFiltro}
              aoRemover={() => setPessoaUrl(undefined)}
            />
          </div>
        ) : null}
        <div className="space-y-3">
          {conversas.map((c: UmAUmRow) => {
            const st = STATUS_1A1[c.status] ?? { tom: "neutro" as const, rotulo: c.status };
            return (
              <Card key={c.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {c.souGestor ? (c.lideradoNome ?? "liderado") : (c.gestorNome ?? "gestor")}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {c.souGestor ? "você é o gestor" : "você é o liderado"}
                  </Badge>
                  <StatusBadge tom={st.tom}>{st.rotulo}</StatusBadge>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {fmtData(c.data)}
                  </span>
                </div>
                {c.pauta ? <p className="mt-2 text-sm">{c.pauta}</p> : null}
                {c.notas ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {c.notas}
                  </p>
                ) : null}
                {c.proximosPassos ? (
                  <p className="mt-1 text-sm">
                    <span className="font-medium">Próximos passos: </span>
                    {c.proximosPassos}
                  </p>
                ) : null}
                {c.notaPrivada ? (
                  <p className="mt-2 flex items-start gap-2 rounded bg-muted p-2 text-sm">
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="whitespace-pre-wrap">{c.notaPrivada}</span>
                  </p>
                ) : null}
              </Card>
            );
          })}
          {!conversas.length ? (
            <EstadoVazio
              titulo={pessoaFiltro ? "Nenhum 1:1 com essa pessoa" : "Nenhum 1:1 registrado ainda"}
              total={pessoaFiltro ? doEscopo.length : undefined}
              descricao={
                pessoaFiltro
                  ? undefined
                  : escopo === "eu"
                    ? "Quando seu gestor registrar um 1:1 com você, ele aparece aqui."
                    : "Os 1:1 que você registrar aparecem aqui, do mais recente ao mais antigo."
              }
              acao={
                pessoaFiltro ? (
                  <Button variant="outline" size="sm" onClick={() => setPessoaUrl(undefined)}>
                    Ver todas as pessoas
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          <AvisoCorte
            mostrando={d.umAUm.length}
            oQue="1:1"
            limiteDoServidor={LIMITE_CONSULTA}
          />
        </div>
      </Secao>

      <Procedencia
        fonte={PROCEDENCIA_FONTE}
        atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
        regua={`até os ${LIMITE_CONSULTA} registros mais recentes que você enxerga`}
      />
    </div>
  );
}

const TIPOS_FEEDBACK = ["elogio", "ponto_atencao", "pedido"] as const;

export function GenteFeedbackTab() {
  const enviarFn = useServerFn(enviarFeedback);
  const qc = useQueryClient();
  const q = useConversas();

  // Filtro por tipo, na URL (N7), vale para Recebidos e Enviados.
  const [tipoUrl, setTipoUrl] = useFiltroNaUrl("tipo", "");
  const tipoFiltro = (TIPOS_FEEDBACK as readonly string[]).includes(tipoUrl) ? tipoUrl : "";

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
    onError: (e: Error) => toast.error(`Não foi possível enviar o feedback: ${e.message}`),
  });

  const pessoas = useMemo(() => q.data?.pessoasDaUnidade ?? [], [q.data]);

  if (q.isLoading) return <Carregando variante="tabela" />;
  if (q.isError) return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  if (!q.data) return null;
  if (!q.data.podeFeedback) return <EstadoSemAcesso oQueFalta="view.gente.feedback" />;
  if (!q.data.minhaPessoaId) return <SemCadastroNaRede oQueDepende="O feedback" />;

  const d = q.data;
  const filtrar = (itens: FeedbackRow[]) =>
    tipoFiltro ? itens.filter((f) => f.tipo === tipoFiltro) : itens;
  const recebidos = filtrar(d.feedbackRecebido);
  const enviados = filtrar(d.feedbackEnviado);

  const motivoEnviar = [
    !pessoas.length && "Ninguém da sua unidade está no cadastro ainda, então não há para quem enviar.",
    !paraId && "Escolha para quem é o feedback.",
    texto.trim().length < 3 && "Escreva o feedback (pelo menos 3 caracteres).",
  ];

  const lista = (itens: FeedbackRow[], todos: number, vazio: string, mostrarDe: boolean) => (
    <div className="space-y-3">
      {itens.map((f) => (
        <div key={f.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{mostrarDe ? (f.deNome ?? NA) : (f.paraNome ?? NA)}</span>
            {/* Tipo é categoria, não status: selo neutro, sem cor de alerta. */}
            <Badge variant="secondary" className="text-xs">
              {TIPO_LABEL[f.tipo] ?? f.tipo}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {VISIBILIDADE_LABEL[f.visibilidade] ?? f.visibilidade}
            </Badge>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {dataSP(f.criadoEm)}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{f.texto}</p>
        </div>
      ))}
      {!itens.length ? (
        <EstadoVazio
          className="py-8"
          titulo={tipoFiltro ? `Nenhum ${TIPO_LABEL[tipoFiltro]?.toLowerCase()} aqui` : vazio}
          total={tipoFiltro ? todos : undefined}
        />
      ) : null}
    </div>
  );

  const contagem = (n: number, todos: number) => (tipoFiltro ? `${n} de ${todos}` : `${n}`);

  return (
    <div className="space-y-6">
      <Secao titulo="Dar feedback">
        <Card className="p-4">
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
            <BotaoComMotivo
              onClick={() => enviar.mutate()}
              disabled={!paraId || texto.trim().length < 3 || enviar.isPending}
              motivo={motivoEnviar}
            >
              <Send className="size-4" aria-hidden />
              {enviar.isPending ? "Enviando…" : "Enviar feedback"}
            </BotaoComMotivo>
          </div>
          {!pessoas.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Ninguém da sua unidade está no cadastro ainda, então não há para quem enviar.
            </p>
          ) : null}
        </Card>
      </Secao>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="fb-filtro-tipo" className="text-sm text-muted-foreground">
          Tipo
        </Label>
        <Select
          value={tipoFiltro || "todos"}
          onValueChange={(v) => setTipoUrl(v === "todos" ? undefined : v)}
        >
          <SelectTrigger id="fb-filtro-tipo" className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {TIPOS_FEEDBACK.map((t) => (
              <SelectItem key={t} value={t}>
                {TIPO_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tipoFiltro ? (
          <ChipFiltro
            rotulo="Tipo"
            valor={TIPO_LABEL[tipoFiltro]}
            aoRemover={() => setTipoUrl(undefined)}
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao
          titulo="O que você recebeu?"
          descricao={`${contagem(recebidos.length, d.feedbackRecebido.length)} feedback(s)`}
        >
          {lista(recebidos, d.feedbackRecebido.length, "Nada recebido ainda.", true)}
        </Secao>
        <Secao
          titulo="O que você enviou?"
          descricao={`${contagem(enviados.length, d.feedbackEnviado.length)} feedback(s)`}
        >
          {lista(enviados, d.feedbackEnviado.length, "Você ainda não enviou nenhum.", false)}
        </Secao>
      </div>

      {/* A consulta traz até 200 feedbacks visíveis, inclusive os públicos de
          terceiros; recebidos + enviados não dizem se o limite bateu, então ele
          fica declarado na régua, sempre. */}
      <Procedencia
        fonte={PROCEDENCIA_FONTE}
        atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
        regua={`até os ${LIMITE_CONSULTA} feedbacks mais recentes que você enxerga; data no fuso de São Paulo`}
      />
    </div>
  );
}
