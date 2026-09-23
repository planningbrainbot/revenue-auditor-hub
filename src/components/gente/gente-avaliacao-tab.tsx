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
  type FilaRow,
} from "@/lib/gente-avaliacao.functions";
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
        <Badge variant="secondary">{TIPO_LABEL[item.tipo] ?? item.tipo}</Badge>
        <span className="font-semibold">{item.avaliadoNome ?? NA}</span>
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
        <Button
          size="sm"
          onClick={() => enviar.mutate(true)}
          disabled={enviar.isPending || faltando > 0}
        >
          Concluir avaliação
        </Button>
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
  const { data, isLoading } = useQuery<AvaliacaoResult>({
    queryKey: ["gente-avaliacao"],
    queryFn: () => fn({}),
  });
  const [cicloAberto, setCicloAberto] = useState<string>("");
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

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (!data) return null;
  if (!data.podeVer)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Seu perfil não tem a permissão de ver ciclo de avaliação.
      </Card>
    );

  const mostraEu = escopo !== "admin";
  const mostraAdmin = escopo !== "eu";
  const calibracaoDoCiclo = data.calibracao.filter(
    (c) => !cicloAberto || String(c.cicloId) === cicloAberto,
  );

  return (
    <div className="space-y-4">
      {mostraAdmin && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Ciclos</h3>
          </div>
          {data.ciclos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum ciclo cadastrado.</p>
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
                      <Badge variant={ciclo.origem === "qulture" ? "outline" : "secondary"}>
                        {STATUS_LABEL[ciclo.status] ?? ciclo.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{ciclo.participantes}</TableCell>
                    <TableCell className="text-right">{ciclo.avaliacoes}</TableCell>
                    <TableCell className="text-right">{ciclo.concluidas}</TableCell>
                    {data.podeAdministrar && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => liberar.mutate(ciclo.id)}
                          disabled={liberar.isPending}
                        >
                          Liberar
                        </Button>
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
            {data.fila.length > 0 && <Badge>{data.fila.length}</Badge>}
          </div>
          {data.fila.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada pendente para você responder.</p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ciclo</TableHead>
                  <TableHead>Tópico</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead className="text-right">Média</TableHead>
                  <TableHead className="text-right">Respostas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.meuResultado.map((linha, i) => (
                  <TableRow key={`${linha.cicloId}-${linha.competencia}-${i}`}>
                    <TableCell>{linha.cicloNome}</TableCell>
                    <TableCell>{linha.topico ?? NA}</TableCell>
                    <TableCell className="font-medium">{linha.competencia}</TableCell>
                    <TableCell className="text-right">{fmtNota(linha.media)}</TableCell>
                    <TableCell className="text-right">{linha.respostas}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {mostraAdmin && data.podeAdministrar && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-primary-text" />
            <h3 className="font-semibold">Calibração e nine box</h3>
            <Select value={cicloAberto} onValueChange={setCicloAberto}>
              <SelectTrigger className="ml-auto w-72">
                <SelectValue placeholder="Todos os ciclos" />
              </SelectTrigger>
              <SelectContent>
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
              {calibracaoDoCiclo.slice(0, 80).map((linha) => (
                <TableRow key={`${linha.cicloId}-${linha.pessoaId}`}>
                  <TableCell className="font-medium">{linha.pessoaNome ?? NA}</TableCell>
                  <TableCell className="text-right">{fmtNota(linha.mediaDesempenho)}</TableCell>
                  <TableCell className="text-right">{fmtNota(linha.mediaPotencial)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="ml-auto w-20 text-right"
                      defaultValue={linha.notaDesempenho ?? ""}
                      onBlur={(e) =>
                        calibrar.mutate({
                          cicloId: linha.cicloId,
                          pessoaId: linha.pessoaId,
                          notaDesempenho: e.target.value ? Number(e.target.value) : null,
                          notaPotencial: linha.notaPotencial,
                          caixa: linha.caixa,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="ml-auto w-20 text-right"
                      defaultValue={linha.notaPotencial ?? ""}
                      onBlur={(e) =>
                        calibrar.mutate({
                          cicloId: linha.cicloId,
                          pessoaId: linha.pessoaId,
                          notaDesempenho: linha.notaDesempenho,
                          notaPotencial: e.target.value ? Number(e.target.value) : null,
                          caixa: linha.caixa,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>{linha.caixa ?? NA}</TableCell>
                  <TableCell>{fmtData(linha.devolutivaEm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
