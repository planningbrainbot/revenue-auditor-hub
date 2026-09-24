import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, HeartPulse, ListChecks, Send, Sparkles } from "lucide-react";
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
import {
  AvisoCorte,
  BotaoComMotivo,
  ErroDaFonte,
  SemCadastroNaRede,
  dataSP,
} from "@/components/gente/estados-gente";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
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

const FONTE = "o pulso, as prioridades e as cadências";
// A consulta pede no máximo 400 registros de pulso e 400 de prioridades, e 50
// elogios (`listLideranca`); a régua da procedência diz isso.
const LIMITE_PULSO = 400;
const LIMITE_ELOGIOS = 50;
const CORTE_TABELA = 40;

const CADENCIAS: { valor: string; rotulo: string }[] = [
  { valor: "7", rotulo: "Semanal" },
  { valor: "14", rotulo: "Quinzenal" },
  { valor: "30", rotulo: "Mensal" },
  { valor: "60", rotulo: "A cada 2 meses" },
];

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
  const q = useQuery<LiderancaResult>({
    queryKey: ["gente-lideranca"],
    queryFn: () => fn({}),
  });
  const data = q.data;

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
    mutationFn: (v: { lideradoId: number; intervaloDias: number; nome: string }) =>
      cadenciaFn({ data: { lideradoId: v.lideradoId, intervaloDias: v.intervaloDias } }),
    onSuccess: (_r, v) => {
      const rotulo = CADENCIAS.find((c) => c.valor === String(v.intervaloDias))?.rotulo;
      toast.success(
        `Cadência com ${v.nome}: ${(rotulo ?? `${v.intervaloDias} dias`).toLowerCase()}.`,
      );
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const timeSentimento = useMemo(
    () => ultimoPorPessoa(data?.sentimentosDoTime ?? []),
    [data?.sentimentosDoTime],
  );

  // Separados (contrato gente.md, "Estados"). Dentro de "Minha vez" e "Meu time"
  // o erro desta fonte já aparece em "O que espera por você", com "Tentar de
  // novo"; repeti-lo embaixo seria o mesmo aviso duas vezes.
  if (q.isLoading) return <Carregando variante="tabela" linhas={3} />;
  if (q.isError || !data) {
    if (escopo !== "tudo") return null;
    return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  }
  if (!data.podeLideranca) return <EstadoSemAcesso oQueFalta="view.gente.lideranca" />;
  if (!data.minhaPessoaId)
    return <SemCadastroNaRede oQueDepende="Sentimento, prioridades e cadência" />;

  const atrasados = data.cadencias.filter((c) => c.atrasado);
  const mostraEu = escopo !== "time";
  const mostraTime = escopo !== "eu";
  const pulsoMostrado = timeSentimento.slice(0, CORTE_TABELA);
  const prioridadesMostradas = data.prioridadesDoTime.slice(0, CORTE_TABELA);
  const lidera = data.meuTime.length > 0;

  return (
    <div className="space-y-4">
      {mostraEu && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-primary-text" />
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
              <ListChecks className="h-4 w-4 text-primary-text" />
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

      {/* Na tela Sentimento, quem não lidera ninguém vê só o próprio pulso; a
          frase diz por que as tabelas do time não aparecem. */}
      {escopo === "tudo" && !lidera && (
        <p className="text-sm text-muted-foreground">
          Você não lidera ninguém no cadastro da rede, então o pulso, as prioridades e a cadência do
          time não aparecem aqui.
        </p>
      )}

      {mostraTime && lidera && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Cadência de 1:1 com meu time</h3>
            {atrasados.length > 0 && (
              <StatusBadge tom="perigo">
                <span className="num">{atrasados.length}</span> atrasado(s)
              </StatusBadge>
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
                  <TableRow key={pessoa.id}>
                    <TableCell className="font-medium">{pessoa.nome}</TableCell>
                    <TableCell>
                      {cadencia ? `${cadencia.intervaloDias} dias` : "sem combinado"}
                    </TableCell>
                    <TableCell>{fmtData(cadencia?.ultimoEm ?? null)}</TableCell>
                    <TableCell>
                      {cadencia?.diasDesde != null ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="num">{cadencia.diasDesde}</span>
                          {cadencia.atrasado && <StatusBadge tom="perigo">Atrasado</StatusBadge>}
                        </span>
                      ) : (
                        NA
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Select
                        value={String(cadencia?.intervaloDias ?? "")}
                        disabled={
                          gravarCadencia.isPending &&
                          gravarCadencia.variables?.lideradoId === pessoa.id
                        }
                        onValueChange={(v) =>
                          gravarCadencia.mutate({
                            lideradoId: pessoa.id,
                            intervaloDias: Number(v),
                            nome: pessoa.nome,
                          })
                        }
                      >
                        <SelectTrigger
                          className="ml-auto w-36"
                          aria-label={`Cadência de 1:1 com ${pessoa.nome}`}
                        >
                          <SelectValue placeholder="Intervalo" />
                        </SelectTrigger>
                        <SelectContent>
                          {CADENCIAS.map((c) => (
                            <SelectItem key={c.valor} value={c.valor}>
                              {c.rotulo}
                            </SelectItem>
                          ))}
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

      {mostraTime && lidera && timeSentimento.length === 0 && (
        <EstadoVazio
          titulo="Ninguém do time respondeu o pulso ainda"
          descricao="Cada pessoa responde em Minha vez ou nesta tela; a resposta mais recente de cada uma aparece aqui."
        />
      )}

      {mostraTime && timeSentimento.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-1 font-semibold">Pulso do time</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            A resposta mais recente de cada pessoa, da mais nova para a mais antiga.
          </p>
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
              {pulsoMostrado.map((linha) => (
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
          <div className="mt-3">
            <AvisoCorte
              mostrando={pulsoMostrado.length}
              total={timeSentimento.length}
              oQue="pessoas com pulso"
            />
          </div>
        </Card>
      )}

      {mostraTime && lidera && data.prioridadesDoTime.length === 0 && (
        <EstadoVazio
          titulo="Ninguém do time escreveu prioridades ainda"
          descricao="As prioridades da semana de cada pessoa aparecem aqui assim que forem salvas."
        />
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
              {prioridadesMostradas.map((linha) => (
                <TableRow key={linha.id}>
                  <TableCell className="font-medium">{linha.pessoaNome ?? NA}</TableCell>
                  <TableCell>{fmtData(linha.periodoEm)}</TableCell>
                  <TableCell className="text-sm">{linha.prioridades.join(" · ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3">
            <AvisoCorte
              mostrando={prioridadesMostradas.length}
              total={data.prioridadesDoTime.length}
              oQue="registros de prioridades"
            />
          </div>
        </Card>
      )}

      {escopo === "tudo" && (
        <Procedencia
          fonte="Planning People: pulso, prioridades e cadências de 1:1"
          atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
          regua={`até os ${LIMITE_PULSO} registros de pulso e ${LIMITE_PULSO} de prioridades mais recentes que você enxerga`}
        />
      )}
    </div>
  );
}

export function GenteElogiosTab() {
  const fn = useServerFn(listLideranca);
  const elogiarFn = useServerFn(publicarElogio);
  const qc = useQueryClient();
  const q = useQuery<LiderancaResult>({
    queryKey: ["gente-lideranca"],
    queryFn: () => fn({}),
  });
  const data = q.data;

  const [para, setPara] = useState<string>("");
  const [texto, setTexto] = useState("");

  const enviar = useMutation({
    mutationFn: () => elogiarFn({ data: { paraIds: [Number(para)], texto: texto.trim() } }),
    onSuccess: () => {
      toast.success("Elogio publicado.");
      setTexto("");
      setPara("");
      qc.invalidateQueries({ queryKey: ["gente-lideranca"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  if (q.isLoading) return <Carregando variante="tabela" linhas={3} />;
  if (q.isError || !data)
    return <ErroDaFonte fonte="os elogios" erro={q.error} tentar={() => q.refetch()} />;
  if (!data.podeElogios) return <EstadoSemAcesso oQueFalta="view.gente.elogios" />;
  if (!data.minhaPessoaId) return <SemCadastroNaRede oQueDepende="O mural de elogios" />;

  // Elogio vazio só voltava com erro do servidor depois do clique; agora o botão
  // fica desabilitado e diz o que falta.
  const motivoPublicar = [
    !para && "Escolha para quem é o elogio.",
    !texto.trim() && "Escreva o que a pessoa fez.",
    enviar.isPending && "Publicando…",
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary-text" />
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
        <div>
          <BotaoComMotivo
            size="sm"
            onClick={() => enviar.mutate()}
            disabled={!para || !texto.trim() || enviar.isPending}
            motivo={motivoPublicar}
          >
            <Send className="mr-2 h-4 w-4" />
            Publicar
          </BotaoComMotivo>
        </div>
      </Card>

      {data.elogios.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum elogio publicado ainda"
          descricao="O primeiro elogio da unidade aparece aqui, para todos da unidade."
        />
      ) : (
        <div className="space-y-3">
          {data.elogios.map((elogio) => (
            <Card key={elogio.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{elogio.deNome ?? NA}</span>
                <span className="text-muted-foreground">elogiou</span>
                <span className="font-medium">{elogio.paraNomes.join(", ") || NA}</span>
                <span className="num text-xs text-muted-foreground">{dataSP(elogio.criadoEm)}</span>
              </div>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{elogio.texto}</p>
            </Card>
          ))}
          <AvisoCorte
            mostrando={data.elogios.length}
            oQue="elogios"
            limiteDoServidor={LIMITE_ELOGIOS}
          />
        </div>
      )}

      <Procedencia
        fonte="Planning People: mural de elogios da unidade"
        atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
        regua={`os ${LIMITE_ELOGIOS} elogios mais recentes que você enxerga`}
      />
    </div>
  );
}
