import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, CalendarClock, HeartPulse, ListChecks, Send, Sparkles } from "lucide-react";
import {
  listLideranca,
  publicarElogio,
  registrarSentimento,
  salvarCadencia,
  salvarPrioridades,
  segundaDaSemana,
  type LiderancaResult,
  type SentimentoRow,
} from "@/lib/gente-lideranca.functions";
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

// A escala nova é nossa. Os nomes em caixa alta são os do Qulture e aparecem só
// no histórico importado: sem eles, 1.061 registros virariam rótulo vazio.
const RATE_LABEL: Record<string, string> = {
  otima: "Ótima",
  boa: "Boa",
  neutra: "Normal",
  dificil: "Difícil",
  ruim: "Ruim",
  GRIN: "Ótima",
  BLUSH: "Boa",
  SLIGHTLY_SMILING_FACE: "Boa",
  NEUTRAL_FACE: "Normal",
  THINKING_FACE: "Pensativa",
  CONFUSED: "Difícil",
  WORRIED: "Difícil",
  CRY: "Ruim",
  ANGRY: "Ruim",
};

const ESCALA_NOVA = [
  { valor: "otima", rotulo: "Ótima" },
  { valor: "boa", rotulo: "Boa" },
  { valor: "neutra", rotulo: "Normal" },
  { valor: "dificil", rotulo: "Difícil" },
  { valor: "ruim", rotulo: "Ruim" },
];

const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : NA;

const rotuloRate = (rate: string | null) =>
  rate ? (RATE_LABEL[rate] ?? rate.toLowerCase().replace(/_/g, " ")) : NA;

function SemCadastro() {
  return (
    <Card className="flex items-start gap-3 p-6">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <div className="font-medium">Seu usuário não está no cadastro de gente da rede.</div>
        <p className="mt-1 text-muted-foreground">
          Sentimento, prioridades e cadência dependem de saber quem é você e quem é seu time.
        </p>
      </div>
    </Card>
  );
}

function SemPermissao({ o_que }: { o_que: string }) {
  return (
    <Card className="p-6 text-sm text-muted-foreground">
      Seu perfil não tem a permissão para {o_que}.
    </Card>
  );
}

// Um por pessoa: o registro mais recente de cada um do time.
function ultimoPorPessoa(linhas: SentimentoRow[]): SentimentoRow[] {
  const porPessoa = new Map<number, SentimentoRow>();
  for (const linha of linhas) {
    const atual = porPessoa.get(linha.pessoaId);
    if (!atual || linha.periodoEm > atual.periodoEm) porPessoa.set(linha.pessoaId, linha);
  }
  return [...porPessoa.values()].sort((a, b) => b.periodoEm.localeCompare(a.periodoEm));
}

// Escopo do bloco: a mesma tela serve "Minha vez" (o que eu respondo) e
// "Meu time" (o que eu acompanho). Sem isso, o colaborador que não lidera
// ninguém abriria uma tela com três tabelas vazias embaixo do formulário.
export type Escopo = "eu" | "time" | "tudo";

export function GenteLiderancaTab({ escopo = "tudo" }: { escopo?: Escopo } = {}) {
  const fn = useServerFn(listLideranca);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<LiderancaResult>({
    queryKey: ["gente-lideranca"],
    queryFn: () => fn({}),
  });

  const sentimentoFn = useServerFn(registrarSentimento);
  const prioridadesFn = useServerFn(salvarPrioridades);
  const cadenciaFn = useServerFn(salvarCadencia);

  const [rate, setRate] = useState("boa");
  const [comentario, setComentario] = useState("");
  // `null` = ainda não mexi nos campos, então o que aparece é o que está salvo.
  // Sem isso seria preciso um efeito para copiar o salvo no estado, e o efeito
  // apagaria o que a pessoa acabou de digitar a cada refetch.
  const [rascunho, setRascunho] = useState<string[] | null>(null);

  const semana = segundaDaSemana();
  const daSemana = data?.minhasPrioridades.find((p) => p.periodoEm === semana);
  const prioridades = rascunho ?? [0, 1, 2].map((i) => daSemana?.prioridades[i] ?? "");
  const setPrioridades = (valores: string[]) => setRascunho(valores);

  const gravarSentimento = useMutation({
    mutationFn: () => sentimentoFn({ data: { rate, comentario } }),
    onSuccess: () => {
      toast.success("Pulso registrado.");
      setComentario("");
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const gravarPrioridades = useMutation({
    mutationFn: () => prioridadesFn({ data: { prioridades } }),
    onSuccess: () => {
      toast.success("Prioridades da semana salvas.");
      setRascunho(null);
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const gravarCadencia = useMutation({
    mutationFn: (v: { lideradoId: number; intervaloDias: number }) => cadenciaFn({ data: v }),
    onSuccess: () => {
      toast.success("Cadência combinada.");
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const timeSentimento = useMemo(
    () => ultimoPorPessoa(data?.sentimentosDoTime ?? []),
    [data?.sentimentosDoTime],
  );

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (!data) return null;
  if (!data.podeLideranca) return <SemPermissao o_que="ver sentimento e prioridades" />;
  if (!data.minhaPessoaId) return <SemCadastro />;

  const atrasados = data.cadencias.filter((c) => c.atrasado);
  const mostraEu = escopo !== "time";
  const mostraTime = escopo !== "eu";

  return (
    <div className="space-y-4">
      {mostraEu && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Como foi sua semana?</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Semana de {fmtData(semana)}. Responder de novo corrige a resposta, não cria outra. Seu
              gestor vê; a unidade não.
            </p>
            <div className="flex flex-wrap gap-2">
              {ESCALA_NOVA.map((opcao) => (
                <Button
                  key={opcao.valor}
                  type="button"
                  size="sm"
                  variant={rate === opcao.valor ? "default" : "outline"}
                  onClick={() => setRate(opcao.valor)}
                >
                  {opcao.rotulo}
                </Button>
              ))}
            </div>
            <Textarea
              placeholder="Quer dizer alguma coisa? (opcional)"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
            />
            <Button
              size="sm"
              onClick={() => gravarSentimento.mutate()}
              disabled={gravarSentimento.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              Registrar
            </Button>
            {data.meusSentimentos.length > 0 && (
              <div className="pt-2 text-xs text-muted-foreground">
                Últimas:{" "}
                {data.meusSentimentos
                  .slice(0, 6)
                  .map((s) => `${fmtData(s.periodoEm)} ${rotuloRate(s.rate)}`)
                  .join(" · ")}
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Minhas prioridades da semana</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              No máximo três. Prioridade é o que fica de fora, não o que entra.
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1">
                <Label className="text-xs">Prioridade {i + 1}</Label>
                <Input
                  value={prioridades[i] ?? ""}
                  onChange={(e) => {
                    const copia = [...prioridades];
                    copia[i] = e.target.value;
                    setPrioridades(copia);
                  }}
                />
              </div>
            ))}
            <Button
              size="sm"
              onClick={() => gravarPrioridades.mutate()}
              disabled={gravarPrioridades.isPending}
            >
              Salvar prioridades
            </Button>
          </Card>
        </div>
      )}

      {mostraTime && data.meuTime.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Cadência de 1:1 com meu time</h3>
            {atrasados.length > 0 && (
              <Badge variant="destructive">{atrasados.length} atrasado(s)</Badge>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Combinado</TableHead>
                <TableHead>Último 1:1</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead className="text-right">Definir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.meuTime.map((pessoa) => {
                const cadencia = data.cadencias.find((c) => c.lideradoId === pessoa.id);
                return (
                  <TableRow
                    key={pessoa.id}
                    className={cadencia?.atrasado ? "bg-destructive/5" : ""}
                  >
                    <TableCell className="font-medium">{pessoa.nome}</TableCell>
                    <TableCell>
                      {cadencia ? `${cadencia.intervaloDias} dias` : "sem combinado"}
                    </TableCell>
                    <TableCell>{fmtData(cadencia?.ultimoEm ?? null)}</TableCell>
                    <TableCell>
                      {cadencia?.diasDesde != null ? (
                        <Badge variant={cadencia.atrasado ? "destructive" : "secondary"}>
                          {cadencia.diasDesde}
                        </Badge>
                      ) : (
                        NA
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Select
                        value={String(cadencia?.intervaloDias ?? "")}
                        onValueChange={(v) =>
                          gravarCadencia.mutate({ lideradoId: pessoa.id, intervaloDias: Number(v) })
                        }
                      >
                        <SelectTrigger className="ml-auto w-32">
                          <SelectValue placeholder="Intervalo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">Semanal</SelectItem>
                          <SelectItem value="14">Quinzenal</SelectItem>
                          <SelectItem value="30">Mensal</SelectItem>
                          <SelectItem value="60">A cada 2 meses</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {mostraTime && timeSentimento.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Pulso do time</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Semana</TableHead>
                <TableHead>Como foi</TableHead>
                <TableHead>Comentário</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeSentimento.slice(0, 40).map((linha) => (
                <TableRow key={linha.id}>
                  <TableCell className="font-medium">{linha.pessoaNome ?? NA}</TableCell>
                  <TableCell>{fmtData(linha.periodoEm)}</TableCell>
                  <TableCell>{rotuloRate(linha.rate)}</TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {linha.comentario ?? NA}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {mostraTime && data.prioridadesDoTime.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Prioridades do time</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Semana</TableHead>
                <TableHead>Prioridades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.prioridadesDoTime.slice(0, 40).map((linha) => (
                <TableRow key={linha.id}>
                  <TableCell className="font-medium">{linha.pessoaNome ?? NA}</TableCell>
                  <TableCell>{fmtData(linha.periodoEm)}</TableCell>
                  <TableCell className="text-sm">{linha.prioridades.join(" · ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function GenteElogiosTab() {
  const fn = useServerFn(listLideranca);
  const elogiarFn = useServerFn(publicarElogio);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<LiderancaResult>({
    queryKey: ["gente-lideranca"],
    queryFn: () => fn({}),
  });

  const [para, setPara] = useState<string>("");
  const [texto, setTexto] = useState("");

  const enviar = useMutation({
    mutationFn: () => elogiarFn({ data: { paraIds: [Number(para)], texto } }),
    onSuccess: () => {
      toast.success("Elogio publicado.");
      setTexto("");
      setPara("");
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (!data) return null;
  if (!data.podeElogios) return <SemPermissao o_que="ver o mural de elogios" />;
  if (!data.minhaPessoaId) return <SemCadastro />;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Elogiar alguém</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Elogio é público dentro da unidade. É a diferença entre ele e o feedback, que é privado.
        </p>
        <Select value={para} onValueChange={setPara}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Para quem" />
          </SelectTrigger>
          <SelectContent>
            {data.pessoasDaUnidade.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nome}
                {p.cargo ? ` · ${p.cargo}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          placeholder="O que essa pessoa fez que merece ser dito em voz alta?"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
        />
        <Button size="sm" onClick={() => enviar.mutate()} disabled={!para || enviar.isPending}>
          <Send className="mr-2 h-4 w-4" />
          Publicar
        </Button>
      </Card>

      {data.elogios.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhum elogio publicado ainda.</Card>
      ) : (
        <div className="space-y-3">
          {data.elogios.map((elogio) => (
            <Card key={elogio.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{elogio.deNome ?? NA}</span>
                <span className="text-muted-foreground">elogiou</span>
                <span className="font-medium">{elogio.paraNomes.join(", ") || NA}</span>
                <Badge variant="secondary">{fmtData(elogio.criadoEm)}</Badge>
              </div>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{elogio.texto}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
