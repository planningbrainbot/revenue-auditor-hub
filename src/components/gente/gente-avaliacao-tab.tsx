import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardCheck, Grid3X3, Lock, Target } from "lucide-react";
import {
  listAvaliacao,
  liberarDevolutiva,
  responderAvaliacao,
  salvarCalibracao,
  type AvaliacaoResult,
  type CalibracaoRow,
  type CicloRow,
  type FilaRow,
} from "@/lib/gente-avaliacao.functions";
import { Card } from "@/components/ui/card";
import { AvisoCorte, BotaoComMotivo, ErroDaFonte, dataSP } from "@/components/gente/estados-gente";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  Procedencia,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
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
  auto: "Autoavaliação",
  gestor: "Do gestor",
  par: "De par",
  liderado: "Do liderado",
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  coleta: "Em coleta",
  calibracao: "Em calibração",
  devolutiva: "Em devolutiva",
  encerrado: "Encerrado",
  importado: "Importado do Qulture",
};

// Situação do ciclo é etapa, não alarme: em andamento é `info`, fechado é `neutro`.
const STATUS_TOM: Record<string, TomStatus> = {
  rascunho: "info",
  coleta: "info",
  calibracao: "info",
  devolutiva: "info",
  encerrado: "neutro",
  importado: "neutro",
};

const FONTE = "as avaliações";
const CORTE_CALIBRACAO = 80;
const TODOS = "todos";

// Nota digitada no comitê: vazio é "sem nota"; aceita vírgula decimal.
function lerNota(v: string): number | null | "invalida" {
  const limpo = v.trim().replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : "invalida";
}

/**
 * Liberar devolutiva abre a nota para todos os avaliados do ciclo, de uma vez
 * (`liberarDevolutiva` sem `pessoaId`). Irreversível por aqui: confirma com o
 * efeito escrito, e não aparece em ciclo encerrado nem quando já foi liberada
 * para todos.
 */
function LiberarDevolutiva({
  ciclo,
  calibracao,
  liberar,
  pendente,
}: {
  ciclo: CicloRow;
  calibracao: CalibracaoRow[];
  liberar: (cicloId: number) => void;
  pendente: boolean;
}) {
  if (ciclo.status === "encerrado") return <span className="text-muted-foreground">{NA}</span>;
  const doCiclo = calibracao.filter((c) => c.cicloId === ciclo.id);
  const liberados = doCiclo.filter((c) => c.devolutivaEm).length;
  if (doCiclo.length > 0 && liberados === doCiclo.length)
    return <StatusBadge tom="sucesso">Liberada</StatusBadge>;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={pendente}>
          Liberar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Liberar a devolutiva de {ciclo.nome}?</AlertDialogTitle>
          <AlertDialogDescription>
            Todos os {ciclo.participantes} avaliados do ciclo passam a ver a devolutiva: a média das
            avaliações que receberam, por competência.
            {liberados > 0 ? ` ${liberados} já tinham a devolutiva liberada.` : ""} Não dá para
            desfazer por aqui.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => liberar(ciclo.id)}>
            Liberar devolutiva
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : NA;

const fmtNota = (n: number | null) => (n == null ? NA : Number(n).toFixed(2).replace(".", ","));

function Formulario({ item, aoSalvar }: { item: FilaRow; aoSalvar: () => void }) {
  const responderFn = useServerFn(responderAvaliacao);
  const [notas, setNotas] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      item.respostas.map((r) => [r.competenciaId, r.naoSeAplica ? "na" : String(r.nota ?? "")]),
    ),
  );
  const [comentarios, setComentarios] = useState<Record<number, string>>(() =>
    Object.fromEntries(item.respostas.map((r) => [r.competenciaId, r.comentario ?? ""])),
  );
  const [textos, setTextos] = useState<Record<number, string>>(() =>
    Object.fromEntries(item.discursivas.map((d) => [d.campoId, d.texto ?? ""])),
  );

  const escala: number[] = [];
  for (let n = item.escalaMin; n <= item.escalaMax; n += 1) escala.push(n);

  const enviar = useMutation({
    mutationFn: (concluir: boolean) =>
      responderFn({
        data: {
          avaliacaoId: item.id,
          concluir,
          respostas: item.competencias.map((c) => ({
            competenciaId: c.id,
            nota: notas[c.id] && notas[c.id] !== "na" ? Number(notas[c.id]) : null,
            comentario: comentarios[c.id] ?? null,
            naoSeAplica: notas[c.id] === "na",
          })),
          discursivas: item.campos
            .filter((c) => (textos[c.id] ?? "").trim())
            .map((c) => ({ campoId: c.id, texto: textos[c.id] })),
        },
      }),
    onSuccess: () => {
      toast.success("Avaliação salva.");
      aoSalvar();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const grupos = new Map<string, typeof item.competencias>();
  for (const comp of item.competencias) {
    const chave = comp.topico ?? comp.categoria ?? "Competências";
    grupos.set(chave, [...(grupos.get(chave) ?? []), comp]);
  }
  const porTopico = [...grupos.entries()];

  const faltando = item.competencias.filter((c) => !notas[c.id]).length;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{item.avaliadoNome ?? NA}</span>
        <span className="text-sm text-muted-foreground">{TIPO_LABEL[item.tipo] ?? item.tipo}</span>
        <span className="text-sm text-muted-foreground">· {item.cicloNome}</span>
      </div>

      {porTopico.map(([topico, competencias]) => (
        <div key={topico} className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {topico}
          </h4>
          {competencias.map((comp) => (
            <div key={comp.id} className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">{comp.nome}</div>
              <div className="flex flex-wrap gap-2">
                {escala.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={notas[comp.id] === String(n) ? "default" : "outline"}
                    onClick={() => setNotas({ ...notas, [comp.id]: String(n) })}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={notas[comp.id] === "na" ? "secondary" : "ghost"}
                  onClick={() => setNotas({ ...notas, [comp.id]: "na" })}
                >
                  Não se aplica
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="Comentário (opcional)"
                value={comentarios[comp.id] ?? ""}
                onChange={(e) => setComentarios({ ...comentarios, [comp.id]: e.target.value })}
              />
            </div>
          ))}
        </div>
      ))}

      {item.campos.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Perguntas abertas
          </h4>
          {item.campos.map((campo) => (
            <div key={campo.id} className="space-y-1">
              <Label className="text-sm">{campo.titulo}</Label>
              <Textarea
                rows={3}
                value={textos[campo.id] ?? ""}
                onChange={(e) => setTextos({ ...textos, [campo.id]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => enviar.mutate(false)}
          disabled={enviar.isPending}
        >
          Salvar rascunho
        </Button>
        <BotaoComMotivo
          size="sm"
          onClick={() => enviar.mutate(true)}
          disabled={enviar.isPending || faltando > 0}
          motivo={[
            faltando > 0 &&
              `Faltam ${faltando} de ${item.competencias.length} competências com nota ou "Não se aplica".`,
            enviar.isPending && "Salvando…",
          ]}
        >
          Concluir avaliação
        </BotaoComMotivo>
        {faltando > 0 && (
          <span className="text-xs text-muted-foreground">
            faltam {faltando} de {item.competencias.length}
          </span>
        )}
      </div>
    </Card>
  );
}

// "eu" é a fila do avaliador e o próprio resultado; "admin" é a condução do
// ciclo. Quem só responde não precisa ver a tabela de calibração da unidade.
export type Escopo = "eu" | "admin" | "tudo";

export function GenteAvaliacaoTab({ escopo = "tudo" }: { escopo?: Escopo } = {}) {
  const fn = useServerFn(listAvaliacao);
  const calibrarFn = useServerFn(salvarCalibracao);
  const devolutivaFn = useServerFn(liberarDevolutiva);
  const qc = useQueryClient();
  const q = useQuery<AvaliacaoResult>({
    queryKey: ["gente-avaliacao"],
    queryFn: () => fn({}),
  });
  const data = q.data;
  // O ciclo da calibração mora na URL (N7): recarregar ou mandar o link mantém o recorte.
  const [cicloAberto, setCicloAberto] = useFiltroNaUrl("ciclo", "");
  const [abertos, setAbertos] = useState<Record<number, boolean>>({});

  const calibrar = useMutation({
    mutationFn: (v: {
      cicloId: number;
      pessoaId: number;
      notaDesempenho: number | null;
      notaPotencial: number | null;
      caixa: string | null;
    }) => calibrarFn({ data: v }),
    onSuccess: () => {
      toast.success("Calibração salva.");
      qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const liberar = useMutation({
    mutationFn: (cicloId: number) => devolutivaFn({ data: { cicloId } }),
    onSuccess: () => {
      toast.success("Devolutiva liberada. A partir de agora cada pessoa lê a própria nota.");
      qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  // Em "Minha vez" o erro desta fonte já aparece em "O que espera por você".
  if (q.isLoading) return <Carregando variante="tabela" linhas={3} />;
  if (q.isError || !data) {
    if (escopo !== "tudo") return null;
    return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  }
  if (!data.podeVer) return <EstadoSemAcesso oQueFalta="view.gente.avaliacao" />;

  // Nota do comitê grava só quando mudou (antes gravava a cada saída do campo).
  const gravarNota = (
    linha: CalibracaoRow,
    eixo: "notaDesempenho" | "notaPotencial",
    digitado: string,
  ) => {
    const nota = lerNota(digitado);
    if (nota === "invalida") {
      toast.error(`"${digitado}" não é uma nota. Use número, como 3 ou 3,5.`);
      return;
    }
    if (nota === linha[eixo]) return;
    calibrar.mutate({
      cicloId: linha.cicloId,
      pessoaId: linha.pessoaId,
      notaDesempenho: eixo === "notaDesempenho" ? nota : linha.notaDesempenho,
      notaPotencial: eixo === "notaPotencial" ? nota : linha.notaPotencial,
      caixa: linha.caixa,
    });
  };

  const mostraEu = escopo !== "admin";
  const mostraAdmin = escopo !== "eu";
  const calibracaoDoCiclo = data.calibracao.filter(
    (c) => !cicloAberto || String(c.cicloId) === cicloAberto,
  );
  const calibracaoMostrada = calibracaoDoCiclo.slice(0, CORTE_CALIBRACAO);

  return (
    <div className="space-y-4">
      {mostraAdmin && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Ciclos</h3>
          </div>
          {data.ciclos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum ciclo de avaliação cadastrado"
              descricao="Quem conduz o ciclo (manage.gente.avaliacao) cria o ciclo, a escala e quem avalia quem."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ciclo</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Avaliados</TableHead>
                  <TableHead className="text-right">Avaliações</TableHead>
                  <TableHead className="text-right">Concluídas</TableHead>
                  {data.podeAdministrar && <TableHead className="text-right">Devolutiva</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ciclos.map((ciclo) => (
                  <TableRow key={ciclo.id}>
                    <TableCell className="font-medium">{ciclo.nome}</TableCell>
                    <TableCell>{fmtData(ciclo.periodoInicio)}</TableCell>
                    <TableCell>
                      <StatusBadge tom={STATUS_TOM[ciclo.status] ?? "neutro"}>
                        {STATUS_LABEL[ciclo.status] ?? ciclo.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="num text-right">{ciclo.participantes}</TableCell>
                    <TableCell className="num text-right">{ciclo.avaliacoes}</TableCell>
                    <TableCell className="num text-right">{ciclo.concluidas}</TableCell>
                    {data.podeAdministrar && (
                      <TableCell className="text-right">
                        <LiberarDevolutiva
                          ciclo={ciclo}
                          calibracao={data.calibracao}
                          liberar={(id) => liberar.mutate(id)}
                          pendente={liberar.isPending}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {mostraEu && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Minha fila de avaliação</h3>
            {data.fila.length > 0 && (
              <StatusBadge tom="atencao">
                <span className="num">{data.fila.length}</span> para responder
              </StatusBadge>
            )}
          </div>
          {data.fila.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma avaliação esperando sua resposta.
            </p>
          ) : (
            <div className="space-y-3">
              {data.fila.map((item) => (
                <div key={item.id} className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAbertos({ ...abertos, [item.id]: !abertos[item.id] })}
                  >
                    {abertos[item.id] ? "Fechar" : "Responder"} · {item.avaliadoNome ?? NA} ·{" "}
                    {TIPO_LABEL[item.tipo] ?? item.tipo}
                  </Button>
                  {abertos[item.id] && (
                    <Formulario
                      item={item}
                      aoSalvar={() => {
                        setAbertos({ ...abertos, [item.id]: false });
                        qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {mostraEu && (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Meu resultado</h3>
          {data.meuResultado.length === 0 ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Enquanto a devolutiva não for liberada, a nota existe e não aparece aqui. É o que
                permite ao seu gestor escrever com calma e ao comitê calibrar antes da conversa.
              </p>
            </div>
          ) : (
            <>
              {/* Régua do código (view v_gente_avaliacao_media_competencia): só
                avaliações concluídas, sem a autoavaliação, sem "não se aplica". */}
              <p className="mb-3 text-xs text-muted-foreground">
                Média por competência das avaliações concluídas que você recebeu, sem a sua
                autoavaliação e sem as respostas "Não se aplica".
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ciclo</TableHead>
                    <TableHead>Tópico</TableHead>
                    <TableHead>Competência</TableHead>
                    <TableHead className="text-right">
                      Média das avaliações recebidas (sem autoavaliação)
                    </TableHead>
                    <TableHead className="text-right">Notas na média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.meuResultado.map((linha, i) => (
                    <TableRow key={`${linha.cicloId}-${linha.competencia}-${i}`}>
                      <TableCell>{linha.cicloNome}</TableCell>
                      <TableCell>{linha.topico ?? NA}</TableCell>
                      <TableCell className="font-medium">{linha.competencia}</TableCell>
                      <TableCell className="num text-right">{fmtNota(linha.media)}</TableCell>
                      <TableCell className="num text-right">{linha.respostas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </Card>
      )}

      {mostraAdmin && data.podeAdministrar && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Calibração e nine box</h3>
            <Select
              value={cicloAberto || TODOS}
              onValueChange={(v) => setCicloAberto(v === TODOS ? "" : v)}
            >
              <SelectTrigger className="ml-auto w-72" aria-label="Ciclo da calibração">
                <SelectValue placeholder="Todos os ciclos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os ciclos</SelectItem>
                {data.ciclos.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            A média é sugestão, calculada das competências que o RH marcou em cada eixo, sem a
            autoavaliação. Quem decide a posição é o comitê.
          </p>
          {calibracaoDoCiclo.length === 0 ? (
            <EstadoVazio
              titulo="Ninguém para calibrar neste recorte"
              total={cicloAberto ? data.calibracao.length : undefined}
              descricao={
                cicloAberto ? undefined : "Os participantes dos ciclos aparecem aqui para o comitê."
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pessoa</TableHead>
                    <TableHead className="text-right">Desempenho (sugerido)</TableHead>
                    <TableHead className="text-right">Potencial (sugerido)</TableHead>
                    <TableHead className="text-right">Desempenho (comitê)</TableHead>
                    <TableHead className="text-right">Potencial (comitê)</TableHead>
                    <TableHead>Caixa</TableHead>
                    <TableHead>Devolutiva</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calibracaoMostrada.map((linha) => (
                    <TableRow key={`${linha.cicloId}-${linha.pessoaId}`}>
                      <TableCell className="font-medium">{linha.pessoaNome ?? NA}</TableCell>
                      <TableCell className="num text-right">
                        {fmtNota(linha.mediaDesempenho)}
                      </TableCell>
                      <TableCell className="num text-right">
                        {fmtNota(linha.mediaPotencial)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="num ml-auto w-20 text-right"
                          inputMode="decimal"
                          aria-label={`Desempenho do comitê para ${linha.pessoaNome ?? "a pessoa"}`}
                          defaultValue={linha.notaDesempenho ?? ""}
                          onBlur={(e) => gravarNota(linha, "notaDesempenho", e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="num ml-auto w-20 text-right"
                          inputMode="decimal"
                          aria-label={`Potencial do comitê para ${linha.pessoaNome ?? "a pessoa"}`}
                          defaultValue={linha.notaPotencial ?? ""}
                          onBlur={(e) => gravarNota(linha, "notaPotencial", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>{linha.caixa ?? NA}</TableCell>
                      <TableCell>{dataSP(linha.devolutivaEm)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3">
                <AvisoCorte
                  mostrando={calibracaoMostrada.length}
                  total={calibracaoDoCiclo.length}
                  oQue="pessoas"
                  criterio="na ordem do cadastro de participantes; escolha um ciclo para ver menos"
                />
              </div>
            </>
          )}
        </Card>
      )}

      {escopo === "tudo" && (
        <Procedencia
          fonte="Planning People: ciclos, avaliações e calibração"
          atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
          regua="médias só com avaliações concluídas, sem autoavaliação"
        />
      )}
    </div>
  );
}
