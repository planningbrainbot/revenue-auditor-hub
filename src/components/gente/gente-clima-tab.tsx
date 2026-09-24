import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Lock, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import {
  listClima,
  criarPesquisa,
  mudarStatusPesquisa,
  dispararConvites,
} from "@/lib/gente-clima.functions";
import { listGente } from "@/lib/gente.functions";
import { BotaoComMotivo, ErroDaFonte } from "@/components/gente/estados-gente";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";

// Clima (`/gente?tela=clima`), arquétipo Visão geral (contrato
// `docs/design/contratos/gente.md`). A rodada escolhida mora na URL
// (`?rodada=<id>`, N7); sem ela, vale a mais recente, como antes.
// Enviar convites e Encerrar confirmam em AlertDialog (N8).

const NA = "—";
const NUM = new Intl.NumberFormat("pt-BR");
const FONTE = "a pesquisa de clima";

const TIPOS = [
  { v: "escala_0_10", t: "Escala 0 a 10" },
  { v: "escala_1_5", t: "Escala 1 a 5" },
  { v: "texto", t: "Texto livre" },
];

const STATUS_RODADA: Record<string, { rotulo: string; tom: TomStatus }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  aberta: { rotulo: "Aberta", tom: "sucesso" },
  encerrada: { rotulo: "Encerrada", tom: "neutro" },
};

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

  // 0 = sem escolha: o servidor devolve a rodada mais recente.
  const [rodadaUrl, setRodadaUrl] = useFiltroNaUrl("rodada", 0);
  const pesquisaId = rodadaUrl > 0 ? rodadaUrl : null;
  const q = useQuery({
    queryKey: ["gente-clima", pesquisaId],
    queryFn: () => fn({ data: { pesquisaId: pesquisaId ?? undefined } }),
    staleTime: 30_000,
  });

  const [montando, setMontando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [rodada, setRodada] = useState("");
  const [perguntas, setPerguntas] = useState<PerguntaNova[]>(MODELO);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["gente-clima"] });

  const criar = useMutation({
    mutationFn: async () => criarFn({ data: { titulo, rodada, perguntas } }),
    onSuccess: (r) => {
      toast.success("Rodada criada como rascunho.");
      setMontando(false);
      setTitulo("");
      setRodada("");
      setPerguntas(MODELO);
      setRodadaUrl(r.id);
      invalidar();
    },
    onError: (e: Error) => toast.error(`Não foi possível criar a rodada: ${e.message}`),
  });

  const mudar = useMutation({
    mutationFn: async (v: { pesquisaId: number; status: string }) => statusFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.status === "aberta" ? "Rodada aberta para respostas." : "Rodada encerrada.");
      invalidar();
    },
    onError: (e: Error) => toast.error(`Não foi possível mudar o status: ${e.message}`),
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
    onError: (e: Error) => toast.error(`Os convites não saíram: ${e.message}`),
  });

  // Quantos recebem: o servidor manda para as pessoas ATIVAS COM E-MAIL que o
  // usuário enxerga no cadastro (mesma RLS). A tela lê o mesmo cadastro, só
  // quando o diálogo abre, para dizer o número antes do clique.
  const gente = useServerFn(listGente);
  const cadastro = useQuery({
    queryKey: ["gente"],
    queryFn: () => gente(),
    staleTime: 60_000,
    enabled: confirmarEnvio,
  });
  const ativas = (cadastro.data?.pessoas ?? []).filter((p) => p.status === "ativo");
  const comEmail = ativas.filter((p) => p.email).length;
  const semEmail = ativas.length - comEmail;

  if (q.isLoading) return <Carregando variante="kpis" />;
  if (q.isError) return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  if (!q.data) return <Carregando variante="kpis" />;
  if (!q.data.podeVer) return <EstadoSemAcesso oQueFalta="view.gente.clima" />;

  const d = q.data;
  const atual = d.pesquisas.find((p) => p.id === d.pesquisaId);
  const rodadaInexistente = pesquisaId !== null && !atual;
  // `resultado` só traz pergunta com 5 respostas ou mais (a view corta).
  const enps = d.resultado.find((r) => r.ehEnps);
  const temPerguntaEnps = d.perguntas.some((p) => p.ehEnps);
  const totalEnviados = d.cobertura.reduce((s, c) => s + c.enviados, 0);
  const totalRespondidos = d.cobertura.reduce((s, c) => s + c.respondidos, 0);
  const statusAtual = atual ? STATUS_RODADA[atual.status] : undefined;
  const nomeAtual = atual ? `${atual.titulo}${atual.rodada ? ` · ${atual.rodada}` : ""}` : "";

  const novaRodada = d.podeGerir ? (
    <Button variant="outline" onClick={() => setMontando((v) => !v)} aria-expanded={montando}>
      <Plus className="size-4" aria-hidden />
      Nova rodada
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <Card className="flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="text-sm">
          <p className="font-medium">A resposta é anônima, e isso é garantido pelo banco.</p>
          <p className="mt-1 text-muted-foreground">
            A resposta é gravada sem nenhum vínculo com a pessoa, e a tabela é ilegível até para
            quem administra. Todo recorte com menos de 5 respostas some daqui. Os convites saem por
            e-mail do servidor, então nem quem monta a rodada consegue abrir o link de alguém.
          </p>
        </div>
      </Card>

      {d.pesquisas.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="clima-rodada" className="text-[13px] text-muted-foreground">
              Rodada
            </Label>
            <Select
              value={atual ? String(atual.id) : ""}
              onValueChange={(v) => setRodadaUrl(Number(v))}
            >
              <SelectTrigger className="w-72" id="clima-rodada">
                <SelectValue placeholder="Escolha a rodada" />
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
            {statusAtual ? (
              <StatusBadge tom={statusAtual.tom}>{statusAtual.rotulo}</StatusBadge>
            ) : atual ? (
              <StatusBadge tom="neutro">{atual.status}</StatusBadge>
            ) : null}
          </div>

          {d.podeGerir ? (
            <div className="flex flex-wrap gap-2">
              {atual?.status === "rascunho" ? (
                <BotaoComMotivo
                  variant="outline"
                  disabled={mudar.isPending}
                  motivo="Gravando a mudança de status"
                  onClick={() => mudar.mutate({ pesquisaId: atual.id, status: "aberta" })}
                >
                  Abrir rodada
                </BotaoComMotivo>
              ) : null}
              {atual?.status === "aberta" ? (
                <>
                  <BotaoComMotivo
                    disabled={disparar.isPending}
                    motivo="Enviando os convites"
                    onClick={() => setConfirmarEnvio(true)}
                  >
                    <Send className="size-4" aria-hidden />
                    {disparar.isPending ? "Enviando…" : "Enviar convites"}
                  </BotaoComMotivo>
                  <BotaoComMotivo
                    variant="outline"
                    disabled={mudar.isPending}
                    motivo="Gravando a mudança de status"
                    onClick={() => setConfirmarEncerrar(true)}
                  >
                    Encerrar
                  </BotaoComMotivo>
                </>
              ) : null}
              {novaRodada}
            </div>
          ) : null}
        </div>
      ) : null}

      {montando && d.podeGerir ? (
        <Secao titulo="Que perguntas entram na nova rodada?">
          <Card className="p-4">
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
              <p className="text-[13px] text-muted-foreground">
                As três abaixo são um ponto de partida. Apague, edite e acrescente o que fizer
                sentido: quem define o conteúdo é quem entende de gente, não o sistema.
              </p>
              {perguntas.map((p, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
                  <Input
                    id={`clima-q-${i}`}
                    aria-label={`Enunciado da pergunta ${i + 1}`}
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
                    <SelectTrigger className="w-40" aria-label={`Tipo da pergunta ${i + 1}`}>
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
                    aria-pressed={p.ehEnps}
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
                    aria-label={`Apagar a pergunta ${i + 1}`}
                    title="Apagar a pergunta"
                    onClick={() => setPerguntas((v) => v.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden />
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
                <Plus className="size-4" aria-hidden />
                Acrescentar pergunta
              </Button>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMontando(false)}>
                Cancelar
              </Button>
              <BotaoComMotivo
                disabled={criar.isPending}
                motivo="Criando a rodada"
                onClick={() => criar.mutate()}
              >
                {criar.isPending ? "Criando…" : "Criar como rascunho"}
              </BotaoComMotivo>
            </div>
          </Card>
        </Secao>
      ) : null}

      {!d.pesquisas.length ? (
        <EstadoVazio
          titulo="Nenhuma rodada de clima criada ainda"
          descricao={
            d.podeGerir
              ? "Monte a primeira rodada: ela nasce como rascunho e só recebe resposta depois de aberta."
              : "Quando quem cuida do clima abrir uma rodada, o resultado aparece aqui."
          }
          acao={montando ? undefined : novaRodada}
        />
      ) : rodadaInexistente ? (
        <EstadoVazio
          titulo="A rodada deste link não existe ou você não a enxerga"
          acao={
            <Button variant="outline" onClick={() => setRodadaUrl(undefined)}>
              Ver a rodada mais recente
            </Button>
          }
        />
      ) : (
        <>
          <KpiGrade colunas={3}>
            {enps?.enps != null ? (
              <KpiCard
                rotulo="eNPS da rodada"
                valor={enps.enps}
                nota={`${NUM.format(enps.respostas)} respostas · ${enps.promotores} promotores, ${enps.detratores} detratores`}
              />
            ) : (
              <KpiCard
                rotulo="eNPS da rodada"
                valor={NA}
                estado="nao-apurado"
                nota={
                  temPerguntaEnps
                    ? "menos de 5 respostas: a nota fica oculta"
                    : "a rodada não tem pergunta marcada como eNPS"
                }
              />
            )}
            {totalEnviados ? (
              <KpiCard
                rotulo="Taxa de resposta da rodada"
                valor={`${Math.round((totalRespondidos / totalEnviados) * 100)}%`}
                nota={`${NUM.format(totalRespondidos)} de ${NUM.format(totalEnviados)} convites`}
              />
            ) : (
              <KpiCard
                rotulo="Taxa de resposta da rodada"
                valor={NA}
                estado="nao-apurado"
                nota="nenhum convite enviado ainda"
              />
            )}
            <KpiCard rotulo="Perguntas na rodada" valor={d.perguntas.length} />
          </KpiGrade>

          <Secao
            titulo="Quem recebeu o convite e respondeu, por unidade?"
            descricao="Convites desta rodada; a taxa é respostas sobre convites."
          >
            {d.cobertura.length ? (
              <Card className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Convites</TableHead>
                      <TableHead className="text-right">Responderam</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.cobertura.map((c) => (
                      <TableRow key={c.unidade ?? "sem"}>
                        <TableCell className="font-medium">{c.unidade ?? "Sem unidade"}</TableCell>
                        <TableCell className="num text-right">{c.enviados}</TableCell>
                        <TableCell className="num text-right">{c.respondidos}</TableCell>
                        <TableCell className="num text-right">
                          {c.taxa == null ? NA : `${c.taxa}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <EstadoVazio titulo="Nenhum convite enviado nesta rodada" />
            )}
          </Secao>

          <Secao
            titulo="Como a rodada respondeu cada pergunta?"
            descricao="Todas as respostas da rodada. Pergunta com menos de 5 respostas não aparece, de propósito."
          >
            {d.resultado.length ? (
              <Card className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Respostas</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">eNPS da rodada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.resultado.map((r) => (
                      <TableRow key={r.perguntaId}>
                        <TableCell className="max-w-md">{r.enunciado}</TableCell>
                        <TableCell className="num text-right">{r.respostas}</TableCell>
                        <TableCell className="num text-right">{r.media ?? NA}</TableCell>
                        <TableCell className="num text-right">{r.enps ?? NA}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <EstadoVazio titulo="Ainda não há pergunta com 5 respostas ou mais" />
            )}
          </Secao>

          {d.porUnidade.length ? (
            <Secao
              titulo="E em cada unidade?"
              descricao="Só unidade com 5 respostas ou mais na pergunta. O eNPS aqui conta só as respostas daquela unidade."
            >
              <Card className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Respostas</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">eNPS da unidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.porUnidade.map((u, i) => (
                      <TableRow key={`${u.unidade}-${u.perguntaId}-${i}`}>
                        <TableCell className="font-medium">{u.unidade}</TableCell>
                        <TableCell className="max-w-sm">{u.enunciado}</TableCell>
                        <TableCell className="num text-right">{u.respostas}</TableCell>
                        <TableCell className="num text-right">{u.media ?? NA}</TableCell>
                        <TableCell className="num text-right">{u.enps ?? NA}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </Secao>
          ) : null}

          {d.comentarios.length ? (
            <Secao
              titulo="O que escreveram no texto livre?"
              descricao="Sem unidade e sem departamento ao lado: comentário mais recorte pequeno identifica quem escreveu."
            >
              <div className="space-y-2">
                {d.comentarios.map((c, i) => (
                  <p key={i} className="flex gap-2 rounded-md border bg-card p-3 text-sm">
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>{c.comentario}</span>
                  </p>
                ))}
              </div>
            </Secao>
          ) : null}

          <Procedencia
            fonte="Planning People: pesquisa de clima (respostas anônimas)"
            atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
            regua="eNPS calculado no banco a partir de promotores e detratores; recorte com menos de 5 respostas fica oculto"
          />
        </>
      )}

      {atual ? (
        <>
          <AlertDialog open={confirmarEnvio} onOpenChange={setConfirmarEnvio}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Enviar os convites de {nomeAtual}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    {cadastro.isLoading ? (
                      <p>Contando os destinatários…</p>
                    ) : cadastro.isError ? (
                      <p>
                        Não foi possível contar os destinatários agora. O convite vai por e-mail
                        para todas as pessoas ativas com e-mail no cadastro que você enxerga.
                      </p>
                    ) : (
                      <p>
                        Vai por e-mail para <strong className="num">{NUM.format(comEmail)}</strong>{" "}
                        pessoa(s) ativa(s) com e-mail no cadastro que você enxerga
                        {semEmail ? `; ${NUM.format(semEmail)} sem e-mail ficam de fora` : ""}.
                      </p>
                    )}
                    <p>
                      Quem já recebeu o convite desta rodada não recebe de novo. O e-mail sai na
                      hora e não tem como ser desfeito.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={cadastro.isLoading}
                  onClick={() => disparar.mutate(atual.id)}
                >
                  Enviar convites
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={confirmarEncerrar} onOpenChange={setConfirmarEncerrar}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Encerrar {nomeAtual}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A rodada deixa de aceitar respostas: quem ainda não respondeu não consegue mais
                  usar o link. O resultado continua aqui.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => mudar.mutate({ pesquisaId: atual.id, status: "encerrada" })}
                >
                  Encerrar rodada
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
