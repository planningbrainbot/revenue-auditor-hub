import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { mesmoNome } from "./nomes";
import {
  criarPessoa,
  darAcessoPessoa,
  definirStatusPessoa,
  editarPessoa,
  excluirCadastro,
  type AcessoResult,
  type StatusPessoa,
  type GentePessoaRow,
} from "@/lib/gente.functions";
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
const SEM_VINCULO = "__sem_vinculo__";

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

/** Rótulo de campo que pode ficar em branco. Pedido do RH de Maceió, 28/09/2026. */
function Opcional() {
  return <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>;
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
  // Mesmo nome já ativo na unidade: avisa e pede um segundo clique (caso do
  // Adílio, 01/10/2026, que entrou duas vezes com e-mails diferentes).
  const [confirmouHomonimo, setConfirmouHomonimo] = useState(false);
  const homonimo =
    f.nomeCompleto.trim().split(/\s+/).length > 1
      ? gestoresDaUnidade.find((g) => mesmoNome(g.nome, f.nomeCompleto))
      : undefined;

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
      setConfirmouHomonimo(false);
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
            e-mail para criar a senha. Se o e-mail já tiver login, o vínculo é feito na hora. Só
            nome completo e e-mail são obrigatórios; o resto dá para completar depois em Editar.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (homonimo && !confirmouHomonimo) {
              setConfirmouHomonimo(true);
              return;
            }
            criar.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="np-nome">Nome completo</Label>
            <Input
              id="np-nome"
              value={f.nomeCompleto}
              onChange={(e) => {
                set("nomeCompleto")(e.target.value);
                setConfirmouHomonimo(false);
              }}
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
              <Label htmlFor="np-cargo">
                Cargo
                <Opcional />
              </Label>
              <Input
                id="np-cargo"
                value={f.cargo}
                onChange={(e) => set("cargo")(e.target.value)}
                placeholder="Ex.: Líder de RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-depto">
                Departamento
                <Opcional />
              </Label>
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
              <Label htmlFor="np-admissao">
                Admissão
                <Opcional />
              </Label>
              <Input
                id="np-admissao"
                type="date"
                value={f.dataAdmissao}
                onChange={(e) => set("dataAdmissao")(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-gestor">
              Gestor
              <Opcional />
            </Label>
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

          {homonimo ? (
            <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning">
              Já existe {homonimo.nome} ativo nesta unidade. Se for a mesma pessoa, feche e use
              Editar na linha dela. Se for outra pessoa,{" "}
              {confirmouHomonimo
                ? "clique em Cadastrar mesmo assim."
                : "clique em Cadastrar e confirme."}
            </p>
          ) : null}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={criar.isPending || !unidadeId}>
              {criar.isPending
                ? "Salvando…"
                : homonimo && confirmouHomonimo
                  ? "Cadastrar mesmo assim"
                  : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVOS_DESLIGAMENTO = [
  "Pedido de demissão",
  "Dispensa sem justa causa",
  "Dispensa por justa causa",
  "Término do contrato de experiência",
  "Fim de contrato (PJ, estágio ou terceiro)",
  "Outro",
];

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Situação da pessoa no cadastro (01/10/2026). Desligar guarda o histórico e
 * corta o login quando a conta é da unidade; excluir só existe para cadastro
 * sem histórico nenhum, e o banco é quem confere (`gente_excluir_cadastro`).
 */
function SituacaoPessoa({
  pessoa,
  aoConcluir,
}: {
  pessoa: GentePessoaRow;
  aoConcluir: () => void;
}) {
  const statusFn = useServerFn(definirStatusPessoa);
  const excluirFn = useServerFn(excluirCadastro);
  const qc = useQueryClient();
  const [modo, setModo] = useState<"nada" | "desligar" | "excluir">("nada");
  const [data, setData] = useState(hojeISO());
  const [motivo, setMotivo] = useState(MOTIVOS_DESLIGAMENTO[0]);

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["gente"] });
    qc.invalidateQueries({ queryKey: ["gente-menu"] });
    qc.invalidateQueries({ queryKey: ["gente-ave-radar"] });
  };

  const mudar = useMutation({
    mutationFn: (status: StatusPessoa) =>
      statusFn({
        data: {
          pessoaId: pessoa.id,
          status,
          data: status === "desligado" ? data : undefined,
          motivo: status === "desligado" ? motivo : undefined,
        },
      }),
    onSuccess: (r, status) => {
      const partes = [
        status === "desligado"
          ? "Pessoa desligada. O histórico continua no filtro Desligadas."
          : status === "afastado"
            ? "Pessoa marcada como afastada."
            : "Pessoa reativada.",
      ];
      if (r.acessoCortado) partes.push("O login no Brain foi cortado.");
      if (r.acessoReativado) partes.push("O login no Brain voltou.");
      if (r.acessoMantidoPor) {
        partes.push(`O login não foi alterado (${r.acessoMantidoPor}): peça à Matriz.`);
      }
      if (status === "desligado" && r.lideradosAtivos) {
        partes.push(
          `${r.lideradosAtivos} pessoa(s) tinham ela como gestora: defina o novo gestor.`,
        );
      }
      (r.acessoMantidoPor || r.lideradosAtivos ? toast.warning : toast.success)(partes.join(" "), {
        duration: 10_000,
      });
      recarregar();
      aoConcluir();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: () => excluirFn({ data: { pessoaId: pessoa.id } }),
    onSuccess: () => {
      toast.success("Cadastro excluído.");
      recarregar();
      aoConcluir();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setModo("nada");
    },
  });

  const ocupado = mudar.isPending || excluir.isPending;

  return (
    <div className="mt-2 grid gap-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">Situação</h4>
        <p className="text-[13px] text-muted-foreground">
          {pessoa.status === "desligado"
            ? `Desligada${pessoa.dataDesligamento ? ` em ${new Date(`${pessoa.dataDesligamento}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}${pessoa.motivoDesligamento ? ` (${pessoa.motivoDesligamento})` : ""}.`
            : pessoa.status === "afastado"
              ? "Afastada: fora do radar e das avaliações, com o login mantido."
              : "Ativa."}
        </p>
      </div>

      {modo === "nada" ? (
        <div className="flex flex-wrap gap-2">
          {pessoa.status !== "desligado" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModo("desligar")}
              disabled={ocupado}
            >
              Desligar
            </Button>
          ) : null}
          {pessoa.status === "ativo" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => mudar.mutate("afastado")}
              disabled={ocupado}
            >
              Afastar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => mudar.mutate("ativo")}
              disabled={ocupado}
            >
              Reativar
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => setModo("excluir")}
            disabled={ocupado}
          >
            Excluir cadastro
          </Button>
        </div>
      ) : null}

      {modo === "desligar" ? (
        <div className="grid gap-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="dl-data">Data do desligamento</Label>
              <Input
                id="dl-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dl-motivo">Motivo</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger id="dl-motivo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS_DESLIGAMENTO.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground">
            O histórico fica guardado (avaliações, 1:1, feedback, PDI). A pessoa sai das listas de
            ativos e do radar.
            {pessoa.temLogin ? " O login no Brain é cortado junto." : ""}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={ocupado}>
              Voltar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => mudar.mutate("desligado")}
              disabled={ocupado || !data}
            >
              {mudar.isPending ? "Desligando…" : "Confirmar desligamento"}
            </Button>
          </div>
        </div>
      ) : null}

      {modo === "excluir" ? (
        <div className="grid gap-3 rounded-md border border-danger p-3">
          <p className="text-[13px]">
            Excluir apaga o cadastro de vez. Serve para quem foi cadastrado por engano, como em
            duplicidade. Se a pessoa já tem qualquer histórico, a exclusão é recusada e o caminho é
            Desligar.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={ocupado}>
              Voltar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => excluir.mutate()}
              disabled={ocupado}
            >
              {excluir.isPending ? "Excluindo…" : "Excluir de vez"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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

/**
 * Completar ou corrigir o cadastro de quem já está na unidade. E-mail, unidade
 * e status ficam fora: ver o comentário de `editarPessoa`.
 */
export function EditarPessoaDialog({
  pessoa,
  gestores,
}: {
  pessoa: GentePessoaRow;
  gestores: { id: number; nome: string; unidadeId: number | null }[];
}) {
  const fn = useServerFn(editarPessoa);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const inicial = () => ({
    nomeCompleto: pessoa.nomeCompleto,
    cargo: pessoa.cargo ?? "",
    departamento: pessoa.departamento ?? "",
    tipoVinculo: pessoa.tipoVinculo ?? SEM_VINCULO,
    dataAdmissao: pessoa.dataAdmissao?.slice(0, 10) ?? "",
    gestorId: pessoa.gestorId != null ? String(pessoa.gestorId) : SEM_GESTOR,
  });
  const [f, setF] = useState(inicial);
  const set = (k: keyof ReturnType<typeof inicial>) => (v: string) =>
    setF((s) => ({ ...s, [k]: v }));

  const candidatos = gestores.filter(
    (g) => g.id !== pessoa.id && (pessoa.unidadeId == null || g.unidadeId === pessoa.unidadeId),
  );
  // Gestor atual de outra unidade ou já inativo continua aparecendo, para o
  // formulário não trocar o gestor sem ninguém pedir.
  const gestorAtualFora =
    pessoa.gestorId != null && !candidatos.some((g) => g.id === pessoa.gestorId);

  const salvar = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          pessoaId: pessoa.id,
          nomeCompleto: f.nomeCompleto,
          cargo: f.cargo,
          departamento: f.departamento,
          tipoVinculo: f.tipoVinculo === SEM_VINCULO ? "" : f.tipoVinculo,
          dataAdmissao: f.dataAdmissao,
          gestorId: f.gestorId === SEM_GESTOR ? null : Number(f.gestorId),
        },
      }),
    onSuccess: () => {
      toast.success("Cadastro atualizado.");
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["gente"] });
      qc.invalidateQueries({ queryKey: ["gente-menu"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (o) setF(inicial());
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          aria-label={`Editar ${pessoa.nomeCompleto}`}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>
            {pessoa.email ?? "Sem e-mail"}
            {pessoa.unidade ? `, ${pessoa.unidade}` : ""}. E-mail e unidade só a Matriz altera.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ep-nome">Nome completo</Label>
            <Input
              id="ep-nome"
              value={f.nomeCompleto}
              onChange={(e) => set("nomeCompleto")(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ep-cargo">
                Cargo
                <Opcional />
              </Label>
              <Input id="ep-cargo" value={f.cargo} onChange={(e) => set("cargo")(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ep-depto">
                Departamento
                <Opcional />
              </Label>
              <Input
                id="ep-depto"
                value={f.departamento}
                onChange={(e) => set("departamento")(e.target.value)}
                placeholder="Ex.: RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ep-vinculo">
                Vínculo
                <Opcional />
              </Label>
              <Select value={f.tipoVinculo} onValueChange={set("tipoVinculo")}>
                <SelectTrigger id="ep-vinculo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_VINCULO}>Não informado</SelectItem>
                  {VINCULOS.map((v) => (
                    <SelectItem key={v.v} value={v.v}>
                      {v.t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ep-admissao">
                Admissão
                <Opcional />
              </Label>
              <Input
                id="ep-admissao"
                type="date"
                value={f.dataAdmissao}
                onChange={(e) => set("dataAdmissao")(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ep-gestor">
              Gestor
              <Opcional />
            </Label>
            <Select value={f.gestorId} onValueChange={set("gestorId")}>
              <SelectTrigger id="ep-gestor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_GESTOR}>Sem gestor</SelectItem>
                {gestorAtualFora ? (
                  <SelectItem value={String(pessoa.gestorId)}>
                    {pessoa.gestorNome ?? "Gestor atual"}
                  </SelectItem>
                ) : null}
                {candidatos.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
        <SituacaoPessoa pessoa={pessoa} aoConcluir={() => setAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}
