import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/planning";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  apagarColuna,
  buscarPessoas,
  convidar,
  editarQuadro,
  mudarPapel,
  removerMembro,
  salvarColuna,
  salvarProjeto,
  type Coluna,
  type QuadroCompleto,
} from "@/lib/tarefas/tarefas.functions";
import { CHAVE } from "./comum";

// Configurar quadro: nome, pessoas, colunas e projetos. O dono mexe em tudo; o membro vê
// quem está no quadro e pode sair. Quem decide de verdade é o banco (ops.tarefas_*).

export function ConfigQuadro({
  aberto,
  aoFechar,
  dados,
  eu,
}: {
  aberto: boolean;
  aoFechar: () => void;
  dados: QuadroCompleto;
  eu: string;
}) {
  const souDono = dados.quadro.meuPapel === "dono";
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full space-y-8 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{souDono ? "Configurar quadro" : "Sobre o quadro"}</SheetTitle>
          <SheetDescription>
            {souDono
              ? "Você é dono: convida pessoas, muda colunas e projetos."
              : "Só o dono do quadro muda pessoas, colunas e projetos."}
          </SheetDescription>
        </SheetHeader>
        {souDono && <Basico dados={dados} />}
        <Pessoas dados={dados} eu={eu} souDono={souDono} aoSair={aoFechar} />
        {souDono && <Colunas dados={dados} />}
        {souDono && <Projetos dados={dados} />}
        {souDono && <Arquivar dados={dados} />}
      </SheetContent>
    </Sheet>
  );
}

function useSalvar<T>(fn: (v: T) => Promise<unknown>, ok?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (ok) toast.success(ok);
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      client.invalidateQueries({ queryKey: CHAVE });
    },
  });
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

function Basico({ dados }: { dados: QuadroCompleto }) {
  const fn = useServerFn(editarQuadro);
  const salvar = useSalvar((p: { nome?: string; descricao?: string | null }) =>
    fn({ data: { quadroId: dados.quadro.id, ...p } }),
  );
  const [nome, setNome] = useState(dados.quadro.nome);
  const [descricao, setDescricao] = useState(dados.quadro.descricao ?? "");
  useEffect(() => setNome(dados.quadro.nome), [dados.quadro.nome]);
  return (
    <Secao titulo="Quadro">
      <div className="space-y-1.5">
        <Label htmlFor="cq-nome">Nome</Label>
        <Input
          id="cq-nome"
          value={nome}
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() =>
            nome.trim()
              ? nome.trim() !== dados.quadro.nome && salvar.mutate({ nome: nome.trim() })
              : setNome(dados.quadro.nome)
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cq-desc">Descrição</Label>
        <Textarea
          id="cq-desc"
          value={descricao}
          rows={2}
          onChange={(e) => setDescricao(e.target.value)}
          onBlur={() =>
            descricao.trim() !== (dados.quadro.descricao ?? "") &&
            salvar.mutate({ descricao: descricao.trim() || null })
          }
        />
      </div>
    </Secao>
  );
}

function Pessoas({
  dados,
  eu,
  souDono,
  aoSair,
}: {
  dados: QuadroCompleto;
  eu: string;
  souDono: boolean;
  aoSair: () => void;
}) {
  const navigate = useNavigate();
  const q = dados.quadro.id;
  const papelFn = useServerFn(mudarPapel);
  const papel = useSalvar((v: { userId: string; papel: string }) =>
    papelFn({ data: { quadroId: q, ...v } }),
  );
  const removerFn = useServerFn(removerMembro);
  const remover = useSalvar((userId: string) => removerFn({ data: { quadroId: q, userId } }));
  const [confirmar, setConfirmar] = useState<{ userId: string; nome: string } | null>(null);

  const [termo, setTermo] = useState("");
  const [atrasado, setAtrasado] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(termo.trim()), 300);
    return () => clearTimeout(t);
  }, [termo]);
  const buscarFn = useServerFn(buscarPessoas);
  const achados = useQuery({
    queryKey: [...CHAVE, "pessoas", q, atrasado],
    enabled: souDono && atrasado.length >= 2,
    queryFn: () => buscarFn({ data: { quadroId: q, texto: atrasado } }),
    retry: false,
  });
  const client = useQueryClient();
  const convidarFn = useServerFn(convidar);
  const convidarM = useMutation({
    mutationFn: (p: { userId: string; nome: string }) =>
      convidarFn({ data: { quadroId: q, userId: p.userId } }),
    onSuccess: (_r, p) => {
      toast.success(`${p.nome} entrou no quadro.`);
      setTermo("");
      client.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Secao titulo={`Pessoas (${dados.membros.length})`}>
      <ul className="divide-y rounded-lg border">
        {dados.membros.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.nome}
                {m.userId === eu && <span className="text-muted-foreground"> (você)</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            {souDono ? (
              <Select
                value={m.papel}
                onValueChange={(v) => papel.mutate({ userId: m.userId, papel: v })}
              >
                <SelectTrigger className="h-8 w-28" aria-label={`Papel de ${m.nome}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dono">Dono</SelectItem>
                  <SelectItem value="membro">Membro</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <StatusBadge tom={m.papel === "dono" ? "info" : "neutro"} icone={false}>
                {m.papel === "dono" ? "Dono" : "Membro"}
              </StatusBadge>
            )}
            {(souDono || m.userId === eu) && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={m.userId === eu ? "Sair do quadro" : `Remover ${m.nome}`}
                onClick={() => setConfirmar({ userId: m.userId, nome: m.nome })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {souDono && (
        <div className="space-y-2">
          <Label htmlFor="cq-convite">Convidar</Label>
          <Input
            id="cq-convite"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Nome ou e-mail de quem já tem login no Ops"
          />
          {atrasado.length >= 2 && (
            <ul className="divide-y rounded-lg border">
              {achados.isLoading ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li>
              ) : achados.isError ? (
                <li className="px-3 py-2 text-sm text-danger">
                  {(achados.error as Error).message}
                </li>
              ) : !achados.data?.length ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Ninguém com a área Tarefas por esse nome. Quem não tem login entra pelo cadastro e
                  a administração libera.
                </li>
              ) : (
                achados.data.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={convidarM.isPending}
                      onClick={() => convidarM.mutate(p)}
                    >
                      <UserPlus className="size-4" aria-hidden />
                      Convidar
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(v) => !v && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar?.userId === eu
                ? "Sair do quadro?"
                : `Remover ${confirmar?.nome} do quadro?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              As tarefas que estavam com {confirmar?.userId === eu ? "você" : "essa pessoa"} ficam
              sem responsável.
              {confirmar?.userId === eu && " Para voltar, o dono precisa convidar de novo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmar) return;
                const saindo = confirmar.userId === eu;
                remover.mutate(confirmar.userId, {
                  onSuccess: () => {
                    if (saindo) {
                      aoSair();
                      navigate({ to: "/tarefas/quadros" });
                    }
                  },
                });
              }}
            >
              {confirmar?.userId === eu ? "Sair" : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}

function Colunas({ dados }: { dados: QuadroCompleto }) {
  const q = dados.quadro.id;
  const salvarFn = useServerFn(salvarColuna);
  const salvar = useSalvar(
    (v: { id?: string; nome?: string; ordem?: number; concluida?: boolean }) =>
      salvarFn({ data: { quadroId: q, ...v } }),
  );
  const apagarFn = useServerFn(apagarColuna);
  const apagar = useSalvar(
    (v: { colunaId: string; destinoId: string | null }) => apagarFn({ data: v }),
    "Coluna apagada.",
  );
  const [nova, setNova] = useState("");
  const [apagando, setApagando] = useState<Coluna | null>(null);
  const [destino, setDestino] = useState<string>("");
  const cols = dados.colunas;
  const tarefasNa = (id: string) => dados.tarefas.filter((t) => t.colunaId === id).length;

  function trocar(i: number, j: number) {
    // Reescreve a ordem das duas pelo índice: a ordem guardada pode ter buracos.
    salvar.mutate({ id: cols[i].id, ordem: j });
    salvar.mutate({ id: cols[j].id, ordem: i });
  }

  return (
    <Secao titulo="Colunas">
      <p className="text-xs text-muted-foreground">
        Coluna marcada como concluída tira a tarefa de Abertas e de Minhas tarefas.
      </p>
      <ul className="space-y-2">
        {cols.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <Input
              defaultValue={c.nome}
              key={c.nome}
              maxLength={60}
              aria-label={`Nome da coluna ${c.nome}`}
              className="h-8"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.nome) salvar.mutate({ id: c.id, nome: v });
              }}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={c.concluida}
                onCheckedChange={(v) => salvar.mutate({ id: c.id, concluida: v })}
              />
              Concluída
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={i === 0}
              aria-label="Subir"
              onClick={() => trocar(i, i - 1)}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={i === cols.length - 1}
              aria-label="Descer"
              onClick={() => trocar(i, i + 1)}
            >
              <ArrowDown className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={cols.length <= 1}
              aria-label={`Apagar a coluna ${c.nome}`}
              onClick={() => {
                if (tarefasNa(c.id) === 0)
                  return apagar.mutate({ colunaId: c.id, destinoId: null });
                setDestino(cols.find((x) => x.id !== c.id)?.id ?? "");
                setApagando(c);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!nova.trim()) return;
          salvar.mutate(
            { nome: nova.trim(), ordem: cols.length },
            { onSuccess: () => setNova("") },
          );
        }}
      >
        <Input
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          placeholder="Nova coluna"
          maxLength={60}
          className="h-8"
          aria-label="Nova coluna"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!nova.trim()}>
          Adicionar
        </Button>
      </form>

      <AlertDialog open={!!apagando} onOpenChange={(v) => !v && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar a coluna “{apagando?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela tem {apagando ? tarefasNa(apagando.id) : 0} tarefa(s). Escolha para qual coluna
              elas vão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger aria-label="Coluna de destino">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cols
                .filter((c) => c.id !== apagando?.id)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!destino}
              onClick={() =>
                apagando && apagar.mutate({ colunaId: apagando.id, destinoId: destino })
              }
            >
              Mover e apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}

function Projetos({ dados }: { dados: QuadroCompleto }) {
  const q = dados.quadro.id;
  const fn = useServerFn(salvarProjeto);
  const salvar = useSalvar((v: { id?: string; nome?: string; arquivar?: boolean }) =>
    fn({ data: { quadroId: q, ...v } }),
  );
  const [novo, setNovo] = useState("");
  return (
    <Secao titulo="Projetos">
      <p className="text-xs text-muted-foreground">
        Os projetos são deste quadro. Arquivado some das opções, mas fica nas tarefas que já tinham.
      </p>
      {dados.projetos.length > 0 && (
        <ul className="space-y-2">
          {dados.projetos.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Input
                defaultValue={p.nome}
                key={p.nome}
                maxLength={80}
                className="h-8"
                aria-label={`Nome do projeto ${p.nome}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== p.nome) salvar.mutate({ id: p.id, nome: v });
                }}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  checked={!p.arquivado}
                  onCheckedChange={(v) => salvar.mutate({ id: p.id, arquivar: !v })}
                />
                Ativo
              </label>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (novo.trim()) salvar.mutate({ nome: novo.trim() }, { onSuccess: () => setNovo("") });
        }}
      >
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Novo projeto"
          maxLength={80}
          className="h-8"
          aria-label="Novo projeto"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!novo.trim()}>
          Adicionar
        </Button>
      </form>
    </Secao>
  );
}

function Arquivar({ dados }: { dados: QuadroCompleto }) {
  const navigate = useNavigate();
  const fn = useServerFn(editarQuadro);
  const arquivar = useSalvar(
    () => fn({ data: { quadroId: dados.quadro.id, arquivar: true } }),
    "Quadro arquivado.",
  );
  const [confirmar, setConfirmar] = useState(false);
  return (
    <Secao titulo="Arquivar">
      <p className="text-xs text-muted-foreground">
        O quadro some da lista de todos os membros, e as tarefas dele saem de Minhas tarefas.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="text-danger"
        onClick={() => setConfirmar(true)}
      >
        Arquivar quadro
      </Button>
      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{dados.quadro.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Ninguém mais vê o quadro nem as tarefas dele. Para recuperar, é preciso pedir à
              administração.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                arquivar.mutate(undefined, {
                  onSuccess: () => navigate({ to: "/tarefas/quadros" }),
                })
              }
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}
