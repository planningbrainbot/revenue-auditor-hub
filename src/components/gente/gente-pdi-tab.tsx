import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, GraduationCap, Plus } from "lucide-react";
import {
  criarPdi,
  listPdi,
  mudarProgressoAcao,
  salvarAcao,
  salvarMeta,
  type PdiResult,
  type PdiRow,
} from "@/lib/gente-pdi.functions";
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

const PROGRESSO_LABEL: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  avancada: "Avançada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : NA;

function Plano({ plano, aoMudar }: { plano: PdiRow; aoMudar: () => void }) {
  const metaFn = useServerFn(salvarMeta);
  const acaoFn = useServerFn(salvarAcao);
  const progressoFn = useServerFn(mudarProgressoAcao);
  const [novaMeta, setNovaMeta] = useState("");
  const [descricao, setDescricao] = useState("");
  const [novaAcao, setNovaAcao] = useState<Record<number, string>>({});
  const [prazo, setPrazo] = useState<Record<number, string>>({});

  const criarMeta = useMutation({
    mutationFn: () => metaFn({ data: { pdiId: plano.id, titulo: novaMeta, descricao } }),
    onSuccess: () => {
      toast.success("Meta criada.");
      setNovaMeta("");
      setDescricao("");
      aoMudar();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const criarAcao = useMutation({
    mutationFn: (metaId: number) =>
      acaoFn({ data: { metaId, titulo: novaAcao[metaId] ?? "", prazo: prazo[metaId] || null } }),
    onSuccess: () => {
      toast.success("Ação criada.");
      setNovaAcao({});
      setPrazo({});
      aoMudar();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const mudar = useMutation({
    mutationFn: (v: { id: number; progresso: string }) => progressoFn({ data: v }),
    onSuccess: aoMudar,
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{plano.souEu ? "Meu PDI" : (plano.pessoaNome ?? NA)}</span>
        <Badge variant="secondary">{plano.cicloNome}</Badge>
      </div>

      {plano.metas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma meta escrita ainda.</p>
      )}

      {plano.metas.map((meta) => (
        <div key={meta.id} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{meta.titulo}</span>
            <Badge variant="outline">{PROGRESSO_LABEL[meta.progresso] ?? meta.progresso}</Badge>
          </div>
          {meta.descricao && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{meta.descricao}</p>
          )}
          {meta.acoes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="w-48">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meta.acoes.map((acao) => (
                  <TableRow key={acao.id} className={acao.atrasada ? "bg-destructive/5" : ""}>
                    <TableCell>{acao.titulo}</TableCell>
                    <TableCell>
                      {fmtData(acao.prazo)}
                      {acao.atrasada && (
                        <Badge variant="destructive" className="ml-2">
                          atrasada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {plano.souEu ? (
                        <Select
                          value={acao.progresso}
                          onValueChange={(v) => mudar.mutate({ id: acao.id, progresso: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PROGRESSO_LABEL).map(([valor, rotulo]) => (
                              <SelectItem key={valor} value={valor}>
                                {rotulo}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        (PROGRESSO_LABEL[acao.progresso] ?? acao.progresso)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {plano.souEu && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1">
                <Label className="text-xs">Nova ação</Label>
                <Input
                  value={novaAcao[meta.id] ?? ""}
                  onChange={(e) => setNovaAcao({ ...novaAcao, [meta.id]: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prazo</Label>
                <Input
                  type="date"
                  value={prazo[meta.id] ?? ""}
                  onChange={(e) => setPrazo({ ...prazo, [meta.id]: e.target.value })}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => criarAcao.mutate(meta.id)}
                disabled={!novaAcao[meta.id]}
              >
                <Plus className="mr-1 h-4 w-4" />
                Adicionar
              </Button>
            </div>
          )}
        </div>
      ))}

      {plano.souEu && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Label className="text-sm font-medium">Nova meta de desenvolvimento</Label>
          <Input
            placeholder="O que você quer desenvolver?"
            value={novaMeta}
            onChange={(e) => setNovaMeta(e.target.value)}
          />
          <Textarea
            rows={2}
            placeholder="Por que isso importa agora? (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <Button size="sm" onClick={() => criarMeta.mutate()} disabled={!novaMeta}>
            Criar meta
          </Button>
        </div>
      )}
    </Card>
  );
}

export function GentePdiTab() {
  const fn = useServerFn(listPdi);
  const criarFn = useServerFn(criarPdi);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PdiResult>({
    queryKey: ["gente-pdi"],
    queryFn: () => fn({}),
  });

  const abrir = useMutation({
    mutationFn: (cicloId: number) => criarFn({ data: { cicloId } }),
    onSuccess: () => {
      toast.success("PDI aberto.");
      qc.invalidateQueries({ queryKey: ["gente-pdi"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (!data) return null;
  if (!data.podeVer)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Seu perfil não tem a permissão de ver PDI.
      </Card>
    );
  if (!data.minhaPessoaId)
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">Seu usuário não está no cadastro de gente da rede.</div>
        </div>
      </Card>
    );

  const meus = data.planos.filter((p) => p.souEu);
  const doTime = data.planos.filter((p) => !p.souEu);
  const cicloAtivo = data.ciclos.find((c) => c.status === "ativo");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Plano de desenvolvimento individual</h3>
      </div>

      {meus.length === 0 && cicloAtivo && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm">
            Você ainda não tem PDI no ciclo <strong>{cicloAtivo.nome}</strong>.
          </span>
          <Button size="sm" onClick={() => abrir.mutate(cicloAtivo.id)} disabled={abrir.isPending}>
            Abrir meu PDI
          </Button>
        </Card>
      )}

      {meus.map((plano) => (
        <Plano
          key={plano.id}
          plano={plano}
          aoMudar={() => qc.invalidateQueries({ queryKey: ["gente-pdi"] })}
        />
      ))}

      {data.andamento.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Andamento do time</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead className="text-right">Metas</TableHead>
                <TableHead className="text-right">Metas concluídas</TableHead>
                <TableHead className="text-right">Ações</TableHead>
                <TableHead className="text-right">Ações concluídas</TableHead>
                <TableHead className="text-right">Atrasadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.andamento.map((linha) => (
                <TableRow key={linha.pdiId}>
                  <TableCell className="font-medium">{linha.pessoaNome}</TableCell>
                  <TableCell className="text-right">{linha.metas}</TableCell>
                  <TableCell className="text-right">{linha.metasConcluidas}</TableCell>
                  <TableCell className="text-right">{linha.acoes}</TableCell>
                  <TableCell className="text-right">{linha.acoesConcluidas}</TableCell>
                  <TableCell className="text-right">
                    {linha.acoesAtrasadas > 0 ? (
                      <Badge variant="destructive">{linha.acoesAtrasadas}</Badge>
                    ) : (
                      0
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {doTime.map((plano) => (
        <Plano
          key={plano.id}
          plano={plano}
          aoMudar={() => qc.invalidateQueries({ queryKey: ["gente-pdi"] })}
        />
      ))}
    </div>
  );
}
