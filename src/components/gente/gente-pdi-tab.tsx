import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GraduationCap, Plus } from "lucide-react";
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
import { BotaoComMotivo, ErroDaFonte, SemCadastroNaRede } from "@/components/gente/estados-gente";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  Procedencia,
  StatusBadge,
  type TomStatus,
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

const PROGRESSO_LABEL: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  avancada: "Avançada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const PROGRESSO_TOM: Record<string, TomStatus> = {
  nao_iniciada: "neutro",
  em_andamento: "info",
  avancada: "info",
  concluida: "sucesso",
  cancelada: "neutro",
};

const FONTE = "os PDIs";

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
    mutationFn: (v: { id: number; progresso: string; titulo: string }) =>
      progressoFn({ data: { id: v.id, progresso: v.progresso } }),
    onSuccess: (_r, v) => {
      toast.success(
        `"${v.titulo}" agora está ${(PROGRESSO_LABEL[v.progresso] ?? v.progresso).toLowerCase()}.`,
      );
      aoMudar();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{plano.souEu ? "Meu PDI" : (plano.pessoaNome ?? NA)}</span>
        <span className="text-sm text-muted-foreground">· {plano.cicloNome}</span>
      </div>

      {plano.metas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma meta escrita ainda.</p>
      )}

      {plano.metas.map((meta) => (
        <div key={meta.id} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{meta.titulo}</span>
            <StatusBadge tom={PROGRESSO_TOM[meta.progresso] ?? "neutro"}>
              {PROGRESSO_LABEL[meta.progresso] ?? meta.progresso}
            </StatusBadge>
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
                  <TableRow key={acao.id}>
                    <TableCell>{acao.titulo}</TableCell>
                    <TableCell>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="num">{fmtData(acao.prazo)}</span>
                        {acao.atrasada && <StatusBadge tom="perigo">Atrasada</StatusBadge>}
                      </span>
                    </TableCell>
                    <TableCell>
                      {plano.souEu ? (
                        <Select
                          value={acao.progresso}
                          disabled={mudar.isPending && mudar.variables?.id === acao.id}
                          onValueChange={(v) =>
                            mudar.mutate({ id: acao.id, progresso: v, titulo: acao.titulo })
                          }
                        >
                          <SelectTrigger aria-label={`Situação de ${acao.titulo}`}>
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
                        <StatusBadge tom={PROGRESSO_TOM[acao.progresso] ?? "neutro"}>
                          {PROGRESSO_LABEL[acao.progresso] ?? acao.progresso}
                        </StatusBadge>
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
              <BotaoComMotivo
                size="sm"
                variant="outline"
                onClick={() => criarAcao.mutate(meta.id)}
                disabled={!novaAcao[meta.id]?.trim() || criarAcao.isPending}
                motivo={[
                  !novaAcao[meta.id]?.trim() && "Escreva a ação.",
                  criarAcao.isPending && "Gravando…",
                ]}
              >
                <Plus className="mr-1 h-4 w-4" />
                Adicionar
              </BotaoComMotivo>
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
          <div>
            {/* Desabilitado enquanto grava: o clique duplo criava a meta duas vezes. */}
            <BotaoComMotivo
              size="sm"
              onClick={() => criarMeta.mutate()}
              disabled={!novaMeta.trim() || criarMeta.isPending}
              motivo={[
                !novaMeta.trim() && "Escreva o que você quer desenvolver.",
                criarMeta.isPending && "Gravando a meta…",
              ]}
            >
              Criar meta
            </BotaoComMotivo>
          </div>
        </div>
      )}
    </Card>
  );
}

// "eu" é o meu plano; "time" é o acompanhamento de quem eu lidero.
export type Escopo = "eu" | "time" | "tudo";

export function GentePdiTab({ escopo = "tudo" }: { escopo?: Escopo } = {}) {
  const fn = useServerFn(listPdi);
  const criarFn = useServerFn(criarPdi);
  const qc = useQueryClient();
  const q = useQuery<PdiResult>({
    queryKey: ["gente-pdi"],
    queryFn: () => fn({}),
  });
  const data = q.data;

  const abrir = useMutation({
    mutationFn: (cicloId: number) => criarFn({ data: { cicloId } }),
    onSuccess: () => {
      toast.success("PDI aberto.");
      qc.invalidateQueries({ queryKey: ["gente-pdi"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  // Dentro de "Minha vez" e "Meu time" o erro desta fonte já aparece em "O que
  // espera por você", com "Tentar de novo".
  if (q.isLoading) return <Carregando variante="tabela" linhas={3} />;
  if (q.isError || !data) {
    if (escopo !== "tudo") return null;
    return <ErroDaFonte fonte={FONTE} erro={q.error} tentar={() => q.refetch()} />;
  }
  if (!data.podeVer) return <EstadoSemAcesso oQueFalta="view.gente.pdi" />;
  if (!data.minhaPessoaId) return <SemCadastroNaRede oQueDepende="O PDI" />;

  const mostraEu = escopo !== "time";
  const mostraTime = escopo !== "eu";
  const meus = mostraEu ? data.planos.filter((p) => p.souEu) : [];
  const doTime = mostraTime ? data.planos.filter((p) => !p.souEu) : [];
  const cicloAtivo = data.ciclos.find((c) => c.status === "ativo");

  return (
    <div className="space-y-4">
      {/* Na tela PDI o cabeçalho da página já diz o que é; o título fica para
          quando o bloco aparece dentro de "Minha vez" e "Meu time". */}
      {escopo !== "tudo" && (
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary-text" />
          <h3 className="font-semibold">Plano de desenvolvimento individual</h3>
        </div>
      )}

      {mostraEu && meus.length === 0 && cicloAtivo && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm">
            Você ainda não tem PDI no ciclo <strong>{cicloAtivo.nome}</strong>.
          </span>
          <Button size="sm" onClick={() => abrir.mutate(cicloAtivo.id)} disabled={abrir.isPending}>
            Abrir meu PDI
          </Button>
        </Card>
      )}

      {mostraEu && meus.length === 0 && !cicloAtivo && (
        <EstadoVazio
          titulo="Não há ciclo de PDI ativo"
          descricao="Você não tem PDI e não há ciclo aberto para começar um. Quem abre o ciclo é o RH da rede."
        />
      )}

      {meus.map((plano) => (
        <Plano
          key={plano.id}
          plano={plano}
          aoMudar={() => qc.invalidateQueries({ queryKey: ["gente-pdi"] })}
        />
      ))}

      {mostraTime && data.andamento.length > 0 && (
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
                  <TableCell className="num text-right">{linha.metas}</TableCell>
                  <TableCell className="num text-right">{linha.metasConcluidas}</TableCell>
                  <TableCell className="num text-right">{linha.acoes}</TableCell>
                  <TableCell className="num text-right">{linha.acoesConcluidas}</TableCell>
                  <TableCell className="num text-right">
                    {linha.acoesAtrasadas > 0 ? (
                      <StatusBadge tom="perigo">
                        <span className="num">{linha.acoesAtrasadas}</span> atrasada(s)
                      </StatusBadge>
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

      {escopo === "tudo" && (
        <Procedencia
          fonte="Planning People: PDI (metas e ações)"
          atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
          regua="ação atrasada = prazo anterior a hoje e ação não concluída"
        />
      )}
    </div>
  );
}
