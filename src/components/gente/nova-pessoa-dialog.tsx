import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, UserPlus } from "lucide-react";
import { criarPessoa, darAcessoPessoa, type AcessoResult } from "@/lib/gente.functions";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEM_GESTOR = "__sem__";
const SEM_LOGIN = "__sem_login__";

export const PERFIS_ACESSO = [
  {
    v: "colaborador",
    t: "Colaborador",
    d: "Entra no Brain só no Planning People: a rotina dela e o time que ela lidera.",
  },
  {
    v: "gestao",
    t: "Gestão de gente da unidade",
    d: "Para quem implanta o módulo (RH, sócio): cadastra, avalia, abre clima e PDI. Só o admin de Planning People dá este perfil.",
  },
];

/**
 * Os perfis que ESTA pessoa pode dar. "Gestão de gente" dá o nível sócio da
 * área People, e só o admin de People (ou o super admin) concede (decisão do
 * dono, 25/09/2026). O servidor recusa do mesmo jeito; aqui é para a opção nem
 * aparecer a quem não pode.
 */
function usePerfisQuePossoDar() {
  const { isAdmin, adminDe } = usePermissions();
  return PERFIS_ACESSO.filter((p) => p.v !== "gestao" || isAdmin || adminDe.includes("people"));
}

/** Mensagem única para o resultado do acesso, usada no cadastro e no "Dar acesso". */
export function avisarAcesso(r: AcessoResult & { erroAcesso?: string | null }) {
  if (r.erroAcesso) {
    toast.warning(`Pessoa cadastrada, mas o acesso falhou: ${r.erroAcesso}`);
  } else if (r.situacao === "vinculado") {
    toast.success("Pronto. Ela já tinha login no Brain e foi ligada ao cadastro.");
  } else if (r.situacao === "criado" && r.emailEnviado) {
    toast.success("Pronto. O convite para criar a senha foi enviado por e-mail.");
  } else if (r.situacao === "criado") {
    toast.warning("Login criado, mas o e-mail não saiu. Copie o link e envie para a pessoa.", {
      description: r.link ?? undefined,
      duration: 60_000,
      action: r.link
        ? { label: "Copiar link", onClick: () => navigator.clipboard.writeText(r.link!) }
        : undefined,
    });
  } else {
    toast.success("Pessoa cadastrada, sem login no Brain.");
  }
}

const VINCULOS = [
  { v: "clt", t: "CLT" },
  { v: "pj", t: "PJ" },
  { v: "socio", t: "Sócio" },
  { v: "estagio", t: "Estágio" },
  { v: "prolabore", t: "Pró-labore" },
  { v: "terceiro", t: "Terceiro" },
];

type Vazio = {
  nomeCompleto: string;
  email: string;
  cargo: string;
  departamento: string;
  tipoVinculo: string;
  dataAdmissao: string;
  gestorId: string;
  acesso: string;
};

const VAZIO: Vazio = {
  nomeCompleto: "",
  email: "",
  cargo: "",
  departamento: "",
  tipoVinculo: "clt",
  dataAdmissao: "",
  gestorId: SEM_GESTOR,
  acesso: "colaborador",
};

export function NovaPessoaDialog({
  unidades,
  gestores,
}: {
  unidades: { id: number; nome: string }[];
  gestores: { id: number; nome: string; unidadeId: number | null }[];
}) {
  const perfisQuePossoDar = usePerfisQuePossoDar();
  const fn = useServerFn(criarPessoa);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState<Vazio>(VAZIO);
  // Sócio regional tem uma unidade só: já vem escolhida.
  const [unidadeId, setUnidadeId] = useState<string>(
    unidades.length === 1 ? String(unidades[0].id) : "",
  );

  const set = (k: keyof Vazio) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const gestoresDaUnidade = gestores.filter((g) => String(g.unidadeId) === unidadeId);

  const criar = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          nomeCompleto: f.nomeCompleto,
          email: f.email,
          unidadeId: Number(unidadeId),
          cargo: f.cargo,
          departamento: f.departamento,
          tipoVinculo: f.tipoVinculo,
          dataAdmissao: f.dataAdmissao,
          gestorId: f.gestorId === SEM_GESTOR ? null : Number(f.gestorId),
          acesso: f.acesso === SEM_LOGIN ? null : (f.acesso as "colaborador" | "gestao"),
        },
      }),
    onSuccess: (r) => {
      avisarAcesso(r);
      setF(VAZIO);
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["gente"] });
      qc.invalidateQueries({ queryKey: ["gente-menu"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!unidades.length) return null;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Nova pessoa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar pessoa</DialogTitle>
          <DialogDescription>
            Entra no cadastro da unidade e, se tiver acesso, ganha login no Brain com convite por
            e-mail para criar a senha. Se o e-mail já tiver login, o vínculo é feito na hora.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="np-nome">Nome completo</Label>
            <Input
              id="np-nome"
              value={f.nomeCompleto}
              onChange={(e) => set("nomeCompleto")(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-email">E-mail</Label>
            <Input
              id="np-email"
              type="email"
              value={f.email}
              onChange={(e) => set("email")(e.target.value)}
              placeholder="nome@planning.com.br"
              required
            />
          </div>

          {unidades.length > 1 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="np-unidade">Unidade</Label>
              <Select
                value={unidadeId}
                onValueChange={(v) => {
                  setUnidadeId(v);
                  set("gestorId")(SEM_GESTOR);
                }}
              >
                <SelectTrigger id="np-unidade">
                  <SelectValue placeholder="Escolha a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {unidades.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="np-cargo">Cargo</Label>
              <Input
                id="np-cargo"
                value={f.cargo}
                onChange={(e) => set("cargo")(e.target.value)}
                placeholder="Ex.: Líder de RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-depto">Departamento</Label>
              <Input
                id="np-depto"
                value={f.departamento}
                onChange={(e) => set("departamento")(e.target.value)}
                placeholder="Ex.: RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-vinculo">Vínculo</Label>
              <Select value={f.tipoVinculo} onValueChange={set("tipoVinculo")}>
                <SelectTrigger id="np-vinculo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VINCULOS.map((v) => (
                    <SelectItem key={v.v} value={v.v}>
                      {v.t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-admissao">Admissão</Label>
              <Input
                id="np-admissao"
                type="date"
                value={f.dataAdmissao}
                onChange={(e) => set("dataAdmissao")(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-gestor">Gestor</Label>
            <Select value={f.gestorId} onValueChange={set("gestorId")} disabled={!unidadeId}>
              <SelectTrigger id="np-gestor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_GESTOR}>Sem gestor por enquanto</SelectItem>
                {gestoresDaUnidade.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-acesso">Acesso ao Brain</Label>
            <Select value={f.acesso} onValueChange={set("acesso")}>
              <SelectTrigger id="np-acesso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {perfisQuePossoDar.map((p) => (
                  <SelectItem key={p.v} value={p.v}>
                    {p.t}
                  </SelectItem>
                ))}
                <SelectItem value={SEM_LOGIN}>Sem login, só no cadastro</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {PERFIS_ACESSO.find((p) => p.v === f.acesso)?.d ??
                "Fica no cadastro e nos números da unidade, sem entrar no Brain."}
            </p>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={criar.isPending || !unidadeId}>
              {criar.isPending ? "Salvando…" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Para quem está no cadastro sem login: cria a conta e manda o convite. */
export function DarAcessoDialog({
  pessoaId,
  nome,
  email,
}: {
  pessoaId: number;
  nome: string;
  email: string | null;
}) {
  const perfisQuePossoDar = usePerfisQuePossoDar();
  const fn = useServerFn(darAcessoPessoa);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [perfil, setPerfil] = useState("colaborador");

  const dar = useMutation({
    mutationFn: async () => fn({ data: { pessoaId, perfil: perfil as "colaborador" | "gestao" } }),
    onSuccess: (r) => {
      avisarAcesso(r);
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["gente"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!email}>
          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
          Dar acesso
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dar acesso ao Brain</DialogTitle>
          <DialogDescription>
            {nome} recebe em {email} o convite para criar a senha. O acesso fica preso à unidade do
            cadastro.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="da-perfil">Perfil</Label>
          <Select value={perfil} onValueChange={setPerfil}>
            <SelectTrigger id="da-perfil">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {perfisQuePossoDar.map((p) => (
                <SelectItem key={p.v} value={p.v}>
                  {p.t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {PERFIS_ACESSO.find((p) => p.v === perfil)?.d}
          </p>
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button onClick={() => dar.mutate()} disabled={dar.isPending}>
            {dar.isPending ? "Criando…" : "Criar login e enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
