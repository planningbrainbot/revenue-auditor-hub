// Diálogos da ficha da pessoa (/admin/usuarios/$userId). Vieram da lista de
// usuários, onde cada um era uma janela montada à mão; aqui usam os primitivos
// do design system e devolvem o resultado para quem abriu mostrar.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import {
  adminDesativarPessoa,
  adminEnviarRedefinicaoSenha,
  adminGerarSenhaProvisoria,
  adminGrantGrowthAccess,
  adminReativarPessoa,
  adminRevokeGrowthAccess,
  adminUpdateUser,
} from "@/lib/admin-users.functions";
import { dominioIncomum } from "@/lib/pessoas-situacao";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** O que um diálogo de acesso devolve para a tela mostrar e deixar copiar. */
export type ResultadoDeAcesso =
  | { tipo: "link"; email: string; link: string | null; enviado: boolean; erro: string | null; titulo: string }
  | { tipo: "senha"; email: string; senha: string };

function invalidarPessoa(qc: ReturnType<typeof useQueryClient>, userId: string) {
  qc.invalidateQueries({ queryKey: ["ficha-pessoa", userId] });
  qc.invalidateQueries({ queryKey: ["admin-users"] });
}

/** Painel com o link ou a senha gerada. Aparece uma vez; depois some. */
export function PainelResultado({ r, onFechar }: { r: ResultadoDeAcesso; onFechar: () => void }) {
  const texto = r.tipo === "senha" ? `E-mail: ${r.email}\nSenha: ${r.senha}` : (r.link ?? "");
  return (
    <div
      role="status"
      className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm"
    >
      <p className="font-semibold text-foreground">
        {r.tipo === "senha" ? "Senha provisória gerada" : r.titulo}
      </p>
      {r.tipo === "senha" ? (
        <p className="text-muted-foreground">
          Copie e mande por um canal seguro: ela só aparece agora. A senha anterior já não vale, e no
          próximo acesso a pessoa é levada a cadastrar a dela.
        </p>
      ) : r.enviado ? (
        <p className="text-muted-foreground">
          {r.email} recebeu um link para cadastrar a própria senha. Vale por 1 hora e é de uso único.
        </p>
      ) : (
        <p className="text-muted-foreground">
          O e-mail para {r.email} não saiu{r.erro ? ` (${r.erro})` : ""}. Copie o link e mande por um
          canal seguro. Ele vale por 1 hora.
        </p>
      )}
      {texto && (
        <pre className="whitespace-pre-wrap break-all rounded-lg bg-background px-3 py-2 font-mono text-[13px] text-foreground">
          {texto}
        </pre>
      )}
      <div className="flex gap-2">
        {texto && (
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(texto);
              toast.success("Copiado.");
            }}
          >
            <Copy className="size-4" aria-hidden /> Copiar
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/**
 * Os dois caminhos de senha (DECISIONS 23/09/2026): o link por e-mail, que não
 * mexe na senha atual, e a senha provisória em tela, que troca na hora e
 * obriga a pessoa a cadastrar a dela. A provisória não vale para a própria
 * conta nem para outro super admin (auditoria de 24/09/2026).
 */
export function SenhaDialog({
  pessoa,
  onResultado,
  onFechar,
}: {
  pessoa: { userId: string; nome: string; email: string; souEu: boolean; superAdmin: boolean };
  onResultado: (r: ResultadoDeAcesso) => void;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const linkFn = useServerFn(adminEnviarRedefinicaoSenha);
  const provisoriaFn = useServerFn(adminGerarSenhaProvisoria);
  const [modo, setModo] = useState<"link" | "provisoria">("link");
  const provisoriaBloqueada = pessoa.souEu || pessoa.superAdmin;

  const mut = useMutation({
    mutationFn: async (): Promise<ResultadoDeAcesso> => {
      if (modo === "provisoria") {
        const r = await provisoriaFn({ data: { user_id: pessoa.userId } });
        return { tipo: "senha", email: r.email, senha: r.senha };
      }
      const r = await linkFn({ data: { user_id: pessoa.userId } });
      return {
        tipo: "link",
        titulo: "Redefinição enviada",
        email: r.email,
        link: r.emailEnviado ? null : r.link,
        enviado: r.emailEnviado,
        erro: r.emailErro,
      };
    },
    onSuccess: (r) => {
      invalidarPessoa(qc, pessoa.userId);
      onResultado(r);
      onFechar();
    },
  });

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Senha de acesso</DialogTitle>
          <DialogDescription>
            {pessoa.nome} · {pessoa.email}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={modo} onValueChange={(v) => setModo(v as "link" | "provisoria")} className="gap-3">
          <Label htmlFor="senha-link" className="flex cursor-pointer gap-3 rounded-lg border p-3 font-normal">
            <RadioGroupItem id="senha-link" value="link" className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">Enviar link por e-mail</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                A pessoa cadastra a própria senha. A atual continua valendo até ela fazer isso. Link de
                uso único, válido por 1 hora.
              </span>
            </span>
          </Label>
          <Label
            htmlFor="senha-provisoria"
            className="flex cursor-pointer gap-3 rounded-lg border p-3 font-normal aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={provisoriaBloqueada}
          >
            <RadioGroupItem id="senha-provisoria" value="provisoria" disabled={provisoriaBloqueada} className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">Gerar senha provisória</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {pessoa.souEu
                  ? "Não vale para a sua própria conta: use “Esqueci minha senha” na tela de login."
                  : pessoa.superAdmin
                    ? "Não vale para super admin: mande o link por e-mail."
                    : "A senha aparece aqui para você copiar. A atual para de valer na hora, e no próximo acesso a pessoa é obrigada a cadastrar a dela."}
              </span>
            </span>
          </Label>
        </RadioGroup>
        {mut.isError && <p className="text-sm text-danger">{(mut.error as Error)?.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Aplicando…" : modo === "provisoria" ? "Gerar senha" : "Enviar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const GROWTH_PAPEIS = ["admin", "gestao", "operacional"] as const;
const GROWTH_DEPARTAMENTOS = ["comercial", "diretoria", "marketing", "backoffice", "parcerias"] as const;

/** Papel e departamento no Growth. Mesma conta dos outros produtos: aqui não se mexe em senha. */
export function GrowthDialog({
  pessoa,
  onFechar,
}: {
  pessoa: { userId: string; nome: string; email: string; atual: { papel: string; departamento: string | null } | null };
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const concederFn = useServerFn(adminGrantGrowthAccess);
  const revogarFn = useServerFn(adminRevokeGrowthAccess);
  const [papel, setPapel] = useState(pessoa.atual?.papel ?? "operacional");
  const [departamento, setDepartamento] = useState(pessoa.atual?.departamento ?? "comercial");
  const [revogando, setRevogando] = useState(false);

  const conceder = useMutation({
    mutationFn: () => concederFn({ data: { email: pessoa.email, papel, departamento } }),
    onSuccess: () => {
      toast.success(`Growth de ${pessoa.nome} salvo.`);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
      invalidarPessoa(qc, pessoa.userId);
      onFechar();
    },
  });
  const revogar = useMutation({
    mutationFn: () => revogarFn({ data: { email: pessoa.email } }),
    onSuccess: () => {
      toast.success(`${pessoa.nome} não entra mais no Growth.`);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
      invalidarPessoa(qc, pessoa.userId);
      onFechar();
    },
  });
  const erro = (conceder.error ?? revogar.error) as Error | null;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acesso ao Growth</DialogTitle>
          <DialogDescription>
            {pessoa.nome} · {pessoa.email}. Mesma conta do Ops e do Financeiro: aqui se define só o
            que a pessoa é dentro do Growth.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Papel no Growth</Label>
            <Select value={papel} onValueChange={setPapel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROWTH_PAPEIS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Departamento</Label>
            <Select value={departamento} onValueChange={setDepartamento}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROWTH_DEPARTAMENTOS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {erro && <p className="text-sm text-danger">{erro.message}</p>}
        <DialogFooter className="sm:justify-between">
          {pessoa.atual ? (
            <Button
              variant="outline"
              className="text-danger"
              disabled={revogar.isPending}
              onClick={() => (revogando ? revogar.mutate() : setRevogando(true))}
            >
              {revogando ? "Clique de novo para revogar" : "Revogar Growth"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => conceder.mutate()} disabled={conceder.isPending}>
              {conceder.isPending ? "Salvando…" : pessoa.atual ? "Salvar" : "Dar acesso ao Growth"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Nome, e-mail e perfis. Os perfis são uma LISTA: três pessoas têm dois, e o
 * formulário antigo, de um perfil só, apagava o segundo sem avisar.
 */
export function EditarPessoaDialog({
  pessoa,
  perfis,
  onFechar,
}: {
  pessoa: { userId: string; nome: string; email: string; papeis: string[]; souEu: boolean };
  perfis: { key: string; label: string; areas: string[] }[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(adminUpdateUser);
  const [nome, setNome] = useState(pessoa.nome);
  const [email, setEmail] = useState(pessoa.email);
  const [papeis, setPapeis] = useState<string[]>(pessoa.papeis);

  const mudouPerfis =
    papeis.length !== pessoa.papeis.length || papeis.some((p) => !pessoa.papeis.includes(p));
  const mudouEmail = email.trim().toLowerCase() !== pessoa.email;

  const mut = useMutation({
    mutationFn: () =>
      salvarFn({
        data: {
          user_id: pessoa.userId,
          nome: nome.trim(),
          ...(mudouEmail ? { email: email.trim().toLowerCase() } : {}),
          ...(mudouPerfis ? { papeis } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Pessoa atualizada. A mudança de perfil vale no próximo carregamento dela.");
      invalidarPessoa(qc, pessoa.userId);
      onFechar();
    },
  });

  const alterna = (key: string) =>
    setPapeis((l) => (l.includes(key) ? l.filter((x) => x !== key) : [...l, key]));

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar {pessoa.nome}</DialogTitle>
          <DialogDescription>
            O perfil abre áreas para a pessoa. O que foi dado a ela área por área continua igual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="editar-nome">Nome</Label>
              <Input id="editar-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editar-email">E-mail</Label>
              <Input id="editar-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {mudouEmail && (
                <p className="text-[13px] text-muted-foreground">
                  O login passa a ser este e-mail, nos três produtos.
                </p>
              )}
              {dominioIncomum(email) && (
                <p className="text-[13px] text-warning">Domínio fora do grupo: confira a digitação.</p>
              )}
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Perfis</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {perfis.map((p) => (
                <div key={p.key} className="flex items-start gap-2">
                  <Checkbox
                    id={`perfil-${p.key}`}
                    checked={papeis.includes(p.key)}
                    disabled={pessoa.souEu && p.key === "admin"}
                    onCheckedChange={() => alterna(p.key)}
                    className="mt-0.5"
                  />
                  <Label htmlFor={`perfil-${p.key}`} className="font-normal leading-snug">
                    {p.label}
                    <span className="block text-[13px] text-muted-foreground">
                      {p.key === "admin"
                        ? "acesso total"
                        : p.areas.length
                          ? p.areas.join(", ")
                          : "não abre nenhuma área"}
                    </span>
                  </Label>
                </div>
              ))}
            </div>
            {papeis.length > 1 && (
              <p className="text-[13px] text-muted-foreground">
                Com mais de um perfil, a pessoa vê a soma das áreas de todos.
              </p>
            )}
          </fieldset>
        </div>
        {mut.isError && <p className="text-sm text-danger">{(mut.error as Error)?.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!nome.trim() || mut.isPending}>
            {mut.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Desligar dos três produtos (ou religar). Nada é apagado nos dois sentidos. */
export function DesativarDialog({
  pessoa,
  onFechar,
}: {
  pessoa: { userId: string; nome: string; ativo: boolean };
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const desativarFn = useServerFn(adminDesativarPessoa);
  const reativarFn = useServerFn(adminReativarPessoa);
  const [motivo, setMotivo] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (pessoa.ativo) await desativarFn({ data: { userId: pessoa.userId, motivo } });
      else await reativarFn({ data: { userId: pessoa.userId } });
    },
    onSuccess: () => {
      toast.success(pessoa.ativo ? `${pessoa.nome} foi desativada.` : `${pessoa.nome} foi reativada.`);
      invalidarPessoa(qc, pessoa.userId);
      onFechar();
    },
  });

  return (
    <AlertDialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pessoa.ativo ? `Desativar ${pessoa.nome}?` : `Reativar ${pessoa.nome}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pessoa.ativo
              ? "Ela sai do Ops, do Growth e do Financeiro agora, inclusive de sessões que estão abertas, e não consegue entrar de novo. Perfil, áreas, recorte e produtos ficam guardados: reativar devolve tudo como estava."
              : "Ela volta a entrar, com o mesmo perfil, áreas, recorte e produtos que tinha quando foi desativada."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pessoa.ativo && (
          <div className="space-y-1">
            <Label htmlFor="motivo-desativar">Motivo (opcional, fica no histórico)</Label>
            <Textarea
              id="motivo-desativar"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Desligamento, fim do contrato, conta duplicada…"
            />
          </div>
        )}
        {mut.isError && <p className="text-sm text-danger">{(mut.error as Error)?.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mut.isPending}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            className={pessoa.ativo ? "bg-destructive text-destructive-foreground" : undefined}
            disabled={mut.isPending}
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
          >
            {mut.isPending ? "Aplicando…" : pessoa.ativo ? "Desativar" : "Reativar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
