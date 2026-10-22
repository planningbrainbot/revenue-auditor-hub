import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  StatusBadge,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHAVE } from "@/components/tarefas/comum";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { criarQuadro, listarQuadros } from "@/lib/tarefas/tarefas.functions";

// Quadros de que sou membro, e a porta para criar um novo (contrato tarefas.md).

export const Route = createFileRoute("/_authenticated/tarefas/quadros/")({
  head: () => ({ meta: [{ title: "Quadros · Planning Brain" }] }),
  component: Pagina,
});

const TITULO = "Quadros";
const PERGUNTA = "Em que quadros eu trabalho?";

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <Carregando variante="kpis" />
      </main>
    );
  if (!perms.temArea("tarefas"))
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <EstadoSemAcesso oQueFalta="a área Tarefas (a administração concede)" />
      </main>
    );
  return <ComAcesso />;
}

function ComAcesso() {
  const { user } = useAuth();
  const fn = useServerFn(listarQuadros);
  const q = useQuery({
    queryKey: [...CHAVE, "quadros", user?.id],
    enabled: !!user?.id,
    queryFn: () => fn(),
    retry: false,
  });
  const [criando, setCriando] = useState(false);

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="tarefas"
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="Quadros de que você é membro · contagem: tarefas abertas de cada quadro, de todo mundo."
        acoes={
          <Button onClick={() => setCriando(true)}>
            <Plus className="size-4" aria-hidden />
            Criar quadro
          </Button>
        }
      />
      {q.isLoading || !user?.id ? (
        <Carregando variante="kpis" />
      ) : q.isError ? (
        <EstadoErro
          titulo="Os quadros não carregaram"
          detalhe={`Fonte: ops.tarefas_quadros. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      ) : !q.data?.length ? (
        <EstadoVazio
          titulo="Você ainda não está em nenhum quadro"
          descricao="Um quadro junta as tarefas de um grupo de pessoas. Quem cria é o dono e convida os outros."
          acao={<Button onClick={() => setCriando(true)}>Criar quadro</Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((b) => (
            <li key={b.id}>
              <Link
                to="/tarefas/quadros/$quadroId"
                params={{ quadroId: b.id }}
                className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold leading-snug">{b.nome}</h2>
                  {b.meuPapel === "dono" && (
                    <StatusBadge tom="info" icone={false}>
                      Dono
                    </StatusBadge>
                  )}
                </div>
                {b.descricao && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{b.descricao}</p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Users className="size-4" aria-hidden />
                    {b.membros} {b.membros === 1 ? "pessoa" : "pessoas"}
                  </span>
                  <span className="tabular-nums">
                    {b.abertas} {b.abertas === 1 ? "aberta" : "abertas"}
                  </span>
                  {b.atrasadas > 0 && (
                    <StatusBadge tom="perigo">
                      {b.atrasadas} {b.atrasadas === 1 ? "atrasada" : "atrasadas"}
                    </StatusBadge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <DialogoCriarQuadro aberto={criando} aoFechar={() => setCriando(false)} />
    </main>
  );
}

function DialogoCriarQuadro({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const fn = useServerFn(criarQuadro);
  const criar = useMutation({
    mutationFn: () => fn({ data: { nome, descricao } }),
    onSuccess: (r) => {
      client.invalidateQueries({ queryKey: CHAVE });
      toast.success("Quadro criado. Convide as pessoas em Configurar quadro.");
      aoFechar();
      setNome("");
      setDescricao("");
      navigate({
        to: "/tarefas/quadros/$quadroId",
        params: { quadroId: r.id },
        search: { config: true },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar quadro</DialogTitle>
          <DialogDescription>
            Nasce com as colunas A fazer, Fazendo e Feito, e com você de dono. Depois você convida
            as pessoas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim()) criar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="nq-nome">Nome</Label>
            <Input
              id="nq-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nq-desc">Descrição (opcional)</Label>
            <Textarea
              id="nq-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nome.trim() || criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar quadro"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
